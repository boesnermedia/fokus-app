/// <reference path="../pb_data/types.d.ts" />
// Grundstruktur der Fokus-App: Aufträge, Aufgaben, Eingang, Ereignisse.
// Jeder Datensatz gehört genau einem Nutzer (owner) – so kann die App später
// auch für mehrere Personen oder Unternehmen laufen.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const own = '@request.auth.id != "" && owner = @request.auth.id';
  const create = '@request.auth.id != "" && @request.body.owner = @request.auth.id';
  const rules = { listRule: own, viewRule: own, createRule: create, updateRule: own, deleteRule: own };
  const owner = { type: "relation", name: "owner", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true };
  const stamps = [
    { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];

  const auftraege = new Collection({
    type: "base", name: "auftraege", ...rules,
    fields: [
      owner,
      { type: "text", name: "nr" },
      { type: "text", name: "name", required: true },
      { type: "text", name: "kunde" },
      // 0 Anfrage · 1 Angebot · 2 Bestätigt · 3 In Arbeit · 4 Fertig · 5 Rechnung · 6 Bezahlt
      { type: "number", name: "phase", min: 0, max: 6, onlyInt: true },
      { type: "text", name: "bestellnr" },
      { type: "text", name: "notiz", max: 20000 },
      { type: "text", name: "due" },
      { type: "text", name: "mt" },
      { type: "text", name: "gmail" },
      { type: "bool", name: "ruht" },
      { type: "bool", name: "archiv" },
      ...stamps,
    ],
  });
  app.save(auftraege);

  const aufgaben = new Collection({
    type: "base", name: "aufgaben", ...rules,
    fields: [
      owner,
      { type: "text", name: "titel", required: true },
      { type: "select", name: "art", values: ["kunde", "bm"], maxSelect: 1 },
      { type: "relation", name: "auftrag", collectionId: auftraege.id, maxSelect: 1, cascadeDelete: false },
      { type: "number", name: "w", min: 0, max: 3, onlyInt: true },
      { type: "number", name: "v", min: 0, max: 3, onlyInt: true },
      { type: "number", name: "r", min: 0, max: 3, onlyInt: true },
      { type: "select", name: "s", values: ["S", "M", "L"], maxSelect: 1 },
      { type: "text", name: "due" },
      { type: "text", name: "step" },
      { type: "number", name: "post", min: 0, onlyInt: true },
      { type: "number", name: "starts", min: 0, onlyInt: true },
      { type: "select", name: "status", values: ["offen", "erledigt", "gestrichen"], maxSelect: 1 },
      { type: "text", name: "notiz", max: 20000 },
      { type: "text", name: "src" },
      { type: "text", name: "cal" },
      ...stamps,
    ],
  });
  app.save(aufgaben);

  const eingang = new Collection({
    type: "base", name: "eingang", ...rules,
    fields: [
      owner,
      { type: "text", name: "quelle" },
      { type: "text", name: "titel", required: true },
      { type: "text", name: "text", max: 20000 },
      { type: "text", name: "vorschlag" },
      { type: "select", name: "typ", values: ["aufgabe", "auftrag", "info"], maxSelect: 1 },
      { type: "json", name: "daten" },
      { type: "text", name: "src" },
      { type: "select", name: "status", values: ["neu", "uebernommen", "verworfen"], maxSelect: 1 },
      ...stamps,
    ],
  });
  app.save(eingang);

  const ereignisse = new Collection({
    type: "base", name: "ereignisse", ...rules,
    updateRule: null,
    fields: [
      owner,
      { type: "select", name: "typ", values: ["start", "erledigt", "spaeter", "schritt", "import", "checkin"], maxSelect: 1 },
      { type: "relation", name: "aufgabe", collectionId: aufgaben.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "info" },
      ...stamps,
    ],
  });
  app.save(ereignisse);
}, (app) => {
  for (const n of ["ereignisse", "eingang", "aufgaben", "auftraege"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
