// Lexware → Fokus. Läuft in browser_repl (eingebauter Browser). Erwartet:
//   lx = Tab mit app.lexware.de (angemeldet), fk = Tab mit fokus.boesnermedia.de (angemeldet).
// Liest nur in Lexware; ändert dort nichts.
var lxParse = (txt) => {
  const L = txt.split("\n").map((s) => s.trim()).filter(Boolean), out = [];
  const num = (s) => +s.replace(/[^\d,]/g, "").replace(",", ".");
  for (let i = 1; i < L.length - 2; i++) {
    const m = L[i].match(/^(Rechnung|\d+\. Teilrechnung|Teilrechnung|Schlussrechnung|Abschlagsrechnung|Korrektur-Rechnung) - (RE\d+) vom (\d\d)\.(\d\d)\.(\d{4})/);
    if (!m) continue;
    const st = L[i + 2]; let status = null, offen = 0;
    if (/^zu erhalten/.test(st)) { status = "offen"; offen = num(st); } else if (/^bezahlt/.test(st)) status = "bezahlt"; else continue;
    out.push({ nr: m[2], kunde: L[i - 1], titel: m[1], datum: `${m[5]}-${m[4]}-${m[3]}`, betrag: num(L[i + 1]), offen, status });
  }
  return out;
};
var lxRead = async (filter) => {
  await lx.page.goto("https://app.lexware.de/vouchers#!/VoucherList/?filter=" + filter);
  await lx.page.getByText(/RE20\d+/).first().waitFor({ timeout: 15000 }).catch(() => {});
  return lxParse(await lx.page.locator("body").innerText());
};
var lxOpen = await lxRead("openinvoice");
var lxRecent = await lxRead("invoices");
await lx.page.goto("https://app.lexware.de/dashboard/");
var einnahmen = null;
for (let i = 0; i < 20 && !einnahmen; i++) {
  await lx.page.waitForTimeout(500);
  einnahmen = ((await lx.page.locator("body").innerText()).match(/Einnahmen\s+([\d.]+,\d\d)\s*€/) || [])[1] || null;
}
var lxPayload = { open: lxOpen, recent: lxRecent, brutto: einnahmen ? +einnahmen.replace(/\./g, "").replace(",", ".") : null, now: new Date().toISOString() };
var lxResult = await fk.page.evaluate(async (P) => {
  const tok = JSON.parse(localStorage.getItem("fk_token") || "null");
  if (!tok) return "FEHLER: In der Fokus-App nicht angemeldet.";
  let h = { Authorization: tok, "Content-Type": "application/json" };
  // Sitzung verlängern, damit der Abgleich dauerhaft angemeldet bleibt
  const rf = await fetch("/api/collections/users/auth-refresh", { method: "POST", headers: h });
  if (!rf.ok) return "FEHLER: Fokus-Anmeldung abgelaufen (" + rf.status + ").";
  const rj = await rf.json(); localStorage.setItem("fk_token", JSON.stringify(rj.token)); h.Authorization = rj.token;
  const owner = rj.record.id, log = [];
  const all = (await (await fetch("/api/collections/rechnungen/records?perPage=500", { headers: h })).json()).items;
  const byNr = Object.fromEntries(all.map((r) => [r.nr, r]));
  const lx = {}; [...P.recent, ...P.open].forEach((r) => (lx[r.nr] = r));
  for (const r of Object.values(lx)) {
    const cur = byNr[r.nr];
    const data = { kunde: r.kunde, titel: r.titel, datum: r.datum + " 12:00:00.000Z", betrag: r.betrag, offen: r.offen, abgeglichen: P.now };
    if (r.status === "bezahlt") { data.status = "bezahlt"; data.offen = 0; }
    else if (cur && cur.status === "bezahlt" && cur.hinweis) { delete data.offen; } // manuell als bezahlt markiert, Zahlung in Lexware noch nicht zugeordnet
    else data.status = "offen";
    if (!cur) {
      if (r.status !== "offen") continue; // alte bezahlte Rechnungen nicht nachträglich anlegen
      const res = await fetch("/api/collections/rechnungen/records", { method: "POST", headers: h, body: JSON.stringify({ ...data, nr: r.nr, owner }) });
      log.push("neu " + r.nr + " " + res.status);
    } else {
      const changed = cur.status !== (data.status || cur.status) || Math.abs((cur.offen || 0) - (data.offen ?? cur.offen)) > 0.005;
      await fetch(`/api/collections/rechnungen/records/${cur.id}`, { method: "PATCH", headers: h, body: JSON.stringify(data) });
      if (changed) log.push(r.nr + " → " + (data.status || cur.status));
    }
  }
  // In der App offen, in Lexware weder offen noch in der Liste: melden, nicht ändern
  for (const cur of all) if (cur.status === "offen" && !lx[cur.nr]) log.push("prüfen: " + cur.nr + " in Lexware nicht mehr offen gefunden");
  // Kennzahlen: Umsatz (brutto laut Lexware-Dashboard, netto = brutto / 1,19), neue Rechnungen in Monate und Kundenmix
  const kz = (await (await fetch("/api/collections/kennzahlen/records?perPage=1", { headers: h })).json()).items[0];
  if (kz) {
    const u = kz.umsatz || {}; u.gezaehlt = u.gezaehlt || []; u.monate = u.monate || {}; u.kunden = u.kunden || {};
    const short = (k) => /STIHL/i.test(k) ? "STIHL" : /SIMPLON/i.test(k) ? "Simplon" : /Optimum/i.test(k) ? "Optimum" : /Fernmarkt/i.test(k) ? "Fernmarkt" : k.replace(/\s+(GmbH|AG|UG|e\.V\.|KG|& Co\..*)$/i, "").trim();
    for (const r of Object.values(lx)) {
      if (u.gezaehlt.includes(r.nr) || !r.datum.startsWith(String(u.jahr))) continue;
      const ym = r.datum.slice(0, 7); u.monate[ym] = Math.round(((u.monate[ym] || 0) + r.betrag) * 100) / 100;
      const k = short(r.kunde); u.kunden[k] = Math.round(((u.kunden[k] || 0) + r.betrag) * 100) / 100;
      u.gezaehlt.push(r.nr); log.push("Umsatz +" + r.nr);
    }
    if (P.brutto) { u.brutto = P.brutto; u.netto = Math.round(P.brutto / 1.19 * 100) / 100; }
    await fetch(`/api/collections/kennzahlen/records/${kz.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ umsatz: u, stand: P.now }) });
  }
  const offen = Object.values(lx).filter((r) => r.status === "offen");
  return `OK · ${offen.length} offen in Lexware · ${log.join(" | ") || "keine Änderungen"}`;
}, lxPayload);
console.log(lxResult);
