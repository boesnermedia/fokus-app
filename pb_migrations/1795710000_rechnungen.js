/// <reference path="../pb_data/types.d.ts" />
// Rechnungen aus Lexware: offene Posten, damit die App echte Zahlen zeigt
// und nach 30 Tagen ohne Zahlungseingang selbst eine Aufgabe anlegt.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const auftraege = app.findCollectionByNameOrId("auftraege");
  const aufgaben = app.findCollectionByNameOrId("aufgaben");
  const own = '@request.auth.id != "" && owner = @request.auth.id';
  const rechnungen = new Collection({
    type: "base", name: "rechnungen",
    listRule: own, viewRule: own, updateRule: own, deleteRule: own,
    createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
    fields: [
      { type: "relation", name: "owner", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "nr", required: true },
      { type: "text", name: "kunde" },
      { type: "text", name: "titel", max: 2000 },
      { type: "text", name: "datum" },          // Rechnungsdatum YYYY-MM-DD
      { type: "number", name: "betrag" },        // brutto
      { type: "number", name: "offen" },         // noch zu erhalten
      { type: "select", name: "status", values: ["offen", "bezahlt"], maxSelect: 1 },
      { type: "relation", name: "auftrag", collectionId: auftraege.id, maxSelect: 1, cascadeDelete: false },
      { type: "relation", name: "aufgabe", collectionId: aufgaben.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "hinweis", max: 2000 },
      { type: "text", name: "abgeglichen" },     // Zeitpunkt des letzten Abgleichs mit Lexware
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_rechnungen_owner_nr ON rechnungen (owner, nr)"],
  });
  app.save(rechnungen);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("rechnungen")); } catch (_) {}
});
