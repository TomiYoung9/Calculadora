/* service-worker.js — Calculadora de Función Diastólica
 * Estrategias:
 * - Navegación (HTML): network-first → fallback index.html
 * - Estáticos same-origin (css/js/img/svg/json/ico): cache-first + revalidación en segundo plano
 * - Google Fonts: css (stale-while-revalidate), woff/woff2 (cache-first)
 * Auto-update:
 * - En install → self.skipWaiting() para activar la nueva versión sin esperar
 * - En activate → clients.claim() y se fuerza reload de las ventanas controladas
 */

const VERSION = "v1.4.1";
const STATIC_CACHE = `df-static-${VERSION}`;
const FONTS_CACHE  = `df-fonts-${VERSION}`;

// Base path según scope (soporta GitHub Pages en subcarpeta)
const SCOPE_URL  = new URL(self.registration.scope);
const BASE_PATH  = SCOPE_URL.pathname.endsWith("/") ? SCOPE_URL.pathname : SCOPE_URL.pathname + "/";
const INDEX_HTML = BASE_PATH + "index.html";

// Núcleo mínimo para arrancar offline
const CORE_ASSETS = [
  BASE_PATH,
  INDEX_HTML,
  BASE_PATH + "manifest.json",
  BASE_PATH + "icons/icon-192.png",
  BASE_PATH + "icons/icon-512.png",
  BASE_PATH + "icons/icon-192-maskable.png",
  BASE_PATH + "icons/icon-512-maskable.png",
  BASE_PATH + "icons/apple-touch-icon-180.png",
  BASE_PATH + "icons/favicon-32.png",
  BASE_PATH + "icons/favicon-16.png",
  BASE_PATH + "icons/favicon.ico"
];

// --- helpers ---
async function addAllSafe(cache, urls) {
  await Promise.all(
    urls.map(async (u) => {
      try {
        // cache: "reload" evita devolver 304 del navegador y fuerza red real
        const req = new Request(u, { cache: "reload" });
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) {
          await cache.put(req, res.clone());
        }
      } catch { /* ignorar fallos individuales */ }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await addAllSafe(cache, CORE_ASSETS);
    // Auto-activate la nueva versión
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Borrar caches viejos
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== STATIC_CACHE && k !== FONTS_CACHE)
        .map(k => caches.delete(k))
    );

    // Habilitar navigationPreload si está disponible
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }

    // Tomar control inmediato
    await self.clients.claim();

    // Forzar recarga de todas las ventanas controladas (auto-update visible)
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.navigate(client.url).catch(() => {});
      }
    } catch {}
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Navegación / HTML
  if (req.mode === "navigate") {
    event.respondWith(networkFirstHTML(event));
    return;
  }

  // 2) Google Fonts (CSS)
  if (url.origin === "https://fonts.googleapis.com") {
    event.respondWith(staleWhileRevalidate(req, FONTS_CACHE));
    return;
  }

  // 3) Google Fonts (WOFF/WOFF2)
  if (url.origin === "https://fonts.gstatic.com") {
    event.respondWith(cacheFirst(req, FONTS_CACHE));
    return;
  }

  // 4) Estáticos same-origin
  if (url.origin === location.origin) {
    if (/\.(?:css|js|mjs|png|jpg|jpeg|webp|svg|ico|gif|json|txt|woff2?)$/i.test(url.pathname)) {
      event.respondWith(cacheFirst(req, STATIC_CACHE, { revalidate: true }));
      return;
    }
  }

  // 5) Default → red
  // (no interceptamos, dejamos que vaya a la red)
});

// --- estrategias ---

async function networkFirstHTML(event) {
  try {
    // Usar navigationPreload si el navegador lo aporta
    const preload = await event.preloadResponse;
    if (preload) return preload;

    const netRes = await fetch(event.request, { cache: "no-store" });
    const cache = await caches.open(STATIC_CACHE);
    cache.put(event.request, netRes.clone());
    return netRes;
  } catch {
    // Fallback a index.html del cache
    const cache = await caches.open(STATIC_CACHE);
    const fallback = await cache.match(INDEX_HTML);
    return fallback || new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then((res) => {
    if (res && (res.ok || res.type === "opaque")) {
      cache.put(request, res.clone());
    }
    return res;
  }).catch(() => null);
  return cached || (await networkFetch) || fetch(request);
}

async function cacheFirst(request, cacheName, opts = { revalidate: false }) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Revalidación en segundo plano si se pide
    if (opts.revalidate) {
      fetch(request).then((res) => {
        if (res && (res.ok || res.type === "opaque")) {
          cache.put(request, res.clone());
        }
      }).catch(() => {});
    }
    return cached;
  }
  const res = await fetch(request);
  if (res && (res.ok || res.type === "opaque")) {
    cache.put(request, res.clone());
  }
  return res;
}
