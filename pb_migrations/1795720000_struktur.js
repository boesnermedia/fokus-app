/// <reference path="../pb_data/types.d.ts" />
// Neue Struktur: Projekte (Kundenauftrag | Hintergrundprojekt), Routinen, Kennzahlen.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const own = '@request.auth.id != "" && owner = @request.auth.id';
  const rules = { listRule: own, viewRule: own, updateRule: own, deleteRule: own, createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id' };
  const owner = { type: "relation", name: "owner", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true };
  const stamps = [
    { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];

  // Projekte: bestehende Collection „auftraege“ erweitern
  const p = app.findCollectionByNameOrId("auftraege");
  p.fields.add(new SelectField({ name: "typ", values: ["kunde", "hintergrund"], maxSelect: 1 }));
  p.fields.add(new BoolField({ name: "storniert" }));
  p.fields.add(new TextField({ name: "stand", max: 4000 }));
  p.fields.add(new TextField({ name: "wartet", max: 500 }));
  p.fields.add(new TextField({ name: "ziel", max: 1000 }));
  p.fields.add(new NumberField({ name: "volumen" }));
  app.save(p);
  app.db().newQuery("UPDATE auftraege SET typ = 'kunde' WHERE typ = '' OR typ IS NULL").execute();

  const routinen = new Collection({
    type: "base", name: "routinen", ...rules,
    fields: [
      owner,
      { type: "text", name: "titel", required: true },
      { type: "select", name: "rhythmus", values: ["taeglich", "woechentlich", "monatlich"], maxSelect: 1 },
      { type: "number", name: "wochentag", min: 1, max: 7, onlyInt: true },   // 1 = Montag
      { type: "select", name: "monatsregel", values: ["erster_montag", "letzte_woche", "tag"], maxSelect: 1 },
      { type: "number", name: "monatstag", min: 1, max: 31, onlyInt: true },
      { type: "number", name: "dauer" },                                       // Stunden
      { type: "text", name: "step" },
      { type: "bool", name: "aktiv" },
      { type: "text", name: "zuletzt" },                                       // YYYY-MM-DD der letzten erzeugten Aufgabe
      ...stamps,
    ],
  });
  app.save(routinen);

  const t = app.findCollectionByNameOrId("aufgaben");
  t.fields.add(new SelectField({ name: "quelle", values: ["prozess", "mail", "feedback", "manuell", "routine"], maxSelect: 1 }));
  t.fields.add(new RelationField({ name: "routine", collectionId: routinen.id, maxSelect: 1, cascadeDelete: false }));
  t.fields.add(new NumberField({ name: "stunden" }));
  app.save(t);

  const kennzahlen = new Collection({
    type: "base", name: "kennzahlen", ...rules,
    fields: [
      owner,
      { type: "number", name: "umsatzziel" },
      { type: "number", name: "kapazitaet_min" },
      { type: "number", name: "kapazitaet_max" },
      { type: "json", name: "umsatz" },      // { jahr, brutto, netto, monate: {"2026-05": betrag}, kunden: {"STIHL": betrag}, quelle }
      { type: "json", name: "kalender" },    // [{ datum, titel, stunden }]
      { type: "text", name: "stand" },
      ...stamps,
    ],
  });
  app.save(kennzahlen);
}, (app) => {
  for (const n of ["kennzahlen", "routinen"]) { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} }
});
