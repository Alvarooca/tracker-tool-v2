// ─────────────────────────────────────────────────────────────────────────────
//  P&L Diario — Service Worker
//  Estrategia: Network-first para el app shell (index.html / JS)
//              Cache-first  para assets inmutables (fuentes, iconos)
//              Network-only para todas las APIs externas (Supabase, Finnhub, etc.)
//
//  Para forzar una purga completa de la caché basta con cambiar CACHE_VERSION.
//  El SW nuevo se instala, limpia los cachés viejos en "activate" y se activa
//  de inmediato gracias a skipWaiting() + clients.claim().
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = "v5";
const CACHE_SHELL   = `pnl-shell-${CACHE_VERSION}`;   // HTML + JS del app
const CACHE_STATIC  = `pnl-static-${CACHE_VERSION}`;  // fuentes, iconos, manifest

// ── Dominios que NUNCA se cachean (siempre red) ──────────────────────────────
const NETWORK_ONLY_HOSTS = [
  "supabase.co",
  "finnhub.io",
  "twelvedata.com",
  "brapi.dev",
  "bcb.gov.br",
  "query1.finance.yahoo.com",
  "api.anthropic.com",
];

// ── Assets estáticos que se pueden cachear agresivamente ────────────────────
const STATIC_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdnjs.cloudflare.com",
];

// ── INSTALL: pre-cachear el shell de la app ──────────────────────────────────
self.addEventListener("install", (event) => {
  // skipWaiting() hace que el nuevo SW tome el control SIN esperar a que
  // todas las pestañas cierren — así la actualización es inmediata.
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) =>
      // Cacheamos index.html con network-request para tener la copia más fresca
      // desde el primer momento (no la versión ya vieja que hubiera en caché).
      fetch("./", { cache: "no-store" })
        .then((res) => {
          if (res.ok) cache.put("./", res);
        })
        .catch(() => {/* sin red al instalar: no hay pre-caché, no pasa nada */})
    )
  );
});

// ── ACTIVATE: eliminar cachés de versiones anteriores ────────────────────────
self.addEventListener("activate", (event) => {
  const KEEP = [CACHE_SHELL, CACHE_STATIC];

  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !KEEP.includes(k))
            .map((k) => {
              console.log(`[sw] Eliminando caché viejo: ${k}`);
              return caches.delete(k);
            })
        )
      )
      // clients.claim() hace que este SW tome el control de las pestañas ya
      // abiertas sin que el usuario tenga que recargar manualmente.
      .then(() => self.clients.claim())
  );
});

// ── FETCH: lógica de interceptación por tipo de recurso ──────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo interceptamos GET
  if (req.method !== "GET") return;

  // ── 1. Network-only: APIs externas — nunca cachear ──────────────────────
  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.includes(h))) {
    // Dejamos pasar sin tocar: el navegador maneja el error si no hay red.
    return;
  }

  // ── 2. Cache-first: fuentes y CDN estáticos ─────────────────────────────
  if (STATIC_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(CACHE_STATIC).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => cached); // sin red y sin caché: falla silenciosamente
        })
      )
    );
    return;
  }

  // ── 3. Network-first: el app shell (index.html y cualquier recurso local) ─
  //    Siempre intenta la red primero para servir la versión más nueva.
  //    Solo usa la caché si la red falla (offline real).
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          // Guardar la respuesta fresca en caché para el fallback offline
          if (res.ok) {
            caches.open(CACHE_SHELL).then((cache) => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(() =>
          // Red falló → intentar caché
          caches.match(req).then((cached) => {
            if (cached) return cached;
            // Sin caché tampoco: devolver página de error offline mínima
            return new Response(offlinePage(), {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          })
        )
    );
    return;
  }
});

// ── Página offline mínima ─────────────────────────────────────────────────────
// Se muestra SOLO cuando no hay red Y no hay nada en caché (primera carga offline).
// En el uso normal (app ya visitada antes), index.html estará en caché y se servirá.
function offlinePage() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>P&L Diario — Sin conexión</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',system-ui,sans-serif;background:#0A0D10;color:#ECEFF2;
       display:flex;flex-direction:column;align-items:center;justify-content:center;
       min-height:100vh;padding:24px;text-align:center;gap:16px}
  .icon{font-size:48px;margin-bottom:8px}
  h1{font-size:20px;font-weight:600}
  p{color:#7A8290;font-size:14px;max-width:320px;line-height:1.6}
  button{margin-top:8px;background:#E8B339;color:#15130A;border:none;
         padding:12px 24px;border-radius:20px;font-size:14px;font-weight:600;
         cursor:pointer}
</style>
</head>
<body>
<div class="icon">📡</div>
<h1>Sin conexión</h1>
<p>No se pudo cargar la app. Conectate a internet y volvé a intentar.</p>
<p>Si ya usaste la app antes, recargá la página — puede que esté en caché.</p>
<button onclick="location.reload()">Reintentar</button>
</body>
</html>`;
}

// ── Notificaciones push (preparadas para reimplementar) ──────────────────────
// El SW necesita estar registrado para recibir push. La suscripción se maneja
// desde la app principal (registerPushSubscription en index.html).
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "P&L Diario", body: "", tag: "pnl-notif" };
  try { payload = { ...payload, ...event.data.json() }; } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      data: { url: self.location.origin },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || self.location.origin;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.startsWith(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(target);
    })
  );
});
