// Prosty service worker: aplikacja otwiera się szybko i działa jak zainstalowana.
const C = "pe-v4";
const SHELL = ["./", "index.html", "app.js", "config.js", "seed.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // Firebase i czcionki zawsze z sieci
  // po zapisaniu nowej wersji pliku (?v=…) usuń stare wersje tego samego pliku – inaczej pamięć telefonu zapycha się przy każdej aktualizacji
  const prune = c => c.keys().then(ks => Promise.all(ks.filter(k => { const x = new URL(k.url); return x.pathname === u.pathname && x.search !== u.search; }).map(k => c.delete(k))));
  const net = () => fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp).then(() => u.searchParams.has("v") ? prune(c) : 0)); } return r; });
  // pliki z numerem wersji (?v=…) i obrazki arkuszy się nie zmieniają – najpierw z pamięci telefonu, bez czekania na sieć
  if (u.searchParams.has("v")) { e.respondWith(caches.match(e.request).then(hit => hit || net())); return; }
  // obrazki arkuszy: od razu z pamięci, a w tle pobierz świeżą wersję (żeby poprawione wycinki dotarły przy następnym otwarciu)
  if (u.pathname.includes("/arkusze/")) { e.respondWith(caches.match(e.request).then(hit => { const f = net().catch(() => hit); return hit || f; })); return; }
  e.respondWith(net().catch(() => caches.match(e.request)));
});
