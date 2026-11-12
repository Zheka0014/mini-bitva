"use strict";
// ---------- online play ----------
// Up to 10 players in a lobby (over Steam, over PlayFab + WebRTC on the web, or between tabs of one browser for
// testing); bots fill the empty places.
// The host runs the whole match. Clients send their input every frame, predict their own hero with the same code
// the host runs, and draw everything else from the host's snapshots (20 a second) and events.
const PROTO = 5,
  SNAP_RATE = 20,
  INTERP = 0.1,
  MAX_PLAYERS = 10;

// ----- bytes -----
class ByteWriter {
  constructor(size = 1400) {
    this.v = new DataView(new ArrayBuffer(size));
    this.o = 0;
  }
  u8(x) {
    this.v.setUint8(this.o, x);
    this.o += 1;
  }
  i8(x) {
    this.v.setInt8(this.o, x);
    this.o += 1;
  }
  u16(x) {
    this.v.setUint16(this.o, x, true);
    this.o += 2;
  }
  i16(x) {
    this.v.setInt16(this.o, x, true);
    this.o += 2;
  }
  u32(x) {
    this.v.setUint32(this.o, x >>> 0, true);
    this.o += 4;
  }
  f32(x) {
    this.v.setFloat32(this.o, x, true);
    this.o += 4;
  }
  bytes() {
    return new Uint8Array(this.v.buffer.slice(0, this.o));
  }
}
class ByteReader {
  constructor(bytes) {
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.o = 0;
  }
  get left() {
    return this.v.byteLength - this.o;
  }
  u8() {
    return this.v.getUint8(this.o++);
  }
  i8() {
    return this.v.getInt8(this.o++);
  }
  u16() {
    const x = this.v.getUint16(this.o, true);
    this.o += 2;
    return x;
  }
  i16() {
    const x = this.v.getInt16(this.o, true);
    this.o += 2;
    return x;
  }
  u32() {
    const x = this.v.getUint32(this.o, true);
    this.o += 4;
    return x;
  }
  f32() {
    const x = this.v.getFloat32(this.o, true);
    this.o += 4;
    return x;
  }
}
const qi = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const wrapAng = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
const utf8 = new TextEncoder(),
  unutf8 = new TextDecoder();
const packJson = (o) => utf8.encode(JSON.stringify(o));

// ----- commands: what a player did during one frame -----
// A client applies exactly the rounded command it sends, so its prediction and the host agree.
function quantCmd(c) {
  return {
    seq: c.seq,
    dt: qi(c.dt * 1000, 1, 60) / 1000,
    dx: qi(c.dx * 63, -127, 127) / 63,
    dz: qi(c.dz * 63, -127, 127) / 63,
    yaw: qi(wrapAng(c.yaw) * 10000, -32767, 32767) / 10000,
    ang: qi(wrapAng(c.ang) * 10000, -32767, 32767) / 10000,
    slope: qi(c.slope * 10000, -32767, 32767) / 10000,
    fire: !!c.fire,
    acts: c.acts & 0xffff,
  };
}
function encodeCmds(list) {
  const w = new ByteWriter(8 + list.length * 12);
  w.u8(2);
  w.u32(list[0].seq);
  w.u8(list.length);
  for (const c of list) {
    w.u8(Math.round(c.dt * 1000));
    w.i8(Math.round(c.dx * 63));
    w.i8(Math.round(c.dz * 63));
    w.i16(Math.round(c.yaw * 10000));
    w.i16(Math.round(c.ang * 10000));
    w.i16(Math.round(c.slope * 10000));
    w.u8(c.fire ? 1 : 0);
    w.u16(c.acts);
  }
  return w.bytes();
}
function decodeCmds(bytes) {
  const r = new ByteReader(bytes);
  r.u8();
  const first = r.u32(),
    n = Math.min(32, r.u8()),
    out = [];
  for (let i = 0; i < n && r.left >= 12; i++)
    out.push({
      seq: first + i,
      dt: r.u8() / 1000,
      dx: r.i8() / 63,
      dz: r.i8() / 63,
      yaw: r.i16() / 10000,
      ang: r.i16() / 10000,
      slope: r.i16() / 10000,
      fire: r.u8() === 1,
      acts: r.u16(),
    });
  return out;
}

// ----- snapshots: the host's world, plus the receiving player's own hero in full detail -----
function writeWorld(w, tick) {
  w.u8(1);
  w.u32(tick);
  w.f32(time);
  w.u8((hazard ? 1 : 0) | (cat ? 4 : 0) | (vacuum ? 8 : 0));
  w.u8(actors.length);
  for (const a of actors) {
    const it = a.slots[a.slot];
    w.u8(a.id);
    w.u8((a.alive ? 1 : 0) | (a.landed ? 2 : 0) | (a.moving ? 4 : 0) | (a.stun > 0 ? 8 : 0) | (a.inv > 0 ? 16 : 0) | (a.use > 0 ? 32 : 0) | (a.bot ? 64 : 0) | (a.down ? 128 : 0));
    w.i16(qi(a.x * 100, -32768, 32767));
    w.i16(qi(a.y * 100, -32768, 32767));
    w.i16(qi(a.z * 100, -32768, 32767));
    w.i16(qi(wrapAng(a.angle) * 10000, -32767, 32767));
    w.u8(qi(Math.ceil(a.hp), 0, 255));
    w.u8(qi(Math.ceil(a.armor), 0, 255));
    w.u8(it.id * 4 + it.q);
    w.u8(a.useType || 0);
    w.u8(qi(a.roll * 80, 0, 255));
    w.u8(qi(a.animation * 1000, 0, 255));
    w.i16(qi(a.vy * 100, -32768, 32767));
    w.i8(qi((a.rollDir?.x || 0) * 100, -127, 127));
    w.i8(qi((a.rollDir?.z || 0) * 100, -127, 127));
    w.u8(qi(a.kills || 0, 0, 255));
  }
  if (cat) {
    w.u8(cat.mode === "warn" ? 1 : cat.mode === "pounce" ? 2 : 0);
    w.i16(qi(cat.x * 100, -32768, 32767));
    w.i16(qi(cat.z * 100, -32768, 32767));
    w.i16(qi(wrapAng(cat.angle) * 10000, -32767, 32767));
  }
  if (vacuum) {
    w.u8(VAC_LANES.indexOf(vacuum.lane));
    w.i8(vacuum.dir);
    w.i16(qi(vacuum.s * 100, -32768, 32767));
    w.u8((vacuum.warn ? 1 : 0) | (vacuum.active ? 2 : 0));
  }
}
function writeSelf(w, a, ack) {
  w.u8(1);
  w.u32(ack);
  for (const v of [a.x, a.y, a.z, a.vy]) w.f32(v);
  w.u8((a.landed ? 1 : 0) | (a.grapple ? 2 : 0) | (a.rollDir ? 4 : 0) | (a.down ? 8 : 0));
  for (const v of [a.roll, a.inv, a.stun, a.cd, a.reload, a.use, a.useTotal]) w.f32(v);
  w.u8(a.useType || 0);
  w.u8(a.slot);
  for (const it of a.slots) {
    w.u8(it.id);
    w.u8(it.q);
    w.u8(qi(it.ammo, 0, 255));
  }
  for (const m of a.meds) w.u8(qi(m, 0, 255));
  w.u8(a.consumable);
  w.u8(a.grenades);
  w.u8(a.gadget);
  for (const v of [a.gadgetCd, a.hp, a.armor]) w.f32(v);
  if (a.rollDir) {
    w.f32(a.rollDir.x);
    w.f32(a.rollDir.z);
  }
  if (a.grapple) {
    w.f32(a.grapple.x);
    w.f32(a.grapple.z);
    w.f32(a.grapple.t);
  }
  w.u8(a.burst);
  w.f32(a.burstTimer);
}
function readSnapshot(bytes) {
  const r = new ByteReader(bytes);
  r.u8();
  const s = { tick: r.u32(), time: r.f32(), actors: [] },
    fl = r.u8(),
    n = r.u8();
  s.hazard = !!(fl & 1);
  for (let i = 0; i < n; i++)
    s.actors.push({
      id: r.u8(),
      f: r.u8(),
      x: r.i16() / 100,
      y: r.i16() / 100,
      z: r.i16() / 100,
      ang: r.i16() / 10000,
      hp: r.u8(),
      armor: r.u8(),
      w: r.u8(),
      useType: r.u8(),
      roll: r.u8() / 80,
      anim: r.u8() / 1000,
      vy: r.i16() / 100,
      rdx: r.i8() / 100,
      rdz: r.i8() / 100,
      kills: r.u8(),
    });
  if (fl & 4) s.cat = { mode: ["hunt", "warn", "pounce"][r.u8()] || "hunt", x: r.i16() / 100, z: r.i16() / 100, angle: r.i16() / 10000 };
  if (fl & 8) s.vac = { lane: r.u8(), dir: r.i8(), s: r.i16() / 100, f: r.u8() };
  if (r.left > 0 && r.u8() === 1) {
    const o = { ack: r.u32(), x: r.f32(), y: r.f32(), z: r.f32(), vy: r.f32() },
      f = r.u8();
    o.landed = !!(f & 1);
    o.down = !!(f & 8);
    for (const k of ["roll", "inv", "stun", "cd", "reload", "use", "useTotal"]) o[k] = r.f32();
    o.useType = r.u8();
    o.slot = r.u8();
    o.slots = [0, 1].map(() => ({ id: r.u8(), q: r.u8(), ammo: r.u8() }));
    o.meds = [r.u8(), r.u8(), r.u8()];
    o.consumable = r.u8();
    o.grenades = r.u8();
    o.gadget = r.u8();
    o.gadgetCd = r.f32();
    o.hp = r.f32();
    o.armor = r.f32();
    o.rollDir = f & 4 ? { x: r.f32(), z: r.f32() } : null;
    o.grapple = f & 2 ? { x: r.f32(), z: r.f32(), t: r.f32() } : null;
    o.burst = r.u8();
    o.burstTimer = r.f32();
    s.self = o;
  }
  return s;
}

// ----- shared state -----
const N = {
  t: null, // transport
  role: null, // "host" | "client" | null
  code: "",
  nick: "",
  hostPeer: null,
  hostNick: "",
  members: [], // host: players who joined; client: the lobby as the host describes it
  live: false, // a match is running
  tick: 0,
  snapT: 0,
  forceSnap: false,
  out: [], // host: world events of this frame [event, excluded actor ids]
  over: undefined,
  // client
  me: -1,
  snaps: [],
  hist: [],
  seq: 0,
  acts: 0,
  dtAcc: 0,
  evq: [],
  offset: null,
  lastSelf: 0,
  seen: 0,
  cfg: null,
  lastKa: 0,
  lastPoll: 0,
};
const nowS = () => performance.now() / 1000;
const actBit = (name) => 1 << ACTS.indexOf(name);
function send(peer, bytes, reliable) {
  try {
    N.t?.send(peer, bytes, reliable);
  } catch (e) {
    console.warn("net send", e);
  }
}
function sendJson(peer, o) {
  send(peer, packJson(o), true);
}
function lobbyCfg() {
  return {
    arena: options.arena,
    duration: +$("duration").value || 180,
    difficulty: $("difficulty").value || "normal",
    night: $("night").checked,
    mode: ["duo", "koth"].includes($("teamMode").value) ? $("teamMode").value : "solo",
  };
}
function myLook() {
  return {
    nick: N.nick,
    color: heroColor(profile.hero),
    hero: profile.hero,
    hat: owned(HATS[profile.hat] || HATS[0]) ? profile.hat : 0,
    paint: owned(PAINTS[profile.paint] || PAINTS[0]) ? profile.paint : 0,
    trail: ownsItem("trail:" + profile.trail) ? trailIndex(profile.trail) : 0,
  };
}
function cleanNick(s) {
  return (
    String(s || "")
      .replace(/[\u0000-\u001f<>]/g, "")
      .trim()
      .slice(0, 20) || txt("net.player")
  );
}

// ----- host -----
function hostMember(peer) {
  return N.members.find((m) => m.peer === peer);
}
function lobbyState() {
  return {
    t: "lobby",
    code: N.code,
    host: N.nick,
    m: N.members.map((m) => ({ p: m.peer, n: m.nick, c: m.color })),
    cfg: N.cfg,
    live: N.live,
  };
}
function broadcastLobby() {
  N.cfg = lobbyCfg();
  const st = lobbyState();
  for (const m of N.members) sendJson(m.peer, st);
  N.t?.setData?.({ name: N.nick, count: String(N.members.length + 1), max: String(MAX_PLAYERS), v: String(PROTO), live: N.live ? "1" : "0" });
  lobbyUI();
}
function hostOnJson(peer, msg) {
  let m = hostMember(peer);
  if (msg.t === "hello") {
    if (msg.v !== PROTO) return sendJson(peer, { t: "reject", why: "version" });
    if (!m && N.members.length >= MAX_PLAYERS - 1) return sendJson(peer, { t: "reject", why: "full" });
    const look = {
      nick: cleanNick(msg.nick),
      color: /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : skinColors[0],
      hero: qi(msg.hero | 0, 0, 9),
      hat: qi(msg.hat | 0, 0, HATS.length - 1),
      paint: qi(msg.paint | 0, 0, PAINTS.length - 1),
      trail: qi(msg.trail | 0, 0, TRAILS.length - 1),
    };
    if (!m) {
      m = { peer, id: -1, inMatch: false, queue: [], lastSeq: 0, owed: 0, ack: 0, fx: [], seen: nowS() };
      N.members.push(m);
      toast(txt("net.joined", look.nick), "info");
      sound("quest");
    }
    Object.assign(m, look);
    broadcastLobby();
    if (N.live) sendJson(peer, { t: "wait" });
  } else if (!m) return;
  else if (msg.t === "bye") dropMember(m, true);
  else if (msg.t === "quit") dropFromMatch(m);
  else if (msg.t === "emote") {
    // A friend's emote: at most one a second, only for a hero still in the match.
    const a = m.inMatch ? actorById(m.id) : null,
      now = nowS();
    if (a && a.alive && !a.down && now - (m.emoteT || 0) > 0.9) {
      m.emoteT = now;
      setEmote(a, qi(msg.k | 0, 0, EMOTES.length - 1));
    }
  }
}
// A player who left the match (or the game) is replaced by a bot, so the match goes on.
function dropFromMatch(m) {
  if (!m.inMatch) return;
  m.inMatch = false;
  const a = actorById(m.id);
  if (a) {
    a.net = null;
    a.bot = true;
    a.brain = "loot";
    a.think = 0;
    a.path = [];
    a.enemy = null;
  }
}
function dropMember(m, announce = true) {
  dropFromMatch(m);
  N.members = N.members.filter((x) => x !== m);
  if (announce) toast(txt("net.left", m.nick), "info");
  broadcastLobby();
}
function hostBegin() {
  if (N.live) return;
  const roster = N.members.slice(0, MAX_PLAYERS - 1).map((m, i) => ({ id: i + 1, peer: m.peer, nick: m.nick, color: m.color, hero: m.hero, hat: m.hat, paint: m.paint, trail: m.trail }));
  newGame(roster);
  menuHero = null;
  tipT = 0;
  tipGap = 2;
  $("tip").hidden = true;
  if (lastInput !== "pad") lockMouse();
  player.nick = N.nick;
  N.tick = 0;
  N.snapT = 0;
  N.out = [];
  N.over = undefined;
  const actorList = actors.map((a) => [a.id, +a.x.toFixed(2), +a.y.toFixed(2), +a.z.toFixed(2), a.bot ? 1 : 0, a.nick || "", a.color, a.hat, a.paint, a.hero, a.trail | 0]),
    lootList = loot.map((l) => [l.uid, +l.x.toFixed(2), +l.z.toFixed(2), l.type, l.id, l.q]);
  for (const m of N.members) {
    const r = roster.find((x) => x.peer === m.peer);
    Object.assign(m, { inMatch: !!r, id: r ? r.id : -1, queue: [], lastSeq: 0, owed: 0, ack: 0, fx: [] });
    if (r) sendJson(m.peer, { t: "start", v: PROTO, o: { ...options }, you: r.id, tm: time, a: actorList, l: lootList, u: lootUid });
  }
  N.live = true;
  broadcastLobby();
}
net.applyRoster = (roster) => {
  for (const r of roster) {
    const a = actorById(r.id);
    if (!a) continue;
    Object.assign(a, { bot: false, net: r.peer, nick: r.nick, color: r.color, hero: qi(r.hero | 0, 0, 9), hat: r.hat, paint: r.paint, trail: qi(r.trail | 0, 0, TRAILS.length - 1), brain: "human" });
  }
  renameActors();
};
// Runs a remote hero on the host with the commands its player sent, never faster than real time.
net.stepRemote = (a, dt) => {
  const m = N.members.find((x) => x.inMatch && x.id === a.id);
  if (!m) return updateActor(a, dt);
  m.owed += dt;
  let n = 0;
  while (m.queue.length && m.owed > -0.05 && n++ < 12 && a.alive) {
    const c = m.queue.shift();
    updateActor(a, c.dt, c);
    m.owed -= c.dt;
    m.ack = c.seq;
  }
  // No input for a while (lag, a frozen tab): the hero stands still but stays in the world.
  if (m.owed > 0.25 && a.alive) {
    let t = m.owed - 0.1;
    while (t > 1e-4 && a.alive) {
      const step = Math.min(t, 1 / 30);
      updateActor(a, step, { dt: step, dx: 0, dz: 0, yaw: 0, ang: a.angle, slope: a.aimSlope || 0, fire: false, acts: 0 });
      t -= step;
    }
    m.owed = 0.1;
  }
};
function hostOnCmds(peer, bytes) {
  const m = hostMember(peer);
  if (!m || !m.inMatch || !N.live) return;
  for (const c of decodeCmds(bytes)) {
    if (c.seq <= m.lastSeq) continue;
    m.lastSeq = c.seq;
    if (!(c.dt > 0 && c.dt <= 0.06) || ![c.dx, c.dz, c.yaw, c.ang, c.slope].every(Number.isFinite)) continue;
    c.dx = clamp(c.dx, -2, 2);
    c.dz = clamp(c.dz, -2, 2);
    c.slope = clamp(c.slope, -1.5, 1.5);
    m.queue.push(c);
  }
  // Never more than half a second of input waiting: a client that runs ahead is corrected by its next snapshot.
  let queued = m.queue.reduce((s, c) => s + c.dt, 0);
  while (queued > 0.5 && m.queue.length) queued -= m.queue.shift().dt;
}
net.send = (ev, except) => {
  if (N.role === "host" && N.live) N.out.push([ev, except ? except.filter(Boolean).map((a) => a.id) : null]);
};
net.fx = (a, ev) => {
  if (!N.live) return;
  const m = N.members.find((x) => x.inMatch && x.id === a.id);
  if (m) m.fx.push(ev);
};
net.matchOver = (winner, early = false) => {
  if (N.role === "host" && N.live) {
    N.over = winner ? winner.id : -1;
    N.overEarly = early;
    N.forceSnap = true;
  }
};
net.hostFrame = (realDt) => {
  if (N.role !== "host" || !N.live) return;
  N.tick++;
  N.snapT += realDt;
  if (N.snapT >= 1 / SNAP_RATE || N.forceSnap) {
    N.snapT = Math.min(N.snapT - 1 / SNAP_RATE, 1 / SNAP_RATE);
    if (N.snapT < 0) N.snapT = 0;
    N.forceSnap = false;
    const w = new ByteWriter(1400);
    writeWorld(w, N.tick);
    const base = w.o;
    for (const m of N.members) {
      if (!m.inMatch) continue;
      w.o = base;
      const a = actorById(m.id);
      if (a && a.alive) writeSelf(w, a, m.ack);
      else w.u8(0);
      send(m.peer, w.bytes(), false);
    }
  }
  for (const m of N.members) {
    if (!m.inMatch) continue;
    const list = [];
    for (const [ev, ex] of N.out) if (!ex || !ex.includes(m.id)) list.push(ev);
    if (list.length || m.fx.length) {
      sendJson(m.peer, { t: "ev", tm: +time.toFixed(3), w: list, f: m.fx });
      m.fx = [];
    }
  }
  N.out = [];
  if (N.over !== undefined) {
    for (const m of N.members) if (m.inMatch) sendJson(m.peer, { t: "over", w: N.over, early: N.overEarly ? 1 : 0 });
    N.over = undefined;
    N.live = false;
    broadcastLobby();
  }
};

// ----- client -----
function clientStart(msg) {
  // Set before the heroes are made: in duos their teams come from their ids.
  Object.assign(options, { arena: msg.o.arena, duration: msg.o.duration, difficulty: msg.o.difficulty, night: !!msg.o.night, mode: ["duo", "koth"].includes(msg.o.mode) ? msg.o.mode : "solo" });
  mirrorCfg(msg.o);
  resetWorld();
  for (const [id, x, y, z, bot, nick, color, hat, paint, hero, trail] of msg.a) {
    const a = makeActor(x, z, id);
    Object.assign(a, { y, bot: !!bot, nick: nick || null, color, hero: Number.isInteger(hero) ? qi(hero, 0, 9) : id % 10, hat, paint, trail: qi(trail | 0, 0, TRAILS.length - 1), slot: 1, landed: false });
    actors.push(a);
  }
  player = actorById(msg.you) || actors[0];
  renameActors();
  for (const [uid, x, z, type, id, q] of msg.l) loot.push({ uid, x, z, type, id, q, spin: rand(0, 6.28) });
  lootUid = msg.u;
  time = msg.tm;
  zone = zoneAt(time);
  Object.assign(N, { me: player.id, snaps: [], hist: [], seq: 0, acts: 0, dtAcc: 0, evq: [], offset: null, lastSelf: 0, live: true });
  menuHero = null;
  for (const id of ["online", "wardrobe", "achievements", "help"]) $(id).hidden = true;
  enterMatch();
  tipT = 0;
  tipGap = 2;
  $("tip").hidden = true;
  // Mouse capture needs a click, so the first click on the arena takes control.
  if (lastInput !== "pad") say(txt("net.clickToPlay"), 6);
  lobbyUI();
}
net.sendEmote = (k) => {
  if (N.hostPeer && N.live) sendJson(N.hostPeer, { t: "emote", k });
};
net.queueAct = (name) => {
  N.acts |= actBit(name);
};
function onSnapshot(s) {
  const now = nowS(),
    o = s.time - now;
  if (N.offset === null || Math.abs(o - N.offset) > 0.5) N.offset = o;
  else N.offset += (o - N.offset) * 0.05;
  const S = N.snaps;
  let i = S.length;
  while (i > 0 && S[i - 1].tick > s.tick) i--;
  if (i > 0 && S[i - 1].tick === s.tick) return;
  S.splice(i, 0, s);
  if (S.length > 40) S.shift();
  reconcile(s);
}
// The host's word on the local hero, then the commands it has not seen yet are replayed on top.
function reconcile(s) {
  const a = player,
    o = s.self;
  if (!o || !a || !a.alive || spectate || s.tick <= N.lastSelf) return;
  N.lastSelf = s.tick;
  Object.assign(a, {
    x: o.x,
    y: o.y,
    z: o.z,
    vy: o.vy,
    landed: o.landed,
    down: o.down,
    roll: o.roll,
    inv: o.inv,
    stun: o.stun,
    cd: o.cd,
    reload: o.reload,
    use: o.use,
    useTotal: o.useTotal,
    useType: o.useType,
    slot: o.slot,
    slots: o.slots,
    meds: o.meds,
    consumable: o.consumable,
    grenades: o.grenades,
    gadget: o.gadget,
    gadgetCd: o.gadgetCd,
    hp: o.hp,
    armor: o.armor,
    rollDir: o.rollDir,
    grapple: o.grapple,
    burst: o.burst,
    burstTimer: o.burstTimer,
  });
  N.hist = N.hist.filter((c) => c.seq > o.ack);
  net.replaying = true;
  try {
    for (const c of N.hist) if (a.alive) updateActor(a, c.dt, c);
  } finally {
    net.replaying = false;
  }
}
// Other heroes, the cat and the vacuum are drawn a little in the past, between two snapshots.
function interpolate(t) {
  const S = N.snaps;
  if (!S.length) return;
  let j = S.findIndex((s) => s.time >= t);
  if (j < 0) j = S.length - 1;
  const B = S[j],
    A = S[Math.max(0, j - 1)],
    f = B.time > A.time ? clamp((t - A.time) / (B.time - A.time), 0, 1) : 1,
    near = f < 0.5 ? A : B,
    prev = new Map(A.actors.map((x) => [x.id, x])),
    predicted = player && player.alive && !spectate;
  const lerpAng = (a, b) => a + wrapAng(b - a) * f;
  for (const b of B.actors) {
    const a = actorById(b.id);
    if (!a) continue;
    const pa = prev.get(b.id) || b,
      nb = near.actors.find((x) => x.id === b.id) || b;
    if (a === player && predicted) {
      a.kills = b.kills;
      // Snapshots from just before a comeback (king of the hill) still show the hero out.
      if (!(nb.f & 1) && !(a.backT > t)) a.alive = false;
      continue;
    }
    const ox = a.x,
      oz = a.z,
      wasLanded = a.landed;
    a.x = pa.x + (b.x - pa.x) * f;
    a.y = pa.y + (b.y - pa.y) * f;
    a.z = pa.z + (b.z - pa.z) * f;
    a.angle = lerpAng(pa.ang, b.ang);
    a.vy = nb.vy;
    a.alive = !!(nb.f & 1);
    a.landed = !!(nb.f & 2);
    a.stun = nb.f & 8 ? 0.5 : 0;
    a.inv = nb.f & 16 ? 0.2 : 0;
    a.use = nb.f & 32 ? 1 : 0;
    a.useType = nb.useType;
    a.bot = !!(nb.f & 64);
    a.down = !!(nb.f & 128);
    a.hp = nb.hp;
    a.armor = nb.armor;
    a.roll = nb.roll;
    a.rollDir = nb.roll > 0 ? { x: nb.rdx, z: nb.rdz } : null;
    a.animation = nb.anim;
    a.kills = nb.kills;
    const wid = nb.w >> 2,
      q = nb.w & 3;
    a.slot = 0;
    if (a.slots[0].id !== wid || a.slots[0].q !== q) a.slots[0] = { id: wid, q, ammo: 0 };
    const travel = Math.hypot(a.x - ox, a.z - oz);
    if (travel < 3) a.step += travel * 3;
    a.moving = travel > 0.003;
    if (a.alive && !wasLanded && a.landed && a.y < 0.2) burst(a.x, a.z, "#e8dcc0", 6, a.y + 0.1, "dust", true);
    if (a.alive && a.moving && a.landed && a.y < 0.05) {
      a.stepT -= 1 / 60;
      if (a.stepT <= 0) {
        a.stepT = 0.36;
        if (dist(a, listener()) < 16) sound("step", a, { vol: 0.8, pitch: rand(0.9, 1.1) }, true);
      }
    }
  }
  const cb = B.cat,
    ca = A.cat || cb;
  if (cb) {
    cat = cat || { target: null, pounce: null, cool: 0 };
    cat.x = ca.x + (cb.x - ca.x) * f;
    cat.z = ca.z + (cb.z - ca.z) * f;
    cat.angle = lerpAng(ca.angle, cb.angle);
    cat.mode = (near.cat || cb).mode;
  } else cat = null;
  const vb = B.vac,
    va = A.vac && A.vac.lane === vb?.lane ? A.vac : vb;
  if (vb && VAC_LANES[vb.lane]) {
    vacuum = vacuum && vacuum.lane === VAC_LANES[vb.lane] && vacuum.dir === vb.dir ? vacuum : { lane: VAC_LANES[vb.lane], dir: vb.dir, hit: new Set(), humT: 0 };
    vacuum.s = va.s + (vb.s - va.s) * f;
    vacuum.warn = !!(vb.f & 1);
    vacuum.active = !!(vb.f & 2);
    Object.assign(vacuum, vacPoint(vacuum, vacuum.s));
  } else vacuum = null;
}
function applyWorld(ev) {
  const e = ev.e;
  if (e === "b") burst(ev.x, ev.z, ev.c, ev.n, ev.y, ev.k, true);
  else if (e === "em") {
    const a = actorById(ev.s);
    if (a && EMOTES[ev.k]) {
      a.emote = { k: ev.k, at: worldClock };
      if (a === player || dist(a, listener()) < 24) sound("emote", a === player ? null : a, { vol: 0.55 });
    }
  }
  else if (e === "r") rings.push(ev.r);
  else if (e === "bl") balloons.push(ev.b);
  else if (e === "snd") {
    const src = Array.isArray(ev.s) ? { x: ev.s[0], z: ev.s[1] } : actorById(ev.s);
    if (src) sound(ev.k, src === player ? null : src, ev.o || {}, true);
  } else if (e === "f") {
    const v = actorById(ev.v);
    if (v) logFeed(actorById(ev.s), ev.c, v);
  } else if (e === "la") {
    const [uid, x, z, type, id, q] = ev.l;
    loot.push({ uid, x, z, type, id, q, spin: rand(0, 6.28) });
  } else if (e === "lr") loot = loot.filter((l) => l.uid !== ev.u);
  else if (e === "bp") popped.add(ev.k);
  else if (e === "aev") arenaEvent = { k: ev.k, until: ev.u };
  else if (e === "ks") {
    actors.forEach((a, i) => (KOTH.score[a.team] = ev.s[i] || 0));
    KOTH.holder = ev.h;
    KOTH.contested = !!ev.c;
    KOTH.next = ev.n;
    if (!KOTH.hill || KOTH.hill.x !== ev.x || KOTH.hill.z !== ev.z) KOTH.hill = { x: ev.x, z: ev.z, r: KOTH_R };
  }
  else if (e === "bs") {
    const [x, y, z, dx, dy, dz] = ev.p;
    bullets.push({ x, y, z, dx, dy, dz, life: ev.l, max: ev.l, source: actorById(ev.s), dmg: 0, headBonus: 1, color: ev.c, wid: ev.w });
  } else if (e === "gs") {
    const [x, y, z, vx, vy, vz] = ev.p;
    grenades.push({ uid: ev.u, x, y, z, vx, vy, vz, fuse: ev.f, source: actorById(ev.s) });
  } else if (e === "gx") {
    const g = grenades.find((x) => x.uid === ev.u);
    if (g) blastShake(g.x, g.z);
    grenades = grenades.filter((x) => x.uid !== ev.u);
  }
  else if (e === "c") clouds.push({ ...ev.c });
  else if (e === "ta") traps.push({ uid: ev.u, x: ev.x, z: ev.z, life: ev.l, owner: actorById(ev.o) });
  else if (e === "tr") traps = traps.filter((t) => t.uid !== ev.u);
  else if (e === "say") {
    say(txt(ev.k), ev.s);
    if (ev.snd) sound(ev.snd);
  }
}
// Projectiles fly on every screen; only the host decides hits, here they just stop at whatever they meet.
function clientProjectiles(dt) {
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
        if (a !== b.source && a.alive && dist(b, a) < 0.42 && b.y > a.y + 0.05 && b.y < a.y + 1.9) {
          b.life = 0;
          break;
        }
    }
    if (b.life > 0 && !b.whiz && b.source !== player && player?.alive && Math.hypot(b.x - player.x, b.z - player.z) < 1.8 && Math.abs(b.y - player.y - 1) < 1.6) {
      b.whiz = true;
      sound("whiz", b, {}, true);
    }
    if (b.life <= 0) bullets.splice(i, 1);
  }
  for (const g of grenades) {
    g.fuse -= dt;
    if (g.fuse < -1) g.gone = true;
    if (g.fuse <= 0) continue;
    g.vy -= 12 * dt;
    const nx = g.x + g.vx * dt,
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
  }
  if (grenades.some((g) => g.gone)) grenades = grenades.filter((g) => !g.gone);
  for (let i = clouds.length - 1; i >= 0; i--) if ((clouds[i].life -= dt) <= 0) clouds.splice(i, 1);
  for (let i = traps.length - 1; i >= 0; i--) if ((traps[i].life -= dt) <= -1) traps.splice(i, 1);
}
net.clientFrame = (realDt) => {
  const now = nowS();
  if (N.offset === null) return;
  // The own hero: read the input, run it at once, send it to the host.
  if (player?.alive && !spectate) {
    N.dtAcc = Math.min(N.dtAcc + realDt, 0.1);
    const ms = Math.min(50, Math.floor(N.dtAcc * 1000));
    if (ms >= 1) {
      N.dtAcc -= ms / 1000;
      const raw = localCmd(ms / 1000);
      raw.acts = N.acts;
      N.acts = 0;
      raw.seq = ++N.seq;
      const c = quantCmd(raw);
      N.hist.push(c);
      if (N.hist.length > 90) N.hist.shift();
      updateActor(player, c.dt, c);
      send(N.hostPeer, encodeCmds(N.hist.slice(-16)), false);
    }
  }
  // Everything else a little in the past, in step with the host's events.
  const prevTime = time;
  time = Math.max(time, now + N.offset - INTERP);
  zone = zoneAt(time);
  while (N.evq.length && (N.evq[0].tm <= time || now - N.evq[0].at > 0.4)) for (const ev of N.evq.shift().w) applyWorld(ev);
  interpolate(time);
  const dt = Math.min(0.1, Math.max(0, time - prevTime));
  if (options.arena === "kidsroom") hazard = !!vacuum?.active;
  else hazard = time % 36 > 27;
  if (dt > 0) hazardFx(dt, time % 36, prevTime % 36);
  clientProjectiles(realDt);
  updateEffects(realDt);
  for (const h of hurtFrom) h.life -= realDt;
  if (hurtFrom.length) hurtFrom = hurtFrom.filter((h) => h.life > 0);
  noticeTime -= realDt;
  if (noticeTime <= 0) $("notice").textContent = "";
  hurt = Math.max(0, hurt - realDt * 2);
  hitFlash = Math.max(0, hitFlash - realDt);
  recoil = Math.max(0, recoil - realDt);
  if (spectate) updateSpectate(realDt);
  hudTick -= realDt;
  if (hudTick <= 0) {
    updateHud();
    hudTick = 0.1;
  }
};
function clientOnJson(msg) {
  if (msg.t === "lobby") {
    N.members = msg.m || [];
    N.hostNick = msg.host;
    N.code = msg.code || N.code;
    if (msg.cfg) {
      N.cfg = msg.cfg;
      if (mode === "menu") mirrorCfg(msg.cfg, true);
    }
    lobbyUI();
  } else if (msg.t === "start") {
    if (msg.v === PROTO) clientStart(msg);
  } else if (msg.t === "ev") {
    if (!N.live || mode !== "play") return;
    if (msg.w?.length) N.evq.push({ tm: msg.tm, w: msg.w, at: nowS() });
    for (const f of msg.f || []) applyFx(f);
  } else if (msg.t === "over") {
    // The match is decided: a spectating player sees the winner (or goes to the results if the host ended it).
    N.live = false;
    if (spectate && mode === "play") {
      if (msg.early) endSpectate(true);
      else if (!spectate.over) {
        const w = actorById(msg.w);
        spectate.over = 3.2;
        if (w) {
          spectate.target = w;
          say(winsText(w), 3);
        }
      }
    }
  }
  else if (msg.t === "abort") {
    N.live = false;
    if (mode !== "menu") menu();
    toast(txt("net.aborted"), "info");
  } else if (msg.t === "wait") toast(txt("net.waitMatch"), "info");
  else if (msg.t === "reject") {
    leaveLobby(false);
    netStatus(txt(msg.why === "full" ? "net.full" : "net.version"));
    $("online").hidden = false;
  } else if (msg.t === "bye") hostLost();
}
function hostLost() {
  if (!N.role) return;
  leaveLobby(false);
  toast(txt("net.hostLeft"), "info");
}
// Shows the host's arena and rules on a client's menu (the controls there are locked).
function mirrorCfg(cfg, rebuild = false) {
  const changed = options.arena !== cfg.arena || options.night !== !!cfg.night;
  options.arena = cfg.arena;
  options.night = !!cfg.night;
  $("duration").value = String(cfg.duration);
  $("difficulty").value = cfg.difficulty;
  $("night").checked = !!cfg.night;
  $("teamMode").value = ["duo", "koth"].includes(cfg.mode) ? cfg.mode : "solo";
  options.mode = $("teamMode").value;
  for (const b of document.querySelectorAll("[data-arena]")) b.classList.toggle("selected", b.dataset.arena === cfg.arena);
  if (rebuild && changed) menu();
}

// ----- messages in, from either transport -----
function onData(peer, bytes) {
  if (!N.role || !bytes || !bytes.length) return;
  if (N.role === "host") {
    const m = hostMember(peer);
    if (m) m.seen = nowS();
    if (bytes[0] === 2) return hostOnCmds(peer, bytes);
    if (bytes[0] !== 123) return;
    let msg;
    try {
      msg = JSON.parse(unutf8.decode(bytes));
    } catch {
      return;
    }
    hostOnJson(peer, msg);
  } else {
    if (peer !== N.hostPeer) return;
    N.seen = nowS();
    if (bytes[0] === 1) {
      // Late snapshots after the end still count: they carry the final knockouts.
      if (mode === "play") onSnapshot(readSnapshot(bytes));
      return;
    }
    if (bytes[0] !== 123) return;
    let msg;
    try {
      msg = JSON.parse(unutf8.decode(bytes));
    } catch {
      return;
    }
    clientOnJson(msg);
  }
}
function onPeerLeft(peer) {
  if (N.role === "host") {
    const m = hostMember(peer);
    if (m) dropMember(m);
  } else if (N.role === "client" && peer === N.hostPeer) hostLost();
}
net.poll = () => {
  if (!N.t) return;
  N.t.poll?.();
  const now = nowS();
  // After this page itself stood still (a hidden tab, a long first frame), the silence is not the others' fault.
  if (N.lastPoll && now - N.lastPoll > 3) {
    N.seen = now;
    for (const m of N.members) m.seen = now;
  }
  N.lastPoll = now;
  if (!N.role) return;
  // Keep-alive in the lobby, and a player (or the host) silent for 10 s counts as gone.
  if (now - N.lastKa > 2) {
    N.lastKa = now;
    if (N.role === "host") for (const m of N.members) sendJson(m.peer, { t: "ka" });
    else sendJson(N.hostPeer, { t: "ka" });
  }
  if (N.role === "host") {
    for (const m of [...N.members]) if (now - m.seen > 10) dropMember(m);
  } else if (now - N.seen > 10) hostLost();
};
// Background pump: if the page stops drawing (hidden window), the host's world and a client's input keep going.
setInterval(() => {
  if (!N.role) return;
  const now = performance.now();
  net.poll();
  if (now - last < 120) return;
  const realDt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (N.role === "host") {
    if (mode === "play") simulate(realDt);
    net.hostFrame(realDt);
  } else if (mode === "play") net.clientFrame(realDt);
}, 50);

// ----- lobby: create, join, leave -----
function setRole(role) {
  N.role = role;
  net.on = !!role;
  net.host = role === "host";
  net.client = role === "client";
  document.body.classList.toggle("inLobby", !!role);
  document.body.classList.toggle("netClient", role === "client");
  for (const id of ["duration", "difficulty", "night", "teamMode"]) $(id).disabled = role === "client";
  for (const b of document.querySelectorAll("[data-arena]")) b.disabled = role === "client";
}
async function hostCreate(publicLobby) {
  const t = pickTransport();
  if (!t) return;
  try {
    netStatus("…");
    const info = await t.create(publicLobby);
    N.t = t;
    N.nick = cleanNick(t.nick);
    N.code = info.code;
    N.members = [];
    N.live = false;
    N.lastKa = 0;
    setRole("host");
    $("online").hidden = true;
    broadcastLobby();
  } catch (e) {
    console.warn(e);
    netStatus(txt(e?.message === "offline" ? "net.offline" : e?.message === "busy" ? "net.busy" : "net.error"));
  }
}
async function clientJoin(code) {
  const t = pickTransport();
  if (!t || !code) return;
  try {
    netStatus("…");
    const info = await t.join(code);
    N.t = t;
    N.nick = cleanNick(t.nick);
    N.code = info.code;
    N.hostPeer = info.host;
    N.members = [];
    N.live = false;
    N.seen = nowS();
    N.lastKa = 0;
    setRole("client");
    $("online").hidden = true;
    sendJson(N.hostPeer, { t: "hello", v: PROTO, ...myLook() });
    lobbyUI();
  } catch (e) {
    console.warn(e);
    if (e?.message === "cancel") return;
    netStatus(txt({ full: "net.full", p2p: "net.p2pFail", offline: "net.offline", busy: "net.busy" }[e?.message] || "net.notFound"));
  }
}
function leaveLobby(notify = true) {
  if (!N.role) return;
  if (notify) {
    if (N.role === "host") {
      if (N.live) for (const m of N.members) sendJson(m.peer, { t: "abort" });
      for (const m of N.members) sendJson(m.peer, { t: "bye" });
    } else sendJson(N.hostPeer, { t: "bye" });
  }
  try {
    N.t?.leave();
  } catch {}
  const wasPlaying = mode === "play";
  Object.assign(N, { role: null, live: false, members: [], hostPeer: null, code: "", snaps: [], hist: [], evq: [] });
  setRole(null);
  if (wasPlaying) menu();
  lobbyUI();
}
net.begin = () => {
  if (N.role === "host") hostBegin();
  else menu();
};
// Leaving a running match: a client hands its hero to a bot, the host ends the match for everyone.
net.onMenu = () => {
  if (!N.role) return;
  if (mode === "play" && N.live) {
    if (N.role === "host") {
      for (const m of N.members) if (m.inMatch) sendJson(m.peer, { t: "abort" });
      N.live = false;
    } else {
      sendJson(N.hostPeer, { t: "quit" });
      N.live = false;
    }
  }
  if (N.role === "host") setTimeout(broadcastLobby, 0);
  // Back in the menu, a client shows the host's current rules (they may have changed during the match).
  else if (N.cfg) mirrorCfg(N.cfg);
};

// ----- transports -----
// Steam: the Electron shell exposes the Steamworks lobby and P2P functions as window.native.steam.
function steamTransport() {
  const s = window.native?.steam;
  if (!s?.available) return null;
  const inbox = [];
  s.onPacket((peer, data) => inbox.push(["d", peer, data instanceof Uint8Array ? data : new Uint8Array(data)]));
  s.onLobbyEvent((e) => {
    if (e.type === "left") inbox.push(["l", e.user]);
  });
  s.onJoinRequest((id) => joinFromInvite(id));
  return {
    kind: "steam",
    nick: s.name,
    async create(pub) {
      const r = await s.createLobby(!!pub);
      return { code: r.id };
    },
    async join(code) {
      const r = await s.joinLobby(String(code).trim());
      if (!r?.owner) throw new Error("notFound");
      return { code: r.id, host: r.owner };
    },
    list: () => s.listLobbies(),
    leave: () => s.leaveLobby(),
    invite: () => s.invite(),
    setData: (d) => s.setLobbyData(d),
    send: (peer, bytes, reliable) => s.send(peer, bytes, reliable),
    poll() {
      while (inbox.length) {
        const [k, peer, data] = inbox.shift();
        if (k === "d") onData(peer, data);
        else onPeerLeft(peer);
      }
    },
  };
}
// Browser tabs of one computer, for trying online play without Steam (?netlag=ms&netloss=0..1 add lag and loss).
function localTransport() {
  if (typeof BroadcastChannel === "undefined") return null;
  const q = new URLSearchParams(location.search),
    lag = +q.get("netlag") || 0,
    loss = +q.get("netloss") || 0,
    me = "p" + Math.random().toString(36).slice(2, 10),
    nick = q.get("nick") || txt("net.player") + " " + (10 + Math.floor(Math.random() * 90)),
    inbox = [];
  let room = null,
    code = "",
    data = null,
    announce = null;
  const lobbies = new BroadcastChannel("minibitva-lobbies");
  const seenLobbies = new Map();
  lobbies.onmessage = (e) => {
    if (e.data?.code) seenLobbies.set(e.data.code, { ...e.data, at: Date.now() });
  };
  const open = (c) => {
    room?.close();
    code = c;
    room = new BroadcastChannel("minibitva-room-" + c);
    room.onmessage = (e) => {
      const m = e.data;
      if (!m || m.f === me || (m.to !== me && m.to !== "*")) return;
      if (m.k === "d") inbox.push(["d", m.f, new Uint8Array(m.d)]);
      else if (m.k === "bye") inbox.push(["l", m.f]);
      else if (m.k === "knock" && data) room.postMessage({ f: me, to: m.f, k: "host" });
      else if (m.k === "host") room._host?.(m.f);
    };
  };
  const post = (to, bytes, reliable) => {
    const msg = { f: me, to, k: "d", d: bytes };
    if (!reliable && loss && Math.random() < loss) return;
    if (lag) setTimeout(() => room?.postMessage(msg), lag + (reliable ? 0 : Math.random() * lag * 0.2));
    else room?.postMessage(msg);
  };
  return {
    kind: "local",
    nick,
    async create() {
      open(Math.random().toString(36).slice(2, 6).toUpperCase());
      data = { name: nick, count: "1", max: String(MAX_PLAYERS) };
      clearInterval(announce);
      announce = setInterval(() => lobbies.postMessage({ code, ...data }), 1000);
      lobbies.postMessage({ code, ...data });
      return { code };
    },
    join(c) {
      open(String(c).trim().toUpperCase());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("notFound")), 2500);
        room._host = (host) => {
          clearTimeout(timer);
          room._host = null;
          resolve({ code, host });
        };
        room.postMessage({ f: me, to: "*", k: "knock" });
      });
    },
    async list() {
      await new Promise((r) => setTimeout(r, 1300));
      const now = Date.now();
      return [...seenLobbies.values()].filter((l) => now - l.at < 3000 && l.code !== code).map((l) => ({ id: l.code, name: l.name, count: +l.count, max: +l.max, live: l.live === "1" }));
    },
    leave() {
      room?.postMessage({ f: me, to: "*", k: "bye" });
      clearInterval(announce);
      data = null;
      room?.close();
      room = null;
    },
    invite() {
      navigator.clipboard?.writeText(code).catch(() => {});
      toast(txt("net.copied") + ": " + code, "info");
    },
    setData(d) {
      data = { ...data, ...d };
    },
    send: (peer, bytes, reliable) => post(peer, bytes, reliable),
    poll() {
      while (inbox.length) {
        const [k, peer, d] = inbox.shift();
        if (k === "d") onData(peer, d);
        else onPeerLeft(peer);
      }
    },
  };
}
// Web and Microsoft Store version: PlayFab's Lobby service (free in its development mode) keeps the list of lobbies
// and carries each player's connection offer to the host; after that the browsers talk directly over WebRTC data
// channels, so there is no game server. The PlayFab Title ID is set in config.js (window.MiniConfig).
// Peers are PlayFab player ids. Lobby search keys: 1 game and version, 2 lobby code, 3 listed, 4 host's name,
// 5 match running, number 1 the host's last sign of life (minutes), so lobbies of closed tabs drop out of the list.
const WEB_ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A WebRTC offer or answer squeezed to the few fields a data-channel connection needs (about 200 characters instead
// of 1–2 KB), so ten of them fit in a lobby's data.
function packSdp(sdp) {
  const one = (re) => (sdp.match(re) || [])[1] || "";
  const fp = one(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/m)
    .split(":")
    .map((h) => String.fromCharCode(parseInt(h, 16)))
    .join("");
  const seen = new Set(),
    cands = [];
  for (const m of sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (host|srflx|relay)/gim)) {
    const c = m[3][0].toLowerCase() + "," + m[1] + "," + m[2];
    if (!seen.has(c)) seen.add(c), cands.push(c);
  }
  // Addresses that work across the internet go first.
  cands.sort((a, b) => "srh".indexOf(a[0]) - "srh".indexOf(b[0]));
  return ["1", one(/^a=ice-ufrag:(\S+)/m), one(/^a=ice-pwd:(\S+)/m), btoa(fp), one(/^a=setup:(\S+)/m), one(/^a=mid:(\S+)/m) || "0", cands.slice(0, 8).join(";")].join(" ");
}
function unpackSdp(str, type) {
  const [v, ufrag, pwd, fp64, setup, mid, cands = ""] = String(str || "").split(" ");
  if (v !== "1" || !ufrag || !pwd || !fp64 || !mid) throw new Error("p2p");
  const fp = [...atob(fp64)].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()).join(":");
  const prio = { h: 2122260223, s: 1686052607, r: 41885439 },
    kind = { h: "host", s: "srflx", r: "relay" };
  const lines = cands
    .split(";")
    .map((c, i) => {
      const [t, addr, port] = c.split(",");
      if (!kind[t] || !addr || !/^[\w.:-]+$/.test(addr) || !(+port > 0 && +port < 65536)) return "";
      return `a=candidate:${i + 1} 1 udp ${prio[t] - i} ${addr} ${+port} typ ${kind[t]}` + (t === "h" ? "" : " raddr 0.0.0.0 rport 0");
    })
    .filter(Boolean);
  const sdp = [
    "v=0",
    "o=- " + (1 + Math.floor(Math.random() * 1e9)) + " 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE " + mid,
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...lines,
    "a=ice-ufrag:" + ufrag,
    "a=ice-pwd:" + pwd,
    "a=ice-options:trickle",
    "a=fingerprint:sha-256 " + fp,
    "a=setup:" + (/^(actpass|active|passive)$/.test(setup) ? setup : type === "offer" ? "actpass" : "active"),
    "a=mid:" + mid,
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  ];
  return { type, sdp: sdp.join("\r\n") + "\r\n" };
}
function webTransport() {
  const cfg = window.MiniConfig || {},
    title = String(cfg.playfabTitleId || "").trim();
  if (!/^[0-9A-Za-z]{3,12}$/.test(title) || typeof RTCPeerConnection === "undefined" || typeof fetch !== "function") return null;
  const api = cfg.playfabApi || "https://" + title.toLowerCase() + ".playfabapi.com",
    ice = Array.isArray(cfg.iceServers) && cfg.iceServers.length ? cfg.iceServers : WEB_ICE,
    tag = "mb" + PROTO,
    minute = () => Math.floor(Date.now() / 60000);
  const keep = (k, v) => {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch {}
    return null;
  };
  // A random player number instead of a typed name: nobody's real name is shown, and there is nothing to moderate.
  let num = +keep("mini-bitva-nick");
  if (!(num >= 100 && num <= 999)) keep("mini-bitva-nick", String((num = 100 + Math.floor(Math.random() * 900))));
  const nick = txt("net.player") + " " + num;
  const inbox = [],
    peers = new Map();
  let session = null,
    signing = null,
    lobby = null, // { id, code, host, owner, pub }
    live = "0",
    pollTimer = 0,
    pushTimer = 0,
    pushing = false,
    lastPush = 0,
    lastBeat = 0,
    searchDirty = false,
    answers = {},
    toDelete = new Set();

  async function raw(path, body, token, keepalive = false) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["X-EntityToken"] = token;
    let res, j;
    try {
      res = await fetch(api + path, { method: "POST", headers, body: JSON.stringify(body), keepalive });
    } catch {
      throw new Error("offline");
    }
    try {
      j = await res.json();
    } catch {}
    if (res.ok && j && j.code === 200) return j.data || {};
    const code = j?.errorCode,
      e = new Error(code === 13001 || res.status === 429 ? "busy" : code === 13000 ? "notFound" : "error");
    e.code = code;
    e.detail = j?.errorMessage || j?.error || res.status;
    throw e;
  }
  // An anonymous PlayFab player, made once per device the first time online play is opened.
  async function login() {
    let id = keep("mini-bitva-pf");
    if (!id) keep("mini-bitva-pf", (id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)));
    const d = await raw("/Client/LoginWithCustomID", { TitleId: title, CustomId: id, CreateAccount: true });
    const t = d.EntityToken;
    if (!t?.EntityToken || !t.Entity?.Id) throw new Error("error");
    const s = { token: t.EntityToken, me: { Id: t.Entity.Id, Type: t.Entity.Type || "title_player_account" }, until: (Date.parse(t.TokenExpiration) || Date.now() + 36e5) - 6e5 };
    // A lobby left behind by a closed tab would still count this player in it: leave those first.
    try {
      const old = await raw("/Lobby/FindLobbies", { Filter: "lobby/amMember eq true" }, s.token);
      await Promise.all((old.Lobbies || []).map((l) => raw("/Lobby/LeaveLobby", { LobbyId: l.LobbyId, MemberEntity: s.me }, s.token).catch(() => {})));
    } catch {}
    return (session = s);
  }
  function signIn() {
    if (session && session.until > Date.now()) return Promise.resolve(session);
    return (signing ||= login().finally(() => (signing = null)));
  }
  const call = async (path, body) => raw(path, body, (await signIn()).token);
  const search = () => ({
    string_key1: tag,
    string_key2: lobby.code,
    string_key3: lobby.pub ? "1" : "0",
    string_key4: nick,
    string_key5: live,
    number_key1: String(minute()),
  });

  // ----- direct connections -----
  function peerFor(id) {
    const pc = new RTCPeerConnection({ iceServers: ice });
    // Two channels made the same way on both sides: "r" ordered and reliable, "u" for snapshots and input that are
    // stale by the time a lost packet could be resent.
    const r = pc.createDataChannel("r", { negotiated: true, id: 0, ordered: true }),
      u = pc.createDataChannel("u", { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    const p = { id, pc, r, u, open: false, closed: false, at: Date.now() };
    r.binaryType = u.binaryType = "arraybuffer";
    r.onmessage = u.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) inbox.push(["d", id, new Uint8Array(e.data)]);
    };
    let opened;
    p.opened = new Promise((res) => (opened = res));
    r.onopen = () => {
      p.open = true;
      opened();
      if (lobby?.host) {
        toDelete.add("a" + id);
        pushSoon();
      }
    };
    const lost = (why) => {
      if (p.closed) return;
      console.warn("web: connection lost", id, why);
      p.close();
      if (peers.get(id) === p) peers.delete(id);
      if (p.open) inbox.push(["l", id]);
      if (lobby?.host) kick(id);
    };
    r.onclose = () => lost("channel closed");
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") lost(pc.connectionState);
    };
    p.close = () => {
      if (p.closed) return;
      p.closed = true;
      try {
        r.close();
        u.close();
      } catch {}
      // Closing the channels first lets a last "bye" go out.
      setTimeout(() => pc.close(), 400);
    };
    const gathered = async () => {
      if (pc.iceGatheringState !== "complete")
        await new Promise((res) => {
          const t = setTimeout(res, 2500);
          pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && (clearTimeout(t), res()));
        });
      return packSdp(pc.localDescription.sdp);
    };
    p.offer = async () => {
      await pc.setLocalDescription(await pc.createOffer());
      return gathered();
    };
    p.answer = async (offer) => {
      await pc.setRemoteDescription(unpackSdp(offer, "offer"));
      await pc.setLocalDescription(await pc.createAnswer());
      return gathered();
    };
    p.accept = (answer) => pc.setRemoteDescription(unpackSdp(answer, "answer"));
    return p;
  }
  function kick(id) {
    if (lobby?.host) call("/Lobby/RemoveMember", { LobbyId: lobby.id, MemberEntity: { Id: id, Type: "title_player_account" }, PreventRejoin: false }).catch(() => {});
  }

  // ----- host: read the lobby every ~11 s for new players' offers, write answers back -----
  async function hostPoll() {
    pollTimer = 0;
    const l = lobby;
    if (!l?.host) return;
    let gap = N.live ? 20000 : 11000;
    try {
      const L = (await call("/Lobby/GetLobby", { LobbyId: l.id })).Lobby || {};
      if (lobby !== l) return;
      const here = new Set();
      for (const m of L.Members || []) {
        const id = m.MemberEntity?.Id,
          offer = m.MemberData?.o;
        if (!id || id === l.owner) continue;
        here.add(id);
        const p = peers.get(id);
        if (offer && (!p || p.offer !== offer)) {
          p?.close();
          answerPeer(id, offer);
        } else if (p && !p.open && Date.now() - p.at > 60000) {
          // Answered a minute ago and still not connected: the player is gone or can't reach us.
          p.close();
          peers.delete(id);
          kick(id);
        }
      }
      for (const k of Object.keys(L.LobbyData || {})) if (k[0] === "a" && (!here.has(k.slice(1)) || peers.get(k.slice(1))?.open)) toDelete.add(k);
    } catch (e) {
      if (e.message === "busy") gap = 30000;
    }
    pushSoon();
    if (lobby === l) pollTimer = setTimeout(hostPoll, gap);
  }
  async function answerPeer(id, offer) {
    const p = peerFor(id);
    p.offer = offer;
    peers.set(id, p);
    try {
      answers["a" + id] = await p.answer(offer);
      toDelete.delete("a" + id);
      pushSoon(true);
    } catch (e) {
      console.warn("web answer", e);
      p.close();
      if (peers.get(id) === p) peers.delete(id);
    }
  }
  // Lobby writes are bundled and spaced at least 7 s apart (PlayFab limits how often a lobby may change).
  function pushSoon(urgent) {
    if (!lobby?.host || pushTimer) return;
    pushTimer = setTimeout(push, Math.max(urgent ? 0 : 1500, lastPush + 7000 - Date.now()));
  }
  async function push() {
    pushTimer = 0;
    const l = lobby;
    if (!l?.host) return;
    if (pushing) return pushSoon();
    const body = { LobbyId: l.id },
      sent = answers,
      del = [...toDelete].filter((k) => !(k in sent));
    answers = {};
    toDelete.clear();
    if (Object.keys(sent).length) body.LobbyData = sent;
    if (del.length) body.LobbyDataToDelete = del;
    const beat = searchDirty || Date.now() - lastBeat > 60000;
    if (beat) body.SearchData = search();
    if (Object.keys(body).length === 1) return;
    pushing = true;
    lastPush = Date.now();
    searchDirty = false;
    try {
      await call("/Lobby/UpdateLobby", body);
      if (beat) lastBeat = Date.now();
    } catch (e) {
      if (lobby === l && e.message !== "notFound") {
        answers = { ...sent, ...answers };
        for (const k of del) toDelete.add(k);
        searchDirty ||= beat;
      }
    } finally {
      pushing = false;
    }
    if (lobby === l && (Object.keys(answers).length || toDelete.size || searchDirty)) pushSoon();
  }

  // ----- player: wait for the host's answer -----
  async function waitAnswer(l, myId) {
    const end = Date.now() + 40000;
    let gap = 2500;
    while (Date.now() < end) {
      await sleep(gap);
      gap = 4000;
      if (lobby !== l) throw new Error("cancel");
      try {
        const L = (await call("/Lobby/GetLobby", { LobbyId: l.id })).Lobby || {};
        const a = L.LobbyData?.["a" + myId];
        if (a) return a;
        if (L.Members && !L.Members.some((m) => m.MemberEntity?.Id === myId)) throw new Error("notFound");
      } catch (e) {
        if (e.message === "busy") gap = 9000;
        else if (e.message !== "error") throw e;
      }
    }
    throw new Error("p2p");
  }
  function quit() {
    const l = lobby;
    lobby = null;
    clearTimeout(pollTimer);
    clearTimeout(pushTimer);
    pollTimer = pushTimer = 0;
    answers = {};
    toDelete.clear();
    for (const p of peers.values()) p.close();
    peers.clear();
    if (l && session) raw("/Lobby/LeaveLobby", { LobbyId: l.id, MemberEntity: session.me }, session.token, true).catch(() => {});
  }
  const lobbyFilter = (extra) => `string_key1 eq '${tag}' and number_key1 ge ${minute() - 3}` + extra;

  return {
    kind: "web",
    nick,
    async create(pub) {
      quit();
      const s = await signIn();
      const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
      lobby = { id: "", code, host: true, owner: s.me.Id, pub: !!pub };
      live = "0";
      const l = lobby;
      try {
        const d = await call("/Lobby/CreateLobby", {
          AccessPolicy: "Public",
          MaxPlayers: MAX_PLAYERS,
          OwnerMigrationPolicy: "None",
          UseConnections: false,
          Owner: s.me,
          Members: [{ MemberEntity: s.me, MemberData: { n: nick } }],
          SearchData: search(),
        });
        l.id = d.LobbyId;
      } catch (e) {
        if (lobby === l) lobby = null;
        throw e;
      }
      lastPush = lastBeat = Date.now();
      pollTimer = setTimeout(hostPoll, 4000);
      return { code };
    },
    async join(raw_) {
      quit();
      const code = String(raw_ || "")
        .toUpperCase()
        .replace(/.*JOIN=/, "")
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8);
      if (!code) throw new Error("notFound");
      const s = await signIn();
      const found = await call("/Lobby/FindLobbies", { Filter: lobbyFilter(` and string_key2 eq '${code}'`), Pagination: { PageSizeRequested: 5 } });
      const f = (found.Lobbies || []).sort((a, b) => +(b.SearchData?.number_key1 || 0) - +(a.SearchData?.number_key1 || 0))[0];
      if (!f) throw new Error("notFound");
      if (f.CurrentPlayers >= f.MaxPlayers) throw new Error("full");
      netStatus(txt("net.connecting"));
      const owner = f.Owner?.Id || f.OwnerEntity?.Id;
      const p = peerFor(owner);
      const l = (lobby = { id: "", code, host: false, owner, pub: false });
      try {
        const offer = await p.offer();
        if (lobby !== l) throw new Error("cancel");
        let d;
        try {
          d = await call("/Lobby/JoinLobby", { ConnectionString: f.ConnectionString, MemberEntity: s.me, MemberData: { n: nick, o: offer } });
        } catch (e) {
          throw new Error(/max|full|limit/i.test(String(e.detail)) ? "full" : e.message === "busy" || e.message === "offline" ? e.message : "notFound");
        }
        l.id = d.LobbyId;
        peers.set(owner, p);
        await p.accept(await waitAnswer(l, s.me.Id));
        await Promise.race([p.opened, sleep(20000).then(() => Promise.reject(new Error("p2p")))]);
        if (lobby !== l) throw new Error("cancel");
        return { code, host: owner };
      } catch (e) {
        p.close();
        if (lobby === l) quit();
        throw e;
      }
    },
    async list() {
      const d = await call("/Lobby/FindLobbies", { Filter: lobbyFilter(" and string_key3 eq '1'"), Pagination: { PageSizeRequested: 30 } });
      return (d.Lobbies || [])
        .filter((l) => l.SearchData?.string_key2 && l.SearchData.string_key2 !== lobby?.code)
        .map((l) => ({ id: l.SearchData.string_key2, name: l.SearchData.string_key4 || "?", count: l.CurrentPlayers | 0, max: l.MaxPlayers | 0, live: l.SearchData.string_key5 === "1" }));
    },
    leave: quit,
    invite() {
      if (!lobby) return;
      const link = new URL("./?join=" + lobby.code, location.href).href;
      try {
        navigator.clipboard?.writeText(link).catch(() => {});
      } catch {}
      toast(txt("net.copied") + " · " + lobby.code, "info");
    },
    setData(d) {
      if (!lobby?.host) return;
      const next = d.live === "1" ? "1" : "0";
      if (next !== live) {
        live = next;
        searchDirty = true;
        pushSoon();
      }
    },
    send(peer, bytes, reliable) {
      const p = peers.get(peer);
      if (!p?.open) return;
      const ch = !reliable && p.u.readyState === "open" ? p.u : p.r;
      // A backed-up connection skips snapshots rather than queueing stale ones.
      if (ch.readyState !== "open" || (!reliable && ch.bufferedAmount > 262144)) return;
      ch.send(bytes);
    },
    poll() {
      while (inbox.length) {
        const [k, peer, d] = inbox.shift();
        if (k === "d") onData(peer, d);
        else onPeerLeft(peer);
      }
    },
  };
}
let transportCache = null;
function pickTransport() {
  if (N.t) return N.t;
  // Desktop: Steam. Web: PlayFab when config.js has a Title ID; the store build without one has no online play;
  // otherwise (and with ?local) two tabs of one browser.
  const web = window.MiniConfig?.platform === "web" && !new URLSearchParams(location.search).has("local");
  if (!transportCache) transportCache = steamTransport() || (window.native ? null : webTransport() || (web ? null : localTransport()));
  return transportCache;
}
function joinFromInvite(id) {
  if (N.role) leaveLobby();
  if (mode !== "menu") menu();
  clientJoin(id);
}

// ----- lobby and online screens -----
function netStatus(text) {
  const el = $("netStatus");
  if (el) el.textContent = text || "";
}
function lobbyUI() {
  const panel = $("lobbyPanel");
  if (!panel) return;
  panel.hidden = !N.role;
  if (!N.role) {
    $("start").disabled = false;
    $("start").innerHTML = txt("menu.start");
    $("again").innerHTML = txt("res.again");
    updatePresence();
    return;
  }
  const people =
    N.role === "host"
      ? [{ n: N.nick, host: true, c: myLook().color }, ...N.members.map((m) => ({ n: m.nick, c: m.color }))]
      : [{ n: N.hostNick || "…", host: true }, ...N.members.map((m) => ({ n: m.n, c: m.c, me: m.n === N.nick }))];
  $("lobbyCode").textContent = N.code ? "· " + (String(N.code).length > 8 ? "…" + String(N.code).slice(-6) : N.code) : "";
  // Duos: players pair up in the order they joined (the host and the first friend are team 1).
  const pairs = $("teamMode").value === "duo";
  $("lobbyMembers").innerHTML =
    people
      .map(
        (p, i) =>
          (pairs && i % 2 === 0 ? `<div class="lobbyTeam">${txt("net.team", i / 2 + 1)}</div>` : "") +
          `<div class="lobbyMember${p.host ? " host" : ""}"><i style="background:${p.c || "#ffc933"}"></i><b>${esc(p.n)}</b>${p.host ? `<small>👑 ${txt("net.host")}</small>` : ""}</div>`,
      )
      .join("") + (people.length < MAX_PLAYERS ? `<div class="lobbyBots">${txt("net.bots", MAX_PLAYERS - people.length)}</div>` : "");
  $("lobbyNote").textContent = txt(N.role === "host" ? "net.noteHost" : "net.noteClient") + (pairs ? " " + txt("net.noteDuo") : "");
  if (N.role === "host") {
    $("start").disabled = N.live;
    $("start").innerHTML = txt("net.start", people.length);
  } else {
    $("start").disabled = true;
    $("start").innerHTML = txt("net.wait");
  }
  $("again").innerHTML = txt(N.role === "client" ? "net.toLobby" : "res.again");
  updatePresence();
}
async function refreshLobbies() {
  const t = pickTransport(),
    box = $("netList");
  if (!t || !box) return;
  box.innerHTML = `<div class="netEmpty">${txt("net.searching")}</div>`;
  let list = [];
  try {
    list = await t.list();
  } catch (e) {
    if (e?.message === "offline" || e?.message === "busy") netStatus(txt("net." + e.message));
  }
  box.innerHTML = list.length
    ? list
        .map(
          (l) =>
            `<button class="netLobby" data-code="${esc(l.id)}"${l.count >= l.max ? " disabled" : ""}><b>${esc(l.name)}</b><span>${l.count} / ${l.max}${l.live ? " · ⚔" : ""}</span></button>`,
        )
        .join("")
    : `<div class="netEmpty">${txt("net.none")}</div>`;
  for (const b of box.querySelectorAll("[data-code]")) b.onclick = () => clientJoin(b.dataset.code);
}
function openOnline() {
  const t = pickTransport();
  $("online").hidden = false;
  $("netHome").hidden = !t;
  netStatus(t ? (t.kind === "local" ? txt("net.browser") : "") : txt(window.native ? "net.steamOff" : "net.webOff"));
  const privacy = $("netPrivacy");
  if (privacy) privacy.hidden = t?.kind !== "web";
  if (t) refreshLobbies();
}
$("onlineBtn").onclick = openOnline;
$("closeOnline").onclick = () => ($("online").hidden = true);
$("netCreate").onclick = () => hostCreate($("netPublic").checked);
$("netRefresh").onclick = refreshLobbies;
$("netJoinCode").onclick = () => clientJoin($("netCodeInput").value.trim());
$("netCodeInput").onkeydown = (e) => {
  if (e.key === "Enter") clientJoin($("netCodeInput").value.trim());
};
// Inviting: Steam's invite dialog (and the code on the clipboard, in case the overlay is not available).
function copyCode() {
  if (!N.code) return;
  try {
    navigator.clipboard?.writeText(String(N.code)).catch(() => {});
  } catch {}
  toast(txt("net.copied") + " · " + N.code, "info");
}
$("lobbyInvite").onclick = () => {
  if (N.t?.kind === "steam") {
    N.t.invite();
    copyCode();
  } else N.t?.invite();
};
$("lobbyCode").onclick = copyCode;
$("lobbyCode").title = txt("net.copyHint");
// The desktop version has its own way out.
if (window.native?.desktop) {
  $("quitBtn").hidden = false;
  $("quitBtn").onclick = () => {
    leaveLobby();
    saveProfile();
    window.native.cloud?.flush?.();
    window.native.quit();
  };
}
$("lobbyLeave").onclick = () => leaveLobby();
for (const id of ["duration", "difficulty", "night", "teamMode"]) $(id).addEventListener("change", () => N.role === "host" && broadcastLobby());
window.addEventListener("beforeunload", () => leaveLobby());
// A Steam invite accepted before the game was running arrives as a launch parameter.
{
  const pending = window.native?.steam?.pendingJoin?.();
  if (pending) setTimeout(() => joinFromInvite(pending), 300);
}
// The web version links its privacy policy from the settings (in the player's language).
if (window.MiniConfig?.platform === "web" && $("privacyLink")) {
  $("privacyLink").hidden = false;
  $("privacyLink").onclick = () => ($("privacyLink").href = "privacy.html" + (LANG === "en" ? "#en" : ""));
}
// A friend's invite link (…/?join=CODE) on the web: straight into that lobby.
if (!window.native && typeof location !== "undefined") {
  const join = new URLSearchParams(location.search).get("join");
  if (join) {
    try {
      history.replaceState(null, "", location.pathname);
    } catch {}
    setTimeout(() => {
      openOnline();
      if (pickTransport()) joinFromInvite(join);
    }, 300);
  }
}
// Achievements unlocked before Steam knew about them are sent once at start.
if (window.native?.steam?.available) for (const id of Object.keys(profile.ach)) window.native.steam.achievement(id);
updatePresence();
