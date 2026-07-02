// Service Worker — P&L Diario
// Maneja notificaciones Web Push y cacheo offline básico

const CACHE_NAME = "pnl-v3"; // ← incrementar con cada deploy para forzar actualización

// ── Instalación: cachear el archivo principal ────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["./index.html"]))
  );
  self.skipWaiting(); // activar inmediatamente sin esperar que se cierren tabs viejas
});

// ── Activación: eliminar cachés viejos ───────────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => clients.claim()) // tomar control de todas las tabs abiertas
  );
});

// ── Fetch: red primero, fallback a caché ─────────────────────────────────────
// Para index.html siempre va a la red primero — así el usuario siempre recibe
// la versión más nueva del archivo aunque el SW esté activo.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const isHtml = url.pathname.endsWith(".html") || url.pathname.endsWith("/");

  if (isHtml) {
    // HTML: red primero, actualizar caché, fallback a caché si offline
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Otros assets: caché primero (fuentes, íconos, etc.)
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return resp;
        });
      })
    );
  }
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
