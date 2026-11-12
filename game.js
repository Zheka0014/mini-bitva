"use strict";
const qaMode = !!window.miniBitvaQA || (typeof location !== "undefined" && new URLSearchParams(location.search).has("qa"));
// Names and descriptions are filled in from lang.js by localizeTables().
const weapons = [
  { dmg: 20, cd: 0.5, range: 2.6, cap: 0, color: "#c5d7d6", kind: "melee" },
  { dmg: 15, cd: 0.38, range: 32, cap: 12, color: "#cbb583", kind: "shot" },
  { dmg: 10, cd: 0.65, range: 28, cap: 30, color: "#97bdd0", kind: "burst" },
  { dmg: 35, cd: 0.95, range: 42, cap: 8, color: "#d9b98c", kind: "bow" },
  { dmg: 8, cd: 0.9, range: 17, cap: 20, color: "#de9984", kind: "spread" },
  { dmg: 12, cd: 0.3, range: 2, cap: 0, color: "#d8bd84", kind: "melee" },
  { dmg: 16, cd: 0.6, range: 3, cap: 0, color: "#bfd4d0", kind: "fork" },
  { dmg: 40, cd: 1.2, range: 2.5, cap: 0, color: "#be9572", kind: "hammer" },
  { dmg: 30, cd: 0.8, range: 2.5, cap: 0, color: "#d7a08e", kind: "scissors" },
  { dmg: 45, cd: 1.2, range: 38, cap: 6, color: "#a8bc94", kind: "crossbow" },
  { dmg: 6, cd: 0.1, range: 22, cap: 45, color: "#5fd0ff", kind: "water" },
  { dmg: 24, cd: 0.75, range: 3.4, cap: 0, color: "#7bd94f", kind: "swatter" },
];
const qualities = [],
  qcolors = ["#eceadf", "#6fe38a", "#4fbfff", "#ffc93d"];
const gadgetNames = [],
  gadgetCD = [10, 12, 20, 25];
const consumables = [
  { time: 1, hp: 15 },
  { time: 3, hp: 35 },
  { time: 3, armor: 25 },
];
const skinColors = ["#ffc933", "#2fd3b5", "#ff7a59", "#4f9dff", "#b77cff", "#ff84c6"];
const botColors = ["#ff5d5d", "#4fa3ff", "#7bd94f", "#a970ff", "#ff9f1c", "#22c7b8", "#ff6fb5", "#6c7bff", "#c6e03a"];
// The current season of the pass (defined early: the Steam Cloud merge at start already needs it).
const SEASON = { id: "s1", steps: 30, per: 4 };
let profile = {
  games: 0,
  wins: 0,
  kills: 0,
  bubbles: 0,
  streak: 0,
  coinsEarned: 0,
  season: "s1",
  stars: 0,
  rp: 0,
  owned: {},
  trail: "none",
  dance: "cheer",
  xp: 0,
  skin: 0,
  hero: 0,
  hat: 0,
  paint: 0,
  ach: {},
  daily: null,
  volume: 0.55,
  music: 0.5,
  sensitivity: 0.85,
  aimSens: 0.7,
  fov: 62,
  invertY: false,
  quality: "ultra",
  autoQuality: true,
  tips: true,
  tipsSeen: {},
  shake: true,
  gfx: 2,
};
let firstRun = true;
try {
  const saved = localStorage.getItem("mini-bitva-v2");
  firstRun = !saved;
  Object.assign(profile, JSON.parse(saved || "{}"));
} catch {}
if (profile.gfx !== 2) {
  if (profile.quality === "high") profile.quality = "ultra";
  profile.gfx = 2;
}
if (!["low", "high", "ultra"].includes(profile.quality)) profile.quality = "ultra";
if (!Number.isInteger(profile.hero) || profile.hero < 0 || profile.hero >= 10) profile.hero = 0;
if (!profile.ach || typeof profile.ach !== "object") profile.ach = {};
if (!profile.owned || typeof profile.owned !== "object") profile.owned = {};
// Coins arrived later: earlier matches are paid for once (at most 600).
if (profile.coinsInit !== 1) {
  profile.coinsEarned = (profile.coinsEarned || 0) + Math.min(600, (profile.games || 0) * 12);
  profile.coinsInit = 1;
}
if (!profile.tipsSeen || typeof profile.tipsSeen !== "object") profile.tipsSeen = {};
// A first start on a Steam Deck picks graphics that suit it.
if (firstRun && window.native?.steam?.deck) profile.quality = "high";
// Steam Cloud: progress made on another computer (or a Steam Deck) is merged in; every save goes back up.
try {
  const cloud = window.native?.cloud?.load?.();
  if (cloud && mergeCloud(JSON.parse(cloud))) saveProfile();
} catch {}
function cloudPart() {
  const p = profile;
  return { v: 1, savedAt: p.savedAt || 0, games: p.games, wins: p.wins, kills: p.kills, bubbles: p.bubbles, coinsEarned: p.coinsEarned, season: p.season, stars: p.stars, rp: p.rp, owned: p.owned, trail: p.trail, dance: p.dance, xp: p.xp, skin: p.skin, hero: p.hero, hat: p.hat, paint: p.paint, ach: p.ach, daily: p.daily, tipsSeen: p.tipsSeen };
}
// Two saves meet: counters keep the bigger value, achievements and seen tips add up, the newer save picks
// the looks, and the same day's quests keep the best progress of each.
function mergeCloud(o) {
  if (!o || typeof o !== "object") return false;
  let changed = false;
  for (const k of ["games", "wins", "kills", "bubbles", "coinsEarned", "xp", ...(o.season === SEASON.id ? ["stars"] : [])])
    if (Number.isFinite(o[k]) && o[k] > (profile[k] || 0)) {
      profile[k] = o[k];
      changed = true;
    }
  for (const [k, v] of Object.entries(o.owned && typeof o.owned === "object" ? o.owned : {}))
    if (profile.owned[k] === undefined && Number.isFinite(+v)) {
      profile.owned[k] = +v;
      changed = true;
    }
  for (const key of ["ach", "tipsSeen"])
    for (const [k, v] of Object.entries(o[key] && typeof o[key] === "object" ? o[key] : {}))
      if (!profile[key][k]) {
        profile[key][k] = v;
        changed = true;
      }
  if ((o.savedAt || 0) > (profile.savedAt || 0)) {
    if (Number.isFinite(o.rp) && o.rp >= 0 && o.rp !== profile.rp) {
      profile.rp = o.rp;
      changed = true;
    }
    for (const k of ["skin", "hero", "hat", "paint"])
      if (Number.isInteger(o[k]) && o[k] >= 0 && (k !== "hero" || o[k] < 10) && o[k] !== profile[k]) {
        profile[k] = o[k];
        changed = true;
      }
    for (const k of ["trail", "dance"])
      if (typeof o[k] === "string" && o[k] !== profile[k]) {
        profile[k] = o[k];
        changed = true;
      }
    profile.savedAt = o.savedAt;
  }
  const d = o.daily,
    mine = profile.daily;
  if (d?.day && Array.isArray(d.q)) {
    if (mine?.day === d.day && Array.isArray(mine.q)) {
      for (const q of mine.q) {
        const r = d.q.find((x) => x.id === q.id && x.n === q.n && x.arena === q.arena);
        if (r && ((r.p || 0) > q.p || (r.done && !q.done))) {
          q.p = Math.max(q.p, r.p || 0);
          q.done = q.done || !!r.done;
          changed = true;
        }
      }
    } else if (d.day === dayKey()) {
      profile.daily = d;
      changed = true;
    }
  }
  return changed;
}
const options = { arena: "kitchen", duration: 180, difficulty: "normal", night: false, mode: "solo" };
// Duos: heroes play in pairs (0 + 1, 2 + 3, …); in solo every hero is a team of one.
const duo = () => options.mode === "duo";
// King of the hill: a glowing circle moves around the arena; whoever holds it alone earns points,
// knocked-out heroes come back after a few seconds, and the first to KOTH_WIN points (or the best when time runs out) wins.
const koth = () => options.mode === "koth";
const KOTH_WIN = 100,
  KOTH_RATE = 4,
  KOTH_KO = 5,
  KOTH_RESPAWN = 4,
  KOTH_MOVE = 35,
  KOTH_R = 5.5;
let KOTH = { hill: null, next: 0, score: [], holder: -1, contested: false, sync: 0, over: false };
const teamOf = (id) => (options.mode === "duo" ? id >> 1 : id);
const sameTeam = (a, b) => !!a && !!b && a.team === b.team;
const ally = (a, b) => a !== b && sameTeam(a, b);
const mateOf = (a) => (a ? actors.find((b) => b !== a && b.team === a.team) || null : null);
const teamsAlive = () => new Set(actors.filter((a) => a.alive).map((a) => a.team)).size;
const teamCount = () => new Set(actors.map((a) => a.team)).size;
const teamNames = (team) => actors.filter((a) => a.team === team).map((a) => a.name);
// Duos: a hero who drops while the teammate still stands is only downed. It crawls, bleeds out in
// BLEED_S seconds (its health becomes a small pool that rivals can finish) unless the teammate helps it up.
const DOWN_HP = 50,
  BLEED_S = 15,
  REVIVE_S = 3,
  REVIVE_HP = 30,
  REVIVE_R = 2.4,
  REVIVE_USE = 3;
const bleedLeft = (a) => Math.max(0, Math.ceil(a.hp / (DOWN_HP / BLEED_S)));
// Per-arena names and colours used by the HUD, the minimap and the results screen.
const ARENAS = {
  kitchen: { map: "#f0c58a", obst: "#b9784a" },
  garden: { map: "#8fd46a", obst: "#4f8f3a" },
  kidsroom: { map: "#8fd46a", obst: "#e0567a" },
  bathroom: { map: "#cdeef6", obst: "#4f9fc4" },
};
const arenaInfo = () => ARENAS[options.arena] || ARENAS.kitchen;
let navGrid = [],
  actors = [],
  loot = [],
  bullets = [],
  particles = [],
  rings = [],
  balloons = [],
  grenades = [],
  clouds = [],
  traps = [],
  numbers = [],
  player = null,
  cat = null;
let mode = "menu",
  paused = false,
  time = 0,
  zone = 44,
  kills = 0,
  shots = 0,
  hits = 0,
  pickups = 0,
  matchDrop = false,
  catDecided = false,
  hazard = false,
  vacuum = null,
  popped = new Set(),
  noticeTime = 0,
  feed = [],
  worldClock = 0;
let keys = {},
  mouse = { x: innerWidth * 0.55, y: innerHeight * 0.48, down: false, right: false },
  cam = [24, 35, 35],
  target = [0, 0, 0],
  cameraYaw = 0,
  cameraPitch = 0.1,
  cameraDist = 5.5,
  tactical = false,
  last = performance.now(),
  audio,
  master,
  noiseBuf = null,
  voices = 0,
  hurtFrom = [];
let freeMousePoint = null,
  pointerLockActive = false,
  pointerLockPending = false,
  pointerLockBlocked = false;
const sndLast = {};
let needsRender = true,
  freezeFrames = 0;
let matrix = new Float32Array(16),
  hurt = 0,
  hitFlash = 0,
  recoil = 0,
  // Combat feel: camera trauma (shake grows with its square), a short freeze on solid hits, a field-of-view punch.
  trauma = 0,
  hitStop = 0,
  frozenNow = false,
  fovPunch = 0,
  koMarkT = 0,
  koBannerT = 0,
  multiKO = 0,
  lastKoT = -99,
  spree = 0,
  hudTick = 0,
  stepSound = 0,
  settingsFrom = "menu",
  fps = 60,
  frameCount = 0,
  fpsTime = 0;
const rand = (a, b) => a + Math.random() * (b - a),
  dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
  clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const level = () => Math.min(100, 1 + Math.floor(profile.xp / 300));
// ---------- progression: daily quests, achievements and cosmetics ----------
const QUESTS = [
  { id: "kill", n: [4, 6, 8], xp: [80, 110, 150] },
  { id: "dmg", n: [500, 800, 1200], xp: [70, 100, 140] },
  { id: "head", n: [2, 3, 4], xp: [80, 100, 130] },
  { id: "top3", n: [1, 2], xp: [100, 160] },
  { id: "survive", n: [90, 120, 150], xp: [70, 90, 120], max: true },
  { id: "gadget", n: [2, 3, 5], xp: [60, 80, 110] },
  { id: "heal", n: [60, 100, 150], xp: [60, 80, 110] },
  { id: "rare", n: [1, 2, 3], xp: [60, 90, 120] },
  { id: "roll", n: [8, 12, 16], xp: [50, 70, 90] },
  { id: "arena", n: [1], xp: [70] },
  { id: "grenadeKill", n: [1], xp: [120] },
  { id: "meleeKill", n: [1, 2], xp: [90, 140] },
  { id: "win", n: [1], xp: [250] },
];
const ACH = [
  { id: "first", icon: "✦" },
  { id: "hat3", icon: "3" },
  { id: "five", icon: "5" },
  { id: "sniper", icon: "◎" },
  { id: "grenade", icon: "✺" },
  { id: "legend", icon: "◆" },
  { id: "roller", icon: "↻" },
  { id: "survivor", icon: "♥" },
  { id: "win", icon: "♛" },
  { id: "kitchen", icon: "☕" },
  { id: "garden", icon: "✿" },
  { id: "kids", icon: "★" },
  { id: "bath", icon: "🛁" },
  { id: "night", icon: "☾" },
  { id: "hard", icon: "⚔" },
  { id: "cat", icon: "🐾" },
  { id: "vacuum", icon: "◉" },
  { id: "games10", icon: "10" },
  { id: "games50", icon: "50" },
  { id: "medic", icon: "✚" },
  { id: "double", icon: "⚡" },
  { id: "eight", icon: "8" },
  { id: "longshot", icon: "🏹" },
  { id: "clutch", icon: "🧵" },
  { id: "arenas", icon: "🏠" },
  { id: "soap", icon: "🧼" },
  { id: "bubbles", icon: "○" },
  { id: "lvl10", icon: "🎖️" },
  { id: "hats", icon: "🎩" },
  { id: "ko100", icon: "100" },
  { id: "streak", icon: "🔥" },
  { id: "duowin", icon: "🤝" },
  { id: "online", icon: "🌐" },
  // Secret ones: the shelf (and Steam) keep their name and task hidden until they are earned.
  { id: "drain", icon: "🌀", secret: true },
  { id: "pacifist", icon: "☮", secret: true },
];
const HATS = [
  { icon: "—" },
  { icon: "🎉", lvl: 2 },
  { icon: "🧢", lvl: 3 },
  { icon: "🐱", lvl: 5 },
  { icon: "🌼", lvl: 7 },
  { icon: "🎩", lvl: 10 },
  { icon: "🐰", lvl: 13 },
  { icon: "🍳", ach: "kitchen" },
  { icon: "👒", ach: "garden" },
  { icon: "🧸", ach: "kids" },
  { icon: "👑", ach: "win" },
  { icon: "🚿", ach: "bath" },
];
const PAINTS = [
  { color: null },
  { color: "#7ff0c8", lvl: 4 },
  { color: "#ff9a76", lvl: 6 },
  { color: "#b99cff", lvl: 9 },
  { color: "#7a80d8", lvl: 12 },
  { color: "#8dffec", glow: "#0e4a44", ach: "five" },
  { color: "#ffd54a", glow: "#3a2a00", ach: "hard" },
];
// Copies the current language's names into the data tables above (called again when the language changes).
function localizeTables() {
  txt("weapons").forEach(([name, desc], i) => Object.assign(weapons[i], { name, desc }));
  qualities.splice(0, qualities.length, ...txt("qualities"));
  gadgetNames.splice(0, gadgetNames.length, ...txt("gadgets"));
  txt("consumables").forEach((name, i) => (consumables[i].name = name));
  const arenas = txt("arenas");
  for (const k in ARENAS) Object.assign(ARENAS[k], arenas[k]);
  const ach = txt("ach");
  for (const a of ACH) [a.name, a.desc] = ach[a.id];
  txt("hats").forEach((name, i) => (HATS[i].name = name));
  txt("paints").forEach((name, i) => (PAINTS[i].name = name));
}
localizeTables();
const heroName = (i) => (i ? txt("bots")[(i - 1) % 9] : txt("you"));
// How a hero is called on this screen: "You" for the local hero, the player's name online, a bot name otherwise.
const nameOf = (a) => (a === player ? txt("you") : a.nick || heroName(a.id));
function renameActors() {
  for (const a of actors) a.name = nameOf(a);
}
const ARENA_ACH = { kitchen: "kitchen", garden: "garden", kidsroom: "kids", bathroom: "bath" };
// A knockout from this far away (in world units) is a long shot: the slingshot reaches 32, the bow 42.
const LONG_SHOT = 25;
const owned = (c) => (!c.lvl && !c.ach) || (c.lvl ? level() >= c.lvl : !!profile.ach[c.ach]);
const lockText = (c) => (c.lvl ? txt("lockLevel", c.lvl) : txt("lockAch", ACH.find((a) => a.id === c.ach).name));
const skinOwned = (i) => i < 3 || level() >= i;
function dayKey() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}
// Three quests a day, picked from the date so they stay the same all day.
function ensureDaily() {
  const key = dayKey();
  if (profile.daily && profile.daily.day === key && Array.isArray(profile.daily.q)) return profile.daily;
  let h = 7;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => (h = (Math.imul(h, 1103515245) + 12345) >>> 0) / 4294967296;
  const pool = QUESTS.filter((q) => q.id !== "win" || rnd() < 0.3),
    picked = [];
  while (picked.length < 3 && pool.length) {
    const q = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    if (q.id === "meleeKill" && picked.some((p) => p.id === "grenadeKill")) continue;
    picked.push(q);
  }
  profile.daily = {
    day: key,
    q: picked.map((q) => {
      const t = Math.floor(rnd() * q.n.length);
      return { id: q.id, n: q.n[t], xp: q.xp[t], p: 0, done: false, arena: q.id === "arena" ? ["kitchen", "garden", "kidsroom", "bathroom"][Math.floor(rnd() * 4)] : undefined };
    }),
  };
  saveProfile();
  return profile.daily;
}
const questText = (q) => {
  const all = txt("quests");
  return (all[q.id] || all.kill)(q.n, (ARENAS[q.arena] || ARENAS.kitchen).name);
};
function questEvent(ev, amount = 1) {
  const d = ensureDaily();
  let changed = false;
  for (const q of d.q) {
    if (q.done) continue;
    const def = QUESTS.find((x) => x.id === q.id);
    if (!def || (q.id === "arena" ? ev !== "play:" + q.arena : q.id !== ev)) continue;
    q.p = def.max ? Math.max(q.p, amount) : q.p + amount;
    changed = true;
    if (q.p >= q.n) {
      q.p = q.n;
      q.done = true;
      stats?.quests.push(q);
      if (stats) stats.questXp += q.xp;
      earnCoins(Math.round(q.xp / 4));
      addStars(1);
      toast(txt("toastQuest", questText(q), q.xp), "quest");
      sound("quest");
      addXp(q.xp);
      saveProfile();
    }
  }
  return changed;
}
function addXp(n) {
  const before = level();
  profile.xp += n;
  if (level() > before) levelUp(before);
}
function levelUp(before) {
  const now = level();
  toast(txt("toastLevel", now), "level");
  for (const c of [...HATS, ...PAINTS])
    if (c.lvl && c.lvl > before && c.lvl <= now) {
      toast(txt("toastGift", c.name), "gift");
      stats?.gifts.push(c);
    }
  for (let i = 3; i < skinColors.length; i++)
    if (i > before && i <= now) {
      toast(txt("toastSkin"), "gift");
      stats?.gifts.push({ skin: i });
    }
}
// Long-term goals. An achievement's own XP can finish another goal, so the checks run until nothing changes.
function checkProgress() {
  for (let i = 0; i < 4; i++) {
    const before = Object.keys(profile.ach).length;
    if (level() >= 10) unlock("lvl10");
    if (profile.kills >= 100) unlock("ko100");
    if ((profile.bubbles || 0) >= 10) unlock("bubbles");
    if (Object.values(ARENA_ACH).every((id) => profile.ach[id])) unlock("arenas");
    if (HATS.every(owned)) unlock("hats");
    if (Object.keys(profile.ach).length === before) break;
  }
}
function unlock(id) {
  const a = ACH.find((x) => x.id === id);
  if (!a || profile.ach[id]) return;
  profile.ach[id] = Date.now();
  window.native?.steam?.achievement?.(id);
  stats?.achs.push(a);
  if (stats) stats.achXp += 50;
  earnCoins(15);
  toast(txt("toastAch", a.name), "ach");
  sound("quest");
  addXp(50);
  for (const c of [...HATS, ...PAINTS])
    if (c.ach === id) {
      toast(txt("toastGift", c.name), "gift");
      stats?.gifts.push(c);
    }
  saveProfile();
}
// Short notices in the corner: completed quests, achievements, new unlocks.
let toastList = [],
  toastDirty = false;
function toast(text, kind = "info") {
  toastList.push({ text, kind, life: 4.6 });
  if (toastList.length > 5) toastList.shift();
  toastDirty = true;
}
function drawToasts(dt) {
  if (!toastList.length && !toastDirty) return;
  for (const t of toastList) t.life -= dt;
  const before = toastList.length;
  toastList = toastList.filter((t) => t.life > 0);
  if (toastDirty || before !== toastList.length) {
    toastDirty = false;
    $("toasts").innerHTML = toastList.map((t) => `<div class="toast ${t.kind}">${t.text}</div>`).join("");
  }
}
// ---------- cosmetics: coins, the shop, emotes, victory dances and trails ----------
// Everything here is for looks only. Coins come from matches, quests and achievements; nothing is sold for money.
const EMOTES = [
  { id: "wave", icon: "👋", anim: "wave", len: 2.2, price: 0 },
  { id: "laugh", icon: "😂", anim: "laugh", len: 2.2, price: 0 },
  { id: "thumbs", icon: "👍", anim: "thumbs", len: 2, price: 0 },
  { id: "cheer", icon: "🎉", anim: "cheer", len: 2.4, price: 0, dance: true },
  { id: "angry", icon: "😤", anim: "angry", len: 2, price: 60 },
  { id: "cry", icon: "😭", anim: "cry", len: 2.4, price: 60 },
  { id: "bow", icon: "🙇", anim: "bow", len: 2.2, price: 90 },
  { id: "heart", icon: "💖", anim: "heart", len: 2.2, price: 90 },
  { id: "dance", icon: "💃", anim: "dance", len: 3, price: 180, dance: true },
  { id: "spin", icon: "🌀", anim: "spin", len: 2.2, price: 150, dance: true },
  { id: "robot", icon: "🤖", anim: "robot", len: 3, price: 220, dance: true },
  { id: "flex", icon: "💪", anim: "flex", len: 2.4, price: 160, dance: true },
  { id: "hop", icon: "🐰", anim: "hop", len: 2.6, price: 160, dance: true },
  // Season pass rewards: never sold, they come with the steps of the pass.
  { id: "clap", icon: "👏", anim: "clap", len: 2.2, price: 0, pass: 2 },
  { id: "kiss", icon: "😘", anim: "kiss", len: 2.2, price: 0, pass: 7 },
  { id: "chicken", icon: "🐔", anim: "chicken", len: 3, price: 0, dance: true, pass: 14 },
];
const TRAILS = [
  { id: "none", icon: "—", price: 0 },
  { id: "sparkle", icon: "✨", price: 120, kind: "star", color: "#fff2a8" },
  { id: "bubbles", icon: "○", price: 140, kind: "bubble" },
  { id: "confetti", icon: "🎊", price: 180, kind: "confetti" },
  { id: "clouds", icon: "☁", price: 180, kind: "puff", colors: ["#ffd6ec", "#d6ecff", "#e6ffd6", "#fff2c2"] },
  { id: "pixie", icon: "💗", price: 220, kind: "star", color: "#ff8fd0" },
  { id: "flame", icon: "🔥", price: 260, kind: "flame" },
  { id: "rainbow", icon: "🌈", price: 300, kind: "rainbow" },
  { id: "snow", icon: "❄", price: 0, kind: "puff", colors: ["#ffffff", "#e6f3ff", "#d4ecff"], pass: 4 },
  { id: "stardust", icon: "💫", price: 0, kind: "star", color: "#9fd8ff", pass: 10 },
  { id: "leaves", icon: "🍂", price: 0, kind: "puff", colors: ["#7bd94f", "#ffb13b", "#ff7a3d"], pass: 18 },
  { id: "gold", icon: "👑", price: 0, kind: "star", color: "#ffd23f", pass: 30 },
];
// ----- the free season pass: stars for every match and quest, a reward on each of 30 steps -----
const PASS_ITEMS = new Map([...EMOTES.filter((e) => e.pass).map((e) => ["emote:" + e.id, e.pass]), ...TRAILS.filter((t) => t.pass).map((t) => ["trail:" + t.id, t.pass])]);
const PASS_REWARDS = Array.from({ length: SEASON.steps }, (_, i) => {
  const step = i + 1,
    key = [...PASS_ITEMS].find(([, s]) => s === step)?.[0];
  return key ? { step, key } : { step, coins: 20 + Math.floor(step / 5) * 10 };
});
const passStep = () => Math.min(SEASON.steps, Math.floor((profile.season === SEASON.id ? profile.stars || 0 : 0) / SEASON.per));
const passCoins = () => PASS_REWARDS.reduce((s, r) => s + (r.coins && r.step <= passStep() ? r.coins : 0), 0);
const rewardName = (r) => (r.key ? itemName({ kind: r.key.startsWith("trail") ? "trail" : "emote", item: { id: r.key.split(":")[1] } }) : r.coins + " " + coinsWord(r.coins));
const rewardIcon = (r) => (r.key ? (r.key.startsWith("trail") ? TRAILS[trailIndex(r.key.slice(6))] : EMOTES[emoteIndex(r.key.slice(6))]).icon : "🪙");
function addStars(n) {
  if (!(n > 0)) return;
  if (profile.season !== SEASON.id) {
    profile.season = SEASON.id;
    profile.stars = 0;
  }
  const before = passStep();
  profile.stars = (profile.stars || 0) + n;
  if (stats) stats.stars = (stats.stars || 0) + n;
  for (let s = before + 1; s <= passStep(); s++) {
    const r = PASS_REWARDS[s - 1];
    toast(txt("toastPass", s, rewardName(r)), "gift");
    stats?.gifts.push({ name: rewardName(r) });
  }
}
// ----- the league: points for places and knockouts, from Bronze to Legend -----
const LEAGUES = [
  { id: "bronze", icon: "🥉", min: 0 },
  { id: "silver", icon: "🥈", min: 100 },
  { id: "gold", icon: "🥇", min: 250 },
  { id: "platinum", icon: "💠", min: 450 },
  { id: "diamond", icon: "💎", min: 700 },
  { id: "legend", icon: "👑", min: 1000 },
];
const leagueOf = (rp) => LEAGUES.reduce((best, l) => (rp >= l.min ? l : best), LEAGUES[0]);
function rpFor(place, teams, k) {
  const table = teams <= 5 ? [25, 12, 4, -4, -8] : [25, 15, 10, 5, 2, 0, -3, -5, -7, -9];
  return (table[Math.max(0, Math.min(table.length, place) - 1)] ?? -9) + Math.min(10, k * 2);
}
function addRp(d) {
  const before = leagueOf(profile.rp || 0);
  profile.rp = Math.max(0, (profile.rp || 0) + d);
  if (stats) stats.rp = d;
  const now = leagueOf(profile.rp);
  if (now.min > before.min) toast(txt("toastLeague", now.icon + " " + txt("league." + now.id)), "level");
}
const SHOP = [
  ...EMOTES.filter((e) => e.price && !e.dance).map((e) => ({ key: "emote:" + e.id, kind: "emote", item: e })),
  ...EMOTES.filter((e) => e.price && e.dance).map((e) => ({ key: "emote:" + e.id, kind: "dance", item: e })),
  ...TRAILS.filter((t) => t.price).map((t) => ({ key: "trail:" + t.id, kind: "trail", item: t })),
];
const emoteIndex = (id) => Math.max(0, EMOTES.findIndex((e) => e.id === id));
const trailIndex = (id) => Math.max(0, TRAILS.findIndex((t) => t.id === id));
const coinsWord = (n) => txt("coins", n);
// The balance is what was earned minus what was paid for the things owned (both survive a Steam Cloud merge).
function coins() {
  let spent = 0;
  for (const v of Object.values(profile.owned || {})) spent += +v || 0;
  return Math.max(0, (profile.coinsEarned || 0) + passCoins() - spent);
}
function ownsItem(key) {
  if (PASS_ITEMS.has(key)) return passStep() >= PASS_ITEMS.get(key);
  const entry = SHOP.find((x) => x.key === key);
  return !entry || profile.owned?.[key] !== undefined;
}
const ownedEmotes = () => EMOTES.map((e, i) => i).filter((i) => ownsItem("emote:" + EMOTES[i].id));
function earnCoins(n) {
  if (!(n > 0)) return;
  profile.coinsEarned = (profile.coinsEarned || 0) + n;
  if (stats) stats.coins = (stats.coins || 0) + n;
}
// Four things a day, one of them a quarter off; picked from the date like the quests.
function dailyShop() {
  const key = dayKey();
  let h = 911;
  for (const ch of key) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => (h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 4294967296,
    pool = SHOP.slice(),
    picked = [];
  while (picked.length < 4 && pool.length) picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return { key, items: picked, deal: picked[0]?.key };
}
function shopPrice(entry) {
  const base = entry.item.price;
  return dailyShop().deal === entry.key ? Math.round((base * 0.75) / 5) * 5 : base;
}
function buyItem(key) {
  const entry = SHOP.find((x) => x.key === key);
  if (!entry || ownsItem(key)) return false;
  const price = shopPrice(entry);
  if (coins() < price) {
    toast(txt("shop.noCoins"), "info");
    sound("lose", null, { vol: 0.4 });
    return false;
  }
  profile.owned = { ...(profile.owned || {}), [key]: price };
  if (entry.kind === "trail") profile.trail = entry.item.id;
  if (entry.kind === "dance") profile.dance = entry.item.id;
  saveProfile();
  sound("coin");
  toast(txt("shop.bought", itemName(entry)), "gift");
  return true;
}
const itemName = (entry) => (entry.kind === "trail" ? txt("trails")[entry.item.id] : txt("emotes")[entry.item.id]);
function equipItem(kind, id) {
  if (kind === "trail" && ownsItem("trail:" + id)) profile.trail = id;
  if (kind === "dance" && ownsItem("emote:" + id)) profile.dance = id;
  saveProfile();
}
// Emotes: the hero plays a short animation and a bubble pops up above its head (everyone online sees it).
let emoteCd = 0;
function playEmote(index) {
  const e = EMOTES[index];
  if (!e || mode !== "play" || paused || spectate || !player?.alive || player.down || emoteCd > 0) return false;
  if (!ownsItem("emote:" + e.id)) return false;
  emoteCd = 1.2;
  if (net.client) net.sendEmote?.(index);
  else setEmote(player, index);
  return true;
}
function setEmote(a, k) {
  if (!a || !EMOTES[k]) return;
  a.emote = { k, at: worldClock };
  emit({ e: "em", s: a.id, k });
  const V = listener();
  if (a === player || (V && dist(a, V) < 24)) sound("emote", a === player ? null : a, { vol: 0.55 });
}
// The emote wheel: T (or the gamepad's View button) opens it, a click, a number or the stick picks.
let wheelOpen = false,
  wheelPick = -1,
  wheelLocked = false;
function openWheel() {
  if (wheelOpen || mode !== "play" || paused || spectate || !player?.alive || player.down) return;
  wheelOpen = true;
  wheelPick = -1;
  wheelLocked = document.pointerLockElement === canvas;
  if (wheelLocked) unlockMouse();
  keys = {};
  mouse.down = false;
  renderWheel();
  $("emoteWheel").hidden = false;
}
function closeWheel(pick = -1) {
  if (!wheelOpen) return;
  wheelOpen = false;
  $("emoteWheel").hidden = true;
  if (pick >= 0) playEmote(pick);
  if (wheelLocked && mode === "play" && !paused) lockMouse();
}
function renderWheel() {
  const list = ownedEmotes(),
    n = list.length;
  $("emoteRing").innerHTML = list
    .map((k, j) => {
      const ang = (j / n) * Math.PI * 2 - Math.PI / 2,
        x = Math.cos(ang) * 118,
        y = Math.sin(ang) * 118;
      return `<button class="emoteBtn${wheelPick === k ? " pick" : ""}" data-emote="${k}" style="transform:translate(${x.toFixed(1)}px,${y.toFixed(1)}px)"><i>${EMOTES[k].icon}</i><small>${j < 10 ? (j + 1) % 10 : ""}</small><span>${esc(txt("emotes")[EMOTES[k].id])}</span></button>`;
    })
    .join("");
  for (const b of $("emoteRing").querySelectorAll("[data-emote]")) b.onclick = () => closeWheel(+b.dataset.emote);
}
// The shop: a showcase of the day, emotes, victory dances and trails. A click on a card shows it on the hero.
let shopTab = "daily";
function shopCards() {
  if (shopTab === "daily") return dailyShop().items;
  if (shopTab === "trail") return [{ key: "trail:none", kind: "trail", item: TRAILS[0] }, ...SHOP.filter((x) => x.kind === "trail")];
  if (shopTab === "dance") return EMOTES.filter((e) => e.dance).map((e) => SHOP.find((x) => x.key === "emote:" + e.id) || { key: "emote:" + e.id, kind: "dance", item: e });
  return EMOTES.filter((e) => !e.dance).map((e) => SHOP.find((x) => x.key === "emote:" + e.id) || { key: "emote:" + e.id, kind: "emote", item: e });
}
function renderShop() {
  $("shopCoins").textContent = coins();
  for (const b of $("shopTabs").querySelectorAll("[data-tab]")) b.classList.toggle("on", b.dataset.tab === shopTab);
  const daily = dailyShop(),
    now = new Date(),
    next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  $("shopNote").textContent =
    shopTab === "daily" ? txt("shop.dailyLeft", Math.max(1, Math.ceil((next - now) / 3600000))) : shopTab === "dance" ? txt("shop.danceNote") : shopTab === "trail" ? txt("shop.trailNote") : txt("shop.emoteNote");
  $("shopGrid").innerHTML = shopCards()
    .map((entry) => {
      const have = ownsItem(entry.key),
        id = entry.item.id,
        equipped = (entry.kind === "trail" && profile.trail === id) || (entry.kind === "dance" && profile.dance === id),
        price = shopPrice(entry),
        deal = daily.deal === entry.key && !have;
      let action;
      if (!have) action = `<button data-buy="${entry.key}">${deal ? `<s>${entry.item.price}</s>` : ""}${txt("shop.buy", price)}</button>`;
      else if (entry.kind === "emote") action = `<button class="ghost" disabled>${txt("shop.owned")}</button>`;
      else action = `<button class="ghost" data-equip="${entry.key}"${equipped ? " disabled" : ""}>${txt(equipped ? "shop.equipped" : "shop.equip")}</button>`;
      const label = txt(entry.kind === "trail" ? "shop.kindTrail" : entry.kind === "dance" ? "shop.kindDance" : "shop.kindEmote");
      return `<div class="shopCard${equipped ? " equipped" : ""}" data-preview="${entry.key}">${deal ? `<span class="deal">−25%</span>` : ""}<i>${entry.item.icon}</i><b>${esc(itemName(entry))}</b><small>${label}</small>${action}</div>`;
    })
    .join("");
  for (const b of $("shopGrid").querySelectorAll("[data-buy]"))
    b.onclick = (e) => {
      e.stopPropagation();
      if (buyItem(b.dataset.buy)) previewItem(b.dataset.buy);
      renderShop();
      menuUI();
    };
  for (const b of $("shopGrid").querySelectorAll("[data-equip]"))
    b.onclick = (e) => {
      e.stopPropagation();
      const [kind, id] = b.dataset.equip.split(":");
      equipItem(kind === "trail" ? "trail" : "dance", id);
      previewItem(b.dataset.equip);
      renderShop();
    };
  for (const c of $("shopGrid").querySelectorAll("[data-preview]")) c.onclick = () => previewItem(c.dataset.preview);
}
// The hero in the menu plays the emote or wears the trail for a moment.
function previewItem(key) {
  const a = menuHero?.actor;
  if (!a) return;
  const [kind, id] = key.split(":");
  if (kind === "emote") {
    a.emote = { k: emoteIndex(id), at: worldClock };
    sound("emote", null, { vol: 0.5 });
  } else {
    a.trail = trailIndex(id);
    a.trailShow = worldClock + 3;
  }
}
const mapScale = Math.min(3, Math.max(1, Math.ceil((typeof devicePixelRatio === "number" ? devicePixelRatio : 1) * 1.2)));
{
  const m = $("map");
  m.width = m.height = 180 * mapScale;
}
function saveProfile() {
  if (qaMode) return;
  profile.savedAt = Date.now();
  try {
    localStorage.setItem("mini-bitva-v2", JSON.stringify(profile));
  } catch {}
  try {
    window.native?.cloud?.save?.(JSON.stringify(cloudPart()));
  } catch {}
}
// Steam friends list: what this player is doing now (the texts live in the Steam app's rich presence files).
let presenceSent = "";
function updatePresence() {
  const send = window.native?.steam?.presence;
  if (!send) return;
  const lobby = typeof N !== "undefined" && N.role && N.code ? String(N.code) : "",
    people = lobby ? 1 + (N.members?.length || 0) : 0,
    p = { steam_display: "#Status_Menu", arena: null, alive: null, count: null, steam_player_group: lobby || null, steam_player_group_size: lobby ? String(people) : null };
  if (mode === "play" && actors.length) {
    p.steam_display = koth() ? "#Status_MatchKoth" : spectate ? "#Status_Watch" : duo() ? "#Status_MatchDuo" : "#Status_MatchSolo";
    p.arena = options.arena;
    // King of the hill shows the player's points in the same field.
    p.alive = String(koth() ? Math.floor(KOTH.score[player.team] / 10) * 10 : duo() ? teamsAlive() : actors.filter((a) => a.alive).length);
  } else if (lobby) {
    p.steam_display = "#Status_Lobby";
    p.count = String(people);
  }
  const key = JSON.stringify(p);
  if (key === presenceSent) return;
  presenceSent = key;
  try {
    send(p);
  } catch {}
}
function item(id, q = 0) {
  return { id, q, ammo: weapons[id].cap };
}
function setSlot(a, s) {
  if (a.slot !== s) {
    a.slot = s;
    a.reload = 0;
    a.burst = 0;
  }
}
function dropSpot(a) {
  for (const r of [1.1, 2.2, 3.6, 4.8])
    for (let i = 0; i < 10; i++) {
      const ang = (a.angle || 0) + Math.PI + i * 0.63,
        p = { x: clamp(a.x + Math.sin(ang) * r, -30, 30), z: clamp(a.z + Math.cos(ang) * r, -30, 30) };
      if (clearSpot(p, 0.35)) return p;
    }
  return { x: clamp(a.x, -30, 30), z: clamp(a.z, -30, 30) };
}
function clearSpot(p, margin = 1) {
  return Math.abs(p.x) < 30.5 && Math.abs(p.z) < 30.5 && !obstacles.some((o) => dist(p, o) < o.r + margin);
}
function safePoint(max = 27) {
  for (let i = 0; i < 160; i++) {
    let p = { x: rand(-max, max), z: rand(-max, max) };
    if (clearSpot(p)) return p;
  }
  return { x: 0, z: 12 };
}
function heroCatalog() {
  return window.MiniHeroes?.catalog || Array.from({ length: 10 }, (_, i) => ({ id: i, name: "Герой " + (i + 1), nameEn: "Hero " + (i + 1), color: botColors[i % botColors.length] }));
}
function heroColor(index) {
  return heroCatalog()[index]?.color || skinColors[0];
}
function makeActor(x, z, i) {
  const hero = ((profile.hero || 0) + i) % 10;
  return {
    x,
    z,
    home: { x, z },
    y: 0,
    vy: 0,
    id: i,
    team: teamOf(i),
    name: heroName(i),
    bot: i !== 0,
    nick: null,
    net: null,
    angle: Math.PI,
    hp: 100,
    armor: 0,
    alive: true,
    down: false,
    downBy: null,
    reviveId: -1,
    hero,
    color: heroColor(hero),
    slots: [item(0), item(1)],
    slot: 1,
    cd: 0,
    reload: 0,
    roll: 0,
    inv: 0,
    stun: 0,
    rollDir: null,
    meds: [2, 1, 0],
    consumable: 0,
    use: 0,
    useTotal: 0,
    useType: 0,
    grenades: 2,
    gadget: 0,
    gadgetCd: 0,
    step: 0,
    moving: false,
    think: 0,
    path: [],
    pathIndex: 0,
    goal: null,
    enemy: null,
    aimY: 0.85,
    noise: -100,
    animation: 0,
    burst: 0,
    burstTimer: 0,
    grapple: null,
    landed: false,
    brain: "loot",
    targetSeen: 0,
    react: 0,
    fireT: 0,
    restT: rand(0.2, 1),
    strafeDir: 1,
    strafeT: 0,
    dodgeCd: 0,
    jumpCd: 0,
    lastAttacker: null,
    alertT: -100,
    alertPos: null,
    roam: null,
    vx: 0,
    vz: 0,
    px: x,
    pz: z,
    stepT: 0,
    kills: 0,
    hat: i ? (Math.random() < 0.55 ? 1 + Math.floor(Math.random() * 6) : 0) : owned(HATS[profile.hat] || HATS[0]) ? profile.hat : 0,
    trail: i ? (Math.random() < 0.2 ? 1 + Math.floor(Math.random() * (TRAILS.length - 1)) : 0) : ownsItem("trail:" + profile.trail) ? trailIndex(profile.trail) : 0,
    emote: null,
    paint: i ? 0 : owned(PAINTS[profile.paint] || PAINTS[0]) ? profile.paint : 0,
  };
}
let lootUid = 0;
function addLoot(x, z, type, id = 0, q = 0) {
  const l = { x, z, type, id, q, spin: rand(0, 6.28), uid: ++lootUid };
  loot.push(l);
  emit({ e: "la", l: [l.uid, +x.toFixed(2), +z.toFixed(2), type, id, q] });
  return l;
}
function removeLoot(l) {
  const i = loot.indexOf(l);
  if (i >= 0) loot.splice(i, 1);
  emit({ e: "lr", u: l.uid });
}
function newGame(roster = null) {
  options.duration = +$("duration").value || 180;
  options.difficulty = $("difficulty").value || "normal";
  options.night = $("night").checked;
  options.mode = ["duo", "koth"].includes($("teamMode").value) ? $("teamMode").value : "solo";
  // The very first solo match is a guided one, against easy rivals who wait until the last lesson.
  // Players who already know the game (on this computer or from Steam Cloud) never get it.
  const guided = !profile.tutorialDone && !profile.games && !roster && !net.on && options.mode === "solo";
  if (guided) options.difficulty = "easy";
  resetWorld();
  tutorial = guided ? { step: 0, t: 0, x: 0, z: 0, yaw: 0, look: 0, p: 0, s: 0, r: 0, done: 0 } : null;
  player = makeActor(0, 12, 0);
  player.y = 9;
  actors.push(player);
  for (let i = 1; i < 10; i++) {
    let p;
    // In duos the second hero of a pair lands right next to the first one.
    if (duo() && i % 2) p = besideSpot(actors[i - 1]);
    else {
      p = safePoint();
      let n = 0;
      while ((dist(p, player) < 17 || actors.some((a) => dist(a, p) < 6)) && n++ < 180) p = safePoint();
    }
    let a = makeActor(p.x, p.z, i);
    a.slots[1] = item(1);
    a.y = rand(7, 10);
    actors.push(a);
  }
  if (roster) net.applyRoster(roster);
  let wi = 0;
  for (let i = 0; i < 56; i++) {
    let p = safePoint(),
      types = ["weapon", "armor", "weapon", "consumable", "weapon", "gadget", "consumable", "grenade"];
    let type = types[i % 8];
    addLoot(p.x, p.z, type, type === "weapon" ? (wi++ * 5) % weapons.length : type === "gadget" ? i % 4 : i % 3, i % 3);
  }
  addLoot(1.8, 9.8, "armor");
  addLoot(-1.8, 10, "weapon", 2, 2);
  addLoot(3, 12, "gadget", 1);
  addLoot(-3, 12, "consumable", 2);
  // The player's teammate gets its own armor and slingshot, so it does not take the player's.
  if (duo()) {
    const m = actors[1],
      p1 = besideSpot(m),
      p2 = besideSpot(m);
    addLoot(p1.x, p1.z, "armor");
    addLoot(p2.x, p2.z, "weapon", 1, 1);
  }
  enterMatch();
}
// A free spot two or three steps away from a hero.
function besideSpot(a) {
  for (let k = 0; k < 30; k++) {
    const ang = rand(0, 6.28),
      r = rand(2, 3.2),
      p = { x: clamp(a.x + Math.sin(ang) * r, -28, 28), z: clamp(a.z + Math.cos(ang) * r, -28, 28) };
    if (clearSpot(p, 0.8)) return p;
  }
  return safePoint();
}
// Clears the arena for a new match (online clients use it too, then receive heroes and loot from the host).
function resetWorld() {
  buildArena();
  actors = [];
  loot = [];
  bullets = [];
  particles = [];
  rings = [];
  balloons = [];
  grenades = [];
  clouds = [];
  traps = [];
  numbers = [];
  cat = null;
  feed = [];
  lootUid = 0;
  time = 0;
  zone = 44;
  kills = 0;
  shots = 0;
  hits = 0;
  pickups = 0;
  matchDrop = false;
  catDecided = false;
  KOTH = { hill: null, next: 0, score: [], holder: -1, contested: false, sync: 0, over: false };
  arenaEvent = null;
  nextEventT = 50;
  hazard = false;
  vacuum = null;
  popped = new Set();
  paused = false;
  keys = {};
  mouse.down = false;
  mouse.right = false;
  hurt = 0;
  hitFlash = 0;
  recoil = 0;
  trauma = 0;
  hitStop = 0;
  fovPunch = 0;
  koMarkT = 0;
  koBannerT = 0;
  if ($("koBanner")) $("koBanner").hidden = true;
  multiKO = 0;
  lastKoT = -99;
  spree = 0;
  hudTick = 0;
  hurtFrom = [];
  stats = newStats();
  spectate = null;
  toastList = [];
  toastDirty = true;
  document.body.classList.remove("spectating");
  $("spectate").hidden = true;
}
// Starts play with the camera behind the local hero.
function enterMatch() {
  resetMouseLook();
  pointerLockBlocked = false;
  mode = "play";
  cameraYaw = 0;
  cameraPitch = 0.1;
  cameraDist = 5.5;
  tactical = false;
  cam = [player.x, 12, player.z + 5];
  target = [player.x, 0, player.z - 3];
  camera.position.set(cam[0], cam[1], cam[2]);
  document.body.classList.add("playing");
  $("menu").hidden = true;
  $("result").hidden = true;
  $("pause").hidden = true;
  $("settings").hidden = true;
  $("hud").hidden = false;
  $("matchStats").hidden = false;
  $("pauseBtn").hidden = false;
  say(txt(tutorial ? "tut.hello" : "say.drop"), 6);
  sound("start");
  $("skipTutorial").hidden = !tutorial;
  if (tutorial) tutBegin(0);
  else tutUI();
  updateHud();
}
// Menu buttons click softly, and the big cards and buttons answer the pointer with a tiny tick.
let uiHoverT = 0;
document.addEventListener("pointerdown", (e) => {
  if (mode !== "play" && e.target?.closest?.("button:not([disabled]),select,.arenaCard")) sound("uiClick");
});
document.addEventListener("pointerover", (e) => {
  const now = performance.now();
  if (mode === "play" || now - uiHoverT < 70 || !e.target?.closest?.(".arenaCard,.primary,.secondary,.chip,.progressChip,.shopCard,.wardItem")) return;
  uiHoverT = now;
  sound("uiHover");
});
$("skipTutorial").onclick = () => {
  finishTutorial(false);
  $("skipTutorial").hidden = true;
  if (paused) pauseGame();
};
function say(text, seconds = 3) {
  $("notice").textContent = text;
  noticeTime = seconds;
}
// ---------- sound: small cartoon synth with direction and distance ----------
const SFX = {
  shot: [{ t: "triangle", f: 650, f2: 260, d: 0.07, g: 0.45 }],
  shot10: [
    { n: 1, d: 0.06, g: 0.22, ft: "bandpass", fq: 1800 },
    { t: "sine", f: 520, f2: 300, d: 0.05, g: 0.18 },
  ],
  shot1: [
    { t: "triangle", f: 900, f2: 320, d: 0.09, g: 0.4 },
    { n: 1, d: 0.03, g: 0.25, ft: "highpass", fq: 2500 },
  ],
  shot2: [
    { t: "square", f: 1250, f2: 520, d: 0.08, g: 0.2 },
    { t: "sine", f: 1800, f2: 900, d: 0.05, g: 0.15 },
  ],
  shot3: [
    { t: "sawtooth", f: 230, f2: 170, d: 0.2, g: 0.2 },
    { t: "triangle", f: 460, f2: 420, d: 0.14, g: 0.2 },
  ],
  shot4: [{ t: "sine", f: 300, f2: 720, d: 0.12, g: 0.35 }],
  shot9: [
    { t: "triangle", f: 170, f2: 80, d: 0.13, g: 0.45 },
    { n: 1, d: 0.06, g: 0.3, ft: "lowpass", fq: 900 },
  ],
  melee: [{ n: 1, d: 0.14, g: 0.9, ft: "bandpass", fq: 900, fq2: 2600, q: 1.2 }],
  hitConfirm: [
    { t: "sine", f: 1500, f2: 1000, d: 0.05, g: 0.32 },
    { t: "triangle", f: 2400, f2: 2400, d: 0.03, g: 0.12 },
  ],
  headshot: [
    { t: "sine", f: 1760, f2: 1760, d: 0.09, g: 0.3 },
    { t: "sine", f: 2640, f2: 2640, d: 0.12, g: 0.2, delay: 0.04 },
  ],
  armor: [
    { t: "triangle", f: 1900, f2: 1400, d: 0.07, g: 0.26 },
    { n: 1, d: 0.04, g: 0.18, ft: "highpass", fq: 4000 },
  ],
  elim: [
    { t: "sine", f: 520, f2: 1300, d: 0.1, g: 0.3 },
    { t: "sine", f: 780, f2: 780, d: 0.12, g: 0.22, delay: 0.08 },
    { t: "sine", f: 1040, f2: 1040, d: 0.16, g: 0.22, delay: 0.16 },
    { n: 1, d: 0.08, g: 0.2, ft: "highpass", fq: 3000 },
  ],
  pop: [
    { t: "sine", f: 420, f2: 1100, d: 0.08, g: 0.3 },
    { n: 1, d: 0.06, g: 0.22, ft: "highpass", fq: 2500 },
  ],
  hit: [
    { t: "sine", f: 170, f2: 70, d: 0.13, g: 0.5 },
    { n: 1, d: 0.06, g: 0.25, ft: "lowpass", fq: 700 },
  ],
  whiz: [{ n: 1, d: 0.16, g: 0.8, ft: "bandpass", fq: 3200, fq2: 1400, q: 3 }],
  boom: [
    { n: 1, d: 0.4, g: 0.6, ft: "lowpass", fq: 600, fq2: 150 },
    { t: "sine", f: 95, f2: 38, d: 0.35, g: 0.5 },
  ],
  step: [{ n: 1, d: 0.05, g: 0.55, ft: "lowpass", fq: 650 }],
  jump: [{ t: "sine", f: 300, f2: 620, d: 0.14, g: 0.32 }],
  roll: [{ n: 1, d: 0.2, g: 0.5, ft: "bandpass", fq: 600, fq2: 1600, q: 1 }],
  throw: [{ n: 1, d: 0.12, g: 0.45, ft: "bandpass", fq: 1200, fq2: 500, q: 1.5 }],
  pickup: [{ t: "sine", f: 920, f2: 1470, d: 0.12, g: 0.35 }],
  reload: [
    { t: "square", f: 400, f2: 260, d: 0.06, g: 0.12 },
    { t: "square", f: 600, f2: 600, d: 0.04, g: 0.1, delay: 0.1 },
  ],
  start: [
    { t: "sine", f: 560, f2: 560, d: 0.12, g: 0.2 },
    { t: "sine", f: 840, f2: 840, d: 0.2, g: 0.2, delay: 0.12 },
  ],
  win: [
    { t: "sine", f: 660, f2: 660, d: 0.14, g: 0.2 },
    { t: "sine", f: 880, f2: 880, d: 0.14, g: 0.2, delay: 0.14 },
    { t: "sine", f: 1320, f2: 1320, d: 0.35, g: 0.2, delay: 0.28 },
  ],
  lose: [
    { t: "triangle", f: 330, f2: 220, d: 0.3, g: 0.22 },
    { t: "triangle", f: 220, f2: 150, d: 0.45, g: 0.22, delay: 0.25 },
  ],
  cat: [
    { t: "sawtooth", f: 520, f2: 760, d: 0.18, g: 0.15 },
    { t: "sawtooth", f: 760, f2: 430, d: 0.35, g: 0.15, delay: 0.17 },
  ],
  hiss: [{ n: 1, d: 0.5, g: 0.3, ft: "highpass", fq: 3500 }],
  kettle: [{ t: "sine", f: 1850, f2: 2150, d: 1.1, g: 0.14, vib: 9 }],
  spray: [{ n: 1, d: 0.8, g: 0.2, ft: "bandpass", fq: 5000, q: 0.8 }],
  beep: [
    { t: "square", f: 1320, f2: 1320, d: 0.07, g: 0.12 },
    { t: "square", f: 1320, f2: 1320, d: 0.07, g: 0.12, delay: 0.15 },
    { t: "square", f: 1760, f2: 1760, d: 0.12, g: 0.12, delay: 0.3 },
  ],
  vacuum: [
    { t: "sawtooth", f: 80, f2: 190, d: 0.7, g: 0.1 },
    { n: 1, d: 0.8, g: 0.4, ft: "bandpass", fq: 500, fq2: 1500, q: 0.8 },
  ],
  hum: [
    { n: 1, d: 0.5, g: 0.28, ft: "bandpass", fq: 1100, q: 0.9 },
    { t: "sawtooth", f: 118, f2: 122, d: 0.5, g: 0.05 },
  ],
  suck: [
    { t: "sine", f: 900, f2: 180, d: 0.25, g: 0.25 },
    { n: 1, d: 0.2, g: 0.2, ft: "highpass", fq: 2500 },
  ],
  uiClick: [{ t: "sine", f: 760, f2: 520, d: 0.06, g: 0.16 }],
  uiHover: [{ t: "sine", f: 1250, f2: 1150, d: 0.03, g: 0.05 }],
  quest: [
    { t: "sine", f: 784, f2: 784, d: 0.1, g: 0.2 },
    { t: "sine", f: 988, f2: 988, d: 0.1, g: 0.2, delay: 0.09 },
    { t: "sine", f: 1319, f2: 1319, d: 0.22, g: 0.2, delay: 0.18 },
  ],
  bonk: [
    { t: "sine", f: 520, f2: 170, d: 0.14, g: 0.4 },
    { n: 1, d: 0.05, g: 0.2, ft: "lowpass", fq: 900 },
  ],
  gurgle: [
    { t: "sine", f: 170, f2: 420, d: 0.12, g: 0.26 },
    { t: "sine", f: 230, f2: 560, d: 0.1, g: 0.22, delay: 0.15 },
    { t: "sine", f: 150, f2: 380, d: 0.14, g: 0.26, delay: 0.32 },
    { t: "sine", f: 260, f2: 640, d: 0.09, g: 0.2, delay: 0.5 },
    { n: 1, d: 0.7, g: 0.12, ft: "lowpass", fq: 480 },
  ],
  whirl: [
    { n: 1, d: 1.5, g: 0.34, ft: "bandpass", fq: 380, fq2: 1300, q: 0.7 },
    { t: "sine", f: 95, f2: 55, d: 1.3, g: 0.16, vib: 5 },
  ],
  bubble: [
    { t: "sine", f: 700, f2: 1700, d: 0.07, g: 0.3 },
    { n: 1, d: 0.05, g: 0.18, ft: "highpass", fq: 3200 },
  ],
  streak: [
    { t: "sine", f: 660, f2: 660, d: 0.08, g: 0.24 },
    { t: "sine", f: 990, f2: 990, d: 0.08, g: 0.24, delay: 0.07 },
    { t: "sine", f: 1320, f2: 1320, d: 0.1, g: 0.24, delay: 0.14 },
    { t: "triangle", f: 1760, f2: 2640, d: 0.22, g: 0.2, delay: 0.21 },
    { n: 1, d: 0.1, g: 0.18, ft: "highpass", fq: 3000 },
  ],
  emote: [
    { t: "sine", f: 880, f2: 1320, d: 0.09, g: 0.22 },
    { t: "sine", f: 1320, f2: 1760, d: 0.12, g: 0.18, delay: 0.08 },
  ],
  coin: [
    { t: "square", f: 1320, f2: 1320, d: 0.05, g: 0.1 },
    { t: "square", f: 1980, f2: 1980, d: 0.12, g: 0.1, delay: 0.05 },
  ],
};
const SND_GAP = { step: 0.07, whiz: 0.05, shot: 0.025, hitConfirm: 0.03, armor: 0.03, melee: 0.04, pop: 0.05, roll: 0.05, jump: 0.05, suck: 0.08, bonk: 0.05, bubble: 0.05 };
// Direction of a world point relative to the camera: right/front components and distance.
function relDir(x, z) {
  const L = player ? listener() : null,
    px = L ? L.x : 0,
    pz = L ? L.z : 0,
    dx = x - px,
    dz = z - pz,
    d = Math.hypot(dx, dz) || 1e-6,
    c = Math.cos(cameraYaw),
    sn = Math.sin(cameraYaw);
  return { d, right: (dx * c - dz * sn) / d, front: (-dx * sn - dz * c) / d };
}
function spatial(src, opt = {}) {
  if (!src) return { gain: 1, pan: 0, muffle: false };
  const r = relDir(src.x, src.z),
    g = Math.pow(Math.max(0, 1 - r.d / 48), 1.6);
  return { gain: Math.max(opt.min || 0, g), pan: clamp(r.right, -1, 1) * Math.min(1, r.d / 3) * 0.85, muffle: r.front < -0.3 && r.d > 2 };
}
// src: an actor or a point makes the sound spatial; null means the local hero's own sound.
// The host shares spatial sounds with the other players (except: actors whose players must not get it, true: nobody).
function sound(kind, src = null, opt = {}, except) {
  if (net.replaying) return;
  if (net.host && src && except !== true)
    emit({ e: "snd", k: kind, s: src.bot !== undefined ? src.id : [+src.x.toFixed(2), +src.z.toFixed(2)], o: opt }, except);
  if (profile.volume <= 0) return;
  try {
    playSfx(kind, src, opt);
  } catch {}
}
// One audio graph for everything: effects and music meet in a compressor, so loud moments never clip.
let musicBus = null,
  musicFilter = null;
function ensureAudio() {
  if (audio) return audio;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audio = new Ctx();
  master = audio.createGain();
  const comp = audio.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(audio.destination);
  musicFilter = audio.createBiquadFilter();
  musicFilter.type = "lowpass";
  musicFilter.frequency.value = 18000;
  musicBus = audio.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(musicFilter);
  musicFilter.connect(comp);
  return audio;
}
function noiseBuffer() {
  if (!noiseBuf) {
    noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function playSfx(kind, src, opt) {
  if (!ensureAudio()) return;
  if (audio.state === "suspended" && audio.resume) audio.resume();
  master.gain.value = profile.volume * 0.4;
  const sp = spatial(src, opt),
    vol = sp.gain * (opt.vol ?? 1) * (sp.muffle ? 0.8 : 1);
  if (vol < 0.02 || voices > 30) return;
  const now = audio.currentTime,
    key = kind + (src ? "@" : ""),
    gap = SND_GAP[kind] || 0;
  if (gap && sndLast[key] !== undefined && now - sndLast[key] < gap) return;
  sndLast[key] = now;
  const layers = SFX[kind === "shot" && SFX["shot" + opt.wid] ? "shot" + opt.wid : kind] || SFX.shot;
  let dest = master;
  if (sp.muffle) {
    const f = audio.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 650;
    f.connect(dest);
    dest = f;
  }
  if (sp.pan && audio.createStereoPanner) {
    const pn = audio.createStereoPanner();
    pn.pan.value = sp.pan;
    pn.connect(dest);
    dest = pn;
  }
  const out = audio.createGain();
  out.gain.value = vol;
  out.connect(dest);
  let end = now;
  const pm = opt.pitch || 1;
  for (const L of layers) {
    const t0 = now + (L.delay || 0),
      t1 = t0 + L.d,
      g = audio.createGain();
    end = Math.max(end, t1);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(L.g, t0 + Math.min(0.008, L.d * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    g.connect(out);
    let node;
    if (L.n) {
      node = audio.createBufferSource();
      node.buffer = noiseBuffer();
      const f = audio.createBiquadFilter();
      f.type = L.ft || "bandpass";
      f.frequency.setValueAtTime(L.fq * pm, t0);
      if (L.fq2) f.frequency.exponentialRampToValueAtTime(L.fq2 * pm, t1);
      f.Q.value = L.q || 0.7;
      node.connect(f);
      f.connect(g);
    } else {
      node = audio.createOscillator();
      node.type = L.t;
      node.frequency.setValueAtTime(L.f * pm, t0);
      node.frequency.exponentialRampToValueAtTime(Math.max(20, (L.f2 || L.f) * pm), t1);
      if (L.vib) {
        const lfo = audio.createOscillator(),
          lg = audio.createGain();
        lfo.frequency.value = L.vib;
        lg.gain.value = L.f * 0.02;
        lfo.connect(lg);
        lg.connect(node.frequency);
        lfo.start(t0);
        lfo.stop(t1);
      }
      node.connect(g);
    }
    node.start(t0);
    node.stop(t1 + 0.02);
  }
  voices++;
  setTimeout(
    () => {
      voices = Math.max(0, voices - 1);
    },
    (end - now) * 1000 + 60,
  );
}
// ---------- music: a small cartoon band that plays faster as the zone closes ----------
// Menu: calm glockenspiel; loot phase: bouncy marimba; shrinking zone: drums join in; finale: fast and a tone higher.
const MUS = { next: 0, step: 0, tempo: 96, level: -1, vol: -1, duck: false };
const midiF = (m) => 440 * Math.pow(2, (m - 69) / 12);
const CHORDS = [
    [60, 64, 67],
    [57, 60, 64],
    [57, 60, 65],
    [55, 59, 62],
  ],
  ROOTS = [48, 45, 41, 43],
  MELODY = [
    [
      [[0, 79, 2], [3, 76, 1], [4, 79, 2], [6, 84, 4], [12, 83, 2], [14, 79, 2]],
      [[0, 81, 2], [2, 84, 2], [4, 88, 3], [8, 86, 2], [10, 84, 2], [12, 81, 4]],
      [[0, 77, 2], [2, 81, 2], [4, 84, 2], [6, 81, 2], [8, 77, 2], [10, 79, 2], [12, 81, 4]],
      [[0, 79, 2], [2, 83, 2], [4, 86, 4], [8, 83, 2], [10, 81, 2], [12, 79, 2], [14, 74, 2]],
    ],
    [
      [[0, 84, 3], [3, 83, 1], [4, 79, 2], [6, 76, 2], [8, 79, 4], [14, 76, 2]],
      [[0, 76, 2], [2, 81, 2], [4, 84, 2], [6, 83, 2], [8, 81, 4], [12, 76, 2], [14, 79, 2]],
      [[0, 81, 3], [3, 79, 1], [4, 77, 2], [6, 81, 2], [8, 84, 4], [12, 86, 2], [14, 84, 2]],
      [[0, 83, 2], [2, 86, 2], [4, 91, 4], [8, 89, 2], [10, 86, 2], [12, 83, 4]],
    ],
  ];
function mVoice(t, f, d, type, g, attack = 0.005) {
  const o = audio.createOscillator(),
    v = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  v.gain.setValueAtTime(0.0001, t);
  v.gain.linearRampToValueAtTime(g, t + attack);
  v.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(d, attack + 0.02));
  o.connect(v);
  v.connect(musicBus);
  o.start(t);
  o.stop(t + d + 0.05);
}
function mNoise(t, d, g, type, freq, q = 0.8) {
  const src = audio.createBufferSource(),
    f = audio.createBiquadFilter(),
    v = audio.createGain();
  src.buffer = noiseBuffer();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  v.gain.setValueAtTime(g, t);
  v.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(f);
  f.connect(v);
  v.connect(musicBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + d + 0.03);
}
function mKick(t, g) {
  const o = audio.createOscillator(),
    v = audio.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
  v.gain.setValueAtTime(g, t);
  v.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  o.connect(v);
  v.connect(musicBus);
  o.start(t);
  o.stop(t + 0.3);
}
function musicStep(step, t, lv) {
  const bar = Math.floor(step / 16) % 4,
    s = step % 16,
    part = Math.floor(step / 64) % 2,
    tr = lv >= 3 ? 2 : 0,
    root = ROOTS[bar] + tr,
    chord = CHORDS[bar].map((n) => n + tr),
    beat = 60 / MUS.tempo / 4;
  // Bass: from gentle half notes to a driving octave bounce.
  const bass = [
    { 0: 0, 8: 7 },
    { 0: 0, 6: 12, 8: 0, 14: 7 },
    { 0: 0, 3: 0, 6: 12, 8: 0, 11: 7, 14: 12 },
    { 0: 0, 2: 12, 4: 0, 6: 12, 8: 0, 10: 12, 12: 7, 14: 12 },
  ][lv];
  if (bass[s] !== undefined) {
    const f = midiF(root + bass[s]),
      d = beat * (lv === 0 ? 7 : lv === 3 ? 1.8 : 2.6);
    mVoice(t, f, d, "triangle", lv === 0 ? 0.38 : 0.5);
    mVoice(t, f * 2, d * 0.8, "sine", 0.14);
  }
  // Chords: a soft pad in the menu, offbeat stabs in a match.
  if (lv === 0 && s === 0)
    for (const m of chord) {
      mVoice(t, midiF(m), beat * 15, "sine", 0.07, 0.3);
      mVoice(t, midiF(m) * 1.004, beat * 15, "triangle", 0.03, 0.4);
    }
  if (lv >= 1 && (lv === 1 ? s === 4 || s === 12 : s % 4 === 2)) for (const m of chord) mVoice(t, midiF(m + 12), 0.14, "triangle", lv === 3 ? 0.075 : 0.06);
  // Melody: glockenspiel in the menu, marimba in a match.
  for (const [at, m, len] of MELODY[part][bar])
    if (at === s) {
      const f = midiF(m + tr);
      if (lv === 0) {
        mVoice(t, f, 0.8, "sine", 0.2);
        mVoice(t, f * 2.76, 0.35, "sine", 0.05);
      } else {
        mVoice(t, f, Math.max(0.28, beat * len), "sine", 0.26);
        mVoice(t, f * 4, 0.08, "sine", 0.07);
      }
    }
  // Finale: a quick arpeggio under the tune.
  if (lv === 3 && s % 2 === 1) mVoice(t, midiF(chord[(s >> 1) % 3] + 12), 0.1, "triangle", 0.045);
  // Drums.
  if (lv === 0) {
    if (s % 4 === 0) mNoise(t, 0.03, 0.035, "highpass", 8000);
    return;
  }
  const kick = lv === 1 ? s === 0 || s === 8 : lv === 2 ? s === 0 || s === 8 || s === 10 : s % 4 === 0;
  if (kick) mKick(t, 0.42);
  if (lv >= 2 && (s === 4 || s === 12 || (lv === 3 && bar === 3 && s >= 13))) {
    mNoise(t, 0.16, 0.22, "bandpass", 1900, 0.7);
    mVoice(t, 200, 0.09, "triangle", 0.14);
  }
  if (lv === 3 ? true : s % 2 === 0) mNoise(t, s % 4 === 2 && lv >= 2 ? 0.1 : 0.035, lv === 1 ? 0.05 : 0.07, "highpass", 7200);
}
function musicTarget() {
  if (mode === "menu") return { level: 0, tempo: 96 };
  if (mode === "end" || !player) return { level: -1, tempo: MUS.tempo };
  const alive = actors.filter((a) => a.alive).length;
  if (time > options.duration || zone < 13 || alive <= 3) return { level: 3, tempo: 132 };
  if (time > options.duration * 0.14) return { level: 2, tempo: 116 };
  return { level: 1, tempo: 106 };
}
// Schedules notes a little ahead of the audio clock; level and tempo change on bar lines.
function musicFill(until, target = musicTarget()) {
  while (MUS.next < until) {
    if (MUS.step % 16 === 0) {
      MUS.level = target.level;
      MUS.tempo = target.tempo;
    }
    if (MUS.level >= 0) musicStep(MUS.step, MUS.next, MUS.level);
    MUS.next += 60 / MUS.tempo / 4;
    MUS.step = (MUS.step + 1) % 128;
  }
}
function musicTick() {
  if (!audio || !musicBus || audio.state !== "running") return;
  const target = musicTarget(),
    now = audio.currentTime,
    vol = target.level < 0 ? 0 : profile.music * 0.065 * (spectate ? 0.8 : 1),
    duck = paused && mode === "play";
  if (vol !== MUS.vol || duck !== MUS.duck) {
    MUS.vol = vol;
    MUS.duck = duck;
    musicBus.gain.setTargetAtTime(vol * (duck ? 0.45 : 1), now, target.level < 0 ? 0.5 : 0.25);
    musicFilter.frequency.setTargetAtTime(duck ? 700 : 18000, now, 0.12);
  }
  if (target.level < 0 || profile.music <= 0) {
    MUS.level = -1;
    MUS.step = 0;
    MUS.next = now;
    return;
  }
  if (MUS.next < now - 0.1 || MUS.next > now + 1) MUS.next = now + 0.05;
  if (MUS.level < 0 && target.level >= 0) MUS.step = 0;
  musicFill(now + 0.25, target);
}
// Browsers start audio only after a click or a key press.
function wakeAudio() {
  if ((!audio || audio.state === "suspended") && ensureAudio() && audio.state === "suspended") audio.resume?.();
}
window.addEventListener("pointerdown", wakeAudio);
window.addEventListener("keydown", wakeAudio);
function burst(x, z, color, n = 15, y = 1, kind = "confetti", local = false) {
  if (net.replaying) return;
  if (net.host && !local && kind !== "spark") emit({ e: "b", x: +x.toFixed(2), z: +z.toFixed(2), c: color, n, y: +y.toFixed(2), k: kind });
  for (let i = 0; i < n && particles.length < 500; i++) {
    const life = rand(0.4, 1.1);
    particles.push({ x, z, y, vx: rand(-4, 4), vy: rand(2, 6), vz: rand(-4, 4), life, max: life, color, size: rand(0.07, 0.16), kind });
  }
}
// Kill feed entries keep who and how, so the names follow the current language.
function logFeed(source, cause, victim) {
  feed.unshift({ source, cause, victim, t: time });
  feed = feed.slice(0, 4);
  emit({ e: "f", s: source ? source.id : -1, c: cause, v: victim.id });
}
function addRing(r, except) {
  rings.push(r);
  emit({ e: "r", r }, except);
}
function addBalloon(b) {
  balloons.push(b);
  emit({ e: "bl", b });
}
// A message and sound for everyone in the match (the cat waking up, the supply drop).
function announce(key, seconds, snd) {
  say(txt(key), seconds);
  if (snd) sound(snd);
  emit({ e: "say", k: key, s: seconds, snd });
}
// ---------- online play hooks: net.js fills `net` in for online matches; single player never sends anything ----------
const net = { on: false, host: false, client: false, replaying: false, send: null, fx: null };
const isHuman = (a) => !!a && !a.bot;
const actorById = (id) => actors.find((a) => a.id === id) || null;
// World event for the other players' screens (only the host of an online match sends them).
function emit(ev, except) {
  if (net.host) net.send(ev, except);
}
// Feedback for whoever controls actor a: applied here for the local hero, sent over the network for a remote one.
function hfx(a, ev) {
  if (a === player) applyFx(ev);
  else if (a?.net && net.host) net.fx(a, ev);
}
function tell(a, key, args = [], seconds = 3) {
  if (isHuman(a)) hfx(a, { e: "say", k: key, a: args, s: seconds });
}
// Message arguments travel as small descriptions and are named in the receiver's language.
function argName(x) {
  if (!x || typeof x !== "object") return x;
  if (x.c !== undefined) return consumables[x.c].name;
  if (x.g !== undefined) return gadgetNames[x.g];
  if (x.l) return lootName(x.l);
  if (x.v !== undefined) return actorById(x.v)?.name || "—";
  return "";
}
// ---------- combat feel ----------
function shakeCam(amount) {
  trauma = Math.min(1, trauma + amount);
}
function freeze(seconds) {
  hitStop = Math.min(0.12, Math.max(hitStop, seconds));
}
// A grenade or other blast near the local hero shakes the camera, more when it is close.
function blastShake(x, z, power = 0.55) {
  const V = player && (player.alive ? player : spectate?.target);
  if (!V) return;
  const d = Math.hypot(V.x - x, V.z - z);
  if (d < 12) shakeCam(power * (1 - d / 12));
}
// The big sticker in the middle of the screen: a knockout, a multi-knockout or a streak.
function koBanner(main, sub = "", kind = "") {
  const el = $("koBanner");
  if (!el) return;
  el.firstElementChild.textContent = main;
  el.lastElementChild.textContent = sub;
  el.className = "koBanner " + kind;
  void el.offsetWidth;
  el.classList.add("show");
  el.hidden = false;
  koBannerT = 1.7;
}
function applyFx(ev) {
  if (ev.e === "say") say(txt(ev.k, ...(ev.a || []).map(argName)), ev.s ?? 3);
  else if (ev.e === "dealt") {
    if (stats && !ev.self) {
      stats.dmg += ev.n;
      stats.byWeapon[ev.k] = (stats.byWeapon[ev.k] || 0) + ev.n;
      questEvent("dmg", ev.n);
      if (ev.head) {
        stats.head++;
        questEvent("head");
        if (stats.head >= 3) unlock("sniper");
      }
    }
    if (ev.shot) hits++;
    hitFlash = 0.13;
    recoil += 0.03;
    if (!ev.self) {
      if (!ev.shot) {
        freeze(0.055);
        shakeCam(0.16);
      } else if (ev.head) {
        freeze(0.03);
        shakeCam(0.07);
      } else shakeCam(0.035);
    }
    numbers.push({ x: ev.x, z: ev.z, y: ev.y, text: ev.amt, life: 0.8, head: !!ev.head });
    if (!ev.self) sound(ev.head ? "headshot" : ev.arm ? "armor" : "hitConfirm");
  } else if (ev.e === "taken") {
    if (stats) {
      stats.taken += ev.n;
      if (ev.cause === "cat") unlock("cat");
      if (ev.cause === "vacuum") unlock("vacuum");
      if (ev.cause === "steam" && options.arena === "bathroom") unlock("drain");
    }
    const origin = ev.ox !== undefined ? { x: ev.ox, z: ev.oz } : null;
    if (!ev.env && origin) {
      const ex = ev.src >= 0 ? hurtFrom.find((h) => h.src === ev.src) : null;
      if (ex) {
        ex.x = origin.x;
        ex.z = origin.z;
        ex.life = ex.max;
        ex.s = Math.min(1, ex.s + 0.25);
      } else {
        hurtFrom.push({ x: origin.x, z: origin.z, src: ev.src, life: 1.3, max: 1.3, s: Math.min(1, 0.5 + ev.amt / 35) });
        if (hurtFrom.length > 6) hurtFrom.shift();
      }
    }
    hurt = Math.min(1, hurt + 0.3);
    if (!ev.env) {
      sound("hit", origin);
      shakeCam(Math.min(0.5, 0.08 + (ev.amt || 0) / 60));
      if ((ev.amt || 0) >= 20) freeze(0.04);
    }
  } else if (ev.e === "ko") {
    kills++;
    spree++;
    multiKO = time - lastKoT <= 4 ? multiKO + 1 : 1;
    lastKoT = time;
    freeze(0.09);
    shakeCam(0.24);
    fovPunch += 4;
    koMarkT = 0.35;
    const victim = argName({ v: ev.v }),
      streak = spree === 3 || spree === 5 || spree === 8 ? txt("ko.spree" + spree) : "";
    if (multiKO >= 2) koBanner(txt("ko.multi" + Math.min(multiKO, 5)), streak || txt("ko.out", victim), "multi");
    else koBanner(txt("ko.out", victim), streak, streak ? "spree" : "");
    sound(multiKO >= 2 || streak ? "streak" : "elim");
    questEvent("kill");
    unlock("first");
    if (kills >= 3) unlock("hat3");
    if (kills >= 5) unlock("five");
    if (kills >= 8) unlock("eight");
    if (ev.cause === "shot" && ev.d >= LONG_SHOT) unlock("longshot");
    if (stats) {
      stats.koT = stats.koT.filter((t) => time - t <= 3);
      stats.koT.push(time);
      if (stats.koT.length >= 2) unlock("double");
    }
    if (ev.cause === "grenade") {
      questEvent("grenadeKill");
      unlock("grenade");
    }
    if (ev.cause === "melee") questEvent("meleeKill");
  } else if (ev.e === "down") {
    player.alive = false;
    spree = 0;
    shakeCam(0.4);
    playerDown(actorById(ev.src), ev.cause, ev.wid, ev.place);
  } else if (ev.e === "teamOut") teamOut(ev.place);
  else if (ev.e === "downed") {
    say(txt("say.downed"), 4);
    sound("lose", null, { vol: 0.7 });
    hurt = 1;
    hurtFrom = [];
    keys = {};
    mouse.down = false;
  } else if (ev.e === "mateDowned") {
    say(txt("say.mateDowned", argName({ v: ev.v })), 4);
    sound("hit", null, { vol: 0.8 });
  } else if (ev.e === "revived") {
    say(txt("say.revived", argName({ v: ev.by })), 3);
    sound("quest");
  } else if (ev.e === "reviveDone") {
    say(txt("say.reviveDone", argName({ v: ev.v })), 3);
    sound("quest");
    if (stats) stats.revives++;
    unlock("medic");
  }
  else if (ev.e === "mateDown") {
    say(txt("say.mateDown", argName({ v: ev.v })), 3);
    sound("lose", null, { vol: 0.6 });
  } else if (ev.e === "win") koth() ? kothFinish(1) : finish(true);
  else if (ev.e === "kothEnd") kothFinish(ev.place);
  else if (ev.e === "wait") kothWait(actorById(ev.src), ev.cause, ev.wid, ev.t);
  else if (ev.e === "respawn") kothBack(ev);
  else if (ev.e === "pop") {
    profile.bubbles = (profile.bubbles || 0) + 1;
    if (profile.bubbles >= 10) unlock("bubbles");
    else saveProfile();
  }
  else if (ev.e === "pickup") {
    if (ev.l.type === "weapon" && ev.l.q >= 2) {
      questEvent("rare");
      if (ev.l.q === 3) unlock("legend");
    }
    pickups++;
    say(txt("say.picked", lootName(ev.l)), 2);
    sound("pickup");
  } else if (ev.e === "gadget") {
    if (stats) {
      stats.gadgets++;
      questEvent("gadget");
    }
    say(gadgetNames[ev.g] + "!", 1.5);
  } else if (ev.e === "healed") {
    const s = consumables[ev.t];
    if (stats && ev.gained > 0) {
      stats.heal += ev.gained;
      questEvent("heal", ev.gained);
    }
    say(txt("say.healed", s.name, s.hp, s.armor), 2);
    sound("pickup");
  }
}
function feedText(f) {
  const who = f.source?.name || (f.cause === "cat" ? txt("cat") : f.cause === "steam" || f.cause === "vacuum" ? arenaInfo().hazardName : txt("zoneName"));
  const tag = (a, name) => (duo() && sameTeam(a, player) ? `<em class="ally">${esc(name)}</em>` : esc(name));
  return tag(f.source, who) + (f.cause === "down" ? " ↓ " : " → ") + tag(f.victim, f.victim.name);
}
// Player names can come from Steam, so anything shown through innerHTML is escaped.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function damage(a, amount, source, cause = "shot", head = false, from = null, wid = null) {
  const env = cause === "zone" || cause === "steam";
  if (!a.alive || amount <= 0 || (a.inv > 0 && !env)) return false;
  // Teammates cannot hurt each other (your own popper still can).
  if (!env && ally(a, source)) return false;
  const origin = from || (source && source !== a ? source : null);
  if (a.use > 0 && !env) {
    a.use = 0;
    tell(a, "say.healCut", [], 1);
  }
  const absorbed = Math.min(a.armor, amount),
    hpBefore = a.hp;
  a.armor -= absorbed;
  a.hp = Math.max(0, a.hp - (amount - absorbed));
  const dealt = absorbed + hpBefore - a.hp;
  if (isHuman(source) && cause !== "zone")
    hfx(source, {
      e: "dealt",
      self: a === source ? 1 : 0,
      n: dealt,
      k: wid ?? cause,
      head: head ? 1 : 0,
      shot: cause === "shot" ? 1 : 0,
      arm: absorbed > 0 ? 1 : 0,
      amt: Math.round(amount),
      x: +a.x.toFixed(2),
      y: +(a.y + 2.1).toFixed(2),
      z: +a.z.toFixed(2),
    });
  if (source && source !== a && !env && origin) {
    a.lastAttacker = source;
    a.alertT = time;
    a.alertPos = { x: origin.x, z: origin.z };
    if (a.bot) a.think = Math.min(a.think, 0.08);
    // A bot whose teammate comes under fire thinks again soon, to come and help.
    const m = duo() ? mateOf(a) : null;
    if (m?.bot && m.alive) m.think = Math.min(m.think, 0.2);
  }
  if (isHuman(a))
    hfx(a, {
      e: "taken",
      n: dealt,
      cause,
      env: env ? 1 : 0,
      src: source ? source.id : -1,
      amt: amount,
      ox: origin ? +origin.x.toFixed(2) : undefined,
      oz: origin ? +origin.z.toFixed(2) : undefined,
    });
  if (!env) burst(a.x, a.z, absorbed ? "#7fe0ff" : "#fff1a8", 5, a.y + 1.1, "hit");
  a.lastHit = time;
  if (a.hp <= 0) {
    if (canGoDown(a)) goDown(a, source);
    // A downed hero finished off by the zone or a hazard counts for whoever downed it.
    else knockOut(a, a.down && (!source || source === a) ? a.downBy : source, cause, wid);
  }
  return true;
}
// Duos: only a hero whose teammate still stands can be downed instead of knocked out.
function canGoDown(a) {
  if (!duo() || a.down) return false;
  const m = mateOf(a);
  return !!m && m.alive && !m.down;
}
function goDown(a, source) {
  a.down = true;
  a.hp = DOWN_HP;
  a.armor = 0;
  a.downBy = source && source !== a ? source : null;
  a.use = 0;
  a.burst = 0;
  a.reload = 0;
  a.grapple = null;
  a.roll = 0;
  a.rollDir = null;
  a.inv = 0.3;
  a.path = [];
  a.think = 0;
  burst(a.x, a.z, a.color, 14, a.y + 0.8);
  sound("hit", a === player ? null : a, {}, [a]);
  logFeed(a.downBy, "down", a);
  if (isHuman(a)) hfx(a, { e: "downed", src: a.downBy ? a.downBy.id : -1 });
  const m = mateOf(a);
  if (isHuman(m)) hfx(m, { e: "mateDowned", v: a.id });
  else if (m?.alive) m.think = Math.min(m.think, 0.1);
}
function knockOut(a, source, cause = "shot", wid = null) {
  if (!a.alive) return;
  a.down = false;
  a.alive = false;
  a.burst = 0;
  a.grapple = null;
  burst(a.x, a.z, a.color, 35, a.y + 1);
  addBalloon({ x: a.x, z: a.z, y: a.y + 1, color: a.color });
  if (source && source !== a) source.kills = (source.kills || 0) + 1;
  if (isHuman(source) && source !== a) hfx(source, { e: "ko", v: a.id, cause, d: Math.round(Math.hypot(a.x - source.x, a.z - source.z)) });
  else if (source?.bot && source.alive && Math.random() < 0.3) setEmote(source, [0, 1, 2, 3, 4, 8, 9][Math.floor(Math.random() * 7)]);
  // The knocked-out hero and the one who scored hear their own sounds instead of the pop.
  if (source !== player && a !== player) sound("pop", a, {}, [source, a]);
  else emit({ e: "snd", k: "pop", s: a.id, o: {} }, [source, a]);
  if (spectate && a === spectate.target) {
    spectate.target = source && source !== player && source.alive ? source : nearestAlive(a);
    spectate.focusT = 0;
  }
  logFeed(source && source !== a ? source : null, cause, a);
  const spot = a.y < 0.3 && clearSpot(a, 0.35) ? { x: a.x, z: a.z } : dropSpot(a);
  addLoot(spot.x, spot.z, "weapon", a.slots[a.slot].id, a.slots[a.slot].q);
  if (koth()) {
    a.respawnT = KOTH_RESPAWN;
    // A knockout is worth a few points too, so fights around the hill matter.
    if (source && source !== a && !KOTH.over) KOTH.score[source.team] = Math.min(KOTH_WIN, (KOTH.score[source.team] || 0) + KOTH_KO);
    if (isHuman(a)) hfx(a, { e: "wait", src: source && source !== a ? source.id : -1, cause, wid, t: KOTH_RESPAWN });
    return;
  }
  // A team's place is decided when its last hero is out (in solo every hero is a team of one).
  const left = actors.filter((x) => x.alive),
    teams = new Set(left.map((x) => x.team)).size,
    out = !left.some((x) => x.team === a.team);
  if (isHuman(a)) hfx(a, { e: "down", src: source && source !== a ? source.id : -1, cause, wid, place: out ? teams + 1 : 0 });
  for (const m of actors)
    if (m !== a && m.team === a.team && isHuman(m)) hfx(m, out ? { e: "teamOut", place: teams + 1 } : { e: "mateDown", v: a.id });
  if (teams === 1) for (const m of actors) if (m.team === left[0].team && isHuman(m)) hfx(m, { e: "win" });
  if (teams <= 1) net.matchOver?.(left[0] || null);
  // Duos: a downed teammate left alone cannot be helped up any more.
  const mate = duo() ? mateOf(a) : null;
  if (mate?.alive && mate.down) knockOut(mate, mate.downBy, "bleed");
}
function finish(win) {
  if (mode !== "play" || !win) return;
  if (player.alive) {
    player.emote = { k: emoteIndex(ownsItem("emote:" + profile.dance) ? profile.dance : "cheer"), at: worldClock, loop: true };
    player.moving = false;
    stats.deathTime = time;
    showResult(settleMatch(true));
  } else if (spectate && !spectate.res) {
    // Out already, but the teammate took the crown: the win belongs to the whole team.
    stats.pending = false;
    spectate.res = settleMatch(true);
    spectate.res.carried = true;
    updateSpectateUI();
  }
}
// ----- arena events: every minute or so something happens to everyone for a short while -----
const ARENA_EVENTS = ["moon", "sugar", "rain"],
  EVENT_ICONS = { moon: "🌙", sugar: "🍬", rain: "🎁" };
let arenaEvent = null,
  nextEventT = 50;
// The first match ever is a guided one (see the tutorial below).
let tutorial = null;
const tutorialOn = () => !!tutorial;
const eventOn = (k) => arenaEvent?.k === k && time < arenaEvent.until;
// Moon gravity: everything falls slowly, so jumps go much higher. Sugar rush: everybody runs faster.
const gravityK = () => (eventOn("moon") ? 0.4 : 1);
const speedK = () => (eventOn("sugar") ? 1.3 : 1);
function updateArenaEvents() {
  if (net.client || tutorialOn()) return;
  if (arenaEvent && time >= arenaEvent.until) arenaEvent = null;
  // Never in the last moments of a royale, when the zone is tiny.
  if (time < nextEventT || (!koth() && time > options.duration * 0.8)) return;
  nextEventT = time + rand(55, 70);
  startArenaEvent(ARENA_EVENTS[Math.floor(rand(0, ARENA_EVENTS.length))]);
}
// ----- the guided first match: six short lessons, each finished by doing it -----
const TUT_STEPS = ["move", "look", "pickup", "shoot", "roll", "ko"];
function tutBegin(step) {
  tutorial.step = step;
  tutorial.t = 0;
  Object.assign(tutorial, { x: player.x, z: player.z, yaw: cameraYaw, look: 0, p: pickups, s: shots, r: stats.rolls });
  if (TUT_STEPS[step] === "ko") {
    // A weakened rival walks over for the last lesson.
    const b = actors.filter((a) => a.bot && a.alive).sort((a, c) => dist(a, player) - dist(c, player))[0];
    if (b) {
      b.hp = 30;
      b.armor = 0;
      b.lastAttacker = player;
      b.alertT = time;
      b.alertPos = { x: player.x, z: player.z };
      b.think = 0;
    }
  }
  sound("quest");
  tutUI();
}
function tutUI() {
  const el = $("tutorial");
  if (!tutorial || mode !== "play") {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const k = TUT_STEPS[tutorial.step],
    pad = lastInput === "pad";
  $("tutStep").textContent = tutorial.done ? txt("tut.doneTag") : txt("tut.step", tutorial.step + 1, TUT_STEPS.length);
  $("tutText").textContent = tutorial.done ? txt("tut.done") : txt("tut." + k);
  $("tutKeys").textContent = tutorial.done ? "" : txt("tut." + k + (pad ? ".pad" : ".kb"));
  $("tutDots").innerHTML = TUT_STEPS.map((_, i) => `<i class="${i < tutorial.step || tutorial.done ? "on" : i === tutorial.step ? "now" : ""}"></i>`).join("");
}
function updateTutorial(dt) {
  if (!tutorial || mode !== "play" || paused) return;
  tutorial.t += dt;
  if (tutorial.done) {
    if ((tutorial.done -= dt) <= 0) {
      tutorial = null;
      tutUI();
    }
    return;
  }
  if (!player.alive) return;
  const k = TUT_STEPS[tutorial.step];
  tutorial.look += Math.abs(wrapAngle(cameraYaw - tutorial.yaw));
  tutorial.yaw = cameraYaw;
  const ok =
    (k === "move" && Math.hypot(player.x - tutorial.x, player.z - tutorial.z) > 5) ||
    (k === "look" && tutorial.look > 1.6) ||
    (k === "pickup" && (pickups > tutorial.p || tutorial.t > 25)) ||
    (k === "shoot" && shots >= tutorial.s + 3) ||
    (k === "roll" && stats.rolls > tutorial.r) ||
    (k === "ko" && kills > 0);
  if (!ok) return;
  if (tutorial.step < TUT_STEPS.length - 1) tutBegin(tutorial.step + 1);
  else finishTutorial(true);
}
function finishTutorial(passed) {
  if (!tutorial) return;
  profile.tutorialDone = true;
  if (passed) {
    earnCoins(50);
    toast(txt("tut.reward"), "gift");
    sound("win", null, { vol: 0.6 });
  }
  saveProfile();
  tutorial.done = passed ? 4 : 0.01;
  tutUI();
}
const wrapAngle = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
function startArenaEvent(k) {
  arenaEvent = { k, until: time + (k === "rain" ? 6 : 15) };
  announce("event." + k, 4, "quest");
  emit({ e: "aev", k, u: +arenaEvent.until.toFixed(2) });
  if (k === "rain")
    for (let i = 0; i < 7; i++) {
      const p = safePoint(Math.max(6, Math.min(24, zone * 0.7))),
        kind = i % 3 === 2 ? "armor" : i % 3 === 1 ? "consumable" : "weapon";
      addLoot(p.x, p.z, kind, kind === "weapon" ? [1, 3, 4, 9, 10, 2][i % 6] : kind === "consumable" ? 1 : 0, kind === "weapon" ? 1 + (i % 2) : 0);
      burst(p.x, p.z, "#ffd23f", 14, 3, "confetti");
    }
}
// ----- king of the hill -----
// The host moves the hill: a clear spot away from the last one, never on a hazard.
function setHill() {
  const last = KOTH.hill;
  let best = null;
  for (let k = 0; k < 60 && !best; k++) {
    const p = safePoint(19);
    if (clearSpot(p, 2.2) && !hazardAt(p, 6) && (!last || dist(p, last) > 16)) best = p;
  }
  best ||= safePoint(16);
  KOTH.hill = { x: +best.x.toFixed(2), z: +best.z.toFixed(2), r: KOTH_R };
  KOTH.next = time + KOTH_MOVE;
  if (last) announce("koth.moved", 3, "quest");
  for (const a of actors) a.hillSpot = null;
}
function respawnPoint(a) {
  let best = null,
    bestD = -1;
  for (let k = 0; k < 24; k++) {
    const p = safePoint(26),
      d = Math.min(KOTH.hill ? dist(p, KOTH.hill) : 99, ...actors.filter((b) => b.alive && b.team !== a.team).map((b) => dist(b, p)));
    if (d > bestD && !hazardAt(p, 6)) {
      bestD = d;
      best = p;
    }
    if (d > 14) break;
  }
  return best || safePoint();
}
// Back in the match: a fresh hero drops in with the starting kit and a moment of shelter.
function respawn(a) {
  const p = respawnPoint(a);
  Object.assign(a, {
    alive: true,
    down: false,
    x: p.x,
    z: p.z,
    px: p.x,
    pz: p.z,
    y: 7,
    vy: 0,
    landed: false,
    hp: 100,
    armor: 0,
    slots: [item(0), item(1)],
    slot: 1,
    meds: [1, 0, 0],
    grenades: 1,
    cd: 0,
    reload: 0,
    roll: 0,
    rollDir: null,
    inv: 1.2,
    stun: 0,
    use: 0,
    burst: 0,
    grapple: null,
    path: [],
    goal: null,
    enemy: null,
    hillSpot: null,
    think: 0,
    respawnT: 0,
  });
  if (isHuman(a)) hfx(a, { e: "respawn", x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
}
// The three best scores at the top of the screen, with the player's own line when it is not among them.
function kothHud() {
  const list = kothScores(),
    rows = list.slice(0, 3);
  if (!rows.some((x) => x.a.team === player.team)) rows.push(list.find((x) => x.a.team === player.team));
  const html = rows
    .filter(Boolean)
    .map((x) => `<div class="${x.a.team === player.team ? "me" : ""}${KOTH.holder === x.a.team ? " hold" : ""}"><b style="color:${x.a.color}">${esc(x.a.team === player.team ? txt("you") : x.a.name)}</b><i><em style="width:${Math.min(100, x.s)}%"></em></i><span>${Math.floor(x.s)}</span></div>`)
    .join("");
  if (html !== kothHud.last) $("kothScores").innerHTML = kothHud.last = html;
}
function kothScores() {
  return actors.filter((a) => a.id === a.team || !duo()).map((a) => ({ a, s: KOTH.score[a.team] || 0 })).sort((p, q) => q.s - p.s);
}
function updateKoth(dt) {
  if (net.client || KOTH.over) return;
  if (!KOTH.hill || time >= KOTH.next) setHill();
  for (const a of actors) if (!a.alive && a.respawnT > 0 && (a.respawnT -= dt) <= 0) respawn(a);
  const h = KOTH.hill,
    teams = new Set(actors.filter((a) => a.alive && !a.down && a.y < 3.5 && dist(a, h) < h.r).map((a) => a.team));
  KOTH.contested = teams.size > 1;
  KOTH.holder = teams.size === 1 ? [...teams][0] : -1;
  if (time > 4 && KOTH.holder >= 0) KOTH.score[KOTH.holder] = Math.min(KOTH_WIN, (KOTH.score[KOTH.holder] || 0) + dt * KOTH_RATE);
  if ((KOTH.sync -= dt) <= 0) {
    KOTH.sync = 0.25;
    emit({ e: "ks", s: actors.map((a) => Math.floor(KOTH.score[a.team] || 0)), h: KOTH.holder, c: KOTH.contested ? 1 : 0, x: h.x, z: h.z, n: +KOTH.next.toFixed(1) });
  }
  const top = kothScores()[0];
  if (top && (top.s >= KOTH_WIN || time >= options.duration)) endKoth();
}
// The match is over: the best team wins, everyone else learns their place by points.
function endKoth() {
  KOTH.over = true;
  const order = [...new Set(kothScores().map((x) => x.a.team))];
  for (const a of actors)
    if (isHuman(a)) hfx(a, order[0] === a.team ? { e: "win" } : { e: "kothEnd", place: order.indexOf(a.team) + 1 });
  net.matchOver?.(actors.find((a) => a.team === order[0]) || null);
}
function kothWait(source, cause, wid, t) {
  player.alive = false;
  stats.killer = source && source !== player ? source : null;
  stats.cause = cause;
  stats.killWeapon = stats.killer ? (wid ?? stats.killer.slots[stats.killer.slot].id) : null;
  stats.deaths = (stats.deaths || 0) + 1;
  sound("lose", null, { vol: 0.6 });
  spectate = { res: null, target: stats.killer?.alive ? stats.killer : nearestAlive(player), pos: { x: player.x, y: player.y, z: player.z }, t: 0, focusT: 0, yaw: cameraYaw, over: 0, respawn: t };
  mouse.down = false;
  mouse.right = false;
  keys = {};
  hurtFrom = [];
  document.body.classList.add("spectating");
  $("spectate").hidden = false;
  updateSpectateUI();
}
function kothBack(ev) {
  if (mode !== "play") return;
  player.alive = true;
  player.backT = time + 0.6;
  player.x = ev.x;
  player.z = ev.z;
  spectate = null;
  document.body.classList.remove("spectating");
  $("spectate").hidden = true;
  hurt = 0;
  say(txt("koth.again"), 2);
  sound("quest");
}
function kothFinish(place) {
  if (mode !== "play") return;
  if (spectate) {
    spectate = null;
    document.body.classList.remove("spectating");
    $("spectate").hidden = true;
  }
  if (!player.alive) player.alive = true;
  stats.deathTime = time;
  const win = place === 1;
  if (win) player.emote = { k: emoteIndex(ownsItem("emote:" + profile.dance) ? profile.dance : "cheer"), at: worldClock, loop: true };
  const res = settleMatch(win, place),
    best = kothScores()[0];
  res.winner = best ? best.a : null;
  showResult(res);
}
// The teammate is out too: the team's place is known now.
function teamOut(place) {
  if (mode !== "play" || !spectate || spectate.res) return;
  stats.pending = false;
  spectate.res = settleMatch(false, place);
  updateSpectateUI();
}
// XP, profile, quests and achievements are settled the moment the hero wins or is knocked out.
function settleMatch(win, knownPlace) {
  const place = win ? 1 : (knownPlace ?? teamsAlive() + 1),
    top = place <= (duo() ? 2 : 3),
    survived = stats.deathTime || time,
    base = win ? 300 : top ? 100 : 50,
    killXp = kills * 35,
    timeXp = Math.min(90, Math.floor(survived / 3));
  profile.games++;
  profile.wins += win ? 1 : 0;
  profile.kills += kills;
  addXp(base + killXp + timeXp);
  earnCoins(10 + kills * 6 + (win ? 40 : top ? 15 : 0));
  addStars(1 + (win ? 3 : top ? 1 : 0) + Math.min(2, Math.floor(kills / 2)));
  if (!tutorialOn()) addRp(rpFor(place, duo() ? 5 : 10, kills));
  questEvent("play:" + options.arena);
  if (top) questEvent("top3");
  questEvent("survive", Math.floor(survived));
  profile.streak = win ? (profile.streak || 0) + 1 : 0;
  if (win) {
    questEvent("win");
    unlock("win");
    unlock(ARENA_ACH[options.arena]);
    if (options.night) unlock("night");
    if (options.difficulty === "hard") unlock("hard");
    if (duo()) unlock("duowin");
    if (profile.streak >= 3) unlock("streak");
    if (kills === 0 && !koth()) unlock("pacifist");
    if (player.alive && !player.down && player.hp <= 15) unlock("clutch");
  }
  if (top && stats.taken < 40) unlock("survivor");
  if (profile.games >= 10) unlock("games10");
  if (profile.games >= 50) unlock("games50");
  // Played with at least one friend: a client always has the host; a host has remote heroes.
  if (net.on && (net.client || actors.some((a) => a !== player && !a.bot && a.net))) unlock("online");
  checkProgress();
  saveProfile();
  return { win, place, survived, base, killXp, timeXp, winner: win ? player : null, teams: teamCount() };
}
function weaponLabel(k) {
  return k === "grenade" ? txt("popper") : k === "trap" ? txt("mousetrap") : k === "cat" ? txt("cat") : weapons[k]?.name || "—";
}
function showResult(res) {
  mode = "end";
  paused = false;
  mouse.down = false;
  mouse.right = false;
  keys = {};
  unlockMouse();
  document.body.classList.remove("spectating");
  $("spectate").hidden = true;
  $("pause").hidden = true;
  lastResult = res;
  renderResult(res);
  $("result").hidden = false;
  if (res.win) sound("win");
  updateHud();
}
let lastResult = null;
function renderResult(res) {
  const { win, place } = res,
    k = stats.killer,
    pair = duo(),
    near = place <= (pair ? 2 : 3);
  $("resultTag").textContent = win ? arenaInfo().legend : pair ? txt("res.placeTeam", place, res.teams || 5) : txt("res.place", place, 10);
  $("resultCrown").textContent = win ? "♛" : near ? "✦" : "☁";
  $("resultTitle").textContent = txt(win ? (pair ? "res.winTitleDuo" : "res.winTitle") : near ? "res.closeTitle" : "res.loseTitle");
  let why = win
    ? pair
      ? res.carried
        ? txt("res.carried", mateOf(player)?.name || "—")
        : txt("res.winTextDuo")
      : txt("res.winText")
    : k
      ? txt("res.killedBy", k.name, weaponLabel(stats.killWeapon))
      : stats.cause === "steam"
        ? txt(options.arena === "garden" ? "cause.sprinkler" : options.arena === "bathroom" ? "cause.drain" : "cause.kettle")
        : ["zone", "cat", "vacuum"].includes(stats.cause)
          ? txt("cause." + stats.cause)
          : txt("cause.other");
  if (koth()) {
    const mine = Math.floor(KOTH.score[player.team] || 0),
      best = kothScores()[0];
    why = win ? txt("koth.winText", mine) : txt("koth.result", mine, best ? best.a.name : "—", best ? Math.floor(best.s) : 0);
  } else if (!win && res.winner) why += pair ? txt("res.winners", ...teamNames(res.winner.team)) : txt("res.winner", res.winner.name);
  $("resultText").textContent = why;
  let best = null,
    bestDmg = 0;
  for (const [key, v] of Object.entries(stats.byWeapon))
    if (v > bestDmg) {
      bestDmg = v;
      best = key;
    }
  const tile = (v, label, cls = "") => `<div class="${cls}"><b>${v}</b><small>${label}</small></div>`;
  $("resultStats").innerHTML =
    tile(kills, txt("tile.kills")) +
    tile(Math.round(stats.dmg), txt("tile.dmg")) +
    tile((shots ? Math.round(Math.min(1, hits / shots) * 100) : 0) + "%", txt("tile.acc")) +
    tile(clock(res.survived), txt("tile.time")) +
    tile(stats.head, txt("tile.head")) +
    tile(best === null ? "—" : weaponLabel(isNaN(+best) ? best : +best), txt("tile.best"), "wide");
  const parts = [
    ["xp.place", res.base],
    ["xp.kills", res.killXp],
    ["xp.time", res.timeXp],
    ["xp.quests", stats.questXp],
    ["xp.ach", stats.achXp],
  ].filter(([, v]) => v > 0);
  const total = parts.reduce((a, [, v]) => a + v, 0);
  $("reward").innerHTML =
    `<b>${txt("res.xp", total)}</b><span>${parts.map(([n, v]) => txt(n) + " +" + v).join(" · ")}</span>` +
    `<em>${level() > stats.levelStart ? txt("res.levelUp", level()) : txt("res.level", level(), profile.xp % 300)}${stats.coins ? `<i class="coinGain"><i class="coin"></i>+${stats.coins} ${coinsWord(stats.coins)}</i>` : ""}${stats.stars ? `<i class="coinGain starGain">★ +${stats.stars}</i>` : ""}${stats.rp !== undefined ? `<i class="coinGain rpGain">${leagueOf(profile.rp).icon} ${stats.rp >= 0 ? "+" : ""}${stats.rp}</i>` : ""}</em>`;
  $("resultExtras").innerHTML = [
    ...stats.quests.map((q) => `<li class="quest">✔ ${questText(q)} <b>+${q.xp}</b></li>`),
    ...stats.achs.map((a) => `<li class="ach">🏆 ${a.name}</li>`),
    ...stats.gifts.map((g) => `<li class="gift">${txt("res.gift", g.skin ? txt("giftSkin") : g.name)}</li>`),
  ].join("");
  $("resultExtras").hidden = !$("resultExtras").innerHTML;
}
// ---------- knocked out: kill cam, then spectating the rest of the match ----------
let spectate = null,
  stats = null;
function newStats() {
  return {
    dmg: 0,
    taken: 0,
    heal: 0,
    head: 0,
    rolls: 0,
    gadgets: 0,
    revives: 0,
    coins: 0,
    koT: [],
    byWeapon: {},
    killer: null,
    cause: null,
    killWeapon: null,
    deathTime: 0,
    quests: [],
    achs: [],
    gifts: [],
    questXp: 0,
    achXp: 0,
    levelStart: level(),
  };
}
function nearestAlive(p) {
  let best = null,
    bd = Infinity;
  for (const a of actors)
    if (a !== player && a.alive) {
      const d = dist(a, p);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
  return best;
}
// Where sounds are heard from and whose surroundings the HUD shows.
function listener() {
  if (!spectate) return player;
  return spectate.target?.alive ? spectate.target : spectate.pos;
}
function playerDown(source, cause, wid, place) {
  stats.killer = source && source !== player ? source : null;
  stats.cause = cause;
  stats.killWeapon = stats.killer ? (wid ?? (cause === "shot" || cause === "melee" || cause === "bleed" ? stats.killer.slots[stats.killer.slot].id : cause)) : null;
  stats.deathTime = time;
  stats.pending = place === 0;
  const res = stats.pending ? null : settleMatch(false, place),
    mate = duo() ? mateOf(player) : null;
  sound("lose");
  spectate = {
    res,
    target: stats.killer?.alive ? stats.killer : mate?.alive ? mate : nearestAlive(player),
    pos: { x: player.x, y: player.y, z: player.z },
    t: 0,
    focusT: 0,
    yaw: cameraYaw,
    over: 0,
  };
  mouse.down = false;
  mouse.right = false;
  keys = {};
  hurtFrom = [];
  document.body.classList.add("spectating");
  $("spectate").hidden = false;
  unlockMouse();
  updateSpectateUI();
}
function specNext(dir) {
  if (!spectate) return;
  const list = actors.filter((a) => a !== player && a.alive);
  if (!list.length) return;
  const i = list.indexOf(spectate.target);
  spectate.target = list[(Math.max(0, i) + dir + list.length) % list.length];
  spectate.focusT = 0;
  updateSpectateUI();
}
// Online, the host keeps the world running while other players are still in the match;
// once only bots are left it may end the match for everyone.
const matchNeedsHost = () => net.host && teamsAlive() > 1 && actors.some((a) => a.alive && isHuman(a));
// The teammate is still fighting, so the team's result is not known yet.
const waitingForMate = () => !!stats?.pending && teamsAlive() > 1;
function endSpectate(force = false) {
  if (!spectate || mode !== "play") return;
  if (matchNeedsHost() || (!force && waitingForMate())) return;
  if (net.host && teamsAlive() > 1) net.matchOver?.(null, true);
  // Leaving before the teammate's fight is decided: the team's place at this moment.
  if (!spectate.res) {
    stats.pending = false;
    spectate.res = settleMatch(false, teamsAlive());
  }
  const left = actors.filter((a) => a.alive);
  spectate.res.winner = teamsAlive() === 1 ? left[0] : null;
  showResult(spectate.res);
}
const winsText = (a) => (duo() ? txt("say.winsTeam", ...teamNames(a.team)) : txt("say.wins", a.name));
function updateSpectate(dt) {
  if (!spectate) return;
  spectate.t += dt;
  spectate.focusT += dt;
  if (spectate.respawn !== undefined) {
    spectate.respawn = Math.max(0, spectate.respawn - dt);
    if (!spectate.target?.alive) spectate.target = nearestAlive(spectate.pos);
    return;
  }
  if (!spectate.target?.alive) spectate.target = nearestAlive(spectate.target || spectate.pos);
  // In duos the camera goes to the teammate after the kill cam.
  const mate = duo() ? mateOf(player) : null;
  if (mate?.alive && !spectate.mateSeen && spectate.t > 2.5) {
    spectate.mateSeen = true;
    spectate.target = mate;
    spectate.focusT = 0;
  }
  const left = actors.filter((a) => a.alive);
  if (!spectate.over && teamsAlive() <= 1) {
    spectate.over = 3.2;
    if (left[0]) {
      spectate.target = left[0];
      say(winsText(left[0]), 3);
    }
  }
  if (spectate.over) {
    spectate.over -= dt;
    if (spectate.over <= 0) endSpectate();
  }
}
function updateSpectateUI() {
  if (!spectate) return;
  const t = spectate.target,
    killcam = stats.killer && t === stats.killer && spectate.t < 3.5;
  $("specResult").hidden = spectate.respawn !== undefined;
  if (spectate.respawn !== undefined) {
    $("specTag").textContent = txt("koth.back", Math.ceil(spectate.respawn));
    $("specName").textContent = t ? t.name : "—";
    $("specName").style.color = t ? t.color : "";
    $("specInfo").textContent = stats.killer ? txt("koth.by", stats.killer.name) : "";
    return;
  }
  $("specTag").textContent = txt(
    killcam ? "spec.killer" : spectate.over ? "spec.winner" : duo() && t && ally(player, t) ? (waitingForMate() ? "spec.mateFight" : "spec.mate") : "spec.watch",
  );
  $("specName").textContent = t ? t.name : "—";
  $("specName").style.color = t ? t.color : "";
  $("specInfo").textContent = t ? weapons[t.slots[t.slot].id].name + " · " + txt("knockouts", t.kills) : "";
  $("specHp").style.width = (t ? t.hp : 0) + "%";
  // The online host watches until the end: the match cannot stop while others still play.
  $("specResult").hidden = matchNeedsHost() || waitingForMate();
  $("specHint").textContent = txt(waitingForMate() ? "spec.hintWait" : "spec.hint");
  $("specArmor").style.width = (t ? (t.armor / 75) * 100 : 0) + "%";
}
function groundAt(x, z) {
  return 0;
}
function move(a, dx, dz, dt) {
  const oldX = a.x,
    oldZ = a.z;
  a.x = clamp(a.x + dx * dt, -30.8, 30.8);
  a.z = clamp(a.z + dz * dt, -30.8, 30.8);
  for (const o of obstacles) {
    if (a.y >= o.h - 0.02) continue;
    let d = dist(a, o),
      r = o.r + 0.4;
    if (d < r) {
      let nx = (a.x - o.x) / (d || 1),
        nz = (a.z - o.z) / (d || 1);
      if (!d) nx = 1;
      a.x = o.x + nx * r;
      a.z = o.z + nz * r;
    }
  }
  a.x = clamp(a.x, -30.8, 30.8);
  a.z = clamp(a.z, -30.8, 30.8);
  const travel = Math.hypot(a.x - oldX, a.z - oldZ);
  a.step += travel * 3;
  a.moving = travel > 0.003;
}
function segmentCircle(x1, z1, x2, z2, x, z, r) {
  let dx = x2 - x1,
    dz = z2 - z1,
    t = clamp(((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x1 + dx * t - x, z1 + dz * t - z) < r;
}
function lineClear(a, b) {
  return !obstacles.some((o) => segmentCircle(a.x, a.z, b.x, b.z, o.x, o.z, o.r + 0.1));
}
// Walkable straight line: uses the hero's collision radius, so bots do not scrape along obstacles.
function walkClear(a, b) {
  return !obstacles.some((o) => segmentCircle(a.x, a.z, b.x, b.z, o.x, o.z, o.r + 0.55));
}
// Line of sight between two chests: an obstacle only blocks where the sight line passes below its top.
function lineOfSight(a, b, ha = 1, hb = 1) {
  const ya = (a.y || 0) + ha,
    yb = (b.y || 0) + hb,
    dx = b.x - a.x,
    dz = b.z - a.z,
    A = dx * dx + dz * dz;
  return !obstacles.some((o) => {
    const r = o.r + 0.1,
      fx = a.x - o.x,
      fz = a.z - o.z,
      C = fx * fx + fz * fz - r * r;
    if (A < 1e-9) return C < 0 && Math.min(ya, yb) < o.h;
    const B = 2 * (fx * dx + fz * dz),
      D = B * B - 4 * A * C;
    if (D < 0) return false;
    const s = Math.sqrt(D);
    let t0 = (-B - s) / (2 * A),
      t1 = (-B + s) / (2 * A);
    if (t1 < 0 || t0 > 1) return false;
    t0 = Math.max(0, t0);
    t1 = Math.min(1, t1);
    return Math.min(ya + (yb - ya) * t0, ya + (yb - ya) * t1) < o.h;
  });
}
function hiddenInSmoke(a, b) {
  return clouds.some((c) => c.life > 0 && segmentCircle(a.x, a.z, b.x, b.z, c.x, c.z, c.r));
}
function emitProjectile(a, angle, dy = 0) {
  const it = a.slots[a.slot],
    w = weapons[it.id];
  if (it.ammo <= 0) return;
  it.ammo--;
  const pellets = w.kind === "spread" ? 5 : 1;
  for (let i = 0; i < pellets; i++) {
    let spread =
        (i - (pellets - 1) / 2) * 0.095 +
        (a.bot ? rand(-0.18, 0.18) * (options.difficulty === "hard" ? 0.55 : options.difficulty === "easy" ? 1.75 : 1) : 0),
      r = angle + spread;
    if (net.replaying) continue;
    bullets.push({
      x: a.x + Math.sin(r) * 0.8,
      z: a.z + Math.cos(r) * 0.8,
      y: a.y + 0.94,
      dx: Math.sin(r),
      dz: Math.cos(r),
      dy,
      life: w.range / 30,
      max: w.range / 30,
      source: a,
      dmg: w.dmg * (1 + it.q * 0.1),
      headBonus: it.id === 3 ? 1.5 : 1,
      color: w.color,
      wid: it.id,
    });
    const b = bullets[bullets.length - 1];
    emit({ e: "bs", s: a.id, p: [b.x, b.y, b.z, b.dx, b.dy, b.dz].map((v) => +v.toFixed(3)), l: b.life, c: b.color, w: b.wid }, [a]);
    if (a === player && !net.replaying) shots++;
  }
  a.noise = time;
  if (a === player) {
    sound("shot", null, { wid: it.id, pitch: rand(0.96, 1.04) });
    if (!net.replaying) recoil = 0.1;
  } else sound("shot", a, { wid: it.id, pitch: rand(0.93, 1.07) }, [a]);
}
function shoot(a) {
  if (!a.alive || a.down || a.cd > 0 || a.reload > 0 || a.use > 0 || a.stun > 0 || !a.landed) return;
  const it = a.slots[a.slot],
    w = weapons[it.id];
  if (w.cap && it.ammo <= 0) {
    reload(a);
    return;
  }
  a.cd = w.cd * (a.bot ? (options.difficulty === "hard" ? 1 : options.difficulty === "easy" ? 2.4 : 1.65) : 1);
  a.animation = 0.22;
  if (!w.cap) {
    const candidates = net.client
      ? []
      : actors
      .filter(
        (b) =>
          b !== a &&
          b.alive &&
          !ally(a, b) &&
          dist(a, b) < w.range &&
          Math.abs(a.y - b.y) < 1.8 &&
          Math.cos(Math.atan2(b.x - a.x, b.z - a.z) - a.angle) > 0.2 &&
          lineOfSight(a, b),
      )
      .sort((b, c) => dist(a, b) - dist(a, c));
    for (const b of candidates.slice(0, w.kind === "fork" ? 2 : 1)) {
      if (damage(b, w.dmg * (1 + it.q * 0.1), a, "melee", false, null, it.id) && w.kind === "hammer") b.stun = 0.8;
      else if (w.kind === "swatter" && b.alive) {
        const d = dist(a, b) || 1;
        move(b, ((b.x - a.x) / d) * 26, ((b.z - a.z) / d) * 26, 0.17);
        if (b.landed && !b.down) b.vy = 5;
        emit({ e: "snd", k: "bonk", s: b.id, o: {} });
      }
    }
    if (!net.replaying) addRing({ x: a.x, z: a.z, y: a.y, r: w.range, life: 0.18, total: 0.18, color: "#fff4c4", angle: a.angle, arc: true, kind: "swing" }, [a]);
    a.noise = time;
    sound("melee", a === player ? null : a, {}, [a]);
  } else {
    const dy = a.aimSlope || 0;
    emitProjectile(a, a.angle, dy);
    if (w.kind === "burst") {
      a.burst = Math.min(2, it.ammo);
      a.burstTimer = 0.09;
    }
  }
}
function reload(a) {
  const w = a.slots[a.slot].id;
  if (!weapons[w].cap || a.reload > 0 || a.slots[a.slot].ammo === weapons[w].cap || a.use > 0) return;
  a.reload = w === 1 ? 0.85 : 1.4;
  a.burst = 0;
  if (a === player) sound("reload");
}
function nearestLoot(a) {
  let found = null,
    d = 2.25;
  for (const l of loot) {
    let v = dist(a, l);
    if (v < d) {
      found = l;
      d = v;
    }
  }
  return found;
}
function lootName(l) {
  return l.type === "weapon"
    ? weapons[l.id].name + " · " + qualities[l.q]
    : l.type === "armor"
      ? txt("foil")
      : l.type === "consumable"
        ? consumables[l.id].name
        : l.type === "gadget"
          ? gadgetNames[l.id]
          : txt("popper");
}
function pickup(a, l) {
  if (!l || a.y > 2.5 || a.down) return false;
  if (l.type === "armor") {
    if (a.armor >= 75) {
      tell(a, "say.armorFull");
      return false;
    }
    a.armor = Math.min(75, a.armor + 25);
  } else if (l.type === "consumable") {
    if (a.meds[l.id] >= 5) {
      tell(a, "say.pocketFull");
      return false;
    }
    a.meds[l.id]++;
  } else if (l.type === "grenade") {
    if (a.grenades >= 3) {
      tell(a, "say.poppersMax");
      return false;
    }
    a.grenades++;
  } else if (l.type === "gadget") {
    a.gadget = l.id;
    a.gadgetCd = Math.max(a.gadgetCd, 1);
  } else {
    const old = a.slots[a.slot];
    a.slots[a.slot] = item(l.id, l.q);
    a.reload = 0;
    a.burst = 0;
    if (isHuman(a)) {
      const p = dropSpot(a);
      addLoot(p.x, p.z, "weapon", old.id, old.q);
    }
  }
  removeLoot(l);
  if (isHuman(a)) hfx(a, { e: "pickup", l: { type: l.type, id: l.id, q: l.q } });
  return true;
}
function useConsumable(a) {
  const i = a.consumable,
    s = consumables[i];
  if (a.use > 0 || a.reload > 0 || a.down) return;
  if (a.meds[i] <= 0) {
    tell(a, "say.noItem", [{ c: i }], 1.6);
    return;
  }
  if ((s.hp && a.hp >= 100) || (s.armor && a.armor >= 75)) {
    tell(a, s.hp ? "say.hpFull" : "say.armorMax");
    return;
  }
  a.use = s.time;
  a.useTotal = s.time;
  a.useType = i;
  a.burst = 0;
}
function tossGrenade(a) {
  if (!a.alive || a.down || a.grenades <= 0 || a.use > 0 || !a.landed) return;
  a.grenades--;
  a.noise = time;
  sound("throw", a === player ? null : a);
  const g = { x: a.x, z: a.z, y: a.y + 1.1, vx: Math.sin(a.angle) * 8, vz: Math.cos(a.angle) * 8, vy: 5, fuse: 1.2, source: a, uid: ++lootUid };
  grenades.push(g);
  emit({ e: "gs", u: g.uid, p: [g.x, g.y, g.z, g.vx, g.vy, g.vz].map((v) => +v.toFixed(3)), f: g.fuse, s: a.id });
}
function useGadget(a) {
  if (a.gadgetCd > 0 || !a.alive || a.down || a.use > 0) return;
  const g = a.gadget;
  if (g === 0) {
    a.vy = 12;
    a.landed = true;
    sound("jump", a === player ? null : a);
  } else if (g === 1) {
    let length = 0;
    for (let d = 0.5; d <= 13; d += 0.5) {
      const p = { x: a.x + Math.sin(a.angle) * d, z: a.z + Math.cos(a.angle) * d };
      if (!clearSpot(p, 0.6)) break;
      length = d;
    }
    if (length < 2) {
      tell(a, "say.hookPath");
      return;
    }
    a.grapple = { x: a.x + Math.sin(a.angle) * length, z: a.z + Math.cos(a.angle) * length, t: 0.45 };
    a.inv = 0.15;
  } else if (g === 2) {
    const c = { x: a.x + Math.sin(a.angle) * 2, z: a.z + Math.cos(a.angle) * 2, r: 4, life: 7 };
    clouds.push(c);
    emit({ e: "c", c });
  } else {
    const t = { x: a.x + Math.sin(a.angle) * 1.2, z: a.z + Math.cos(a.angle) * 1.2, life: 45, owner: a, uid: ++lootUid };
    traps.push(t);
    emit({ e: "ta", u: t.uid, x: t.x, z: t.z, l: t.life, o: a.id });
  }
  a.gadgetCd = gadgetCD[g];
  if (isHuman(a)) hfx(a, { e: "gadget", g });
}
function pathfind(start, end) {
  const N = 43,
    idx = (p) => clamp(Math.round(p.z / 1.5) + 21, 0, 42) * 43 + clamp(Math.round(p.x / 1.5) + 21, 0, 42),
    point = (i) => ({ x: ((i % 43) - 21) * 1.5, z: (Math.floor(i / 43) - 21) * 1.5 }),
    s = idx(start),
    goal = idx(end),
    cost = new Float32Array(N * N).fill(Infinity),
    prev = new Int16Array(N * N).fill(-1),
    closed = new Uint8Array(N * N),
    open = [s];
  cost[s] = 0;
  let best = s,
    iter = 0;
  while (open.length && iter++ < 550) {
    let bestIdx = 0,
      bestScore = Infinity;
    for (let i = 0; i < open.length; i++) {
      let n = open[i],
        score = cost[n] + dist(point(n), point(goal));
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    let cur = open.splice(bestIdx, 1)[0];
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (dist(point(cur), point(goal)) < dist(point(best), point(goal))) best = cur;
    if (cur === goal) {
      best = cur;
      break;
    }
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        let x = (cur % N) + dx,
          z = Math.floor(cur / N) + dz;
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        let next = z * N + x;
        if (navGrid[next] || closed[next]) continue;
        if (dx && dz && (navGrid[cur + dx] || navGrid[cur + dz * N])) continue;
        let c = cost[cur] + (dx && dz ? 2.122 : 1.5);
        if (c < cost[next]) {
          cost[next] = c;
          prev[next] = cur;
          open.push(next);
        }
      }
  }
  const path = [];
  for (let cur = best; cur !== s && cur >= 0; cur = prev[cur]) path.push(point(cur));
  return path.reverse();
}
// ---------- duos: helping a downed teammate up ----------
// The downed teammate within reach, if any.
function reviveTarget(a) {
  if (!duo() || !a.alive || a.down) return null;
  const m = mateOf(a);
  return m && m.alive && m.down && dist(a, m) < REVIVE_R && Math.abs(a.y - m.y) < 1.2 ? m : null;
}
function startRevive(a, m) {
  if (!m || a.use > 0 || a.stun > 0) return;
  a.use = REVIVE_S;
  a.useTotal = REVIVE_S;
  a.useType = REVIVE_USE;
  a.reviveId = m.id;
  a.burst = 0;
  a.reload = 0;
  if (isHuman(m)) hfx(m, { e: "say", k: "say.beingRevived", a: [{ v: a.id }], s: 2 });
}
function reviveOk(a) {
  const m = actorById(a.reviveId);
  return !!m && m.alive && m.down && !a.down && dist(a, m) < REVIVE_R + 0.4;
}
function finishRevive(a, m) {
  if (!m || !m.alive || !m.down) return;
  m.down = false;
  m.hp = REVIVE_HP;
  m.downBy = null;
  m.inv = 0.5;
  m.stun = 0;
  m.think = 0;
  m.path = [];
  burst(m.x, m.z, "#6dff8a", 18, m.y + 1);
  sound("quest", m === player || a === player ? null : m, { vol: 0.8 }, [a, m]);
  if (isHuman(m)) hfx(m, { e: "revived", by: a.id });
  if (isHuman(a)) hfx(a, { e: "reviveDone", v: m.id });
}
// ---------- bots ----------
const BOT = {
  easy: { react: 0.8, lead: 0, dodge: 0.06, fire: [0.5, 1.1], rest: [1.1, 2.1], gadget: 0.3, jump: 0.05, strafe: 0.55, toss: 0.02 },
  normal: { react: 0.5, lead: 0.35, dodge: 0.24, fire: [0.8, 1.6], rest: [0.7, 1.3], gadget: 0.7, jump: 0.14, strafe: 0.85, toss: 0.04 },
  hard: { react: 0.28, lead: 0.75, dodge: 0.45, fire: [1.1, 2.2], rest: [0.35, 0.8], gadget: 1, jump: 0.26, strafe: 1, toss: 0.06 },
};
const botSkill = () => BOT[options.difficulty] || BOT.normal;
// Comfortable fighting distance for the weapon in hand.
function prefRange(it) {
  const k = weapons[it.id].kind;
  return k === "bow" || k === "crossbow"
    ? [13, 24]
    : k === "shot"
      ? [8, 17]
      : k === "burst"
        ? [7, 14]
        : k === "spread"
          ? [4, 9]
          : [0.6, 1.7];
}
// Dangerous ground while a hazard is on or about to start: kettle steam, the robot vacuum's lane or the drain's pull.
function hazardAt(p, lead = 3) {
  if (options.arena === "bathroom") return time % 36 > 27 - lead && Math.hypot(p.x - DRAIN.x, p.z - DRAIN.z) < DRAIN.pull + 0.5;
  if (options.arena === "kidsroom") {
    if (!vacuum) return false;
    const l = vacuum.lane,
      along = l.h ? p.x : p.z,
      across = l.h ? p.z : p.x;
    return Math.abs(across - l.c) < VAC_R + 1.7 && (along - vacuum.s) * vacuum.dir > -3;
  }
  if (options.arena !== "kitchen") return false;
  const c = time % 36;
  return c > 27 - lead && p.x > 6 && p.x < 18 && p.z > -29 && p.z < -19;
}
// Nearest safe spot out of the current hazard.
function hazardExit(a) {
  if (options.arena === "bathroom") {
    const base = Math.atan2(a.x - DRAIN.x, a.z - DRAIN.z),
      r = DRAIN.pull + 2.5;
    for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2]) {
      const g = { x: DRAIN.x + Math.sin(base + off) * r, z: DRAIN.z + Math.cos(base + off) * r };
      if (clearSpot(g, 0.6) && Math.hypot(g.x, g.z) < zone - 1) return g;
    }
    return inside({ x: DRAIN.x + Math.sin(base) * r, z: DRAIN.z + Math.cos(base) * r });
  }
  if (options.arena === "kidsroom" && vacuum) {
    const l = vacuum.lane,
      off = VAC_R + 3.2,
      side = Math.sign((l.h ? a.z : a.x) - l.c) || 1;
    for (const s of [side, -side]) {
      const g = l.h ? { x: clamp(a.x, -28, 28), z: l.c + s * off } : { x: l.c + s * off, z: clamp(a.z, -28, 28) };
      if (clearSpot(g, 0.6) && Math.hypot(g.x, g.z) < zone) return g;
    }
    return l.h ? { x: a.x, z: l.c + side * off } : { x: l.c + side * off, z: a.z };
  }
  return a.x - 4.5 < -17.5 - a.z ? { x: 4.5, z: a.z } : { x: a.x, z: -17.5 };
}
// A free, safe spot within r of p (a bot wandering around its teammate).
function nearPoint(p, r) {
  for (let k = 0; k < 10; k++) {
    const q = { x: clamp(p.x + rand(-r, r), -28, 28), z: clamp(p.z + rand(-r, r), -28, 28) };
    if (clearSpot(q) && Math.hypot(q.x, q.z) < safeR() && !hazardAt(q, 4)) return q;
  }
  return null;
}
// Keep bot goals well inside the zone (the retreat threshold is zone-4.5), so they do not oscillate at the edge.
const safeR = () => Math.max(1, zone - 5.5);
function inside(p) {
  const r = Math.hypot(p.x, p.z),
    m = safeR();
  return r > m ? { x: (p.x / r) * m, z: (p.z / r) * m } : { x: p.x, z: p.z };
}
function coverSpot(a, threat) {
  let best = null,
    bd = Infinity;
  for (const o of obstacles) {
    if (o.h < 1.8 || dist(a, o) > 18) continue;
    const base = Math.atan2(o.x - threat.x, o.z - threat.z);
    for (const side of [0, -0.55, 0.55]) {
      const p = { x: o.x + Math.sin(base + side) * (o.r + 1.2), z: o.z + Math.cos(base + side) * (o.r + 1.2) };
      if (!clearSpot(p, 0.45) || Math.hypot(p.x, p.z) > safeR() || hazardAt(p)) continue;
      const d = dist(a, p) + (lineOfSight(threat, p) ? 25 : 0);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
  }
  return best;
}
function botRoll(a, dx, dz) {
  const l = Math.hypot(dx, dz) || 1;
  a.roll = 3;
  a.inv = 0.32;
  a.rollDir = { x: dx / l, z: dz / l };
  sound("roll", a, { vol: 0.6 });
}
// Something about to hit the bot: a projectile on course, a popper about to burst or the cat's landing spot.
function incomingThreat(a) {
  for (const b of bullets) {
    if (b.source === a || ally(a, b.source)) continue;
    const rx = a.x - b.x,
      rz = a.z - b.z,
      d = Math.hypot(rx, rz);
    if (d > 7 || d < 0.6 || rx * b.dx + rz * b.dz <= 0) continue;
    const side = rx * b.dz - rz * b.dx;
    if (Math.abs(side) > 1.1) continue;
    const sg = side >= 0 ? 1 : -1;
    return { x: b.dz * sg, z: -b.dx * sg, w: 1 };
  }
  for (const g of grenades) {
    if (g.fuse > 1.1 || ally(a, g.source)) continue;
    const d = dist(a, g);
    if (d < 4.5) return { x: (a.x - g.x) / (d || 1), z: (a.z - g.z) / (d || 1), w: 1.5 };
  }
  if (cat && cat.mode === "warn" && cat.pounce) {
    const d = dist(a, cat.pounce);
    if (d < 2.6) return { x: (a.x - cat.pounce.x) / (d || 1), z: (a.z - cat.pounce.z) / (d || 1), w: 2.2 };
  }
  if (vacuum?.active) {
    const l = vacuum.lane,
      ahead = ((l.h ? a.x : a.z) - vacuum.s) * vacuum.dir,
      off = (l.h ? a.z : a.x) - l.c;
    if (ahead > 0 && ahead < 5.5 && Math.abs(off) < VAC_R + 0.6) {
      const s = Math.sign(off) || 1;
      return l.h ? { x: 0, z: s, w: 2 } : { x: s, z: 0, w: 2 };
    }
  }
  return null;
}
// Whether a bot can still get to its downed teammate and help it up before it bleeds out.
function canReach(a, m) {
  return m.hp / (DOWN_HP / BLEED_S) > dist(a, m) / 4.6 + REVIVE_S + 0.3;
}
// A downed bot crawls to its teammate, or away from danger when it cannot reach it.
function crawlThink(a) {
  a.brain = "crawl";
  a.enemy = null;
  const m = mateOf(a);
  let g = null;
  if (m?.alive && !m.down) g = dist(a, m) > 1.6 ? { x: m.x, z: m.z } : null;
  else {
    let near = null,
      nd = Infinity;
    for (const b of actors)
      if (b.alive && !b.down && !sameTeam(a, b)) {
        const d = dist(a, b);
        if (d < nd) {
          nd = d;
          near = b;
        }
      }
    if (near && nd < 15) {
      const l = nd || 1;
      g = inside({ x: clamp(a.x + ((a.x - near.x) / l) * 6, -28, 28), z: clamp(a.z + ((a.z - near.z) / l) * 6, -28, 28) });
    }
  }
  if (Math.hypot(a.x, a.z) > zone - 1.5 || hazardAt(a, 2)) g = hazardAt(a, 2) ? hazardExit(a) : inside({ x: a.x * 0.6, z: a.z * 0.6 });
  a.goal = g;
  a.path = g ? (walkClear(a, g) ? [g] : pathfind(a, g)) : [];
  a.pathIndex = 0;
}
function botThink(a) {
  if (a.down) return crawlThink(a);
  const S = botSkill(),
    fightOn = time > Math.min(40, options.duration * 0.1) && !(tutorial && tutorial.step < TUT_STEPS.length - 1);
  let enemy = null,
    score = Infinity,
    ed = Infinity;
  // Duos: the teammate (standing or downed), and whoever is shooting at it right now.
  const mate = duo() ? mateOf(a) : null,
    pal = mate?.alive ? mate : null,
    buddy = pal && !pal.down ? pal : null,
    downMate = pal && pal.down ? pal : null,
    helpT = pal && pal.lastAttacker?.alive && !ally(a, pal.lastAttacker) && time - pal.alertT < 5 ? pal.lastAttacker : null;
  for (const b of actors) {
    if (b === a || !b.alive || ally(a, b)) continue;
    const d = dist(a, b),
      known = (b === a.lastAttacker && time - a.alertT < 6) || b === helpT;
    if (d > (known ? 42 : 27) || !lineOfSight(a, b) || hiddenInSmoke(a, b)) continue;
    // A downed rival is finished off only when nobody standing is around.
    const sc = d - (known ? 10 : 0) - (b === a.enemy ? 4 : 0) - (b.hp < 40 ? 3 : 0) + (b.down ? 7 : 0);
    if (sc < score) {
      score = sc;
      enemy = b;
      ed = d;
    }
  }
  if (enemy && enemy !== a.enemy) a.react = S.react * rand(0.8, 1.25) * (enemy === a.lastAttacker ? 0.5 : 1);
  a.enemy = enemy;
  const threat = enemy || (a.lastAttacker?.alive && time - a.alertT < 4 ? a.lastAttacker : null),
    hurt = a.hp + a.armor * 0.5 < 45,
    rr = Math.hypot(a.x, a.z),
    outside = rr > zone - 4.5;
  if (enemy && fightOn && a.use > 0 && a.useType === REVIVE_USE && ed < 12) a.use = 0;
  if (enemy && fightOn) {
    const r = a.slots[1],
      ok = weapons[r.id].cap > 0 && (r.ammo > 0 || a.reload > 0);
    setSlot(a, ed < 2.6 || (!ok && ed < 6) ? 0 : 1);
  } else if (!enemy && a.use <= 0 && a.slots[1].ammo < weapons[a.slots[1].id].cap * 0.6) {
    setSlot(a, 1);
    reload(a);
  }
  a.goal = null;
  const face = (t) => {
    a.angle = Math.atan2(t.x - a.x, t.z - a.z);
  };
  if (outside) {
    a.brain = "zone";
    const r = Math.max(0, zone - 7) * 0.5,
      ang = Math.atan2(a.x, a.z);
    for (let k = 0; k < 9; k++) {
      const t = ang + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35,
        g = { x: Math.sin(t) * r, z: Math.cos(t) * r };
      if (k === 8 || clearSpot(g, 0.6)) {
        a.goal = g;
        break;
      }
    }
  } else if (hazardAt(a, 3.5)) {
    a.brain = "hazard";
    a.goal = hazardExit(a);
  } else if (downMate && canReach(a, downMate) && (!enemy || ed > 15 || !fightOn || (dist(a, downMate) < 8 && ed > 7))) {
    // The teammate is down and there is time to help: run over (healing can wait) and help it up.
    a.brain = "revive";
    if (a.use > 0 && a.useType !== REVIVE_USE) a.use = 0;
    if (dist(a, downMate) < REVIVE_R - 0.5 && Math.abs(a.y - downMate.y) < 1.2) {
      a.goal = null;
      if (a.use <= 0) startRevive(a, downMate);
    } else a.goal = { x: downMate.x, z: downMate.z };
  } else if (options.arena === "garden" && a.hp < 45 && time % 36 > 24 && rr < 26 && zone > 31) {
    a.brain = "hazard";
    const ang = Math.atan2(a.x, a.z);
    for (let k = 0; k < 7; k++) {
      const t = ang + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25,
        g = { x: Math.sin(t) * 27.5, z: Math.cos(t) * 27.5 };
      if (k === 6 || clearSpot(g, 0.6)) {
        a.goal = g;
        break;
      }
    }
  } else if (hurt && threat && fightOn) {
    const keep = a.brain === "cover" && a.cover && Math.hypot(a.cover.x, a.cover.z) < safeR() && !lineOfSight(threat, a.cover);
    a.brain = "cover";
    a.goal = a.cover = keep ? a.cover : coverSpot(a, threat);
    if (!a.goal) {
      const dx = a.x - threat.x,
        dz = a.z - threat.z,
        l = Math.hypot(dx, dz) || 1;
      a.goal = { x: clamp(a.x + (dx / l) * 8, -28, 28), z: clamp(a.z + (dz / l) * 8, -28, 28) };
    }
    if (enemy && a.gadgetCd <= 0 && a.use <= 0 && Math.random() < S.gadget) {
      if (a.gadget === 2 && ed < 18) {
        face(enemy);
        useGadget(a);
      } else if (a.gadget === 3 && ed < 8) {
        face(enemy);
        useGadget(a);
      } else if (a.gadget === 1 && ed < 10) {
        face(a.goal);
        useGadget(a);
      } else if (a.gadget === 0 && ed < 7) useGadget(a);
    }
  } else if (hurt && fightOn && a.cover && time - a.alertT < 8 && Math.hypot(a.cover.x, a.cover.z) < safeR()) {
    a.brain = "cover";
    a.goal = a.cover;
  } else if (enemy && fightOn && ed < 30) {
    a.brain = "fight";
    const far = prefRange(a.slots[a.slot])[1];
    if (ed > far + 4) a.goal = inside(enemy);
    if (a.gadgetCd <= 0 && a.use <= 0 && Math.random() < S.gadget * 0.5) {
      if (a.gadget === 1 && a.slot === 0 && ed > 4 && ed < 12) {
        face(enemy);
        useGadget(a);
      } else if (a.gadget === 3 && ed < 6 && !weapons[enemy.slots[enemy.slot].id].cap) {
        face(enemy);
        useGadget(a);
      }
    }
  } else if (!enemy && !hurt && fightOn && a.lastAttacker?.alive && time - a.alertT < 5 && a.alertPos) {
    a.brain = "hunt";
    a.goal = inside(a.alertPos);
  } else if (!enemy && !hurt && fightOn && helpT && pal.alertPos) {
    // The teammate is under fire (standing, or downed out of reach): go where the shots come from.
    a.brain = "assist";
    a.goal = inside(pal.alertPos);
  } else {
    const local = loot.filter(
      (l) => (time > options.duration * 0.12 || dist(a.home, l) < 10) && !hazardAt(l, 4) && Math.hypot(l.x, l.z) < safeR(),
    );
    const want = local
      .filter(
        (l) =>
          (l.type === "armor" && a.armor < 50) ||
          (l.type === "weapon" && l.q > a.slots[1].q && weapons[l.id].cap) ||
          (l.type === "consumable" && (a.hp < 65 || (l.id === 2 && a.armor < 40 && a.meds[2] < 2))) ||
          (l.type === "gadget" && a.gadget === 0 && l.id !== 0) ||
          (l.type === "grenade" && a.grenades < 2),
      )
      .sort((b, c) => dist(a, b) - dist(a, c))[0];
    if (want && dist(a, want) < 16 && (!buddy || dist(buddy, want) < 20)) {
      a.brain = "loot";
      a.goal = { x: want.x, z: want.z };
      setSlot(a, 1);
    } else if (buddy && dist(a, buddy) > 11) {
      // Too far from the teammate: catch up, stopping a few steps short.
      a.brain = "regroup";
      const d = dist(a, buddy) || 1,
        g = { x: buddy.x + ((a.x - buddy.x) / d) * 3, z: buddy.z + ((a.z - buddy.z) / d) * 3 };
      a.goal = inside(clearSpot(g, 0.6) ? g : buddy);
    } else {
      a.brain = "explore";
      if (!a.roam || dist(a, a.roam) < 2 || hazardAt(a.roam, 4) || Math.hypot(a.roam.x, a.roam.z) > safeR() || (buddy && dist(a.roam, buddy) > 9)) {
        if (buddy) a.roam = nearPoint(buddy, 6) || inside(buddy);
        else if (time < options.duration * 0.12) {
          const p = { x: clamp(a.home.x + rand(-5, 5), -28, 28), z: clamp(a.home.z + rand(-5, 5), -28, 28) };
          a.roam = clearSpot(p) ? p : a.home;
        } else {
          let q = null;
          for (let k = 0; k < 12 && !q; k++) {
            const c = safePoint(Math.min(24, zone * 0.65));
            if (Math.hypot(c.x, c.z) < safeR()) q = c;
          }
          a.roam = q || inside({ x: a.x * 0.5, z: a.z * 0.5 });
        }
      }
      a.goal = a.roam;
    }
  }
  // King of the hill: unless fighting, hiding or grabbing something close by, everybody heads for the hill.
  const h = koth() ? KOTH.hill : null;
  if (h && ["explore", "loot", "hunt", "regroup"].includes(a.brain) && !(a.brain === "loot" && a.goal && dist(a, a.goal) < 5)) {
    if (!a.hillSpot || dist(a.hillSpot, h) > h.r - 1) a.hillSpot = nearPoint(h, h.r - 1.6) || { x: h.x, z: h.z };
    a.brain = "hill";
    a.goal = a.hillSpot;
  }
  if (a.goal) {
    a.path = walkClear(a, a.goal) ? [a.goal] : pathfind(a, a.goal);
    a.pathIndex = 0;
  } else {
    a.path = [];
    a.pathIndex = 0;
  }
  if (a.use <= 0 && a.reload <= 0 && !downMate && (!enemy || ed > 13) && time - a.alertT > 2) {
    if (a.hp < 55 && a.meds[1] > 0) {
      a.consumable = 1;
      useConsumable(a);
    } else if (a.hp < 80 && a.meds[0] > 0) {
      a.consumable = 0;
      useConsumable(a);
    } else if (a.armor < 45 && a.meds[2] > 0) {
      a.consumable = 2;
      useConsumable(a);
    }
  }
}
// One step of a hero: timers, gravity and the zone for everyone; then either a human command
// (the local hero's input, or a remote player's command on the host / a predicted one on a client) or the bot brain.
function updateActor(a, dt, cmd) {
  a.moving = false;
  a.cd = Math.max(0, a.cd - dt);
  a.roll = Math.max(0, a.roll - dt);
  a.inv = Math.max(0, a.inv - dt);
  a.stun = Math.max(0, a.stun - dt);
  a.animation = Math.max(0, a.animation - dt);
  a.gadgetCd = Math.max(0, a.gadgetCd - dt);
  if (a.reload > 0) {
    a.reload -= dt;
    if (a.reload <= 0) a.slots[a.slot].ammo = weapons[a.slots[a.slot].id].cap;
  }
  // Duos: a downed hero bleeds out unless the teammate helps it up in time.
  if (a.down && !net.client) {
    a.hp -= (DOWN_HP / BLEED_S) * dt;
    if (a.hp <= 0) {
      knockOut(a, a.downBy, "bleed");
      return;
    }
  }
  if (a.use > 0) {
    const reviving = a.useType === REVIVE_USE;
    // Helping a teammate up stops when it is out of reach or no longer down.
    if (reviving && !net.client && !reviveOk(a)) a.use = 0;
    else {
      a.use -= dt;
      if (a.use <= 0 && !net.client) {
        if (reviving) finishRevive(a, actorById(a.reviveId));
        else {
          const s = consumables[a.useType],
            gained = Math.min(100, a.hp + (s.hp || 0)) - a.hp;
          a.meds[a.useType]--;
          a.hp = Math.min(100, a.hp + (s.hp || 0));
          a.armor = Math.min(75, a.armor + (s.armor || 0));
          if (isHuman(a)) hfx(a, { e: "healed", t: a.useType, gained });
        }
      }
    }
  }
  if (a.burst > 0) {
    a.burstTimer -= dt;
    if (a.burstTimer <= 0) {
      a.burstTimer = 0.09;
      a.burst--;
      emitProjectile(a, a.angle, a.aimSlope || 0);
    }
  }
  if (!a.landed) {
    a.vy = -2.4;
  } else a.vy -= (a.vy > 0 ? 18 : 26) * dt * gravityK();
  const previousY = a.y;
  let nextY = a.y + a.vy * dt,
    support = 0;
  for (const o of obstacles) if (dist(a, o) < o.r - 0.12 && previousY >= o.h - 0.05 && nextY <= o.h) support = Math.max(support, o.h);
  a.y = Math.max(support, nextY);
  if (a.y === support) {
    if (!a.landed) {
      a.landed = true;
      burst(a.x, a.z, "#e8dcc0", 6, a.y + 0.1, "dust", true);
    }
    if (a === player && a.vy < -10 && !net.replaying) shakeCam(Math.min(0.3, (-a.vy - 10) / 40));
    a.vy = 0;
  }
  // Bathroom: nobody keeps their footing on the soap bar, and the open drain drags heroes on the floor.
  if (options.arena === "bathroom" && a.landed) {
    if (Math.abs(a.y - SOAP.h) < 0.02 && dist(a, SOAP) < SOAP.r) {
      const d = dist(a, SOAP),
        ux = d > 0.15 ? (a.x - SOAP.x) / d : Math.sin(a.angle),
        uz = d > 0.15 ? (a.z - SOAP.z) / d : Math.cos(a.angle);
      move(a, ux * 5.5, uz * 5.5, dt);
      if (a === player && mode === "play") unlock("soap");
    }
    if (a.y < 0.6 && time % 36 > 27) drainPull(a, dt);
  }
  if (net.client);
  else if (koth());
  else if (time > options.duration) damage(a, (5 + (time - options.duration) * 0.6) * dt, null, "zone");
  else if (Math.hypot(a.x, a.z) > zone) damage(a, (6 + (time / options.duration) * 7) * dt, null, "zone");
  if (!a.alive) return;
  if (a.grapple) {
    let g = a.grapple,
      dx = g.x - a.x,
      dz = g.z - a.z;
    move(a, dx / Math.max(g.t, 0.03), dz / Math.max(g.t, 0.03), dt);
    g.t -= dt;
    if (g.t <= 0) a.grapple = null;
  }
  if (a.stun > 0) return;
  if (!a.bot) {
    const c = cmd || (a === player && !net.client ? localCmd(dt) : null);
    if (c) humanControl(a, c, dt);
  } else {
    const S = botSkill();
    a.think -= dt;
    if (a.think <= 0) {
      a.think = rand(0.4, 0.75);
      botThink(a);
    }
    a.react = Math.max(0, a.react - dt);
    a.dodgeCd = Math.max(0, a.dodgeCd - dt);
    a.jumpCd = Math.max(0, a.jumpCd - dt);
    if (a.fireT > 0) {
      a.fireT -= dt;
      if (a.fireT <= 0) a.restT = rand(...S.rest);
    } else {
      a.restT -= dt;
      if (a.restT <= 0) a.fireT = rand(...S.fire);
    }
    if (a.landed && a.roll <= 0 && a.dodgeCd <= 0 && a.use <= 0 && !a.down) {
      const th = incomingThreat(a);
      if (th) {
        a.dodgeCd = 0.7;
        if (Math.random() < Math.min(0.95, S.dodge * th.w)) botRoll(a, th.x, th.z);
      }
    }
    const speed = a.down ? 1.7 : (options.difficulty === "easy" ? 3.6 : 4.6) * (a.use > 0 ? 0.4 : 1) * speedK();
    let p = a.path[a.pathIndex];
    if (a.inv > 0 && a.rollDir && a.roll > 2.5) move(a, a.rollDir.x * 17, a.rollDir.z * 17, dt);
    else if (a.brain === "fight" && a.enemy?.alive && !p && a.use <= 0) {
      const e = a.enemy,
        d = dist(a, e) || 1,
        ux = (e.x - a.x) / d,
        uz = (e.z - a.z) / d,
        [near, far] = prefRange(a.slots[a.slot]);
      a.strafeT -= dt;
      if (a.strafeT <= 0) {
        a.strafeT = rand(0.55, 1.5);
        a.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const f = d > far ? 1 : d < near ? -0.8 : 0;
      let mx = ux * f - uz * a.strafeDir * S.strafe,
        mz = uz * f + ux * a.strafeDir * S.strafe;
      const r = Math.hypot(a.x, a.z);
      if (r > zone - 6) {
        mx -= (a.x / r) * 1.2;
        mz -= (a.z / r) * 1.2;
      }
      if (hazardAt({ x: a.x + mx, z: a.z + mz }, 1)) {
        mx = -mx;
        mz = -mz;
        a.strafeDir *= -1;
      }
      const l = Math.hypot(mx, mz);
      if (l > 0.05) {
        const ox = a.x,
          oz = a.z,
          v = speed * 0.85;
        move(a, (mx / l) * v, (mz / l) * v, dt);
        if (Math.hypot(a.x - ox, a.z - oz) < v * dt * 0.25) {
          a.strafeDir *= -1;
          a.strafeT = rand(0.4, 0.9);
        }
      }
      if (a.landed && a.vy === 0 && a.jumpCd <= 0 && Math.random() < S.jump * dt) {
        a.vy = 9.3;
        a.jumpCd = 1.4;
        sound("jump", a, { vol: 0.45 });
      }
    } else if (p) {
      let d = dist(a, p);
      if (d < 0.7) {
        a.pathIndex++;
        a.slowT = 0;
      } else {
        const ox = a.x,
          oz = a.z;
        move(a, ((p.x - a.x) / d) * speed, ((p.z - a.z) / d) * speed, dt);
        if (a.use <= 0 && Math.hypot(a.x - ox, a.z - oz) < speed * dt * 0.3) {
          a.slowT = (a.slowT || 0) + dt;
          if (a.slowT > 1.2) {
            a.slowT = 0;
            a.roam = null;
            a.path = [];
            a.think = 0;
            const t = rand(0, 6.28),
              q = { x: clamp(a.x + Math.sin(t) * 4, -29, 29), z: clamp(a.z + Math.cos(t) * 4, -29, 29) };
            if (clearSpot(q, 0.6)) {
              a.path = [q];
              a.pathIndex = 0;
              a.think = 0.9;
            }
          }
        } else a.slowT = 0;
      }
    }
    if (a.moving && a.landed && a.vy === 0) {
      a.stepT -= dt;
      if (a.stepT <= 0) {
        a.stepT = 0.36;
        if (player && dist(a, listener()) < 16) sound("step", a, { vol: 0.8, pitch: rand(0.9, 1.1) }, true);
      }
    }
    if (a.enemy?.alive && !a.down && time > Math.min(45, options.duration * 0.11)) {
      const e = a.enemy,
        d = dist(a, e),
        lead = (d / 30) * S.lead,
        tx = e.x + (e.vx || 0) * lead,
        tz = e.z + (e.vz || 0) * lead;
      a.angle = Math.atan2(tx - a.x, tz - a.z);
      a.aimY = e.y + 0.94;
      a.aimSlope = (e.y - a.y) / Math.max(1, d);
      const w = weapons[a.slots[a.slot].id];
      if (d < w.range && a.react <= 0 && (a.fireT > 0 || !w.cap) && lineOfSight(a, e) && !hiddenInSmoke(a, e)) {
        shoot(a);
        if (d > 5.5 && d < 11 && a.grenades > 0 && Math.random() < dt * S.toss) tossGrenade(a);
      }
    } else if (p) a.angle = Math.atan2(p.x - a.x, p.z - a.z);
    for (const other of actors)
      if (other !== a && other.alive && Math.abs(a.y - other.y) < 1) {
        const d = dist(a, other);
        if (d > 0.01 && d < 0.8) move(a, ((a.x - other.x) / d) * 1.8, ((a.z - other.z) / d) * 1.8, dt);
      }
    const near = nearestLoot(a);
    if (
      near &&
      ((near.type === "armor" && a.armor < 75) ||
        (near.type === "weapon" && weapons[near.id].cap && near.q > a.slots[1].q) ||
        (near.type === "consumable" && a.meds[near.id] < 3) ||
        (near.type === "grenade" && a.grenades < 3) ||
        (near.type === "gadget" && a.gadget === 0 && near.id !== 0))
    ) {
      if (near.type === "weapon") setSlot(a, 1);
      pickup(a, near);
    }
  }
}
// The local hero's input for one step, in the same shape a remote player sends over the network.
function localCmd(dt) {
  cameraYaw += ((keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0)) * dt * 1.5;
  cameraPitch = clamp(cameraPitch + ((keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0)) * dt, -0.25, 0.8);
  aim();
  const idle = paused || wheelOpen;
  return {
    dt,
    dx: idle ? 0 : (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + pad.lx,
    dz: idle ? 0 : (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0) + pad.ly,
    yaw: cameraYaw,
    ang: player.angle,
    slope: player.aimSlope || 0,
    fire: !idle && (mouse.down || pad.fire),
    acts: 0,
  };
}
// Movement relative to the camera, aim and fire of a human-controlled hero.
function humanControl(a, c, dt) {
  if (c.acts && !a.down) for (let i = 0; i < ACTS.length; i++) if (c.acts & (1 << i)) doAct(a, ACTS[i], c);
  a.angle = c.ang;
  a.aimSlope = c.slope;
  const l = Math.max(1, Math.hypot(c.dx, c.dz)),
    sy = Math.sin(c.yaw),
    cy = Math.cos(c.yaw);
  let wx = (c.dx * cy + c.dz * sy) / l,
    wz = (-c.dx * sy + c.dz * cy) / l;
  let speed = a.down ? 1.8 : (a.use > 0 ? 3.1 : 7) * (a.armor > 50 ? 0.9 : a.armor > 25 ? 0.95 : 1) * speedK();
  if (a.inv > 0 && a.rollDir && !a.down) {
    wx = a.rollDir.x;
    wz = a.rollDir.z;
    speed = 17;
  }
  move(a, wx * speed, wz * speed, dt);
  if (a.moving && a.y === 0) {
    a.stepT -= dt;
    if (a.stepT <= 0) {
      a.stepT = 0.34;
      if (a === player) sound("step", null, { pitch: rand(0.9, 1.1) });
      else if (dist(a, listener()) < 16) sound("step", a, { vol: 0.8, pitch: rand(0.9, 1.1) }, true);
    }
  }
  if (c.fire) shoot(a);
}
function aim() {
  // The reticle is fixed to the centre. Aim is a 3D ray through the shoulder camera.
  raycaster.setFromCamera(new T.Vector2(0, 0), camera);
  raycaster.far = 65;
  const targets = [...solids];
  for (const a of actors)
    if (a !== player && a.alive && !ally(player, a)) {
      const m = actorModels.get(a.id);
      if (m) targets.push(m.root);
    }
  const intersections = raycaster.intersectObjects(targets, true),
    hit = intersections.find((h) => h.object.userData.actorId !== 0 && !h.object.userData.noAim);
  aimOnEnemy = !!hit && hit.object.userData.actorId > 0;
  const point = hit ? hit.point : raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 45);
  player.angle = Math.atan2(point.x - player.x, point.z - player.z);
  const flat = Math.hypot(point.x - player.x, point.z - player.z);
  player.aimSlope = clamp((point.y - (player.y + 0.94)) / Math.max(1, flat), -1.5, 1.5);
  player.aimY = point.y;
}
function updateProjectiles(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    const n = Math.max(2, Math.ceil(dt * 100));
    for (let s = 0; s < n && b.life > 0; s++) {
      b.x += (b.dx * 30 * dt) / n;
      b.z += (b.dz * 30 * dt) / n;
      b.y += (b.dy * 30 * dt) / n;
      if (b.y < 0.03 || Math.abs(b.x) > 33 || Math.abs(b.z) > 33 || obstacles.some((o) => b.y < o.h && dist(b, o) < o.r)) {
        b.life = 0;
        burst(b.x, b.z, b.color, 3, Math.max(0.1, b.y), "spark");
        break;
      }
      for (const a of actors)
        if (a !== b.source && a.alive && !ally(a, b.source) && dist(b, a) < 0.42 && b.y > a.y + 0.05 && b.y < a.y + 1.9) {
          const head = b.y > a.y + 1.3;
          damage(a, b.dmg * (head ? b.headBonus : 1), b.source, "shot", head && b.headBonus > 1, { x: b.x - b.dx * 4, z: b.z - b.dz * 4 }, b.wid);
          b.life = 0;
          break;
        }
    }
    if (
      b.life > 0 &&
      !b.whiz &&
      b.source !== player &&
      !ally(player, b.source) &&
      player?.alive &&
      Math.hypot(b.x - player.x, b.z - player.z) < 1.8 &&
      Math.abs(b.y - player.y - 1) < 1.6
    ) {
      b.whiz = true;
      sound("whiz", b, {}, true);
    }
    if (b.life <= 0) bullets.splice(i, 1);
  }
  for (let i = grenades.length - 1; i >= 0; i--) {
    let g = grenades[i];
    g.fuse -= dt;
    g.vy -= 12 * dt;
    let nx = g.x + g.vx * dt,
      nz = g.z + g.vz * dt;
    if (obstacles.some((o) => g.y < o.h && dist({ x: nx, z: nz }, o) < o.r)) {
      g.vx *= -0.4;
      g.vz *= -0.4;
    } else {
      g.x = clamp(nx, -30.5, 30.5);
      g.z = clamp(nz, -30.5, 30.5);
    }
    g.y += g.vy * dt;
    if (g.y < 0.15) {
      g.y = 0.15;
      g.vy = Math.abs(g.vy) * 0.4;
      g.vx *= 0.8;
      g.vz *= 0.8;
    }
    if (g.fuse <= 0) {
      emit({ e: "gx", u: g.uid });
      burst(g.x, g.z, "#ffd376", 45, Math.max(0.3, g.y));
      addRing({ x: g.x, z: g.z, y: g.y, r: 4, life: 0.6, total: 0.6, color: "#ffe09b", kind: "boom" });
      for (const a of actors)
        if (a.alive && dist(a, g) < 4 && lineOfSight(a, g, 1, 0.3) && damage(a, 30, g.source, "grenade", false, { x: g.x, z: g.z })) {
          a.stun = 1;
          const d = dist(a, g) || 1;
          move(a, ((a.x - g.x) / d) * 4, ((a.z - g.z) / d) * 4, 0.15);
        }
      sound("boom", g);
      blastShake(g.x, g.z);
      grenades.splice(i, 1);
    }
  }
  for (let i = clouds.length - 1; i >= 0; i--) {
    clouds[i].life -= dt;
    if (clouds[i].life <= 0) clouds.splice(i, 1);
  }
  for (let i = traps.length - 1; i >= 0; i--) {
    let t = traps[i];
    t.life -= dt;
    const victim = actors.find((a) => a.alive && a !== t.owner && !ally(a, t.owner) && a.y < 0.5 && a.inv <= 0 && dist(a, t) < 0.75);
    if (victim) {
      damage(victim, 25, t.owner, "trap", false, { x: t.x, z: t.z });
      victim.stun = 2;
      t.life = 0;
    }
    if (t.life <= 0) {
      traps.splice(i, 1);
      emit({ e: "tr", u: t.uid });
    }
  }
}
function updateCat(dt) {
  if (!catDecided && time > options.duration * 0.28) {
    catDecided = true;
    if (Math.random() < 0.2) {
      cat = { x: -29, z: -29, angle: 0, mode: "hunt", cool: 2, target: null, pounce: null };
      announce("say.catAwake", 4, "cat");
    }
  }
  if (!cat) return;
  cat.cool -= dt;
  if (cat.mode === "warn") {
    if (cat.cool <= 0) {
      cat.mode = "pounce";
      cat.cool = 0.45;
    }
  } else if (cat.mode === "pounce") {
    let p = cat.pounce;
    cat.x += (p.x - cat.x) * Math.min(1, dt * 10);
    cat.z += (p.z - cat.z) * Math.min(1, dt * 10);
    if (cat.cool <= 0) {
      for (const a of actors)
        if (
          a.alive &&
          dist(a, cat) < 2.3 &&
          damage(a, 25, null, "cat", false, { x: cat.x - Math.sin(cat.angle) * 3, z: cat.z - Math.cos(cat.angle) * 3 })
        )
          a.stun = 0.4;
      burst(cat.x, cat.z, "#e8dcc0", 16, 0.2, "dust");
      cat.mode = "hunt";
      cat.cool = 5;
    }
  } else {
    let noisy = actors.filter((a) => a.alive && time - a.noise < 5).sort((a, b) => dist(cat, a) - dist(cat, b))[0];
    if (noisy) {
      cat.angle = Math.atan2(noisy.x - cat.x, noisy.z - cat.z);
      let d = dist(cat, noisy);
      if (d > 6) {
        cat.x += Math.sin(cat.angle) * dt * 3.6;
        cat.z += Math.cos(cat.angle) * dt * 3.6;
      } else if (cat.cool <= 0) {
        cat.mode = "warn";
        cat.cool = 1.1;
        cat.pounce = { x: noisy.x, z: noisy.z };
        sound("hiss", cat, { vol: 0.8 });
        addRing({ x: noisy.x, z: noisy.z, r: 2.3, life: 1.1, total: 1.1, color: "#ff6b4a", kind: "warn" });
        tell(noisy, "say.catPounce", [], 1.2);
      }
    }
  }
}
// ---------- robot vacuum (kids room) ----------
const VAC_LANES = [
    { h: true, c: -13 },
    { h: true, c: 13 },
    { h: false, c: -13 },
    { h: false, c: 13 },
  ],
  VAC_R = 2.3,
  VAC_END = 37,
  VAC_SPEED = 9.5;
const vacPoint = (v, s) => (v.lane.h ? { x: s, z: v.lane.c } : { x: v.lane.c, z: s });
function updateVacuum(dt, cycle, prevCycle) {
  if (prevCycle <= 23 && cycle > 23) {
    // Prefer the busiest road, so the cleaning run matters.
    const busy = VAC_LANES.map((l) => actors.filter((a) => a.alive && Math.abs((l.h ? a.z : a.x) - l.c) < 6).length + Math.random() * 1.5);
    const lane = VAC_LANES[busy.indexOf(Math.max(...busy))],
      dir = Math.random() < 0.5 ? 1 : -1;
    vacuum = { lane, dir, s: -dir * VAC_END, warn: true, active: false, hit: new Set(), humT: 0, x: 0, z: 0 };
    Object.assign(vacuum, vacPoint(vacuum, vacuum.s));
    sound("beep", vacPoint(vacuum, -dir * 29), { min: 0.4 });
  }
  if (!vacuum) return;
  if (vacuum.warn && cycle > 27) {
    vacuum.warn = false;
    vacuum.active = true;
    sound("vacuum", vacPoint(vacuum, vacuum.s * 0.8), { min: 0.35 });
  }
  if (!vacuum.active) return;
  vacuum.s += vacuum.dir * VAC_SPEED * dt;
  const v = vacuum,
    p = vacPoint(v, v.s);
  v.x = p.x;
  v.z = p.z;
  v.humT -= dt;
  if (v.humT <= 0 && Math.abs(v.s) < 33) {
    v.humT = 0.42;
    sound("hum", p, { vol: 0.8 });
  }
  for (const a of actors) {
    if (!a.alive || v.hit.has(a) || a.y > 1.25 || dist(a, p) > VAC_R + 0.45) continue;
    const off = (v.lane.h ? a.z - p.z : a.x - p.x) || 0.01,
      s = Math.sign(off),
      from = v.lane.h ? { x: p.x - v.dir * 3, z: p.z } : { x: p.x, z: p.z - v.dir * 3 };
    if (!damage(a, 20, null, "vacuum", false, from)) continue;
    v.hit.add(a);
    a.stun = Math.max(a.stun, 0.5);
    if (a.use > 0) a.use = 0;
    const nx = v.lane.h ? v.dir * 0.35 : s,
      nz = v.lane.h ? s : v.dir * 0.35;
    move(a, nx * 19, nz * 19, 0.16);
    sound("bonk", a === player ? null : a);
    burst(a.x, a.z, "#e8dcc0", 8, a.y + 0.3, "dust");
  }
  for (let i = loot.length - 1; i >= 0; i--) {
    const l = loot[i];
    if (dist(l, p) > VAC_R + 0.1) continue;
    removeLoot(l);
    burst(l.x, l.z, "#fff4dc", 7, 0.5, "dust");
    sound("suck", p, { vol: 0.8 });
  }
  if (Math.abs(v.s) > VAC_END) vacuum = null;
}
// ---------- drain whirlpool (bathroom) ----------
// For the last 9 seconds of every 36 the drain is open: the water swirls towards it and drags heroes
// standing on the floor, and its middle hurts. It also blows big soap bubbles; their paths follow the
// match clock, so every screen draws them by itself, and only the host decides which ones burst.
const DRAIN = { x: 8, z: -8, pull: 10, core: 2.3 },
  SOAP = { x: -8, z: -3, r: 2.2, h: 1.3 },
  BUBBLE_N = 7,
  BUBBLE_LIFE = 7.5;
function drainPull(a, dt) {
  const dx = DRAIN.x - a.x,
    dz = DRAIN.z - a.z,
    d = Math.hypot(dx, dz);
  if (d >= DRAIN.pull || d < 0.2) return;
  // Inwards and a little around (counter-clockwise seen from above), stronger near the middle.
  const k = 1 - d / DRAIN.pull,
    v = 1 + 3 * k,
    sw = 2.2 * k;
  move(a, (dx / d) * v - (dz / d) * sw, (dz / d) * v + (dx / d) * sw, dt);
}
function drainBubbles() {
  if (options.arena !== "bathroom" || mode === "menu") return [];
  const out = [],
    n = Math.floor(time / 36);
  for (let cy = Math.max(0, n - 1); cy <= n; cy++)
    for (let k = 0; k < BUBBLE_N; k++) {
      const t = time - (cy * 36 + 27.4 + k * 1.2),
        key = cy * 16 + k;
      if (t < 0 || t > BUBBLE_LIFE || popped.has(key)) continue;
      const a = k * 2.39996 + cy * 1.3 + 0.5 * t,
        r = 1.4 + 1.25 * t;
      out.push({ key, t, x: DRAIN.x + Math.sin(a) * r, z: DRAIN.z + Math.cos(a) * r, y: 0.75 + 0.28 * t + 0.18 * Math.sin(t * 2.6 + k), r: 0.72 + 0.12 * (k % 3) });
    }
  return out;
}
// Host: the middle of the open drain hurts and swallows loot; bubbles burst on heroes and projectiles.
function updateDrain(dt) {
  if (time % 36 > 27) {
    for (const a of actors) if (a.alive && a.y < 0.6 && dist(a, DRAIN) < DRAIN.core) damage(a, 14 * dt, null, "steam");
    for (let i = loot.length - 1; i >= 0; i--) {
      const l = loot[i];
      if (dist(l, DRAIN) > DRAIN.core + 0.3) continue;
      removeLoot(l);
      burst(l.x, l.z, "#e3f7ff", 6, 0.4, "bubble");
      sound("suck", DRAIN, { vol: 0.8 });
    }
  }
  for (const b of drainBubbles()) {
    const hit = actors.find((a) => a.alive && Math.hypot(a.x - b.x, a.z - b.z) < b.r + 0.4 && b.y - b.r < a.y + 1.8 && b.y + b.r > a.y),
      shot = hit ? null : bullets.find((s) => Math.hypot(s.x - b.x, s.z - b.z) < b.r + 0.15 && Math.abs(s.y - b.y) < b.r + 0.15);
    if (hit || shot) popBubble(b, hit, shot?.source);
  }
}
// A bubble bursting on a hero tosses it up and aside and stops its healing (or helping up).
function popBubble(b, a, by = null) {
  popped.add(b.key);
  emit({ e: "bp", k: b.key });
  if (isHuman(a || by)) hfx(a || by, { e: "pop" });
  burst(b.x, b.z, "#e3f7ff", 9, b.y, "bubble");
  sound("bubble", b, { vol: 0.9 });
  if (!a) return;
  if (a.use > 0) a.use = 0;
  if (a.landed && a.vy <= 0 && !a.down) a.vy = 7.2;
  const d = Math.hypot(a.x - b.x, a.z - b.z) || 1;
  move(a, ((a.x - b.x) / d) * 10, ((a.z - b.z) / d) * 10, 0.12);
}
// Gurgling and bubbles while the water gathers, a whirl of droplets while it drains; every screen by itself.
function drainFx(dt, cycle, prevCycle) {
  if (prevCycle <= 23 && cycle > 23) sound("gurgle", DRAIN, { min: 0.35, vol: 0.9 }, true);
  if (prevCycle <= 27 && cycle > 27) sound("whirl", DRAIN, { min: 0.3 }, true);
  else if (cycle > 27 && Math.floor(cycle / 1.6) !== Math.floor(prevCycle / 1.6)) sound("gurgle", DRAIN, { min: 0.15, vol: 0.55 }, true);
  if (!(cycle > 23.5)) return;
  const on = cycle > 27;
  if (Math.random() < dt * (on ? 24 : 7)) {
    const a = rand(0, 6.28),
      r = rand(0, on ? DRAIN.core + 1.6 : 1.3),
      life = rand(0.9, 1.7);
    particles.push({ x: DRAIN.x + Math.sin(a) * r, z: DRAIN.z + Math.cos(a) * r, y: 0.15, vx: 0, vy: rand(0.5, 1.3), vz: 0, life, max: life, size: rand(0.1, 0.26), steam: true, kind: "bubble" });
  }
  if (on)
    for (let i = 0; i < 2; i++) {
      const a = rand(0, 6.28),
        r = rand(2, DRAIN.pull - 0.5);
      particles.push({
        x: DRAIN.x + Math.sin(a) * r,
        z: DRAIN.z + Math.cos(a) * r,
        y: 0.12,
        vx: Math.cos(a) * 2.2 - Math.sin(a) * 1.2,
        vy: rand(0.8, 1.6),
        vz: -Math.sin(a) * 2.2 - Math.cos(a) * 1.2,
        life: 0.5,
        max: 0.5,
        color: "#7fd4ff",
        size: 0.09,
        kind: "water",
      });
    }
}
function updateEffects(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.y += p.vy * dt;
    p.vy -= p.steam ? 0 : 8 * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].life -= dt;
    if (rings[i].life <= 0) rings.splice(i, 1);
  }
  for (let i = balloons.length - 1; i >= 0; i--) {
    balloons[i].y += dt * 1.8;
    if (balloons[i].y > 22) balloons.splice(i, 1);
  }
  for (let i = numbers.length - 1; i >= 0; i--) {
    numbers[i].life -= dt;
    numbers[i].y += dt * 0.6;
    if (numbers[i].life <= 0) numbers.splice(i, 1);
  }
}
// Kettle steam and sprinkler water follow the match clock, so every screen draws and hears them by itself.
function hazardFx(dt, cycle, prevCycle) {
  if (options.arena === "kidsroom") return;
  if (options.arena === "bathroom") return drainFx(dt, cycle, prevCycle);
  const kitchen = options.arena === "kitchen";
  if (prevCycle <= 23 && cycle > 23) sound(kitchen ? "kettle" : "spray", kitchen ? { x: 22, z: -24 } : { x: 0, z: 0 }, { min: 0.35, vol: 0.8 }, true);
  if (prevCycle <= 27 && cycle > 27) sound(kitchen ? "hiss" : "spray", kitchen ? { x: 12, z: -24 } : { x: 0, z: 0 }, { min: 0.3 }, true);
  if (!(cycle > 27)) return;
  if (kitchen) {
    if (Math.random() < dt * 16)
      particles.push({
        x: rand(8, 17),
        z: rand(-27, -21),
        y: rand(0.5, 3),
        vx: -1,
        vy: 2,
        vz: 0,
        life: 2,
        max: 2,
        color: "#ffffff",
        size: 0.35,
        steam: true,
        kind: "steam",
      });
  } else {
    const angle = time * 0.65;
    for (let i = 0; i < 4; i++) {
      const r = rand(1.5, 25),
        side = i % 2 ? 1 : -1;
      particles.push({
        x: Math.sin(angle) * r * side,
        z: Math.cos(angle) * r * side,
        y: rand(0.4, 1.6),
        vx: Math.sin(angle) * side * 1.5,
        vy: rand(1.5, 3.2),
        vz: Math.cos(angle) * side * 1.5,
        life: 0.6,
        max: 0.6,
        color: "#7fd4ff",
        size: 0.09,
        kind: "water",
      });
    }
  }
}
// Radius of the safe zone at match time t.
function zoneAt(t) {
  if (koth()) return 44;
  return t > options.duration ? Math.max(0.7, 3 - (t - options.duration) * 0.12) : 44 - 41 * Math.pow(clamp((t / options.duration - 0.14) / 0.86, 0, 1), 0.85);
}
function update(dt) {
  time += dt;
  zone = zoneAt(time);
  if (koth() && mode === "play") updateKoth(dt);
  if (mode === "play") updateArenaEvents();
  if (tutorial) updateTutorial(dt);
  noticeTime -= dt;
  if (noticeTime <= 0) $("notice").textContent = "";
  hurt = Math.max(0, hurt - dt * 2);
  hitFlash = Math.max(0, hitFlash - dt);
  recoil = Math.max(0, recoil - dt);
  for (const a of actors) {
    if (mode !== "play") break;
    if (!a.alive) continue;
    if (a.net && net.host) net.stepRemote(a, dt);
    else updateActor(a, dt);
  }
  if (mode !== "play") return;
  for (const a of actors) {
    const vx = (a.x - a.px) / dt,
      vz = (a.z - a.pz) / dt;
    a.vx = a.vx * 0.7 + vx * 0.3;
    a.vz = a.vz * 0.7 + vz * 0.3;
    a.px = a.x;
    a.pz = a.z;
  }
  for (const h of hurtFrom) h.life -= dt;
  if (hurtFrom.length) hurtFrom = hurtFrom.filter((h) => h.life > 0);
  updateProjectiles(dt);
  if (time > options.duration * 0.48 && !matchDrop) {
    matchDrop = true;
    addLoot(0, -2, "weapon", 9, 3);
    announce("say.supply", 5, "pickup");
  }
  const cycle = time % 36,
    prevCycle = (time - dt) % 36,
    kids = options.arena === "kidsroom";
  if (kids) {
    updateVacuum(dt, cycle, prevCycle);
    hazard = !!vacuum?.active;
  } else hazard = cycle > 27;
  hazardFx(dt, cycle, prevCycle);
  if (options.arena === "bathroom") updateDrain(dt);
  else if (hazard && !kids) {
    if (options.arena === "kitchen") {
      for (const a of actors) if (a.alive && a.x > 7 && a.x < 17 && a.z > -28 && a.z < -20) damage(a, 15 * dt, null, "steam");
    } else {
      const angle = time * 0.65;
      for (const a of actors)
        if (a.alive && Math.abs(Math.sin(Math.atan2(a.x, a.z) - angle)) < 0.12 && Math.hypot(a.x, a.z) < 26)
          damage(a, 12 * dt, null, "steam");
    }
  }
  updateCat(dt);
  updateEffects(dt);
  hudTick -= dt;
  if (hudTick <= 0) {
    updateHud();
    hudTick = 0.1;
  }
}
function clock(seconds) {
  return Math.floor(Math.max(0, seconds) / 60) + ":" + String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0");
}
function updateHud() {
  updatePresence();
  if (!player) return;
  $("alive").textContent = actors.filter((a) => a.alive).length;
  $("aliveLabel").textContent = duo() ? txt("hud.aliveTeams", teamsAlive()) : txt("hud.alive");
  // Duos: the teammate's name and health under your own.
  const mate = duo() ? mateOf(player) : null;
  $("mateBox").hidden = !mate;
  if (mate) {
    // The name may be cut short, never how the teammate is doing.
    $("mateName").textContent = mate.name;
    $("mateState").textContent = !mate.alive ? " · " + txt("hud.mateOut") : mate.down ? " · " + txt("hud.mateDown", bleedLeft(mate)) : "";
    $("mateName").style.color = mate.alive && mate.down ? "" : mate.color;
    $("mateHp").style.width = (mate.alive ? (mate.down ? (mate.hp / DOWN_HP) * 100 : mate.hp) : 0) + "%";
    $("mateArmor").style.width = (mate.alive ? (mate.armor / 75) * 100 : 0) + "%";
    $("mateBox").classList.toggle("out", !mate.alive);
    $("mateBox").classList.toggle("down", mate.alive && mate.down);
  }
  // Downed: a red screen, and how long until you bleed out.
  const downed = mode === "play" && player.alive && player.down;
  document.body.classList.toggle("downed", downed);
  $("downBox").hidden = !downed;
  if (downed) {
    $("downText").textContent = txt(mateOf(player)?.alive ? "hud.downHelp" : "hud.downAlone", bleedLeft(player));
    $("downBar").style.width = (player.hp / DOWN_HP) * 100 + "%";
  }
  $("timer").textContent = clock(options.duration - time);
  $("kothBar").hidden = !koth() || mode !== "play";
  const evOn = mode === "play" && arenaEvent && time < arenaEvent.until;
  $("eventChip").hidden = !evOn;
  if (evOn) $("eventChip").textContent = EVENT_ICONS[arenaEvent.k] + " " + txt("event.chip." + arenaEvent.k) + (arenaEvent.k === "rain" ? "" : " · " + Math.ceil(arenaEvent.until - time));
  if (koth()) kothHud();
  $("phase").textContent = txt(
    time < 4 ? "phase.drop" : time > options.duration ? "phase.sudden" : time > options.duration * 0.14 ? "phase.zone" : "phase.loot",
  );
  if (koth()) {
    $("alive").textContent = Math.floor(KOTH.score[player.team] || 0);
    $("aliveLabel").textContent = txt("koth.points");
    const holder = KOTH.holder >= 0 ? actors.find((a) => a.team === KOTH.holder) : null;
    $("phase").textContent = KOTH.contested ? txt("koth.contested") : holder ? (holder.team === player.team ? txt("koth.mine") : txt("koth.held", holder.name)) : txt("koth.free");
  }
  document.body.classList.toggle("outside", mode === "play" && player.alive && !koth() && (time > options.duration || Math.hypot(player.x, player.z) > zone));
  if (spectate) updateSpectateUI();
  $("hp").textContent = Math.ceil(player.hp);
  $("hpbar").style.width = (player.down ? (player.hp / DOWN_HP) * 100 : player.hp) + "%";
  $("armorbar").style.width = (player.armor / 75) * 100 + "%";
  $("armorLabel").textContent = txt("hud.armor", Math.ceil(player.armor));
  $("kills").textContent = txt("knockouts", kills);
  const hint = txt(lastInput === "pad" ? "hint.pad" : "hint.kb");
  if ($("hint").textContent !== hint) $("hint").textContent = hint;
  document.body.classList.toggle("lowhealth", player.hp < 30);
  $("inventory").innerHTML = player.slots
    .map(
      (it, i) =>
        `<div class="slot ${i === player.slot ? "active" : ""}"><small style="color:${qcolors[it.q]}">${i + 1} · ${qualities[it.q]}</small><b>${weapons[it.id].name}</b><span>${txt(weapons[it.id].cap ? (player.reload > 0 && i === player.slot ? "inv.reloading" : "inv.reload") : "inv.melee")}</span><strong class="ammo">${weapons[it.id].cap ? it.ammo : "∞"}</strong></div>`,
    )
    .join("");
  const ci = player.consumable;
  $("meds").textContent = "Q · " + consumables[ci].name + " × " + player.meds[ci] + "   [X]";
  $("grenades").textContent = txt("hud.poppers", player.grenades);
  $("gadget").textContent = "G · " + gadgetNames[player.gadget] + (player.gadgetCd > 0 ? " · " + txt("sec", Math.ceil(player.gadgetCd)) : "");
  $("dodge").textContent = player.roll > 0 ? txt("hud.rolling", player.roll.toFixed(1)) : txt("hud.rollReady");
  $("feed").innerHTML = feed
    .filter((f) => time - f.t < 9)
    .map((f) => "<div>" + feedText(f) + "</div>")
    .join("");
  const l = nearestLoot(player),
    key = lastInput === "pad" ? "X" : "E",
    helpUp = reviveTarget(player);
  $("interact").textContent = helpUp
    ? key + " · " + txt(player.use > 0 && player.useType === REVIVE_USE ? "hud.reviveStop" : "hud.revive", helpUp.name)
    : l && player.y < 2.5 && !player.down
      ? key + " · " + lootName(l) + (l.type === "weapon" ? txt("hud.replace", player.slot + 1) : "")
      : "";
  const ai = arenaInfo(),
    warned = options.arena === "kidsroom" ? !!vacuum?.warn : time % 36 > 23;
  $("eventBar").textContent = hazard ? ai.active : cat?.mode === "warn" ? txt("hud.catWarn") : warned ? ai.warn : "";
  canvas.dataset.state = JSON.stringify(window.miniBitva?.getState() || {});
  $("mapLabel").textContent = ai.label;
  $("useProgress").style.display = player.use > 0 ? "block" : "none";
  if (player.use > 0) {
    $("useProgress").firstElementChild.style.width = (1 - player.use / player.useTotal) * 100 + "%";
    $("useProgress").lastElementChild.textContent =
      (player.useType === REVIVE_USE ? txt("hud.reviving") : consumables[player.useType].name) + " · " + txt("sec", player.use.toFixed(1));
  }
  const ctx = $("map").getContext("2d"),
    ms = mapScale;
  ctx.setTransform(ms, 0, 0, ms, 0, 0);
  ctx.clearRect(0, 0, 180, 180);
  ctx.save();
  ctx.beginPath();
  ctx.arc(90, 90, 88, 0, 7);
  ctx.clip();
  ctx.fillStyle = ai.map;
  ctx.fillRect(0, 0, 180, 180);
  ctx.translate(90, 90);
  ctx.rotate(cameraYaw);
  if (options.arena === "kidsroom") {
    // Roads of the play mat: the robot vacuum drives along them.
    ctx.fillStyle = "#8d97a8";
    for (const l of VAC_LANES) {
      if (l.h) ctx.fillRect(-80, l.c * 2.4 - 6, 160, 12);
      else ctx.fillRect(l.c * 2.4 - 6, -80, 12, 160);
    }
    if (vacuum) {
      ctx.fillStyle = vacuum.active ? "#ff5a3d55" : "#ffb13b44";
      const l = vacuum.lane;
      if (l.h) ctx.fillRect(-80, l.c * 2.4 - 8, 160, 16);
      else ctx.fillRect(l.c * 2.4 - 8, -80, 16, 160);
    }
  }
  if (options.arena === "bathroom") {
    // The drain, and the reach of its whirlpool while it gathers or pulls.
    const c = time % 36;
    if (c > 23) {
      ctx.fillStyle = c > 27 ? "#2f8fd866" : "#ffb13b44";
      ctx.beginPath();
      ctx.arc(DRAIN.x * 2.4, DRAIN.z * 2.4, DRAIN.pull * 2.4, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = "#6f8193";
    ctx.beginPath();
    ctx.arc(DRAIN.x * 2.4, DRAIN.z * 2.4, DRAIN.core * 2.4, 0, 7);
    ctx.fill();
  }
  if (koth() && KOTH.hill) {
    const h = KOTH.hill,
      mine = KOTH.holder === player.team;
    ctx.fillStyle = KOTH.contested ? "#ff5d5d88" : mine ? "#6fe38a88" : "#ffc93d88";
    ctx.strokeStyle = "#fff8d0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(h.x * 2.4, h.z * 2.4, h.r * 2.4, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
  const zr = Math.min(120, zone * 2.4);
  ctx.fillStyle = "#5b3fa066";
  ctx.beginPath();
  ctx.rect(-130, -130, 260, 260);
  ctx.moveTo(zr, 0);
  ctx.arc(0, 0, zr, Math.PI * 2, 0, true);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, zr, 0, 7);
  ctx.stroke();
  for (const o of obstacles) {
    ctx.fillStyle = ai.obst;
    ctx.beginPath();
    ctx.arc(o.x * 2.4, o.z * 2.4, o.r * 2.4, 0, 7);
    ctx.fill();
  }
  if (matchDrop)
    for (const l of loot)
      if (l.q === 3) {
        ctx.fillStyle = "#ffc93d";
        ctx.strokeStyle = "#3a2a10";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(l.x * 2.4 - 4, l.z * 2.4 - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }
  const V = listener();
  for (const a of actors)
    if (a.alive && a !== player && (a === V || ally(player, a) || time - a.noise < 2 || dist(V, a) < 8)) {
      ctx.fillStyle = ally(player, a) ? (a.down && Math.floor(worldClock * 4) % 2 ? "#ff4d4d" : "#6fe38a") : "#ff4d4d";
      ctx.strokeStyle = "#2a1020";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(a.x * 2.4, a.z * 2.4, ally(player, a) ? 4.4 : 3.2, 0, 7);
      ctx.fill();
      ctx.stroke();
    }
  if (vacuum && Math.abs(vacuum.s) < 34) {
    ctx.fillStyle = vacuum.active ? "#ff5a3d" : "#ffb13b";
    ctx.strokeStyle = "#2a1020";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(vacuum.x * 2.4, vacuum.z * 2.4, 5.5, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
  if (cat) {
    ctx.fillStyle = "#ff9f1c";
    ctx.strokeStyle = "#3a2210";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cat.x * 2.4, cat.z * 2.4, 5, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
  ctx.translate(V.x * 2.4, V.z * 2.4);
  ctx.rotate(-cameraYaw);
  ctx.fillStyle = "#ffe14d";
  ctx.strokeStyle = "#241a3a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5.5, 5.5);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5.5, 5.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#241a3a";
  ctx.beginPath();
  ctx.arc(90, 90, 87, 0, 7);
  ctx.stroke();
}
// Advances the match by real time in fixed steps. Kill cam: the first second after a knock-out plays
// in slow motion (not online, where the world must keep its pace for the other players).
function simulate(realDt) {
  frozenNow = false;
  if (hitStop > 0) {
    const used = Math.min(hitStop, realDt);
    hitStop -= used;
    if (!net.on) {
      realDt -= used;
      frozenNow = true;
      if (realDt <= 1e-6) return;
    }
  }
  let remaining = spectate && spectate.t < 1.1 && !net.on ? realDt * 0.35 : realDt;
  if (spectate) updateSpectate(realDt);
  while (remaining > 0 && mode === "play") {
    const dt = Math.min(remaining, 1 / 60);
    update(dt);
    remaining -= dt;
  }
}
function frame(now) {
  const realDt = Math.max(0, Math.min((now - last) / 1000, 0.05));
  last = now;
  if (paused && !net.on && !needsRender && freezeFrames > 3) {
    // Nothing moves while paused (an online match goes on), but the gamepad still drives the pause menu.
    pollGamepad(realDt);
    requestAnimationFrame(frame);
    return;
  }
  if (paused) freezeFrames++;
  else freezeFrames = 0;
  needsRender = false;
  frameCount++;
  fpsTime += realDt;
  if (fpsTime >= 1) {
    fps = Math.round(frameCount / fpsTime);
    frameCount = 0;
    fpsTime = 0;
    autoQuality();
  }
  pollGamepad(realDt);
  updateMouseEdgeLook(realDt);
  net.poll?.();
  if (mode === "menu") worldClock += realDt;
  else if (net.client && mode === "play") {
    worldClock += realDt;
    net.clientFrame(realDt);
  } else if (mode === "play" && (!paused || net.on)) {
    worldClock += realDt;
    simulate(realDt);
  } else if (mode === "end") {
    worldClock += realDt;
    updateEffects(realDt);
  }
  net.hostFrame?.(realDt);
  trauma = Math.max(0, trauma - realDt * 1.6);
  fovPunch *= Math.exp(-realDt * 7);
  koMarkT = Math.max(0, koMarkT - realDt);
  emoteCd = Math.max(0, emoteCd - realDt);
  if (koBannerT > 0 && (koBannerT -= realDt) <= 0) {
    $("koBanner").hidden = true;
    $("koBanner").classList.remove("show");
  }
  render(frozenNow && mode === "play" ? realDt * 0.08 : realDt);
  frozenNow = false;
  drawToasts(realDt);
  musicTick();
  updateTips(realDt);
  if (mode !== "menu") {
    const V = listener();
    $("hurt").style.opacity = String(hurt * 0.65);
    $("hitmark").style.opacity = hitFlash > 0 || koMarkT > 0 ? "1" : "0";
    $("hitmark").classList.toggle("kill", koMarkT > 0);
    // Rivals nearby and in sight; your teammate always, even far away or behind a wall.
    $("nameplates").innerHTML = actors
      .filter((a) => a !== player && a !== V && a.alive && (ally(player, a) || (dist(a, V) < 17 && lineOfSight(V, a) && !hiddenInSmoke(V, a))))
      .map((a) => {
        const p = projectWorld(a.x, a.y + 2.25, a.z),
          mine = ally(player, a),
          far = dist(a, V);
        return p.visible
          ? `<div class="nameplate${a.hp < 35 || a.down ? " low" : ""}${mine ? " ally" : ""}${a.down ? " downed" : ""}" style="left:${p.x}px;top:${p.y}px;--c:${a.color}"><span>${esc(a.name)}</span>${a.down ? `<small class="downTag">${txt(mine ? "hud.downTagMate" : "hud.downTag", bleedLeft(a))}</small>` : mine && far > 12 ? `<small>${txt("unit.m", Math.round(far))}</small>` : ""}<i><b style="width:${a.down ? (a.hp / DOWN_HP) * 100 : a.hp}%"></b>${a.armor > 0 ? `<em style="width:${(a.armor / 75) * 100}%"></em>` : ""}</i></div>`
          : "";
      })
      .join("");
    drawBubbles(V);
    const dd = $("damageDirs");
    if (dd && (hurtFrom.length || dd.firstChild))
      dd.innerHTML = hurtFrom
        .map((h) => {
          const r = relDir(h.x, h.z);
          return `<i style="transform:rotate(${Math.atan2(r.right, r.front).toFixed(3)}rad);opacity:${(Math.min(1, (h.life / h.max) * 1.8) * h.s).toFixed(2)}"></i>`;
        })
        .join("");
    $("numbers").innerHTML = numbers
      .map((n) => {
        const p = projectWorld(n.x, n.y, n.z);
        return p.visible
          ? `<span class="damageNumber ${n.head ? "crit" : ""}" style="left:${p.x}px;top:${p.y}px;opacity:${Math.min(1, n.life * 3)};transform:translate(-50%,-50%) scale(${(1 + Math.max(0, n.life - 0.6) * 3.5).toFixed(2)})">${n.text}</span>`
          : "";
      })
      .join("");
  }
  requestAnimationFrame(frame);
}
// Emote bubbles above the heads of nearby heroes (and your own); each stays the same element while it shows.
const bubbleEls = new Map();
function drawBubbles(V) {
  const box = $("emoteBubbles"),
    seen = new Set();
  for (const a of actors) {
    if (!a.alive || !a.emote || !EMOTES[a.emote.k] || worldClock - a.emote.at > (a.emote.loop ? 4 : 2.2) || (a !== player && (!V || dist(a, V) > 26))) continue;
    const p = projectWorld(a.x, a.y + 2.65, a.z);
    if (!p.visible) continue;
    const key = a.emote.k + ":" + a.emote.at;
    let el = bubbleEls.get(a.id);
    if (!el || el.dataset.key !== key) {
      el?.remove();
      el = document.createElement("div");
      el.className = "emoteBubble";
      el.textContent = EMOTES[a.emote.k].icon;
      el.dataset.key = key;
      box.appendChild(el);
      bubbleEls.set(a.id, el);
    }
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
    seen.add(a.id);
  }
  for (const [id, el] of bubbleEls)
    if (!seen.has(id)) {
      el.remove();
      bubbleEls.delete(id);
    }
}
function canMouseLook() {
  return mode === "play" && !paused && !spectate && player?.alive && !wheelOpen &&
    ["settings", "help", "wardrobe", "achievements", "online", "shop"].every(id => $(id).hidden);
}
function resetMouseLook() {
  freeMousePoint = null;
  document.body.classList.remove("mouseAiming");
}
function mouseLockFallback() {
  pointerLockPending = false;
  pointerLockBlocked = true;
  resetMouseLook();
  if (canMouseLook()) say(txt("say.freeMouse"), 5);
}
function lockMouse() {
  if (document.pointerLockElement === canvas || pointerLockPending || pointerLockBlocked) return;
  resetMouseLook();
  if (!canvas.requestPointerLock) return mouseLockFallback();
  pointerLockPending = true;
  try {
    const result = canvas.requestPointerLock();
    if (result?.catch) result.catch(mouseLockFallback);
  } catch {
    mouseLockFallback();
  }
}
function unlockMouse() {
  resetMouseLook();
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
}
function applyMouseLook(dx, dy) {
  const sens = profile.sensitivity * (mouse.right ? profile.aimSens : 1);
  cameraYaw -= dx * 0.0025 * sens;
  cameraPitch = clamp(cameraPitch + dy * 0.002 * sens * (profile.invertY ? -1 : 1), -0.25, 0.8);
  if (qaMode) {
    canvas.dataset.lookYaw = cameraYaw.toFixed(5);
    canvas.dataset.lookPitch = cameraPitch.toFixed(5);
  }
}
// Without capture the cursor has finite travel. Continue turning at the arena's edges.
function updateMouseEdgeLook(dt) {
  if (!freeMousePoint || !canMouseLook() || document.pointerLockElement === canvas || lastInput !== "kb") return;
  const r = canvas.getBoundingClientRect(), edge = 32;
  const edgeAxis = (p, min, max) => p < min + edge ? -clamp((min + edge - p) / edge, 0, 1) : p > max - edge ? clamp((p - max + edge) / edge, 0, 1) : 0;
  const x = edgeAxis(freeMousePoint.x, r.left, r.right), y = edgeAxis(freeMousePoint.y, r.top, r.bottom);
  if (x || y) applyMouseLook(x * dt * 850, y * dt * 650);
}
let pausedAt = 0;
function pauseGame() {
  needsRender = true;
  if (mode !== "play") return;
  paused = !paused;
  pausedAt = performance.now();
  keys = {};
  mouse.down = false;
  mouse.right = false;
  $("pause").hidden = !paused;
  $("pauseText").textContent = txt(net.on ? "pause.textNet" : "pause.text");
  if (paused) unlockMouse();
  else if (!spectate) lockMouse();
  updateHud();
}
function openSettings() {
  settingsFrom = mode;
  if (mode === "play" && !paused) {
    paused = true;
    $("pause").hidden = false;
    unlockMouse();
  }
  syncSettings();
  $("settings").hidden = false;
}
function syncSettings() {
  $("volume").value = Math.round(profile.volume * 100);
  $("music").value = Math.round(profile.music * 100);
  $("sensitivity").value = Math.round(profile.sensitivity * 100);
  $("aimSens").value = Math.round(profile.aimSens * 100);
  $("fov").value = profile.fov;
  $("fovValue").textContent = profile.fov + "°";
  $("quality").value = profile.quality;
  $("autoQuality").checked = profile.autoQuality;
  $("invertY").checked = profile.invertY;
  $("shake").checked = profile.shake;
  $("tips").checked = profile.tips;
  $("lang").value = LANG;
}
function readSettings() {
  profile.volume = +$("volume").value / 100;
  profile.music = +$("music").value / 100;
  profile.sensitivity = +$("sensitivity").value / 100;
  profile.aimSens = +$("aimSens").value / 100;
  profile.fov = clamp(+$("fov").value || 62, 55, 80);
  profile.quality = $("quality").value;
  profile.autoQuality = $("autoQuality").checked;
  profile.invertY = $("invertY").checked;
  profile.shake = $("shake").checked;
  profile.tips = $("tips").checked;
  $("fovValue").textContent = profile.fov + "°";
}
// Graphics quality steps down on its own if the game keeps running slowly.
let lowFps = 0;
function autoQuality() {
  if (!profile.autoQuality || qaMode || mode !== "play" || paused || document.hidden || profile.quality === "low") {
    lowFps = 0;
    return;
  }
  // Below 28 fps: well under the 30 fps some browsers cap to on battery, so throttling alone never triggers it.
  lowFps = fps < 28 ? lowFps + 1 : Math.max(0, lowFps - 1);
  if (lowFps < 6) return;
  profile.quality = profile.quality === "ultra" ? "high" : "low";
  lowFps = -10;
  saveProfile();
  say(txt("say.autoQuality", txt(profile.quality === "high" ? "q.high" : "q.low")), 4);
}
// ---------- tips for the first matches ----------
// Each tip names a text key; the gamepad variant is used when the player plays with a gamepad.
const TIPS = [
  { id: "duo", when: () => duo() && time > 2, pad: true },
  { id: "move", when: () => player.landed && time > 5, pad: true },
  { id: "fight", when: () => pickups > 0 && time > 9, pad: true },
  { id: "hurt", when: () => hurtFrom.length > 0, pad: true },
  { id: "heal", when: () => player.hp < 70 && player.use <= 0, pad: true },
  { id: "zone", when: () => time > options.duration * 0.14 },
  { id: "hazard", when: () => time > 20 && (options.arena === "kidsroom" ? !!vacuum?.warn : time % 36 > 23.5), key: () => "tip.hazard." + options.arena },
  { id: "gear", when: () => time > 45, pad: true },
];
let tipT = 0,
  tipGap = 2,
  tipCheck = 0;
function updateTips(dt) {
  const el = $("tip");
  if (tipT > 0) {
    tipT -= dt;
    if (tipT <= 0 || mode !== "play" || spectate) {
      tipT = 0;
      el.hidden = true;
    }
    return;
  }
  tipGap -= dt;
  tipCheck -= dt;
  if (!profile.tips || tutorial || mode !== "play" || paused || spectate || !player?.alive || tipGap > 0 || tipCheck > 0) return;
  tipCheck = 0.5;
  const t = TIPS.find((t) => !profile.tipsSeen[t.id] && t.when());
  if (!t) return;
  profile.tipsSeen[t.id] = 1;
  saveProfile();
  el.textContent = txt(t.key ? t.key() : "tip." + t.id + (lastInput === "pad" && t.pad ? ".pad" : ".kb"));
  el.hidden = false;
  tipT = 7;
  tipGap = 4;
}
function menu() {
  if (mode === "play" && stats?.pending) {
    stats.pending = false;
    settleMatch(false, teamsAlive());
  }
  net.onMenu?.();
  if (mode !== "menu") saveProfile();
  mode = "menu";
  paused = false;
  spectate = null;
  document.body.classList.remove("spectating");
  $("spectate").hidden = true;
  $("tip").hidden = true;
  tipT = 0;
  keys = {};
  mouse.down = false;
  mouse.right = false;
  unlockMouse();
  $("pause").hidden = true;
  $("result").hidden = true;
  $("settings").hidden = true;
  $("hud").hidden = true;
  $("matchStats").hidden = true;
  $("pauseBtn").hidden = true;
  $("menu").hidden = false;
  document.body.classList.remove("playing", "lowhealth", "outside");
  $("hurt").style.opacity = 0;
  actors = [];
  loot = [];
  menuHero = null;
  buildArena();
  menuUI();
  updatePresence();
}
function renderDaily() {
  const d = ensureDaily();
  $("daily").innerHTML = $("achDaily").innerHTML = d.q
    .map((q) => {
      const pct = Math.min(100, (q.p / q.n) * 100);
      return `<div class="quest${q.done ? " done" : ""}"><div><b>${questText(q)}</b><small>${q.done ? txt("daily.done") : "+" + txt("xp", q.xp)}</small></div><div class="qbar"><i style="width:${pct}%"></i></div><span>${Math.floor(q.p)} / ${q.n}</span></div>`;
    })
    .join("");
  const now = new Date(),
    next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  $("dailyLeft").textContent = txt("daily.left", Math.max(1, Math.ceil((next - now) / 3600000)));
}
function renderAchievements() {
  const got = ACH.filter((a) => profile.ach[a.id]).length;
  $("achCount").textContent = got + " / " + ACH.length;
  $("achTitle").textContent = got ? txt("ach.count", got, ACH.length) : txt("ach.empty");
  $("achGrid").innerHTML = ACH.map((a) => {
    const has = !!profile.ach[a.id],
      hidden = a.secret && !has,
      gift = [...HATS, ...PAINTS].find((c) => c.ach === a.id);
    if (hidden) return `<div class="achCard secret"><i>?</i><div><b>${txt("ach.secretName")}</b><small>${txt("ach.secretDesc")}</small></div></div>`;
    return `<div class="achCard${has ? " got" : ""}"><i${[...a.icon].length > 2 ? ' class="small"' : ""}>${a.icon}</i><div><b>${a.name}</b><small>${a.desc}${gift ? txt("ach.reward", gift.name) : ""}</small></div></div>`;
  }).join("");
}
function heroChoiceButtons(wardrobe = false) {
  return heroCatalog().map((h, i) => {
    const name = LANG === "en" ? h.nameEn || h.name : h.name;
    const selected = profile.hero === i;
    return `<button class="heroChoice${wardrobe ? " wardHero" : ""}${selected ? " selected" : ""}" data-hero="${i}" style="--hero-color:${esc(h.color || "#70b4dd")}" aria-label="${esc(name)}" aria-pressed="${selected}" title="${esc(name)}">${h.portrait ? `<img src="${esc(h.portrait)}" alt="" draggable="false">` : `<span class="heroNumber">${String(i + 1).padStart(2, "0")}</span>`}<small>${esc(name)}</small></button>`;
  }).join("");
}
function selectHero(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 10) return;
  profile.hero = index;
  saveProfile();
  menuUI();
  if (!$("wardrobe").hidden) renderWardrobe();
  if (typeof refreshMenuHero === "function") refreshMenuHero();
}
function renderWardrobe() {
  $("wardSkins").innerHTML = heroChoiceButtons(true);
  $("wardHats").innerHTML = "";
  $("wardPaints").innerHTML = "";
  for (const b of $("wardSkins").querySelectorAll("button[data-hero]"))
    b.onclick = () => selectHero(+b.dataset.hero);
}
function menuUI() {
  if (!owned(HATS[profile.hat] || HATS[0])) profile.hat = 0;
  if (!owned(PAINTS[profile.paint] || PAINTS[0])) profile.paint = 0;
  renderDaily();
  renderAchievements();
  $("best").textContent = profile.games ? txt("menu.record", profile.games, profile.wins, profile.kills) : txt("menu.slogan");
  $("level").textContent = txt("menu.level", txt(level() < 5 ? "rank.1" : level() < 15 ? "rank.2" : "rank.3"), level());
  $("xpBar").style.width = (profile.xp % 300) / 3 + "%";
  $("xpText").textContent = txt("menu.xp", profile.xp % 300);
  $("coinCount").textContent = coins();
  renderProgressChips();
  $("swatches").innerHTML = heroChoiceButtons();
  for (const b of $("swatches").querySelectorAll("button[data-hero]"))
    b.onclick = () => selectHero(+b.dataset.hero);
}
function begin() {
  if (net.on) return net.begin();
  newGame();
  menuHero = null;
  tipT = 0;
  tipGap = 2;
  $("tip").hidden = true;
  if (lastInput !== "pad") lockMouse();
}
$("start").onclick = begin;
$("specPrev").onclick = () => specNext(-1);
$("specNext").onclick = () => specNext(1);
$("specResult").onclick = () => endSpectate();
$("again").onclick = begin;
$("home").onclick = menu;
$("leave").onclick = menu;
$("pauseBtn").onclick = pauseGame;
$("resume").onclick = pauseGame;
$("settingsBtn").onclick = openSettings;
$("pauseSettings").onclick = openSettings;
for (const id of ["volume", "music", "sensitivity", "aimSens", "fov", "quality", "autoQuality", "invertY", "shake", "tips"])
  $(id).oninput = $(id).onchange = () => {
    readSettings();
    needsRender = true;
  };
$("closeSettings").onclick = () => {
  needsRender = true;
  readSettings();
  saveProfile();
  $("settings").hidden = true;
  if (mode === "menu") menuUI();
};
$("helpBtn").onclick = () => ($("help").hidden = false);
$("achBtn").onclick = $("achBtn2").onclick = () => {
  renderDaily();
  renderAchievements();
  $("achievements").hidden = false;
};
$("closeAch").onclick = () => ($("achievements").hidden = true);
$("wardrobeBtn").onclick = $("wardrobeBtn2").onclick = () => {
  renderWardrobe();
  $("wardrobe").hidden = false;
};
$("closeWardrobe").onclick = () => ($("wardrobe").hidden = true);
$("emoteWheel").onclick = (e) => {
  if (e.target === $("emoteWheel")) closeWheel();
};
$("shopBtn").onclick = $("shopBtn2").onclick = () => {
  renderShop();
  $("shop").hidden = false;
};
// The season pass screen and the league line in the menu.
function renderProgressChips() {
  const step = passStep(),
    stars = profile.season === SEASON.id ? profile.stars || 0 : 0,
    lg = leagueOf(profile.rp || 0),
    next = LEAGUES[LEAGUES.indexOf(lg) + 1];
  $("passStep").textContent = txt("pass.step", step, SEASON.steps);
  $("passBar").style.width = (step >= SEASON.steps ? 100 : ((stars % SEASON.per) / SEASON.per) * 100) + "%";
  $("leagueIcon").textContent = lg.icon;
  $("leagueName").textContent = txt("league." + lg.id);
  $("leagueLabel").textContent = txt("side.league") + " · " + (profile.rp || 0);
  $("leagueBar").style.width = (next ? ((profile.rp - lg.min) / (next.min - lg.min)) * 100 : 100) + "%";
}
function renderSeason() {
  const step = passStep(),
    stars = profile.season === SEASON.id ? profile.stars || 0 : 0;
  $("seasonStars").textContent = txt("pass.stars", stars, Math.min(SEASON.steps * SEASON.per, (step + 1) * SEASON.per));
  $("seasonGrid").innerHTML = PASS_REWARDS.map(
    (r) =>
      `<div class="passStep${r.step <= step ? " got" : ""}${r.step === step + 1 ? " next" : ""}${r.key ? " item" : ""}"><small>${r.step}</small><i>${rewardIcon(r)}</i><b>${esc(rewardName(r))}</b></div>`,
  ).join("");
  const lg = leagueOf(profile.rp || 0);
  $("seasonLeague").innerHTML = LEAGUES.map((l) => `<span class="${l === lg ? "on" : profile.rp >= l.min ? "past" : ""}">${l.icon}<small>${txt("league." + l.id)}</small><em>${l.min}</em></span>`).join("");
}
$("passBtn").onclick = () => {
  renderSeason();
  $("season").hidden = false;
};
$("closeSeason").onclick = () => {
  $("season").hidden = true;
};
$("closeShop").onclick = () => {
  $("shop").hidden = true;
  const a = menuHero?.actor;
  if (a) a.trail = trailIndex(profile.trail);
  menuUI();
};
for (const b of $("shopTabs").querySelectorAll("[data-tab]"))
  b.onclick = () => {
    shopTab = b.dataset.tab;
    renderShop();
  };
$("closeHelp").onclick = () => ($("help").hidden = true);
$("fullscreen").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
};
$("night").onchange = () => {
  options.night = $("night").checked;
  menu();
};
for (const b of document.querySelectorAll("[data-arena]"))
  b.onclick = () => {
    options.arena = b.dataset.arena;
    document.querySelectorAll("[data-arena]").forEach((x) => x.classList.toggle("selected", x === b));
    menu();
  };
window.addEventListener("keydown", (e) => {
  if (wheelOpen) {
    const list = ownedEmotes(),
      d = /^(Digit|Numpad)(\d)$/.exec(e.code);
    if (e.code === "Escape" || e.code === "KeyT") closeWheel();
    else if (d) closeWheel(list[(+d[2] + 9) % 10] ?? -1);
    e.preventDefault();
    return;
  }
  if (e.code === "KeyT" && !e.repeat && mode === "play" && !paused && !spectate) {
    openWheel();
    return;
  }
  if (e.code === "Escape") {
    if (!$("settings").hidden) {
      $("closeSettings").click();
      return;
    }
    for (const id of ["help", "wardrobe", "achievements", "shop", "season"])
      if (!$(id).hidden) {
        $(id).hidden = true;
        return;
      }
    if (mode === "play" && (!paused || performance.now() - pausedAt > 350)) pauseGame();
    return;
  }
  if (mode !== "play" || paused) return;
  if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
  if (spectate) {
    if (e.repeat) return;
    if (["ArrowLeft", "KeyA", "KeyQ"].includes(e.code)) specNext(-1);
    else if (["ArrowRight", "KeyD", "KeyE"].includes(e.code)) specNext(1);
    else if (["Enter", "Space", "NumpadEnter"].includes(e.code)) endSpectate();
    return;
  }
  keys[e.code] = true;
  lastInput = "kb";
  if (e.repeat) return;
  const map = {
    Space: "jump",
    ShiftLeft: "roll",
    ShiftRight: "roll",
    Digit1: "slot0",
    Digit2: "slot1",
    KeyR: "reload",
    KeyE: "pickup",
    KeyQ: "heal",
    KeyX: "cycleHeal",
    KeyF: "grenade",
    KeyG: "gadget",
  };
  if (map[e.code]) act(map[e.code]);
});
// Every hero action, shared by the keyboard and the gamepad. Actions travel inside commands as bits of ACTS.
const ACTS = ["jump", "roll", "slot0", "slot1", "swap", "reload", "pickup", "pickupOrReload", "heal", "cycleHeal", "grenade", "gadget"];
function act(name) {
  if (mode !== "play" || paused || spectate || !player?.alive || player.down) return;
  if (net.client) return net.queueAct(name);
  doAct(player, name, {
    dx: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + pad.lx,
    dz: (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0) + pad.ly,
    yaw: cameraYaw,
  });
}
// c carries the move input and camera yaw (the roll goes where the hero is running, or forward).
// A client predicts only its own movement, jumps, rolls, weapon slots and reloads; the host decides the rest.
function doAct(p, name, c) {
  if (p.down) return;
  if (name === "jump") {
    if (p.vy === 0 && p.landed && p.stun <= 0) {
      p.vy = 9.3;
      sound("jump", p === player ? null : p, {}, [p]);
    }
  } else if (name === "roll") {
    if (p.roll <= 0 && p.use <= 0 && p.landed && p.stun <= 0) {
      p.roll = 3;
      if (p === player) fovPunch += 2.5;
      p.inv = 0.32;
      let dx = c.dx,
        dz = c.dz;
      if (Math.hypot(dx, dz) < 0.2) {
        dx = 0;
        dz = -1;
      }
      const l = Math.hypot(dx, dz);
      p.rollDir = {
        x: (dx * Math.cos(c.yaw) + dz * Math.sin(c.yaw)) / l,
        z: (-dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw)) / l,
      };
      if (p === player && !net.replaying) {
        sound("roll");
        stats.rolls++;
        questEvent("roll");
        if (stats.rolls >= 15) unlock("roller");
      }
    }
  } else if (name === "slot0" || name === "slot1") setSlot(p, name === "slot0" ? 0 : 1);
  else if (name === "swap") setSlot(p, 1 - p.slot);
  else if (name === "reload") reload(p);
  else if (name === "pickup" || name === "pickupOrReload") {
    // Next to a downed teammate the same button helps it up (and stops helping when pressed again).
    const m = reviveTarget(p);
    if (p.use > 0 && p.useType === REVIVE_USE) {
      if (!net.client) p.use = 0;
    } else if (m) {
      if (!net.client) startRevive(p, m);
    } else if (name === "pickup") {
      if (!net.client) pickup(p, nearestLoot(p));
    } else {
      const l = nearestLoot(p);
      if (l && p.y < 2.5) {
        if (!net.client) pickup(p, l);
      } else reload(p);
    }
  } else if (name === "heal") {
    if (!net.client) useConsumable(p);
  } else if (name === "cycleHeal") {
    if (p.use <= 0) p.consumable = (p.consumable + 1) % 3;
  } else if (name === "grenade") {
    if (!net.client) tossGrenade(p);
  } else if (name === "gadget") {
    if (!net.client) useGadget(p);
  }
}
// ---------- gamepad (standard layout) ----------
const pad = { on: false, lx: 0, ly: 0, rx: 0, ry: 0, fire: false, aim: false, prev: [] };
let lastInput = window.native?.steam?.deck ? "pad" : "kb",
  aimOnEnemy = false;
const deadzone = (x, y, d = 0.18) => {
  const m = Math.hypot(x, y);
  if (m < d) return [0, 0];
  const k = Math.min(1, (m - d) / (1 - d)) / m;
  return [x * k, y * k];
};
function pollGamepad(dt) {
  const list = navigator.getGamepads ? Array.from(navigator.getGamepads() || []) : [],
    gp = list.find((g) => g && g.connected && g.buttons.length >= 12);
  if (!gp) {
    if (pad.on) {
      pad.on = false;
      Object.assign(pad, { lx: 0, ly: 0, rx: 0, ry: 0, fire: false, aim: false });
      if (lastInput === "pad") lastInput = "kb";
    }
    return;
  }
  if (!pad.on) {
    pad.on = true;
    toast(txt("toastPad"), "info");
  }
  const down = (i) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5),
    pressed = (i) => down(i) && !pad.prev[i];
  [pad.lx, pad.ly] = deadzone(gp.axes[0] || 0, gp.axes[1] || 0);
  [pad.rx, pad.ry] = deadzone(gp.axes[2] || 0, gp.axes[3] || 0, 0.14);
  pad.fire = (gp.buttons[7]?.value || 0) > 0.3;
  pad.aim = (gp.buttons[6]?.value || 0) > 0.3;
  const any = pad.fire || pad.aim || pad.lx || pad.ly || pad.rx || pad.ry || gp.buttons.some((b, i) => i < 16 && b.pressed);
  if (any) lastInput = "pad";
  // Menus, dialogs, the pause menu and the results: a highlight to move around (see padMenu).
  // A press that starts a match or closes the pause menu is not also used in the match.
  const layer = navLayer(),
    was = mode,
    wasPaused = paused;
  if (layer) padMenu(layer, gp, pressed, dt);
  else {
    if (navEl) navShow(null);
    document.body.classList.remove("padNav");
  }
  if (was === "play" && mode === "play") {
    if (pressed(9)) {
      if (!$("settings").hidden) $("closeSettings").click();
      pauseGame();
    } else if (wasPaused || paused) {
      // The pause menu is handled by padMenu.
    } else if (spectate) {
      if (pressed(4) || pressed(14)) specNext(-1);
      if (pressed(5) || pressed(15)) specNext(1);
      if (pressed(0) || pressed(8)) endSpectate();
    } else {
      const acts = { 0: "jump", 1: "roll", 2: "pickupOrReload", 3: "swap", 4: "grenade", 5: "gadget", 12: "heal", 13: "reload", 14: "cycleHeal", 15: "cycleHeal" };
      if (wheelOpen) {
        // The emote wheel: the left stick points at an emote, A plays it, B or View closes the wheel.
        const list = ownedEmotes();
        if (Math.hypot(pad.lx, pad.ly) > 0.5 && list.length) {
          const j = Math.round(((Math.atan2(pad.ly, pad.lx) + Math.PI / 2) / (Math.PI * 2)) * list.length + list.length * 2) % list.length;
          if (wheelPick !== list[j]) {
            wheelPick = list[j];
            renderWheel();
          }
        }
        if (pressed(0)) closeWheel(wheelPick);
        else if (pressed(1) || pressed(8)) closeWheel();
      } else if (pressed(8)) openWheel();
      else for (const [i, name] of Object.entries(acts)) if (pressed(+i)) act(name);
      // Right stick turns the camera; it slows down a little over an enemy to help aiming.
      const sens = profile.sensitivity * (pad.aim ? profile.aimSens : 1) * (aimOnEnemy ? 0.5 : 1);
      cameraYaw -= pad.rx * dt * 2.9 * sens;
      cameraPitch = clamp(cameraPitch + pad.ry * dt * 1.9 * sens * (profile.invertY ? -1 : 1), -0.25, 0.8);
    }
  }
  pad.prev = gp.buttons.map((b) => b.pressed || b.value > 0.5);
}
// ---------- gamepad in menus and dialogs ----------
// A highlight moves between the buttons and fields of whatever is open: the D-pad or the left stick moves it,
// A presses, B goes back, left and right change a list or a slider, the right stick scrolls.
const NAV_DIALOGS = ["online", "settings", "help", "wardrobe", "achievements", "shop", "season"],
  NAV_BACK = { online: "closeOnline", settings: "closeSettings", help: "closeHelp", wardrobe: "closeWardrobe", achievements: "closeAch", shop: "closeShop", season: "closeSeason", pause: "resume", result: "home" },
  NAV_FIRST = { menu: "start", pause: "resume", result: "again", help: "closeHelp", achievements: "closeAch", online: "netCreate", season: "closeSeason" },
  NAV_SEL = "button:not([disabled]),select:not([disabled]),input:not([disabled])",
  navMemo = {};
let navEl = null,
  navLayerNow = "",
  navHeld = "",
  navT = 0;
function navLayer() {
  const d = NAV_DIALOGS.find((id) => !$(id).hidden);
  if (d) return d;
  if (mode === "play") return paused ? "pause" : "";
  return mode === "end" ? "result" : mode === "menu" ? "menu" : "";
}
function navItems(layer) {
  const roots = layer === "menu" ? [document.querySelector?.("header .headerActions"), $("menu")] : [$(layer)],
    out = [];
  for (const r of roots)
    for (const e of r?.querySelectorAll?.(NAV_SEL) || []) {
      const b = e.getBoundingClientRect();
      if (b.width > 1 && b.height > 1 && !e.closest("[hidden]")) out.push(e);
    }
  return out;
}
function navShow(e) {
  navEl?.classList.remove("padFocus");
  navEl = e || null;
  if (!navEl) return;
  navEl.classList.add("padFocus");
  // Text fields get the focus (and the Steam Deck keyboard) only when pressed.
  if (navEl.type !== "text") navEl.focus?.({ preventScroll: true });
  else if (document.activeElement && document.activeElement !== navEl) document.activeElement.blur?.();
  navEl.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}
// The nearest item in the pushed direction; items sharing the row (or column) come first.
function navMove(items, dx, dy) {
  if (!navEl || !items.includes(navEl)) return navShow(items[0]), true;
  const a = navEl.getBoundingClientRect(),
    ax = a.left + a.width / 2,
    ay = a.top + a.height / 2;
  let best = null,
    bs = Infinity;
  for (const e of items) {
    if (e === navEl) continue;
    const b = e.getBoundingClientRect(),
      ahead = dx ? (b.left + b.width / 2 - ax) * dx : (b.top + b.height / 2 - ay) * dy;
    if (ahead <= 2) continue;
    const gap = Math.max(0, dx ? (dx > 0 ? b.left - a.right : a.left - b.right) : dy > 0 ? b.top - a.bottom : a.top - b.bottom),
      off = Math.max(0, dx ? Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom) : Math.max(a.left, b.left) - Math.min(a.right, b.right)),
      score = gap + off * 3 + ahead * 0.05;
    if (score < bs) {
      bs = score;
      best = e;
    }
  }
  if (best) {
    navShow(best);
    sound("uiHover");
  }
  return !!best;
}
// Left and right change a list or a slider in place.
function navAdjust(e, dir, wrap = false) {
  if (e.tagName === "SELECT") {
    const n = e.options.length;
    let i = e.selectedIndex + dir;
    if (wrap) i = (i + n) % n;
    if (i < 0 || i >= n || i === e.selectedIndex) return true;
    e.selectedIndex = i;
  } else if (e.type === "range") {
    const min = e.min === "" ? 0 : +e.min,
      max = e.max === "" ? 100 : +e.max,
      v = clamp(+e.value + dir * Math.max(+e.step || 0, (max - min) / 20), min, max);
    if (v === +e.value) return true;
    e.value = v;
    e.dispatchEvent(new Event("input", { bubbles: true }));
  } else return false;
  e.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
function navActivate(e) {
  if (e.tagName === "SELECT") return navAdjust(e, 1, true);
  if (e.type === "range") return;
  if (e.type === "text") {
    if (document.activeElement === e) deckKeyboard(e);
    else e.focus();
    return;
  }
  e.click();
}
function navStep(layer, items, dir) {
  const dx = dir === "l" ? -1 : dir === "r" ? 1 : 0,
    dy = dir === "u" ? -1 : dir === "d" ? 1 : 0;
  if (dx && navEl && items.includes(navEl) && navAdjust(navEl, dx)) return;
  // Nothing further that way: scroll a long dialog instead.
  if (!navMove(items, dx, dy) && dy) navScroll(layer, dy * 140);
}
function navScroll(layer, by) {
  if (layer === "menu") return;
  for (const el of [$(layer), $(layer).querySelector?.(".dialog")]) if (el) el.scrollTop += by;
}
function padMenu(layer, gp, pressed, dt) {
  const items = navItems(layer);
  if (layer !== navLayerNow || (navEl && !items.includes(navEl))) {
    if (navLayerNow && navEl) navMemo[navLayerNow] = navEl;
    navLayerNow = layer;
    const back = navMemo[layer],
      first = $(NAV_FIRST[layer]);
    navShow(back && items.includes(back) ? back : first && items.includes(first) ? first : items[0]);
    $("padHint").textContent = txt(layer === "menu" ? "pad.hint" : "pad.hintShort");
  }
  document.body.classList.toggle("padNav", lastInput === "pad");
  const sx = gp.axes[0] || 0,
    sy = gp.axes[1] || 0,
    b = (i) => !!gp.buttons[i]?.pressed,
    dir = b(12) || sy < -0.55 ? "u" : b(13) || sy > 0.55 ? "d" : b(14) || sx < -0.55 ? "l" : b(15) || sx > 0.55 ? "r" : "";
  if (dir !== navHeld) {
    navHeld = dir;
    navT = 0.4;
    if (dir) navStep(layer, items, dir);
  } else if (dir && (navT -= dt) <= 0) {
    navT = 0.12;
    navStep(layer, items, dir);
  }
  const ry = gp.axes[3] || 0;
  if (Math.abs(ry) > 0.25) navScroll(layer, ry * dt * 900);
  if (pressed(0) && navEl) navActivate(navEl);
  else if (pressed(1)) {
    const back = $(NAV_BACK[layer]);
    if (back) back.click();
  } else if (pressed(9) && (layer === "menu" || layer === "result")) begin();
  else if (layer === "menu" && (pressed(4) || pressed(5))) {
    const cards = [...document.querySelectorAll("[data-arena]")],
      i = cards.findIndex((c) => c.dataset.arena === options.arena);
    cards[(i + (pressed(5) ? 1 : cards.length - 1)) % cards.length]?.click();
  }
}
// Steam Deck: a text field brings up Steam's on-screen keyboard next to it.
function deckKeyboard(el) {
  const s = window.native?.steam;
  if (!s?.deck || !s.keyboard || !el?.getBoundingClientRect) return;
  const r = el.getBoundingClientRect(),
    k = window.devicePixelRatio || 1;
  Promise.resolve(s.keyboard({ mode: el.id === "netCodeInput" ? 3 : 0, x: r.left * k, y: r.top * k, w: r.width * k, h: r.height * k })).catch(() => {});
}
for (const el of document.querySelectorAll('input[type="text"]')) el.addEventListener("focus", () => deckKeyboard(el));
// Moving the mouse hides the gamepad highlight until the gamepad is used again.
window.addEventListener("mousemove", () => {
  if (mode !== "play" || paused) {
    if (lastInput === "pad") lastInput = "kb";
    document.body.classList.remove("padNav");
  }
});
window.addEventListener("gamepadconnected", () => {
  needsRender = true;
});
window.addEventListener("resize", () => (needsRender = true));
window.addEventListener("keyup", (e) => (keys[e.code] = false));
canvas.addEventListener("mouseenter", (e) => {
  resetMouseLook();
  if (canMouseLook() && document.pointerLockElement !== canvas) freeMousePoint = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("mouseleave", () => {
  if (document.pointerLockElement !== canvas) resetMouseLook();
});
window.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  const locked = document.pointerLockElement === canvas;
  if (!canMouseLook() || (!locked && e.target !== canvas)) return resetMouseLook();
  lastInput = "kb";
  document.body.classList.add("mouseAiming");
  if (qaMode) canvas.dataset.lookButtons = String(e.buttons || 0);
  if (locked) {
    freeMousePoint = null;
    applyMouseLook(e.movementX || 0, e.movementY || 0);
  } else {
    const previous = freeMousePoint;
    freeMousePoint = { x: e.clientX, y: e.clientY };
    if (previous) applyMouseLook(e.clientX - previous.x, e.clientY - previous.y);
  }
});
canvas.addEventListener("mousedown", (e) => {
  if (mode !== "play" || paused) return;
  if (spectate) {
    if (e.button === 0) specNext(1);
    return;
  }
  if (e.button === 0) {
    mouse.down = true;
    if (document.pointerLockElement !== canvas) lockMouse();
  }
  if (e.button === 2) mouse.right = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouse.down = false;
  if (e.button === 2) mouse.right = false;
});
canvas.addEventListener(
  "wheel",
  (e) => {
    if (mode === "play") {
      e.preventDefault();
      cameraDist = clamp(cameraDist + e.deltaY * 0.004, 3.5, 7);
    }
  },
  { passive: false },
);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("blur", () => {
  resetMouseLook();
  keys = {};
  mouse.down = false;
  mouse.right = false;
  if (mode === "play" && !paused) pauseGame();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && mode === "play" && !paused) pauseGame();
});
document.addEventListener("pointerlockchange", () => {
  const wasLocked = pointerLockActive;
  pointerLockActive = document.pointerLockElement === canvas;
  pointerLockPending = false;
  if (pointerLockActive) pointerLockBlocked = false;
  resetMouseLook();
  if (wasLocked && !pointerLockActive && mode === "play" && !paused && !spectate) pauseGame();
});
document.addEventListener("pointerlockerror", mouseLockFallback);
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  if (mode === "play" && !paused) pauseGame();
  $("fatalText").textContent = txt("fatal.lost");
  $("fatal").hidden = false;
});
window.miniBitva = {
  getState: () => ({
    mode,
    paused,
    time,
    zone,
    alive: actors.filter((a) => a.alive).length,
    teamMode: options.mode,
    teams: teamsAlive(),
    hp: player?.hp,
    armor: player?.armor,
    ammo: player?.slots[player.slot].ammo,
    loot: loot.length,
    arena: options.arena,
    night: options.night,
    vacuum: vacuum ? { x: vacuum.x, z: vacuum.z, active: vacuum.active, lane: vacuum.lane } : null,
    view: "third-person",
    hero: player?.hero ?? profile.hero,
    heroModelsReady: window.MiniHeroes?.loaded === 10,
    heroRoster: actors.map((a) => ({ id: a.id, hero: a.hero })),
    fps,
    spawns: actors.map((a) => ({ id: a.id, x: Math.round(a.home.x), z: Math.round(a.home.z) })),
    position: player ? { x: player.x, y: player.y, z: player.z } : null,
  }),
};
// ---------- language: the header button toggles RU / EN, the settings list picks one ----------
function setLanguage(l, save = true) {
  if (!I18N[l]) return;
  LANG = l;
  if (save) {
    profile.lang = l;
    saveProfile();
  }
  localizeTables();
  renameActors();
  applyLang();
  langUI();
  if (typeof relabelKidsTextures === "function") relabelKidsTextures();
  if (mode === "menu") menuUI();
  else {
    updateHud();
    if (mode === "end" && lastResult) renderResult(lastResult);
  }
  if (!$("wardrobe").hidden) renderWardrobe();
  if (!$("achievements").hidden) renderAchievements();
  if (typeof lobbyUI === "function") lobbyUI();
  needsRender = true;
}
function langUI() {
  for (const el of document.querySelectorAll("[data-arena-name]")) el.textContent = ARENAS[el.dataset.arenaName].name;
  $("lang").value = LANG;
  $("langBtn").textContent = LANG === "ru" ? "EN" : "RU";
}
$("langBtn").onclick = () => setLanguage(LANG === "ru" ? "en" : "ru");
$("lang").onchange = () => setLanguage($("lang").value);
function startGameUI() {
  langUI();
  syncSettings();
  checkProgress();
  menu();
  $("heroLoading").hidden = true;
  document.body.dataset.heroesReady = "true";
  requestAnimationFrame(frame);
}
if (window.MiniHeroes?.ready) {
  Promise.resolve(window.MiniHeroes.ready).then(startGameUI).catch((error) => {
    console.error("Hero loading failed", error);
    $("heroLoadingText").textContent = LANG === "en" ? "Could not load the heroes. Reload the game to try again." : "Не удалось загрузить героев. Перезагрузи игру, чтобы повторить попытку.";
    $("heroLoadingRetry").hidden = false;
    $("heroLoadingRetry").onclick = () => location.reload();
    document.body.dataset.heroesReady = "error";
  });
} else startGameUI();
