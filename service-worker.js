/* service-worker.js — Calculadora de Función Diastólica
 * Estrategias:
 * - Navegación (HTML): network-first → fallback index.html
 * - Estáticos same-origin (css/js/img/svg): cache-first + revalidación
 * - Google Fonts: css (stale-while-revalidate), woff2 (cache-first)
 * Auto-update:
 * - La página envía {type:'SKIP_WAITING'} → self.skipWaiting()
 * - En activate → clients.claim(); la página escucha controllerchange y recarga
 */

const VERSION = "v1.0.0";
const STATIC_CACHE = `df-static-${VERSION}`;
const FONTS_CACHE  = `df-fonts-${VERSION}`;

// Base path según scope (soporta GitHub Pages en subcarpeta)
const SCOPE_URL  = new URL(self.registration.scope);
const BASE_PATH  = SCOPE_URL.pathname.endsWith("/") ? SCOPE_URL.pathname : SCOPE_URL.pathname + "/";
const INDEX_HTML = BASE_PATH + "index.html";

const CORE_ASSETS = [
  BASE_PATH,
  INDEX_HTML,
  BASE_PATH + "manifest.json",
  BASE_PATH + "icon-192.png",
  BASE_PATH + "icon-512.png",
];

// Precarga segura de core
async function addAllSafe(cache, urls) {
  await Promise.all(urls.map(async (u) => {
    try {
      const req = new Request(u, { cache: "reload" });
      await cache.add(req);
    } catch {}
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await addAllSafe(cache, CORE_ASSETS);
    // skipWaiting se dispara desde la página para control fino
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== STATIC_CACHE && k !== FONTS_CACHE)
      .map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
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
});

async function networkFirstHTML(event) {
  try {
    const preload = await event.preloadResponse;
    if (preload) return preload;

    const netRes = await fetch(event.request);
    const cache = await caches.open(STATIC_CACHE);
    cache.put(event.request, netRes.clone());
    return netRes;
  } catch {
    const cache = await caches.open(STATIC_CACHE);
    const fallback = await cache.match(INDEX_HTML);
    return fallback || new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then((res) => {
    cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await networkFetch) || fetch(request);
}

async function cacheFirst(request, cacheName, opts = { revalidate: false }) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    if (opts.revalidate) {
      fetch(request).then((res) => cache.put(request, res.clone())).catch(() => {});
    }
    return cached;
  }
  const res = await fetch(request);
  if (res && (res.ok || res.type === "opaque")) {
    cache.put(request, res.clone());
  }
  return res;
}
