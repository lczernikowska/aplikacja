// PEWNY EGZAMIN – aplikacja dla uczniów (PWA). Logowanie i dane: Firebase. Bez konfiguracji działa w trybie podglądu.
const CFG = window.PE_CONFIG || {};
const SEED = window.PE_SEED || { students: [], plans: {}, tests: [] };
const DEMO = !CFG.firebase || !CFG.firebase.apiKey || String(CFG.firebase.apiKey).startsWith("WKLEJ");
const APP_URL = CFG.appUrl || location.origin + location.pathname.replace(/index\.html$/, "");

const root = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => iso(new Date());
const fmtDate = s => { if (!s) return ""; const d = new Date(s + "T12:00:00"); return d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" }); };
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const clone = o => JSON.parse(JSON.stringify(o));
const isObj = o => o && typeof o === "object" && !Array.isArray(o);
function deepMerge(a, b) { const out = isObj(a) ? { ...a } : {}; for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v; return out; }
function genPass() { const c = "abcdefghjkmnpqrstuvwxyz23456789"; let s = ""; for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }

/* ---------------- dane: tryb podglądu ---------------- */
function demoBackend() {
  const KEY = "pe_demo_v1"; let mem = null, cb = null, user = null;
  const seedInto = m => {
    for (const c of ["students", "plans", "tests", "assignments", "results", "planState", "users"]) m[c] = {};
    SEED.students.forEach(({ id, ...s }) => m.students[id] = s);
    Object.entries(SEED.plans).forEach(([k, v]) => m.plans[k] = v);
    SEED.tests.forEach(({ id, ...t }) => m.tests[id] = t);
    m.materials = {}; (SEED.materials || []).forEach(({ id, ...t }) => m.materials[id] = t);
  };
  const load = () => { if (mem) return mem; try { mem = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { } if (!mem) { mem = {}; seedInto(mem); } return mem; };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { } };
  return {
    demo: true,
    onAuth(f) { cb = f; try { user = JSON.parse(sessionStorage.getItem("pe_demo_user") || "null"); } catch (e) { } f(user); },
    async demoLogin(u) { user = u; try { sessionStorage.setItem("pe_demo_user", JSON.stringify(u)); } catch (e) { } cb(u); },
    async logout() { user = null; try { sessionStorage.removeItem("pe_demo_user"); } catch (e) { } cb(null); },
    async login() { throw new Error("W trybie podglądu użyj przycisków poniżej."); },
    async reset() { },
    async get(c, id) { const d = (load()[c] || {})[id]; return d ? { id, ...clone(d) } : null; },
    async list(c, f) { let a = Object.entries(load()[c] || {}).map(([id, d]) => ({ id, ...clone(d) })); if (f) a = a.filter(x => x[f[0]] === f[1]); return a; },
    async set(c, id, d) { const m = load(); (m[c] = m[c] || {})[id] = clone(d); save(); },
    async update(c, id, d) { const m = load(); m[c] = m[c] || {}; m[c][id] = deepMerge(m[c][id] || {}, clone(d)); save(); },
    async del(c, id) { const m = load(); if (m[c]) delete m[c][id]; save(); },
    async createLogin() { return "demo-" + rid(); },
    async bulk(c, entries, onProg) { const m = load(); m[c] = m[c] || {}; for (const [id, d] of entries) m[c][id] = deepMerge(m[c][id] || {}, clone(d)); save(); onProg && onProg(entries.length); },
    wipe() { mem = null; try { localStorage.removeItem(KEY); } catch (e) { } }
  };
}

/* ---------------- dane: Firebase ---------------- */
async function fbBackend() {
  const base = "https://www.gstatic.com/firebasejs/10.12.2/";
  const { initializeApp } = await import(base + "firebase-app.js");
  const A = await import(base + "firebase-auth.js");
  const F = await import(base + "firebase-firestore.js");
  const fapp = initializeApp(CFG.firebase);
  const auth = A.getAuth(fapp);
  const db = F.getFirestore(fapp);
  let creator = null;
  const adminEmail = String(CFG.adminEmail || "").toLowerCase();
  return {
    demo: false,
    onAuth(f) {
      A.onAuthStateChanged(auth, async u => {
        if (!u) return f(null);
        if ((u.email || "").toLowerCase() === adminEmail) return f({ uid: u.uid, email: u.email, role: "admin", name: CFG.teacherName || "Laura" });
        let prof = null;
        try { const s = await F.getDoc(F.doc(db, "users", u.uid)); prof = s.exists() ? s.data() : null; } catch (e) { }
        f({ uid: u.uid, email: u.email, role: "student", studentId: prof?.studentId || null, name: prof?.name || u.email });
      });
    },
    login: (e, p) => A.signInWithEmailAndPassword(auth, e, p),
    logout: () => A.signOut(auth),
    reset: e => A.sendPasswordResetEmail(auth, e),
    async get(c, id) { const s = await F.getDoc(F.doc(db, c, id)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    async list(c, f) { const q = f ? F.query(F.collection(db, c), F.where(f[0], "==", f[1])) : F.collection(db, c); const s = await F.getDocs(q); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
    set: (c, id, d) => F.setDoc(F.doc(db, c, id), d),
    update: (c, id, d) => F.setDoc(F.doc(db, c, id), d, { merge: true }),
    del: (c, id) => F.deleteDoc(F.doc(db, c, id)),
    async bulk(c, entries, onProg) {
      for (let i = 0; i < entries.length; i += 400) {
        const b = F.writeBatch(db);
        for (const [id, d] of entries.slice(i, i + 400)) b.set(F.doc(db, c, id), d, { merge: true });
        await b.commit(); onProg && onProg(Math.min(i + 400, entries.length));
      }
    },
    async createLogin(email, pw) {
      if (!creator) creator = initializeApp(CFG.firebase, "creator");
      const ca = A.getAuth(creator);
      const r = await A.createUserWithEmailAndPassword(ca, email, pw);
      const id = r.user.uid; await A.signOut(ca); return id;
    }
  };
}

/* ---------------- stan ---------------- */
let B = null;
const S = { user: null, tab: "dzis", sel: null, showAll: false, view: null, data: null, busy: false };

function ask(msg, okLabel = "Tak") {
  return new Promise(res => {
    const ov = document.createElement("div"); ov.className = "ov";
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="mb"><p>${esc(msg)}</p></div><footer><button class="btn" data-r="0">Anuluj</button><button class="btn primary" data-r="1">${esc(okLabel)}</button></footer></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (b || e.target === ov) { ov.remove(); res(!!(b && b.dataset.r === "1")); } });
  });
}
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function errMsg(e) {
  const c = e && e.code || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Nieprawidłowy e-mail lub hasło.";
  if (c.includes("email-already-in-use")) return "Na ten e-mail jest już konto.";
  if (c.includes("weak-password")) return "Hasło musi mieć co najmniej 6 znaków.";
  if (c.includes("invalid-email")) return "To nie wygląda na poprawny e-mail.";
  if (c.includes("permission-denied")) return "Brak uprawnień – sprawdź reguły bazy w Firebase.";
  if (c.includes("too-many-requests")) return "Za dużo prób. Spróbuj za kilka minut.";
  return (e && e.message) || "Coś poszło nie tak.";
}


/* ---------------- rozliczenia (wspólne) ---------------- */
const BAL_FROM = CFG.balanceFrom || "2026-11-01";
const SUBJ = { mat: "matematyka", ang: "angielski" };
const zl = n => (Math.round(n * 100) / 100).toLocaleString("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " zł";
// jak w aplikacji dla korepetytorki: po północy zaplanowana lekcja z minionego dnia liczy się jako odbyta
const effStatus = l => l.status === "planned" && l.date < today() ? "done" : l.status;
const isCharge = p => p.kind === "charge";
function balanceOf(lessons, payments) {
  const done = lessons.filter(l => effStatus(l) === "done");
  const charges = payments.filter(isCharge), pays = payments.filter(p => !isCharge(p));
  const due = done.reduce((a, l) => a + (Number(l.price) || 0), 0) + charges.reduce((a, c) => a + (Number(c.amount) || 0), 0), paid = pays.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  return { done, charges, pays, due, paid, bal: Math.round((due - paid) * 100) / 100 };
}
function nextLessons(lessons, n) {
  const t = today(), now = new Date(); const hm = pad(now.getHours()) + ":" + pad(now.getMinutes());
  return lessons.filter(l => l.status !== "cancelled" && l.status !== "moved" && (l.date > t || (l.date === t && (l.time || "99") >= hm))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, n);
}
function balanceBlock(b) {
  const cls = b.bal > 0 ? "bad" : "ok";
  return `<div class="stat"><span class="small muted">${b.bal > 0 ? "Do zapłaty" : b.bal < 0 ? "Nadpłata" : "Stan"}</span><b style="color:var(--${cls})">${b.bal > 0 ? zl(b.bal) : b.bal < 0 ? zl(-b.bal) : "Wszystko opłacone"}</b><span class="small muted">${b.bal > 0 ? "za odbyte lekcje" : b.bal < 0 ? "nadpłata – na kolejne lekcje" : "dziękuję!"}</span></div>`;
}

const ADMIN_ONLY = ["adminTitle", "adminTopic", "adminSource"];
const pubTest = t => { const o = {}; for (const [k, v] of Object.entries(t)) if (!ADMIN_ONLY.includes(k) && k !== "id" && !k.startsWith("_")) o[k] = v; return o; };
async function syncLocalTests(results) {
  const taken = new Set(results.map(r => r.testId));
  for (const lt of (window.PE_ARKUSZE || [])) {
    const pub = pubTest(lt); const fs = S.data.tests[lt.id];
    if (fs) {
      const { id: _i, ...cur } = fs;
      try {
        UNDO.off = true;
        if (!taken.has(lt.id) && JSON.stringify(cur) !== JSON.stringify(pub)) await B.set("tests", lt.id, pub);
        else if (cur.title !== pub.title || cur.topic !== pub.topic || cur.instructions !== pub.instructions) await B.update("tests", lt.id, { title: pub.title, topic: pub.topic, instructions: pub.instructions });
      } catch (e) { console.warn("sync test", e); } finally { UNDO.off = false; }
    }
    S.data.tests[lt.id] = { ...(fs && taken.has(lt.id) ? fs : pub), id: lt.id, _pub: pub, _local: !fs, title: lt.adminTitle || lt.title, topic: lt.adminTopic || lt.topic };
  }
}
async function loadAdmin() {
  const [students, plans, tests, assignments, results, planState, mathProgress, materials, lessons, payments, engProgress] = await Promise.all(["students", "plans", "tests", "assignments", "results", "planState", "mathProgress", "materials", "lessons", "payments", "engProgress"].map(c => B.list(c)));
  const by = a => Object.fromEntries(a.map(x => [x.id, x]));
  const settingsApp = await B.get("settings", "app").catch(() => null);
  const results0 = results;
  S.data = { settings: settingsApp || {}, students: by(students), plans: by(plans), tests: by(tests), assignments: by(assignments), results: by(results), planState: by(planState), mathProgress: by(mathProgress), materials: { ...Object.fromEntries((SEED.materials || []).map(m => [m.id, m])), ...by(materials) }, lessons: by(lessons), payments: by(payments), engProgress: by(engProgress) };
  await syncLocalTests(results0);
}
async function loadStudent() {
  const sid = S.user.studentId;
  const [assignments, results, lessons, payments, settings, me, engP, mathP] = await Promise.all([B.list("assignments", ["studentId", sid]), B.list("results", ["studentId", sid]), B.list("lessons", ["studentId", sid]).catch(() => []), B.list("payments", ["studentId", sid]).catch(() => []), B.get("settings", "app").catch(() => null), B.get("students", sid).catch(() => null), B.get("engProgress", sid).catch(() => null), B.get("mathProgress", sid).catch(() => null)]);
  const testIds = [...new Set(assignments.map(a => a.testId).filter(Boolean))];
  const tests = {};
  await Promise.all(testIds.map(async id => { const t = await B.get("tests", id); if (t) tests[id] = t; }));
  S.data = { assignments: Object.fromEntries(assignments.map(a => [a.id, a])), results: Object.fromEntries(results.map(r => [r.assignmentId || r.id, r])), tests, lessons, payments, settings, me, engP, mathP };
}

/* ---------------- ramka ---------------- */
const ADMIN_TABS = [["dzis", "Dziś"], ["kalendarz", "Kalendarz"], ["uczniowie", "Uczniowie"], ["platnosci", "Płatności"], ["zgory", "Rozliczenie z góry"], ["zadania", "Zadania domowe"], ["maturzysci", "Matura angielski"], ["matematyka", "Matura matematyka"], ["materialy", "Materiały"], ["testy", "Bank testów"], ["ustawienia", "Ustawienia"]];
function frame(inner) {
  const u = S.user;
  const tabs = u && u.role === "admin" && !S.view ? `<nav class="tabs">${ADMIN_TABS.map(([k, l]) => `<button data-act="tab" data-k="${k}" ${S.tab === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</nav>` : "";
  return `<header class="top"><div class="wrap topin ${tabs ? "" : "solo"}"><span class="brand"><span class="dot"></span>PEWNY EGZAMIN</span>
  ${u ? `<span class="who">${esc(u.name || u.email)}${B.demo ? ' <span class="chip mus">podgląd</span>' : ""}<button class="btn sm ghost" data-act="logout">Wyloguj</button></span>` : ""}${tabs}</div></header>
  <main class="wrap">${inner}</main>`;
}
function installHint() {
  if (window.matchMedia && matchMedia("(display-mode: standalone)").matches) return "";
  let dismissed = false; try { dismissed = localStorage.getItem("pe_install_hidden") === "1"; } catch (e) { }
  if (dismissed) return "";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<div class="install"><span>📲 Dodaj aplikację na ekran telefonu: ${ios ? "w Safari kliknij <b>Udostępnij</b> → <b>Do ekranu początkowego</b>." : "w menu przeglądarki (⋮) wybierz <b>Zainstaluj aplikację</b> lub <b>Dodaj do ekranu głównego</b>."}</span><button class="btn sm ghost" data-act="hideInstall">Ukryj</button></div>`;
}

/* ---------------- logowanie ---------------- */
function renderLogin(msg) {
  const demoBtns = B.demo ? `<div class="notice"><b>Tryb podglądu</b><span class="small">Aplikacja nie jest jeszcze połączona z Firebase, więc dane zapisują się tylko w tej przeglądarce. Wejdź jako:</span>
    <div class="chips"><button class="btn sm primary" data-act="demoAdmin">Laura (nauczycielka)</button>${SEED.students.map(s => `<button class="btn sm" data-act="demoStudent" data-id="${s.id}">${esc(s.name)}</button>`).join("")}</div></div>` : "";
  root.innerHTML = frame(`<div class="login"><div class="logo"><b>PEWNY EGZAMIN</b><span>Strefa ucznia</span></div>
  ${demoBtns}
  <form class="panel" id="loginForm"><label class="f">E-mail<input type="email" name="email" autocomplete="username" required></label>
  <label class="f">Hasło<input type="password" name="pw" autocomplete="current-password" required></label>
  ${msg ? `<div class="notice bad small">${esc(msg)}</div>` : ""}
  <button class="btn primary block" type="submit">Zaloguj się</button>
  <button class="btn ghost sm" type="button" data-act="forgot">Nie pamiętam hasła</button></form></div>`);
}

/* ---------------- uczeń ---------------- */
function resultFor(aid) { return S.data.results[aid]; }

function studentResults() {
  const me = S.data.me || {}; const subs = me.subjects || [];
  const engOn = !!S.data.engP || subs.some(x => x.subject === "ang" && x.level === "PR") || (me.level === "PR" && /angielski/.test(me.subjectLabel || ""));
  const mathOn = !!S.data.mathP || !!me.mathMatura;
  const res = (x) => x && x.done ? (typeof x.pct === "number" ? pctChip(x.pct) : '<span class="chip ok">✓ zrobione</span>') : '<span class="muted small">–</span>';
  const avgOf = xs => { const p = xs.filter(x => x && x.done && typeof x.pct === "number"); return p.length ? Math.round(p.reduce((a, x) => a + x.pct, 0) / p.length) : null; };
  let out = "";
  if (engOn) {
    const t = (S.data.engP || {}).topics || {}; const V = ENG_AREAS.map((_, i) => t["v" + pad(i + 1)]), W = ENG_AREAS.map((_, i) => t["w" + pad(i + 1)]);
    const av = avgOf(V), aw = avgOf(W);
    out += `<section class="panel"><h2>Matura z angielskiego – działy</h2><div class="stats"><div class="stat"><span class="small muted">Testy ze słownictwa</span><b>${V.filter(x => x && x.done).length}/14${av === null ? "" : " · " + av + "%"}</b></div><div class="stat"><span class="small muted">Wypracowania</span><b>${W.filter(x => x && x.done).length}/14${aw === null ? "" : " · " + aw + "%"}</b></div></div>
    <details><summary class="small" style="cursor:pointer;color:var(--accent);font-weight:600">Pokaż wyniki z każdego działu</summary><div class="tablewrap"><table><thead><tr><th>Dział</th><th>Test</th><th>Wypracowanie</th></tr></thead><tbody>${ENG_AREAS.map((n, i) => `<tr><td style="white-space:normal">${i + 1}. ${esc(n)}</td><td>${res(V[i])}</td><td>${res(W[i])}</td></tr>`).join("")}</tbody></table></div></details></section>`;
  }
  if (mathOn) {
    const t = (S.data.mathP || {}).topics || {}; const M = MATH_TOPICS.map((_, i) => t[tkey(i)]); const am = avgOf(M);
    out += `<section class="panel"><h2>Matura z matematyki – działy</h2><div class="stats"><div class="stat"><span class="small muted">Działy zrobione</span><b>${M.filter(x => x && x.done).length}/${MATH_TOPICS.length}</b></div><div class="stat"><span class="small muted">Średni wynik</span><b>${am === null ? "–" : am + "%"}</b></div></div>
    <details><summary class="small" style="cursor:pointer;color:var(--accent);font-weight:600">Pokaż wyniki z każdego działu</summary><div class="tablewrap"><table><thead><tr><th>Dział</th><th>Wynik</th></tr></thead><tbody>${MATH_TOPICS.map((n, i) => `<tr><td style="white-space:normal">${i + 1}. ${esc(n)}</td><td>${res(M[i])}</td></tr>`).join("")}</tbody></table></div></details></section>`;
  }
  return out;
}
function customCard(a, r, late) {
  const pdf = a.kind === "material" ? `<button class="btn sm" data-act="stuPdf" data-id="${a.id}">Pobierz PDF</button>` : "";
  return `<div class="row" style="align-items:flex-start"><span class="grow"><b>${esc(a.title || "Zadanie")}</b>${a.desc ? `<span class="small" style="white-space:pre-wrap;display:block;margin-top:4px">${esc(a.desc)}</span>` : ""}<span class="small muted">${a.due ? "termin: " + fmtDate(a.due) : ""}</span></span>
  ${pdf}${r ? '<span class="chip ok">zrobione</span>' : `${late ? '<span class="chip bad">po terminie</span>' : ""}<button class="btn sm primary" data-act="doneCustom" data-id="${a.id}">Zrobione ✓</button>`}</div>`;
}
const ownKind = a => a.kind === "custom" || a.kind === "material";
const kindLabel = a => a.kind === "custom" ? "zadanie własne" : a.kind === "material" ? (a.atLesson ? "materiał · dany na lekcji" : "materiał (PDF)") : "test";
const taskTitle = a => ownKind(a) ? (a.title || "Zadanie własne") : ((S.data.tests[a.testId] || {}).title || a.testId);
const splitKey = key => { const i = (key || "").search(/^##\s*Słówka/m); return i < 0 ? "" : key.slice(i); };
const givenTo = (sid, matId) => Object.values(S.data.assignments || {}).filter(a => a.studentId === sid && a.kind === "material" && a.matId === matId);
const matGivenNames = matId => [...new Set(Object.values(S.data.assignments || {}).filter(a => a.kind === "material" && a.matId === matId).map(a => sName(a.studentId)))];
function printDoc({ title, category, body, extra }) {
  let pa = document.getElementById("printArea"); if (!pa) { pa = document.createElement("div"); pa.id = "printArea"; document.body.appendChild(pa); }
  pa.innerHTML = `<div class="pbrand"><span>PEWNY EGZAMIN</span><span>${esc((MAT_CATS.find(c => c[0] === category) || ["", ""])[1])}</span></div>
  <div class="namebox"><span>Imię i nazwisko:</span><span>Data:</span></div><h1>${esc(title)}</h1><div class="md">${md(body || "")}</div>${extra || ""}`;
  const old = document.title; document.title = title.replace(/[:·]/g, " -").replace(/\s+/g, " ");
  setTimeout(() => { window.print(); document.title = old; }, 50);
}
function assignFormHtml(sid) {
  const st = Object.values(S.data.students).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  const ts = Object.values(S.data.tests).sort((a, b) => a.title.localeCompare(b.title, "pl"));
  return `<div class="frow">
  ${sid ? `<input type="hidden" name="sid" value="${sid}">` : `<label class="f">Uczeń<select name="sid" required>${st.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></label>`}
  <label class="f">Rodzaj<select name="kind" data-kindsel><option value="custom">Zadanie własne</option><option value="material">Materiał (zestaw PDF)</option><option value="test">Test z banku</option></select></label>
  <label class="f">Termin wykonania<input type="date" name="due" value="${defaultDue(sid)}" data-due></label></div>
  <div class="acts" data-duebtns><span class="small muted">Termin:</span><button type="button" class="btn sm ghost" data-due-set="next">do następnej lekcji</button><button type="button" class="btn sm ghost" data-due-set="week">za tydzień</button><button type="button" class="btn sm ghost" data-due-set="none">bez terminu</button><span class="small muted" data-due-info>${dueInfo(sid)}</span></div>
  <div data-kind="custom" style="display:grid;gap:12px"><label class="f">Tytuł<input name="title" placeholder="np. Zadania maturalne z funkcji"></label>
  <label class="f">Opis (opcjonalnie)<textarea name="desc" rows="3" placeholder="np. Arkusz maj 2023, zadania 5–12. Rozwiązania przynieś na lekcję."></textarea></label></div>
  <div data-kind="material" hidden style="display:grid;gap:8px"><input type="search" data-filter-for="mid" placeholder="Wpisz, żeby wyszukać materiał, np. zestaw 05, PLUS, praca" autocomplete="off"><label class="f">Materiał<select name="mid">${Object.values(S.data.materials || {}).sort((a, b) => (a.no || 0) - (b.no || 0)).map(m => { const g = sid ? givenTo(sid, m.id) : []; return `<option value="${m.id}">${g.length ? "✓ " : ""}${esc(m.title)}${g.length ? " (już dostał/a)" : ""}</option>`; }).join("")}</select></label><span class="small muted">Uczeń zobaczy przycisk „Pobierz PDF” – zestaw bez odpowiedzi, ze słówkami na końcu.</span></div>
  <div data-kind="test" hidden style="display:grid;gap:8px"><input type="search" data-filter-for="tid" placeholder="Wpisz, żeby wyszukać test, np. liczby, matura 2023, czytanka" autocomplete="off"><label class="f">Test<select name="tid">${ts.map(t => `<option value="${t.id}">${esc(t.title)} (${esc(t.level || "")})</option>`).join("")}</select></label></div>
  <div><button class="btn primary" type="submit">Zadaj</button></div>`;
}
async function addCustom(sid, title, desc, due) {
  const id = rid(); const a = { studentId: sid, kind: "custom", title, desc: desc || "", due: due || "", createdAt: new Date().toISOString() };
  await B.set("assignments", id, a); S.data.assignments[id] = { id, ...a }; return id;
}
function giveMatModal(m) {
  const g = matGivenNames(m.id);
  openModal({ title: `Daj: ${m.title}`, submit: "Zapisz", body: `${g.length ? `<p class="small">Już dostali: <b>${esc(g.join(", "))}</b></p>` : ""}
  <label class="f">Uczeń<select name="sid" required><option value="">Wybierz ucznia…</option>${activeStudents().map(s => `<option value="${s.id}">${givenTo(s.id, m.id).length ? "✓ " : ""}${esc(s.name)}</option>`).join("")}</select></label>
  <label class="check"><input type="radio" name="how" value="app" checked> Zadaj w aplikacji – uczeń pobierze PDF bez odpowiedzi</label>
  <label class="check"><input type="radio" name="how" value="lesson"> Dałam na lekcji – tylko zapisz, że go ma</label>
  <label class="f">Termin wykonania (przy zadaniu w aplikacji)<input type="date" name="due" value="${weekAhead()}" data-due></label>
  <div class="acts"><span class="small muted">Termin:</span><button type="button" class="btn sm ghost" data-due-set="next">do następnej lekcji</button><button type="button" class="btn sm ghost" data-due-set="week">za tydzień</button><button type="button" class="btn sm ghost" data-due-set="none">bez terminu</button><span class="small muted" data-due-info></span></div>`,
    onMount: (f, ov) => wireDue(ov),
    onSubmit: async fd => { const sid = String(fd.get("sid") || ""); if (!sid) { toast("Wybierz ucznia."); return false; } const ok = await giveMaterial(sid, m, { due: String(fd.get("due") || ""), atLesson: fd.get("how") === "lesson" }); if (ok) toast("Zapisane"); return ok; } });
}
async function giveMaterial(sid, m, { due = "", atLesson = false } = {}) {
  const was = givenTo(sid, m.id);
  if (was.length && !(await ask(`${sName(sid)} dostał/a już „${m.title}” (${fmtDate((was[0].createdAt || "").slice(0, 10))}). Dać jeszcze raz?`, "Daj mimo to"))) return false;
  const id = rid(); const now = new Date().toISOString();
  const a = { studentId: sid, kind: "material", matId: m.id, title: m.title, category: m.category || "", body: m.body || "", vocab: splitKey(m.key), due: atLesson ? "" : due, atLesson, createdAt: now };
  await B.set("assignments", id, a); S.data.assignments[id] = { id, ...a };
  if (atLesson) { const r = { assignmentId: id, studentId: sid, kind: "material", doneAt: now, by: "teacher" }; await B.set("results", id, r); S.data.results[id] = r; }
  return true;
}
async function submitAssign(f) {
  const sid = f.get("sid"), due = f.get("due");
  if (f.get("kind") === "test") {
    if (!f.get("tid")) { toast("Wybierz test."); return false; }
    const was = Object.values(S.data.assignments).find(a => a.studentId === sid && a.testId === f.get("tid"));
    if (was && !(await ask(`${sName(sid)} dostał/a już ten test${was.due ? " (termin " + fmtDate(was.due) + ")" : ""}. Zadać jeszcze raz?`, "Zadaj mimo to"))) return false;
    await addAssignment(sid, f.get("tid"), due);
  }
  else if (f.get("kind") === "material") {
    const m = S.data.materials[f.get("mid")]; if (!m) { toast("Wybierz materiał."); return false; }
    if (!(await giveMaterial(sid, m, { due }))) return false;
  }
  else { const title = String(f.get("title") || "").trim(); if (!title) { toast("Wpisz tytuł zadania."); return false; } await addCustom(sid, title, String(f.get("desc") || "").trim(), due); }
  toast("Zadane"); return true;
}
function nextLessonDate(sid) { if (!sid) return null; const t = today(); const l = Object.values(S.data.lessons || {}).filter(x => x.studentId === sid && x.status === "planned" && x.date > t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0]; return l ? l.date : null; }
const weekAhead = () => iso(new Date(Date.now() + 7 * 864e5));
function defaultDue(sid) { return nextLessonDate(sid) || weekAhead(); }
function dueInfo(sid) { const d = nextLessonDate(sid); return d ? `najbliższa lekcja: ${fmtDate(d)}` : (sid ? "brak zaplanowanej lekcji" : ""); }
function wireDue(scope) {
  scope.querySelectorAll("form").forEach(f => {
    const due = f.querySelector("[data-due]"); if (!due || f.dataset.dueWired) return; f.dataset.dueWired = "1";
    const sidOf = () => (f.querySelector("[name=sid]") || {}).value;
    const mark = () => { const v = due.value, nx = nextLessonDate(sidOf()); f.querySelectorAll("[data-due-set]").forEach(b => { const k = b.dataset.dueSet; b.setAttribute("aria-pressed", String(k === "none" ? !v : k === "next" ? !!v && v === nx : !!v && v === weekAhead() && v !== nx)); }); };
    f.addEventListener("click", e => { const b = e.target.closest("[data-due-set]"); if (!b) return; const k = b.dataset.dueSet; due.value = k === "next" ? (nextLessonDate(sidOf()) || weekAhead()) : k === "week" ? weekAhead() : ""; if (k === "next" && !nextLessonDate(sidOf())) toast("Brak zaplanowanej lekcji – ustawiłam termin za tydzień."); else toast(due.value ? "Termin: " + fmtDate(due.value) : "Bez terminu"); mark(); if (k === "week") b.setAttribute("aria-pressed", "true"); });
    due.addEventListener("change", mark); mark();
    const sel = f.querySelector("select[name=sid]"); if (sel) sel.addEventListener("change", () => { due.value = defaultDue(sel.value); const i = f.querySelector("[data-due-info]"); if (i) i.textContent = dueInfo(sel.value); mark(); });
  });
}
function wireFilter(scope) {
  scope.querySelectorAll("[data-filter-for]").forEach(inp => {
    if (inp.dataset.wired) return; inp.dataset.wired = "1";
    const sel = inp.closest("form").querySelector(`select[name=${inp.dataset.filterFor}]`); if (!sel) return;
    const all = [...sel.options].map(o => ({ v: o.value, t: o.textContent, n: norm(o.textContent) }));
    inp.addEventListener("input", () => {
      const words = norm(inp.value).split(/\s+/).filter(Boolean); const cur = sel.value;
      const hit = all.filter(o => words.every(w => o.n.includes(w)));
      sel.innerHTML = hit.map(o => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join("") || `<option value="">— nic nie pasuje —</option>`;
      if (hit.some(o => o.v === cur)) sel.value = cur;
      sel.size = hit.length > 1 && words.length ? Math.min(hit.length, 6) : 0;
    });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); sel.size = 0; sel.focus(); } });
    sel.addEventListener("change", () => { sel.size = 0; });
  });
}
function wireKind(scope) {
  wireDue(scope); wireFilter(scope);
  const sel = scope.querySelector("[data-kindsel]"); if (!sel) return;
  const upd = () => scope.querySelectorAll("[data-kind]").forEach(d => { d.hidden = d.dataset.kind !== sel.value; });
  sel.addEventListener("change", upd); upd();
}
async function markCustomDone(aid) {
  const a = S.data.assignments[aid]; const sid = S.user.role === "admin" ? a.studentId : S.user.studentId;
  const r = { assignmentId: aid, studentId: sid, kind: "custom", doneAt: new Date().toISOString(), by: S.user.role === "admin" ? "teacher" : "student" };
  await B.set("results", aid, r); S.data.results[aid] = r;
}
function renderStudent() {
  if (!S.user.studentId) { root.innerHTML = frame(`<div class="notice bad">Twoje konto nie jest jeszcze przypisane do ucznia. Napisz do swojej korepetytorki.</div>`); return; }
  if (S.view && S.view.type === "test") return renderTest();
  const as = Object.values(S.data.assignments).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  const todo = as.filter(a => !resultFor(a.id)), done = as.filter(a => resultFor(a.id)).reverse();
  const card = a => { const t = S.data.tests[a.testId]; const r = resultFor(a.id); const late = !r && a.due && a.due < today();
    if (ownKind(a)) return customCard(a, r, late);
    return `<button class="row" data-act="openTest" data-id="${a.id}"><span class="grow"><b>${esc(t ? t.title : "Test")}</b><span class="small muted">${t && t.topic ? esc(t.topic) + " · " : ""}${a.due ? "termin: " + fmtDate(a.due) : ""}</span></span>
    ${r ? `<span class="chip ${pct(r.score, r.max) >= 70 ? "ok" : pct(r.score, r.max) >= 50 ? "warn" : "bad"}">${r.score}/${r.max} · ${pct(r.score, r.max)}%</span>` : late ? '<span class="chip bad">po terminie</span>' : '<span class="chip mus">do zrobienia</span>'}</button>`; };
  const nx = nextLessons(S.data.lessons || [], 3); const b = balanceOf(S.data.lessons || [], S.data.payments || []);
  const bank = S.data.settings && S.data.settings.bank; const month = new Date().toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
  const title = S.data.settings && S.data.settings.titleTpl ? S.data.settings.titleTpl.replace("{imie}", S.user.name).replace("{miesiac}", month) : "";
  const top = `<section class="panel"><h2>Najbliższa lekcja</h2>${nx.length ? `<p style="font-size:20px;font-weight:600">${esc(fmtDate(nx[0].date))}, ${esc(nx[0].time || "")} <span class="chip acc">${esc(SUBJ[nx[0].subject] || nx[0].subject || "")}</span></p>${nx.length > 1 ? `<p class="small muted">Potem: ${nx.slice(1).map(l => esc(fmtDate(l.date) + ", " + (l.time || ""))).join(" · ")}</p>` : ""}` : '<p class="empty">Brak zaplanowanych lekcji.</p>'}</section>
  <section class="panel"><h2>Płatności</h2><div class="stats">${balanceBlock(b)}</div>
  ${b.pays.length ? `<div class="tablewrap"><table><thead><tr><th>Data wpłaty</th><th>Kwota</th></tr></thead><tbody>${b.pays.sort((x, y) => (y.date || "").localeCompare(x.date || "")).map(p => `<tr><td>${esc(fmtDate(p.date))}</td><td>${zl(Number(p.amount) || 0)}</td></tr>`).join("")}</tbody></table></div>` : ""}
  ${bank && bank.account ? `<details><summary class="small" style="cursor:pointer;color:var(--accent);font-weight:600">Dane do przelewu</summary><p class="small" style="margin-top:8px">Odbiorca: ${esc(bank.recipient || "")}<br>Numer konta: <b style="user-select:all">${esc(bank.account)}</b>${title ? `<br>Tytuł: ${esc(title)}` : ""}</p></details>` : ""}</section>`;
  root.innerHTML = frame(`${installHint()}<div class="head"><div><p class="eyebrow">Twoje konto</p><h1>Cześć, ${esc(S.user.name.split(" ")[0])}!</h1></div></div>${top}${studentResults()}
  <section class="list"><h2>Do zrobienia</h2>${todo.length ? todo.map(card).join("") : '<p class="empty">Wszystko zrobione. 🎉</p>'}</section>
  <section class="list"><h2>Zrobione</h2>${done.length ? done.map(card).join("") : '<p class="empty">Tu pojawią się Twoje wyniki.</p>'}</section>`);
}

/* ---------------- test (rozwiązywanie i przegląd) ---------------- */
function groupQuestions(t) {
  const groups = (t.passages || []).map((p, i) => ({ p, i, qs: [] }));
  const loose = [];
  (t.questions || []).forEach((q, n) => { const g = groups[q.p ?? (groups.length ? 0 : -1)]; (g ? g.qs : loose).push(n); });
  if (loose.length || !groups.length) groups.push({ p: null, i: -1, qs: loose });
  return groups;
}
function passageHtml(p) {
  const paras = String(p.text || "").split(/\n\s*\n/).map(x => { const m = x.match(/^\[([A-H])\]\s*/); return `<p>${m ? `<span class="pl">${m[1]}</span> ` : ""}${esc(m ? x.slice(m[0].length) : x)}</p>`; }).join("");
  return `<div class="passage">${p.title ? `<h3>${esc(p.title)}</h3>` : ""}${p.intro ? `<p class="small muted">${esc(p.intro)}</p>` : ""}${paras}</div>`;
}
const qMax = q => q.type === "open" ? 0 : q.type === "multi" ? q.c.length : (q.pts || 1);
const qScore = (q, a) => { if (q.type === "open" || a === undefined) return 0; if (q.type === "multi") return Math.min(q.c.length, (a || []).filter(x => q.c.includes(x)).length); return a === q.c ? (q.pts || 1) : 0; };
const scoreTest = (t, answers) => t.questions.reduce((s, q, n) => s + qScore(q, answers[n]), 0);
const maxTest = t => t.questions.reduce((s, q) => s + qMax(q), 0);
const openPts = t => t.questions.reduce((s, q) => s + (q.type === "open" ? q.pts || 0 : 0), 0);
function qHtml(q, n, answers, mode) {
  const mine = answers[n]; const review = mode !== "take";
  const isMulti = q.type === "multi";
  const sel = v => isMulti ? (mine || []).includes(v) : mine === v;
  const good = v => isMulti ? q.c.includes(v) : q.c === v;
  const opt = (val, letter, label) => {
    const pressed = sel(val); const right = good(val);
    let cls = "bub"; if (review && right) cls += " right"; else if (review && pressed && !right) cls += " wrong";
    return `<button class="opt ${review && right ? "isright" : ""}" data-act="ans" data-n="${n}" data-v='${JSON.stringify(val)}' aria-pressed="${pressed}" ${review ? "disabled" : ""}><span class="${cls}">${letter}</span>${label ? `<span>${esc(label)}</span>` : ""}</button>`;
  };
  const imgs = (q.imgs || []).map(u => `<img class="qimg" src="${esc(u)}" alt="${esc(q.label || "Zadanie")}" loading="lazy">`).join("");
  const label = q.label || `Zadanie ${n + 1}.`;
  if (q.type === "open") {
    return `<div class="q"><span class="qn">${q.imgs ? "" : esc(label) + " "}<span class="chip">zadanie otwarte · ${q.pts} pkt</span></span>${imgs}${q.t ? `<div class="qt">${esc(q.t)}</div>` : ""}
    ${review ? (q.e ? `<div class="expl"><b>Rozwiązanie</b><span>${esc(q.e)}</span></div>` : "") : `<p class="small muted">Rozwiąż w zeszycie. Rozwiązanie zobaczysz po oddaniu testu.</p>`}</div>`;
  }
  const L = q.L || (q.type === "tf" ? null : "ABCDEFGH".split(""));
  const bare = !!q.imgs && !q.o;
  const opts = q.type === "tf" ? opt(true, "P", "Prawda") + opt(false, "F", "Fałsz") : (q.o || L.slice(0, (q.L || []).length || 4)).map((o, k) => opt(k, L[k], q.o ? o : "")).join("");
  let verdict = "";
  if (review) {
    const pts = qScore(q, mine), max = qMax(q);
    const word = mine === undefined || (isMulti && !(mine || []).length) ? (mode === "key" ? "" : "Brak odpowiedzi") : pts === max ? "Dobrze" : pts > 0 ? "Częściowo" : "Źle";
    verdict = `<span class="verdict ${pts === max ? "ok" : "bad"}">${word}${max > 1 && mode !== "key" ? ` · ${pts}/${max} pkt` : ""}</span>${q.e ? `<div class="expl"><b>Wyjaśnienie</b><span>${esc(q.e)}</span></div>` : ""}`;
  }
  const chips = `${isMulti ? ` <span class="chip">wybierz ${q.k || q.c.length}</span>` : ""}${qMax(q) > 1 ? ` <span class="chip">${qMax(q)} pkt</span>` : ""}`;
  return `<div class="q">${q.imgs ? (chips ? `<span class="qn">${chips}</span>` : "") : `<span class="qn">${esc(label)}${q.type === "tf" ? " Prawda czy fałsz?" : ""}${chips}</span>`}${imgs}${q.t ? `<div class="qt">${esc(q.t)}</div>` : ""}<div class="opts${bare ? " inline" : ""}">${opts}</div>${verdict}</div>`;
}
function testBody(t, answers, mode) {
  return groupQuestions(t).map(g => `${g.p ? passageHtml(g.p) : ""}${g.qs.map(n => qHtml(t.questions[n], n, answers, mode)).join("")}`).join("");
}
function renderTest() {
  const v = S.view; const t = v.test;
  const closedQ = t.questions.map((q, n) => [q, n]).filter(([q]) => q.type !== "open");
  const total = closedQ.length; const answered = closedQ.filter(([q, n]) => v.answers[n] !== undefined && !(q.type === "multi" && !(v.answers[n] || []).length)).length;
  let top = "", bottom = "";
  if (v.mode === "take") {
    bottom = `<div class="submitbar"><span class="muted">Odpowiedzi: <b>${answered}/${total}</b></span><button class="btn primary" data-act="submitTest" ${S.busy ? "disabled" : ""}>Oddaj test</button></div>`;
  } else if (v.mode === "result") {
    const r = v.result;
    const op = openPts(t);
    top = `<div class="scorecard"><span class="score">${r.score}/${r.max}</span><div><b>${pct(r.score, r.max)}%</b><p class="small muted">${op ? `Punkty za zadania zamknięte. Zadania otwarte (${op} pkt) sprawdź z rozwiązaniami poniżej.` : "Przejrzyj wyjaśnienia przy pytaniach, zwłaszcza tam, gdzie jest „Źle”."}</p></div></div>`;
  } else top = `<div class="notice small">Podgląd z kluczem odpowiedzi i wyjaśnieniami.</div>`;
  root.innerHTML = frame(`<div class="head"><div><button class="btn sm ghost" data-act="back" style="justify-self:start">← Wróć</button><p class="eyebrow">${esc(t.topic || "")}${t.level ? " · " + esc(t.level) : ""}</p><h1>${esc(t.title)}</h1>${v.who ? `<p class="muted">${esc(v.who)}</p>` : ""}</div></div>
  ${top}<div class="sheet">${t.instructions ? `<p class="muted">${esc(t.instructions)}</p>` : ""}${testBody(t, v.answers, v.mode)}</div>${bottom}`);
}
async function submitTest() {
  const v = S.view; const t = v.test;
  const need = t.questions.filter(q => q.type !== "open").length; const got = t.questions.filter((q, n) => q.type !== "open" && v.answers[n] !== undefined && !(q.type === "multi" && !(v.answers[n] || []).length)).length;
  if (got < need && !(await ask("Nie odpowiedziałeś/aś na wszystkie pytania. Oddać mimo to?", "Oddaj"))) return;
  const score = scoreTest(t, v.answers);
  const res = { assignmentId: v.assignment.id, studentId: S.user.studentId, testId: t.id, answers: v.answers, score, max: maxTest(t), submittedAt: new Date().toISOString() };
  S.busy = true; renderTest();
  try { await B.set("results", v.assignment.id, res); S.data.results[v.assignment.id] = res; S.view = { ...v, mode: "result", result: res }; }
  catch (e) { toast(errMsg(e)); }
  S.busy = false; renderTest(); window.scrollTo(0, 0);
}

/* ---------------- Laura: Maturzyści ---------------- */
function planStudents() { return Object.values(S.data.students).filter(s => S.data.plans[s.id]).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)); }
function nextIndex(plan, st) { const t = today(); const i = plan.lessons.findIndex(l => !(st.done || {})[l.n] && l.date >= t); return i < 0 ? plan.lessons.findIndex(l => !(st.done || {})[l.n]) : i; }
function assignmentFor(sid, testId) { return Object.values(S.data.assignments).find(a => a.studentId === sid && a.testId === testId); }
function renderMaturzysci() {
  const list = planStudents();
  if (!list.length) return `<div class="notice">Nie ma jeszcze planów. Wejdź w <b>Ustawienia</b> i kliknij „Wczytaj plany, czytanki i materiały”.</div>`;
  if (!S.sel || !S.data.plans[S.sel]) S.sel = list[0].id;
  const s = S.data.students[S.sel], plan = S.data.plans[S.sel], st = S.data.planState[S.sel] || {};
  const doneN = plan.lessons.filter(l => (st.done || {})[l.n]).length;
  const res = Object.values(S.data.results).filter(r => r.studentId === s.id && typeof r.score === "number");
  const avg = res.length ? Math.round(res.reduce((a, r) => a + pct(r.score, r.max), 0) / res.length) : null;
  const ni = nextIndex(plan, st);
  const shown = S.showAll ? plan.lessons.map((l, i) => [l, i]) : plan.lessons.map((l, i) => [l, i]).filter(([l, i]) => i >= Math.max(0, ni) - 1);
  const lessonHtml = ([l, i]) => {
    const done = !!(st.done || {})[l.n]; const isNext = i === ni;
    const hw = (l.hw || []).map(h => {
      let act = "";
      if (h.testId) {
        const t = S.data.tests[h.testId]; const a = assignmentFor(s.id, h.testId); const r = a && S.data.results[a.id];
        act = !t ? '<span class="chip">czytanka do przygotowania</span>'
          : r ? `<button class="btn sm ghost" data-act="viewResult" data-id="${a.id}">wynik ${r.score}/${r.max}</button>`
          : a ? `<span class="chip acc">zadane, termin ${fmtDate(a.due)}</span>`
          : `<button class="btn sm mustard" data-act="assignFromPlan" data-test="${h.testId}" data-i="${i}">Zadaj w aplikacji</button>`;
        if (t) act = `<button class="btn sm ghost" data-act="previewTest" data-id="${h.testId}">podgląd</button>` + act;
      }
      return `<div class="hwi"><span class="t">${esc(h.text)}</span>${act}</div>`;
    }).join("");
    return `<details class="lesson ${done ? "done" : ""} ${isNext ? "next" : ""}" ${isNext ? "open" : ""}><summary><span class="num">${l.n}</span><span class="date">${fmtDate(l.date)}${l.time ? ", " + l.time : ""}</span><span class="ttl">${esc(l.title)}</span>
    <span class="chips">${l.phase ? `<span class="chip ${l.phase === "Arkusze" ? "mus" : "acc"}">${esc(l.phase)}</span>` : ""}${done ? '<span class="chip ok">zrobione</span>' : isNext ? '<span class="chip mus">następna</span>' : ""}</span></summary>
    <div class="lbody">${l.goal ? `<p><b>Cel:</b> ${esc(l.goal)}</p>` : ""}
    <div class="blocks">${(l.blocks || []).map(b => `<div class="blk"><span class="min">${b.min ? b.min + "′" : ""}</span><div><b>${esc(b.what)}</b>${b.items && b.items.length ? `<ul>${b.items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div></div>`).join("")}</div>
    ${(l.mats || []).length ? `<div class="chips"><span class="eyebrow">Materiał na lekcję</span>${l.mats.map(k => { const id = "z" + pad(k); const m = S.data.materials[id]; const p = S.sel === "michal" && S.data.materials[id + "p"]; return (m ? `<button class="btn sm mustard" data-act="openMat" data-id="${id}">Zestaw ${pad(k)}</button>` : `<span class="chip">Zestaw ${pad(k)} – do przygotowania</span>`) + (p ? `<button class="btn sm primary" data-act="openMat" data-id="${id}p">Zestaw ${pad(k)} PLUS</button>` : ""); }).join("")}</div>` : ""}
    ${hw ? `<div class="hw"><p class="eyebrow">Praca domowa</p>${hw}</div>` : ""}
    <label class="f">Twoje notatki<textarea data-note="${l.n}" placeholder="np. co poszło słabo, co powtórzyć">${esc((st.notes || {})[l.n] || "")}</textarea></label>
    <div class="chips"><label class="check"><input type="checkbox" data-act="toggleDone" data-n="${l.n}" ${done ? "checked" : ""}> Lekcja zrobiona</label>
    <button class="btn sm" data-act="saveNote" data-n="${l.n}">Zapisz notatkę</button>
    <button class="btn sm ghost" data-act="shift" data-i="${i}" title="Ta i kolejne lekcje przesuwają się o jeden termin">Przesuń od tej lekcji o termin</button></div></div></details>`;
  };
  return `<div class="head"><div><p class="eyebrow">Angielski · matura rozszerzona</p><h1>Maturzyści</h1></div></div>
  <div class="pills">${list.map(x => `<button data-act="sel" data-id="${x.id}" aria-pressed="${x.id === S.sel}">${esc(x.name)}</button>`).join("")}</div>
  <section class="panel"><div class="head"><div><h2>${esc(s.name)} <span class="chip mus">cel: ${esc(s.goal || "")}</span></h2><p class="muted small">${esc(plan.schedule || "")}</p></div></div>
  ${plan.profile ? `<p>${esc(plan.profile)}</p>` : ""}
  <div class="stats"><div class="stat"><span class="small muted">Lekcje zrobione</span><b>${doneN}/${plan.lessons.length}</b></div><div class="stat"><span class="small muted">Średnia z testów w aplikacji</span><b>${avg === null ? "–" : avg + "%"}</b></div><div class="stat"><span class="small muted">Materiał do</span><b>${esc(plan.materialEnd || "31 mar")}</b></div></div>
  ${plan.approach ? `<details><summary class="small" style="cursor:pointer;color:var(--accent);font-weight:600">Jak pracujemy z tą osobą</summary><ul class="small">${plan.approach.map(x => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}</section>
  <div class="pills"><button data-act="engView" data-k="plan" aria-pressed="${S.engView !== "testy"}">Plan lekcji</button><button data-act="engView" data-k="testy" aria-pressed="${S.engView === "testy"}">Testy z działów 1–14</button></div>
  ${S.engView === "testy" ? renderEngTests(s.id) : `<div class="head"><div><h2>Plan lekcji</h2></div><button class="btn sm" data-act="toggleAll">${S.showAll ? "Pokaż od bieżącej" : "Pokaż wszystkie (" + plan.lessons.length + ")"}</button></div>
  <div class="list">${shown.map(lessonHtml).join("")}</div>`}`;
}
const ENG_AREAS = ["Człowiek", "Miejsce zamieszkania", "Edukacja", "Praca", "Życie prywatne", "Żywienie", "Zakupy i usługi", "Podróżowanie i turystyka", "Kultura", "Sport", "Zdrowie", "Nauka i technika", "Świat przyrody", "Życie społeczne"];
function engStats(sid) {
  const t = (S.data.engProgress[sid] || {}).topics || {}; const out = {};
  for (const kind of ["v", "w"]) { const xs = ENG_AREAS.map((_, i) => t[kind + pad(i + 1)]).filter(x => x && x.done); const p = xs.filter(x => typeof x.pct === "number"); out[kind] = { done: xs.length, avg: p.length ? Math.round(p.reduce((a, x) => a + x.pct, 0) / p.length) : null }; }
  return out;
}
function renderEngTests(sid) {
  const t = (S.data.engProgress[sid] || {}).topics || {}; const st = engStats(sid);
  const cell = (k, label) => { const x = t[k] || {}; return `<div style="display:grid;gap:4px;min-width:150px"><span class="small muted">${label}</span><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label class="check"><input type="checkbox" data-edone="${k}" ${x.done ? "checked" : ""}> zrobione</label><input type="number" min="0" max="100" inputmode="numeric" data-epct="${k}" value="${typeof x.pct === "number" ? x.pct : ""}" placeholder="%" style="width:76px" aria-label="${label} w procentach">${pctChip(x.pct)}</div></div>`; };
  return `<section class="panel"><div class="stats"><div class="stat"><span class="small muted">Testy ze słownictwa</span><b>${st.v.done}/14${st.v.avg === null ? "" : " · " + st.v.avg + "%"}</b></div><div class="stat"><span class="small muted">Wypracowania</span><b>${st.w.done}/14${st.w.avg === null ? "" : " · " + st.w.avg + "%"}</b></div></div>
  <p class="small muted">Wpisz wynik w procentach – zapisuje się sam i oznacza zadanie jako zrobione. Wypracowanie możesz też tylko odhaczyć.</p></section>
  <div class="list">${ENG_AREAS.map((n, i) => `<div class="row"><span class="num">${i + 1}</span><span class="grow"><b>${esc(n)}</b></span>${cell("v" + pad(i + 1), "Test")}${cell("w" + pad(i + 1), "Wypracowanie")}</div>`).join("")}</div>`;
}
async function saveEng(sid, k, patch) {
  const ep = S.data.engProgress[sid] || { id: sid, topics: {} }; ep.topics = ep.topics || {};
  ep.topics[k] = { ...(ep.topics[k] || {}), ...patch, date: new Date().toISOString() }; S.data.engProgress[sid] = ep;
  await B.update("engProgress", sid, { topics: { [k]: ep.topics[k] } });
}


/* ---------------- Laura: matura z matematyki (wyniki z działów) ---------------- */
const MATH_TOPICS = ["Liczby", "Logarytmy", "Procenty", "Wartość bezwzględna", "Równania i nierówności", "Funkcja liniowa", "Równanie prostej", "Układ równań liniowych", "Funkcja kwadratowa", "Wielomiany i wyrażenia algebraiczne", "Funkcje i wykresy", "Ciągi", "Trygonometria", "Planimetria", "Stereometria", "Geometria analityczna", "Statystyka", "Kombinatoryka", "Rachunek prawdopodobieństwa", "Dowody algebraiczne"];
const MATH_DEFAULT = ["1755f4c6-dab0-4b23-85db-fde8d315a6a6", "42c91f5f-fdf2-40f1-a126-5dd12ecbfb10", "d746ae16-319c-41cc-86d1-7580ed07586b", "c30636f9-f61c-41b7-925f-0aa9c2c74a46", "maja", "dc67cb6a-8864-4384-ab7a-dd2df65a7bc1", "f1759b5c-8e20-4498-8b8a-c6d78ce16c3b"];
const MATH_SHORT = ["Liczby", "Log.", "Proc.", "|x|", "Równ./nier.", "F. lin.", "Prosta", "Układy", "F. kw.", "Wielom.", "Funkcje", "Ciągi", "Tryg.", "Planim.", "Stereo.", "Geom. an.", "Stat.", "Komb.", "Prawd.", "Dowody"];
const MATH_KEYS = ["t01", "t02", "t03", "t20", "t04", "t05", "t06", "t07", "t08", "t09", "t10", "t11", "t12", "t13", "t14", "t15", "t16", "t17", "t18", "t19"];
const tkey = i => MATH_KEYS[i];
const pctChip = p => p === undefined || p === null || p === "" ? "" : `<span class="chip ${p >= 70 ? "ok" : p >= 50 ? "warn" : "bad"}">${p}%</span>`;
function mathStats(sid) {
  const t = (S.data.mathProgress[sid] || {}).topics || {};
  const vals = MATH_TOPICS.map((_, i) => t[tkey(i)]).filter(x => x && x.done);
  const withPct = vals.filter(x => typeof x.pct === "number");
  return { done: vals.length, avg: withPct.length ? Math.round(withPct.reduce((a, x) => a + x.pct, 0) / withPct.length) : null };
}
function renderMatematyka() {
  const list = Object.values(S.data.students).filter(s => s.mathMatura).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  const others = Object.values(S.data.students).filter(s => !s.mathMatura).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  const addForm = `<div class="frow"><label class="f">Dopisz maturzystę<select id="mathAddSel">${others.map(s => `<option value="${s.id}">${esc(s.name)}${s.klasa ? " (" + esc(s.klasa) + ")" : ""}</option>`).join("")}</select></label><button class="btn" data-act="mathAdd">Dopisz</button></div>`;
  const head = `<div class="head"><div><p class="eyebrow">Testy z działów · wyniki wpisujesz ręcznie</p><h1>Matura z matematyki</h1></div></div>`;
  if (!list.length) {
    const found = MATH_DEFAULT.filter(id => S.data.students[id]).map(id => S.data.students[id].name);
    return head + `<section class="panel"><p>Nie ma jeszcze maturzystów z matematyki.</p>${found.length ? `<div><button class="btn primary" data-act="mathDefaults">Dodaj: ${esc(found.join(", "))}</button></div>` : '<p class="small muted">Najpierw zaimportuj uczniów w Ustawieniach.</p>'}${others.length ? addForm : ""}</section>`;
  }
  if (!S.selM || (S.selM !== "__all" && !list.find(s => s.id === S.selM))) S.selM = "__all";
  const pills = `<div class="pills"><button data-act="selM" data-id="__all" aria-pressed="${S.selM === "__all"}">Przegląd</button>${list.map(s => `<button data-act="selM" data-id="${s.id}" aria-pressed="${s.id === S.selM}">${esc(s.name)}</button>`).join("")}</div>`;
  if (S.selM === "__all") {
    const rows = list.map(s => { const t = (S.data.mathProgress[s.id] || {}).topics || {}; const st = mathStats(s.id);
      return `<tr><td><button class="btn sm ghost" data-act="selM" data-id="${s.id}">${esc(s.name)}</button></td><td>${st.done}/${MATH_TOPICS.length}</td><td>${st.avg === null ? "–" : pctChip(st.avg)}</td>${MATH_TOPICS.map((_, i) => { const x = t[tkey(i)]; return `<td>${x && x.done ? (typeof x.pct === "number" ? pctChip(x.pct) : '<span class="chip ok">✓</span>') : '<span class="muted">–</span>'}</td>`; }).join("")}</tr>`; }).join("");
    return head + pills + `<section class="panel"><p class="small muted">Kliknij imię, żeby wpisać wyniki. Po najechaniu na skrót zobaczysz pełną nazwę działu. Zielone ≥ 70%, żółte 50–69%, czerwone &lt; 50%.</p><div class="tablewrap"><table class="compact"><thead><tr><th>Uczeń</th><th>Działy</th><th>Średnia</th>${MATH_TOPICS.map((n, i) => `<th title="${i + 1}. ${esc(n)}">${esc(MATH_SHORT[i])}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>` + `<section class="panel">${others.length ? addForm : ""}</section>`;
  }
  const s = S.data.students[S.selM]; const t = (S.data.mathProgress[s.id] || {}).topics || {}; const st = mathStats(s.id);
  const items = MATH_TOPICS.map((n, i) => { const k = tkey(i); const x = t[k] || {};
    return `<div class="row"><span class="num">${i + 1}</span><span class="grow"><b>${esc(n)}</b>${x.date ? `<span class="small muted">wpisane ${new Date(x.date).toLocaleDateString("pl-PL")}</span>` : ""}</span>
    <label class="check"><input type="checkbox" data-mdone="${k}" ${x.done ? "checked" : ""}> zrobione</label>
    <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input type="number" min="0" step="0.5" inputmode="decimal" data-mpts="${k}" value="${typeof x.pts === "number" ? x.pts : ""}" placeholder="pkt" style="width:72px" aria-label="Punkty: ${esc(n)}"><span class="muted">na</span><input type="number" min="1" step="0.5" inputmode="decimal" data-mmax="${k}" value="${typeof x.max === "number" ? x.max : (mathMaxDefault(k) ?? "")}" placeholder="max" style="width:72px" aria-label="Maksymalna liczba punktów: ${esc(n)}"><span class="muted small">pkt</span></span>${pctChip(x.pct)}</div>`; }).join("");
  return head + pills + `<section class="panel"><div class="head"><div><h2>${esc(s.name)}</h2><p class="small muted">${esc(s.klasa || "")}</p></div><button class="btn sm ghost" data-act="mathRemove" data-id="${s.id}">Usuń z maturzystów</button></div>
  <div class="stats"><div class="stat"><span class="small muted">Działy zrobione</span><b>${st.done}/${MATH_TOPICS.length}</b></div><div class="stat"><span class="small muted">Średni wynik</span><b>${st.avg === null ? "–" : st.avg + "%"}</b></div></div>
  <p class="small muted">Wpisz, ile punktów uczeń zdobył i na ile był test – procent liczy się sam, a dział oznacza się jako zrobiony. Maksymalna liczba punktów podpowiada się z wyników innych uczniów.</p></section><div class="list">${items}</div>`;
}
function mathMaxDefault(k) { for (const p of Object.values(S.data.mathProgress || {})) { const x = (p.topics || {})[k]; if (x && typeof x.max === "number") return x.max; } return null; }
async function saveMath(sid, k, patch) {
  const mp = S.data.mathProgress[sid] || { id: sid, topics: {} }; mp.topics = mp.topics || {};
  mp.topics[k] = { ...(mp.topics[k] || {}), ...patch, date: new Date().toISOString() }; S.data.mathProgress[sid] = mp;
  await B.update("mathProgress", sid, { topics: { [k]: mp.topics[k] } });
}


/* ---------------- Laura: materiały na lekcje ---------------- */
const MAT_CATS = [["ang-pr", "Angielski – rozszerzenie"], ["ang-c1", "Angielski – C1 PLUS"], ["ang-pp", "Angielski – podstawa"], ["mat", "Matematyka"]];
(function () { const st = document.createElement("style"); st.textContent = `.md{max-width:780px;display:grid;gap:12px}.md h2{font-size:20px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}.md h3{font-size:16px;margin-top:6px}.md p{line-height:1.65}.md .mdq{margin:0;background:var(--surface);border-left:3px solid var(--mustard);padding:10px 16px;border-radius:6px;display:grid;gap:8px}.md ol,.md ul{margin:0;padding-left:24px;display:grid;gap:6px}.md ul.mdsub{list-style:none;padding-left:4px;margin-top:4px;gap:2px}.md table td,.md table th{white-space:normal;vertical-align:top}.keybox{border:1px dashed var(--accent);border-radius:var(--r);padding:16px;background:var(--accent-soft)}#printArea{display:none}
@media print{@page{size:A4;margin:16mm 15mm}body{background:#fff!important;padding:0!important}#app,.toast,.ov{display:none!important}#printArea{display:block!important;color:#000;font:11.5pt/1.5 var(--f)}
#printArea .pbrand{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #5b2a86;padding-bottom:6px;margin-bottom:14px;font-size:9pt;color:#5b2a86;font-weight:700;letter-spacing:.08em}
#printArea h1{font-size:18pt;margin:0 0 10px}#printArea .md{max-width:none;gap:8px}#printArea .md h2{font-size:14pt;border-top:1px solid #bbb;margin-top:10px;padding-top:10px}
#printArea .md .mdq{background:#f4f1f8;border-left:3px solid #d9a21b;break-inside:avoid}#printArea table{break-inside:avoid;width:100%;border-collapse:collapse}#printArea th,#printArea td{border:1px solid #ccc;padding:4px 7px;white-space:normal;font-size:10.5pt}
#printArea .pbreak{break-before:page;page-break-before:always}#printArea p,#printArea li{orphans:3;widows:3}#printArea .md ol>li{break-inside:avoid}
#printArea .namebox{display:flex;gap:24px;margin-bottom:12px;font-size:10.5pt}#printArea .namebox span{flex:1;border-bottom:1px solid #999;padding-bottom:2px}}`; document.head.appendChild(st); })();
function inl(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<i>$2</i>"); }
function md(src) {
  const L = String(src || "").replace(/\r/g, "").split("\n"); const out = []; let i = 0;
  const special = l => /^(#{2,3}\s|>|\s*\||\d+\.\s|-\s)/.test(l);
  while (i < L.length) {
    const l = L[i]; let m;
    if (!l.trim()) { i++; continue; }
    if ((m = l.match(/^(#{2,3})\s+(.*)/))) { const h = m[1].length; out.push(`<h${h}>${inl(m[2])}</h${h}>`); i++; continue; }
    if (l.startsWith(">")) { const q = []; while (i < L.length && L[i].startsWith(">")) { q.push(L[i].replace(/^>\s?/, "")); i++; } out.push(`<blockquote class="mdq">${md(q.join("\n"))}</blockquote>`); continue; }
    if (l.trim().startsWith("|")) {
      const rows = []; while (i < L.length && L[i].trim().startsWith("|")) { rows.push(L[i].trim()); i++; }
      const cells = r => r.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^\|[\s:|-]+\|$/.test(r)));
      out.push(`<div class="tablewrap"><table>${body.map((r, k) => `<tr>${cells(r).map(c => k === 0 ? `<th>${inl(c)}</th>` : `<td>${inl(c)}</td>`).join("")}</tr>`).join("")}</table></div>`); continue;
    }
    if (/^\d+\.\s/.test(l) || /^-\s/.test(l)) {
      const ordered = /^\d+\.\s/.test(l); const re = ordered ? /^\d+\.\s/ : /^-\s/; const items = [];
      while (i < L.length && (re.test(L[i]) || (/^\s{2,}-\s/.test(L[i]) && items.length))) { if (re.test(L[i])) items.push({ t: L[i].replace(re, ""), sub: [] }); else items[items.length - 1].sub.push(L[i].replace(/^\s+-\s/, "")); i++; }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map(it => `<li>${inl(it.t)}${it.sub.length ? `<ul class="mdsub">${it.sub.map(x => `<li>${inl(x)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</${tag}>`); continue;
    }
    const p = []; while (i < L.length && L[i].trim() && !special(L[i])) { p.push(L[i]); i++; }
    out.push(`<p>${inl(p.join(" "))}</p>`);
  }
  return out.join("");
}
function renderMaterialy() {
  const all = Object.values(S.data.materials).sort((a, b) => (a.no || 0) - (b.no || 0) || a.title.localeCompare(b.title, "pl"));
  const cat = S.matCat || "all";
  let list = cat === "all" ? all : all.filter(m => m.category === cat);
  const ns = S.matNot || ""; if (ns) list = list.filter(m => !givenTo(ns, m.id).length);
  const used = id => planStudents().filter(s => S.data.plans[s.id].lessons.some(l => (l.mats || []).some(k => "z" + pad(k) === id))).map(s => s.name);
  return `<div class="head"><div><p class="eyebrow">Wspólne dla wszystkich uczniów</p><h1>Materiały na lekcje</h1></div></div>
  <div class="pills"><button data-act="matCat" data-k="all" aria-pressed="${cat === "all"}">Wszystkie</button>${MAT_CATS.map(([k, l]) => `<button data-act="matCat" data-k="${k}" aria-pressed="${cat === k}">${l}</button>`).join("")}</div>
  ${searchBox("mat", "np. słowotwórstwo, Człowiek, Present Perfect, zestaw 01")}
  <label class="f" style="max-width:360px">Pokaż tylko te, których nie dostał/a<select id="matNot"><option value="">— wszyscy —</option>${activeStudents().map(s => `<option value="${s.id}" ${s.id === ns ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
  <div class="list">${list.map(m => { const u = used(m.id); return `<button class="row" data-act="openMat" data-id="${m.id}" data-s-mat="${esc(matText(m))}"><span class="grow"><b>${esc(m.title)}</b><span class="small muted">${esc(m.topic || "")}${u.length ? " · w planie: " + esc(u.join(", ")) : ""}</span>${(() => { const g = matGivenNames(m.id); return g.length ? `<span class="small" style="color:var(--ok);font-weight:600">✓ dostali: ${esc(g.join(", "))}</span>` : ""; })()}</span><span class="chip acc">${esc((MAT_CATS.find(c => c[0] === m.category) || ["", ""])[1])}</span></button>`; }).join("") || '<p class="empty">Brak materiałów w tej kategorii.</p>'}</div>
  <form class="panel" id="importMat"><h2>Dodaj materiał z kodu</h2><p class="small muted">Wklej kod materiału, który przygotuje Ci Claude.</p><textarea name="json" rows="4" placeholder='{"id":"z02","title":"...","body":"..."}'></textarea><div><button class="btn primary" type="submit">Dodaj materiał</button></div></form>`;
}

function printMat(withKey) {
  const m = S.data.materials[S.view.id]; if (!m) return;
  let pa = document.getElementById("printArea"); if (!pa) { pa = document.createElement("div"); pa.id = "printArea"; document.body.appendChild(pa); }
  pa.innerHTML = `<div class="pbrand"><span>PEWNY EGZAMIN</span><span>${esc((MAT_CATS.find(c => c[0] === m.category) || ["", ""])[1])}</span></div>
  <div class="namebox"><span>Imię i nazwisko:</span><span>Data:</span></div><h1>${esc(m.title)}</h1><div class="md">${md(m.body)}</div>
  ${withKey && m.key ? `<div class="pbreak" style="color:#888;font-size:10pt;text-align:center;padding-top:40mm">Ta strona jest celowo pusta.<br>Odpowiedzi znajdziesz na następnej stronie – najpierw rozwiąż wszystkie zadania.</div><div class="pbreak md"><h2 style="border:0;margin-top:0;padding-top:0">Odpowiedzi</h2>${md(m.key)}</div>` : ""}`;
  const old = document.title; document.title = m.title.replace(/[:·]/g, " -").replace(/\s+/g, " ") + (withKey ? "" : " (bez odpowiedzi)");
  setTimeout(() => { window.print(); document.title = old; }, 50);
}
function renderMat() {
  const m = S.data.materials[S.view.id]; if (!m) { S.view = null; return render(); }
  root.innerHTML = frame(`<div class="head"><div><button class="btn sm ghost" data-act="back" style="justify-self:start">← Wróć</button><p class="eyebrow">${esc((MAT_CATS.find(c => c[0] === m.category) || ["", ""])[1])}</p><h1>${esc(m.title)}</h1></div>
  <div class="acts">${m.key ? `<button class="btn ${S.view.showKey ? "" : "mustard"}" data-act="toggleKey">${S.view.showKey ? "Ukryj klucz" : "Pokaż klucz odpowiedzi"}</button>` : ""}
  <button class="btn mustard" data-act="giveMat">Daj uczniowi</button><button class="btn primary" data-act="printMat" data-key="1">PDF z odpowiedziami</button><button class="btn" data-act="printMat" data-key="0">PDF bez odpowiedzi</button></div></div>
  <article class="md">${md(m.body)}</article>
  ${m.key && S.view.showKey ? `<section class="keybox md"><h2 style="border:0;margin:0;padding:0">Klucz odpowiedzi</h2>${md(m.key)}</section>` : ""}`);
}


/* ---------------- wyszukiwarka ---------------- */
const norm = x => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
S.q = S.q || {};
function searchBox(key, ph) { return `<label class="f"><span class="eyebrow">Szukaj</span><input type="search" id="q-${key}" data-filter="${key}" value="${esc(S.q[key] || "")}" placeholder="${esc(ph)}" autocomplete="off"></label><p class="small muted" id="qn-${key}"></p>`; }
function applyFilter(key) {
  const inp = root.querySelector(`[data-filter="${key}"]`); if (!inp) return;
  const words = norm(inp.value).split(/\s+/).filter(Boolean); let shown = 0, total = 0;
  root.querySelectorAll(`[data-s-${key}]`).forEach(el => { total++; const ok = words.every(w => el.getAttribute(`data-s-${key}`).includes(w)); el.hidden = !ok; if (ok) shown++; });
  const info = root.querySelector(`#qn-${key}`); if (info) info.textContent = words.length ? (shown ? `Znaleziono: ${shown} z ${total}` : "Nic nie znaleziono – spróbuj innego słowa.") : "";
}
const testText = t => norm([t.title, t.topic, t.level, (t.passages || []).map(p => p.title + " " + p.text).join(" "), (t.questions || []).map(q => q.t + " " + (q.o || []).join(" ")).join(" ")].join(" "));
const matText = m => norm([m.title, m.topic, (MAT_CATS.find(c => c[0] === m.category) || ["", ""])[1], m.body, m.key].join(" "));


/* ---------------- Laura: płatności ---------------- */
function renderPlatnosci() {
  const L = Object.values(S.data.lessons), P = Object.values(S.data.payments);
  const rows = Object.values(S.data.students).map(s => { const ls = L.filter(l => l.studentId === s.id), ps = P.filter(p => p.studentId === s.id); return { s, ls, ps, b: balanceOf(ls, ps), nx: nextLessons(ls, 1)[0] }; })
    .filter(r => r.ls.length || r.ps.length).sort((a, b) => b.b.bal - a.b.bal || a.s.name.localeCompare(b.s.name, "pl"));
  if (S.selP && S.data.students[S.selP]) {
    const r = rows.find(x => x.s.id === S.selP) || { s: S.data.students[S.selP], ls: [], ps: [], b: balanceOf([], []) };
    const recent = r.ls.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const t = today(); const past = recent.filter(l => l.date < t || l.status !== "planned" && l.date <= t).slice(-30), up = recent.filter(l => l.date >= t).slice(0, 6);
    const lrow = l => { const st = effStatus(l); return `<div class="row"><span class="grow"><b>${esc(fmtDate(l.date))}, ${esc(l.time || "")}</b><span class="small muted">${esc(SUBJ[l.subject] || l.subject || "")} · ${zl(Number(l.price) || 0)}${l.note ? " · " + esc(l.note) : ""}</span></span><span class="chip ${st === "done" ? "ok" : st === "cancelled" ? "bad" : ""}">${st === "done" ? "odbyta" : st === "cancelled" ? "odwołana" : "zaplanowana"}</span><button class="btn sm ghost" data-act="lessonToggle" data-id="${l.id}">${st === "cancelled" ? "Przywróć" : "Odwołaj"}</button></div>`; };
    return `<div class="head"><div><button class="btn sm ghost" data-act="selP" data-id="" style="justify-self:start">← Wszyscy</button><p class="eyebrow">Rozliczenie · to samo widzi uczeń</p><h1>${esc(r.s.name)}</h1></div></div>
    <div class="stats">${balanceBlock(r.b)}</div>
    <form class="panel" id="addPay"><h2>Dodaj wpłatę</h2><div class="frow"><label class="f">Kwota (zł)<input type="number" name="amount" min="1" step="0.01" required></label><label class="f">Data<input type="date" name="date" value="${today()}" required></label><label class="f">Sposób<select name="method"><option>przelew</option><option>gotówka</option><option>BLIK</option></select></label><button class="btn primary" type="submit">Dodaj</button></div></form>
    <section class="panel"><h2>Wpłaty</h2>${r.b.pays.length ? r.b.pays.sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(p => `<div class="row"><span class="grow"><b>${zl(Number(p.amount) || 0)}</b><span class="small muted">${esc(fmtDate(p.date))} · ${esc(p.method || "")}</span></span><button class="btn sm ghost" data-act="delPay" data-id="${p.id}">usuń</button></div>`).join("") : '<p class="empty">Brak wpłat.</p>'}</section>
    <section class="panel"><h2>Najbliższe lekcje</h2><div class="list">${up.map(lrow).join("") || '<p class="empty">Brak.</p>'}</div></section>
    <section class="panel"><h2>Ostatnie lekcje</h2><p class="small muted">Lekcja z minionego dnia liczy się jako odbyta, chyba że ją odwołasz – tak jak w aplikacji dla korepetytorki.</p><div class="list">${past.reverse().map(lrow).join("") || '<p class="empty">Jeszcze żadnych.</p>'}</div></section>`;
  }
  const allP = Object.values(S.data.payments).filter(p => !isCharge(p)).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 15);
  return `<div class="head"><div><p class="eyebrow">Stan na dziś · to samo widzi uczeń</p><h1>Płatności</h1></div><div class="acts"><button class="btn primary" data-act="newPayment">+ Wpłata</button><button class="btn" data-act="newCharge">+ Zaległość</button></div></div>
  <div class="list">${rows.map(r => `<button class="row" data-act="selP" data-id="${r.s.id}"><span class="grow"><b>${esc(r.s.name)}</b><span class="small muted">za lekcje ${zl(r.b.due)} · wpłaty ${zl(r.b.paid)}${r.nx ? " · następna: " + esc(fmtDate(r.nx.date) + ", " + (r.nx.time || "")) : ""}</span></span><span class="chip ${r.b.bal > 0 ? "bad" : "ok"}">${r.b.bal > 0 ? "do zapłaty " + zl(r.b.bal) : r.b.bal < 0 ? "nadpłata " + zl(-r.b.bal) : "opłacone"}</span></button>`).join("") || '<p class="empty">Brak danych.</p>'}</div>
  ${allP.length ? `<section class="panel"><h2>Ostatnie wpłaty</h2><div class="list">${allP.map(p => `<div class="row"><span class="grow"><b>${esc(sName(p.studentId))} · ${zl(Number(p.amount) || 0)}</b><span class="small muted">${esc(fmtDate(p.date))}${p.method ? " · " + esc(p.method) : ""}${p.note ? " · " + esc(p.note) : ""}</span></span><button class="btn sm ghost" data-act="delPay" data-id="${p.id}">usuń</button></div>`).join("")}</div></section>` : ""}`;
}

/* ---------------- Laura: zadania ---------------- */
function renderZadania() {
  const st = Object.values(S.data.students).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  const ts = Object.values(S.data.tests).sort((a, b) => a.title.localeCompare(b.title, "pl"));
  const as = Object.values(S.data.assignments).sort((a, b) => (b.due || "").localeCompare(a.due || ""));
  return `<div class="head"><div><p class="eyebrow">Testy i zadania własne</p><h1>Zadania domowe</h1></div></div>
  <form class="panel" id="assignForm" style="display:grid;gap:12px"><h2>Zadaj zadanie</h2>${assignFormHtml(null)}</form>
  <section class="panel"><h2>Wszystkie zadania</h2>${as.length ? `<div class="tablewrap"><table><thead><tr><th>Uczeń</th><th>Zadanie</th><th>Termin</th><th>Wynik</th><th></th></tr></thead><tbody>
  ${as.map(a => { const r = S.data.results[a.id]; const s = S.data.students[a.studentId]; const cu = ownKind(a);
    return `<tr class="${r && !cu ? "click" : ""}" ${r && !cu ? `data-act="viewResult" data-id="${a.id}"` : ""}><td>${esc(s ? s.name : "?")}</td><td style="white-space:normal">${esc(taskTitle(a))}${cu ? ` <span class="chip">${a.kind === "material" ? "materiał" : "własne"}</span>` : ""}</td><td>${fmtDate(a.due)}</td><td>${cu ? (r ? '<span class="chip ok">zrobione</span>' : `${a.due && a.due < today() ? '<span class="chip bad">po terminie</span> ' : ""}<button class="btn sm" data-act="doneCustom" data-id="${a.id}">Odhacz</button>`) : r ? `<span class="chip ${pct(r.score, r.max) >= 70 ? "ok" : pct(r.score, r.max) >= 50 ? "warn" : "bad"}">${r.score}/${r.max} · ${pct(r.score, r.max)}%</span>` : a.due < today() ? '<span class="chip bad">po terminie</span>' : '<span class="chip">czeka</span>'}</td>
    <td>${r ? "" : `<button class="btn sm ghost" data-act="delAssign" data-id="${a.id}">usuń</button>`}</td></tr>`; }).join("")}</tbody></table></div>` : '<p class="empty">Nic jeszcze nie zadano.</p>'}</section>`;
}

/* ---------------- Laura: bank testów ---------------- */
function renderTesty() {
  const ts = Object.values(S.data.tests).sort((a, b) => (a.level || "").localeCompare(b.level || "") || a.title.localeCompare(b.title, "pl"));
  return `<div class="head"><div><p class="eyebrow">Czytanki i testy</p><h1>Bank testów</h1></div></div>
  ${searchBox("testy", "np. Człowiek, B2+, personality, czytanka 1")}
  <div class="list">${ts.map(t => `<div class="row" data-s-testy="${esc(testText(t))}"><span class="grow"><b>${esc(t.title)}</b><span class="small muted">${esc(t.topic || "")} · ${t.questions.length} pytań${t.passages && t.passages.length ? " · z tekstem" : ""}</span></span><span class="chip acc">${esc(t.level || "")}</span><button class="btn sm" data-act="previewTest" data-id="${t.id}">Podgląd</button></div>`).join("") || '<p class="empty">Brak testów.</p>'}</div>
  <form class="panel" id="importForm"><h2>Dodaj test z kodu</h2><p class="small muted">Wklej kod testu, który przygotuje Ci Claude (jeden test albo listę testów).</p><textarea name="json" rows="5" placeholder='{"id":"...","title":"...","questions":[...]}'></textarea><div><button class="btn primary" type="submit">Dodaj do banku</button></div></form>`;
}

/* ---------------- Laura: uczniowie ---------------- */
function loginModal(s) {
  const ov = document.createElement("div"); ov.className = "ov";
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><header><h2>Konto dla: ${esc(s.name)}</h2><button class="x" data-x>×</button></header>
  <form class="mb" id="mkLogin"><label class="f">E-mail ucznia<input type="email" name="email" required></label><label class="f">Hasło startowe<input name="pw" value="${genPass()}" minlength="6" required></label>
  <p class="small muted">Uczeń może później zmienić hasło przyciskiem „Nie pamiętam hasła”.</p><div id="mkOut"></div>
  <footer style="padding:0;border:0"><button class="btn" type="button" data-x>Zamknij</button><button class="btn primary" type="submit">Utwórz konto</button></footer></form></div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", e => { if (e.target === ov || e.target.closest("[data-x]")) { ov.remove(); render(); } });
  ov.querySelector("#mkLogin").addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(e.target); const email = f.get("email").trim(), pw = f.get("pw").trim();
    const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
    try {
      const uid = await B.createLogin(email, pw);
      await B.set("users", uid, { role: "student", studentId: s.id, name: s.name, email });
      await B.update("students", s.id, { loginEmail: email, uid });
      S.data.students[s.id] = { ...s, loginEmail: email, uid };
      const msg = `Cześć ${s.name}! Tu Twoja aplikacja z zadaniami:\n${APP_URL}\n\nE-mail: ${email}\nHasło: ${pw}\n\nNa telefonie dodaj ją do ekranu głównego, będzie jak zwykła aplikacja.`;
      ov.querySelector("#mkOut").innerHTML = `<p class="small"><b>Gotowe.</b> Skopiuj i wyślij uczniowi:</p><pre class="copy">${esc(msg)}</pre><button class="btn sm" type="button" id="cp">Kopiuj wiadomość</button>`;
      ov.querySelector("#cp").onclick = () => { navigator.clipboard && navigator.clipboard.writeText(msg).then(() => toast("Skopiowano")); };
      btn.remove();
    } catch (err) { toast(errMsg(err)); btn.disabled = false; }
  });
}

/* ---------------- Laura: ustawienia ---------------- */
function renderUstawienia() {
  return `<div class="head"><div><p class="eyebrow">Konfiguracja</p><h1>Ustawienia</h1></div></div>
  ${contactPanelHtml()}
  <section class="panel"><h2>Plany i czytanki startowe</h2><p class="small muted">Wczytuje uczniów-maturzystów, ich plany lekcji, czytanki i materiały na lekcje. Istniejące zapisy (zrobione lekcje, notatki, wyniki) zostają. Plany zostaną nadpisane wersją z pliku.</p>
  <div class="chips"><button class="btn primary" data-act="seed">Wczytaj plany, czytanki i materiały</button></div></section>
  <section class="panel"><h2>Import z poprzedniej aplikacji</h2><p class="small muted">Wgraj plik <b>przeniesienie-ze-starej-aplikacji.json</b>. Przeniesie lekcje z kalendarza, wpłaty, zaległości i dane kontaktowe uczniów. Lekcje i wpłaty dodane już w tej aplikacji zostaną – import tylko uzupełnia dane ze starej.</p>
  <label class="f">Plik z danymi<input type="file" id="importFile" accept=".json,application/json"></label><p class="small muted" id="importStatus"></p></section>
  <section class="panel"><h2>Link dla uczniów</h2><pre class="copy">${esc(APP_URL)}</pre></section>
  ${B.demo ? `<section class="panel"><h2>Tryb podglądu</h2><p class="small muted">Dane zapisują się tylko w tej przeglądarce. Po połączeniu z Firebase znikną z aplikacji i zaczniesz na czysto.</p><div><button class="btn" data-act="wipe">Wyczyść dane podglądu</button></div></section>` : ""}`;
}
async function seedAll() {
  S.busy = true;
  for (const s of SEED.students || []) { const { id, ...d } = s; await B.update("students", id, d); }
  for (const [k, v] of Object.entries(SEED.plans || {})) await B.set("plans", k, v);
  for (const t of SEED.tests) { const { id, ...d } = t; await B.set("tests", id, d); }
  for (const m of SEED.materials || []) { const { id, ...d } = m; await B.set("materials", id, d); }
  S.busy = false; await loadAdmin(); toast("Wczytano plany i czytanki"); render();
}

/* ================= KOREPETYCJE: kalendarz, dziś, uczniowie, płatności (przeniesione z aplikacji dla korepetytorki) ================= */
const DOWS = ["pon", "wt", "śr", "czw", "pt", "sob", "nd"];
const MONN = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
const MONG = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
const SUBJ_UP = { mat: "Matematyka", ang: "Angielski" }, SUBJ_SHORT = { mat: "mat", ang: "ang" }, LVL = { PP: "podstawa", PR: "rozszerzenie" };
const STATUS = { planned: "zaplanowana", done: "odbyta", cancelled: "odwołana", moved: "przełożona" };
const STATUS_CLS = { planned: "acc", done: "ok", cancelled: "", moved: "warn" };
const parseD = s => new Date(s + "T12:00:00");
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = s => addDays(s, -((parseD(s).getDay() + 6) % 7));
const longDate = s => parseD(s).toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
const monthLabel = ym => { const [y, m] = ym.split("-").map(Number); return `${MONN[m - 1]} ${y}`; };
const byDT = (a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""));
const plural = (n, a, b, c) => n === 1 ? a : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? b : c;
const num = v => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? Math.round(x * 100) / 100 : 0; };
const subjectsOf = s => { if (!s) return []; if (Array.isArray(s.subjects) && s.subjects.length) return s.subjects; return s.subject ? [{ subject: s.subject, level: s.level || "PP", rate: Number(s.rate) || 0 }] : []; };
const rateFor = (s, subj) => { const a = subjectsOf(s); const x = a.find(y => y.subject === subj) || a[0]; return x ? Number(x.rate) || 0 : 0; };
const lessonSubj = l => l.subject || (subjectsOf(S.data.students[l.studentId])[0] || {}).subject || "";
const multiSubj = sid => subjectsOf(S.data.students[sid]).length > 1;
const sName = sid => (S.data.students[sid] || {}).name || "?";
const lzName = l => sName(l.studentId) + (multiSubj(l.studentId) ? " (" + (SUBJ_SHORT[lessonSubj(l)] || "") + ")" : "");
const lessonsArr = () => Object.values(S.data.lessons || {});
const activeStudents = (all) => Object.values(S.data.students).filter(s => all || !s.archived).sort((a, b) => a.name.localeCompare(b.name, "pl"));
const studentOpts = sel => activeStudents().map(s => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
const opts = (o, sel) => Object.entries(o).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
const statusChip = st => `<span class="chip ${STATUS_CLS[st] || ""}">${STATUS[st] || st}</span>`;
const balFor = sid => balanceOf(lessonsArr().filter(l => l.studentId === sid), Object.values(S.data.payments || {}).filter(p => p.studentId === sid));
const panel = (title, inner, sub, acts) => `<section class="panel"><div class="phead"><h2>${title}</h2>${acts || ""}</div>${sub ? `<p class="small muted">${sub}</p>` : ""}${inner}</section>`;
const emptyP = t => `<p class="empty">${t}</p>`;
const schoolYearEnd = () => { const d = new Date(); const y = d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear(); return `${y}-06-26`; };
const endTime = (t, dur) => { const [h, m] = (t || "00:00").split(":").map(Number); const x = h * 60 + m + (Number(dur) || 60); return { mins: x, str: `${pad(Math.floor(x % 1440 / 60))}:${pad(x % 60)}` }; };
const settings = () => S.data.settings || {};

async function putDoc(c, id, data) { await B.set(c, id, data); (S.data[c] = S.data[c] || {})[id] = { id, ...data }; }
async function patchDoc(c, id, d) { await B.update(c, id, d); S.data[c][id] = { ...(S.data[c][id] || { id }), ...d }; }
async function delDoc(c, id) { await B.del(c, id); delete S.data[c][id]; }

function openModal({ title, body, submit, foot = "", wide = false, onMount, onSubmit }) {
  const ov = document.createElement("div"); ov.className = "ov";
  ov.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true"><header><h2>${esc(title)}</h2><button class="x" type="button" data-x aria-label="Zamknij">×</button></header>
  <form class="mb" novalidate>${body}<footer style="padding:0;border:0;justify-content:space-between"><span class="acts">${foot}</span><span class="acts"><button class="btn" type="button" data-x>Anuluj</button>${submit ? `<button class="btn primary" type="submit">${esc(submit)}</button>` : ""}</span></footer></form></div>`;
  const close = () => { ov.remove(); render(); };
  ov.addEventListener("click", e => { if (e.target === ov || e.target.closest("[data-x]")) close(); });
  const f = ov.querySelector("form");
  f.addEventListener("submit", async e => {
    e.preventDefault(); const btn = f.querySelector("[type=submit]"); if (btn) btn.disabled = true;
    try { if (await onSubmit(new FormData(f), f)) close(); } catch (err) { toast(errMsg(err)); }
    if (btn) btn.disabled = false;
  });
  document.body.appendChild(ov); onMount && onMount(f, ov);
  const first = f.querySelector("input:not([type=hidden]),select,textarea"); if (first && !("ontouchstart" in window)) first.focus();
  return { ov, close };
}

/* ---------- automatyczne odhaczanie (jak w starej aplikacji: po północy) ---------- */
let autoBusy = false;
async function autoComplete() {
  if (!S.user || S.user.role !== "admin" || autoBusy || !S.data || !S.data.lessons) return;
  const t = today(); const due = lessonsArr().filter(l => l.status === "planned" && l.date < t);
  if (!due.length) return;
  autoBusy = true; UNDO.off = true;
  try { for (const l of due) { const d = { status: "done", autoDone: true, updatedAt: new Date().toISOString() }; await B.update("lessons", l.id, d); Object.assign(S.data.lessons[l.id], d); } }
  catch (e) { console.warn("auto", e); }
  UNDO.off = false; autoBusy = false;
}
let lastDay = today();
setInterval(async () => { if (today() !== lastDay) { lastDay = today(); await autoComplete(); if (S.user && S.user.role === "admin" && !document.querySelector(".ov")) render(); } }, 60000);

/* ---------- wiersz lekcji ---------- */
function lessonRow(l, { quick = false, showDate = false, showName = true } = {}) {
  const struck = l.status === "moved" || l.status === "cancelled";
  return `<div class="row${struck ? " struck" : ""}"><span class="time">${showDate ? esc(fmtDate(l.date)) + " · " : ""}${esc(l.time || "")}</span>
  <span class="grow"><button class="link" type="button" data-act="editLesson" data-id="${l.id}">${showName ? esc(lzName(l)) : `${esc(SUBJ[lessonSubj(l)] || "")} · ${l.duration || 60} min`}</button>
  <span class="small muted">${showName ? `${l.duration || 60} min · ` : ""}${struck ? "nie liczy się do płatności" : zl(Number(l.price) || 0)}${l.note ? " · " + esc(l.note.split("\n").pop()) : ""}</span></span>
  ${statusChip(l.status)}${quick && l.status === "planned" ? `<button class="btn sm" data-act="setStatus" data-id="${l.id}" data-s="done">Odbyta</button><button class="btn sm ghost" data-act="moveLesson" data-id="${l.id}">Przełóż</button><button class="btn sm ghost" data-act="setStatus" data-id="${l.id}" data-s="cancelled">Odwołana</button>` : ""}</div>`;
}

/* ---------- Dziś ---------- */
function renderDzis() {
  const t = today(); const L = lessonsArr();
  const todayL = L.filter(l => l.date === t).sort(byDT);
  const tomorrow = L.filter(l => l.date === addDays(t, 1) && l.status === "planned").sort(byDT);
  const weekAgo = addDays(t, -7);
  const autoD = L.filter(l => l.autoDone && l.status === "done" && l.date >= weekAgo && l.date < t).sort(byDT).reverse();
  const overdue = Object.values(S.data.assignments).filter(a => a.due && a.due < t && !S.data.results[a.id] && S.data.students[a.studentId] && !S.data.students[a.studentId].archived).sort((a, b) => a.due.localeCompare(b.due));
  const debt = activeStudents().map(s => [s, balFor(s.id).bal]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  return `<div class="head"><div><p class="eyebrow">${esc(longDate(t))}</p><h1>Dziś</h1></div><div class="acts"><button class="btn primary" data-act="newLesson" data-date="${t}">+ Lekcja</button><button class="btn" data-act="newPayment">+ Wpłata</button></div></div>
  <div class="grid2">
  ${panel("Lekcje dzisiaj", todayL.length ? `<div class="list">${todayL.map(l => lessonRow(l, { quick: true })).join("")}</div>` : emptyP("Dziś bez lekcji."))}
  ${panel("Jutro", tomorrow.length ? `<div class="list">${tomorrow.map(l => lessonRow(l)).join("")}</div>` : emptyP("Jutro bez lekcji."))}
  ${panel("Oznaczone automatycznie", autoD.length ? `<div class="list">${autoD.map(l => `<div class="row"><span class="time">${esc(fmtDate(l.date))} · ${esc(l.time)}</span><span class="grow"><button class="link" type="button" data-act="editLesson" data-id="${l.id}">${esc(lzName(l))}</button><span class="small muted">${zl(Number(l.price) || 0)}</span></span>${statusChip(l.status)}<button class="btn sm ghost" data-act="setStatus" data-id="${l.id}" data-s="cancelled">Jednak odwołana</button></div>`).join("")}</div>` : emptyP("W ostatnim tygodniu nic nie oznaczyło się samo."), "Lekcje, których nie oznaczyłaś, po północy zmieniają się na odbyte i nalicza się płatność. Jeśli któraś się nie odbyła, popraw ją tutaj.")}
  ${panel("Zaległe płatności", debt.length ? `<div class="list">${debt.map(([s, b]) => `<div class="row"><span class="grow"><button class="link" type="button" data-act="stOpen" data-id="${s.id}">${esc(s.name)}</button></span><b style="color:var(--bad)">${zl(b)}</b><button class="btn sm" data-act="newPayment" data-sid="${s.id}">+ Wpłata</button></div>`).join("")}</div>` : emptyP("Nikt nie zalega z płatnością."))}
  ${panel("Zadania po terminie", overdue.length ? `<div class="list">${overdue.map(a => `<div class="row"><span class="grow"><button class="link" type="button" data-act="stOpen" data-id="${a.studentId}">${esc(sName(a.studentId))}</button><span class="small muted">${esc(taskTitle(a))}</span></span><span class="chip bad">termin ${esc(fmtDate(a.due))}</span></div>`).join("")}</div>` : emptyP("Brak zaległych zadań."))}
  </div>`;
}

/* ---------- Kalendarz ---------- */
function renderKalendarz() {
  S.calMode = S.calMode || (window.innerWidth < 700 ? "week" : "week"); S.calAnchor = S.calAnchor || today();
  const a = S.calAnchor, t = today(); const L = lessonsArr(); let body, label;
  const lz = l => `<button class="lz ${l.status}" data-act="editLesson" data-id="${l.id}"><b>${esc(l.time || "")}</b> ${esc(lzName(l))}</button>`;
  if (S.calMode === "week") {
    const m = mondayOf(a); const days = [...Array(7)].map((_, i) => addDays(m, i));
    label = `${fmtDate(days[0])} – ${fmtDate(days[6])} ${parseD(days[6]).getFullYear()}`;
    body = `<div class="week">${days.map((d, i) => { const ls = L.filter(l => l.date === d).sort(byDT); return `<section class="day ${d === t ? "today" : ""}"><h3><span>${DOWS[i]} ${parseD(d).getDate()}</span><button class="add" data-act="newLesson" data-date="${d}" aria-label="Dodaj lekcję: ${esc(fmtDate(d))}">+</button></h3>${ls.map(lz).join("")}</section>`; }).join("")}</div>`;
  } else {
    const ad = parseD(a); const first = iso(new Date(ad.getFullYear(), ad.getMonth(), 1)); const start = mondayOf(first);
    label = monthLabel(first.slice(0, 7));
    const cells = []; for (let i = 0; i < 42; i++) { const d = addDays(start, i); if (i >= 35 && parseD(d).getMonth() !== ad.getMonth()) break; cells.push(d); }
    body = `<div class="month">${DOWS.map(x => `<div class="mh">${x}</div>`).join("")}${cells.map(d => { const ls = L.filter(l => l.date === d).sort(byDT); const out = parseD(d).getMonth() !== ad.getMonth(); const act = ls.filter(l => l.status !== "moved" && l.status !== "cancelled").length;
      return `<button class="mday ${out ? "out" : ""} ${d === t ? "today" : ""}" data-act="gotoWeek" data-date="${d}"><span class="d">${parseD(d).getDate()}</span>${ls.slice(0, 3).map(l => `<span class="e ${l.status}">${esc(l.time || "")} ${esc(lzName(l))}</span>`).join("")}${ls.length > 3 ? `<span class="e">+${ls.length - 3}</span>` : ""}${act ? `<span class="cnt">${act} ${plural(act, "lekcja", "lekcje", "lekcji")}</span>` : ""}</button>`; }).join("")}</div>`;
  }
  return `<div class="head"><div><p class="eyebrow">Kalendarz</p><h1>Lekcje</h1></div><div class="acts"><button class="btn primary" data-act="newLesson" data-date="${a >= t ? a : t}">+ Lekcja</button></div></div>
  <div class="toolbar"><button class="btn sm" data-act="calMove" data-d="-1" aria-label="Wstecz">‹</button><button class="btn sm" data-act="calMove" data-d="1" aria-label="Dalej">›</button><button class="btn sm ghost" data-act="calToday">Dziś</button><span class="lbl">${esc(label)}</span><span style="flex:1"></span><div class="seg" role="group" aria-label="Widok"><button data-act="calMode" data-m="week" aria-pressed="${S.calMode === "week"}">Tydzień</button><button data-act="calMode" data-m="month" aria-pressed="${S.calMode === "month"}">Miesiąc</button></div></div>
  ${body}
  <p class="small muted">Kliknij lekcję, żeby ją przełożyć, odwołać, zmienić cenę albo dodać notatkę. Plus przy dniu dodaje lekcję.</p>`;
}

function gcalUrl(l, st, until) {
  const s = l.date.replace(/-/g, "") + "T" + (l.time || "00:00").replace(":", "") + "00"; const e = endTime(l.time, l.duration);
  const ed = (e.mins >= 1440 ? addDays(l.date, 1) : l.date).replace(/-/g, "") + "T" + e.str.replace(":", "") + "00";
  const p = new URLSearchParams({ action: "TEMPLATE", text: `Korepetycje: ${st ? st.name : ""}${st ? " (" + (SUBJ_UP[lessonSubj(l)] || "") + ")" : ""}`, dates: `${s}/${ed}`, ctz: "Europe/Warsaw", details: "Lekcja PEWNY EGZAMIN" });
  if (st && st.email) p.set("add", st.email);
  if (until) p.set("recur", "RRULE:FREQ=WEEKLY;UNTIL=" + until.replace(/-/g, "") + "T235959Z");
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

function lessonForm(id, pre = {}) {
  if (!activeStudents().length && !id) { toast("Najpierw dodaj ucznia."); return; }
  const l = id ? S.data.lessons[id] : { date: pre.date || today(), time: "16:00", duration: 60, status: "planned", studentId: pre.sid || "", note: "" };
  const st = id ? S.data.students[l.studentId] : null;
  const later = id && l.seriesId ? lessonsArr().filter(x => x.seriesId === l.seriesId && x.date > l.date && x.status === "planned").sort(byDT) : [];
  let foot = "";
  if (id) {
    const series = l.seriesId ? lessonsArr().filter(x => x.seriesId === l.seriesId).sort(byDT) : [];
    foot = `<button type="button" class="btn ghost danger" data-lact="del">Usuń</button>${l.status === "planned" ? `<button type="button" class="btn" data-lact="move">Przełóż</button>` : ""}<a class="btn" href="${esc(gcalUrl(l, st))}" target="_blank" rel="noopener">Kalendarz Google</a>${series.length > 1 ? `<a class="btn" href="${esc(gcalUrl(series[0], st, series[series.length - 1].date))}" target="_blank" rel="noopener">Cała seria w Kalendarzu</a>` : ""}`;
  }
  const m = openModal({
    title: id ? `Lekcja: ${sName(l.studentId)}` : "Nowa lekcja", foot, submit: id ? "Zapisz" : "Dodaj lekcję", body: `
  <label class="f">Uczeń<select name="studentId" required>${id && !S.data.students[l.studentId] ? `<option value="${esc(l.studentId)}">${esc(sName(l.studentId))}</option>` : ""}${!id && !l.studentId ? `<option value="">Wybierz ucznia…</option>` : ""}${id && S.data.students[l.studentId] && S.data.students[l.studentId].archived ? `<option value="${l.studentId}" selected>${esc(sName(l.studentId))}</option>` : ""}${studentOpts(l.studentId)}</select></label>
  <label class="f">Przedmiot<select name="subject" data-lsubj></select></label>
  <div class="frow"><label class="f">Data<input name="date" type="date" required value="${esc(l.date)}"></label><label class="f">Godzina<input name="time" type="time" required value="${esc(l.time || "")}"></label><label class="f">Czas (min)<input name="duration" type="number" min="15" step="5" value="${esc(l.duration || 60)}"></label></div>
  <div class="frow">${id ? `<label class="f">Status<select name="status">${opts(STATUS, l.status)}</select></label>` : ""}<label class="f">Cena (zł)<input name="price" type="number" min="0" step="1" inputmode="decimal" value="${id ? esc(l.price ?? "") : ""}" placeholder="stawka ucznia"></label></div>
  ${later.length ? `<fieldset><legend>Zmiany zastosuj do</legend><label class="check"><input type="radio" name="scope" value="one" checked> tylko tej lekcji</label><label class="check"><input type="radio" name="scope" value="series"> tej i ${later.length} ${plural(later.length, "kolejnej", "kolejnych", "kolejnych")} z serii (do ${esc(fmtDate(later[later.length - 1].date))})</label><span class="small muted">W całej serii zmienią się godzina, czas trwania, przedmiot, cena i dzień tygodnia. Notatka i status zmienią się tylko w tej lekcji.</span></fieldset>` : ""}
  ${id ? "" : `<label class="check"><input type="checkbox" name="repeat" data-lrep> Powtarzaj co tydzień</label><label class="f" data-luntil hidden>Do kiedy<input name="until" type="date" value="${schoolYearEnd()}"></label>`}
  <label class="f">Notatka z lekcji<textarea name="note" rows="3" placeholder="Co przerobiłyście, co na następny raz">${esc(l.note || "")}</textarea></label>`,
    onMount: f => {
      const r = f.querySelector("[data-lrep]"); if (r) r.addEventListener("change", () => { f.querySelector("[data-luntil]").hidden = !r.checked; });
      const ss = f.querySelector("[name=studentId]"), sj = f.querySelector("[data-lsubj]"), pr = f.querySelector("[name=price]");
      const fill = keep => { const s = S.data.students[ss.value]; const subs = subjectsOf(s); const want = keep || sj.value; sj.innerHTML = subs.length ? subs.map(x => `<option value="${x.subject}" ${x.subject === want ? "selected" : ""}>${esc(SUBJ_UP[x.subject] || "")} (${esc(LVL[x.level] || "")}) · ${esc(zl(Number(x.rate) || 0))}</option>`).join("") : `<option value="">—</option>`; pr.placeholder = s ? "stawka: " + zl(rateFor(s, sj.value)) : "stawka ucznia"; };
      fill(id ? lessonSubj(l) : "");
      const upd = () => { const s = S.data.students[ss.value]; if (!s) { pr.value = ""; return; } pr.value = rateFor(s, sj.value); pr.placeholder = "stawka: " + zl(rateFor(s, sj.value)); };
      if (!id) upd();
      ss.addEventListener("change", () => { fill(""); upd(); }); sj.addEventListener("change", upd);
      f.addEventListener("click", async e => {
        const b = e.target.closest("[data-lact]"); if (!b) return;
        if (b.dataset.lact === "move") { m.ov.remove(); moveForm(id); }
        else if (b.dataset.lact === "del") {
          const fut = l.seriesId ? lessonsArr().filter(x => x.seriesId === l.seriesId && x.date >= l.date && x.status === "planned" && x.id !== id) : [];
          m.ov.remove();
          if (fut.length) {
            openModal({ title: "Usuń lekcję", submit: "Usuń", body: `<p>Usunąć tylko tę lekcję czy też ${fut.length} ${plural(fut.length, "kolejną zaplanowaną", "kolejne zaplanowane", "kolejnych zaplanowanych")} z tej serii?</p><label class="check"><input type="radio" name="w" value="one" checked> tylko tę</label><label class="check"><input type="radio" name="w" value="all"> tę i kolejne z serii</label><p class="small muted">Odbytych lekcji nie usuwam. Jeśli lekcja się nie odbyła, lepiej ustaw ją jako odwołaną.</p>`,
              onSubmit: async fd => { await delDoc("lessons", id); if (fd.get("w") === "all") for (const x of fut) await delDoc("lessons", x.id); toast("Usunięto"); return true; } });
          } else if (await ask("Usunąć tę lekcję? Jeśli się nie odbyła, lepiej ustaw ją jako odwołaną.", "Usuń")) { await delDoc("lessons", id); toast("Usunięto"); render(); } else render();
        }
      });
    },
    onSubmit: async fd => {
      const sid = String(fd.get("studentId") || ""); if (!sid) { toast("Wybierz ucznia."); return false; }
      const date = String(fd.get("date")), time = String(fd.get("time")); if (!date || !time) { toast("Podaj datę i godzinę."); return false; }
      const subject = String(fd.get("subject") || "") || (subjectsOf(S.data.students[sid])[0] || {}).subject || "";
      const priceIn = String(fd.get("price") || "").trim(); const price = priceIn ? num(priceIn) : rateFor(S.data.students[sid], subject);
      const { id: _x, ...old } = id ? l : {};
      const base = { ...old, studentId: sid, subject, date, time, duration: num(fd.get("duration")) || 60, price, note: String(fd.get("note") || "").trim(), status: id ? String(fd.get("status")) : "planned", updatedAt: new Date().toISOString() };
      if (id && base.status !== "done") base.autoDone = false;
      if (id) {
        await putDoc("lessons", id, base);
        if (fd.get("scope") === "series" && later.length) {
          const shift = Math.round((parseD(date) - parseD(l.date)) / 864e5); let n = 0;
          for (const x of later) { const { id: xid, ...rest } = x; await putDoc("lessons", xid, { ...rest, studentId: sid, subject, time, duration: base.duration, price, date: addDays(x.date, shift), updatedAt: base.updatedAt }); n++; }
          toast(`Zmieniono ${n + 1} ${plural(n + 1, "lekcję", "lekcje", "lekcji")} w serii`); return true;
        }
        toast("Zapisano lekcję"); return true;
      }
      if (fd.get("repeat")) {
        const until = String(fd.get("until") || ""); if (!until || until < date) { toast("Data końca musi być po pierwszej lekcji."); return false; }
        const seriesId = rid(); let d = date, n = 0; const batch = [];
        while (d <= until && n < 60) { batch.push([rid(), { ...base, date: d, seriesId, createdAt: base.updatedAt }]); d = addDays(d, 7); n++; }
        await B.bulk("lessons", batch); for (const [k, v] of batch) S.data.lessons[k] = { id: k, ...v };
        toast(`Dodano ${n} ${plural(n, "lekcję", "lekcje", "lekcji")}`); return true;
      }
      await putDoc("lessons", rid(), { ...base, createdAt: base.updatedAt }); toast("Dodano lekcję"); return true;
    }
  });
}
function moveForm(id) {
  const l = S.data.lessons[id]; if (!l) return;
  openModal({
    title: `Przełóż lekcję: ${lzName(l)}`, submit: "Przełóż", body: `
  <p>Obecny termin: <b>${esc(longDate(l.date))}, ${esc(l.time)}</b></p>
  <div class="frow"><label class="f">Nowa data<input type="date" name="date" required value="${esc(l.date)}"></label><label class="f">Nowa godzina<input type="time" name="time" required value="${esc(l.time)}"></label></div>
  <p class="small muted">Lekcja przesunie się w kalendarzu na nowy termin. W notatce zapisze się, skąd została przeniesiona. Uczeń od razu zobaczy nowy termin w aplikacji.</p>`,
    onSubmit: async fd => {
      const date = String(fd.get("date") || ""), time = String(fd.get("time") || "");
      if (!date || !time) { toast("Podaj nową datę i godzinę."); return false; }
      if (date === l.date && time === l.time) { toast("Wybierz inny termin."); return false; }
      const { id: _i, seriesId, movedTo, movedToDate, movedToTime, ...rest } = l;
      await putDoc("lessons", id, { ...rest, date, time, status: "planned", autoDone: false, movedFromDate: l.movedFromDate || l.date, note: (l.note ? l.note + "\n" : "") + `Przełożona z ${fmtDate(l.date)}, ${l.time}`, updatedAt: new Date().toISOString() });
      S.calAnchor = date; toast(`Przełożono na ${fmtDate(date)}, ${time}`); return true;
    }
  });
}

/* ---------- Uczniowie ---------- */
function studentForm(sid) {
  const s = sid ? S.data.students[sid] : {};
  openModal({
    title: sid ? "Edytuj ucznia" : "Nowy uczeń", submit: sid ? "Zapisz zmiany" : "Dodaj ucznia",
    foot: sid ? `<button type="button" class="btn ghost" data-arch>${s.archived ? "Przywróć z archiwum" : "Przenieś do archiwum"}</button>` : "", body: `
  <label class="f">Imię<input name="name" required value="${esc(s.name || "")}"></label>
  <fieldset><legend>Przedmioty i stawki</legend>${Object.entries(SUBJ_UP).map(([k, v]) => { const x = subjectsOf(s).find(y => y.subject === k); return `<div class="frow" style="align-items:end"><label class="check"><input type="checkbox" name="subj_${k}" ${x || (!sid && k === "mat") ? "checked" : ""}> ${v}</label><label class="f">Poziom<select name="lvl_${k}">${opts(LVL, x ? x.level : "PP")}</select></label><label class="f">Stawka (zł)<input name="rate_${k}" type="number" min="0" step="1" inputmode="decimal" value="${x ? esc(x.rate) : ""}"></label></div>`; }).join("")}</fieldset>
  <div class="frow"><label class="f">Klasa<input name="klasa" value="${esc(s.klasa || "")}" placeholder="np. 3 LO"></label><label class="f">Cel (opcjonalnie)<input name="goal" value="${esc(s.goal || "")}" placeholder="np. 70–80%"></label></div>
  <div class="frow"><label class="f">Telefon ucznia<input name="phone" type="tel" value="${esc(s.phone || "")}"></label><label class="f">E-mail ucznia<input name="email" type="email" value="${esc(s.email || "")}"></label></div>
  <div class="frow"><label class="f">Telefon rodzica<input name="parentPhone" type="tel" value="${esc(s.parentPhone || "")}"></label><label class="f">E-mail rodzica<input name="parentEmail" type="email" value="${esc(s.parentEmail || "")}"></label></div>
  <label class="f">Notatki (widzisz je tylko ty)<textarea name="notes" rows="3">${esc(s.notes || "")}</textarea></label>`,
    onMount: (f, ov) => { const a = f.querySelector("[data-arch]"); if (a) a.addEventListener("click", async () => { await patchDoc("students", sid, { archived: !s.archived }); toast(s.archived ? "Przywrócono" : "Przeniesiono do archiwum"); ov.remove(); render(); }); },
    onSubmit: async fd => {
      const name = String(fd.get("name") || "").trim(); if (!name) { toast("Wpisz imię ucznia."); return false; }
      const g = k => String(fd.get(k) || "").trim();
      const subjects = Object.keys(SUBJ_UP).filter(k => fd.get("subj_" + k)).map(k => ({ subject: k, level: g("lvl_" + k), rate: num(fd.get("rate_" + k)) }));
      if (!subjects.length) { toast("Zaznacz co najmniej jeden przedmiot."); return false; }
      const now = new Date().toISOString();
      const data = { name, subjects, subject: subjects[0].subject, level: subjects[0].level, rate: subjects[0].rate, subjectLabel: subjects.map(x => SUBJ[x.subject]).join(" + "), phone: g("phone"), email: g("email"), parentPhone: g("parentPhone"), parentEmail: g("parentEmail"), notes: g("notes"), klasa: g("klasa"), goal: g("goal"), updatedAt: now };
      if (sid) await patchDoc("students", sid, data); else await putDoc("students", rid(), { ...data, createdAt: now });
      toast(sid ? "Zapisano zmiany" : "Dodano ucznia"); return true;
    }
  });
}
function renderUczniowie() {
  const show = S.showArch ? activeStudents(true).filter(s => s.archived) : activeStudents();
  const narch = activeStudents(true).filter(s => s.archived).length;
  const t = today();
  return `<div class="head"><div><p class="eyebrow">${show.length} ${plural(show.length, "uczeń", "uczniów", "uczniów")}${S.showArch ? " w archiwum" : ""}</p><h1>Uczniowie</h1></div><div class="acts"><button class="btn primary" data-act="newStudent">+ Uczeń</button></div></div>
  ${searchBox("ucz", "Szukaj ucznia")}
  <div class="list">${show.map(s => { const b = balFor(s.id); const nx = lessonsArr().filter(l => l.studentId === s.id && l.status === "planned" && l.date >= t).sort(byDT)[0]; const open = Object.values(S.data.assignments).filter(a => a.studentId === s.id && !S.data.results[a.id]).length;
    return `<button class="row" data-act="stOpen" data-id="${s.id}" data-s-ucz="${esc(norm(s.name + " " + (s.klasa || "")))}"><span class="grow"><b>${esc(s.name)}</b><span class="small muted">${esc(subjectsOf(s).map(x => SUBJ[x.subject] + " · " + zl(Number(x.rate) || 0)).join(" + "))}${s.klasa ? " · " + esc(s.klasa) : ""}${nx ? " · następna: " + esc(fmtDate(nx.date) + ", " + nx.time) : ""}</span></span>
    ${open ? `<span class="chip">${open} ${plural(open, "zadanie", "zadania", "zadań")}</span>` : ""}${s.loginEmail ? '<span class="chip ok">ma konto</span>' : ""}<span class="chip ${b.bal > 0 ? "bad" : "ok"}">${b.bal > 0 ? "do zapłaty " + zl(b.bal) : b.bal < 0 ? "nadpłata " + zl(-b.bal) : "opłacone"}</span></button>`; }).join("") || emptyP("Brak uczniów.")}</div>
  ${narch || S.showArch ? `<p><button class="btn sm ghost" data-act="toggleArch">${S.showArch ? "← Aktywni uczniowie" : `Archiwum (${narch})`}</button></p>` : ""}`;
}
function studentModal(s) {
  const ov = document.createElement("div"); ov.className = "ov";
  const draw = () => {
    s = S.data.students[s.id] || s;
    const t = today(); const ls = lessonsArr().filter(l => l.studentId === s.id).sort(byDT);
    const up = ls.filter(l => l.date >= t && l.status === "planned").slice(0, 5), past = ls.filter(l => l.date < t || l.status !== "planned" && l.date <= t).reverse().slice(0, 12);
    const P = Object.values(S.data.payments).filter(p => p.studentId === s.id).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const b = balFor(s.id);
    const as = Object.values(S.data.assignments).filter(a => a.studentId === s.id).sort((a, b) => (b.due || "").localeCompare(a.due || ""));
    const sec = S.stSec || "zad";
    const tabsH = [["zad", "Zadania"], ["lek", "Lekcje"], ["wpl", "Płatności"], ["dane", "Dane"]].map(([k, l]) => `<button type="button" data-msec="${k}" aria-selected="${sec === k}">${l}</button>`).join("");
    let inner = "";
    if (sec === "zad") inner = `<form class="panel" style="padding:14px 16px;display:grid;gap:12px" id="stAssign"><h3>Zadaj zadanie</h3>${assignFormHtml(s.id)}</form>
    <section><h3>Zadania ucznia</h3>${as.length ? `<div class="list">${as.map(a => { const r = S.data.results[a.id];
      return `<div class="row"><span class="grow"><b>${esc(taskTitle(a))}</b><span class="small muted">${kindLabel(a)}${a.due ? " · termin: " + fmtDate(a.due) : ""}</span></span>${r ? (ownKind(a) ? '<span class="chip ok">zrobione</span>' : `<span class="chip ${pct(r.score, r.max) >= 70 ? "ok" : pct(r.score, r.max) >= 50 ? "warn" : "bad"}">${r.score}/${r.max}</span>`) : (ownKind(a) ? `<button class="btn sm" type="button" data-mact="done" data-id="${a.id}">Odhacz</button>` : '<span class="chip">czeka</span>')}${r ? "" : `<input type="date" value="${esc(a.due || "")}" data-mdue="${a.id}" aria-label="Termin" style="width:auto;padding:5px 8px;font-size:13px"><button class="btn sm ghost" type="button" data-mact="del" data-id="${a.id}">usuń</button>`}</div>`; }).join("")}</div>` : '<p class="empty">Nic jeszcze nie zadano.</p>'}</section>`;
    else if (sec === "lek") inner = `<div class="acts"><button class="btn sm primary" type="button" data-mact="newLesson">+ Lekcja</button></div>
    <section><h3>Najbliższe</h3>${up.length ? `<div class="list">${up.map(l => lessonRow(l, { showDate: true, showName: false })).join("")}</div>` : emptyP("Brak zaplanowanych lekcji.")}</section>
    <section><h3>Historia</h3>${past.length ? `<div class="list">${past.map(l => lessonRow(l, { showDate: true, showName: false })).join("")}</div>` : emptyP("Jeszcze nic.")}</section>`;
    else if (sec === "wpl") inner = `<div class="stats">${balanceBlock(b)}</div><div class="acts"><button class="btn sm primary" type="button" data-mact="newPayment">+ Wpłata</button><button class="btn sm" type="button" data-mact="newCharge">+ Zaległość</button></div>
    ${P.length ? `<div class="list">${P.map(p => `<div class="row"><span class="grow"><b>${isCharge(p) ? "zaległość " : ""}${zl(Number(p.amount) || 0)}</b><span class="small muted">${esc(fmtDate(p.date))}${p.method ? " · " + esc(p.method) : ""}${p.note ? " · " + esc(p.note) : ""}</span></span>${isCharge(p) ? '<span class="chip warn">doliczone</span>' : '<span class="chip ok">wpłata</span>'}<button class="btn sm ghost" type="button" data-mact="delPay" data-id="${p.id}">usuń</button></div>`).join("")}</div>` : emptyP("Brak wpłat.")}`;
    else inner = `<dl class="kv">${[["Przedmioty", subjectsOf(s).map(x => `${SUBJ[x.subject]} (${LVL[x.level] || ""}) · ${zl(Number(x.rate) || 0)}`).join(", ")], ["Klasa", s.klasa], ["Cel", s.goal], ["Telefon", s.phone], ["E-mail", s.email], ["Telefon rodzica", s.parentPhone], ["E-mail rodzica", s.parentEmail], ["Konto w aplikacji", s.loginEmail || "brak"], ["Notatki", s.notes]].filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <div class="acts"><button class="btn sm primary" type="button" data-mact="edit">Edytuj dane</button>${s.loginEmail ? "" : `<button class="btn sm mustard" type="button" data-mact="login">Utwórz konto w aplikacji</button>`}</div>`;
    ov.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true"><header><div><h2>${esc(s.name)}</h2><span class="small muted">${esc(subjectsOf(s).map(x => SUBJ[x.subject]).join(" + "))}${s.klasa ? " · " + esc(s.klasa) : ""} · <span style="color:var(--${b.bal > 0 ? "bad" : "ok"})">${b.bal > 0 ? "do zapłaty " + zl(b.bal) : b.bal < 0 ? "nadpłata " + zl(-b.bal) : "opłacone"}</span></span></div><button class="x" data-x aria-label="Zamknij">×</button></header>
    <div class="mb"><div class="subtabs" role="tablist">${tabsH}</div>${inner}</div></div>`;
    wireKind(ov);
    const fa = ov.querySelector("#stAssign"); if (fa) fa.addEventListener("submit", async e => { e.preventDefault(); try { if (await submitAssign(new FormData(e.target))) draw(); } catch (err) { toast(errMsg(err)); } });
  };
  ov.addEventListener("change", async e => { const d = e.target.closest("[data-mdue]"); if (!d) return; try { await patchDoc("assignments", d.dataset.mdue, { due: d.value }); toast(d.value ? "Termin zmieniony: " + fmtDate(d.value) : "Usunięto termin"); draw(); } catch (err) { toast(errMsg(err)); } });
  ov.addEventListener("click", async e => {
    if (e.target === ov || e.target.closest("[data-x]")) { ov.remove(); render(); return; }
    const sb = e.target.closest("[data-msec]"); if (sb) { S.stSec = sb.dataset.msec; draw(); return; }
    const el = e.target.closest("[data-act=editLesson],[data-act=moveLesson],[data-act=setStatus]");
    if (el) { e.stopPropagation(); ov.remove(); await handleLessonAct(el); return; }
    const b = e.target.closest("[data-mact]"); if (!b) return;
    try {
      const k = b.dataset.mact;
      if (k === "done") { await markCustomDone(b.dataset.id); draw(); }
      else if (k === "del") { if (await ask("Usunąć to zadanie?", "Usuń")) { await delDoc("assignments", b.dataset.id); draw(); } }
      else if (k === "edit") { ov.remove(); studentForm(s.id); }
      else if (k === "login") { ov.remove(); loginModal(s); }
      else if (k === "newLesson") { ov.remove(); lessonForm(null, { sid: s.id }); }
      else if (k === "newPayment") { ov.remove(); paymentForm(s.id); }
      else if (k === "newCharge") { ov.remove(); chargeForm(s.id); }
      else if (k === "delPay") { if (await ask("Usunąć ten wpis?", "Usuń")) { await delDoc("payments", b.dataset.id); draw(); } }
    } catch (err) { toast(errMsg(err)); }
  });
  document.body.appendChild(ov); draw();
}
async function handleLessonAct(el) {
  const act = el.dataset.act, id = el.dataset.id;
  if (act === "editLesson") lessonForm(id);
  else if (act === "moveLesson") moveForm(id);
  else if (act === "setStatus") { const st = el.dataset.s; const d = { status: st, updatedAt: new Date().toISOString() }; if (st !== "done") d.autoDone = false; await patchDoc("lessons", id, d); toast(st === "done" ? "Oznaczono jako odbytą" : st === "cancelled" ? "Lekcja odwołana – nie liczy się do płatności" : "Zapisano"); render(); }
}

/* ---------- Płatności: formularze ---------- */
function paymentForm(sid, amt, note) {
  if (!activeStudents().length) { toast("Najpierw dodaj ucznia."); return; }
  const def = amt != null ? amt : (sid && balFor(sid).bal > 0 ? balFor(sid).bal : "");
  openModal({
    title: "Nowa wpłata", submit: "Dodaj wpłatę", body: `
  <label class="f">Uczeń<select name="studentId" required>${sid ? "" : `<option value="">Wybierz ucznia…</option>`}${studentOpts(sid)}</select></label>
  <div class="frow"><label class="f">Kwota (zł)<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" required value="${esc(def)}"></label><label class="f">Data<input name="date" type="date" required value="${today()}"></label><label class="f">Forma<select name="method">${opts({ przelew: "przelew", gotówka: "gotówka", BLIK: "BLIK" }, "przelew")}</select></label></div>
  <label class="f">Notatka<input name="note" placeholder="np. za listopad" value="${esc(note || "")}"></label>`,
    onSubmit: async fd => {
      const s = String(fd.get("studentId") || ""); const amount = num(fd.get("amount"));
      if (!s) { toast("Wybierz ucznia."); return false; } if (!(amount > 0)) { toast("Wpisz kwotę większą od zera."); return false; }
      await putDoc("payments", rid(), { studentId: s, amount, date: String(fd.get("date")), method: String(fd.get("method")), note: String(fd.get("note") || "").trim(), createdAt: new Date().toISOString() });
      toast("Wpłata dodana"); return true;
    }
  });
}
function chargeForm(sid) {
  openModal({
    title: "Zaległa płatność", submit: "Dodaj zaległość", body: `
  <p class="small muted">Dla nieopłaconych lekcji, których nie ma w kalendarzu. Kwota doliczy się do salda ucznia, a gdy zapłaci, dodaj zwykłą wpłatę.</p>
  <label class="f">Uczeń<select name="studentId" required>${sid ? "" : `<option value="">Wybierz ucznia…</option>`}${studentOpts(sid)}</select></label>
  <div class="frow"><label class="f">Liczba lekcji<input name="count" type="number" min="0" step="1" inputmode="numeric" placeholder="np. 4" data-ccount></label><label class="f">Kwota (zł)<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" required data-camt></label></div>
  <div class="frow"><label class="f">Data<input name="date" type="date" required value="${today()}"></label><label class="f">Opis<input name="note" placeholder="np. 4 lekcje do 26.10"></label></div>`,
    onMount: f => { const ss = f.querySelector("[name=studentId]"), cn = f.querySelector("[data-ccount]"), am = f.querySelector("[data-camt]"); const calc = () => { const s = S.data.students[ss.value]; if (s && cn.value) am.value = num(cn.value) * rateFor(s); }; cn.addEventListener("input", calc); ss.addEventListener("change", calc); },
    onSubmit: async fd => {
      const s = String(fd.get("studentId") || ""); const amount = num(fd.get("amount")); const cnt = num(fd.get("count"));
      if (!s) { toast("Wybierz ucznia."); return false; } if (!(amount > 0)) { toast("Wpisz kwotę."); return false; }
      const note = String(fd.get("note") || "").trim() || (cnt ? `${cnt} ${plural(cnt, "lekcja", "lekcje", "lekcji")} do ${fmtDate(String(fd.get("date")))}` : "zaległość");
      await putDoc("payments", rid(), { kind: "charge", studentId: s, amount, count: cnt || null, date: String(fd.get("date")), note, createdAt: new Date().toISOString() });
      toast("Zaległość doliczona"); return true;
    }
  });
}

/* ---------- Rozliczenie z góry ---------- */
function upfront(ym) {
  const start = ym + "-01"; const [y, m] = ym.split("-").map(Number); const next = iso(new Date(y, m, 1));
  const L = lessonsArr().filter(l => l.status === "planned" || l.status === "done");
  const sum = a => Math.round(a.reduce((s, l) => s + (Number(l.price) || 0), 0) * 100) / 100;
  return activeStudents().map(s => {
    const mine = L.filter(l => l.studentId === s.id);
    const inM = mine.filter(l => l.date >= start && l.date < next).sort(byDT);
    const monthSum = sum(inM); const doneM = sum(inM.filter(l => effStatus(l) === "done")); const before = sum(mine.filter(l => effStatus(l) === "planned" && l.date < start));
    const adj = Math.round((balFor(s.id).bal - doneM + before) * 100) / 100;
    const order = subjectsOf(s).map(x => x.subject);
    const bySubj = [...new Set(inM.map(l => lessonSubj(l)))].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(k => { const ls = inM.filter(l => lessonSubj(l) === k); return { subject: k, ls, sum: sum(ls) }; });
    return { id: s.id, s, inM, bySubj, monthSum, adj, pay: Math.round((monthSum + adj) * 100) / 100 };
  }).filter(r => r.inM.length || Math.abs(r.adj) > 0.004);
}
function upMsg(r, ym) {
  const [y, m] = ym.split("-").map(Number); const ml = monthLabel(ym); const n = r.inM.length;
  const toKid = S.upTo === "uczen"; const st = settings(); const c = st.contact || {};
  const subs = [...new Set((r.inM.length ? r.inM.map(l => lessonSubj(l)) : subjectsOf(r.s).map(x => x.subject)))].map(k => ({ mat: "matematyki", ang: "angielskiego" })[k]).filter(Boolean).join(" i ");
  let t = toKid ? `Cześć ${r.s.name}!\n\n` : `Dzień dobry!\n\n`;
  t += `Przesyłam rozliczenie korepetycji${subs ? " z " + subs : ""} za ${ml}${toKid ? "" : ` (${r.s.name})`}:\n`;
  if (r.bySubj.length > 1) { for (const g of r.bySubj) { const k = g.ls.length; const pr = [...new Set(g.ls.map(l => Number(l.price) || 0))]; t += `• ${SUBJ[g.subject] || ""}: ${k} ${plural(k, "lekcja", "lekcje", "lekcji")} (${g.ls.map(l => parseD(l.date).getDate()).join(", ")} ${MONG[m - 1]})${pr.length === 1 ? ` × ${zl(pr[0])}` : ""} – ${zl(g.sum)}\n`; } }
  else { const pr = [...new Set(r.inM.map(l => Number(l.price) || 0))]; t += `• ${n} ${plural(n, "lekcja", "lekcje", "lekcji")}${n ? ` (${r.inM.map(l => parseD(l.date).getDate()).join(", ")} ${MONG[m - 1]})` : ""}${n > 1 && pr.length === 1 ? ` × ${zl(pr[0])}` : ""} – ${zl(r.monthSum)}\n`; }
  if (r.adj > 0.004) t += `• zaległość z poprzednich zajęć – ${zl(r.adj)}\n`; else if (r.adj < -0.004) t += `• nadpłata do odjęcia – ${zl(-r.adj)}\n`;
  if (r.pay <= 0) t += `\nZa ten miesiąc nic nie trzeba dopłacać, wszystko jest już opłacone.`;
  else {
    t += `\nDo zapłaty: ${zl(r.pay)}.`;
    const b = st.bank || {};
    if (b.account) { const title = (st.titleTpl || "Korepetycje – {imie} – {miesiac}").replace(/\{imie\}/g, r.s.name).replace(/\{miesiac\}/g, ml); t += `\n\nDane do przelewu:\n${b.recipient ? b.recipient + "\n" : ""}${b.account}\nTytuł: ${title}`; }
  }
  t += `\n\nWszystkie lekcje i płatności widać też w aplikacji: ${APP_URL}`;
  const sig = (c.name || "").trim().split(/\s+/)[0];
  t += `\n\n${toKid ? "Do zobaczenia na zajęciach!" : "Dziękuję i pozdrawiam"}${sig ? "\n" + sig : ""}`;
  return t;
}
function renderZgory() {
  if (!S.upMonth) { const d = new Date(); const nx = new Date(d.getFullYear(), d.getMonth() + (d.getDate() > 20 ? 1 : 0), 1); S.upMonth = `${nx.getFullYear()}-${pad(nx.getMonth() + 1)}`; }
  const ym = S.upMonth; const rows = upfront(ym); const total = rows.reduce((s, r) => s + Math.max(0, r.pay), 0);
  const months = (() => { const d0 = new Date(); const out = []; for (let i = -6; i <= 12; i++) { const d = new Date(d0.getFullYear(), d0.getMonth() + i, 1); out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); } if (!out.includes(ym)) out.push(ym); return out.sort(); })();
  const adjCell = a => a > 0.004 ? `<span style="color:var(--bad)">+${zl(a)} zaległość</span>` : a < -0.004 ? `<span style="color:var(--ok)">−${zl(-a)} nadpłata</span>` : "—";
  return `<div class="head"><div><p class="eyebrow">Rozliczenie z góry</p><h1>${esc(monthLabel(ym))}</h1></div><div class="acts"><div class="seg" role="group" aria-label="Wiadomość do"><button data-act="upTo" data-v="rodzic" aria-pressed="${S.upTo !== "uczen"}">Do rodzica</button><button data-act="upTo" data-v="uczen" aria-pressed="${S.upTo === "uczen"}">Do ucznia</button></div><button class="btn sm" data-act="upMove" data-d="-1" aria-label="Poprzedni miesiąc">‹</button><select id="upmonth" style="width:auto">${months.map(k => `<option value="${k}" ${k === ym ? "selected" : ""}>${esc(monthLabel(k))}</option>`).join("")}</select><button class="btn sm" data-act="upMove" data-d="1" aria-label="Następny miesiąc">›</button></div></div>
  <div class="stats"><div class="stat"><span class="small muted">Razem do zebrania</span><b>${zl(total)}</b><span class="small muted">${rows.filter(r => r.pay > 0).length} ${plural(rows.filter(r => r.pay > 0).length, "uczeń", "uczniów", "uczniów")}</span></div><div class="stat"><span class="small muted">Zaplanowane lekcje w miesiącu</span><b>${rows.reduce((s, r) => s + r.inM.length, 0)}</b><span class="small muted">bez odwołanych</span></div></div>
  ${panel("Ile komu policzyć", rows.length ? `<div class="tablewrap"><table><thead><tr><th>Uczeń</th><th>Lekcje</th><th>Za miesiąc</th><th>Saldo</th><th>Do zapłaty</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td><button class="link" type="button" data-act="stOpen" data-id="${r.id}">${esc(r.s.name)}</button></td><td style="white-space:normal">${r.bySubj.map(g => `<div>${r.bySubj.length > 1 ? esc(SUBJ[g.subject]) + ": " : ""}${g.ls.length} <span class="small muted">(${g.ls.map(l => parseD(l.date).getDate()).join(", ")})</span></div>`).join("") || "0"}</td><td>${zl(r.monthSum)}</td><td>${adjCell(r.adj)}</td><td><b>${r.pay > 0 ? zl(r.pay) : "0 zł"}</b></td><td><div class="acts" style="flex-wrap:nowrap"><button class="btn sm" data-act="copyMsg" data-id="${r.id}">Wiadomość</button>${r.pay > 0 ? `<button class="btn sm ghost" data-act="newPayment" data-sid="${r.id}" data-amt="${r.pay}" data-note="za ${esc(monthLabel(ym))}">+ Wpłata</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>` : emptyP(`Brak zaplanowanych lekcji na ${esc(monthLabel(ym))}.`), "Za miesiąc to wszystkie zaplanowane lekcje w tym miesiącu po ich cenie. Saldo dolicza zaległości i odejmuje nadpłaty. Odwołana albo przełożona lekcja sama zmniejszy kwotę.")}`;
}
function msgModal(text, title) {
  openModal({ title, body: `<textarea rows="14" readonly style="font-size:14px">${esc(text)}</textarea>`, foot: `<button type="button" class="btn primary" data-copy>Kopiuj</button>`, onMount: f => f.querySelector("[data-copy]").addEventListener("click", () => { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Skopiowano – wklej w Messengerze albo SMS-ie"), () => { f.querySelector("textarea").select(); toast("Zaznaczone – skopiuj Ctrl+C"); }); }) });
}

/* ---------- Ustawienia: kontakt i przelew ---------- */
function contactPanelHtml() {
  const st = settings(); const b = st.bank || {}, c = st.contact || {};
  return `<form class="panel" id="contactForm" style="display:grid;gap:12px"><h2>Kontakt i dane do przelewu</h2><p class="small muted">Uczniowie widzą je w swojej aplikacji, a wiadomości z rozliczeniem biorą z nich numer konta.</p>
  <div class="frow"><label class="f">Imię i nazwisko<input name="cname" value="${esc(c.name || "")}"></label><label class="f">Telefon<input name="cphone" value="${esc(c.phone || "")}"></label><label class="f">E-mail<input name="cemail" value="${esc(c.email || "")}"></label></div>
  <div class="frow"><label class="f">Odbiorca przelewu<input name="recipient" value="${esc(b.recipient || "")}"></label><label class="f">Bank<input name="bank" value="${esc(b.bank || "")}"></label></div>
  <label class="f">Numer konta<input name="account" value="${esc(b.account || "")}"></label>
  <label class="f">Tytuł przelewu<input name="titleTpl" value="${esc(st.titleTpl || "Korepetycje – {imie} – {miesiac}")}"><span class="small muted">{imie} i {miesiac} wstawią się same.</span></label>
  <div><button class="btn primary" type="submit">Zapisz</button></div></form>`;
}
async function saveContact(f) {
  const g = k => String(f.get(k) || "").trim();
  const d = { contact: { name: g("cname"), phone: g("cphone"), email: g("cemail") }, bank: { recipient: g("recipient"), bank: g("bank"), account: g("account") }, titleTpl: g("titleTpl") };
  await B.update("settings", "app", d); S.data.settings = { ...settings(), ...d }; toast("Zapisano");
}

/* ---------- obsługa akcji ---------- */
async function korepAct(act, el) {
  if (act === "newLesson") { lessonForm(null, { date: el.dataset.date, sid: el.dataset.sid }); return true; }
  if (act === "editLesson" || act === "moveLesson" || act === "setStatus") { await handleLessonAct(el); return true; }
  if (act === "newPayment") { paymentForm(el.dataset.sid || "", el.dataset.amt != null ? Number(el.dataset.amt) : undefined, el.dataset.note); return true; }
  if (act === "newCharge") { chargeForm(el.dataset.sid || ""); return true; }
  if (act === "newStudent") { studentForm(null); return true; }
  if (act === "toggleArch") { S.showArch = !S.showArch; render(); return true; }
  if (act === "calMove") { const d = Number(el.dataset.d); S.calAnchor = S.calMode === "week" ? addDays(S.calAnchor, 7 * d) : (() => { const a = parseD(S.calAnchor); return iso(new Date(a.getFullYear(), a.getMonth() + d, 1)); })(); render(); return true; }
  if (act === "calToday") { S.calAnchor = today(); render(); return true; }
  if (act === "calMode") { S.calMode = el.dataset.m; render(); return true; }
  if (act === "gotoWeek") { S.calAnchor = el.dataset.date; S.calMode = "week"; render(); return true; }
  if (act === "upTo") { S.upTo = el.dataset.v; render(); return true; }
  if (act === "upMove") { const [y, m] = S.upMonth.split("-").map(Number); const d = new Date(y, m - 1 + Number(el.dataset.d), 1); S.upMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; render(); return true; }
  if (act === "copyMsg") { const r = upfront(S.upMonth).find(x => x.id === el.dataset.id); if (r) msgModal(upMsg(r, S.upMonth), `Wiadomość: ${r.s.name}`); return true; }
  return false;
}

/* ---------------- render ---------------- */
/* zapamiętanie miejsca w adresie strony – po odświeżeniu wraca tam, gdzie byłaś */
function saveLoc() {
  if (!S.user || S.user.role !== "admin") return;
  let h = S.tab;
  if (S.view && S.view.type === "mat") h = "materialy/" + S.view.id;
  else if (S.tab === "platnosci" && S.selP) h += "/" + S.selP;
  else if (S.tab === "matematyka" && S.selM && S.selM !== "__all") h += "/" + S.selM;
  else if (S.tab === "maturzysci" && S.sel) h += "/" + S.sel;
  else if (S.tab === "kalendarz" && S.calAnchor) h += "/" + (S.calMode || "week") + "/" + S.calAnchor;
  else if (S.tab === "zgory" && S.upMonth) h += "/" + S.upMonth;
  try { if (location.hash !== "#" + h) history.replaceState(null, "", "#" + h); } catch (e) { }
}
function loadLoc() {
  const [tab, a, b] = decodeURIComponent(location.hash.slice(1)).split("/");
  if (!tab || !ADMIN_TABS.some(t => t[0] === tab)) return;
  S.tab = tab;
  if (tab === "materialy" && a && S.data.materials[a]) S.view = { type: "mat", id: a, showKey: false, from: "materialy" };
  else if (tab === "platnosci" && a) S.selP = a;
  else if (tab === "matematyka" && a) S.selM = a;
  else if (tab === "maturzysci" && a) S.sel = a;
  else if (tab === "kalendarz" && a && b) { S.calMode = a; S.calAnchor = b; }
  else if (tab === "zgory" && a) S.upMonth = a;
}
function render() {
  if (!S.user) return renderLogin();
  if (S.user.role !== "admin") return renderStudent();
  saveLoc();
  if (S.view && S.view.type === "test") return renderTest();
  if (S.view && S.view.type === "mat") return renderMat();
  const t = S.tab;
  const html = t === "dzis" ? renderDzis() : t === "kalendarz" ? renderKalendarz() : t === "zgory" ? renderZgory() : t === "zadania" ? renderZadania() : t === "testy" ? renderTesty() : t === "uczniowie" ? renderUczniowie() : t === "ustawienia" ? renderUstawienia() : t === "matematyka" ? renderMatematyka() : t === "materialy" ? renderMaterialy() : t === "platnosci" ? renderPlatnosci() : renderMaturzysci();
  root.innerHTML = frame(html);
  applyFilter("testy"); applyFilter("mat"); applyFilter("ucz"); wireKind(root);
}

/* ---------------- akcje ---------------- */
async function addAssignment(sid, tid, due) {
  const tt = S.data.tests[tid]; if (tt && tt._local) { await B.set("tests", tid, tt._pub || pubTest(tt)); tt._local = false; }
  const id = rid(); const a = { studentId: sid, testId: tid, due: due || "", createdAt: new Date().toISOString() };
  await B.set("assignments", id, a); S.data.assignments[id] = { id, ...a }; return id;
}
root.addEventListener("click", async e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act;
  try {
    if (S.user && S.user.role === "admin" && await korepAct(act, el)) return;
    if (act === "tab") { S.tab = el.dataset.k; S.view = null; render(); window.scrollTo(0, 0); }
    else if (act === "logout") { S.view = null; await B.logout(); }
    else if (act === "hideInstall") { try { localStorage.setItem("pe_install_hidden", "1"); } catch (x) { } render(); }
    else if (act === "demoAdmin") B.demoLogin({ uid: "demo-admin", role: "admin", name: "Laura", email: "podglad" });
    else if (act === "demoStudent") { const s = SEED.students.find(x => x.id === el.dataset.id); B.demoLogin({ uid: "demo-" + s.id, role: "student", studentId: s.id, name: s.name, email: "podglad" }); }
    else if (act === "forgot") { const em = root.querySelector("#loginForm [name=email]").value.trim(); if (!em) return toast("Wpisz najpierw swój e-mail."); await B.reset(em); toast("Wysłaliśmy link do zmiany hasła na " + em); }
    else if (act === "selP") { S.selP = el.dataset.id || null; render(); window.scrollTo(0, 0); }
    else if (act === "lessonToggle") { const l = S.data.lessons[el.dataset.id]; const ns = l.status === "cancelled" ? "planned" : "cancelled"; await B.update("lessons", l.id, { status: ns, updatedAt: new Date().toISOString() }); l.status = ns; toast(ns === "cancelled" ? "Lekcja odwołana" : "Lekcja przywrócona"); render(); }
    else if (act === "delPay") { if (!(await ask("Usunąć tę wpłatę?", "Usuń"))) return; await B.del("payments", el.dataset.id); delete S.data.payments[el.dataset.id]; render(); }
    else if (act === "openMat") { S.view = { type: "mat", id: el.dataset.id, showKey: false, from: S.tab }; render(); window.scrollTo(0, 0); }
    else if (act === "printMat") printMat(el.dataset.key === "1");
    else if (act === "toggleKey") { S.view.showKey = !S.view.showKey; const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (act === "matCat") { S.matCat = el.dataset.k; render(); }
    else if (act === "engView") { S.engView = el.dataset.k; render(); }
    else if (act === "selM") { S.selM = el.dataset.id; render(); window.scrollTo(0, 0); }
    else if (act === "mathDefaults") { for (const id of MATH_DEFAULT.filter(id => S.data.students[id])) { await B.update("students", id, { mathMatura: true }); S.data.students[id].mathMatura = true; } toast("Dodano maturzystów"); render(); }
    else if (act === "mathAdd") { const id = root.querySelector("#mathAddSel").value; if (!id) return; await B.update("students", id, { mathMatura: true }); S.data.students[id].mathMatura = true; S.selM = id; render(); }
    else if (act === "mathRemove") { if (!(await ask("Usunąć tę osobę z listy maturzystów z matematyki? Wpisane wyniki zostaną zapisane.", "Usuń z listy"))) return; await B.update("students", el.dataset.id, { mathMatura: false }); S.data.students[el.dataset.id].mathMatura = false; S.selM = "__all"; render(); }
    else if (act === "sel") { S.sel = el.dataset.id; S.showAll = false; render(); }
    else if (act === "toggleAll") { S.showAll = !S.showAll; render(); }
    else if (act === "giveMat") { giveMatModal(S.data.materials[S.view.id]); }
    else if (act === "stOpen") { studentModal(S.data.students[el.dataset.id]); }
    else if (act === "stuPdf") { const a = S.data.assignments[el.dataset.id]; if (a) printDoc({ title: a.title, category: a.category, body: a.body, extra: a.vocab ? `<div class="pbreak md">${md(a.vocab)}</div>` : "" }); }
    else if (act === "doneCustom") { await markCustomDone(el.dataset.id); toast(S.user.role === "admin" ? "Odhaczone" : "Super, zapisane!"); render(); }
    else if (act === "openTest") {
      const a = S.data.assignments[el.dataset.id]; const t = S.data.tests[a.testId]; if (!t) return toast("Nie znaleziono testu.");
      const r = S.data.results[a.id];
      S.view = r ? { type: "test", mode: "result", test: t, assignment: a, answers: r.answers || {}, result: r } : { type: "test", mode: "take", test: t, assignment: a, answers: {} };
      render(); window.scrollTo(0, 0);
    }
    else if (act === "ans") { if (S.view.mode !== "take") return; const n = el.dataset.n, val = JSON.parse(el.dataset.v), q = S.view.test.questions[n];
      if (q.type === "multi") { let a = (S.view.answers[n] || []).slice(); a = a.includes(val) ? a.filter(x => x !== val) : [...a, val]; if (a.length > (q.k || q.c.length)) a.shift(); S.view.answers[n] = a.sort(); } else S.view.answers[n] = val; const y = window.scrollY; renderTest(); window.scrollTo(0, y); }
    else if (act === "submitTest") await submitTest();
    else if (act === "back") { S.view = null; render(); }
    else if (act === "previewTest") { const t = S.data.tests[el.dataset.id]; S.view = { type: "test", mode: "key", test: { id: el.dataset.id, ...t }, answers: Object.fromEntries(t.questions.map((q, n) => [n, q.c])) }; render(); window.scrollTo(0, 0); }
    else if (act === "viewResult") { const a = S.data.assignments[el.dataset.id]; const r = S.data.results[a.id]; const t = S.data.tests[a.testId]; const s = S.data.students[a.studentId];
      S.view = { type: "test", mode: "result", test: { id: a.testId, ...t }, assignment: a, answers: r.answers || {}, result: r, who: (s ? s.name : "") + " · oddane " + new Date(r.submittedAt).toLocaleDateString("pl-PL") }; render(); window.scrollTo(0, 0); }
    else if (act === "assignFromPlan") {
      const plan = S.data.plans[S.sel]; const i = +el.dataset.i; const nextL = plan.lessons[i + 1];
      const due = nextL ? nextL.date : iso(new Date(Date.now() + 7 * 864e5));
      await addAssignment(S.sel, el.dataset.test, due); toast("Zadane – termin " + fmtDate(due)); render();
    }
    else if (act === "toggleDone") { const n = el.dataset.n; const st = S.data.planState[S.sel] || { id: S.sel }; st.done = { ...(st.done || {}), [n]: el.checked }; S.data.planState[S.sel] = st; await B.update("planState", S.sel, { done: { [n]: el.checked } }); render(); }
    else if (act === "saveNote") { const n = el.dataset.n; const v = root.querySelector(`textarea[data-note="${n}"]`).value; const st = S.data.planState[S.sel] || { id: S.sel }; st.notes = { ...(st.notes || {}), [n]: v }; S.data.planState[S.sel] = st; await B.update("planState", S.sel, { notes: { [n]: v } }); toast("Notatka zapisana"); }
    else if (act === "shift") {
      const plan = S.data.plans[S.sel]; const i = +el.dataset.i; const L = plan.lessons;
      if (!(await ask(`Lekcja ${L[i].n} i wszystkie kolejne przesuną się o jeden termin (np. gdy lekcja wypadła).`, "Przesuń"))) return;
      const slots = L.map(l => ({ date: l.date, time: l.time }));
      const last = new Date(L[L.length - 1].date + "T12:00:00"); last.setDate(last.getDate() + (plan.perWeek === 2 ? 3 : 7));
      for (let k = L.length - 1; k >= i; k--) { const s2 = k + 1 < L.length ? slots[k + 1] : { date: iso(last), time: L[k].time }; L[k].date = s2.date; L[k].time = s2.time; }
      await B.set("plans", S.sel, plan); toast("Przesunięto"); render();
    }
    else if (act === "delAssign") { if (!(await ask("Usunąć to zadanie?", "Usuń"))) return; await B.del("assignments", el.dataset.id); delete S.data.assignments[el.dataset.id]; render(); }
    else if (act === "makeLogin") loginModal(S.data.students[el.dataset.id]);
    else if (act === "seed") { if (!S.busy) await seedAll(); }
    else if (act === "wipe") { if (await ask("Wyczyścić dane podglądu?", "Wyczyść")) { B.wipe(); await loadAdmin(); render(); toast("Wyczyszczono"); } }
  } catch (err) { console.error(err); toast(errMsg(err)); }
});
root.addEventListener("input", e => { const k = e.target.dataset && e.target.dataset.filter; if (!k) return; S.q[k] = e.target.value; applyFilter(k); });
root.addEventListener("change", async e => {
  if (e.target.dataset.edone || e.target.dataset.epct !== undefined) {
    try {
      if (e.target.dataset.edone) await saveEng(S.sel, e.target.dataset.edone, { done: e.target.checked });
      else { const v = e.target.value.trim(); const k = e.target.dataset.epct;
        if (v === "") await saveEng(S.sel, k, { pct: null }); else await saveEng(S.sel, k, { pct: Math.max(0, Math.min(100, Math.round(+v))), done: true });
        toast("Zapisano"); }
      const y = window.scrollY; render(); window.scrollTo(0, y);
    } catch (err) { toast(errMsg(err)); }
    return;
  }
  if (e.target.dataset.mdone || e.target.dataset.mpts !== undefined || e.target.dataset.mmax !== undefined) {
    try {
      if (e.target.dataset.mdone) await saveMath(S.selM, e.target.dataset.mdone, { done: e.target.checked });
      else {
        const k = e.target.dataset.mpts || e.target.dataset.mmax; const row = e.target.closest(".row");
        const ptsV = row.querySelector(`[data-mpts="${k}"]`).value.trim(), maxV = row.querySelector(`[data-mmax="${k}"]`).value.trim();
        const pts = ptsV === "" ? null : Math.max(0, +ptsV), max = maxV === "" ? null : Math.max(0, +maxV);
        if (pts === null) { await saveMath(S.selM, k, { pts: null, max, pct: null }); }
        else if (!max) { toast("Wpisz też, na ile punktów był test."); return; }
        else { if (pts > max) { toast("Punktów jest więcej niż maksimum – sprawdź liczby."); return; } await saveMath(S.selM, k, { pts, max, pct: Math.round(pts / max * 100), done: true }); toast("Zapisano: " + Math.round(pts / max * 100) + "%"); }
      }
      render();
    } catch (err) { toast(errMsg(err)); }
    return;
  }
  if (e.target.id === "matNot") { S.matNot = e.target.value; render(); return; }
  if (e.target.id === "upmonth") { S.upMonth = e.target.value; render(); return; }
  if (e.target.id !== "importFile" || !e.target.files[0]) return;
  const st = root.querySelector("#importStatus");
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (data.format !== "pewny-egzamin-export") throw new Error("To nie jest plik eksportu z poprzedniej aplikacji.");
    data.payments = { ...(data.payments || {}) };
    for (const [cid, c] of Object.entries(data.charges || {})) data.payments["ch-" + cid] = { ...c, kind: "charge" };
    delete data.charges;
    const cols = [["students", "uczniów"], ["lessons", "lekcji"], ["payments", "wpłat"], ["settings", "ustawień"], ["plans", "planów"], ["tests", "testów"], ["materials", "materiałów"]];
    for (const [c, label] of cols) {
      const entries = Object.entries(data[c] || {}); if (!entries.length) continue;
      await B.bulk(c, entries, n => { st.textContent = `Importuję ${label}: ${n}/${entries.length}…`; });
    }
    if (data.remove) for (const [c, ids] of Object.entries(data.remove)) { let n = 0; for (const id of ids) if (S.data[c] && S.data[c][id]) { await B.del(c, id); st.textContent = `Usuwam nieaktualne: ${++n}…`; } }
    if (data.mirror) for (const c of ["lessons", "payments"]) {
      const keep = new Set(Object.keys(data[c] || {})); const cut = data.exportedAt || ""; const gone = Object.entries(S.data[c] || {}).filter(([id, x]) => !keep.has(id) && !(x.createdAt && cut && x.createdAt > cut)).map(([id]) => id);
      let n = 0; for (const id of gone) { await B.del(c, id); st.textContent = `Usuwam nieaktualne (${c}): ${++n}/${gone.length}…`; }
    }
    await loadAdmin(); render();
    toast(`Zaimportowano: ${Object.keys(data.students || {}).length} uczniów, ${Object.keys(data.lessons || {}).length} lekcji, ${Object.keys(data.payments || {}).length} wpłat`);
  } catch (err) { if (st) st.textContent = ""; toast(err instanceof SyntaxError ? "Plik jest uszkodzony – pobierz go jeszcze raz." : errMsg(err)); }
});
root.addEventListener("submit", async e => {
  e.preventDefault(); const f = new FormData(e.target); const id = e.target.id;
  try {
    if (id === "loginForm") { try { await B.login(f.get("email").trim(), f.get("pw")); } catch (err) { renderLogin(errMsg(err)); } }
    else if (id === "contactForm") { await saveContact(f); render(); }
    else if (id === "assignForm") { if (await submitAssign(f)) render(); }
    else if (id === "addStudent") { const sid = rid(); const d = { name: f.get("name").trim(), subjectLabel: f.get("subj"), level: f.get("level") }; await B.set("students", sid, d); S.data.students[sid] = { id: sid, ...d }; render(); }
    else if (id === "addPay") {
      const pid = rid(); const d = { studentId: S.selP, amount: Math.round(Number(f.get("amount")) * 100) / 100, date: f.get("date"), method: f.get("method"), note: "", createdAt: new Date().toISOString() };
      await B.set("payments", pid, d); S.data.payments[pid] = { id: pid, ...d }; toast("Wpłata dodana"); render();
    }
    else if (id === "importMat") {
      let v = JSON.parse(f.get("json")); if (!Array.isArray(v)) v = [v]; let n = 0;
      for (const m of v) { if (!m.title || !m.body) throw new Error("W kodzie brakuje tytułu albo treści."); const { id: mid, ...d } = m; const k = mid || rid(); await B.set("materials", k, d); S.data.materials[k] = { id: k, ...d }; n++; }
      toast("Dodano materiałów: " + n); render();
    }
    else if (id === "importForm") {
      let v = JSON.parse(f.get("json")); if (!Array.isArray(v)) v = [v]; let n = 0;
      for (const t of v) { if (!t.title || !Array.isArray(t.questions)) throw new Error("W kodzie brakuje tytułu albo pytań."); const { id: tid, ...d } = t; const k = tid || rid(); await B.set("tests", k, d); S.data.tests[k] = { id: k, ...d }; n++; }
      toast("Dodano: " + n); render();
    }
  } catch (err) { toast(err instanceof SyntaxError ? "Kod testu ma błąd – skopiuj go jeszcze raz w całości." : errMsg(err)); }
});


/* ---------------- cofanie zmian (Laura) ---------------- */
const UNDO = { stack: [], cur: null, last: 0, off: false };
const stripId = d => { if (!d) return null; const { id, ...rest } = d; return rest; };
function undoRec(c, id, prior) {
  const now = Date.now();
  if (!UNDO.cur) { UNDO.cur = { at: now, items: new Map() }; UNDO.stack.push(UNDO.cur); if (UNDO.stack.length > 30) UNDO.stack.shift(); }
  UNDO.last = now; const k = c + "/" + id;
  if (!UNDO.cur.items.has(k)) UNDO.cur.items.set(k, { c, id, prior: prior ? clone(prior) : null });
  undoBtn();
}
for (const ev of ["click", "change", "submit"]) document.addEventListener(ev, e => { if (!(e.target && e.target.id === "undoBtn")) UNDO.cur = null; }, true);
function withUndo(B) {
  const isAdmin = () => S.user && S.user.role === "admin" && !UNDO.off;
  const cached = (c, id) => S.data && S.data[c] && typeof S.data[c] === "object" && !Array.isArray(S.data[c]) ? S.data[c][id] : undefined;
  const before = async (c, id) => { try { return stripId(await B.get(c, id)); } catch (e) { const x = cached(c, id); return x === undefined ? null : stripId(x); } };
  const W = Object.create(B);
  for (const m of ["set", "update", "del"]) W[m] = async (c, id, d) => { if (isAdmin()) undoRec(c, id, await before(c, id)); return B[m](c, id, d); };
  W.bulk = async (c, entries, onProg) => { if (isAdmin()) for (const [id] of entries) { const x = cached(c, id); undoRec(c, id, x === undefined ? null : stripId(x)); } return B.bulk(c, entries, onProg); };
  return W;
}
function undoBtn() {
  let b = document.getElementById("undoBtn");
  if (!(S.user && S.user.role === "admin") || !UNDO.stack.length) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement("button"); b.id = "undoBtn"; b.type = "button"; b.className = "btn"; b.style.cssText = "position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:39;box-shadow:var(--shadow);background:var(--bg)"; b.addEventListener("click", undoLast); document.body.appendChild(b); }
  const n = UNDO.stack[UNDO.stack.length - 1].items.size;
  b.textContent = "↶ Cofnij" + (n > 1 ? ` (${n} zmian)` : "");
}
async function undoLast() {
  const e = UNDO.stack.pop(); UNDO.cur = null; if (!e) return;
  const b = document.getElementById("undoBtn"); if (b) { b.disabled = true; b.textContent = "Cofam…"; }
  UNDO.off = true;
  try {
    const items = [...e.items.values()].reverse();
    const restore = items.filter(x => x.prior), remove = items.filter(x => !x.prior);
    const byCol = {}; for (const x of restore) (byCol[x.c] = byCol[x.c] || []).push(x);
    for (const [c, xs] of Object.entries(byCol)) { if (xs.length > 5) { for (const x of xs) await B.del(c, x.id).catch(() => { }); await B.bulk(c, xs.map(x => [x.id, x.prior])); } else for (const x of xs) await B.set(c, x.id, x.prior); }
    for (const x of remove) await B.del(x.c, x.id);
    await loadAdmin(); render(); toast("Cofnięto");
  } catch (err) { toast("Nie udało się cofnąć: " + errMsg(err)); }
  finally { UNDO.off = false; if (b) b.disabled = false; undoBtn(); }
}

/* ---------------- start ---------------- */
(async () => {
  try { B = withUndo(DEMO ? demoBackend() : await fbBackend()); }
  catch (e) { root.innerHTML = `<div class="wrap"><div class="notice bad" style="margin-top:40px">Nie udało się połączyć z Firebase. Sprawdź plik config.js. (${esc(e.message)})</div></div>`; return; }
  B.onAuth(async u => {
    S.user = u; S.view = null; S.data = null; UNDO.stack = []; UNDO.cur = null; undoBtn();
    if (u) { root.innerHTML = frame('<p class="empty">Ładowanie…</p>'); try { if (u.role === "admin") { await loadAdmin(); await autoComplete(); loadLoc(); } else await loadStudent(); } catch (e) { root.innerHTML = frame(`<div class="notice bad">${esc(errMsg(e))}</div>`); return; } }
    render();
  });
  if ("serviceWorker" in navigator && location.protocol === "https:" && !DEMO) navigator.serviceWorker.register("sw.js").catch(() => { });
})();
