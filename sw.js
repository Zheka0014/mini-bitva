"use strict";
// Mini Bitva service worker: the game works offline after the first start.
// The game files are saved at install; hero models (.glb, ~40 MB) right after the game first loads them.
// Each build writes its own VERSION, so a new upload replaces the saved game files.
const VERSION = "375bc0553553",
  CORE = ["./", "config.js", "engine.js", "game.js", "hero-animation.js", "heroes.js", "icon-128.png", "icon-144.png", "icon-152.png", "icon-180.png", "icon-192.png", "icon-256.png", "icon-384.png", "icon-48.png", "icon-512.png", "icon-72.png", "icon-96.png", "icon-maskable-192.png", "icon-maskable-512.png", "index.html", "lang.js", "manifest.webmanifest", "net.js", "privacy.html", "pwa.js", "style.css", "three-LICENSE.txt", "three.js"],
  CORE_CACHE = "mb-core-" + VERSION,
  HEROES = ["hero-01.glb", "hero-02.glb", "hero-03.glb", "hero-04.glb", "hero-05.glb", "hero-06.glb", "hero-07.glb", "hero-08.glb", "hero-09.glb", "hero-10.glb"],
  HERO_CACHE = "mb-heroes-f65d8a869e";
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CORE_CACHE)
      .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mb-") && k !== CORE_CACHE && k !== HERO_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
// The page asks once its heroes have loaded (by then the browser's own cache holds them, so nothing downloads twice).
self.addEventListener("message", (e) => {
  if (e.data !== "cache-heroes") return;
  e.waitUntil(
    caches.open(HERO_CACHE).then((c) => Promise.all(HEROES.map((u) => c.match(u).then((hit) => hit || c.add(u))))).catch(() => {}),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request,
    url = new URL(req.url);
  // Online play (PlayFab) and anything else on other sites goes straight to the network.
  if (req.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    (async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && url.pathname.endsWith(".glb")) (await caches.open(HERO_CACHE)).put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
        throw err;
      }
    })(),
  );
});
