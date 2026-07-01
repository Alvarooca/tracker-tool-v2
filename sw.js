// Service Worker — P&L Diario
// Maneja notificaciones Web Push y cacheo offline básico

const CACHE_NAME = "pnl-v1";

// ── Instalación: cachear el archivo principal ────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["./index.html"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

// ── Fetch: red primero, fallback a caché ─────────────────────────────────────
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push: recibir notificación del servidor ───────────────────────────────────
self.addEventListener("push", (e) => {
  let data = { title: "P&L Diario", body: "Nueva actualización de tu cartera." };
  try { data = e.data.json(); } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: data.tag || "pnl-notif",
      renotify: true,
      data: { url: data.url || "./" },
    })
  );
});

// ── Click en notificación: abrir / enfocar la app ────────────────────────────
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const match = wins.find((w) => w.url.includes("index.html") || w.url.endsWith("/"));
      if (match) return match.focus();
      return clients.openWindow(url);
    })
  );
});
