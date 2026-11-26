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

// Bestandsaufnahme vom 26.11.2026 einmalig übernehmen (Projekte, Routinen, Rechnungen, Kennzahlen).
cronAdd("fokus_bestand", "* * * * *", () => {
  const email = $os.getenv("FOKUS_EMAIL");
  if (!email) return;
  let user; try { user = $app.findAuthRecordByEmail("users", email); } catch (_) { return; }
  try { $app.findFirstRecordByFilter("ereignisse", "owner = {:o} && typ = 'import'", { o: user.id }); } catch (_) { return; } // Erstimport zuerst
  try { $app.findFirstRecordByFilter("ereignisse", "owner = {:o} && typ = 'import' && info = 'bestand-2026-11-26'", { o: user.id }); return; } catch (_) {}
  let data;
  try { data = JSON.parse(toString($os.readFile($os.getenv("FOKUS_BESTAND") || "/pb/seed/bestand.json"))); } catch (err) { console.log("[fokus] Keine Bestandsdaten:", err); return; }

  $app.runInTransaction((tx) => {
    const o = user.id;
    const colP = tx.findCollectionByNameOrId("auftraege");
    const colT = tx.findCollectionByNameOrId("aufgaben");
    const colR = tx.findCollectionByNameOrId("routinen");
    const colRe = tx.findCollectionByNameOrId("rechnungen");
    const colK = tx.findCollectionByNameOrId("kennzahlen");
    const colE = tx.findCollectionByNameOrId("ereignisse");
    const one = (col, filter, params) => { try { return tx.findFirstRecordByFilter(col, filter, params); } catch (_) { return null; } };
    const hours = { S: 1, M: 4, L: 12 };
    const byNr = {};
    tx.db().newQuery("UPDATE auftraege SET typ = 'kunde' WHERE typ = '' OR typ IS NULL").execute();

    for (const p of data.projekte) {
      let rec = null;
      if (p.mt) rec = one("auftraege", "owner = {:o} && mt = {:mt}", { o, mt: p.mt });
      if (!rec && p.nr && p.typ === "kunde") rec = one("auftraege", "owner = {:o} && nr = {:nr}", { o, nr: p.nr });
      if (!rec && p.typ === "hintergrund") rec = one("auftraege", "owner = {:o} && typ = 'hintergrund' && name = {:n}", { o, n: p.name });
      if (!rec) { if (p.match_only) continue; rec = new Record(colP); rec.set("owner", o); }
      rec.set("typ", p.typ);
      for (const k of ["nr", "name", "kunde", "stand", "wartet", "due", "bestellnr", "ziel", "notiz"]) if (p[k] !== undefined && p[k] !== null) rec.set(k, p[k]);
      if (p.volumen) rec.set("volumen", p.volumen);
      rec.set("phase", p.phase);
      rec.set("ruht", !!p.ruht); rec.set("storniert", !!p.storniert); rec.set("archiv", !!p.archiv);
      tx.save(rec);
      if (p.nr) byNr[p.nr] = rec.id;

      // Offene Aufgaben archivierter Projekte schließen
      if (p.archiv || p.storniert) {
        for (const t of tx.findRecordsByFilter("aufgaben", "owner = {:o} && auftrag = {:a} && status = 'offen'", "", 50, 0, { o, a: rec.id })) { t.set("status", "erledigt"); tx.save(t); }
        continue;
      }
      if (!p.next) continue;
      // Nächster Schritt: vorhandene Aufgabe aktualisieren (verknüpft oder alter Titel), sonst neu anlegen
      let t = one("aufgaben", "owner = {:o} && auftrag = {:a} && status = 'offen'", { o, a: rec.id });
      if (!t && p.old) t = one("aufgaben", "owner = {:o} && titel = {:ti} && status = 'offen'", { o, ti: p.old });
      if (!t) { t = new Record(colT); t.set("owner", o); t.set("status", "offen"); t.set("post", 0); t.set("starts", 0); t.set("quelle", "manuell"); }
      const tk = p.task || {};
      t.set("titel", p.next);
      t.set("art", p.typ === "kunde" ? "kunde" : "bm");
      t.set("auftrag", rec.id);
      for (const k of ["w", "v", "s", "r", "step"]) if (tk[k] !== undefined) t.set(k, tk[k]);
      t.set("stunden", hours[tk.s || "M"]);
      if (p.due) t.set("due", p.due);
      tx.save(t);
    }

    for (const title of data.streichen || []) {
      const t = one("aufgaben", "owner = {:o} && titel = {:ti} && status = 'offen'", { o, ti: title });
      if (t) { t.set("status", "gestrichen"); tx.save(t); }
    }
    // Restliche Aufgaben ohne Stundenwert
    for (const t of tx.findRecordsByFilter("aufgaben", "owner = {:o} && status = 'offen' && stunden = 0", "", 500, 0, { o })) { t.set("stunden", hours[t.getString("s") || "M"]); tx.save(t); }

    for (const r of data.routinen) {
      if (one("routinen", "owner = {:o} && titel = {:ti}", { o, ti: r.titel })) continue;
      const rec = new Record(colR); rec.set("owner", o); rec.set("aktiv", true);
      for (const k of Object.keys(r)) rec.set(k, r[k]);
      tx.save(rec);
    }

    for (const r of data.rechnungen) {
      let rec = one("rechnungen", "owner = {:o} && nr = {:nr}", { o, nr: r.nr });
      if (!rec) { rec = new Record(colRe); rec.set("owner", o); }
      for (const k of ["nr", "kunde", "titel", "datum", "betrag", "offen", "status", "hinweis"]) if (r[k] !== undefined) rec.set(k, r[k]);
      if (r.auftrag && byNr[r.auftrag]) rec.set("auftrag", byNr[r.auftrag]);
      rec.set("abgeglichen", data.kennzahlen.stand);
      tx.save(rec);
    }

    let k = one("kennzahlen", "owner = {:o}", { o });
    if (!k) { k = new Record(colK); k.set("owner", o); }
    for (const key of Object.keys(data.kennzahlen)) k.set(key, data.kennzahlen[key]);
    tx.save(k);

    const ev = new Record(colE); ev.set("owner", o); ev.set("typ", "import"); ev.set("info", "bestand-2026-11-26"); tx.save(ev);
  });
  console.log("[fokus] Bestandsaufnahme übernommen");
});

// Routinen: jeden Morgen fällige Routine-Aufgaben anlegen.
cronAdd("fokus_routinen", "*/10 * * * *", () => {
  const now = new Date();
  const berlin = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  const ymd = berlin.getFullYear() + "-" + String(berlin.getMonth() + 1).padStart(2, "0") + "-" + String(berlin.getDate()).padStart(2, "0");
  const wd = berlin.getDay() === 0 ? 7 : berlin.getDay();
  const last = new Date(berlin.getFullYear(), berlin.getMonth() + 1, 0).getDate();
  let list = [];
  try { list = $app.findRecordsByFilter("routinen", "aktiv = true", "", 200, 0); } catch (_) { return; }
  const colT = $app.findCollectionByNameOrId("aufgaben");
  for (const r of list) {
    if (r.getString("zuletzt") === ymd) continue;
    const rh = r.getString("rhythmus");
    let due = false;
    if (rh === "taeglich") due = wd <= 5;
    else if (rh === "woechentlich") due = wd === (r.getInt("wochentag") || 1);
    else if (rh === "monatlich") {
      const rule = r.getString("monatsregel");
      if (rule === "erster_montag") due = wd === 1 && berlin.getDate() <= 7;
      else if (rule === "letzte_woche") due = berlin.getDate() === last - 6;
      else due = berlin.getDate() === (r.getInt("monatstag") || 1);
    }
    if (!due) continue;
    // Offene Instanz von gestern ersetzen statt stapeln
    try {
      for (const old of $app.findRecordsByFilter("aufgaben", "routine = {:r} && status = 'offen'", "", 20, 0, { r: r.id })) { old.set("status", "gestrichen"); $app.save(old); }
    } catch (_) {}
    const d = r.getFloat("dauer") || 0.5;
    const t = new Record(colT);
    t.set("owner", r.getString("owner"));
    t.set("titel", r.getString("titel"));
    t.set("art", "bm"); t.set("quelle", "routine"); t.set("routine", r.id);
    t.set("w", 1); t.set("v", 2); t.set("r", 1); t.set("s", d <= 1 ? "S" : "M"); t.set("stunden", d);
    t.set("step", r.getString("step")); t.set("due", ymd);
    t.set("status", "offen"); t.set("post", 0); t.set("starts", 0);
    $app.save(t);
    r.set("zuletzt", ymd); $app.save(r);
  }
});

// Prozess: Standardschritte, wenn ein Kundenauftrag die Phase wechselt.
onRecordAfterUpdateSuccess((e) => {
  const r = e.record;
  if (r.getString("typ") !== "kunde") return e.next();
  const before = r.original().getInt("phase"), now = r.getInt("phase");
  if (before === now || r.getBool("storniert")) return e.next();
  const steps = {
    1: [["Angebot nachfassen", "Mail mit kurzer Nachfrage zum Angebot schreiben", 7]],
    2: [["Bestellnummer hinterlegen", "Bestellbestätigung suchen und Nummer im Projekt eintragen", 3], ["Termine und Drehtag planen", "Zwei Terminvorschläge an den Kunden schicken", 3]],
    4: [["Rechnung in Lexware stellen", "Lexware öffnen und Rechnungsentwurf aus dem Angebot anlegen", 2]],
  }[now] || [];
  const colT = e.app.findCollectionByNameOrId("aufgaben");
  for (const [titel, step, inDays] of steps) {
    let exists = false;
    try { e.app.findFirstRecordByFilter("aufgaben", "auftrag = {:a} && titel = {:t} && status = 'offen'", { a: r.id, t: titel }); exists = true; } catch (_) {}
    if (exists) continue;
    const d = new Date(Date.now() + inDays * 864e5).toISOString().slice(0, 10);
    const t = new Record(colT);
    t.set("owner", r.getString("owner")); t.set("titel", titel); t.set("art", "kunde"); t.set("auftrag", r.id);
    t.set("quelle", "prozess"); t.set("w", now === 4 ? 3 : 2); t.set("v", now === 4 ? 3 : 2); t.set("s", "S"); t.set("r", now === 4 ? 2 : 1);
    t.set("stunden", 0.5); t.set("step", step); t.set("due", d);
    t.set("status", "offen"); t.set("post", 0); t.set("starts", 0);
    e.app.save(t);
  }
  e.next();
}, "auftraege");

// Cache-Regeln für die App-Hülle: Service Worker und Startseite immer frisch,
// Dateien mit Inhalts-Hash im Namen dürfen lange gecacht werden.
routerUse((e) => {
  const p = e.request.url.path;
  if ((e.request.method === "GET" || e.request.method === "HEAD") && !p.startsWith("/api/") && !p.startsWith("/_/")) {
    if (/^\/app\.[0-9a-f]{10}\.(js|css)$/.test(p) || p.startsWith("/fonts/")) e.response.header().set("Cache-Control", "public, max-age=31536000, immutable");
    else e.response.header().set("Cache-Control", "no-cache");
  }
  return e.next();
});

// Datensicherung: jede Nacht ein Backup (7 werden behalten). Ist FOKUS_BACKUP_SECRET gesetzt,
// landen die Backups in der S3-kompatiblen Bunny-Storage-Zone statt nur auf dem Volume.
cronAdd("fokus_backup_setup", "*/5 * * * *", () => {
  try {
    const s = $app.settings();
    const zone = $os.getenv("FOKUS_BACKUP_ZONE") || "boesnermedia-fokus-backup";
    const secret = $os.getenv("FOKUS_BACKUP_SECRET");
    const region = $os.getenv("FOKUS_BACKUP_REGION") || "de";
    const want = { cron: "0 2 * * *", keep: 7, s3: !!secret };
    const b = s.backups;
    const same = b.cron === want.cron && b.cronMaxKeep === want.keep && b.s3.enabled === want.s3 &&
      (!want.s3 || (b.s3.bucket === zone && b.s3.secret === secret && b.s3.region === region));
    if (same) return;
    b.cron = want.cron; b.cronMaxKeep = want.keep;
    if (secret) {
      b.s3.enabled = true; b.s3.bucket = zone; b.s3.region = region;
      b.s3.endpoint = `https://${region}-s3.storage.bunnycdn.com`;
      b.s3.accessKey = zone; b.s3.secret = secret; b.s3.forcePathStyle = true;
    } else { b.s3.enabled = false; }
    $app.save(s);
    console.log(`[fokus] Datensicherung eingerichtet: täglich, ${want.s3 ? "Bunny Storage " + zone : "lokal auf dem Volume"}`);
  } catch (err) { console.log("[fokus] Datensicherung: " + err); }
});
