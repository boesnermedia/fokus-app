/// <reference path="../pb_data/types.d.ts" />
// Einrichtung: Nutzer aus den Umgebungsvariablen anlegen und einmalig die Startdaten
// (Aufträge aus MeisterTask, Aufgaben aus dem Fokus-Cockpit) importieren.
// Läuft jede Minute, tut aber nur beim ersten Mal etwas (danach zwei kurze Abfragen).
cronAdd("fokus_setup", "* * * * *", () => {
  const email = $os.getenv("FOKUS_EMAIL");
  const pass = $os.getenv("FOKUS_PASSWORD");
  if (!email || !pass) return;

  let user = null;
  try { user = $app.findAuthRecordByEmail("users", email); } catch (_) { user = null; }
  if (!user) {
    const col = $app.findCollectionByNameOrId("users");
    user = new Record(col);
    user.setEmail(email);
    user.setPassword(pass);
    user.setVerified(true);
    user.set("name", $os.getenv("FOKUS_NAME") || "");
    $app.save(user);
    console.log("[fokus] Nutzer angelegt:", email);
  }

  let imported = false;
  try {
    $app.findFirstRecordByFilter("ereignisse", "owner = {:o} && typ = 'import'", { o: user.id });
    imported = true;
  } catch (_) { imported = false; }
  if (imported) return;

  const path = $os.getenv("FOKUS_SEED") || "/pb/seed/seed.json";
  let seed;
  try { seed = JSON.parse(toString($os.readFile(path))); } catch (err) { console.log("[fokus] Kein Seed gefunden:", err); return; }

  $app.runInTransaction((tx) => {
    const colA = tx.findCollectionByNameOrId("auftraege");
    const colT = tx.findCollectionByNameOrId("aufgaben");
    const colE = tx.findCollectionByNameOrId("ereignisse");
    const byMt = {};
    for (const o of seed.auftraege || []) {
      const r = new Record(colA);
      r.set("owner", user.id);
      for (const k of ["nr", "name", "kunde", "phase", "bestellnr", "notiz", "due", "mt", "archiv"]) r.set(k, o[k]);
      tx.save(r);
      if (o.mt) byMt[o.mt] = r.id;
    }
    for (const t of seed.aufgaben || []) {
      const r = new Record(colT);
      r.set("owner", user.id);
      for (const k of ["titel", "art", "w", "v", "s", "r", "step", "due", "notiz"]) r.set(k, t[k]);
      r.set("status", "offen");
      r.set("post", 0);
      r.set("starts", 0);
      if (t.mt && byMt[t.mt]) r.set("auftrag", byMt[t.mt]);
      tx.save(r);
    }
    const ev = new Record(colE);
    ev.set("owner", user.id);
    ev.set("typ", "import");
    ev.set("info", "Startdaten importiert");
    tx.save(ev);
  });
  console.log("[fokus] Startdaten importiert");
});

// Rechnungsregeln (stündlich):
// - offene Rechnung → zugehöriger Auftrag steht auf „Rechnung“ (außer bei Teilrechnungen)
// - 30 Tage nach Rechnungsdatum ohne Zahlung → Aufgabe „Zahlung nachhaken“
// - bezahlt → Erinnerungsaufgabe erledigt, Auftrag auf „Bezahlt“ und archiviert
cronAdd("fokus_rechnungen", "7 * * * *", () => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ageDays = (d) => d ? Math.floor((today - new Date(d + "T00:00:00")) / 864e5) : 0;
  const isTeil = (r) => /teilrechnung|abschlag/i.test(r.getString("titel"));
  let list = [];
  try { list = $app.findRecordsByFilter("rechnungen", "id != ''", "datum", 1000, 0); } catch (_) { return; }
  const colT = $app.findCollectionByNameOrId("aufgaben");

  for (const r of list) {
    const status = r.getString("status");
    const aid = r.getString("auftrag");
    let auftrag = null;
    if (aid) { try { auftrag = $app.findRecordById("auftraege", aid); } catch (_) { auftrag = null; } }

    if (status === "offen") {
      if (auftrag && !isTeil(r) && auftrag.getInt("phase") < 5) { auftrag.set("phase", 5); $app.save(auftrag); }
      if (!r.getString("aufgabe") && ageDays(r.getString("datum")) >= 30) {
        const t = new Record(colT);
        const kunde = r.getString("kunde");
        t.set("owner", r.getString("owner"));
        t.set("titel", "Zahlung nachhaken: " + r.getString("nr") + (kunde ? " (" + kunde + ")" : ""));
        t.set("art", "kunde");
        if (aid) t.set("auftrag", aid);
        t.set("w", 3); t.set("v", 3); t.set("s", "S"); t.set("r", 2);
        t.set("step", "Rechnung " + r.getString("nr") + " in Lexware öffnen und prüfen: Zahlung übersehen oder Erinnerung schicken?");
        t.set("notiz", "Seit " + ageDays(r.getString("datum")) + " Tagen offen. Offener Betrag: " + r.getFloat("offen").toFixed(2).replace(".", ",") + " €." + (r.getString("hinweis") ? "\n" + r.getString("hinweis") : ""));
        t.set("status", "offen"); t.set("post", 0); t.set("starts", 0);
        t.set("due", new Date().toISOString().slice(0, 10));
        $app.save(t);
        r.set("aufgabe", t.id);
        $app.save(r);
        console.log("[fokus] Zahlungsaufgabe angelegt:", r.getString("nr"));
      }
    } else if (status === "bezahlt") {
      const tid = r.getString("aufgabe");
      if (tid) {
        try { const t = $app.findRecordById("aufgaben", tid); if (t.getString("status") === "offen") { t.set("status", "erledigt"); $app.save(t); } } catch (_) {}
      }
      if (auftrag && !isTeil(r) && auftrag.getInt("phase") === 5) {
        let stillOpen = false;
        try { $app.findFirstRecordByFilter("rechnungen", "auftrag = {:a} && status = 'offen'", { a: aid }); stillOpen = true; } catch (_) {}
        if (!stillOpen) { auftrag.set("phase", 6); auftrag.set("archiv", true); $app.save(auftrag); }
      }
    }
  }
});
