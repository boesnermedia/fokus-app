/// <reference path="../pb_data/types.d.ts" />
// Aufgaben bekommen eine Schrittliste und Kommentare an Claude.
// schritte:    [{ t: "Text", done: false }]  – „step“ bleibt der erste offene Schritt (für Kalender & Co.)
// kommentare:  [{ id, text, at, von: "niklas" | "claude", offen: true|false }]
migrate((app) => {
  const t = app.findCollectionByNameOrId("aufgaben");
  t.fields.add(new JSONField({ name: "schritte", maxSize: 200000 }));
  t.fields.add(new JSONField({ name: "kommentare", maxSize: 200000 }));
  app.save(t);
  const ev = app.findCollectionByNameOrId("ereignisse");
  const typ = ev.fields.getByName("typ");
  if (typ && !typ.values.includes("kommentar")) { typ.values = [...typ.values, "kommentar"]; app.save(ev); }
}, (app) => {
  const t = app.findCollectionByNameOrId("aufgaben");
  for (const n of ["schritte", "kommentare"]) { const f = t.fields.getByName(n); if (f) t.fields.removeById(f.id); }
  app.save(t);
});
