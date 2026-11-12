"use strict";
// Web and Microsoft Store version: the service worker (sw.js) keeps the game for offline play and fetches updates.
// (start.js may load this file after the page has finished loading, so it doesn't wait for "load" then.)
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  const whenLoaded = (f) => (document.readyState === "complete" ? f() : window.addEventListener("load", f));
  whenLoaded(() => {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => {
        // A new version downloads in the background and starts with the next launch.
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          w?.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller && typeof toast === "function") toast(txt("pwa.update"), "info");
          });
        });
      })
      .catch((e) => console.warn("service worker", e));
    // Hero models are kept for offline play once they have loaded.
    Promise.resolve(window.MiniHeroes?.ready)
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => reg.active?.postMessage("cache-heroes"))
      .catch(() => {});
  });
}
