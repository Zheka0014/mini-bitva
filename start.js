"use strict";
// Starts the web / Microsoft Store version. With storeOnly in config.js the game runs only when it was started from
// the Microsoft Store app on this device (the Store opens it with a referrer of app-info://platform/microsoft-store
// and the start address ?from=ms-store); a plain visit to the site shows where to get the game instead.
// The check is deliberately simple: it keeps a paid game from being free next door, it is not copy protection.
(function () {
  const cfg = window.MiniConfig || {},
    KEY = "mini-bitva-store",
    SCRIPTS = ["lang.js", "three.js", "heroes.js", "hero-animation.js", "engine.js", "game.js", "net.js", "pwa.js"];
  let ok = !cfg.storeOnly;
  try {
    ok = ok || localStorage.getItem(KEY) === "1";
  } catch {}
  const fromStore = /^app-info:\/\/platform\/microsoft-store/.test(document.referrer) || new URLSearchParams(location.search).get("from") === "ms-store";
  if (fromStore) {
    ok = true;
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  }
  if (ok) {
    // The game's scripts, one after another in this order (they share globals, as plain <script> tags would).
    for (const src of SCRIPTS) {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      document.body.appendChild(s);
    }
    return;
  }
  const en = !/^(ru|uk|be|kk)/i.test(navigator.language || "");
  const t = en
    ? {
        title: "Mini Bitva is a game for Windows",
        text: "Ten tiny heroes, four huge arenas in an ordinary home, and one crown. Get the game from the Microsoft Store to play.",
        button: "Get it from Microsoft Store",
        have: "Already bought it? Start the game from the Start menu on your PC.",
        privacy: "Privacy policy",
      }
    : {
        title: "Мини-Битва — игра для Windows",
        text: "Десять крошечных героев, четыре огромные арены в обычном доме и одна корона. Чтобы играть, установи игру из Microsoft Store.",
        button: "Получить в Microsoft Store",
        have: "Уже купил? Запусти игру из меню «Пуск» на компьютере.",
        privacy: "Политика конфиденциальности",
      };
  const page = `
    <main class="gate">
      <img src="icon-512.png" alt="" width="160" height="160" />
      <h1>${t.title}</h1>
      <p>${t.text}</p>
      <a class="gateButton" href="${cfg.storeUrl || "https://apps.microsoft.com/detail/9PJGQPHW6MKQ"}" rel="noopener">${t.button}</a>
      <p class="gateSmall">${t.have}</p>
      <p class="gateSmall"><a href="privacy.html${en ? "#en" : ""}">${t.privacy}</a></p>
    </main>`;
  const style = document.createElement("style");
  style.textContent = `
    html, body { margin: 0; min-height: 100%; background: #2a2150; color: #f4f0ff; font: 17px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .gate { max-width: 560px; margin: 0 auto; padding: 56px 20px; text-align: center; }
    .gate img { width: 160px; height: 160px; }
    .gate h1 { font-size: 30px; line-height: 1.2; margin: 20px 0 10px; }
    .gate p { color: #e2dbff; }
    .gateButton { display: inline-block; margin: 18px 0 8px; padding: 14px 26px; border-radius: 14px; background: #ffc933;
      color: #2a2150; font-weight: 800; text-decoration: none; box-shadow: 0 5px 0 #c9921b; }
    .gateSmall { font-size: 14px; }
    .gateSmall a { color: #ffe08a; }`;
  document.head.appendChild(style);
  document.title = en ? "Mini Bitva — Microsoft Store" : "Мини-Битва — Microsoft Store";
  document.body.innerHTML = page;
})();
