// Fokus · immer nur der nächste Schritt.
// Eine kleine App ohne Framework: PocketBase-API per fetch, Ansichten über den Hash (#jetzt, #eingang …).
(() => {
"use strict";

const PHASES = ["Anfrage", "Angebot", "Bestätigt", "In Arbeit", "Fertig", "Rechnung", "Bezahlt"];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("fk_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("fk_" + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("fk_" + k); } catch {} },
};

const S = {
  token: store.get("token", ""), me: store.get("me", null),
  auftraege: [], aufgaben: [], eingang: [], rechnungen: [], routinen: [], kennzahlen: null, starts: 0,
  loaded: false, skip: new Set(), timer: null, showMore: false,
};

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: S.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { logout(); throw new Error("Bitte neu anmelden."); }
  if (!res.ok) {
    let msg = "Fehler " + res.status;
    try { const j = await res.json(); msg = j.message || msg; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}
const col = (c) => `/api/collections/${c}/records`;
async function listAll(c, filter, sort = "") {
  const q = new URLSearchParams({ perPage: "500", filter, sort });
  return (await api(`${col(c)}?${q}`)).items;
}
const create = (c, data) => api(col(c), { method: "POST", body: { owner: S.me.id, ...data } });
const update = (c, id, data) => api(`${col(c)}/${id}`, { method: "PATCH", body: data });
const logEvent = (typ, aufgabe, info) => create("ereignisse", { typ, aufgabe: aufgabe || "", info: info || "" }).catch(() => {});

async function load() {
  const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const since = monday.toISOString().replace("T", " ");
  const [a, t, e, st, re, ro, kz] = await Promise.all([
    listAll("auftraege", "archiv = false", "-updated"),
    listAll("aufgaben", "status = 'offen'", "-updated"),
    listAll("eingang", "status = 'neu'", "created"),
    api(`${col("ereignisse")}?${new URLSearchParams({ perPage: "1", filter: `typ = 'start' && created >= '${since}'` })}`),
    listAll("rechnungen", "status = 'offen' || hinweis != ''", "datum").catch(() => []),
    listAll("routinen", "id != ''", "created").catch(() => []),
    listAll("kennzahlen", "id != ''", "-updated").catch(() => []),
  ]);
  S.auftraege = a; S.aufgaben = t; S.eingang = e; S.starts = st.totalItems; S.rechnungen = re; S.routinen = ro; S.kennzahlen = kz[0] || null; S.loaded = true;
}

function patchLocal(list, rec) {
  const i = S[list].findIndex((x) => x.id === rec.id);
  if (i >= 0) S[list][i] = rec; else S[list].unshift(rec);
}

/* ---------- Logik ---------- */
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const days = (d) => (d ? Math.round((new Date(d + "T00:00:00") - today()) / 864e5) : null);
const hour = () => new Date().getHours();
const phase = () => (hour() < 12 ? "vormittag" : hour() < 16 ? "mittag" : "abend");
const todayKey = () => new Date().toISOString().slice(0, 10);
const energy = () => { const e = store.get("energy", null); return e && e.day === todayKey() ? e.level : null; };
const auftragOf = (t) => S.auftraege.find((a) => a.id === t.auftrag);

function druck(t) {
  let p = (t.w || 0) * 3; const d = days(t.due || auftragOf(t)?.due);
  if (d !== null) { if (d < 0) p += 8; else if (d <= 2) p += 6; else if (d <= 7) p += 3; }
  return p;
}
const wert = (t) => (t.v || 0) * 3 + (t.art === "bm" ? 2 : 0) - (t.s === "L" ? 1 : 0);
const frosch = (t) => (t.r || 0) * 3 + (t.post || 0) * 2;

function score(t) {
  const en = energy() || "mittel", ph = phase();
  let s;
  if (en === "hoch") s = druck(t) * 1.2 + wert(t) * 1.2 + frosch(t) * (ph === "vormittag" ? 1.5 : 1);
  else if (en === "niedrig") s = druck(t) * 1.2 + wert(t) * 0.6 + frosch(t) * 0.2 + (t.s === "S" ? 8 : 0);
  else s = druck(t) * 1.5 + wert(t) + frosch(t) * 0.6;
  if (ph === "abend") s += (t.s === "S" ? 6 : 0) - (t.s === "L" ? 4 : 0);
  return s;
}
function label(t) {
  if (druck(t) >= 8) return "Pflicht";
  if (frosch(t) >= 9 && frosch(t) >= wert(t)) return "Frosch";
  if (t.art === "bm" || (t.v || 0) >= 3) return "Hebel";
  return "Als Nächstes";
}
const ranked = () => S.aufgaben.filter((t) => !S.skip.has(t.id)).sort((a, b) => score(b) - score(a));
function context(t) {
  const a = auftragOf(t), d = days(t.due || a?.due), bits = [];
  if (a) bits.push(a.kunde || a.name); else if (t.art === "bm") bits.push("Hinter den Kulissen");
  if (d !== null) bits.push(d < 0 ? "überfällig" : d === 0 ? "heute fällig" : d === 1 ? "morgen fällig" : d <= 6 ? "fällig " + new Date(t.due || a.due).toLocaleDateString("de-DE", { weekday: "short" }) : "fällig " + new Date(t.due || a.due).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }));
  return bits.join(" · ");
}
const euro = (n) => (n || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const minutes = (t) => (t.s === "S" ? 10 : 15);
const title = (t) => { const a = auftragOf(t); return a && !t.titel.toLowerCase().includes((a.kunde || "").toLowerCase()) ? `${t.titel}` : t.titel; };

/* ---------- Rahmen ---------- */
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 2600); }
function setNav(name) {
  $$("[data-nav]").forEach((a) => { if (a.dataset.nav === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  $$("[data-badge]").forEach((b) => { b.textContent = S.eingang.length; b.hidden = !S.eingang.length; });
  $("#starts").textContent = S.starts === 1 ? "1 Start diese Woche" : `${S.starts} Starts diese Woche`;
}
function chrome(on) {
  $(".side").style.visibility = on ? "" : "hidden";
  $(".tabs").style.display = on ? "" : "none";
}
function logout() { S.token = ""; S.me = null; store.del("token"); store.del("me"); location.hash = "#login"; render(); }

/* ---------- Ansichten ---------- */
function vLogin() {
  chrome(false);
  return `<div class="head"><div class="eyebrow">Bösner Media</div><h1>Fokus<span class="dot">.</span></h1><p class="muted mt">Immer nur der nächste Schritt.</p></div>
  <form id="loginForm" class="stack" style="max-width:420px">
    <div><label for="em">E-Mail</label><input id="em" type="email" autocomplete="username" required></div>
    <div><label for="pw">Passwort</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <button class="btn full mt" type="submit">Anmelden</button>
  </form>`;
}

function vCheckin() {
  const en = energy() || "hoch";
  const greet = hour() < 11 ? "Guten Morgen" : hour() < 17 ? "Hallo" : "Guten Abend";
  const name = S.me?.name ? ", " + S.me.name : "";
  const levels = [["hoch", "Hoch", "Dann zuerst der Frosch: das, wovor du dich drückst."], ["mittel", "Mittel", "Dann Kundenarbeit, die jemand erwartet."], ["niedrig", "Niedrig", "Dann nur Kleines. Auch das zählt als Start."]];
  return `<div class="head"><div class="eyebrow">${esc(new Date().toLocaleDateString("de-DE", { weekday: "long" }))} · ${esc(new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }))}</div>
    <h1>${greet}${esc(name)}<span class="dot">.</span></h1><p class="muted mt" style="font-size:18px">Wie viel Energie hast du heute?</p></div>
  <div class="stack" role="radiogroup" aria-label="Energie heute">${levels.map(([id, l, h]) => `<button class="choice" role="radio" aria-checked="${id === en}" data-energy="${id}"><b>${l}</b><span class="small muted">${h}</span></button>`).join("")}</div>
  ${S.eingang.length ? `<div class="step mt"><div class="eyebrow plain">Neu seit gestern</div><p style="font-size:16px">${S.eingang.length} ${S.eingang.length === 1 ? "Karte wartet" : "Karten warten"} im Eingang.</p></div>` : ""}
  <button class="btn full mt2" data-go-energy>Zum ersten Schritt →</button>`;
}

function vJetzt() {
  const list = ranked(), t = list[0];
  const head = `<div class="skew" aria-hidden="true"></div><div class="head"><div class="eyebrow">${esc(new Date().toLocaleDateString("de-DE", { weekday: "long" }))} · ${phase()}${energy() ? " · Energie " + energy() : ""}</div><h1>Als Nächstes<span class="dot">.</span></h1></div>`;
  if (!S.aufgaben.length) return head + `<div class="card"><h2>Alles erledigt<span class="dot">.</span></h2><p class="muted">Nichts Offenes mehr. Neue Aufgaben kommen über den Eingang oder das Plus.</p><a class="btn" href="#neu">Aufgabe anlegen</a></div>`;
  if (!t) return head + `<div class="card"><h2>Für jetzt reicht's<span class="dot">.</span></h2><p class="muted">Du hast alles für heute weggeschoben. Das ist in Ordnung, morgen ist ein neuer Anfang.</p><button class="btn ghost" data-reset-skip>Doch noch eins</button></div>`;
  const next = list.slice(1, 3);
  return head + `<article class="card">
    <div class="row"><span class="eyebrow plain brand">${esc(label(t))}</span><span class="small muted">${esc(context(t))}</span></div>
    <h2>${esc(title(t))}</h2>
    <div class="step"><span class="eyebrow plain">Erster Schritt · ${minutes(t)} Min</span><p>${t.step ? esc(t.step) : '<span class="muted">Noch kein erster Schritt.</span>'}</p></div>
    ${auftragOf(t) ? `<a class="small" href="#auftrag/${esc(t.auftrag)}">${esc(auftragOf(t).name)}</a>` : ""}
  </article>
  <div class="stack mt">
    <a class="btn big" href="#fokus/${esc(t.id)}">Los <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
    <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap"><button class="link" data-later="${esc(t.id)}">Nicht jetzt</button><a class="link" href="#aufgabe/${esc(t.id)}" style="text-decoration:none">Bearbeiten</a></div>
  </div>
  <div class="foot">
    ${next.length ? `<button class="link" data-more>${S.showMore ? "Weniger zeigen" : `Danach heute noch ${next.length} ${next.length === 1 ? "Ding" : "Dinge"}`}</button>` : `<span class="small muted">Danach ist für heute Schluss.</span>`}
    <span class="small" style="color:var(--m400);font-weight:700">${S.starts} ${S.starts === 1 ? "Start" : "Starts"} diese Woche</span>
  </div>
  ${S.showMore ? `<div class="list">${next.map((n) => `<a class="item" href="#aufgabe/${esc(n.id)}"><div class="top"><span class="t">${esc(n.titel)}</span><span class="small muted">${esc(label(n))}</span></div><span class="small muted">${esc(context(n))}</span></a>`).join("")}</div>` : ""}
  <a class="link mt" href="#neu" style="display:inline-flex;align-items:center;text-decoration:none">+ Neue Aufgabe</a>`;
}

function vFokus(id) {
  const t = S.aufgaben.find((x) => x.id === id);
  if (!t) return `<p class="muted">Diese Aufgabe gibt es nicht mehr.</p><a class="btn mt" href="#jetzt">Zurück</a>`;
  return `<div class="head" style="display:flex;justify-content:space-between;align-items:center"><a href="#jetzt" aria-label="Zurück" class="link" style="display:flex;align-items:center"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></a><span class="eyebrow plain">Nur der erste Schritt</span></div>
  <div class="stack"><span class="small muted">${esc(t.titel)}${context(t) ? " · " + esc(context(t)) : ""}</span><h2>${t.step ? esc(t.step) : esc(t.titel)}</h2></div>
  <div class="stack mt2" style="align-items:stretch"><div class="clock" id="clock" aria-live="polite">${minutes(t)}:00</div><div class="bar"><i id="barfill" style="width:0%"></i></div>
  <p class="small muted" style="text-align:center">Nach ${minutes(t)} Minuten darfst du aufhören. Meistens willst du dann nicht mehr.</p></div>
  <form id="stepForm" class="mt" hidden><label for="nextStep">Was ist der nächste kleine Schritt?</label><input id="nextStep" placeholder="z. B. Absatz zwei schreiben"><button class="btn full mt" type="submit">Speichern</button></form>
  <div class="stack mt2" id="fokusBtns">
    <button class="btn full" data-stepdone="${esc(t.id)}">Schritt geschafft</button>
    <div class="two"><button class="btn ghost" data-pause>Pause</button><button class="btn ghost" data-done="${esc(t.id)}">Erledigt</button></div>
  </div>`;
}

function inboxCard(c) {
  return `<span class="src">${esc(c.quelle || "Eingang")}</span><h3>${esc(c.titel)}</h3>${c.text ? `<p>${esc(c.text)}</p>` : ""}
  <div class="sug"><span class="small" style="color:#3d4f6e;font-weight:700;letter-spacing:1.7px">VORSCHLAG</span><p style="color:var(--n900);font-weight:700">${esc(c.vorschlag || (c.typ === "info" ? "Nur zur Info." : "Übernehmen?"))}</p></div>`;
}
function vEingang() {
  const c = S.eingang[0], n = S.eingang.length;
  const head = `<div class="head"><div class="eyebrow">${n ? `${n} offen` : "Leer"}</div><h1>Eingang<span class="dot">.</span></h1><p class="muted mt">Claude sortiert. Du entscheidest nur.</p></div>`;
  if (!c) return head + `<div class="card"><h2>Alles entschieden<span class="dot">.</span></h2><p class="muted">Neues aus Mails, Frame.io und MeisterTask landet hier, sobald Claude es erkannt hat.</p><a class="btn" href="#jetzt">Zurück zu Jetzt</a></div>`;
  return head + `<div class="inbox"><div class="layer" style="inset:24px 16px -16px;opacity:.5"></div><div class="layer" style="inset:12px 8px -8px;opacity:.8"></div><article id="swipe" data-id="${esc(c.id)}">${inboxCard(c)}</article></div>
  <div class="two mt2"><button class="btn ghost" data-inbox="drop" data-id="${esc(c.id)}">✕ Weg</button><button class="btn" data-inbox="take" data-id="${esc(c.id)}">✓ Übernehmen</button></div>
  <p class="small muted mt" style="text-align:center">Oder wischen: rechts übernehmen, links weg.</p>`;
}
function vAside() {
  const cards = S.eingang.slice(0, 4);
  return `<div style="display:flex;justify-content:space-between;align-items:center"><h3>Eingang<span class="dot">.</span></h3><span class="eyebrow plain">${S.eingang.length} offen</span></div>
  ${cards.length ? cards.map((c) => `<div class="mini"><span class="eyebrow plain brand">${esc(c.quelle || "Eingang")}</span><b style="font-size:15px;line-height:22px">${esc(c.titel)}</b><span class="small muted">${esc(c.vorschlag || "")}</span>
  <div class="two"><button class="btn ghost" data-inbox="drop" data-id="${esc(c.id)}">Weg</button><button class="btn" data-inbox="take" data-id="${esc(c.id)}">Übernehmen</button></div></div>`).join("") : `<p class="small muted">Alles entschieden. Neues kommt erst, wenn es dran ist.</p>`}`;
}

const PHASES_H = ["Idee", "Geplant", "In Arbeit", "Fertig"];
const phasesOf = (a) => (a.typ === "hintergrund" ? PHASES_H : PHASES);
const phaseName = (a) => (a.storniert ? "Storniert" : phasesOf(a)[a.phase || 0]);
function phaseBar(a) { const ph = phasesOf(a); return `<div class="phases" style="grid-template-columns:repeat(${ph.length},minmax(0,1fr))" role="img" aria-label="${esc(phaseName(a))}">${ph.map((_, i) => `<i class="${i < (a.phase || 0) ? "done" : i === (a.phase || 0) ? "now" : ""}"></i>`).join("")}</div>`; }
function orderRow(a) {
  const open = S.aufgaben.filter((t) => t.auftrag === a.id);
  const next = open.sort((x, y) => score(y) - score(x))[0];
  return `<a class="item" href="#auftrag/${esc(a.id)}"><div class="top"><span class="t">${esc(a.name)}</span><span class="eyebrow plain">${esc(a.typ === "hintergrund" ? "" : a.kunde || "")}</span></div>${phaseBar(a)}
  <span class="small muted">${esc(phaseName(a))}${next ? ` · <span style="color:#fff">${esc(next.step || next.titel)}</span>` : a.wartet ? " · wartet auf " + esc(a.wartet) : a.ruht ? " · ruht" : ""}</span></a>`;
}
const RHYTHMUS = { taeglich: "täglich (Mo–Fr)", woechentlich: "wöchentlich", monatlich: "monatlich" };
const WTAG = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
function routineWhen(r) {
  if (r.rhythmus === "woechentlich") return WTAG[r.wochentag || 1];
  if (r.rhythmus === "monatlich") return r.monatsregel === "erster_montag" ? "1. Montag" : r.monatsregel === "letzte_woche" ? "letzte Woche" : `am ${r.monatstag}.`;
  return "morgens";
}
function vAuftraege(view) {
  const tab = view || "aktiv";
  const all = S.auftraege.filter((a) => a.typ !== "hintergrund" && !a.storniert);
  const working = all.filter((a) => (a.phase || 0) <= 3);
  const hasTask = (a) => S.aufgaben.some((t) => t.auftrag === a.id);
  // Aufgeräumt: höchstens 4 aktive Aufträge zeigen, sortiert nach ihrer dringendsten Aufgabe.
  const best = (a) => Math.max(...S.aufgaben.filter((t) => t.auftrag === a.id).map(score), -99);
  const active = working.filter((a) => !a.ruht && hasTask(a)).sort((x, y) => best(y) - best(x)).slice(0, 4);
  const resting = working.filter((a) => !active.includes(a));
  const isTeil = (r) => /teilrechnung|abschlag/i.test(r.titel || "");
  const billed = new Set(S.rechnungen.filter((r) => r.auftrag && !isTeil(r)).map((r) => r.auftrag));
  const fertig = all.filter((a) => a.phase === 4 && !a.ruht && !billed.has(a.id));
  const offene = S.rechnungen.filter((r) => r.status === "offen");
  const summe = offene.reduce((x, r) => x + (r.offen || 0), 0);
  const alt = offene.filter((r) => (days(r.datum) ?? 0) <= -30);
  const stand = S.rechnungen.map((r) => r.abgeglichen).sort().pop();
  const bg = S.auftraege.filter((a) => a.typ === "hintergrund" && !a.archiv).sort((a, b) => (b.phase === 2) - (a.phase === 2) || (b.phase || 0) - (a.phase || 0));
  let body = "", title = "Projekte", eyebrow = `${active.length} im Fokus · ${resting.length} warten`;
  if (tab === "aktiv") {
    body = `${fertig.length ? `<button class="money mt" data-tab="fertig"><span class="num">${fertig.length}</span><span style="flex:1"><b>Fertig, aber noch keine Rechnung.</b><br><span class="small">Antippen für die Liste.</span></span><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>` : ""}
    ${offene.length ? `<button class="money mt" data-tab="rechnungen" style="background:var(--n800)"><span class="num">${offene.length}</span><span style="flex:1"><b>Rechnungen offen · ${euro(summe)}</b><br><span class="small">${alt.length ? `${alt.length} davon seit über 30 Tagen` : "Keine älter als 30 Tage"}${stand ? " · Stand Lexware " + new Date(stand).toLocaleDateString("de-DE") : ""}</span></span><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>` : ""}
    <div class="list mt">${active.map(orderRow).join("") || '<p class="muted">Gerade nichts Aktives.</p>'}</div>
    ${resting.length ? `<button class="link mt" data-more>${S.showMore ? "Weitere ausblenden" : `${resting.length} weitere Aufträge zeigen`}</button>` : ""}
    ${S.showMore ? `<div class="list" style="opacity:.7">${resting.map(orderRow).join("")}</div>` : ""}`;
  } else if (tab === "hintergrund") {
    const focus = bg.filter((a) => a.phase === 2), rest = bg.filter((a) => a.phase !== 2);
    eyebrow = `${focus.length} in Arbeit · ${rest.length} geplant oder Idee`;
    body = `<p class="small muted">Projekte, mit denen du das Unternehmen weiterentwickelst.</p><div class="list mt">${focus.map(orderRow).join("") || '<p class="muted">Gerade nichts in Arbeit.</p>'}</div>
    ${rest.length ? `<button class="link mt" data-more>${S.showMore ? "Weniger zeigen" : `${rest.length} Ideen und geplante zeigen`}</button>` : ""}
    ${S.showMore ? `<div class="list" style="opacity:.7">${rest.map(orderRow).join("")}</div>` : ""}`;
  } else if (tab === "routinen") {
    const rs = S.routinen;
    const perWeek = rs.filter((r) => r.aktiv).reduce((x, r) => x + (r.dauer || 0) * (r.rhythmus === "taeglich" ? 5 : r.rhythmus === "woechentlich" ? 1 : 1 / 4.3), 0);
    eyebrow = `${rs.filter((r) => r.aktiv).length} aktiv · ca. ${perWeek.toFixed(1).replace(".", ",")} Std. pro Woche`;
    body = `<p class="small muted">Wiederkehrende Aufgaben. Sie tauchen am Tag ihrer Fälligkeit in „Jetzt“ auf.</p>
    <div class="list mt">${rs.map((r) => `<div class="check"><input type="checkbox" aria-label="Aktiv" data-routine="${esc(r.id)}" ${r.aktiv ? "checked" : ""}><span style="flex:1"><b>${esc(r.titel)}</b><br><span class="small muted">${esc(RHYTHMUS[r.rhythmus] || "")} · ${esc(routineWhen(r))} · ${String(r.dauer || 0).replace(".", ",")} Std.</span></span></div>`).join("") || '<p class="muted">Noch keine Routinen.</p>'}</div>
    <form id="routineForm" class="mt2"><h3>Neue Routine</h3>
      <label for="rTitel">Was?</label><input id="rTitel" required>
      <div class="two"><div><label for="rRh">Rhythmus</label><select id="rRh"><option value="taeglich">täglich (Mo–Fr)</option><option value="woechentlich" selected>wöchentlich</option><option value="monatlich">monatlich</option></select></div>
      <div><label for="rWt">Wochentag / Monatstag</label><select id="rWt">${WTAG.slice(1, 6).map((w, i) => `<option value="${i + 1}">${w}</option>`).join("")}<option value="m1">1. Montag im Monat</option><option value="mL">letzte Woche im Monat</option></select></div></div>
      <div class="two"><div><label for="rDauer">Dauer (Std.)</label><input id="rDauer" type="number" step="0.25" min="0.25" value="0.5"></div><div><label for="rStep">Erster Schritt</label><input id="rStep"></div></div>
      <button class="btn full mt" type="submit">Routine anlegen</button></form>`;
  } else if (tab === "rechnungen") {
    title = "Rechnungen";
    body = `<button class="link" data-tab="aktiv">← Zurück</button><h2 class="mt">Offene Rechnungen<span class="dot">.</span></h2>
    <p class="small muted">Aus Lexware${stand ? ", Stand " + new Date(stand).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : ""}. Nach 30 Tagen ohne Zahlung legt die App eine Aufgabe an.</p>
    <div class="list mt">${offene.map((r) => { const age = -(days(r.datum) ?? 0); const a = S.auftraege.find((x) => x.id === r.auftrag);
      return `<a class="item" href="${a ? `#auftrag/${esc(a.id)}` : "#auftraege/rechnungen"}"><div class="top"><span class="t">${esc(r.nr)} · ${esc(r.kunde || "")}</span><span style="white-space:nowrap;font-weight:700">${euro(r.offen)}</span></div>
      <span class="small ${age >= 30 ? "" : "muted"}" ${age >= 30 ? 'style="color:var(--m400)"' : ""}>vom ${esc(new Date(r.datum).toLocaleDateString("de-DE"))} · seit ${age} ${age === 1 ? "Tag" : "Tagen"} offen${a ? " · " + esc(a.name) : ""}</span>${r.hinweis ? `<span class="small muted">${esc(r.hinweis)}</span>` : ""}</a>`; }).join("") || '<p class="muted">Keine offenen Rechnungen.</p>'}</div>`;
  } else {
    title = "Abrechnen";
    body = `<button class="link" data-tab="aktiv">← Zurück</button><h2 class="mt">Fertig, noch keine Rechnung<span class="dot">.</span></h2>
    <p class="small muted">Rechnung in Lexware stellen. Beim nächsten Abgleich wandert der Auftrag automatisch auf „Rechnung“.</p><div class="list mt">${fertig.map(orderRow).join("") || '<p class="muted">Alles abgerechnet.</p>'}</div>`;
  }
  const tabs = ["aktiv", "hintergrund", "routinen"].includes(tab);
  return `<div class="head"><div class="eyebrow">${eyebrow}</div><h1>${title}<span class="dot">.</span></h1></div>
  ${tabs ? `<div class="tabsw" role="tablist"><button role="tab" aria-selected="${tab === "aktiv"}" data-tab="aktiv">Kunden</button><button role="tab" aria-selected="${tab === "hintergrund"}" data-tab="hintergrund">Hintergrund</button><button role="tab" aria-selected="${tab === "routinen"}" data-tab="routinen">Routinen</button></div>` : ""}
  ${body}
  ${tab === "routinen" ? "" : `<div class="two mt2"><a class="btn ghost" href="#neuer-auftrag${tab === "hintergrund" ? "?typ=hintergrund" : ""}">+ Projekt</a><a class="btn ghost" href="#neu${tab === "hintergrund" ? "?art=bm" : ""}">+ Aufgabe</a></div>`}`;
}

function vAuftrag(id, params) {
  const isNew = !id;
  const a = isNew ? { typ: params?.get("typ") === "hintergrund" ? "hintergrund" : "kunde", name: "", kunde: "", nr: "", phase: 0, bestellnr: "", due: "", notiz: "", stand: "", wartet: "", ziel: "", volumen: 0 } : S.auftraege.find((x) => x.id === id);
  if (!a) return `<p class="muted">Projekt nicht gefunden.</p><a class="btn mt" href="#auftraege">Zurück</a>`;
  const k = a.typ !== "hintergrund";
  const tasks = isNew ? [] : S.aufgaben.filter((t) => t.auftrag === a.id);
  const ph = phasesOf(a);
  return `<button class="link" data-back>← Zurück</button>
  <div class="head mt"><div class="eyebrow">${k ? esc(a.kunde || "Kundenauftrag") : "Hintergrundprojekt"}${a.nr ? " · " + esc(a.nr) : ""}${a.storniert ? " · storniert" : ""}</div><h1>${esc(a.name || (k ? "Neuer Auftrag" : "Neues Projekt"))}<span class="dot">.</span></h1></div>
  ${isNew ? "" : `<div class="seg" role="group" aria-label="Phase">${ph.map((p, i) => `<button data-phase="${i}" aria-pressed="${i === (a.phase || 0) && !a.storniert}">${p}</button>`).join("")}</div>
  ${a.stand ? `<div class="step mt"><span class="eyebrow plain">Stand</span><p style="font-size:16px;line-height:26px">${esc(a.stand)}</p>${a.wartet ? `<span class="small muted">Wartet auf: ${esc(a.wartet)}</span>` : ""}</div>` : ""}
  <h3 class="mt2">Aufgaben</h3><div class="list">${tasks.map((t) => `<div class="check"><input type="checkbox" aria-label="Erledigt" data-check="${esc(t.id)}"><a href="#aufgabe/${esc(t.id)}">${esc(t.titel)}<br><span class="small muted">→ ${esc(t.step || "erster Schritt fehlt")}${t.quelle === "prozess" ? " · aus Prozess" : ""}</span></a></div>`).join("") || '<p class="small muted">Keine offene Aufgabe.</p>'}</div>
  <a class="link" href="#neu?auftrag=${esc(a.id)}" style="text-decoration:none;display:inline-flex;align-items:center">+ Aufgabe zu diesem Projekt</a>`}
  <form id="orderForm" class="mt2" data-typ="${esc(a.typ || "kunde")}">
    <label for="oName">Name</label><input id="oName" value="${esc(a.name)}" required>
    ${k ? `<div class="two"><div><label for="oKunde">Kunde</label><input id="oKunde" value="${esc(a.kunde)}"></div><div><label for="oNr">Auftragsnummer</label><input id="oNr" value="${esc(a.nr)}"></div></div>
    <div class="two"><div><label for="oBest">Bestellnummer</label><input id="oBest" value="${esc(a.bestellnr)}"></div><div><label for="oVol">Volumen netto (€)</label><input id="oVol" type="number" step="1" value="${esc(a.volumen || "")}"></div></div>` : `<label for="oZiel">Warum (Ziel)</label><input id="oZiel" value="${esc(a.ziel)}">`}
    <div class="two"><div><label for="oDue">Deadline</label><input id="oDue" type="date" value="${esc(a.due)}"></div><div><label for="oWartet">Wartet auf</label><input id="oWartet" value="${esc(a.wartet)}"></div></div>
    <label for="oStand">Stand</label><textarea id="oStand">${esc(a.stand)}</textarea>
    <label for="oNotiz">Notiz</label><textarea id="oNotiz">${esc(a.notiz)}</textarea>
    ${a.mt ? `<p class="small mt"><a href="https://www.meistertask.com/app/task/${encodeURIComponent(a.mt)}" target="_blank" rel="noopener">In MeisterTask öffnen</a></p>` : ""}
    <button class="btn full mt" type="submit">${isNew ? "Anlegen" : "Speichern"}</button>
  </form>
  ${isNew ? "" : `<div class="foot"><button class="link" data-ruht>${a.ruht ? "Wieder aktiv setzen" : "Ruhen lassen"}</button>${k ? `<button class="link" data-storno>${a.storniert ? "Storno aufheben" : "Stornieren"}</button>` : ""}<button class="link" data-archiv>Archivieren</button></div>`}`;
}

/* ---------- Zahlen: Dashboard ---------- */
const HOURS = { S: 1, M: 4, L: 12 };
const taskHours = (t) => t.stunden || HOURS[t.s] || 4;
function weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function vZahlen() {
  const K = S.kennzahlen || {};
  const ziel = K.umsatzziel || 120000, kmin = K.kapazitaet_min || 40, kmax = K.kapazitaet_max || 60;
  const U = K.umsatz || {};
  const netto = U.netto || 0, pct = Math.min(100, Math.round(netto / ziel * 100));
  const offen = S.rechnungen.filter((r) => r.status === "offen"), offenSum = offen.reduce((x, r) => x + (r.offen || 0), 0);
  const kunden = S.auftraege.filter((a) => a.typ !== "hintergrund" && !a.storniert && !a.archiv);
  const isTeil = (r) => /teilrechnung|abschlag/i.test(r.titel || "");
  const billed = new Set(S.rechnungen.filter((r) => r.auftrag && !isTeil(r)).map((r) => r.auftrag));
  const fertig = kunden.filter((a) => a.phase === 4 && !a.ruht && !billed.has(a.id));
  const angebote = kunden.filter((a) => a.phase === 1), anfragen = kunden.filter((a) => a.phase === 0);
  const pipe = angebote.reduce((x, a) => x + (a.volumen || 0), 0), ohneBetrag = angebote.filter((a) => !a.volumen).length;
  // Workload: vier Wochen ab dieser Woche
  const w0 = weekStart(new Date());
  const routH = S.routinen.filter((r) => r.aktiv).reduce((x, r) => x + (r.dauer || 0) * (r.rhythmus === "taeglich" ? 5 : r.rhythmus === "woechentlich" ? 1 : 1 / 4.3), 0);
  const weeks = [0, 1, 2, 3].map((i) => {
    const a = new Date(w0); a.setDate(a.getDate() + i * 7); const b = new Date(a); b.setDate(b.getDate() + 7);
    const inW = (d) => d && new Date(d + "T12:00:00") >= a && new Date(d + "T12:00:00") < b;
    const termine = (K.kalender || []).filter((e) => inW(e.datum)).reduce((x, e) => x + (e.stunden || 0), 0);
    const aufg = S.aufgaben.filter((t) => t.quelle !== "routine" && inW(t.due || "")).reduce((x, t) => x + taskHours(t), 0);
    return { label: i === 0 ? "Diese Woche" : i === 1 ? "Nächste Woche" : `KW ${kw(a)}`, termine, aufg, rout: routH, sum: termine + aufg + routH };
  });
  const backlog = S.aufgaben.filter((t) => t.quelle !== "routine" && !t.due).reduce((x, t) => x + taskHours(t), 0);
  const scale = Math.max(kmax * 1.15, ...weeks.map((w) => w.sum));
  const bar = (w) => `<div class="wl"><div class="wl-top"><span>${esc(w.label)}</span><b>${Math.round(w.sum)} Std.</b></div>
    <div class="wl-bar"><i class="t" style="width:${w.termine / scale * 100}%"></i><i class="a" style="width:${w.aufg / scale * 100}%"></i><i class="r" style="width:${w.rout / scale * 100}%"></i><span class="band" style="left:${kmin / scale * 100}%;width:${(kmax - kmin) / scale * 100}%"></span></div></div>`;
  const kEntries = Object.entries(U.kunden || {}), kSum = kEntries.reduce((x, [, v]) => x + v, 0);
  const mEntries = Object.entries(U.monate || {}), mMax = Math.max(1, ...mEntries.map(([, v]) => v));
  const monate = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const stand = K.stand ? new Date(K.stand).toLocaleDateString("de-DE") : "–";
  return `<div class="head"><div class="eyebrow">Stand ${esc(stand)}</div><h1>Zahlen<span class="dot">.</span></h1></div>
  <section class="kpis">
    <div class="kpi big"><span class="eyebrow plain">Umsatz ${esc(U.jahr || "")} (netto)</span><div class="num">${euro(netto)}</div>
      <div class="bar" style="margin-top:12px"><i style="width:${pct}%"></i></div>
      <span class="small muted">${pct} % vom Ziel ${euro(ziel)} · dafür ${euro(ziel / 12)} pro Monat</span></div>
    <a class="kpi" href="#auftraege/rechnungen"><span class="eyebrow plain">Offene Posten</span><div class="num">${euro(offenSum)}</div><span class="small muted">${offen.length} Rechnungen</span></a>
    <a class="kpi" href="#auftraege/fertig"><span class="eyebrow plain">Fertig, ohne Rechnung</span><div class="num">${fertig.length}</div><span class="small muted">${fertig.map((a) => esc(a.name)).slice(0, 2).join(", ") || "alles abgerechnet"}</span></a>
    <div class="kpi"><span class="eyebrow plain">Angebots-Pipeline</span><div class="num">${angebote.length}</div><span class="small muted">${pipe ? euro(pipe) + " netto" : ""}${ohneBetrag ? `${pipe ? " · " : ""}${ohneBetrag} ohne Betrag` : ""} · ${anfragen.length} Anfragen</span></div>
  </section>
  <h2 class="mt2">Auslastung<span class="dot">.</span></h2>
  <p class="small muted">Termine aus dem Kalender, fällige Aufgaben und Routinen, gemessen an deiner Kapazität von ${kmin}–${kmax} Std. (helles Band).</p>
  <div class="mt">${weeks.map(bar).join("")}</div>
  <p class="small muted mt"><i class="lg t"></i> Termine <i class="lg a"></i> Aufgaben mit Termin <i class="lg r"></i> Routinen · Dazu ${Math.round(backlog)} Std. offene Aufgaben ohne Termin, das sind etwa ${(backlog / ((kmin + kmax) / 2)).toFixed(1).replace(".", ",")} Wochen.</p>
  <h2 class="mt2">Umsatz nach Monat<span class="dot">.</span></h2>
  <div class="months mt">${monate.map((m, i) => { const key = `${U.jahr}-${String(i + 1).padStart(2, "0")}`; const v = (U.monate || {})[key] || 0; return `<div class="mo"><div class="mo-col"><i style="height:${v / mMax * 100}%"></i></div><span>${m}</span></div>`; }).join("")}</div>
  <p class="small muted mt">${esc(U.monate_quelle || "")}</p>
  <h2 class="mt2">Kundenmix<span class="dot">.</span></h2>
  <div class="list mt">${kEntries.map(([name, v]) => `<div class="mix"><div class="top"><span>${esc(name)}</span><b>${Math.round(v / kSum * 100)} %</b></div><div class="bar"><i style="width:${v / kSum * 100}%"></i></div></div>`).join("") || '<p class="muted">Noch keine Daten.</p>'}</div>
  <p class="small muted mt">${esc(U.kunden_quelle || "")}${kEntries.length && kEntries[0][1] / kSum > 0.6 ? ` · ${esc(kEntries[0][0])} macht über 60 % aus: hier liegt dein größtes Abhängigkeitsrisiko.` : ""}</p>
  <details class="mt2"><summary class="link">Ziel und Kapazität ändern</summary>
    <form id="kpiForm" class="mt"><div class="two"><div><label for="kZiel">Umsatzziel (€)</label><input id="kZiel" type="number" value="${ziel}"></div><div><label for="kMin">Kapazität min / max (Std.)</label><div class="two"><input id="kMin" type="number" value="${kmin}"><input id="kMax" type="number" value="${kmax}"></div></div></div><button class="btn full mt" type="submit">Speichern</button></form>
  </details>`;
}
function kw(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); }

function vAufgabe(id, params) {
  const isNew = !id;
  const t = isNew ? { titel: "", art: params.get("art") || (params.get("auftrag") ? "kunde" : "bm"), auftrag: params.get("auftrag") || "", w: 1, v: 2, s: "M", r: 1, step: "", due: "", notiz: "" } : S.aufgaben.find((x) => x.id === id);
  if (!t) return `<p class="muted">Aufgabe nicht gefunden.</p><a class="btn mt" href="#jetzt">Zurück</a>`;
  S.form = { w: t.w || 0, v: t.v || 0, s: t.s || "M", r: t.r || 0, art: t.art || "bm" };
  const seg = (f, vals, lbl) => `<label>${lbl}</label><div class="seg" data-f="${f}">${vals.map((v) => `<button type="button" data-v="${v}" aria-pressed="${String(S.form[f]) === String(v)}">${v}</button>`).join("")}</div>`;
  const orders = S.auftraege.filter((a) => (a.phase || 0) <= 5);
  return `<button class="link" data-back>← Zurück</button>
  <div class="head mt"><div class="eyebrow">${isNew ? "Neu" : "Aufgabe"}</div><h1>${isNew ? "Neue Aufgabe" : esc(t.titel)}<span class="dot">.</span></h1></div>
  <form id="taskForm">
    <label for="tTitel">Was ist zu tun?</label><input id="tTitel" value="${esc(t.titel)}" required>
    <label for="tStep">Erster Schritt (höchstens 15 Minuten)</label><input id="tStep" value="${esc(t.step)}" placeholder="So konkret, dass du ohne Nachdenken anfangen kannst">
    <label>Art</label><div class="seg" data-f="art"><button type="button" data-v="kunde" aria-pressed="${S.form.art === "kunde"}">Auftrag</button><button type="button" data-v="bm" aria-pressed="${S.form.art === "bm"}">Hinter den Kulissen</button></div>
    <label for="tAuftrag">Gehört zu Auftrag</label><select id="tAuftrag"><option value="">Kein Auftrag</option>${orders.map((a) => `<option value="${esc(a.id)}" ${a.id === t.auftrag ? "selected" : ""}>${esc(a.name)}${a.kunde ? " · " + esc(a.kunde) : ""}</option>`).join("")}</select>
    ${seg("w", [0, 1, 2, 3], "Wer wartet? (0 niemand, 3 Kunde wartet)")}
    ${seg("v", [0, 1, 2, 3], "Was bringt es? (0 kaum, 3 Umsatz oder großer Schritt)")}
    ${seg("s", ["S", "M", "L"], "Wie groß? (S unter 1 Std., M halber Tag, L mehrere Tage)")}
    ${seg("r", [0, 1, 2, 3], "Wie sehr sträubst du dich?")}
    <label for="tDue">Fällig am</label><input id="tDue" type="date" value="${esc(t.due)}">
    <label for="tNotiz">Notiz</label><textarea id="tNotiz">${esc(t.notiz)}</textarea>
    <button class="btn full mt" type="submit">${isNew ? "Anlegen" : "Speichern"}</button>
  </form>
  ${isNew ? "" : `<div class="foot"><button class="link" data-done="${esc(t.id)}">Erledigt</button><button class="link" data-strike="${esc(t.id)}">Streichen</button></div>`}`;
}

/* ---------- Render ---------- */
function route() {
  const h = location.hash.slice(1) || "";
  const [pathPart, query = ""] = h.split("?");
  const [name, arg] = pathPart.split("/");
  return { name: name || "", arg: arg || "", params: new URLSearchParams(query) };
}
async function render() {
  clearInterval(S.timer);
  const main = $("#main"), r = route();
  $("#app").classList.remove("with-aside");
  if (!S.token) { main.innerHTML = vLogin(); bindLogin(); return; }
  chrome(true);
  if (!S.loaded) {
    main.innerHTML = '<p class="muted">Lädt …</p>';
    try { await load(); } catch (e) { main.innerHTML = `<p class="muted">${esc(e.message)}</p><button class="btn mt" onclick="location.reload()">Neu laden</button>`; return; }
  }
  let name = r.name;
  if (!name || name === "login") name = !energy() && hour() < 14 ? "checkin" : "jetzt";
  const views = {
    checkin: () => vCheckin(), jetzt: () => vJetzt(), fokus: () => vFokus(r.arg), eingang: () => vEingang(),
    auftraege: () => vAuftraege(r.arg), auftrag: () => vAuftrag(r.arg), "neuer-auftrag": () => vAuftrag("", r.params), zahlen: () => vZahlen(),
    aufgabe: () => vAufgabe(r.arg, r.params), neu: () => vAufgabe("", r.params),
  };
  main.innerHTML = (views[name] || views.jetzt)();
  setNav(name === "auftrag" || name === "neuer-auftrag" ? "auftraege" : name === "fokus" || name === "aufgabe" || name === "neu" ? "jetzt" : name);
  if (name === "jetzt") { $("#app").classList.add("with-aside"); $("#aside").innerHTML = vAside(); }
  if (name === "fokus") startClock(r.arg);
  if (name === "eingang") bindSwipe();
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ---------- Aktionen ---------- */
function bindLogin() {
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const res = await api("/api/collections/users/auth-with-password", { method: "POST", body: { identity: $("#em").value.trim(), password: $("#pw").value } });
      S.token = res.token; S.me = res.record; store.set("token", S.token); store.set("me", S.me);
      location.hash = ""; S.loaded = false; render();
    } catch (err) { toast("Anmeldung fehlgeschlagen. Bitte prüfen."); }
  });
}

function startClock(id) {
  const t = S.aufgaben.find((x) => x.id === id); if (!t) return;
  const total = minutes(t) * 60; let left = total, running = true;
  if (!S.started?.has(id)) {
    (S.started ||= new Set()).add(id);
    update("aufgaben", id, { "starts+": 1 }).then((rec) => patchLocal("aufgaben", rec)).catch(() => {});
    logEvent("start", id); S.starts++;
  }
  const show = () => {
    const c = $("#clock"), b = $("#barfill"); if (!c) return clearInterval(S.timer);
    c.textContent = left > 0 ? `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}` : "Geschafft";
    b.style.width = Math.round((total - left) / total * 100) + "%";
  };
  show();
  S.timer = setInterval(() => { if (running && left > 0) { left--; show(); if (left === 0) { $("#stepForm").hidden = false; } } }, 1000);
  S.pause = () => { running = !running; const p = $("[data-pause]"); if (p) p.textContent = running ? "Pause" : "Weiter"; };
}

async function doneTask(id) {
  try { const rec = await update("aufgaben", id, { status: "erledigt" }); S.aufgaben = S.aufgaben.filter((t) => t.id !== id); logEvent("erledigt", id); toast("Erledigt. Stark."); return rec; } catch (e) { toast(e.message); }
}

function laterSheet(t) {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="lsH"><h3 id="lsH">Schon ${t.post}× verschoben<span class="dot">.</span></h3><p class="muted">Weiterschieben hilft nicht. Was machen wir damit?</p>
  <button class="btn" data-ls="small">Kleiner machen</button><button class="btn ghost" data-ls="drop">Bewusst streichen</button><button class="btn ghost" data-ls="anyway">Trotzdem verschieben</button><button class="link" data-ls="close">Abbrechen</button></div>`;
  document.body.appendChild(ov);
  ov.querySelector("[data-ls=small]").focus();
  ov.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ls]"); if (!b && e.target !== ov) return;
    const k = b ? b.dataset.ls : "close"; ov.remove();
    if (k === "small") location.hash = `#aufgabe/${t.id}`;
    if (k === "drop") { await update("aufgaben", t.id, { status: "gestrichen" }); S.aufgaben = S.aufgaben.filter((x) => x.id !== t.id); render(); }
    if (k === "anyway") { const rec = await update("aufgaben", t.id, { "post+": 1 }); patchLocal("aufgaben", rec); S.skip.add(t.id); logEvent("spaeter", t.id); render(); }
  });
}

async function inbox(id, take) {
  const c = S.eingang.find((x) => x.id === id); if (!c) return;
  try {
    if (take && c.typ !== "info") {
      const d = c.daten || {};
      let auftrag = d.auftrag_id || "";
      if (!auftrag && d.auftrag_nr) auftrag = S.auftraege.find((a) => a.nr === d.auftrag_nr)?.id || "";
      if (c.typ === "auftrag") {
        const a = await create("auftraege", { name: d.name || c.titel, kunde: d.kunde || "", nr: d.nr || "", phase: d.phase || 0, due: d.due || "", notiz: d.notiz || c.text || "", gmail: d.gmail || "", archiv: false, ruht: false });
        S.auftraege.unshift(a); auftrag = a.id;
      }
      const tk = d.aufgabe || (c.typ === "aufgabe" ? d : null);
      if (tk) {
        const rec = await create("aufgaben", { titel: tk.titel || c.titel, art: tk.art || (auftrag ? "kunde" : "bm"), auftrag, w: tk.w ?? 2, v: tk.v ?? 2, s: tk.s || "S", r: tk.r ?? 1, step: tk.step || "", due: tk.due || "", notiz: tk.notiz || "", src: c.src || "", status: "offen", post: 0, starts: 0 });
        S.aufgaben.unshift(rec);
      }
    }
    await update("eingang", id, { status: take ? "uebernommen" : "verworfen" });
    S.eingang = S.eingang.filter((x) => x.id !== id);
    toast(take ? "Übernommen." : "Weg damit.");
    render();
  } catch (e) { toast(e.message); }
}

function bindSwipe() {
  const el = $("#swipe"); if (!el) return;
  let x0 = null, dx = 0;
  el.addEventListener("pointerdown", (e) => { x0 = e.clientX; el.style.transition = "none"; el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointermove", (e) => { if (x0 === null) return; dx = e.clientX - x0; el.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`; });
  const end = () => {
    if (x0 === null) return; el.style.transition = "";
    if (Math.abs(dx) > 110) { el.style.transform = `translateX(${dx > 0 ? 600 : -600}px)`; const id = el.dataset.id, take = dx > 0; setTimeout(() => inbox(id, take), 180); }
    else el.style.transform = "";
    x0 = null; dx = 0;
  };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button, [data-energy]"); if (!b) return;
  const d = b.dataset;
  if (d.energy) { $$("[data-energy]").forEach((x) => x.setAttribute("aria-checked", String(x === b))); store.set("energy", { day: todayKey(), level: d.energy }); return; }
  if ("goEnergy" in d) { if (!energy()) store.set("energy", { day: todayKey(), level: "hoch" }); logEvent("checkin", "", energy()); location.hash = "#jetzt"; return; }
  if ("more" in d) { S.showMore = !S.showMore; render(); return; }
  if ("resetSkip" in d) { S.skip.clear(); render(); return; }
  if (d.tab) { S.showMore = false; location.hash = d.tab === "aktiv" ? "#auftraege" : `#auftraege/${d.tab}`; return; }
  if ("back" in d) { history.length > 1 ? history.back() : (location.hash = "#jetzt"); return; }
  if ("pause" in d) { S.pause && S.pause(); return; }
  if (d.later) {
    const t = S.aufgaben.find((x) => x.id === d.later); if (!t) return;
    if ((t.post || 0) >= 2) return laterSheet(t);
    try { const rec = await update("aufgaben", t.id, { "post+": 1 }); patchLocal("aufgaben", rec); } catch {}
    S.skip.add(t.id); logEvent("spaeter", t.id); render(); return;
  }
  if (d.stepdone) { const f = $("#stepForm"); f.hidden = false; $("#nextStep").focus(); return; }
  if (d.done) { await doneTask(d.done); location.hash = "#jetzt"; render(); return; }
  if (d.strike) { await update("aufgaben", d.strike, { status: "gestrichen" }); S.aufgaben = S.aufgaben.filter((t) => t.id !== d.strike); location.hash = "#jetzt"; return; }
  if (d.inbox) { inbox(d.id, d.inbox === "take"); return; }
  if (d.phase !== undefined && route().name === "auftrag") {
    const rec = await update("auftraege", route().arg, { phase: +d.phase, storniert: false }); patchLocal("auftraege", rec); toast(`Phase: ${phasesOf(rec)[+d.phase]}`);
    if (rec.typ !== "hintergrund") { try { S.aufgaben = await listAll("aufgaben", "status = 'offen'", "-updated"); } catch {} }
    if (rec.typ !== "hintergrund" && +d.phase === 6) { await update("auftraege", rec.id, { archiv: true }); S.auftraege = S.auftraege.filter((a) => a.id !== rec.id); toast("Bezahlt und archiviert."); location.hash = "#auftraege"; return; }
    render(); return;
  }
  if ("ruht" in d) { const a = S.auftraege.find((x) => x.id === route().arg); const rec = await update("auftraege", a.id, { ruht: !a.ruht }); patchLocal("auftraege", rec); render(); return; }
  if ("storno" in d) { const a = S.auftraege.find((x) => x.id === route().arg); const rec = await update("auftraege", a.id, { storniert: !a.storniert }); patchLocal("auftraege", rec); toast(rec.storniert ? "Storniert." : "Storno aufgehoben."); render(); return; }
  if ("archiv" in d) { await update("auftraege", route().arg, { archiv: true }); S.auftraege = S.auftraege.filter((a) => a.id !== route().arg); toast("Archiviert."); location.hash = "#auftraege"; return; }
  const seg = b.closest(".seg[data-f]");
  if (seg && b.dataset.v !== undefined) { const f = seg.dataset.f; S.form[f] = f === "s" || f === "art" ? b.dataset.v : +b.dataset.v; $$("button", seg).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
});

document.addEventListener("change", async (e) => {
  const rid = e.target.dataset?.routine;
  if (rid) { try { const rec = await update("routinen", rid, { aktiv: e.target.checked }); const i = S.routinen.findIndex((x) => x.id === rid); if (i >= 0) S.routinen[i] = rec; toast(rec.aktiv ? "Routine aktiv." : "Routine pausiert."); } catch (err) { toast(err.message); } render(); return; }
  const id = e.target.dataset?.check; if (!id) return;
  await doneTask(id); render();
});

document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (f.id === "stepForm") {
    e.preventDefault();
    const id = route().arg, t = S.aufgaben.find((x) => x.id === id), step = $("#nextStep").value.trim();
    try { const rec = await update("aufgaben", id, { step: step || t.step, post: 0, r: Math.max(0, (t.r || 0) - 1) }); patchLocal("aufgaben", rec); logEvent("schritt", id, step); toast("Schritt gespeichert. Weiter so."); } catch (err) { toast(err.message); }
    location.hash = "#jetzt"; return;
  }
  if (f.id === "taskForm") {
    e.preventDefault();
    const r = route(), data = { titel: $("#tTitel").value.trim(), step: $("#tStep").value.trim(), auftrag: $("#tAuftrag").value, due: $("#tDue").value, notiz: $("#tNotiz").value, ...S.form };
    try {
      if (r.name === "neu") { const rec = await create("aufgaben", { ...data, status: "offen", post: 0, starts: 0 }); S.aufgaben.unshift(rec); }
      else { const rec = await update("aufgaben", r.arg, data); patchLocal("aufgaben", rec); }
      toast("Gespeichert."); history.length > 1 ? history.back() : (location.hash = "#jetzt");
    } catch (err) { toast(err.message); }
    return;
  }
  if (f.id === "routineForm") {
    e.preventDefault();
    const wt = $("#rWt").value, rh = $("#rRh").value;
    const data = { titel: $("#rTitel").value.trim(), rhythmus: rh, dauer: +$("#rDauer").value || 0.5, step: $("#rStep").value.trim(), aktiv: true };
    if (rh === "woechentlich") data.wochentag = /^\d$/.test(wt) ? +wt : 1;
    if (rh === "monatlich") data.monatsregel = wt === "m1" ? "erster_montag" : wt === "mL" ? "letzte_woche" : "tag", data.monatstag = /^\d$/.test(wt) ? +wt : 1;
    try { const rec = await create("routinen", data); S.routinen.push(rec); toast("Routine angelegt."); render(); } catch (err) { toast(err.message); }
    return;
  }
  if (f.id === "kpiForm") {
    e.preventDefault();
    const data = { umsatzziel: +$("#kZiel").value, kapazitaet_min: +$("#kMin").value, kapazitaet_max: +$("#kMax").value };
    try { S.kennzahlen = S.kennzahlen ? await update("kennzahlen", S.kennzahlen.id, data) : await create("kennzahlen", data); toast("Gespeichert."); render(); } catch (err) { toast(err.message); }
    return;
  }
  if (f.id === "orderForm") {
    e.preventDefault();
    const typ = f.dataset.typ || "kunde", val = (id) => ($(id) ? $(id).value.trim() : undefined);
    const r = route(), data = { name: val("#oName"), due: val("#oDue"), notiz: $("#oNotiz").value, stand: $("#oStand").value, wartet: val("#oWartet") };
    if (typ === "kunde") Object.assign(data, { kunde: val("#oKunde"), nr: val("#oNr"), bestellnr: val("#oBest"), volumen: +val("#oVol") || 0 });
    else Object.assign(data, { ziel: val("#oZiel"), kunde: "Bösner Media" });
    try {
      if (r.name === "neuer-auftrag") { const rec = await create("auftraege", { ...data, typ, phase: 0, archiv: false, ruht: false, storniert: false }); S.auftraege.unshift(rec); location.hash = `#auftrag/${rec.id}`; }
      else { const rec = await update("auftraege", r.arg, data); patchLocal("auftraege", rec); toast("Gespeichert."); render(); }
    } catch (err) { toast(err.message); }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === " " && route().name === "jetzt" && !["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(document.activeElement?.tagName)) {
    const go = $("a.btn.big"); if (go) { e.preventDefault(); location.hash = go.getAttribute("href"); }
  }
});
$("#logout").addEventListener("click", logout);
window.addEventListener("hashchange", () => { S.showMore = route().name === "auftraege" ? S.showMore : false; render(); });
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && S.token && S.loaded && !["fokus", "aufgabe", "neu", "neuer-auftrag", "auftrag"].includes(route().name)) {
    try { await load(); render(); } catch {}
  }
});

// Sitzung verlängern, dann starten.
(async () => {
  if (S.token) {
    try { const r = await api("/api/collections/users/auth-refresh", { method: "POST" }); S.token = r.token; S.me = r.record; store.set("token", S.token); store.set("me", S.me); } catch {}
  }
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
})();
