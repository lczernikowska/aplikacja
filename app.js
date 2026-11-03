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
const S = { user: null, tab: "maturzysci", sel: null, showAll: false, view: null, data: null, busy: false };

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
  return lessons.filter(l => l.status !== "cancelled" && (l.date > t || (l.date === t && (l.time || "99") >= hm))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, n);
}
function balanceBlock(b) {
  const cls = b.bal > 0 ? "bad" : "ok";
  return `<div class="stat"><span class="small muted">${b.bal > 0 ? "Do zapłaty" : b.bal < 0 ? "Nadpłata" : "Stan"}</span><b style="color:var(--${cls})">${b.bal > 0 ? zl(b.bal) : b.bal < 0 ? zl(-b.bal) : "Wszystko opłacone"}</b><span class="small muted">${b.bal > 0 ? "za odbyte lekcje" : b.bal < 0 ? "nadpłata – na kolejne lekcje" : "dziękuję!"}</span></div>`;
}

async function loadAdmin() {
  const [students, plans, tests, assignments, results, planState, mathProgress, materials, lessons, payments, engProgress] = await Promise.all(["students", "plans", "tests", "assignments", "results", "planState", "mathProgress", "materials", "lessons", "payments", "engProgress"].map(c => B.list(c)));
  const by = a => Object.fromEntries(a.map(x => [x.id, x]));
  S.data = { students: by(students), plans: by(plans), tests: by(tests), assignments: by(assignments), results: by(results), planState: by(planState), mathProgress: by(mathProgress), materials: { ...Object.fromEntries((SEED.materials || []).map(m => [m.id, m])), ...by(materials) }, lessons: by(lessons), payments: by(payments), engProgress: by(engProgress) };
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
const ADMIN_TABS = [["maturzysci", "Matura angielski"], ["matematyka", "Matura matematyka"], ["materialy", "Materiały"], ["platnosci", "Płatności"], ["zadania", "Zadania domowe"], ["testy", "Bank testów"], ["uczniowie", "Uczniowie"], ["ustawienia", "Ustawienia"]];
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
  return `<div class="row" style="align-items:flex-start"><span class="grow"><b>${esc(a.title || "Zadanie")}</b>${a.desc ? `<span class="small" style="white-space:pre-wrap;display:block;margin-top:4px">${esc(a.desc)}</span>` : ""}<span class="small muted">${a.due ? "termin: " + fmtDate(a.due) : ""}</span></span>
  ${r ? '<span class="chip ok">zrobione</span>' : `${late ? '<span class="chip bad">po terminie</span>' : ""}<button class="btn sm primary" data-act="doneCustom" data-id="${a.id}">Zrobione ✓</button>`}</div>`;
}
const taskTitle = a => a.kind === "custom" ? (a.title || "Zadanie własne") : ((S.data.tests[a.testId] || {}).title || a.testId);
function assignFormHtml(sid) {
  const st = Object.values(S.data.students).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  const ts = Object.values(S.data.tests).sort((a, b) => a.title.localeCompare(b.title, "pl"));
  return `<div class="frow">
  ${sid ? `<input type="hidden" name="sid" value="${sid}">` : `<label class="f">Uczeń<select name="sid" required>${st.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></label>`}
  <label class="f">Rodzaj<select name="kind" data-kindsel><option value="custom">Zadanie własne</option><option value="test">Test z banku</option></select></label>
  <label class="f">Termin<input type="date" name="due" value="${iso(new Date(Date.now() + 6 * 864e5))}"></label></div>
  <div data-kind="custom" style="display:grid;gap:12px"><label class="f">Tytuł<input name="title" placeholder="np. Zadania maturalne z funkcji"></label>
  <label class="f">Opis (opcjonalnie)<textarea name="desc" rows="3" placeholder="np. Arkusz maj 2023, zadania 5–12. Rozwiązania przynieś na lekcję."></textarea></label></div>
  <div data-kind="test" hidden><label class="f">Test<select name="tid">${ts.map(t => `<option value="${t.id}">${esc(t.title)} (${esc(t.level || "")})</option>`).join("")}</select></label></div>
  <div><button class="btn primary" type="submit">Zadaj</button></div>`;
}
async function addCustom(sid, title, desc, due) {
  const id = rid(); const a = { studentId: sid, kind: "custom", title, desc: desc || "", due: due || "", createdAt: new Date().toISOString() };
  await B.set("assignments", id, a); S.data.assignments[id] = { id, ...a }; return id;
}
async function submitAssign(f) {
  const sid = f.get("sid"), due = f.get("due");
  if (f.get("kind") === "test") { if (!f.get("tid")) { toast("Wybierz test."); return false; } await addAssignment(sid, f.get("tid"), due); }
  else { const title = String(f.get("title") || "").trim(); if (!title) { toast("Wpisz tytuł zadania."); return false; } await addCustom(sid, title, String(f.get("desc") || "").trim(), due); }
  toast("Zadane"); return true;
}
function studentModal(s) {
  const ov = document.createElement("div"); ov.className = "ov";
  const draw = () => {
    const as = Object.values(S.data.assignments).filter(a => a.studentId === s.id).sort((a, b) => (b.due || "").localeCompare(a.due || ""));
    ov.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true"><header><h2>${esc(s.name)}</h2><button class="x" data-x>×</button></header>
    <div class="mb"><form class="panel" style="padding:14px 16px;display:grid;gap:12px" id="stAssign"><h3>Zadaj zadanie</h3>${assignFormHtml(s.id)}</form>
    <section><h3>Zadania ucznia</h3>${as.length ? `<div class="list">${as.map(a => { const r = S.data.results[a.id];
      return `<div class="row"><span class="grow"><b>${esc(taskTitle(a))}</b><span class="small muted">${a.kind === "custom" ? "zadanie własne" : "test"}${a.due ? " · termin: " + fmtDate(a.due) : ""}</span></span>${r ? (a.kind === "custom" ? '<span class="chip ok">zrobione</span>' : `<span class="chip ${pct(r.score, r.max) >= 70 ? "ok" : pct(r.score, r.max) >= 50 ? "warn" : "bad"}">${r.score}/${r.max}</span>`) : (a.kind === "custom" ? `<button class="btn sm" data-mact="done" data-id="${a.id}">Odhacz</button>` : '<span class="chip">czeka</span>')}${r ? "" : `<button class="btn sm ghost" data-mact="del" data-id="${a.id}">usuń</button>`}</div>`; }).join("")}</div>` : '<p class="empty">Nic jeszcze nie zadano.</p>'}</section></div></div>`;
    wireKind(ov);
    ov.querySelector("#stAssign").addEventListener("submit", async e => { e.preventDefault(); UNDO.cur = null; try { if (await submitAssign(new FormData(e.target))) draw(); } catch (err) { toast(errMsg(err)); } });
  };
  ov.addEventListener("click", async e => {
    if (e.target === ov || e.target.closest("[data-x]")) { ov.remove(); render(); return; }
    const b = e.target.closest("[data-mact]"); if (!b) return; UNDO.cur = null;
    try {
      if (b.dataset.mact === "done") { await markCustomDone(b.dataset.id); draw(); }
      else if (b.dataset.mact === "del" && await ask("Usunąć to zadanie?", "Usuń")) { await B.del("assignments", b.dataset.id); delete S.data.assignments[b.dataset.id]; draw(); }
    } catch (err) { toast(errMsg(err)); }
  });
  document.body.appendChild(ov); draw();
}
function wireKind(scope) {
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
    if (a.kind === "custom") return customCard(a, r, late);
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
function qHtml(q, n, answers, mode) {
  const mine = answers[n]; const review = mode !== "take";
  const opt = (val, letter, label) => {
    const pressed = mine === val; const right = q.c === val;
    let cls = "bub"; if (review && right) cls += " right"; else if (review && pressed && !right) cls += " wrong";
    return `<button class="opt ${review && right ? "isright" : ""}" data-act="ans" data-n="${n}" data-v='${JSON.stringify(val)}' aria-pressed="${pressed}" ${review ? "disabled" : ""}><span class="${cls}">${letter}</span><span>${esc(label)}</span></button>`;
  };
  const opts = q.type === "tf" ? opt(true, "P", "Prawda") + opt(false, "F", "Fałsz") : (q.o || []).map((o, k) => opt(k, "ABCDEFGH"[k], o)).join("");
  let verdict = "";
  if (review) { const ok = mine === q.c; verdict = `<span class="verdict ${ok ? "ok" : "bad"}">${mine === undefined ? (mode === "key" ? "" : "Brak odpowiedzi") : ok ? "Dobrze" : "Źle"}</span>${q.e ? `<div class="expl"><b>Wyjaśnienie</b><span>${esc(q.e)}</span></div>` : ""}`; }
  return `<div class="q"><span class="qn">Zadanie ${n + 1}.${q.type === "tf" ? " Prawda czy fałsz?" : ""}</span><div class="qt">${esc(q.t)}</div><div class="opts">${opts}</div>${verdict}</div>`;
}
function testBody(t, answers, mode) {
  return groupQuestions(t).map(g => `${g.p ? passageHtml(g.p) : ""}${g.qs.map(n => qHtml(t.questions[n], n, answers, mode)).join("")}`).join("");
}
function renderTest() {
  const v = S.view; const t = v.test;
  const total = t.questions.length; const answered = Object.keys(v.answers).length;
  let top = "", bottom = "";
  if (v.mode === "take") {
    bottom = `<div class="submitbar"><span class="muted">Odpowiedzi: <b>${answered}/${total}</b></span><button class="btn primary" data-act="submitTest" ${S.busy ? "disabled" : ""}>Oddaj test</button></div>`;
  } else if (v.mode === "result") {
    const r = v.result;
    top = `<div class="scorecard"><span class="score">${r.score}/${r.max}</span><div><b>${pct(r.score, r.max)}%</b><p class="small muted">Przejrzyj wyjaśnienia przy pytaniach, zwłaszcza tam, gdzie jest „Źle”.</p></div></div>`;
  } else top = `<div class="notice small">Podgląd z kluczem odpowiedzi i wyjaśnieniami.</div>`;
  root.innerHTML = frame(`<div class="head"><div><button class="btn sm ghost" data-act="back" style="justify-self:start">← Wróć</button><p class="eyebrow">${esc(t.topic || "")}${t.level ? " · " + esc(t.level) : ""}</p><h1>${esc(t.title)}</h1>${v.who ? `<p class="muted">${esc(v.who)}</p>` : ""}</div></div>
  ${top}<div class="sheet">${t.instructions ? `<p class="muted">${esc(t.instructions)}</p>` : ""}${testBody(t, v.answers, v.mode)}</div>${bottom}`);
}
async function submitTest() {
  const v = S.view; const t = v.test; const total = t.questions.length;
  if (Object.keys(v.answers).length < total && !(await ask("Nie odpowiedziałeś/aś na wszystkie pytania. Oddać mimo to?", "Oddaj"))) return;
  let score = 0; t.questions.forEach((q, n) => { if (v.answers[n] === q.c) score++; });
  const res = { assignmentId: v.assignment.id, studentId: S.user.studentId, testId: t.id, answers: v.answers, score, max: total, submittedAt: new Date().toISOString() };
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
  const list = cat === "all" ? all : all.filter(m => m.category === cat);
  const used = id => planStudents().filter(s => S.data.plans[s.id].lessons.some(l => (l.mats || []).some(k => "z" + pad(k) === id))).map(s => s.name);
  return `<div class="head"><div><p class="eyebrow">Wspólne dla wszystkich uczniów</p><h1>Materiały na lekcje</h1></div></div>
  <div class="pills"><button data-act="matCat" data-k="all" aria-pressed="${cat === "all"}">Wszystkie</button>${MAT_CATS.map(([k, l]) => `<button data-act="matCat" data-k="${k}" aria-pressed="${cat === k}">${l}</button>`).join("")}</div>
  ${searchBox("mat", "np. słowotwórstwo, Człowiek, Present Perfect, zestaw 01")}
  <div class="list">${list.map(m => { const u = used(m.id); return `<button class="row" data-act="openMat" data-id="${m.id}" data-s-mat="${esc(matText(m))}"><span class="grow"><b>${esc(m.title)}</b><span class="small muted">${esc(m.topic || "")}${u.length ? " · w planie: " + esc(u.join(", ")) : ""}</span></span><span class="chip acc">${esc((MAT_CATS.find(c => c[0] === m.category) || ["", ""])[1])}</span></button>`; }).join("") || '<p class="empty">Brak materiałów w tej kategorii.</p>'}</div>
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
  <button class="btn primary" data-act="printMat" data-key="1">PDF z odpowiedziami</button><button class="btn" data-act="printMat" data-key="0">PDF bez odpowiedzi</button></div></div>
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
  return `<div class="head"><div><p class="eyebrow">Stan na dziś · to samo widzi uczeń</p><h1>Płatności</h1></div></div>
  <div class="list">${rows.map(r => `<button class="row" data-act="selP" data-id="${r.s.id}"><span class="grow"><b>${esc(r.s.name)}</b><span class="small muted">do zapłaty ${zl(r.b.due)} · wpłaty ${zl(r.b.paid)}${r.nx ? " · następna: " + esc(fmtDate(r.nx.date) + ", " + (r.nx.time || "")) : ""}</span></span><span class="chip ${r.b.bal > 0 ? "bad" : "ok"}">${r.b.bal > 0 ? "do zapłaty " + zl(r.b.bal) : r.b.bal < 0 ? "nadpłata " + zl(-r.b.bal) : "opłacone"}</span></button>`).join("") || '<p class="empty">Brak danych – zaimportuj lekcje w Ustawieniach.</p>'}</div>`;
}

/* ---------------- Laura: zadania ---------------- */
function renderZadania() {
  const st = Object.values(S.data.students).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  const ts = Object.values(S.data.tests).sort((a, b) => a.title.localeCompare(b.title, "pl"));
  const as = Object.values(S.data.assignments).sort((a, b) => (b.due || "").localeCompare(a.due || ""));
  return `<div class="head"><div><p class="eyebrow">Testy i zadania własne</p><h1>Zadania domowe</h1></div></div>
  <form class="panel" id="assignForm" style="display:grid;gap:12px"><h2>Zadaj zadanie</h2>${assignFormHtml(null)}</form>
  <section class="panel"><h2>Wszystkie zadania</h2>${as.length ? `<div class="tablewrap"><table><thead><tr><th>Uczeń</th><th>Zadanie</th><th>Termin</th><th>Wynik</th><th></th></tr></thead><tbody>
  ${as.map(a => { const r = S.data.results[a.id]; const s = S.data.students[a.studentId]; const cu = a.kind === "custom";
    return `<tr class="${r && !cu ? "click" : ""}" ${r && !cu ? `data-act="viewResult" data-id="${a.id}"` : ""}><td>${esc(s ? s.name : "?")}</td><td style="white-space:normal">${esc(taskTitle(a))}${cu ? ' <span class="chip">własne</span>' : ""}</td><td>${fmtDate(a.due)}</td><td>${cu ? (r ? '<span class="chip ok">zrobione</span>' : `${a.due && a.due < today() ? '<span class="chip bad">po terminie</span> ' : ""}<button class="btn sm" data-act="doneCustom" data-id="${a.id}">Odhacz</button>`) : r ? `<span class="chip ${pct(r.score, r.max) >= 70 ? "ok" : pct(r.score, r.max) >= 50 ? "warn" : "bad"}">${r.score}/${r.max} · ${pct(r.score, r.max)}%</span>` : a.due < today() ? '<span class="chip bad">po terminie</span>' : '<span class="chip">czeka</span>'}</td>
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
function renderUczniowie() {
  const st = Object.values(S.data.students).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  return `<div class="head"><div><p class="eyebrow">Konta uczniów</p><h1>Uczniowie</h1></div></div>
  <p class="muted small">Kliknij „Zadaj zadanie”, żeby dać uczniowi test albo własne zadanie (np. zadania maturalne z funkcji). Utwórz uczniowi konto, a aplikacja pokaże Ci gotową wiadomość z linkiem, e-mailem i hasłem do wysłania.</p>
  <div class="list">${st.map(s => `<div class="row"><span class="grow"><b>${esc(s.name)}</b><span class="small muted">${esc(s.subjectLabel || "angielski")}${s.level ? " · " + esc(s.level) : ""}${s.loginEmail ? " · konto: " + esc(s.loginEmail) : ""}</span></span>
  ${(() => { const n = Object.values(S.data.assignments).filter(a => a.studentId === s.id && !S.data.results[a.id]).length; return n ? `<span class="chip">${n} do zrobienia</span>` : ""; })()}
  <button class="btn sm primary" data-act="stOpen" data-id="${s.id}">Zadaj zadanie</button>
  ${s.loginEmail ? '<span class="chip ok">ma konto</span>' : `<button class="btn sm mustard" data-act="makeLogin" data-id="${s.id}">Utwórz konto</button>`}</div>`).join("")}</div>
  <form class="panel" id="addStudent"><h2>Dodaj ucznia</h2><div class="frow"><label class="f">Imię<input name="name" required></label>
  <label class="f">Przedmiot<select name="subj"><option>angielski</option><option>matematyka</option></select></label>
  <label class="f">Poziom<select name="level"><option value="PR">rozszerzony</option><option value="PP">podstawowy</option></select></label>
  <button class="btn primary" type="submit">Dodaj</button></div></form>`;
}
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
  <section class="panel"><h2>Plany i czytanki startowe</h2><p class="small muted">Wczytuje uczniów-maturzystów, ich plany lekcji, czytanki i materiały na lekcje. Istniejące zapisy (zrobione lekcje, notatki, wyniki) zostają. Plany zostaną nadpisane wersją z pliku.</p>
  <div class="chips"><button class="btn primary" data-act="seed">Wczytaj plany, czytanki i materiały</button></div></section>
  <section class="panel"><h2>Import z poprzedniej aplikacji</h2><p class="small muted">Wgraj plik <b>dane-startowe.json</b>. Przeniesie uczniów, lekcje z kalendarza, wpłaty, dane do przelewu i plany maturzystów. Import możesz powtórzyć – nic się nie zdubluje.</p>
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

/* ---------------- render ---------------- */
function render() {
  if (!S.user) return renderLogin();
  if (S.user.role !== "admin") return renderStudent();
  if (S.view && S.view.type === "test") return renderTest();
  if (S.view && S.view.type === "mat") return renderMat();
  const t = S.tab;
  const html = t === "zadania" ? renderZadania() : t === "testy" ? renderTesty() : t === "uczniowie" ? renderUczniowie() : t === "ustawienia" ? renderUstawienia() : t === "matematyka" ? renderMatematyka() : t === "materialy" ? renderMaterialy() : t === "platnosci" ? renderPlatnosci() : renderMaturzysci();
  root.innerHTML = frame(html);
  applyFilter("testy"); applyFilter("mat"); wireKind(root);
}

/* ---------------- akcje ---------------- */
async function addAssignment(sid, tid, due) {
  const id = rid(); const a = { studentId: sid, testId: tid, due: due || "", createdAt: new Date().toISOString() };
  await B.set("assignments", id, a); S.data.assignments[id] = { id, ...a }; return id;
}
root.addEventListener("click", async e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act;
  try {
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
    else if (act === "stOpen") { studentModal(S.data.students[el.dataset.id]); }
    else if (act === "doneCustom") { await markCustomDone(el.dataset.id); toast(S.user.role === "admin" ? "Odhaczone" : "Super, zapisane!"); render(); }
    else if (act === "openTest") {
      const a = S.data.assignments[el.dataset.id]; const t = S.data.tests[a.testId]; if (!t) return toast("Nie znaleziono testu.");
      const r = S.data.results[a.id];
      S.view = r ? { type: "test", mode: "result", test: t, assignment: a, answers: r.answers || {}, result: r } : { type: "test", mode: "take", test: t, assignment: a, answers: {} };
      render(); window.scrollTo(0, 0);
    }
    else if (act === "ans") { if (S.view.mode !== "take") return; S.view.answers[el.dataset.n] = JSON.parse(el.dataset.v); const y = window.scrollY; renderTest(); window.scrollTo(0, y); }
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
    if (data.mirror) for (const c of ["lessons", "payments"]) {
      const keep = new Set(Object.keys(data[c] || {})); const gone = Object.keys(S.data[c] || {}).filter(id => !keep.has(id));
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
    if (u) { root.innerHTML = frame('<p class="empty">Ładowanie…</p>'); try { u.role === "admin" ? await loadAdmin() : await loadStudent(); } catch (e) { root.innerHTML = frame(`<div class="notice bad">${esc(errMsg(e))}</div>`); return; } }
    render();
  });
  if ("serviceWorker" in navigator && location.protocol === "https:" && !DEMO) navigator.serviceWorker.register("sw.js").catch(() => { });
})();
