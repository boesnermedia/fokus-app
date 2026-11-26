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
