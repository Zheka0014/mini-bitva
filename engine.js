"use strict";
// Mini-Bitva renderer: bright cartoon look — cel shading, ink outlines, bloom glow, FXAA.
const $ = (id) => document.getElementById(id),
  canvas = $("world"),
  T = window.THREE,
  GX = window.GraphicsExtras;
let renderer;
try {
  renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance", stencil: false });
} catch (e) {
  $("fatal").hidden = false;
  throw e;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = T.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = T.SRGBColorSpace;
// Layer 1 holds glow, transparent and tiny effects: rendered normally but skipped by the outline pre-pass.
const FX = 1;
const scene = new T.Scene(),
  camera = new T.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1400),
  world = new T.Group(),
  dynamic = new T.Group(),
  effectGroup = new T.Group();
camera.layers.enable(FX);
scene.add(world, dynamic, effectGroup);
const obstacles = [],
  solids = [],
  actorModels = new Map(),
  lootModels = new Map(),
  effectPool = new Map(),
  raycaster = new T.Raycaster();
let sun,
  hemi,
  sky,
  zoneWall,
  nightLamps = [],
  animated = [],
  arenaKind = "kitchen",
  menuHero = null,
  appliedQuality = "",
  appliedSize = "";

// ---------- small math helpers (names chosen not to clash with game.js) ----------
const v3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const _e = new T.Euler(),
  _q = new T.Quaternion(),
  _p = new T.Vector3(),
  _s = new T.Vector3(),
  _v = new T.Vector3(),
  _w = new T.Vector3(),
  _c = new T.Color(),
  _m4 = new T.Matrix4(),
  _n3 = new T.Matrix3();
function xf(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  _e.set(r[0] || 0, r[1] || 0, r[2] || 0);
  _q.setFromEuler(_e);
  if (typeof s === "number") s = [s, s, s];
  return new T.Matrix4().compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
}
let seedState = 1;
const seed = (s) => {
    seedState = ((s >>> 0) % 2147483646) + 1;
  },
  prand = () => (seedState = (seedState * 16807) % 2147483647) / 2147483647,
  pr = (a, b) => a + prand() * (b - a);
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const persistentGeo = new Set(),
  persistentMat = new Set(),
  persistentTex = new Set();
const keepG = (g) => (persistentGeo.add(g), g),
  keepM = (m) => (persistentMat.add(m), m),
  keepT = (t) => (persistentTex.add(t), t);

// ---------- cel shading ----------
// Three bands (shade / mid / lit) with soft, anti-aliased steps.
const gradientMap = keepT(
  (() => {
    const n = 256,
      d = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1),
        v = 0.15 + 0.41 * sstep(0.448, 0.468, x) + 0.44 * sstep(0.592, 0.612, x),
        b = Math.round(v * 255);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = b;
      d[i * 4 + 3] = 255;
    }
    const t = new T.DataTexture(d, n, 1);
    t.minFilter = t.magFilter = T.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  })(),
);
// Toon lighting extended with a crisp specular spot (gloss) and a lit-side rim light.
const TOON_PARS = `varying vec3 vViewPosition;
#ifdef TOON_VC
varying vec2 vToon;
#define TOON_P vToon
#else
uniform vec2 toonP;
#define TOON_P toonP
#endif
struct ToonMaterial{vec3 diffuseColor;};
void RE_Direct_Toon(const in IncidentLight directLight,const in vec3 geometryPosition,const in vec3 geometryNormal,const in vec3 geometryViewDir,const in vec3 geometryClearcoatNormal,const in ToonMaterial material,inout ReflectedLight reflectedLight){
 float ndl=dot(geometryNormal,directLight.direction);
 reflectedLight.directDiffuse+=getGradientIrradiance(geometryNormal,directLight.direction)*directLight.color*BRDF_Lambert(material.diffuseColor);
 float g=TOON_P.x;
 vec3 H=normalize(directLight.direction+geometryViewDir);
 float s=pow(max(dot(geometryNormal,H),0.),mix(22.,150.,g));
 float fs=fwidth(s)+1e-4;
 s=smoothstep(.5-fs,.5+fs,s)*step(.02,g)*(.3+.7*g);
 float rt=1.-max(dot(geometryNormal,geometryViewDir),0.);
 float fr=fwidth(rt)+1e-4;
 float rim=smoothstep(.64-fr,.64+fr,rt)*smoothstep(-.05,.4,ndl)*TOON_P.y;
 reflectedLight.directSpecular+=directLight.color*(s*.62+rim*.32*(.45+.55*material.diffuseColor));
}
void RE_IndirectDiffuse_Toon(const in vec3 irradiance,const in vec3 geometryPosition,const in vec3 geometryNormal,const in vec3 geometryViewDir,const in vec3 geometryClearcoatNormal,const in ToonMaterial material,inout ReflectedLight reflectedLight){
 reflectedLight.indirectDiffuse+=irradiance*BRDF_Lambert(material.diffuseColor);
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon`;
function toonCompile(shader) {
  shader.uniforms.toonP = { value: this.userData.toonP };
  if (this.defines && this.defines.TOON_VC !== undefined)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 toonA;\nvarying vec2 vToon;")
      .replace("#include <color_vertex>", "#include <color_vertex>\n\tvToon=toonA;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <lights_toon_pars_fragment>", TOON_PARS)
    .replace(
      "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;",
      "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + totalEmissiveRadiance;",
    );
}
const toonKey = () => "mini-toon-4";
function toonMat(color = "#ffffff", o = {}) {
  const m = new T.MeshToonMaterial({
    color,
    gradientMap,
    map: o.map || null,
    vertexColors: !!o.vc,
    side: o.side || T.FrontSide,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
  });
  if (o.emissive) m.emissive.set(o.emissive);
  if (o.vc) m.defines = { TOON_VC: "" };
  m.userData.toonP = new T.Vector2(o.gloss || 0, o.rim ?? 0.55);
  m.onBeforeCompile = toonCompile;
  m.customProgramCacheKey = toonKey;
  return m;
}
const matCache = new Map();
function material(color, rough = 0.6, metal = 0) {
  const key = color + "|" + rough + "|" + metal;
  let m = matCache.get(key);
  if (!m) {
    m = keepM(toonMat(color, { gloss: metal > 0.5 ? 1 : rough < 0.3 ? 0.75 : rough < 0.45 ? 0.4 : 0, rim: 0.5 }));
    matCache.set(key, m);
  }
  return m;
}
// Shared vertex-coloured materials: one program, very few draw calls.
const worldMat = keepM(toonMat("#ffffff", { vc: true })),
  lootMat = keepM(toonMat("#ffffff", { vc: true, emissive: "#1a1408" }));
const glowMats = new Map();
function glow(color, k = 2.2, o = {}) {
  const key = color + k + (o.add ? "a" : "") + (o.op ?? 1);
  let m = glowMats.get(key);
  if (!m) {
    m = keepM(
      new T.MeshBasicMaterial({
        color: new T.Color(color).multiplyScalar(k),
        transparent: !!o.add || o.op !== undefined,
        opacity: o.op ?? 1,
        blending: o.add ? T.AdditiveBlending : T.NormalBlending,
        depthWrite: !o.add,
        toneMapped: true,
      }),
    );
    glowMats.set(key, m);
  }
  return m;
}

// ---------- geometry ----------
const G = {
  sphere: keepG(new T.SphereGeometry(1, 30, 18)),
  sphereMid: keepG(new T.SphereGeometry(1, 18, 12)),
  sphereLo: keepG(new T.SphereGeometry(1, 10, 7)),
  cylMid: keepG(new T.CylinderGeometry(1, 1, 1, 20)),
  box: keepG(new T.BoxGeometry(1, 1, 1)),
  cyl: keepG(new T.CylinderGeometry(1, 1, 1, 40)),
  cylLo: keepG(new T.CylinderGeometry(1, 1, 1, 14)),
  cone: keepG(new T.ConeGeometry(1, 1, 32)),
  coneLo: keepG(new T.ConeGeometry(1, 1, 10)),
  plane: keepG(new T.PlaneGeometry(1, 1)),
  circle: keepG(new T.CircleGeometry(1, 48)),
  hemi: keepG(new T.SphereGeometry(1, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2)),
  ico: keepG(new T.IcosahedronGeometry(1, 1)),
  octa: keepG(new T.OctahedronGeometry(1, 0)),
};
const geoCache = new Map();
function cg(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = keepG(make());
    geoCache.set(key, g);
  }
  return g;
}
const torusG = (r, t, arc = Math.PI * 2, rs, ts) => {
  rs = rs || (r < 0.6 ? 8 : 14);
  ts = ts || Math.max(12, Math.round(((r < 0.6 ? 24 : 48) * arc) / (Math.PI * 2)));
  return cg(`t${r}:${t}:${arc}:${rs}:${ts}`, () => new T.TorusGeometry(r, t, rs, ts, arc));
};
const capsuleG = (r, l) => cg(`c${r}:${l}`, () => (r < 0.2 ? new T.CapsuleGeometry(r, l, 3, 10) : new T.CapsuleGeometry(r, l, 6, 16)));
function roundedG(w, h, d, r = 0.1) {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return cg(`rb${w}:${h}:${d}:${r}`, () => {
    const s = new T.Shape(),
      x = -w / 2 + r,
      y = -h / 2 + r,
      W = w - 2 * r,
      H = h - 2 * r;
    s.moveTo(x, y - r);
    s.lineTo(x + W, y - r);
    s.quadraticCurveTo(x + W + r, y - r, x + W + r, y);
    s.lineTo(x + W + r, y + H);
    s.quadraticCurveTo(x + W + r, y + H + r, x + W, y + H + r);
    s.lineTo(x, y + H + r);
    s.quadraticCurveTo(x - r, y + H + r, x - r, y + H);
    s.lineTo(x - r, y);
    s.quadraticCurveTo(x - r, y - r, x, y - r);
    const small = Math.max(w, h, d) < 1.2,
      g = new T.ExtrudeGeometry(s, {
        depth: Math.max(0.001, d - 2 * r),
        bevelEnabled: true,
        bevelSegments: small ? 2 : 4,
        steps: 1,
        bevelSize: r,
        bevelThickness: r,
        curveSegments: small ? 3 : 6,
      });
    g.translate(0, 0, -(d - 2 * r) / 2);
    g.computeVertexNormals();
    return g;
  });
}
function starShape(n = 5, ro = 1, ri = 0.45) {
  const s = new T.Shape();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2,
      r = i % 2 ? ri : ro;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}
const starG = cg("star", () => {
  const g = new T.ExtrudeGeometry(starShape(5, 1, 0.48), {
    depth: 0.3,
    bevelEnabled: true,
    bevelSize: 0.12,
    bevelThickness: 0.12,
    bevelSegments: 1,
  });
  g.translate(0, 0, -0.15);
  g.computeVertexNormals();
  return g;
});
const flatStarG = cg("flatStar", () => new T.ShapeGeometry(starShape(6, 1, 0.38)));

// Merges many coloured primitives into one geometry with per-vertex colour and toon parameters.
class Builder {
  constructor() {
    this.parts = [];
    this.stack = [new T.Matrix4()];
  }
  get top() {
    return this.stack[this.stack.length - 1];
  }
  at(p, r, s, fn) {
    this.stack.push(this.top.clone().multiply(xf(p, r, s)));
    fn(this);
    this.stack.pop();
    return this;
  }
  // uv: optional [offsetU, offsetV, scaleU, scaleV] to pick one cell of a texture atlas.
  add(geo, m, color, gloss = 0, rim = 0.55, uv = null) {
    this.parts.push({ geo, m: this.top.clone().multiply(m), c: new T.Color(color), g: gloss, r: rim, uv });
    return this;
  }
  put(geo, p, r, s, color, gloss, rim, uv) {
    return this.add(geo, xf(p, r, s), color, gloss, rim, uv);
  }
  sphere(x, y, z, sx, sy, sz, c, g = 0, rot = [0, 0, 0], lo = false) {
    const m = Math.max(sx, sy, sz);
    return this.put(lo || m < 0.13 ? G.sphereLo : m < 0.9 ? G.sphereMid : G.sphere, [x, y, z], rot, [sx, sy, sz], c, g);
  }
  box(x, y, z, sx, sy, sz, c, g = 0, rot = [0, 0, 0]) {
    return this.put(G.box, [x, y, z], rot, [sx, sy, sz], c, g);
  }
  cyl(x, y, z, r, h, c, g = 0, rot = [0, 0, 0], lo = false) {
    return this.put(lo || r < 0.2 ? G.cylLo : r < 1.2 ? G.cylMid : G.cyl, [x, y, z], rot, [r, h, r], c, g);
  }
  cone(x, y, z, r, h, c, g = 0, rot = [0, 0, 0], lo = false) {
    return this.put(lo || r < 0.3 ? G.coneLo : G.cone, [x, y, z], rot, [r, h, r], c, g);
  }
  rbox(x, y, z, w, h, d, r, c, g = 0, rot = [0, 0, 0]) {
    return this.put(roundedG(w, h, d, r), [x, y, z], rot, [1, 1, 1], c, g);
  }
  torus(x, y, z, r, t, c, g = 0, rot = [0, 0, 0], arc) {
    return this.put(torusG(r, t, arc), [x, y, z], rot, [1, 1, 1], c, g);
  }
  capsule(x, y, z, r, l, c, g = 0, rot = [0, 0, 0], sc = [1, 1, 1]) {
    return this.put(capsuleG(r, l), [x, y, z], rot, sc, c, g);
  }
  rod(a, b, r, c, g = 0, lo = false) {
    const A = v3(...a),
      B = v3(...b),
      len = A.distanceTo(B);
    _q.setFromUnitVectors(v3(0, 1, 0), B.clone().sub(A).normalize());
    const m = new T.Matrix4().compose(A.add(B).multiplyScalar(0.5), _q, _s.set(r, len, r));
    return this.add(lo || r < 0.2 ? G.cylLo : r < 1 ? G.cylMid : G.cyl, m, c, g);
  }
  geom(geo, c, g = 0, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
    return this.put(geo, p, r, s, c, g);
  }
  build() {
    let nv = 0,
      ni = 0;
    for (const p of this.parts) {
      const g = p.geo;
      nv += g.attributes.position.count;
      ni += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3),
      nor = new Float32Array(nv * 3),
      uv = new Float32Array(nv * 2),
      colr = new Float32Array(nv * 3),
      ta = new Float32Array(nv * 2),
      idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0,
      io = 0;
    for (const p of this.parts) {
      const g = p.geo,
        P = g.attributes.position,
        N = g.attributes.normal,
        U = g.attributes.uv,
        C = g.attributes.color,
        flip = p.m.determinant() < 0;
      _n3.getNormalMatrix(p.m);
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(p.m);
        const k = (vo + i) * 3;
        pos[k] = _v.x;
        pos[k + 1] = _v.y;
        pos[k + 2] = _v.z;
        if (N) {
          _w.fromBufferAttribute(N, i).applyNormalMatrix(_n3);
          nor[k] = _w.x;
          nor[k + 1] = _w.y;
          nor[k + 2] = _w.z;
        }
        if (U) {
          const T4 = p.uv;
          uv[(vo + i) * 2] = T4 ? T4[0] + U.getX(i) * T4[2] : U.getX(i);
          uv[(vo + i) * 2 + 1] = T4 ? T4[1] + U.getY(i) * T4[3] : U.getY(i);
        }
        let r = p.c.r,
          gg = p.c.g,
          b = p.c.b;
        if (C) {
          r *= C.getX(i);
          gg *= C.getY(i);
          b *= C.getZ(i);
        }
        colr[k] = r;
        colr[k + 1] = gg;
        colr[k + 2] = b;
        ta[(vo + i) * 2] = p.g;
        ta[(vo + i) * 2 + 1] = p.r;
      }
      if (g.index) {
        const I = g.index;
        for (let i = 0; i < I.count; i += 3) {
          const a = I.getX(i),
            b = I.getX(i + 1),
            c = I.getX(i + 2);
          idx[io++] = vo + a;
          idx[io++] = vo + (flip ? c : b);
          idx[io++] = vo + (flip ? b : c);
        }
      } else
        for (let i = 0; i < P.count; i += 3) {
          idx[io++] = vo + i;
          idx[io++] = vo + (flip ? i + 2 : i + 1);
          idx[io++] = vo + (flip ? i + 1 : i + 2);
        }
      vo += P.count;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new T.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new T.BufferAttribute(uv, 2));
    geo.setAttribute("color", new T.BufferAttribute(colr, 3));
    geo.setAttribute("toonA", new T.BufferAttribute(ta, 2));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
  mesh(mat = worldMat, parent = null, { cast = true, receive = true, layer = 0 } = {}) {
    const m = new T.Mesh(this.build(), mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    if (layer) m.layers.set(layer);
    if (parent) parent.add(m);
    return m;
  }
}
// Classic single-material mesh helpers (used by solids and textured parts).
function mesh(geo, mat, parent = world, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function group(parent, x = 0, y = 0, z = 0) {
  const g = new T.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function fxLayer(o) {
  o.traverse((c) => {
    c.layers.set(FX);
  });
  return o;
}
function addObstacle(x, z, r, h = 5, object = null) {
  obstacles.push({ x, z, r, h });
  if (object) solids.push(object);
}

// ---------- canvas textures ----------
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
function canvasTex(w, h, draw, o = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");
  draw(x, w, h);
  const t = new T.CanvasTexture(c);
  if (o.srgb !== false) t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (o.repeat) {
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(o.repeat[0], o.repeat[1]);
  }
  return t;
}
function roundRect(x, X, Y, W, H, r) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}
// ---------- procedural cartoon textures (drawn once, reused) ----------
const tex = {};
tex.wood = keepT(
  canvasTex(
    1024,
    1024,
    (x, w, h) => {
      seed(11);
      const planks = 8,
        pw = w / planks;
      x.lineCap = "round";
      for (let i = 0; i < planks; i++) {
        x.fillStyle = ["#f2b574", "#eaa964", "#f6be82", "#e8a35f"][i % 4];
        x.fillRect(i * pw, 0, pw, h);
        x.fillStyle = "rgba(255,236,200,.35)";
        x.fillRect(i * pw + 8, 0, pw * 0.32, h);
        for (let k = 0; k < 6; k++) {
          x.strokeStyle = `rgba(170,96,44,${0.14 + prand() * 0.16})`;
          x.lineWidth = 2 + prand() * 3;
          x.beginPath();
          const gx = i * pw + pr(12, pw - 12);
          x.moveTo(gx, -10);
          for (let y = 0; y <= h + 64; y += 64) x.lineTo(gx + Math.sin(y * 0.011 + k * 1.7 + i) * pr(3, 9), y);
          x.stroke();
        }
        if (prand() < 0.75) {
          const kx = i * pw + pr(24, pw - 24),
            ky = pr(90, h - 90);
          for (let r = 4; r > 0; r--) {
            x.strokeStyle = `rgba(150,80,34,${0.2 + 0.09 * r})`;
            x.lineWidth = 3;
            x.beginPath();
            x.ellipse(kx, ky, r * 5, r * 12, 0, 0, 7);
            x.stroke();
          }
        }
        x.fillStyle = "#a45f2e";
        x.fillRect(i * pw, 0, 5, h);
        x.fillStyle = "rgba(255,228,188,.6)";
        x.fillRect(i * pw + 5, 0, 3, h);
        const cy = pr(60, h - 60);
        x.fillStyle = "#a45f2e";
        x.fillRect(i * pw, cy, pw, 5);
        x.fillStyle = "rgba(255,228,188,.55)";
        x.fillRect(i * pw, cy + 5, pw, 3);
      }
    },
    { repeat: [2, 2] },
  ),
);
tex.tiles = keepT(
  canvasTex(
    512,
    512,
    (x, w, h) => {
      x.fillStyle = "#86d2c2";
      x.fillRect(0, 0, w, h);
      const n = 4,
        s = w / n,
        g = 8;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const X = i * s + g / 2,
            Y = j * s + g / 2,
            S = s - g;
          x.fillStyle = (i + j) % 2 ? "#fffaf0" : "#f1fbf7";
          roundRect(x, X, Y, S, S, 14);
          x.fill();
          x.fillStyle = "rgba(255,255,255,.95)";
          roundRect(x, X + 12, Y + 12, S * 0.38, 9, 4);
          x.fill();
          x.fillStyle = "rgba(110,175,165,.22)";
          roundRect(x, X + 8, Y + S - 18, S - 16, 11, 5);
          x.fill();
        }
    },
    { repeat: [1, 1] },
  ),
);
tex.checker = keepT(
  canvasTex(
    256,
    256,
    (x, w, h) => {
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          x.fillStyle = (i + j) % 2 ? "#ff9b85" : "#fff3de";
          x.fillRect((i * w) / 2, (j * h) / 2, w / 2, h / 2);
        }
      x.strokeStyle = "rgba(120,60,50,.25)";
      x.lineWidth = 3;
      x.strokeRect(0, 0, w, h);
      x.beginPath();
      x.moveTo(w / 2, 0);
      x.lineTo(w / 2, h);
      x.moveTo(0, h / 2);
      x.lineTo(w, h / 2);
      x.stroke();
    },
    { repeat: [1, 1] },
  ),
);
tex.lawn = keepT(
  canvasTex(
    512,
    512,
    (x, w, h) => {
      seed(5);
      x.fillStyle = "#ffffff";
      x.fillRect(0, 0, w, h);
      x.lineCap = "round";
      for (let i = 0; i < 2600; i++) {
        const X = prand() * w,
          Y = prand() * h,
          l = pr(6, 16),
          a = pr(-0.5, 0.5),
          t = prand();
        x.strokeStyle = t < 0.5 ? `rgba(60,120,30,${pr(0.12, 0.3)})` : `rgba(255,255,210,${pr(0.18, 0.4)})`;
        x.lineWidth = pr(1.5, 3);
        x.beginPath();
        x.moveTo(X, Y);
        x.lineTo(X + Math.sin(a) * l, Y - Math.cos(a) * l);
        x.stroke();
      }
      for (let i = 0; i < 30; i++) {
        x.fillStyle = "rgba(130,90,40,.12)";
        x.beginPath();
        x.ellipse(prand() * w, prand() * h, pr(8, 20), pr(5, 12), prand() * 3, 0, 7);
        x.fill();
      }
    },
    { repeat: [1, 1] },
  ),
);
tex.gingham = keepT(
  canvasTex(
    256,
    256,
    (x, w, h) => {
      x.fillStyle = "#ffffff";
      x.fillRect(0, 0, w, h);
      x.fillStyle = "rgba(235,64,72,.5)";
      const n = 8,
        s = w / n;
      for (let i = 0; i < n; i += 2) {
        x.fillRect(i * s, 0, s, h);
        x.fillRect(0, i * s, w, s);
      }
    },
    { repeat: [3, 3] },
  ),
);
tex.blob = keepT(
  canvasTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(30,24,60,.55)");
    g.addColorStop(0.55, "rgba(30,24,60,.32)");
    g.addColorStop(1, "rgba(30,24,60,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  }),
);
tex.glowRing = keepT(
  canvasTex(
    128,
    128,
    (x, w, h) => {
      const g = x.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.55, "rgba(255,255,255,.85)");
      g.addColorStop(0.72, "rgba(255,255,255,.35)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    },
    { srgb: false },
  ),
);
tex.soft = keepT(
  canvasTex(
    128,
    128,
    (x, w, h) => {
      const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,255,255,.6)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    },
    { srgb: false },
  ),
);
tex.bread = keepT(
  canvasTex(256, 256, (x, w, h) => {
    seed(3);
    x.fillStyle = "#ffe7ae";
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      x.fillStyle = prand() < 0.5 ? "rgba(214,160,80,.35)" : "rgba(255,250,220,.6)";
      x.beginPath();
      x.ellipse(prand() * w, prand() * h, pr(2, 7), pr(1.5, 4), prand() * 3, 0, 7);
      x.fill();
    }
  }),
);
tex.latte = keepT(
  canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = "#7a4a2a";
    x.fillRect(0, 0, w, h);
    const g = x.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    g.addColorStop(0, "#c98b52");
    g.addColorStop(0.7, "#9a6036");
    g.addColorStop(1, "#6b3e22");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#fff3dc";
    x.beginPath();
    x.moveTo(128, 190);
    x.bezierCurveTo(40, 130, 70, 60, 128, 98);
    x.bezierCurveTo(186, 60, 216, 130, 128, 190);
    x.fill();
    x.strokeStyle = "#fff3dc";
    x.lineWidth = 6;
    x.beginPath();
    x.arc(128, 128, 96, 0, 7);
    x.stroke();
  }),
);
function skyPainting(x, w, h, night, kind) {
  const g = x.createLinearGradient(0, 0, 0, h);
  if (night) {
    g.addColorStop(0, "#141a45");
    g.addColorStop(0.7, "#3a3f86");
    g.addColorStop(1, "#6a5aa8");
  } else {
    g.addColorStop(0, "#46a8ff");
    g.addColorStop(0.7, "#9fdcff");
    g.addColorStop(1, "#e2f6ff");
  }
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  seed(kind === "fridge" ? 9 : 4);
  if (night) {
    for (let i = 0; i < 140; i++) {
      x.fillStyle = `rgba(255,250,220,${pr(0.4, 1)})`;
      const s = pr(1, 2.6);
      x.fillRect(prand() * w, prand() * h * 0.7, s, s);
    }
    x.fillStyle = "#fff6c8";
    x.beginPath();
    x.arc(w * 0.78, h * 0.22, h * 0.09, 0, 7);
    x.fill();
    x.fillStyle = "#141a45";
    x.beginPath();
    x.arc(w * 0.8, h * 0.2, h * 0.08, 0, 7);
    x.fill();
  } else {
    x.fillStyle = "rgba(255,236,150,.9)";
    x.beginPath();
    x.arc(w * 0.8, h * 0.2, h * 0.1, 0, 7);
    x.fill();
    for (let i = 0; i < 5; i++) {
      const cx = pr(0.05, 0.95) * w,
        cy = pr(0.08, 0.45) * h,
        s = pr(0.6, 1.3) * h * 0.06;
      x.fillStyle = "#ffffff";
      for (let j = 0; j < 5; j++) {
        x.beginPath();
        x.arc(cx + (j - 2) * s * 0.9, cy + Math.abs(j - 2) * s * 0.25, s * (1.2 - Math.abs(j - 2) * 0.18), 0, 7);
        x.fill();
      }
      x.fillStyle = "rgba(170,200,235,.5)";
      x.fillRect(cx - s * 2.6, cy + s * 0.7, s * 5.2, s * 0.35);
    }
  }
  const hills = night ? ["#27305e", "#1f2750", "#182043"] : ["#8fd96b", "#6cc757", "#4fae4a"];
  for (let k = 0; k < 3; k++) {
    x.fillStyle = hills[k];
    x.beginPath();
    x.moveTo(0, h);
    for (let X = 0; X <= w; X += 8)
      x.lineTo(X, h * (0.62 + k * 0.09) - Math.sin(X * 0.006 + k * 2) * h * 0.05 - Math.sin(X * 0.017 + k) * h * 0.02);
    x.lineTo(w, h);
    x.fill();
  }
  for (let i = 0; i < 9; i++) {
    const tx = pr(0.03, 0.97) * w,
      ty = h * pr(0.66, 0.8),
      s = pr(0.05, 0.09) * h;
    x.fillStyle = night ? "#1a1d3d" : "#8a5a36";
    x.fillRect(tx - s * 0.12, ty, s * 0.24, s * 1.1);
    x.fillStyle = night ? "#223060" : ["#3fae5a", "#5cc46a", "#2f9c55"][i % 3];
    x.beginPath();
    x.arc(tx, ty, s * 0.75, 0, 7);
    x.fill();
    x.fillStyle = night ? "rgba(80,100,170,.25)" : "rgba(255,255,255,.22)";
    x.beginPath();
    x.arc(tx - s * 0.25, ty - s * 0.25, s * 0.28, 0, 7);
    x.fill();
  }
  if (night) {
    x.fillStyle = "#ffd27a";
    for (let i = 0; i < 6; i++) x.fillRect(pr(0.1, 0.9) * w, h * pr(0.72, 0.85), 6, 8);
  }
}
tex.windowDay = keepT(canvasTex(1024, 768, (x, w, h) => skyPainting(x, w, h, false)));
tex.windowNight = keepT(canvasTex(1024, 768, (x, w, h) => skyPainting(x, w, h, true)));
tex.drawing = keepT(
  canvasTex(256, 320, (x, w, h) => {
    x.fillStyle = "#fffdf5";
    x.fillRect(0, 0, w, h);
    x.lineCap = "round";
    x.lineJoin = "round";
    x.lineWidth = 7;
    x.strokeStyle = "#ffb000";
    x.beginPath();
    x.arc(200, 60, 28, 0, 7);
    x.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28;
      x.beginPath();
      x.moveTo(200 + Math.cos(a) * 38, 60 + Math.sin(a) * 38);
      x.lineTo(200 + Math.cos(a) * 52, 60 + Math.sin(a) * 52);
      x.stroke();
    }
    x.strokeStyle = "#e8433d";
    x.beginPath();
    x.moveTo(40, 200);
    x.lineTo(95, 140);
    x.lineTo(150, 200);
    x.closePath();
    x.stroke();
    x.strokeStyle = "#3a86ff";
    x.strokeRect(50, 200, 90, 80);
    x.strokeStyle = "#2a9d4b";
    x.beginPath();
    x.moveTo(0, 290);
    x.lineTo(256, 290);
    x.stroke();
    x.strokeStyle = "#8338ec";
    x.beginPath();
    x.arc(190, 200, 14, 0, 7);
    x.moveTo(190, 214);
    x.lineTo(190, 255);
    x.moveTo(170, 230);
    x.lineTo(210, 230);
    x.moveTo(190, 255);
    x.lineTo(175, 280);
    x.moveTo(190, 255);
    x.lineTo(205, 280);
    x.stroke();
  }),
);
tex.clock = keepT(
  canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = "#ffffff";
    x.beginPath();
    x.arc(128, 128, 124, 0, 7);
    x.fill();
    x.lineWidth = 16;
    x.strokeStyle = "#ff6b6b";
    x.beginPath();
    x.arc(128, 128, 116, 0, 7);
    x.stroke();
    x.fillStyle = "#3a2f5b";
    x.font = 'bold 34px "Trebuchet MS",Arial';
    x.textAlign = "center";
    x.textBaseline = "middle";
    [
      ["12", 0],
      ["3", 1],
      ["6", 2],
      ["9", 3],
    ].forEach(([t, i]) => {
      const a = (i * Math.PI) / 2 - Math.PI / 2;
      x.fillText(t, 128 + Math.cos(a) * 82, 128 + Math.sin(a) * 82);
    });
    for (let i = 0; i < 12; i++) {
      if (i % 3 === 0) continue;
      const a = (i / 12) * 6.283;
      x.beginPath();
      x.arc(128 + Math.cos(a) * 88, 128 + Math.sin(a) * 88, 5, 0, 7);
      x.fill();
    }
  }),
);
function labelTex(text, bg, ink, w = 512, h = 256, o = {}) {
  return canvasTex(w, h, (x) => {
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    if (o.border) {
      x.strokeStyle = o.border;
      x.lineWidth = 14;
      x.strokeRect(18, 18, w - 36, h - 36);
    }
    if (o.dots) {
      x.fillStyle = o.dots;
      for (let i = 0; i < 14; i++)
        for (let j = 0; j < 6; j++) {
          if ((i + j) % 2) continue;
          x.beginPath();
          x.arc((i * w) / 13, (j * h) / 5, h * 0.07, 0, 7);
          x.fill();
        }
    }
    if (text) {
      x.fillStyle = ink;
      x.textAlign = "center";
      x.textBaseline = "middle";
      const lines = text.split("\n"),
        size = Math.min(h * 0.36, ((w * 0.9) / Math.max(...lines.map((l) => l.length))) * 1.75);
      x.font = `900 ${size}px "Arial Rounded MT Bold","Trebuchet MS",Arial,sans-serif`;
      lines.forEach((l, i) => x.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05));
    }
  });
}
// ---------- special shaders ----------
const QUAD_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}";
const SKY_FS = `uniform vec3 top,mid,bottom,sunDir,sunCol,cloudLit,cloudShade;uniform float time,night;varying vec3 vDir;
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n2(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){vec3 d=normalize(vDir);float h=d.y;
 vec3 c=h>0.?mix(mid,top,pow(clamp(h,0.,1.),.55)):mix(mid,bottom,pow(clamp(-h,0.,1.),.4));
 float sd=dot(d,normalize(sunDir));
 if(night<.5){c+=sunCol*(smoothstep(.9982,.9987,sd)*2.2+pow(max(sd,0.),90.)*.5+pow(max(sd,0.),8.)*.12);}
 else{c+=sunCol*(smoothstep(.99915,.9995,sd)*1.6+pow(max(sd,0.),60.)*.18);vec2 sp=d.xz/(h+.3)*70.;float st=h2(floor(sp));vec2 fp=fract(sp)-.5;c+=vec3(1.,.95,.85)*step(.982,st)*smoothstep(.2,.02,length(fp))*smoothstep(0.,.25,h)*(.7+.5*sin(time*2.5+st*40.))*1.6;}
 if(h>0.){vec2 cp=d.xz/(h+.14)*1.1+vec2(time*.012,time*.004);float n=fbm(cp);float m=smoothstep(.54,.57,n)*smoothstep(.02,.2,h);float sh=smoothstep(.55,.72,fbm(cp+vec2(.03,.05)));c=mix(c,mix(cloudShade,cloudLit,sh),m*(night>.5?.55:1.));}
 gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
const ZONE_FS = `uniform float time,radius;uniform vec3 color;varying vec2 vUv;varying vec3 vN,vV;
void main(){float h=vUv.y;float band=fract(vUv.x*radius*.85+h*4.-time*.45);float stripe=smoothstep(.42,.5,band)-smoothstep(.92,1.,band);
 float fres=pow(1.-abs(dot(normalize(vN),normalize(vV))),2.);float fade=pow(1.-h,2.2);
 float a=(.06+.15*stripe+.2*fres)*fade+smoothstep(.06,.0,h)*.75;
 gl_FragColor=vec4(color*(.95+stripe*.45+smoothstep(.06,.0,h)*1.6),clamp(a,0.,.85));
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
const ZONE_VS =
  "varying vec2 vUv;varying vec3 vN,vV;void main(){vUv=uv;vec4 wp=modelMatrix*vec4(position,1.);vN=mat3(modelMatrix)*normal;vV=cameraPosition-wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}";
const PILLAR_FS = `uniform vec3 color;uniform float time;varying vec2 vUv;void main(){float a=pow(1.-vUv.y,2.)*(.3+.1*sin(time*4.+vUv.y*9.))*(.8+.2*sin(vUv.x*6.2832*3.+time*2.));gl_FragColor=vec4(color*1.35,a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
const pillarMats = new Map();
function pillarMat(color) {
  let m = pillarMats.get(color);
  if (!m) {
    m = keepM(
      new T.ShaderMaterial({
        uniforms: { color: { value: new T.Color(color) }, time: { value: 0 } },
        vertexShader: QUAD_VS,
        fragmentShader: PILLAR_FS,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
      }),
    );
    pillarMats.set(color, m);
  }
  return m;
}
const pillarG = keepG(new T.CylinderGeometry(0.22, 0.4, 1, 20, 1, true).translate(0, 0.5, 0));
const ringMats = new Map();
function ringMat(color) {
  let m = ringMats.get(color);
  if (!m) {
    m = keepM(
      new T.MeshBasicMaterial({
        color: new T.Color(color).multiplyScalar(1.25),
        map: tex.glowRing,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
    );
    ringMats.set(color, m);
  }
  return m;
}

// ---------- post-processing: ink outlines + grading, bloom, tone mapping, FXAA ----------
const PassBase = Object.getPrototypeOf(GX.OutputPass.prototype).constructor;
const FSQuad = (() => {
  const p = new GX.OutputPass(),
    C = p.fsQuad.constructor;
  p.dispose();
  return C;
})();
const INK_FS = `#include <packing>
uniform sampler2D tDiffuse,tNormal,tDepth;uniform vec2 resolution;uniform float cameraNear,cameraFar,thickness,inkAmount,saturation,vignette;uniform vec3 ink;varying vec2 vUv;
float vd(vec2 uv){return -perspectiveDepthToViewZ(texture2D(tDepth,uv).x,cameraNear,cameraFar);}
vec3 vn(vec2 uv){return texture2D(tNormal,uv).xyz*2.-1.;}
void main(){
 vec2 px=thickness/resolution,ox=vec2(px.x,0.),oy=vec2(0.,px.y);
 float dc=vd(vUv),ic=1./dc;
 float l=1./vd(vUv-ox),r=1./vd(vUv+ox),d=1./vd(vUv-oy),u=1./vd(vUv+oy);
 float a1=1./vd(vUv-ox-oy),a2=1./vd(vUv+ox+oy),b1=1./vd(vUv+ox-oy),b2=1./vd(vUv-ox+oy);
 float lap=(abs(l+r-2.*ic)+abs(d+u-2.*ic)+.5*abs(a1+a2-2.*ic)+.5*abs(b1+b2-2.*ic))/ic;
 float de=smoothstep(.025,.075,lap);
 vec3 nc=vn(vUv);
 float nd=max(max(1.-dot(nc,vn(vUv-ox)),1.-dot(nc,vn(vUv+ox))),max(1.-dot(nc,vn(vUv-oy)),1.-dot(nc,vn(vUv+oy))));
 float ne=smoothstep(.32,.58,nd);
 float e=max(de,ne)*inkAmount*(1.-.7*smoothstep(30.,170.,dc));
 vec4 c=texture2D(tDiffuse,vUv);
 c.rgb=mix(c.rgb,mix(c.rgb*.22,ink,.5),e);
 float lum=dot(c.rgb,vec3(.2126,.7152,.0722)),mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b));
 c.rgb=max(mix(vec3(lum),c.rgb,saturation+(1.-clamp((mx-mn)/(mx+1e-3),0.,1.))*.14),0.);
 vec2 q=vUv-.5;c.rgb*=1.-vignette*dot(q,q)*1.5;
 gl_FragColor=c;
}`;
class InkPass extends PassBase {
  constructor() {
    super();
    this.target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, minFilter: T.NearestFilter, magFilter: T.NearestFilter });
    this.target.depthTexture = new T.DepthTexture(1, 1, T.FloatType);
    this.normalMat = new T.MeshNormalMaterial({ side: T.DoubleSide });
    this.uniforms = {
      tDiffuse: { value: null },
      tNormal: { value: this.target.texture },
      tDepth: { value: this.target.depthTexture },
      resolution: { value: new T.Vector2(1, 1) },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      thickness: { value: 1 },
      ink: { value: new T.Color("#231a3f") },
      inkAmount: { value: 1 },
      saturation: { value: 1.16 },
      vignette: { value: 0.3 },
    };
    this.material = new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: QUAD_VS, fragmentShader: INK_FS });
    this.fsQuad = new FSQuad(this.material);
  }
  setSize(w, h) {
    this.target.setSize(w, h);
    this.uniforms.resolution.value.set(w, h);
  }
  render(r, writeBuffer, readBuffer) {
    const bg = scene.background,
      mask = camera.layers.mask,
      alpha = r.getClearAlpha(),
      clear = r.getClearColor(new T.Color());
    scene.background = null;
    scene.overrideMaterial = this.normalMat;
    camera.layers.set(0);
    r.setRenderTarget(this.target);
    r.setClearColor(0x8080ff, 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    scene.overrideMaterial = null;
    scene.background = bg;
    camera.layers.mask = mask;
    r.setClearColor(clear, alpha);
    const u = this.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(r);
  }
  dispose() {
    this.target.dispose();
    this.normalMat.dispose();
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
const FXAA_FS = `uniform sampler2D tDiffuse;uniform vec2 rcp;varying vec2 vUv;
void main(){vec3 L=vec3(.299,.587,.114);
 vec3 nw=texture2D(tDiffuse,vUv+vec2(-1.,-1.)*rcp).rgb,ne=texture2D(tDiffuse,vUv+vec2(1.,-1.)*rcp).rgb,sw=texture2D(tDiffuse,vUv+vec2(-1.,1.)*rcp).rgb,se=texture2D(tDiffuse,vUv+vec2(1.,1.)*rcp).rgb;vec4 m=texture2D(tDiffuse,vUv);
 float lnw=dot(nw,L),lne=dot(ne,L),lsw=dot(sw,L),lse=dot(se,L),lm=dot(m.rgb,L),lmin=min(lm,min(min(lnw,lne),min(lsw,lse))),lmax=max(lm,max(max(lnw,lne),max(lsw,lse)));
 vec2 dir=vec2(-((lnw+lne)-(lsw+lse)),(lnw+lsw)-(lne+lse));float red=max((lnw+lne+lsw+lse)*.03125,1./128.);float rmin=1./(min(abs(dir.x),abs(dir.y))+red);dir=clamp(dir*rmin,vec2(-8.),vec2(8.))*rcp;
 vec3 a=.5*(texture2D(tDiffuse,vUv+dir*(1./3.-.5)).rgb+texture2D(tDiffuse,vUv+dir*(2./3.-.5)).rgb);vec3 b=a*.5+.25*(texture2D(tDiffuse,vUv-dir*.5).rgb+texture2D(tDiffuse,vUv+dir*.5).rgb);float lb=dot(b,L);
 gl_FragColor=vec4((lb<lmin||lb>lmax)?a:b,1.);}`;
class FxaaPass extends PassBase {
  constructor() {
    super();
    this.uniforms = { tDiffuse: { value: null }, rcp: { value: new T.Vector2(1, 1) } };
    this.material = new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: QUAD_VS, fragmentShader: FXAA_FS });
    this.fsQuad = new FSQuad(this.material);
  }
  setSize(w, h) {
    this.uniforms.rcp.value.set(1 / w, 1 / h);
  }
  render(r, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(r);
  }
  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
const composer = new GX.EffectComposer(renderer, new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 4 }));
const renderPass = new GX.RenderPass(scene, camera),
  inkPass = new InkPass(),
  bloomPass = new GX.UnrealBloomPass(new T.Vector2(256, 256), 0.55, 0.5, 1.22),
  outputPass = new GX.OutputPass(),
  fxaaPass = new FxaaPass();
for (const p of [renderPass, inkPass, bloomPass, outputPass, fxaaPass]) composer.addPass(p);
// ---------- arenas ----------
const texMat = {
  wood: keepM(toonMat("#ffffff", { map: tex.wood, rim: 0 })),
  tiles: keepM(toonMat("#ffffff", { map: tex.tiles, gloss: 0.45, rim: 0 })),
  checker: keepM(toonMat("#ffffff", { map: tex.checker, gloss: 0.25, rim: 0 })),
  gingham: keepM(toonMat("#ffffff", { map: tex.gingham, rim: 0.2 })),
  bread: keepM(toonMat("#ffffff", { map: tex.bread, rim: 0.2 })),
  latte: keepM(toonMat("#ffffff", { map: tex.latte, gloss: 0.85, rim: 0 })),
  clock: keepM(toonMat("#ffffff", { map: tex.clock, rim: 0 })),
  drawing: keepM(toonMat("#ffffff", { map: tex.drawing, rim: 0 })),
  lawn: keepM(toonMat("#ffffff", { map: tex.lawn, vc: true, rim: 0 })),
  windowDay: keepM(new T.MeshBasicMaterial({ map: tex.windowDay })),
  windowNight: keepM(new T.MeshBasicMaterial({ map: tex.windowNight })),
};
function scaleUV(g, u, v) {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * u, a.getY(i) * v);
  return g;
}
const leafG = cg("leaf", () => {
  const vs = [],
    uv = [],
    ix = [],
    N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N,
      w = Math.pow(Math.sin(Math.PI * t), 0.8) * 0.55;
    for (let j = 0; j < 3; j++) {
      const s = j - 1;
      vs.push(s * w, t * 2, Math.sin(t * Math.PI) * 0.18 + Math.abs(s) * 0.12);
      uv.push(j / 2, t);
    }
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j,
        b = a + 3;
      ix.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(vs, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
});
function rockG(n) {
  return cg("rock" + n, () => {
    seed(n * 31 + 7);
    const g = new T.IcosahedronGeometry(1, 1),
      p = g.attributes.position,
      d = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i).toFixed(3) + "," + p.getY(i).toFixed(3) + "," + p.getZ(i).toFixed(3);
      if (!d.has(k)) d.set(k, pr(0.8, 1.12));
      const s = d.get(k);
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
    }
    g.computeVertexNormals();
    return g;
  });
}
function labelMesh(parent, text, bg, ink, radiusTop, radiusBottom, h, y, arc = 1.8, o = {}) {
  const m = new T.Mesh(
    new T.CylinderGeometry(radiusTop, radiusBottom, h, 48, 1, true, -arc / 2, arc),
    toonMat("#ffffff", { map: labelTex(text, bg, ink, 512, 256, o), rim: 0.3 }),
  );
  m.position.y = y;
  m.castShadow = false;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function setupLights(night, kind) {
  for (const o of scene.children.filter((o) => o.isLight)) {
    o.shadow?.map?.dispose();
    scene.remove(o);
  }
  const garden = kind === "garden",
    kids = kind === "kidsroom",
    bath = kind === "bathroom";
  hemi = new T.HemisphereLight(
    night ? "#4a5cb8" : garden ? "#cfe8ff" : kids ? "#e3eeff" : bath ? "#e6f6ff" : "#dbeaff",
    night ? "#221d3a" : garden ? "#a6e07e" : kids ? "#ffe0c4" : bath ? "#d2f0ee" : "#ffd9b0",
    night ? 1.1 : kids ? 1.3 : bath ? 1.32 : 1.38,
  );
  scene.add(hemi);
  sun = new T.DirectionalLight(night ? "#a9c0ff" : "#fff1d9", night ? 1.25 : 1.9);
  // The bathroom's light comes through the window on the front wall.
  if (night) sun.position.set(bath ? 16 : 14, 44, bath ? 40 : -40);
  else if (kids) sun.position.set(-26, 52, -30);
  else if (bath) sun.position.set(20, 50, 34);
  else sun.position.set(-24, 44, 18);
  sun.castShadow = true;
  const S = sun.shadow.camera;
  S.left = -48;
  S.right = 48;
  S.top = 48;
  S.bottom = -48;
  S.near = 1;
  S.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  applyShadowQuality();
  scene.add(sun);
}
function applyShadowQuality() {
  if (!sun) return;
  const q = profile.quality,
    s = q === "low" ? 1024 : q === "high" ? 2048 : 4096;
  if (sun.shadow.mapSize.x !== s) {
    sun.shadow.mapSize.set(s, s);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  sun.shadow.radius = q === "ultra" ? 2.5 : 2;
}
function makeSky(night) {
  const u = {
    top: { value: new T.Color(night ? "#0d1238" : "#2f8fff") },
    mid: { value: new T.Color(night ? "#39408a" : "#bfe8ff") },
    bottom: { value: new T.Color(night ? "#1a1c3a" : "#dff3ff") },
    sunDir: { value: sun.position.clone().normalize() },
    sunCol: { value: new T.Color(night ? "#fff4cf" : "#fff3c0") },
    cloudLit: { value: new T.Color(night ? "#5a64a8" : "#ffffff") },
    cloudShade: { value: new T.Color(night ? "#2c3170" : "#c9dcf5") },
    time: { value: 0 },
    night: { value: night ? 1 : 0 },
  };
  sky = new T.Mesh(
    new T.SphereGeometry(900, 48, 24),
    new T.ShaderMaterial({
      uniforms: u,
      vertexShader:
        "varying vec3 vDir;void main(){vDir=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}",
      fragmentShader: SKY_FS,
      side: T.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  sky.renderOrder = 999;
  sky.frustumCulled = false;
  sky.layers.set(FX);
  scene.add(sky);
}

function buildKitchen(night) {
  const R = new Builder(),
    A = new Builder();
  // Table: textured top, rounded lip, legs.
  const top = mesh(G.box, texMat.wood, world, 0, -1.2, 0);
  top.scale.set(66, 2.4, 66);
  solids.push(top);
  for (const s of [-1, 1]) {
    A.rod([-33, -1.25, s * 33], [33, -1.25, s * 33], 1.25, "#e7a462");
    A.rod([s * 33, -1.25, -33], [s * 33, -1.25, 33], 1.25, "#e7a462");
    for (const t of [-1, 1]) A.sphere(s * 33, -1.25, t * 33, 1.25, 1.25, 1.25, "#e7a462");
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      R.cyl(sx * 28, -12.3, sz * 28, 1.9, 19.6, "#d98f4f");
      R.cyl(sx * 28, -21.4, sz * 28, 2.3, 1.2, "#b86f36");
      R.box(sx * 28, -4.2, 0, 1.2, 3, 54, "#d98f4f");
      R.box(0, -4.2, sz * 28, 54, 3, 1.2, "#d98f4f");
    }
  // Room shell.
  const floor = mesh(scaleUV(new T.PlaneGeometry(240, 240), 15, 15), texMat.checker, world, 0, -22, 0);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  const wall = night ? "#c9b8e8" : "#ffeccb",
    trim = "#fffaf0";
  R.box(0, 12, -50.5, 102, 70, 1, wall);
  R.box(-50.5, 12, 0, 1, 70, 102, wall);
  R.box(50.5, 12, 0, 1, 70, 102, wall);
  R.box(0, 12, 50.5, 102, 70, 1, wall);
  R.box(0, 47, 0, 102, 1, 102, "#fff8ea");
  for (const [x, z, w, d] of [
    [0, -49.8, 100, 0.6],
    [-49.8, 0, 0.6, 100],
    [49.8, 0, 0.6, 100],
    [0, 49.8, 100, 0.6],
  ])
    R.box(x, -20.8, z, w, 2.4, d, trim);
  // Counter, cabinets and backsplash tiles along the back wall.
  const teal = "#4fc2b3",
    tealL = "#6fd6c7";
  R.box(0, -9, -45, 99, 26, 9, teal);
  R.rbox(0, 4.7, -44.6, 100, 1.3, 11.4, 0.35, "#e39e5c", 0.2);
  for (let i = 0; i < 7; i++) {
    const x = -42 + i * 14;
    R.rbox(x, -8.5, -40.35, 12.6, 22, 0.8, 0.35, tealL, 0.3);
    R.sphere(x + (i % 2 ? -4.6 : 4.6), -3, -39.8, 0.7, 0.7, 0.7, "#fff3dc", 0.8);
  }
  const tiles = mesh(scaleUV(new T.PlaneGeometry(100, 9), 11.4, 1.02), texMat.tiles, world, 0, 9.7, -49.95);
  tiles.castShadow = false;
  // Window with a painted garden view.
  const view = mesh(new T.PlaneGeometry(28, 20), night ? texMat.windowNight : texMat.windowDay, world, 5, 24.2, -49.9);
  view.castShadow = false;
  view.receiveShadow = false;
  R.box(5, 34.6, -49.2, 30.4, 1.6, 1.6, trim);
  R.box(5, 13.8, -49.2, 30.4, 1.6, 1.6, trim);
  R.box(-9.4, 24.2, -49.2, 1.6, 22.4, 1.6, trim);
  R.box(19.4, 24.2, -49.2, 1.6, 22.4, 1.6, trim);
  R.box(5, 24.2, -49.3, 0.9, 20, 1.1, trim);
  R.box(5, 24.2, -49.3, 28, 0.9, 1.1, trim);
  R.rbox(5, 13.6, -48, 33, 1, 3.6, 0.3, trim, 0.3);
  R.rod([-15, 36.4, -48.6], [25, 36.4, -48.6], 0.35, "#c7ccd6", 1);
  for (const s of [-1, 1])
    for (let i = 0; i < 5; i++) {
      R.cyl(5 + s * (16.5 + i * 1.4), 24.6, -48.2 + (i % 2) * 0.4, 0.95, 23, i % 2 ? "#ffffff" : "#ff5c6c", 0.1);
    }
  // Upper cabinets, shelf with plates, wall clock.
  R.box(-31, 27, -47, 34, 15, 6, teal);
  for (let i = 0; i < 2; i++) {
    R.rbox(-39 + i * 16, 27, -43.8, 15, 13.2, 0.7, 0.3, tealL, 0.3);
    R.sphere(-33.5 + i * 5, 23, -43.3, 0.6, 0.6, 0.6, "#fff3dc", 0.8);
  }
  R.rbox(35, 21, -47, 24, 1, 5, 0.2, "#e39e5c");
  for (let i = 0; i < 4; i++)
    R.cyl(26 + i * 5.6, 24.6, -47.8, 2.6, 0.5, ["#ff8fab", "#8ecae6", "#ffd166", "#b8f2a0"][i], 0.5, [Math.PI / 2, 0, 0]);
  const clock = mesh(G.circle, texMat.clock, world, 33, 34, -49.9);
  clock.scale.setScalar(4.2);
  clock.castShadow = false;
  R.torus(33, 34, -49.7, 4.4, 0.45, "#ff6b6b", 0.4);
  const handG = cg("handG", () => new T.BoxGeometry(1, 1, 1).translate(0, 0.45, 0)),
    hands = group(world, 33, 34, -49.6),
    hourHand = mesh(handG, material("#3a2f5b"), hands, 0, 0, 0),
    minHand = mesh(handG, material("#3a2f5b"), hands, 0, 0, 0.05);
  hourHand.scale.set(0.35, 2.4, 0.12);
  minHand.scale.set(0.25, 3.4, 0.12);
  hourHand.castShadow = minHand.castShadow = false;
  animated.push(() => {
    const d = new Date(),
      m = d.getMinutes() + d.getSeconds() / 60,
      hr = (d.getHours() % 12) + m / 60;
    minHand.rotation.z = (-m / 60) * Math.PI * 2;
    hourHand.rotation.z = (-hr / 12) * Math.PI * 2;
  });
  // Counter props: toaster, fruit bowl, cookie jar, herbs on the sill.
  R.rbox(-30, 8.7, -44, 8.5, 6.4, 5.2, 1.2, "#ff6b6b", 0.85);
  R.box(-31.8, 11.9, -44, 1.4, 0.2, 3.6, "#3a2f5b");
  R.box(-28.2, 11.9, -44, 1.4, 0.2, 3.6, "#3a2f5b");
  R.rbox(-31.8, 12.2, -44, 1.1, 1.5, 3.1, 0.3, "#f3b061");
  R.rbox(-28.2, 12.4, -44, 1.1, 1.9, 3.1, 0.3, "#f3b061");
  R.box(-25.6, 9.5, -44, 0.5, 0.5, 1.4, "#3a2f5b");
  R.put(
    new T.SphereGeometry(4.2, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    [30, 9.6, -43.5],
    [0, 0, 0],
    [1, 0.75, 1],
    "#4d9de0",
    0.7,
  );
  R.torus(30, 9.6, -43.5, 4.1, 0.25, "#7cc0ff", 0.6, [Math.PI / 2, 0, 0]);
  R.sphere(28.4, 10.4, -43.2, 1.5, 1.4, 1.5, "#ff4d4d", 0.7);
  R.rod([28.4, 11.7, -43.2], [28.6, 12.4, -43.2], 0.12, "#6b3e22");
  R.sphere(29, 12.3, -43.2, 0.55, 0.18, 0.3, "#46c35a", 0, [0, 0, 0.6]);
  R.sphere(31.6, 10.3, -44.4, 1.4, 1.4, 1.4, "#ffa62b", 0.3);
  R.sphere(30.2, 10.1, -41.9, 1.2, 1.2, 1.2, "#b56cff", 0.6);
  R.put(
    new T.TubeGeometry(
      new T.CatmullRomCurve3([v3(26.6, 10.4, -44), v3(28.2, 11.4, -45.3), v3(30.8, 11.6, -45.6), v3(33, 10.6, -44.6)]),
      20,
      0.55,
      10,
    ),
    [0, 0, 0],
    [0, 0, 0],
    [1, 1, 1],
    "#ffe14d",
    0.3,
  );
  R.cyl(-12, 9.6, -44.5, 2.4, 8.6, "#dff4ff", 0.9);
  R.cyl(-12, 14.3, -44.5, 2.6, 1, "#ff9f1c", 0.5);
  R.sphere(-12, 15, -44.5, 0.7, 0.5, 0.7, "#fff3dc", 0.6);
  for (let i = 0; i < 3; i++) R.cyl(-12, 7 + i * 2.1, -42.3, 1.6, 0.7, "#c98b52", 0, [Math.PI / 2, 0, 0]);
  for (const hx of [12, 20]) {
    R.cyl(hx, 15.9, -47.3, 1.6, 2.6, "#e2725b");
    R.torus(hx, 17.2, -47.3, 1.6, 0.25, "#f4a261", 0, [Math.PI / 2, 0, 0]);
    for (let j = 0; j < 7; j++) {
      const a = j * 2.4;
      R.rod([hx, 16.8, -47.3], [hx + Math.cos(a) * 1.5, 20 + (j % 2), -47.3 + Math.sin(a) * 1.2], 0.08, "#4d9a3e");
      R.sphere(hx + Math.cos(a) * 1.5, 20 + (j % 2), -47.3 + Math.sin(a) * 1.2, 0.9, 0.22, 0.5, "#5dcf6a", 0, [0, a, 0]);
    }
  }
  // Right wall fridge with magnets and a drawing; left wall shelves; front door and a painting.
  R.rbox(44, 6, -18, 11, 56, 24, 1.4, "#ffb3c6", 0.55);
  R.box(38.4, 16, -18, 0.2, 0.4, 23, "#e68aa2");
  R.rod([38.2, 20, -8.5], [38.2, 30, -8.5], 0.45, "#e8eef5", 1);
  R.rod([38.2, 5, -8.5], [38.2, 13, -8.5], 0.45, "#e8eef5", 1);
  for (let i = 0; i < 6; i++)
    R.sphere(
      38.4,
      24 + (i % 3) * 2.6,
      -24 + Math.floor(i / 3) * 3.4,
      0.7,
      0.7,
      0.25,
      ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93", "#ff924c"][i],
      0.8,
      [0, Math.PI / 2, 0],
    );
  const drawing = mesh(new T.PlaneGeometry(7, 8.8), texMat.drawing, world, 38.3, 8, -22);
  drawing.rotation.y = -Math.PI / 2;
  drawing.castShadow = false;
  for (const y of [8, 18]) {
    R.rbox(-47, y, 0, 5, 0.8, 34, 0.2, "#e39e5c");
  }
  for (let i = 0; i < 5; i++) {
    R.cyl(-47, 9.9, -12 + i * 5.5, 1.3, 2.6, ["#ff8fab", "#8ecae6", "#ffd166", "#b8f2a0", "#cdb4db"][i], 0.6);
    R.torus(-45.6, 9.9, -12 + i * 5.5, 0.8, 0.18, ["#ff8fab", "#8ecae6", "#ffd166", "#b8f2a0", "#cdb4db"][i], 0.6, [0, Math.PI / 2, 0]);
  }
  for (let i = 0; i < 6; i++)
    R.rbox(
      -47,
      21.6,
      -12 + i * 2.2,
      3.2,
      6.2 + (i % 3),
      1.8,
      0.2,
      ["#ef476f", "#06d6a0", "#118ab2", "#ffd166", "#8338ec", "#ff9f1c"][i],
      0.2,
    );
  R.cyl(-47, 20.2, 10, 1.8, 2.6, "#e2725b");
  R.capsule(-47, 23.2, 10, 1, 2.4, "#3fae6a", 0.2);
  R.sphere(-47, 25.3, 10, 0.7, 0.5, 0.7, "#ff6fb5", 0.4);
  R.rbox(-20, -2, 49.6, 17, 40, 1.2, 0.5, "#7aa7ff", 0.3);
  R.rbox(-20, -2, 49.1, 13, 34, 0.6, 0.4, "#96bbff", 0.3);
  R.sphere(-26, -2, 48.6, 0.9, 0.9, 0.9, "#ffd166", 0.9);
  R.rbox(16, 22, 49.6, 23, 16, 0.9, 0.4, "#b5652f", 0.3);
  const art = mesh(new T.PlaneGeometry(20, 13), texMat.windowDay, world, 16, 22, 49.05);
  art.rotation.y = Math.PI;
  art.castShadow = false;
  // Pendant lamp.
  R.rod([0, 47, 0], [0, 35, 0], 0.12, "#3a2f5b");
  A.put(new T.CylinderGeometry(1.3, 4.6, 3.6, 32, 1, true), [0, 33.6, 0], [0, 0, 0], [1, 1, 1], "#ff9f1c", 0.6);
  const bulb = mesh(G.sphere, night ? glow("#ffd48a", 3.2) : material("#fff4d6", 0.2), world, 0, 32.2, 0);
  bulb.scale.setScalar(1.05);
  bulb.castShadow = false;
  if (night) bulb.layers.set(FX);
  // ----- arena props -----
  makeMug(-10, -7, "#34c3d0", "TAKE IT\nSLOW", null);
  makeMug(22, 15, "#ff6f59", "", { dots: "#fff4e6" });
  makePlate(11, -13);
  makeBread(8.8, -13);
  A.rbox(-16, 0.2, 14, 13, 0.4, 8, 0.15, "#d99a5c", 0.2, [0, -0.2, 0]);
  A.torus(-22.3, 0.25, 15.3, 0.55, 0.15, "#b0703d", 0, [Math.PI / 2, 0, 0]);
  const cheese = new Builder();
  cheese.at([-16, 1.5, 14], [0, -0.2, 0], [1, 1, 1], (b) => {
    b.rbox(0, 0, 0, 5, 2.6, 3.7, 0.28, "#ffd23f", 0.25);
    for (const [x, z, s] of [
      [-1.5, 0.8, 0.35],
      [0.6, -0.9, 0.28],
      [1.6, 0.9, 0.22],
      [-0.4, 0.2, 0.18],
    ])
      b.sphere(x, 1.3, z, s * 1.2, 0.12, s, "#eab11b");
    for (const [x, y, s] of [
      [-1.2, -0.2, 0.3],
      [1, 0.5, 0.22],
      [0.1, -0.7, 0.2],
    ])
      b.sphere(x, y, 1.85, s, s, 0.12, "#eab11b");
  });
  const cheeseMesh = cheese.mesh(worldMat, world);
  solids.push(cheeseMesh);
  addObstacle(-16, 14, 3, 2.9);
  A.at([-11.4, 0.46, 16.4], [0, 0.35, 0], [1, 1, 1], (b) => {
    b.rbox(0, 0, 0, 0.9, 0.3, 3.2, 0.12, "#8b5a2b", 0.2);
    b.box(0, 0, 2.55, 1.1, 0.08, 2.5, "#dfe7ee", 1);
    b.box(0.2, 0, 3.9, 0.7, 0.08, 0.6, "#dfe7ee", 1, [0, 0.5, 0]);
  });
  makeKettle(22, -24);
  makeJar(-25, -24, "#b5652f", "#ffcc4d", "CINNAMON");
  makeJar(-25, 2, "#6cc24a", "#ff7b54", "HERBS");
  makeJar(26, -3, "#f4f1e8", "#4dabf7", "SEA\nSALT");
  const books = new Builder(),
    bc = ["#ef476f", "#06d6a0", "#118ab2"];
  for (let i = 0; i < 3; i++) {
    books.at([0, 0.4 + i * 0.65, 24 + i * 0.4], [0, i * 0.12, 0], [1, 1, 1], (b) => {
      b.rbox(0, 0, 0, 6.8, 0.62, 4.5, 0.14, bc[i], 0.35);
      b.rbox(0.15, 0, 0, 6.5, 0.4, 4.32, 0.05, "#fff4dc");
      b.box(-3.3, 0.02, 0, 0.25, 0.66, 4.52, "#ffffff", 0.2);
    });
    addObstacle(0, 24 + i * 0.4, 3, 2.2);
  }
  const bookMesh = books.mesh(worldMat, world);
  solids.push(bookMesh);
  A.box(1.5, 1.9, 25.2, 0.3, 0.05, 2.2, "#ffd166", 0, [0, 0.24, 0]);
  const napkin = mesh(G.box, texMat.gingham, world, -5, 0.05, 7);
  napkin.scale.set(7, 0.08, 6);
  napkin.rotation.y = 0.22;
  napkin.castShadow = false;
  A.at([3, 0.22, 6], [0, 0.8, 0], [1, 1, 1], (b) => {
    b.rod([0, 0, -4], [0, 0, 2.2], 0.14, "#dfe7ee", 1);
    b.rbox(0, 0, 2.8, 1.5, 0.18, 1.5, 0.08, "#dfe7ee", 1);
    for (let i = -1.5; i <= 1.5; i++) b.rod([i * 0.34, 0, 3.2], [i * 0.34, 0, 5], 0.07, "#dfe7ee", 1);
  });
  seed(99);
  for (let i = 0; i < 70; i++) {
    const x = Math.sin(i * 13.1) * 29,
      z = Math.cos(i * 7.7) * 29;
    A.sphere(x, 0.08, z, 0.1 + (i % 3) * 0.05, 0.09, 0.12, i % 4 ? "#f0c27a" : "#dca25c", 0, [0, i, 0], true);
  }
  R.mesh(worldMat, world, { cast: false });
  A.mesh(worldMat, world);
  if (night) {
    const lamp = new T.PointLight("#ffc978", 650, 110, 1.6);
    lamp.position.set(0, 30.5, 0);
    scene.add(lamp);
  }
}
function makeMug(x, z, color, text, band) {
  const g = group(world, x, 0, z);
  g.rotation.y = -0.22;
  const pts = [
    [0, 0],
    [2.2, 0],
    [2.55, 0.2],
    [2.9, 4.7],
    [2.85, 5.2],
    [2.67, 5.27],
    [2.5, 5.1],
    [2.55, 4.8],
    [2.25, 0.55],
    [0, 0.55],
  ].map((p) => new T.Vector2(...p));
  const body = new Builder().geom(new T.LatheGeometry(pts, 64), color, 0.9).mesh(worldMat, g);
  addObstacle(x, z, 3, 5.3, body);
  const d = new Builder();
  d.torus(3.05, 2.7, 0, 1.65, 0.36, color, 0.9);
  d.torus(0, 5.19, 0, 2.69, 0.09, "#fff6e6", 0.7, [Math.PI / 2, 0, 0]);
  d.mesh(worldMat, g);
  const coffee = mesh(G.circle, texMat.latte, g, 0, 4.8, 0);
  coffee.rotation.x = -Math.PI / 2;
  coffee.scale.setScalar(2.47);
  coffee.castShadow = false;
  labelMesh(g, text, color, "#fff7e6", 2.862, 2.675, 2.4, 2.75, 1.9, band || {});
  const a = -0.22,
    hx = x + Math.cos(a) * 4.1,
    hz = z - Math.sin(a) * 4.1;
  addObstacle(hx, hz, 0.9, 4.7);
}
function makePlate(x, z) {
  const p = [
    [0, 0],
    [4.7, 0],
    [6, 0.24],
    [6.3, 0.55],
    [6.1, 0.7],
    [5.7, 0.61],
    [4.9, 0.24],
    [0, 0.23],
  ].map((v) => new T.Vector2(...v));
  const b = new Builder();
  b.geom(new T.LatheGeometry(p, 80), "#f6f2ea", 0.75);
  b.torus(0, 0.6, 0, 5.98, 0.07, "#4d9de0", 0.6, [Math.PI / 2, 0, 0]);
  b.torus(0, 0.25, 0, 3.6, 0.05, "#8ecae6", 0.4, [Math.PI / 2, 0, 0]);
  const m = b.mesh(worldMat, world);
  m.position.set(x, 0.04, z);
}
function makeBread(x, z) {
  const b = new Builder();
  for (let i = 0; i < 3; i++) {
    const px = x + i * 1.25,
      pz = z + i * 0.15;
    b.at([px, 0.92, pz], [0, -0.3 + i * 0.16, 0], [1, 1, 1], (q) => {
      q.rbox(0, 0, 0, 2.7, 0.75, 3.9, 0.26, "#d98b3f", 0.2);
      if (i === 1) q.rbox(0.1, 0.5, -0.2, 1, 0.32, 0.8, 0.12, "#fff07a", 0.6);
    });
    const inner = mesh(roundedG(2.3, 0.08, 3.45, 0.04), texMat.bread, world, px, 1.32, pz);
    inner.rotation.y = -0.3 + i * 0.16;
    inner.castShadow = false;
    addObstacle(px, pz, 1.55, 1.4);
  }
  const m = b.mesh(worldMat, world);
  solids.push(m);
}
function makeKettle(x, z) {
  const g = group(world, x, 0, z),
    b = new Builder();
  b.geom(
    new T.LatheGeometry(
      [
        [0, 0],
        [2.8, 0],
        [3.65, 0.6],
        [4, 2.4],
        [3.9, 4.5],
        [3.1, 6],
        [2, 6.5],
        [0, 6.5],
      ].map((p) => new T.Vector2(...p)),
      64,
    ),
    "#ff4f5e",
    0.95,
  );
  const body = b.mesh(worldMat, g);
  addObstacle(x, z, 4.25, 7, body);
  const d = new Builder();
  d.cyl(0, 0.2, 0, 3.1, 0.4, "#3a2f5b", 0.4);
  d.put(
    new T.TubeGeometry(new T.CatmullRomCurve3([v3(-2.6, 1.8, 0), v3(-4.7, 3, 0), v3(-6, 5, 0), v3(-7.1, 5.6, 0)]), 28, 0.68, 20),
    [0, 0, 0],
    [0, 0, 0],
    [1, 1, 1],
    "#ff4f5e",
    0.95,
  );
  d.torus(-7.15, 5.63, 0, 0.62, 0.14, "#3a2f5b", 0.4, [0, 0, 0.9 + Math.PI / 2]);
  d.put(torusG(2.8, 0.42, Math.PI * 1.25), [3.65, 3.4, 0], [0, 0, -Math.PI * 0.62], [0.68, 1, 1], "#3a2f5b", 0.3);
  d.mesh(worldMat, g);
  const lid = group(g, 0, 6.5, 0),
    l = new Builder();
  l.cyl(0, 0.12, 0, 2.3, 0.3, "#ff6b76", 0.9);
  l.sphere(0, 0.62, 0, 0.62, 0.5, 0.62, "#fff3dc", 0.8);
  l.mesh(worldMat, lid);
  animated.push(() => {
    const cyc = time % 36,
      shake = mode !== "menu" && options.arena === "kitchen" && cyc > 23 ? (cyc > 27 ? 1 : 0.45) : 0;
    lid.position.y = 6.5 + Math.abs(Math.sin(worldClock * 28)) * 0.18 * shake;
    lid.rotation.z = Math.sin(worldClock * 21) * 0.05 * shake;
  });
}
function makeJar(x, z, fill, lid, text) {
  const g = group(world, x, 0, z),
    b = new Builder();
  b.cyl(0, 2.2, 0, 1.9, 4.4, fill, 0.25);
  b.torus(0, 0.2, 0, 1.82, 0.14, fill, 0.25, [Math.PI / 2, 0, 0]);
  const body = b.mesh(worldMat, g);
  addObstacle(x, z, 2.1, 4.8, body);
  const d = new Builder();
  d.cyl(0, 4.4, 0, 1.96, 0.35, "#e9f7ff", 0.9);
  d.cyl(0, 4.7, 0, 2.02, 0.5, lid, 0.5);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    d.box(Math.sin(a) * 2.02, 4.7, Math.cos(a) * 2.02, 0.07, 0.46, 0.07, lid, 0.3, [0, a, 0]);
  }
  d.torus(-0.2, 1.2, 1.88, 0.25, 0.05, "#ffffff", 1, [0, 0, 0]);
  d.mesh(worldMat, g);
  labelMesh(g, text, "#fff7e6", "#4a3b2a", 1.93, 1.93, 2.1, 2.3, 1.9, { border: lid });
}

function buildGarden(night) {
  const R = new Builder(),
    A = new Builder();
  // Lawn with mowing stripes (vertex colour) and blade texture.
  const lawn = new T.PlaneGeometry(420, 420, 70, 70).toNonIndexed();
  lawn.rotateX(-Math.PI / 2);
  scaleUV(lawn, 70, 70);
  {
    const p = lawn.attributes.position,
      c = new Float32Array(p.count * 3),
      a = new T.Color(night ? "#4f8a57" : "#8ee061"),
      b2 = new T.Color(night ? "#467f4f" : "#78d052"),
      o = new T.Color(night ? "#4a8452" : "#86d85c");
    for (let i = 0; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
        cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3,
        inside = Math.abs(cx) < 44 && Math.abs(cz) < 44,
        col = inside ? (Math.floor((cx + 420) / 6) % 2 ? a : b2) : o;
      for (let k = 0; k < 3; k++) col.toArray(c, (i + k) * 3);
    }
    lawn.setAttribute("color", new T.BufferAttribute(c, 3));
  }
  const ground = new Builder().geom(lawn, "#ffffff", 0, [0, 0, 0]).mesh(texMat.lawn, world, { cast: false });
  solids.push(ground);
  // Picket fence with posts; bushes, giant flowers, trees and hills beyond.
  for (let s = 0; s < 4; s++) {
    const rot = (s * Math.PI) / 2;
    R.at([0, 0, 0], [0, rot, 0], [1, 1, 1], (b) => {
      for (let i = -22; i <= 22; i++) {
        const x = i * 2;
        b.box(x, 6, -44, 1.2, 12, 0.4, "#fff6e8", 0.1);
        b.put(G.coneLo, [x, 12.6, -44], [0, Math.PI / 4, 0], [0.85, 1.3, 0.3], "#fff6e8", 0.1);
      }
      b.box(0, 4, -44.4, 90, 1, 0.5, "#f2e6d3");
      b.box(0, 9.5, -44.4, 90, 1, 0.5, "#f2e6d3");
      for (let i = -4; i <= 4; i++) {
        b.box(i * 11, 6.8, -44.6, 1.8, 13.6, 1, "#e9dac4");
        b.sphere(i * 11, 14, -44.6, 1.05, 1.05, 1.05, "#f5ecde", 0.2);
      }
    });
  }
  seed(21);
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2,
      r = pr(49, 54),
      x = Math.sin(a) * r,
      z = Math.cos(a) * r,
      s = pr(4, 7);
    R.sphere(x, s * 0.6, z, s, s * 0.85, s, ["#43aa5b", "#52b963", "#3b9c52"][i % 3], 0, [0, 0, 0], true);
    R.sphere(x + pr(-2, 2), s * 1.1, z + pr(-2, 2), s * 0.7, s * 0.6, s * 0.7, "#5cc56d", 0, [0, 0, 0], true);
  }
  const flower = (x, z, h, petal, kind) => {
    R.rod([x, 0, z], [x, h, z], 0.45, "#3f9d4a");
    R.put(leafG, [x, h * 0.3, z], [0, x, 0.9], [3, 3.2, 3], "#4fb45a");
    R.put(leafG, [x, h * 0.5, z], [0, x + 2.6, 0.8], [2.6, 2.8, 2.6], "#4fb45a");
    if (kind === "tulip") {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        R.sphere(x + Math.sin(a) * 0.9, h + 1.6, z + Math.cos(a) * 0.9, 1.5, 2.4, 1.1, petal, 0.3, [0, a, 0.18]);
      }
      R.sphere(x, h + 1.2, z, 1.3, 1.5, 1.3, petal, 0.3);
    } else {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        R.sphere(x + Math.sin(a) * 2.6, h, z + Math.cos(a) * 2.6, 0.8, 0.18, 2, petal, 0.2, [0, a, 0]);
      }
      R.sphere(x, h + 0.15, z, 1.3, 0.6, 1.3, kind === "sun" ? "#7a4a23" : "#ffc93d", 0.2);
    }
  };
  flower(-38, -38, 24, "#ff5d7a", "tulip");
  flower(-35, -40, 19, "#ffd23f", "tulip");
  flower(38, -38, 22, "#ffffff", "daisy");
  flower(40, -34, 17, "#ff9ecb", "daisy");
  flower(-38, 38, 27, "#ffd23f", "sun");
  flower(38, 38, 20, "#b77cff", "tulip");
  flower(35, 40, 16, "#ff7b54", "tulip");
  flower(-40, 33, 15, "#ffffff", "daisy");
  for (const [x, z, s] of [
    [-36, 20, 1],
    [37, -12, 1.3],
    [-34, -18, 0.9],
    [20, 37, 1.1],
    [-12, -37, 1.2],
  ]) {
    R.cyl(x, 1.2 * s, z, 0.7 * s, 2.4 * s, "#fff4e6", 0.1);
    R.sphere(x, 2.6 * s, z, 2.1 * s, 1.3 * s, 2.1 * s, "#ff4d4d", 0.5, [0, 0, 0]);
    for (let k = 0; k < 6; k++) {
      const a = k * 1.1;
      R.sphere(
        x + Math.sin(a) * 1.4 * s,
        2.9 * s + Math.cos(k) * 0.2 * s,
        z + Math.cos(a) * 1.4 * s,
        0.28 * s,
        0.12 * s,
        0.28 * s,
        "#ffffff",
        0.2,
      );
    }
  }
  const far = new Builder();
  seed(33);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + pr(-0.1, 0.1),
      r = pr(95, 150),
      x = Math.sin(a) * r,
      z = Math.cos(a) * r,
      h = pr(40, 70),
      c = ["#3fae5a", "#5cc46a", "#2f9c55", "#6fd36d"][i % 4];
    far.cyl(x, h * 0.4, z, pr(3, 5), h * 0.8, "#8a5a36");
    far.sphere(x, h, z, h * 0.42, h * 0.36, h * 0.42, c, 0, [0, 0, 0], true);
    far.sphere(x + h * 0.2, h * 0.86, z, h * 0.28, h * 0.24, h * 0.28, c, 0, [0, 0, 0], true);
    far.sphere(x - h * 0.18, h * 0.9, z + h * 0.1, h * 0.26, h * 0.22, h * 0.26, c, 0, [0, 0, 0], true);
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2,
      r = pr(330, 420);
    far.sphere(
      Math.sin(a) * r,
      -40,
      Math.cos(a) * r,
      pr(130, 190),
      pr(70, 110),
      pr(130, 190),
      night ? "#27405a" : ["#7fcf6a", "#6cc35f", "#8ed876"][i % 3],
      0,
      [0, 0, 0],
      true,
    );
  }
  far.mesh(worldMat, world, { cast: false, receive: false });
  // Arena: pots, faceted rocks, watering can, stepping stones, sprinkler.
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4,
      x = Math.cos(a) * 22,
      z = Math.sin(a) * 22;
    if (i % 2 === 0) makePot(x, z, i / 2);
    else {
      const b = new Builder();
      b.put(rockG(i), [x, 1.15, z], [0, i, 0], [3.5, 1.7, 2.7], "#a7b8cc", 0.15);
      b.sphere(x - 0.6, 2.55, z + 0.3, 1.6, 0.35, 1.2, "#6fc25a", 0, [0, i, 0]);
      b.sphere(x + 1.2, 2.2, z - 0.6, 0.9, 0.25, 0.8, "#83d66c", 0, [0, i, 0]);
      const rock = b.mesh(worldMat, world);
      addObstacle(x, z, 3, 2.7, rock);
    }
  }
  const can = new Builder();
  can.cyl(24, 3.5, -22, 4, 7, "#3fa7ff", 0.75);
  can.torus(24, 7, -22, 3.9, 0.3, "#2a86e0", 0.6, [Math.PI / 2, 0, 0]);
  can.cyl(24, 0.25, -22, 4.1, 0.5, "#2a86e0", 0.6);
  can.put(torusG(2.6, 0.34, Math.PI), [25.6, 7, -22], [0, 0, -Math.PI / 2 + 0.2], [1, 1.3, 1], "#2a86e0", 0.6);
  can.rod([21, 2.2, -22], [16, 4.5, -22], 0.55, "#3fa7ff", 0.75);
  can.put(G.cone, [15.6, 4.7, -22], [0, 0, Math.PI / 2 + 0.43], [1.1, 1.3, 1.1], "#ffd166", 0.6);
  can.cyl(24, 3.8, -17.95, 1.6, 0.1, "#ffffff", 0.2, [Math.PI / 2, 0, 0]);
  const canMesh = can.mesh(worldMat, world);
  addObstacle(24, -22, 4.5, 7, canMesh);
  for (let i = 0; i < 7; i++) A.cyl(-12 + i * 4, 0.12, Math.sin(i) * 5, 1.6 + (i % 2) * 0.3, 0.24, "#ddd6c6", 0.1, [0, i, 0], true);
  const spr = group(world, 0, 0, 0),
    sb = new Builder();
  sb.cyl(0, 0.3, 0, 1.3, 0.6, "#ffd166", 0.6);
  sb.cyl(0, 0.95, 0, 0.28, 1, "#ffb703", 0.6);
  sb.mesh(worldMat, spr);
  const head = group(spr, 0, 1.5, 0),
    hb = new Builder();
  hb.sphere(0, 0, 0, 0.45, 0.35, 0.45, "#4dabf7", 0.8);
  for (const s of [-1, 1]) {
    hb.rod([0, 0, 0], [0, 0.35, s * 1.4], 0.12, "#4dabf7", 0.8);
    hb.cone(0, 0.42, s * 1.52, 0.18, 0.4, "#1f6fb5", 0.5, [(s * Math.PI) / 2, 0, 0]);
  }
  hb.mesh(worldMat, head);
  const jets = group(head, 0, 0, 0),
    jetMat = new T.MeshBasicMaterial({
      color: new T.Color("#9fe3ff").multiplyScalar(1.3),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
  for (const s of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16,
        r = 1.5 + t * 23;
      pts.push(v3(0, 0.45 + Math.sin(t * Math.PI) * 3.2 - t * 1.6, s * r));
    }
    const j = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 40, 0.14, 8), jetMat);
    j.layers.set(FX);
    jets.add(j);
  }
  animated.push(() => {
    const cyc = time % 36,
      on = mode !== "menu" && options.arena === "garden",
      active = on && cyc > 27,
      warn = on && cyc > 23 && !active;
    head.rotation.y = active ? time * 0.65 : warn ? worldClock * 2.2 : worldClock * 0.2;
    jets.visible = active;
  });
  seed(8);
  const tuftB = new Builder();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + pr(-0.3, 0.3),
      h = pr(0.7, 1.3);
    tuftB.put(
      G.coneLo,
      [Math.sin(a) * 0.14, h / 2, Math.cos(a) * 0.14],
      [Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35],
      [0.07, h, 0.07],
      ["#5cbf45", "#79d45b", "#4aa83c"][k % 3],
    );
  }
  const tuftG = tuftB.build(),
    tufts = new T.InstancedMesh(tuftG, worldMat, 420),
    dm = new T.Object3D();
  let n = 0;
  seed(12);
  for (let i = 0; i < 2000 && n < 420; i++) {
    const x = pr(-31, 31),
      z = pr(-31, 31);
    if (!clearSpot({ x, z }, 0.4)) continue;
    dm.position.set(x, 0, z);
    dm.rotation.set(0, pr(0, 6.3), 0);
    const s = pr(0.45, 1.05);
    dm.scale.set(s, s * pr(0.75, 1.15), s);
    dm.updateMatrix();
    tufts.setMatrixAt(n++, dm.matrix);
  }
  tufts.count = n;
  tufts.receiveShadow = true;
  tufts.layers.set(FX);
  world.add(tufts);
  const tallB = new Builder();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + pr(-0.3, 0.3),
      h = pr(4, 8.5);
    tallB.put(
      G.coneLo,
      [Math.sin(a) * 0.6, h / 2, Math.cos(a) * 0.6],
      [Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3],
      [0.22, h, 0.22],
      ["#4aa83c", "#5cbf45", "#3d9434"][k % 3],
    );
  }
  const tall = new T.InstancedMesh(tallB.build(), worldMat, 160);
  n = 0;
  seed(14);
  for (let i = 0; i < 900 && n < 160; i++) {
    const x = pr(-43, 43),
      z = pr(-43, 43);
    if (Math.max(Math.abs(x), Math.abs(z)) < 34) continue;
    dm.position.set(x, 0, z);
    dm.rotation.set(0, pr(0, 6.3), 0);
    const s = pr(0.7, 1.3);
    dm.scale.set(s, s, s);
    dm.updateMatrix();
    tall.setMatrixAt(n++, dm.matrix);
  }
  tall.count = n;
  tall.castShadow = true;
  tall.receiveShadow = true;
  tall.layers.set(FX);
  world.add(tall);
  const daisyB = new Builder();
  daisyB.rod([0, 0, 0], [0, 1.1, 0], 0.04, "#3f9d4a");
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    daisyB.sphere(Math.sin(a) * 0.2, 1.12, Math.cos(a) * 0.2, 0.07, 0.03, 0.16, "#ffffff", 0.1, [0, a, 0], true);
  }
  daisyB.sphere(0, 1.14, 0, 0.1, 0.06, 0.1, "#ffc93d", 0.3, [0, 0, 0], true);
  const daisies = new T.InstancedMesh(daisyB.build(), worldMat, 90);
  n = 0;
  seed(18);
  for (let i = 0; i < 900 && n < 90; i++) {
    const x = pr(-31, 31),
      z = pr(-31, 31);
    if (!clearSpot({ x, z }, 0.6)) continue;
    dm.position.set(x, 0, z);
    dm.rotation.set(0, pr(0, 6.3), 0);
    const s = pr(0.8, 1.4);
    dm.scale.set(s, s, s);
    dm.updateMatrix();
    daisies.setMatrixAt(n++, dm.matrix);
  }
  daisies.count = n;
  daisies.castShadow = true;
  daisies.receiveShadow = true;
  world.add(daisies);
  R.mesh(worldMat, world, { cast: true });
  A.mesh(worldMat, world);
  if (night) {
    seed(4);
    for (let i = 0; i < 30; i++) {
      const f = mesh(G.sphereLo, glow("#e8ff8a", 3.2), world, pr(-40, 40), pr(1, 6), pr(-40, 40));
      f.scale.setScalar(0.09);
      f.castShadow = false;
      f.layers.set(FX);
      f.userData.base = f.position.clone();
      f.userData.phase = pr(0, 6.28);
      nightLamps.push(f);
    }
    for (const [x, z] of [
      [-40, -40],
      [40, 40],
      [-40, 40],
      [40, -40],
    ]) {
      const pl = new Builder();
      pl.cyl(x, 7, z, 0.35, 14, "#3a2f5b", 0.4);
      pl.put(G.coneLo, [x, 15.4, z], [0, 0, 0], [1.4, 1, 1.4], "#3a2f5b", 0.4);
      pl.mesh(worldMat, world);
      const b = mesh(G.sphere, glow("#ffc978", 3.4), world, x, 14.2, z);
      b.scale.setScalar(0.9);
      b.castShadow = false;
      b.layers.set(FX);
    }
    const lamp = new T.PointLight("#ffc978", 700, 120, 1.5);
    lamp.position.set(-12, 16, -8);
    scene.add(lamp);
  }
}
function makePot(x, z, kind) {
  const g = group(world, x, 0, z),
    b = new Builder();
  b.put(new T.CylinderGeometry(3.4, 2.5, 5.4, 48), [0, 2.7, 0], [0, 0, 0], [1, 1, 1], "#e8744f", 0.2);
  const body = b.mesh(worldMat, g);
  addObstacle(x, z, 3.7, 5.6, body);
  const p = new Builder();
  p.torus(0, 5.35, 0, 3.28, 0.3, "#f59a6b", 0.3, [Math.PI / 2, 0, 0]);
  p.cyl(0, 5.2, 0, 3.14, 0.1, "#6b4226");
  p.torus(0, 1.4, 0, 2.72, 0.12, "#f59a6b", 0.2, [Math.PI / 2, 0, 0]);
  if (kind === 0) {
    p.rod([0, 5, 0], [0, 12, 0], 0.12, "#4d9a3e");
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4;
      p.at([0, 6.3 + i * 0.48, 0], [0, a, 0.75], [1, 1, 1], (q) => {
        q.put(leafG, [0, 0.3, 0], [0, 0, 0], [1.2 + (i % 3) * 0.2, 1.3 + (i % 2) * 0.25, 1], i % 2 ? "#4fc16a" : "#6fd36d", 0.1);
        q.rod([0, 0, 0], [0, 2.5, 0.12], 0.03, "#8bc34a");
      });
    }
  } else if (kind === 1) {
    p.capsule(0, 8.4, 0, 1.2, 4, "#3fae6a", 0.2);
    p.capsule(1.6, 8.6, 0, 0.6, 1.6, "#3fae6a", 0.2, [0, 0, -0.7]);
    p.capsule(-1.5, 9.6, 0, 0.55, 1.2, "#3fae6a", 0.2, [0, 0, 0.8]);
    p.sphere(0, 11.4, 0, 0.8, 0.55, 0.8, "#ff6fb5", 0.4);
    p.sphere(0, 11.8, 0, 0.3, 0.3, 0.3, "#ffd23f", 0.4);
    for (let i = 0; i < 18; i++) {
      const a = i * 1.3,
        yy = 6.6 + (i % 6) * 0.75;
      p.sphere(Math.sin(a) * 1.18, yy, Math.cos(a) * 1.18, 0.07, 0.07, 0.07, "#f1fff0", 0.2, [0, 0, 0], true);
    }
  } else if (kind === 2) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2,
        r = 1.3,
        fx = Math.sin(a) * r,
        fz = Math.cos(a) * r,
        h = 9 + (i % 3) * 1.4,
        c = ["#ff5d7a", "#ffd23f", "#ff9ecb", "#ff7b54", "#b77cff"][i];
      p.rod([fx * 0.3, 5, fz * 0.3], [fx, h, fz], 0.1, "#3f9d4a");
      p.put(leafG, [fx * 0.5, 5.6, fz * 0.5], [0, a, 0.6], [1.2, 1.8, 1], "#4fb45a");
      for (let k = 0; k < 3; k++) {
        const b2 = (k / 3) * Math.PI * 2;
        p.sphere(fx + Math.sin(b2) * 0.35, h + 0.6, fz + Math.cos(b2) * 0.35, 0.55, 0.9, 0.4, c, 0.3, [0, b2, 0.15]);
      }
      p.sphere(fx, h + 0.4, fz, 0.5, 0.55, 0.5, c, 0.3);
    }
  } else {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2,
        r = pr(0.6, 2.2),
        fx = Math.sin(a) * r,
        fz = Math.cos(a) * r,
        h = pr(6.4, 8.8);
      p.rod([fx * 0.4, 5, fz * 0.4], [fx, h, fz], 0.07, "#3f9d4a");
      for (let k = 0; k < 8; k++) {
        const b2 = (k / 8) * Math.PI * 2;
        p.sphere(fx + Math.sin(b2) * 0.36, h, fz + Math.cos(b2) * 0.36, 0.12, 0.05, 0.3, "#ffffff", 0.1, [0, b2, 0], true);
      }
      p.sphere(fx, h + 0.05, fz, 0.2, 0.1, 0.2, "#ffc93d", 0.3, [0, 0, 0], true);
    }
    for (let i = 0; i < 10; i++) {
      const a = i * 2.3;
      p.put(leafG, [Math.sin(a) * 0.8, 5.2, Math.cos(a) * 0.8], [0, a, 1], [1, 1.3, 1], "#5cc56d");
    }
  }
  p.mesh(worldMat, g);
}

function buildArena() {
  releaseWorld();
  world.clear();
  dynamic.clear();
  effectGroup.clear();
  if (sky) {
    scene.remove(sky);
    sky = null;
  }
  menuHero = null;
  actorModels.clear();
  lootModels.clear();
  effectPool.clear();
  obstacles.length = 0;
  solids.length = 0;
  nightLamps = [];
  animated = [];
  engineFx.length = 0;
  seenBullets = new WeakSet();
  seenGrenades = new Map();
  deathSeen = new Set();
  arenaKind = options.arena;
  const night = options.night,
    garden = arenaKind === "garden",
    kids = arenaKind === "kidsroom",
    bath = arenaKind === "bathroom";
  setupLights(night, arenaKind);
  const bg = night
    ? garden
      ? "#2a3170"
      : kids
        ? "#2c2a5e"
        : bath
          ? "#262c5e"
          : "#3b3566"
    : garden
      ? "#bfe8ff"
      : kids
        ? "#e9f6f8"
        : bath
          ? "#eaf8fb"
          : "#ffeccb";
  scene.background = new T.Color(bg);
  scene.fog = new T.FogExp2(bg, garden ? 0.0026 : kids || bath ? 0.0019 : 0.0021);
  inkPass.uniforms.ink.value.set(night ? "#10122e" : "#2a1b3d");
  inkPass.uniforms.saturation.value = night ? 1.1 : 1.17;
  if (garden) makeSky(night);
  seed(1);
  if (garden) buildGarden(night);
  else if (kids) buildKidsRoom(night);
  else if (bath) buildBathroom(night);
  else buildKitchen(night);
  zoneWall = new T.Mesh(
    cg("zoneG", () => new T.CylinderGeometry(1, 1, 14, 160, 1, true).translate(0, 7, 0)),
    new T.ShaderMaterial({
      uniforms: { time: { value: 0 }, radius: { value: 44 }, color: { value: new T.Color("#b15cff") } },
      vertexShader: ZONE_VS,
      fragmentShader: ZONE_FS,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  zoneWall.layers.set(FX);
  zoneWall.renderOrder = 5;
  zoneWall.castShadow = false;
  zoneWall.receiveShadow = false;
  world.add(zoneWall);
  // King of the hill: a glowing circle on the ground, a ring around it and a soft beam of light.
  hillWall = new T.Mesh(cg("hillBeamG", () => new T.CylinderGeometry(1, 1, 9, 48, 1, true).translate(0, 4.5, 0)), pillarMat("#ffc93d"));
  hillWall.layers.set(FX);
  hillWall.renderOrder = 5;
  hillWall.visible = false;
  world.add(hillWall);
  hillRing = new T.Mesh(cg("hillRingG", () => new T.TorusGeometry(1, 0.025, 6, 96).rotateX(-Math.PI / 2)), new T.MeshBasicMaterial({ color: "#ffc93d" }));
  hillRing.layers.set(FX);
  hillRing.visible = false;
  world.add(hillRing);
  hillDisc = new T.Mesh(cg("hillDiscG", () => new T.CircleGeometry(1, 64).rotateX(-Math.PI / 2)), new T.MeshBasicMaterial({ color: "#ffc93d", transparent: true, opacity: 0.22, depthWrite: false }));
  hillDisc.layers.set(FX);
  hillDisc.renderOrder = 4;
  hillDisc.visible = false;
  world.add(hillDisc);
  const warnMat = new T.MeshBasicMaterial({
    color: new T.Color("#ff6a3d").multiplyScalar(1.4),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    map: tex.soft,
  });
  hazardDecal = new T.Mesh(G.plane, warnMat);
  hazardDecal.rotation.x = -Math.PI / 2;
  hazardDecal.layers.set(FX);
  hazardDecal.visible = false;
  if (arenaKind === "kitchen") {
    hazardDecal.position.set(12, 0.06, -24);
    hazardDecal.scale.set(14, 11, 1);
    world.add(hazardDecal);
  }
  navGrid = Array.from({ length: 43 * 43 }, (_, i) => !clearSpot({ x: ((i % 43) - 21) * 1.5, z: (Math.floor(i / 43) - 21) * 1.5 }, 0.65));
}
let hazardDecal = null,
  hillWall = null,
  hillRing = null,
  hillDisc = null;
function releaseWorld() {
  const geos = new Set(),
    mats = new Set(),
    texs = new Set();
  const visit = (o) => {
    if (o.isSkinnedMesh) o.skeleton.dispose();
    if (o.geometry && !persistentGeo.has(o.geometry)) geos.add(o.geometry);
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m || persistentMat.has(m)) continue;
      mats.add(m);
      for (const k of ["map", "bumpMap", "alphaMap", "emissiveMap"]) if (m[k] && !persistentTex.has(m[k])) texs.add(m[k]);
    }
  };
  for (const g of [world, dynamic, effectGroup]) g.traverse(visit);
  if (sky) visit(sky);
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  texs.forEach((t) => t.dispose());
}
function disposeDetached(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (o.isSkinnedMesh) o.skeleton.dispose();
    if (o.geometry && !persistentGeo.has(o.geometry) && !seen.has(o.geometry)) {
      o.geometry.dispose();
      seen.add(o.geometry);
    }
    const m = o.material;
    if (m && !Array.isArray(m) && !persistentMat.has(m) && !seen.has(m)) {
      if (m.map && !persistentTex.has(m.map)) m.map.dispose();
      m.dispose();
      seen.add(m);
    }
  });
}
// ---------- arena 03: kids' room ----------
// Textures are drawn on first use only: play mat with roads, wallpaper, alphabet blocks and lane arrows.
function drawPlaymat(x, w, h) {
  seed(41);
  const U = (v) => ((v + 34) / 68) * w;
  x.fillStyle = "#8fd46a";
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = prand() < 0.5 ? "rgba(255,255,220,.13)" : "rgba(60,130,40,.1)";
    x.beginPath();
    x.ellipse(prand() * w, prand() * h, pr(30, 90), pr(20, 60), prand() * 3, 0, 7);
    x.fill();
  }
  x.lineCap = "round";
  for (let i = 0; i < 2600; i++) {
    const X = prand() * w,
      Y = prand() * h,
      l = pr(8, 18);
    x.strokeStyle = prand() < 0.5 ? "rgba(60,120,30,.22)" : "rgba(255,255,210,.3)";
    x.lineWidth = pr(2, 3.5);
    x.beginPath();
    x.moveTo(X, Y);
    x.lineTo(X + pr(-3, 3), Y - l);
    x.stroke();
  }
  // Blocks between the roads: houses, a school, a café, a post office, a park with a pond and a railway.
  const house = (cx, cz, wd, dp, wall, roof, label) => {
    const X = U(cx) - (wd / 68) * w * 0.5,
      Y = U(cz) - (dp / 68) * h * 0.5,
      W = (wd / 68) * w,
      H = (dp / 68) * h;
    x.fillStyle = "rgba(40,30,70,.22)";
    roundRect(x, X + 10, Y + 12, W, H, 14);
    x.fill();
    x.fillStyle = wall;
    roundRect(x, X, Y, W, H, 14);
    x.fill();
    x.fillStyle = roof;
    roundRect(x, X + 10, Y + 10, W - 20, H * 0.5 - 12, 10);
    x.fill();
    x.fillStyle = "rgba(0,0,0,.14)";
    roundRect(x, X + 10, Y + H * 0.5 + 2, W - 20, H * 0.5 - 12, 10);
    x.fill();
    x.fillStyle = roof;
    roundRect(x, X + 10, Y + H * 0.5 + 2, W - 20, H * 0.5 - 12, 10);
    x.globalAlpha = 0.72;
    x.fill();
    x.globalAlpha = 1;
    x.strokeStyle = "#3a2f5b";
    x.lineWidth = 6;
    roundRect(x, X, Y, W, H, 14);
    x.stroke();
    if (label) {
      x.fillStyle = "#fff8ea";
      x.font = `900 ${Math.min(58, W / label.length)}px "Arial Rounded MT Bold","Trebuchet MS",Arial,sans-serif`;
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.lineWidth = 8;
      x.strokeText(label, X + W / 2, Y + H / 2);
      x.fillText(label, X + W / 2, Y + H / 2);
    }
  };
  const tree = (cx, cz, r) => {
    const X = U(cx),
      Y = U(cz),
      R = (r / 68) * w;
    x.fillStyle = "rgba(40,30,70,.2)";
    x.beginPath();
    x.arc(X + 8, Y + 10, R, 0, 7);
    x.fill();
    x.fillStyle = "#3fae5a";
    x.beginPath();
    x.arc(X, Y, R, 0, 7);
    x.fill();
    x.fillStyle = "#6fd36d";
    x.beginPath();
    x.arc(X - R * 0.25, Y - R * 0.25, R * 0.55, 0, 7);
    x.fill();
    x.strokeStyle = "#245e36";
    x.lineWidth = 5;
    x.beginPath();
    x.arc(X, Y, R, 0, 7);
    x.stroke();
  };
  // Pond with lily pads in the central park.
  x.fillStyle = "#a6e67f";
  x.beginPath();
  x.ellipse(U(0), U(0), (9.5 / 68) * w, (9.5 / 68) * h, 0, 0, 7);
  x.fill();
  x.fillStyle = "#4fb8f0";
  x.strokeStyle = "#2a78b8";
  x.lineWidth = 8;
  x.beginPath();
  x.ellipse(U(-5), U(5), (5 / 68) * w, (4.2 / 68) * h, 0.4, 0, 7);
  x.fill();
  x.stroke();
  x.fillStyle = "rgba(255,255,255,.55)";
  x.beginPath();
  x.ellipse(U(-6.3), U(3.6), 38, 14, 0.4, 0, 7);
  x.fill();
  for (const [a, b] of [
    [-2.6, 7.6],
    [-8, 6.2],
  ]) {
    x.fillStyle = "#4caf50";
    x.beginPath();
    x.arc(U(a), U(b), 26, 0.4, 6.1);
    x.lineTo(U(a), U(b));
    x.fill();
  }
  for (const [a, b, r] of [
    [4, -8.5, 2.2],
    [-8.5, -5, 1.8],
    [8.5, 2.5, 2],
    [2.5, 9, 1.6],
  ])
    tree(a, b, r);
  // Houses in the outer blocks.
  house(-24, -26, 7, 6, "#ffd6a5", "#ff6b6b");
  house(-26, -17, 5, 4.5, "#fff1c1", "#4f9dff");
  house(24, -17.5, 8, 5, "#ffe0f0", "#b77cff", txt("mat.school"));
  house(17.5, -28, 5, 4.5, "#fff1c1", "#ff9f1c");
  house(-20.5, 27, 7, 5, "#dff6ff", "#2ec4b6", txt("mat.post"));
  house(-28, 18, 4.5, 5, "#ffd6a5", "#ff6b6b");
  house(26, 17.5, 8, 5, "#fff1c1", "#ff5d7a", txt("mat.cafe"));
  house(18, 28, 5, 4, "#dff6ff", "#4f9dff");
  house(-26, -4.5, 5, 5, "#ffe0f0", "#ffd23f");
  house(-26, 6, 5, 5, "#fff1c1", "#6fd36d");
  house(26, -6, 5, 4.5, "#dff6ff", "#ff9f1c");
  house(27, 6.5, 4.5, 5, "#ffd6a5", "#b77cff");
  for (const [a, b, r] of [
    [-19, -20, 1.6],
    [-30, -29.5, 1.4],
    [19, -22, 1.5],
    [29.5, -26, 1.5],
    [-21, 20, 1.4],
    [-29.5, 28, 1.5],
    [21, 22.5, 1.6],
    [29, 28.5, 1.4],
    [-19.5, 0.5, 1.5],
    [19.5, -1, 1.4],
    [8.5, -19.5, 1.4],
    [-8.5, -28.5, 1.5],
    [9, 29.5, 1.4],
    [-9.5, 18.5, 1.3],
  ])
    tree(a, b, r);
  // Railway under the toy train.
  x.fillStyle = "#b5773f";
  for (let v = -11; v <= 11; v += 1.1) x.fillRect(U(v) - 10, U(23) - 42, 20, 84);
  x.fillStyle = "#8d97a8";
  x.fillRect(U(-11.5), U(23) - 30, U(11.5) - U(-11.5), 9);
  x.fillRect(U(-11.5), U(23) + 21, U(11.5) - U(-11.5), 9);
  // Car park under the crayon cup.
  x.fillStyle = "#b8c2cf";
  roundRect(x, U(-7.5), U(-29), U(7.5) - U(-7.5), U(-17) - U(-29), 18);
  x.fill();
  x.strokeStyle = "#ffffff";
  x.lineWidth = 6;
  for (let v = -6; v <= 6; v += 3) {
    x.beginPath();
    x.moveTo(U(v), U(-29) + 20);
    x.lineTo(U(v), U(-24));
    x.stroke();
  }
  // Roads: the robot vacuum follows them.
  const road = 5.8,
    rw = (road / 68) * w;
  for (const c of [-13, 13]) {
    x.fillStyle = "#e9e1cf";
    x.fillRect(U(c) - rw / 2 - 12, 0, rw + 24, h);
    x.fillRect(0, U(c) - rw / 2 - 12, w, rw + 24);
  }
  for (const c of [-13, 13]) {
    x.fillStyle = "#8d97a8";
    x.fillRect(U(c) - rw / 2, 0, rw, h);
    x.fillRect(0, U(c) - rw / 2, w, rw);
  }
  x.fillStyle = "#ffffff";
  for (const c of [-13, 13])
    for (let v = 0; v < w; v += 90) {
      const mid = v + 22;
      let skip = false;
      for (const k of [-13, 13]) if (Math.abs(mid - U(k)) < rw / 2 + 34) skip = true;
      if (skip) continue;
      x.fillRect(U(c) - 5, v, 10, 44);
      x.fillRect(v, U(c) - 5, 44, 10);
    }
  // Zebra crossings next to every crossroads.
  for (const a of [-13, 13])
    for (const b of [-13, 13])
      for (const s of [-1, 1]) {
        for (let k = -2; k <= 2; k++) {
          x.fillRect(U(a) + k * 30 - 10, U(b) + s * (rw / 2 + 30) - 22, 20, 44);
          x.fillRect(U(a) + s * (rw / 2 + 30) - 22, U(b) + k * 30 - 10, 44, 20);
        }
      }
  // Frame of the mat.
  const bw = (3.1 / 68) * w;
  x.fillStyle = "#2ec4b6";
  x.fillRect(0, 0, w, bw);
  x.fillRect(0, h - bw, w, bw);
  x.fillRect(0, 0, bw, h);
  x.fillRect(w - bw, 0, bw, h);
  const cols = ["#ffd23f", "#ff6b6b", "#ffffff", "#b77cff"];
  for (let i = 0; i < 64; i++) {
    const t = (i + 0.5) / 64;
    x.fillStyle = cols[i % 4];
    for (const [px, py] of [
      [t * w, bw / 2],
      [t * w, h - bw / 2],
      [bw / 2, t * h],
      [w - bw / 2, t * h],
    ]) {
      x.beginPath();
      x.arc(px, py, bw * 0.24, 0, 7);
      x.fill();
    }
  }
  x.strokeStyle = "#1f8f86";
  x.lineWidth = 10;
  x.strokeRect(bw, bw, w - bw * 2, h - bw * 2);
}
function drawWallpaper(x, w, h) {
  x.fillStyle = "#c7ecf4";
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? "rgba(255,255,255,.35)" : "rgba(255,255,255,0)";
    x.fillRect((i * w) / 8, 0, w / 8, h);
  }
  const star = (cx, cy, r, c) => {
    x.fillStyle = c;
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2,
        rr = i % 2 ? r * 0.45 : r;
      i ? x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : x.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
    x.fill();
  };
  star(128, 110, 34, "#ffe27a");
  star(384, 360, 34, "#ffe27a");
  star(380, 96, 16, "#ffffff");
  star(110, 380, 16, "#ffffff");
  x.fillStyle = "rgba(255,255,255,.85)";
  for (const [cx, cy] of [
    [250, 230],
    [30, 250],
    [470, 240],
    [250, 480],
    [250, 20],
  ]) {
    x.beginPath();
    x.arc(cx, cy, 7, 0, 7);
    x.fill();
  }
}
const LETTER_COLORS = ["#ff5d5d", "#4f9dff", "#2ec4b6", "#ff9f1c", "#b77cff", "#ff6fb5", "#58c24a", "#ffb000"];
function drawLetters(x, w, h) {
  const c = w / 4;
  for (let i = 0; i < 16; i++) {
    const X = (i % 4) * c,
      Y = Math.floor(i / 4) * c;
    x.fillStyle = "#fff6e0";
    x.fillRect(X, Y, c, c);
    x.strokeStyle = LETTER_COLORS[i % 8];
    x.lineWidth = 14;
    roundRect(x, X + 16, Y + 16, c - 32, c - 32, 26);
    x.stroke();
    x.fillStyle = LETTER_COLORS[(i + 3) % 8];
    x.font = `900 ${c * 0.62}px "Arial Rounded MT Bold","Trebuchet MS",Arial,sans-serif`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(txt("mat.letters")[i], X + c / 2, Y + c * 0.54);
  }
}
function drawChevron(x, w, h) {
  x.clearRect(0, 0, w, h);
  x.fillStyle = "rgba(255,110,40,.5)";
  x.fillRect(0, 0, w, h);
  x.fillStyle = "rgba(255,224,110,1)";
  x.beginPath();
  x.moveTo(w * 0.25, h * 0.1);
  x.lineTo(w * 0.62, h * 0.5);
  x.lineTo(w * 0.25, h * 0.9);
  x.lineTo(w * 0.42, h * 0.9);
  x.lineTo(w * 0.79, h * 0.5);
  x.lineTo(w * 0.42, h * 0.1);
  x.closePath();
  x.fill();
}
// Redraws the play mat and letter blocks after a language switch (their labels are words and letters).
function relabelKidsTextures() {
  for (const [t, draw] of [
    [tex.playmat, drawPlaymat],
    [tex.letters, drawLetters],
  ]) {
    if (!t) continue;
    const c = t.image,
      x = c.getContext("2d");
    x.clearRect(0, 0, c.width, c.height);
    draw(x, c.width, c.height);
    t.needsUpdate = true;
  }
}
function kidsTextures() {
  if (tex.playmat) return;
  tex.playmat = keepT(canvasTex(2048, 2048, drawPlaymat));
  tex.wallpaper = keepT(canvasTex(512, 512, drawWallpaper, { repeat: [1, 1] }));
  tex.letters = keepT(canvasTex(1024, 1024, drawLetters));
  tex.chevron = keepT(canvasTex(256, 64, drawChevron, { repeat: [14, 1] }));
  texMat.playmat = keepM(toonMat("#ffffff", { map: tex.playmat, rim: 0 }));
  texMat.wallpaper = keepM(toonMat("#ffffff", { map: tex.wallpaper, rim: 0 }));
  texMat.letters = keepM(toonMat("#ffffff", { map: tex.letters, vc: true, rim: 0.3 }));
  texMat.bulbNight = keepM(new T.MeshBasicMaterial({ color: new T.Color(2.4, 2.4, 2.4) }));
  texMat.bulbDay = keepM(toonMat("#ffffff", { rim: 0.3, gloss: 0.7 }));
}
const letterPanelG = cg("letterPanel", () => new T.PlaneGeometry(1, 1));
// An alphabet block: rounded cube with a letter on every visible face (letters come from one atlas).
function letterBlock(B, L, x, y, z, s, color, rot, letters) {
  B.at([x, y, z], [0, rot, 0], [1, 1, 1], (b) => b.rbox(0, 0, 0, s, s, s, s * 0.1, color, 0.35));
  L.at([x, y, z], [0, rot, 0], [1, 1, 1], (b) => {
    const faces = [
      [0, 0, s / 2 + 0.01, 0, 0],
      [s / 2 + 0.01, 0, 0, 0, Math.PI / 2],
      [0, 0, -s / 2 - 0.01, 0, Math.PI],
      [-s / 2 - 0.01, 0, 0, 0, -Math.PI / 2],
      [0, s / 2 + 0.01, 0, -Math.PI / 2, 0],
    ];
    faces.forEach(([fx, fy, fz, rx, ry], k) => {
      const i = letters[k % letters.length] % 16;
      b.put(letterPanelG, [fx, fy, fz], [rx, ry, 0], [s * 0.78, s * 0.78, 1], "#ffffff", 0.2, 0.3, [(i % 4) / 4, 1 - (Math.floor(i / 4) + 1) / 4, 0.25, 0.25]);
    });
  });
}
function localToWorld(cx, cz, rot, lx, lz) {
  const c = Math.cos(rot),
    s = Math.sin(rot);
  return [cx + lx * c + lz * s, cz - lx * s + lz * c];
}
function buildKidsRoom(night) {
  kidsTextures();
  texMat.wallpaper.color.set(night ? "#b9b2e6" : "#ffffff");
  const R = new Builder(),
    A = new Builder(),
    L = new Builder();
  // Floor, play mat and the room.
  const floor = mesh(scaleUV(new T.PlaneGeometry(260, 260), 5, 5), texMat.wood, world, 0, -0.02, 0);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  solids.push(floor);
  const mat = mesh(new T.PlaneGeometry(68, 68), texMat.playmat, world, 0, 0.045, 0);
  mat.rotation.x = -Math.PI / 2;
  mat.castShadow = false;
  solids.push(mat);
  // Rounded boxes grow by their corner radius on every side, so the mat edge is ~0.3 thick with its top at 0.03.
  A.rbox(0, -0.12, 0, 68.4, 0.16, 68.4, 0.07, "#1f8f86", 0.1);
  const W = 66,
    H = 118;
  for (const [x, z, ry, len] of [
    [0, -W, 0, 2 * W],
    [0, W, Math.PI, 2 * W],
    [-W, 0, Math.PI / 2, 2 * W],
    [W, 0, -Math.PI / 2, 2 * W],
  ]) {
    const wall = mesh(scaleUV(new T.PlaneGeometry(len, H), len / 26, H / 26), texMat.wallpaper, world, x, H / 2 - 0.02, z);
    wall.rotation.y = ry;
    wall.castShadow = false;
  }
  R.box(0, H, 0, 2 * W + 2, 1, 2 * W + 2, "#fff8ec");
  for (const [x, z, w, d] of [
    [0, -W + 0.4, 2 * W, 0.8],
    [0, W - 0.4, 2 * W, 0.8],
    [-W + 0.4, 0, 0.8, 2 * W],
    [W - 0.4, 0, 0.8, 2 * W],
  ]) {
    R.box(x, 1.6, z, w, 3.2, d, "#fffaf0", 0.2);
    R.box(x, 3.4, z, w, 0.5, d * 1.2, "#ff9ecb", 0.3);
  }
  // Window with a garden view and striped curtains.
  const view = mesh(new T.PlaneGeometry(36, 26), night ? texMat.windowNight : texMat.windowDay, world, 14, 50, -W + 0.1);
  view.castShadow = false;
  view.receiveShadow = false;
  R.box(14, 63.6, -W + 0.8, 39, 1.8, 1.8, "#fffaf0");
  R.box(14, 36.4, -W + 0.8, 39, 1.8, 1.8, "#fffaf0");
  R.box(-4.6, 50, -W + 0.8, 1.8, 29, 1.8, "#fffaf0");
  R.box(32.6, 50, -W + 0.8, 1.8, 29, 1.8, "#fffaf0");
  R.box(14, 50, -W + 0.6, 1, 26, 1.2, "#fffaf0");
  R.rbox(14, 35.8, -W + 2.2, 42, 1.2, 4.4, 0.4, "#fffaf0", 0.3);
  R.rod([-10, 67, -W + 2], [38, 67, -W + 2], 0.4, "#c7ccd6", 1);
  for (const s of [-1, 1])
    for (let i = 0; i < 5; i++)
      R.cyl(14 + s * (21 + i * 1.5), 51, -W + 2.2 + (i % 2) * 0.5, 1.05, 32, i % 2 ? "#fff6e0" : "#ffb3c6", 0.1);
  // Dresser under the window with toys on top.
  R.rbox(14, 10, -W + 6, 36, 20, 10, 0.8, "#b8e2ff", 0.3);
  for (let i = 0; i < 3; i++) {
    R.rbox(14, 4 + i * 6, -W + 11.1, 33, 5.2, 0.6, 0.4, "#d6efff", 0.3);
    R.sphere(14, 4 + i * 6, -W + 11.6, 0.8, 0.8, 0.6, ["#ff6b6b", "#ffd23f", "#6fd36d"][i], 0.7);
  }
  R.rbox(14, 20.4, -W + 6, 37, 0.9, 11, 0.3, "#ffffff", 0.3);
  // Toy rocket and a snow globe on the dresser.
  R.cyl(4, 25.5, -W + 6, 1.6, 9, "#ffffff", 0.6);
  R.cone(4, 32, -W + 6, 1.6, 4, "#ff5d5d", 0.6);
  R.sphere(4, 26.5, -W + 7.5, 0.9, 0.9, 0.3, "#4fbfff", 0.9);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    R.put(G.coneLo, [4 + Math.sin(a) * 1.8, 22.2, -W + 6 + Math.cos(a) * 1.8], [0, a, 0], [0.9, 3, 0.3], "#ff5d5d", 0.5);
  }
  R.sphere(24, 24.4, -W + 6, 3.2, 3.2, 3.2, "#dff4ff", 0.95);
  R.cyl(24, 21.4, -W + 6, 2.6, 1.6, "#b5652f", 0.3);
  R.sphere(24, 23.6, -W + 6, 1.2, 1.4, 1.2, "#ffffff", 0.2);
  // Bed along the left wall with a plush bunny.
  const bx = -50,
    bz = -22;
  R.rbox(bx, 7, bz, 28, 14, 70, 1.4, "#ffd6e5", 0.3);
  R.rbox(bx, 17.5, bz, 27, 7, 68, 2.6, "#ffffff", 0.2);
  R.rbox(bx + 0.5, 21.4, bz + 9, 28.6, 2, 50, 1.2, "#7ecbff", 0.2);
  for (let i = 0; i < 12; i++)
    R.put(starG, [bx - 11 + (i % 4) * 7.5, 22.5, bz - 11 + Math.floor(i / 4) * 14], [-Math.PI / 2, 0, i], [1.1, 1.1, 0.4], "#fff3a8", 0.3);
  R.rbox(bx, 23.2, bz - 27, 20, 4.8, 10, 2.2, "#fff4d6", 0.2);
  R.rbox(bx, 26, bz - 35, 29, 32, 2.4, 1.6, "#ffd6e5", 0.3);
  R.put(starG, [bx, 36, bz - 33.6], [0, 0, 0], [5, 5, 1.4], "#ffd23f", 0.5);
  for (const s of [-1, 1]) R.cyl(bx + s * 13.5, 16, bz + 34.5, 1.3, 32, "#ffc4d8", 0.3);
  const bun = [bx + 4, 25.5, bz - 16];
  R.sphere(bun[0], bun[1], bun[2], 3, 3.3, 2.8, "#ffffff", 0.1);
  R.sphere(bun[0], bun[1] + 4.6, bun[2] + 0.3, 2.4, 2.2, 2.2, "#ffffff", 0.1);
  for (const s of [-1, 1]) {
    R.capsule(bun[0] + s * 1, bun[1] + 8.4, bun[2], 0.7, 3, "#ffffff", 0.1, [0, 0, s * 0.18]);
    R.capsule(bun[0] + s * 1, bun[1] + 8.4, bun[2] + 0.35, 0.4, 2.4, "#ffc4d8", 0.1, [0, 0, s * 0.18]);
    R.sphere(bun[0] + s * 0.8, bun[1] + 4.9, bun[2] + 2.2, 0.32, 0.36, 0.2, "#2b2744", 1);
    R.sphere(bun[0] + s * 2.2, bun[1] + 0.3, bun[2] + 1.6, 0.9, 1.2, 0.9, "#ffffff", 0.1);
  }
  R.sphere(bun[0], bun[1] + 4.2, bun[2] + 2.3, 0.35, 0.28, 0.2, "#ff9ecb", 0.5);
  // Nightstand with a star night light.
  R.rbox(-50, 7, 22, 12, 14, 10, 0.8, "#ffe8a3", 0.3);
  R.sphere(-50, 7, 27.2, 0.6, 0.6, 0.5, "#ff9f1c", 0.7);
  R.cyl(-50, 15, 22, 2.6, 1.6, "#4f9dff", 0.6);
  const nightStar = mesh(starG, night ? glow("#ffe27a", 2.6) : material("#ffe27a", 0.3), world, -50, 19.6, 22);
  nightStar.scale.set(2.6, 2.6, 1.6);
  nightStar.rotation.y = 0.6;
  nightStar.castShadow = false;
  if (night) nightStar.layers.set(FX);
  // Bookcase with picture books and a giraffe height chart on the right wall.
  R.rbox(W - 5, 20, 8, 9, 40, 30, 0.8, "#ffffff", 0.3);
  for (const y of [9, 20, 31]) {
    R.rbox(W - 5, y - 4.2, 8, 8.4, 0.8, 29, 0.2, "#e9dff5", 0.2);
    for (let i = 0; i < 9; i++)
      R.rbox(W - 6, y + 0.3, -3.5 + i * 3.1, 5, 8 - (i % 3), 2.4, 0.3, ["#ef476f", "#06d6a0", "#118ab2", "#ffd166", "#8338ec", "#ff9f1c"][(i + y) % 6], 0.2);
  }
  R.rbox(W - 0.8, 30, -30, 0.6, 50, 7, 1, "#ffd23f", 0.2);
  for (let i = 0; i < 9; i++) R.sphere(W - 1.2, 10 + i * 5.2, -30 + ((i * 37) % 5) - 2, 1.1, 1.3, 0.3, "#c98b52", 0.1);
  R.sphere(W - 1.2, 58, -30, 4, 3.4, 1, "#ffd23f", 0.2);
  R.sphere(W - 1.6, 58.5, -27.4, 0.5, 0.6, 0.3, "#2b2744", 1);
  for (const s of [-1, 1]) R.cone(W - 1.4, 62.5, -31 + s * 1.4, 0.4, 2, "#c98b52", 0.2);
  // Door and a drawing on the front wall.
  R.rbox(-24, 26, W - 0.8, 24, 52, 1.4, 0.6, "#ffb3c6", 0.3);
  R.rbox(-24, 26, W - 1.4, 19, 46, 0.6, 0.5, "#ffc9d8", 0.3);
  R.sphere(-15, 26, W - 2.2, 1, 1, 1, "#ffd23f", 0.9);
  const art = mesh(new T.PlaneGeometry(16, 20), texMat.drawing, world, 20, 34, W - 0.3);
  art.rotation.y = Math.PI;
  art.castShadow = false;
  R.rbox(20, 34, W - 0.1, 18, 22, 0.5, 0.3, "#4f9dff", 0.3);
  // Garland of little lights along three walls.
  const bulbs = [];
  for (const [x0, z0, x1, z1] of [
    [-W + 1, -W + 1, W - 1, -W + 1],
    [-W + 1, -W + 1, -W + 1, W - 1],
    [W - 1, -W + 1, W - 1, W - 1],
  ]) {
    const n = 26;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n,
        x = x0 + (x1 - x0) * t,
        z = z0 + (z1 - z0) * t,
        y = 74 - Math.sin(((t * n) % 3.25) / 3.25 * Math.PI) * 4;
      if (prev) R.rod(prev, [x, y, z], 0.12, "#3a2f5b");
      prev = [x, y, z];
      if (i % 2) bulbs.push([x, y - 0.8, z]);
    }
  }
  const bulbMat = night ? texMat.bulbNight : texMat.bulbDay,
    bulbIM = new T.InstancedMesh(G.sphereLo, bulbMat, bulbs.length),
    bc = ["#ff6b6b", "#ffd23f", "#4fbfff", "#6fd36d", "#ff84c6"];
  bulbs.forEach((b, i) => {
    _m4.compose(_p.set(...b), _q.identity(), _s.set(0.65, 0.9, 0.65));
    bulbIM.setMatrixAt(i, _m4);
    bulbIM.setColorAt(i, _c.set(bc[i % bc.length]));
  });
  bulbIM.castShadow = false;
  bulbIM.layers.set(FX);
  world.add(bulbIM);
  // Toys scattered on the floor outside the arena.
  A.rbox(42, 6, 44, 18, 12, 12, 1, "#ff9f1c", 0.3);
  A.rbox(42, 12.4, 44, 18.8, 1.2, 12.8, 0.4, "#ffd23f", 0.4);
  A.rbox(42, 17, 38, 18.8, 10, 1.2, 0.4, "#ffd23f", 0.4, [-0.5, 0, 0]);
  A.sphere(38, 14, 45, 3, 3, 3, "#4f9dff", 0.5);
  A.rbox(45, 14, 43, 4, 5, 4, 0.5, "#6fd36d", 0.3, [0.2, 0.4, 0]);
  for (let i = 0; i < 8; i++) {
    A.rbox(-44 + i * 2.6, 1 + i * 0.12, 44, 2.2, 0.8, 9 - i * 0.6, 0.3, ["#ff5d5d", "#ff9f1c", "#ffd23f", "#6fd36d", "#2ec4b6", "#4f9dff", "#b77cff", "#ff6fb5"][i], 0.6);
  }
  A.rbox(-35, 1, 44, 1.2, 1.2, 12, 0.3, "#b5652f", 0.3);
  A.rbox(-53.5, 1, 44, 1.2, 1.2, 12, 0.3, "#b5652f", 0.3);
  seed(77);
  for (const [i, [x, z]] of [
    [40, -6],
    [46, 4],
    [52, -14],
    [-20, 40],
    [-8, 46],
    [10, 42],
    [26, 52],
  ].entries()) {
    const a = pr(0, 6.3),
      c = LETTER_COLORS[i % 8];
    A.at([x, 0.5, z], [Math.PI / 2, 0, a], [1, 1, 1], (b) => {
      b.cyl(0, 0, 0, 0.5, 6, c, 0.3);
      b.cyl(0, 0.6, 0, 0.52, 2.8, "#fff8ea", 0.1);
      b.cone(0, 3.6, 0, 0.5, 1.2, c, 0.3);
    });
  }
  // ----- arena props (cover) -----
  makeTeddy(-23, -23, Math.PI / 4);
  const B = new Builder();
  letterBlock(B, L, 21.3, 1.7, -21.3, 3.4, "#ff5d5d", 0.08, [11, 7]);
  letterBlock(B, L, 21.3, 5.1, -21.3, 3.4, "#4f9dff", -0.1, [8, 0]);
  letterBlock(B, L, 24.9, 1.7, -21.3, 3.4, "#ffd23f", 0.05, [1, 2]);
  letterBlock(B, L, 21.3, 1.7, -24.9, 3.4, "#6fd36d", -0.06, [4, 5]);
  letterBlock(B, L, 24.9, 1.7, -24.9, 3.4, "#b77cff", 0.02, [12, 13]);
  letterBlock(B, L, 24.9, 5.1, -24.9, 3.4, "#ff9f1c", 0.12, [14, 15]);
  letterBlock(B, L, 24.9, 8.5, -24.9, 3.4, "#2ec4b6", -0.08, [3, 9]);
  B.rod([24.9, 10.2, -24.9], [24.9, 15.5, -24.9], 0.12, "#8b5a2b");
  B.put(new T.CylinderGeometry(0, 1.6, 2.6, 3), [25.9, 14.4, -24.9], [0, 0, -Math.PI / 2], [1, 1, 0.12], "#ff5d5d", 0.2);
  const castle = B.mesh(worldMat, world);
  for (const [x, z, h] of [
    [21.3, -21.3, 6.8],
    [24.9, -21.3, 3.4],
    [21.3, -24.9, 3.4],
    [24.9, -24.9, 10.2],
  ])
    addObstacle(x, z, 1.9, h, castle);
  const sb = new Builder();
  for (const [x, z, c, r, l] of [
    [5.2, -5.4, "#ff6fb5", 0.3, [6, 10]],
    [18.6, 6, "#4f9dff", -0.2, [1, 12]],
    [-18.6, -6.5, "#ffd23f", 0.5, [0, 11]],
    [6.5, -26.5, "#6fd36d", -0.4, [9, 3]],
  ]) {
    letterBlock(sb, L, x, 1.1, z, 2.2, c, r, l);
    addObstacle(x, z, 1.3, 2.2);
  }
  const smallBlocks = sb.mesh(worldMat, world);
  solids.push(smallBlocks);
  makeBeachBall(-23, 23);
  makeRings(23, 23);
  makeCrayonCup(0, -23);
  makeTrain(0, 23);
  makeBookTent(-23, 0);
  makeToyRobot(23, 0, -Math.PI / 2);
  makeDuck(-5, 5, 0.62);
  L.mesh(texMat.letters, world, { cast: false });
  R.mesh(worldMat, world, { cast: false });
  A.mesh(worldMat, world);
  makeVacuum(night);
  if (night) {
    const lamp = new T.PointLight("#ffc978", 520, 120, 1.6);
    lamp.position.set(-44, 24, 20);
    scene.add(lamp);
    const moon = new T.PointLight("#9fb4ff", 260, 140, 1.5);
    moon.position.set(14, 50, -52);
    scene.add(moon);
  }
}
function makeTeddy(x, z, rot) {
  const g = group(world, x, 0, z);
  g.rotation.y = rot;
  const b = new Builder(),
    fur = "#c98b52",
    pale = "#f3d2a2";
  b.sphere(0, 4.3, 0, 4.1, 4.5, 3.7, fur, 0.1);
  b.sphere(0, 4, 2.1, 2.5, 2.9, 1.5, pale, 0.1);
  b.sphere(0, 9.8, 0.3, 3.2, 3, 2.9, fur, 0.1);
  b.sphere(0, 9.1, 2.9, 1.5, 1.1, 1, pale, 0.1);
  b.sphere(0, 9.55, 3.8, 0.55, 0.42, 0.38, "#3a2a28", 0.9);
  b.put(torusG(0.45, 0.09, Math.PI), [0, 8.7, 3.72], [0, 0, Math.PI], [1, 1, 1], "#5a2a28");
  for (const s of [-1, 1]) {
    b.sphere(s * 1.1, 10.4, 2.6, 0.44, 0.5, 0.3, "#1d1a2e", 0.9);
    b.sphere(s * 1.0 + 0.12, 10.6, 2.86, 0.14, 0.14, 0.08, "#ffffff", 0.2);
    b.sphere(s * 2.4, 12.1, 0, 1.15, 1.15, 0.75, fur, 0.1);
    b.sphere(s * 2.4, 12.1, 0.45, 0.68, 0.68, 0.42, pale, 0.1);
    b.capsule(s * 3.4, 5.4, 1.4, 1.2, 3.2, fur, 0.1, [0.9, 0, s * 0.5]);
    b.sphere(s * 3.9, 3.4, 3.2, 1.35, 1.25, 1.25, fur, 0.1);
    b.capsule(s * 2.3, 1.5, 3, 1.5, 3, fur, 0.1, [Math.PI / 2, 0, 0]);
    b.sphere(s * 2.4, 1.7, 5.3, 1.45, 1.6, 0.95, fur, 0.1);
    b.sphere(s * 2.4, 1.7, 6.1, 0.95, 1.05, 0.3, pale, 0.1);
    b.sphere(s * 1.4, 7.35, 3, 1, 0.7, 0.55, "#ff5d7a", 0.4, [0, 0, s * 0.3]);
    b.sphere(s * 1.2, 11.1, 2.5, 0.5, 0.18, 0.2, "#7a4a23", 0, [0, 0, s * -0.2]);
  }
  b.sphere(0, 7.35, 3.3, 0.5, 0.5, 0.45, "#ff4d6d", 0.4);
  const m = b.mesh(worldMat, g);
  addObstacle(x, z, 4.2, 12, m);
  for (const s of [-1, 1]) {
    const [fx, fz] = localToWorld(x, z, rot, s * 2.4, 5.2);
    addObstacle(fx, fz, 1.3, 2.6);
  }
}
function makeBeachBall(x, z) {
  const r = 3.2,
    g = new T.SphereGeometry(r, 48, 24).toNonIndexed(),
    p = g.attributes.position,
    c = new Float32Array(p.count * 3),
    cols = ["#ff5d5d", "#ffffff", "#ffd23f", "#ffffff", "#4f9dff", "#ffffff"].map((v) => new T.Color(v)),
    cap = new T.Color("#ffffff");
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
      cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3,
      cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3,
      sec = Math.floor(((Math.atan2(cx, cz) + Math.PI) / (Math.PI * 2)) * 6) % 6,
      col = Math.abs(cy) > r * 0.9 ? cap : cols[sec];
    for (let k = 0; k < 3; k++) col.toArray(c, (i + k) * 3);
  }
  g.setAttribute("color", new T.BufferAttribute(c, 3));
  const b = new Builder();
  b.geom(g, "#ffffff", 0.85, [0, r, 0], [0.35, 0.4, 0.2]);
  b.cyl(0, r * 2 + 0.05, 0, 0.35, 0.3, "#ff5d5d", 0.6, [0.35, 0.4, 0.2]);
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z, r, r * 2, m);
}
function makeRings(x, z) {
  const b = new Builder();
  b.cyl(0, 0.45, 0, 3.1, 0.9, "#7b4fd0", 0.4);
  b.cyl(0, 4.6, 0, 0.55, 8, "#ffd23f", 0.3);
  const cols = ["#ff5d5d", "#ff9f1c", "#ffd23f", "#6fd36d", "#4f9dff"];
  for (let i = 0; i < 5; i++) b.torus(0, 1.65 + i * 1.45, 0, 2.3 - i * 0.28, 0.72 - i * 0.04, cols[i], 0.6, [Math.PI / 2, 0, 0]);
  b.sphere(0, 9.2, 0, 1.2, 1.1, 1.2, "#ff6fb5", 0.7);
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z, 3.1, 9);
  solids.push(m);
}
function makeCrayonCup(x, z) {
  const b = new Builder();
  b.cyl(0, 2.2, 0, 2.7, 4.4, "#2ec4b6", 0.5);
  b.cyl(0, 2.2, 0, 2.75, 1.4, "#fff8ea", 0.2);
  b.torus(0, 4.4, 0, 2.62, 0.18, "#1f8f86", 0.5, [Math.PI / 2, 0, 0]);
  seed(13);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + pr(-0.2, 0.2),
      rr = i % 3 === 0 ? 0.5 : 1.6,
      tilt = pr(0.08, 0.3),
      c = LETTER_COLORS[i % 8];
    b.at([Math.sin(a) * rr, 3.2, Math.cos(a) * rr], [Math.cos(a) * tilt, 0, -Math.sin(a) * tilt], [1, 1, 1], (q) => {
      q.cyl(0, 1.6 + (i % 4) * 0.35, 0, 0.42, 5.4, c, 0.3);
      q.cyl(0, 1.2 + (i % 4) * 0.35, 0, 0.44, 2.2, "#fff8ea", 0.1);
      q.cone(0, 4.9 + (i % 4) * 0.35, 0, 0.42, 1.3, c, 0.3);
    });
  }
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z, 3, 5.4, m);
}
function makeTrain(x, z) {
  const b = new Builder(),
    red = "#ff5d5d",
    blue = "#4f9dff",
    yel = "#ffd23f";
  b.rbox(-2.6, 1.9, 0, 5.4, 1.4, 3, 0.3, blue, 0.4);
  b.cyl(-3.3, 3.5, 0, 1.3, 3.6, red, 0.5, [0, 0, Math.PI / 2]);
  b.cyl(-5.15, 3.5, 0, 1.05, 0.2, "#3a2f5b", 0.4, [0, 0, Math.PI / 2]);
  b.rbox(-0.9, 4.1, 0, 2.4, 3.4, 3, 0.35, yel, 0.4);
  b.rbox(-0.9, 6, 0, 3.2, 0.5, 3.6, 0.2, red, 0.4);
  b.box(-0.9, 4.6, 1.52, 1.4, 1.2, 0.05, "#bfe8ff", 0.9);
  b.box(-0.9, 4.6, -1.52, 1.4, 1.2, 0.05, "#bfe8ff", 0.9);
  b.cyl(-4.2, 5.6, 0, 0.5, 1.4, "#3a2f5b", 0.4);
  b.cone(-4.2, 6.6, 0, 0.8, 0.9, "#3a2f5b", 0.4, [Math.PI, 0, 0]);
  b.put(new T.CylinderGeometry(0.1, 1.2, 1.3, 4), [-5.5, 1.3, 0], [0, 0, Math.PI / 2], [1, 1, 1.4], yel, 0.3);
  b.rbox(3.1, 2.4, 0, 4.2, 2.2, 3, 0.3, "#6fd36d", 0.4);
  for (let i = 0; i < 5; i++) b.sphere(2.2 + (i % 3) * 0.9, 3.7, -0.7 + (i % 2) * 1.2, 0.7, 0.55, 0.7, "#3a2f5b", 0.2, [0, i, 0], true);
  b.box(0.6, 1.4, 0, 1.2, 0.3, 0.4, "#8b5a2b");
  for (const wx of [-4.3, -2.3, -0.5, 2, 4.2])
    for (const s of [-1, 1]) {
      b.cyl(wx, 0.9, s * 1.55, 0.9, 0.35, s > 0 ? yel : yel, 0.4, [Math.PI / 2, 0, 0]);
      b.cyl(wx, 0.9, s * 1.75, 0.35, 0.1, red, 0.5, [Math.PI / 2, 0, 0]);
    }
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x - 2.6, z, 2, 4.2, m);
  addObstacle(x + 2.4, z, 1.9, 3.4);
}
function makeBookTent(x, z) {
  const b = new Builder(),
    lean = 0.6;
  for (const s of [-1, 1]) {
    b.at([s * 1.9, 2.55, 0], [0, 0, s * lean], [1, 1, 1], (q) => {
      q.rbox(s * 0.2, 0, 0, 0.35, 6.2, 7.6, 0.12, s > 0 ? "#ff6b6b" : "#4f9dff", 0.3);
      q.rbox(-s * 0.1, 0, 0, 0.35, 5.9, 7.2, 0.1, "#fff8ea", 0.1);
    });
  }
  b.cyl(0, 5.05, 0, 0.35, 7.6, "#ffd23f", 0.3, [Math.PI / 2, 0, 0]);
  b.put(starG, [2.7, 3.2, 0], [0, Math.PI / 2, lean], [0.9, 0.9, 0.3], "#ffd23f", 0.4);
  b.put(starG, [-2.7, 3.2, 0], [0, -Math.PI / 2, -lean], [0.9, 0.9, 0.3], "#fff3a8", 0.4);
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z - 2.4, 2.3, 5, m);
  addObstacle(x, z + 2.4, 2.3, 5);
}
function makeToyRobot(x, z, rot) {
  const g = group(world, x, 0, z);
  g.rotation.y = rot;
  const b = new Builder(),
    tin = "#9fc3e6",
    dk = "#4a5f8a";
  for (const s of [-1, 1]) {
    b.rbox(s * 0.9, 1.2, 0, 1.2, 2.4, 1.4, 0.3, dk, 0.6);
    b.rbox(s * 0.9, 0.3, 0.4, 1.5, 0.6, 2.2, 0.25, "#ff5d5d", 0.5);
    b.capsule(s * 2.3, 4.2, 0, 0.5, 2, tin, 0.8, [0, 0, s * 0.25]);
    b.torus(s * 2.65, 2.6, 0, 0.45, 0.16, "#ffd23f", 0.6, [Math.PI / 2, 0, 0]);
  }
  b.rbox(0, 4.2, 0, 3.2, 3.6, 2.2, 0.4, tin, 0.85);
  b.rbox(0, 4.4, 1.1, 2, 2, 0.2, 0.2, "#e9f4ff", 0.6);
  b.cyl(0, 4.8, 1.25, 0.5, 0.2, "#ff9f1c", 0.6, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) b.sphere(-0.6 + i * 0.6, 3.8, 1.25, 0.18, 0.18, 0.12, ["#ff5d5d", "#6fd36d", "#4f9dff"][i], 0.7);
  b.cyl(0, 6.2, 0, 0.5, 0.5, dk, 0.5);
  b.rbox(0, 7.4, 0, 2.6, 2, 2.2, 0.45, tin, 0.85);
  b.rbox(0, 7.4, 1.1, 2.1, 1.1, 0.2, 0.3, "#2b2744", 0.9);
  for (const s of [-1, 1]) {
    b.sphere(s * 0.5, 7.4, 1.25, 0.28, 0.28, 0.12, "#7fffd4", 0.9);
    b.cyl(s * 1.4, 7.4, 0, 0.45, 0.3, dk, 0.5, [0, 0, Math.PI / 2]);
  }
  b.rod([0, 8.4, 0], [0, 9.6, 0], 0.08, dk);
  b.sphere(0, 9.8, 0, 0.35, 0.35, 0.35, "#ff5d5d", 0.8);
  const m = b.mesh(worldMat, g);
  addObstacle(x, z, 2.3, 8.2, m);
}
// A rubber duck (k scales it: the bathroom has a big one). Its parts can also go into another builder.
function duckParts(b) {
  const y = "#ffd23f";
  b.sphere(0, 1.7, -0.3, 2.3, 1.7, 2.7, y, 0.75);
  b.sphere(0, 2.4, -2.6, 0.9, 1, 0.8, y, 0.75, [0.5, 0, 0]);
  for (const s of [-1, 1]) b.sphere(s * 1.95, 2.2, -0.5, 0.6, 0.9, 1.5, "#ffc21f", 0.6, [0.2, 0, s * 0.3]);
  b.sphere(0, 3.9, 1.3, 1.45, 1.4, 1.4, y, 0.75);
  b.sphere(0, 3.55, 2.75, 0.85, 0.32, 0.7, "#ff9f1c", 0.6);
  for (const s of [-1, 1]) {
    b.sphere(s * 0.62, 4.35, 2.35, 0.26, 0.32, 0.18, "#1d1a2e", 0.9);
    b.sphere(s * 0.58 + 0.06, 4.45, 2.47, 0.08, 0.08, 0.05, "#ffffff", 0.2);
  }
  return b;
}
function makeDuck(x, z, rot, k = 1) {
  const g = group(world, x, 0, z);
  g.rotation.y = rot;
  g.scale.setScalar(k);
  const m = duckParts(new Builder()).mesh(worldMat, g);
  addObstacle(x, z, 2.4 * k, 4.6 * k, m);
}
// The robot vacuum: parked in its dock when idle, drives along a road when the game says so.
function makeVacuum(night) {
  const g = group(world, 40, 0, -40),
    b = new Builder();
  b.cyl(0, 0.55, 0, 2.25, 0.8, "#f4f1fb", 0.6);
  b.cyl(0, 1, 0, 2.02, 0.14, "#7b6fd6", 0.8);
  b.torus(0, 0.5, 0, 2.25, 0.2, "#3a2f5b", 0.3, [Math.PI / 2, 0, 0]);
  b.cyl(0, 1.12, 0.4, 0.6, 0.12, "#e9e4ff", 0.9);
  for (const s of [-1, 1]) {
    b.sphere(s * 0.62, 0.78, 2.12, 0.42, 0.34, 0.12, "#ffffff", 0.3);
    b.sphere(s * 0.62, 0.75, 2.2, 0.2, 0.22, 0.08, "#2b2744", 1);
  }
  b.mesh(worldMat, g);
  const lightMat = new T.MeshBasicMaterial({ color: new T.Color("#7fe8ff").multiplyScalar(2.2) }),
    light = new T.Mesh(torusG(1.05, 0.1), lightMat);
  light.rotation.x = Math.PI / 2;
  light.position.y = 1.1;
  light.layers.set(FX);
  g.add(light);
  const brushes = [];
  for (const s of [-1, 1]) {
    const br = group(g, s * 1.55, 0.14, 1.45),
      bb = new Builder();
    for (let k = 0; k < 3; k++) bb.box(0, 0, 0.45, 0.08, 0.04, 0.9, "#ffd23f", 0.2, [0, (k / 3) * Math.PI * 2, 0]);
    bb.mesh(worldMat, br, { cast: false });
    brushes.push(br);
  }
  // Dock by the wall.
  const d = new Builder();
  d.rbox(40, 1.2, -44, 6, 2.4, 1.6, 0.4, "#e9e4ff", 0.5);
  d.sphere(40, 2, -43.1, 0.3, 0.3, 0.2, "#6fd36d", 0.8);
  d.mesh(worldMat, world);
  // Lane warning: arrows that crawl along the road in the vacuum's direction.
  const lane = group(world, 0, 0.07, 0),
    laneMat = new T.MeshBasicMaterial({ map: tex.chevron, transparent: true, depthWrite: false, opacity: 0 });
  laneMat.color.setScalar(1.35);
  const strip = new T.Mesh(G.plane, laneMat);
  strip.rotation.x = -Math.PI / 2;
  strip.scale.set(72, (VAC_R + 0.8) * 2, 1);
  strip.layers.set(FX);
  strip.renderOrder = 3;
  lane.add(strip);
  lane.visible = false;
  let flash = 0;
  animated.push((dt) => {
    const v = options.arena === "kidsroom" && mode !== "menu" ? vacuum : null;
    lane.visible = !!v;
    if (!v) {
      g.position.set(40, 0, -40.8);
      g.rotation.y = 0;
      lightMat.color.set("#6fd36d").multiplyScalar(1.8);
      for (const br of brushes) br.rotation.y = 0;
      return;
    }
    const l = v.lane;
    g.position.set(v.x, 0, v.z);
    g.rotation.y = l.h ? (v.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : v.dir > 0 ? 0 : Math.PI;
    flash += dt || 0.016;
    if (v.active) {
      lightMat.color.set("#7fe8ff").multiplyScalar(2 + Math.sin(flash * 10) * 0.4);
      for (const br of brushes) br.rotation.y += (dt || 0.016) * 18;
      g.position.y = Math.abs(Math.sin(flash * 20)) * 0.04;
    } else lightMat.color.set(Math.sin(flash * 12) > 0 ? "#ff5a3d" : "#ffd23f").multiplyScalar(2.2);
    lane.position.set(l.h ? 0 : l.c, 0.07, l.h ? l.c : 0);
    lane.rotation.y = l.h ? (v.dir > 0 ? 0 : Math.PI) : v.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    laneMat.opacity = v.active ? 0.9 : 0.62 + 0.25 * Math.sin(flash * 9);
    tex.chevron.offset.x -= (dt || 0.016) * (v.active ? 2.4 : 0.9);
  });
}
// ---------- arena 04: bathroom ----------
// Textures are drawn on first use only: the mosaic floor of the arena, big floor tiles, wall tiles,
// a mosaic band, the whirlpool swirl, the drain grate and the mirror.
function drawBathFloor(x, w, h) {
  seed(61);
  const S = w / 68,
    U = (v) => (v + 34) * S;
  x.fillStyle = "#b5d8df";
  x.fillRect(0, 0, w, h);
  // Glossy tiles, 4.25 units each.
  const n = 16,
    s = w / n,
    tones = ["#f7fcfd", "#eef8fa", "#f3fbf9", "#fbfdfe", "#eaf6f8"];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const X = i * s,
        Y = j * s;
      x.fillStyle = tones[Math.floor(prand() * tones.length)];
      roundRect(x, X + 5, Y + 5, s - 10, s - 10, 14);
      x.fill();
      x.fillStyle = "rgba(255,255,255,.95)";
      roundRect(x, X + 17, Y + 15, s * 0.36, 8, 4);
      x.fill();
      x.fillStyle = "rgba(255,255,255,.7)";
      roundRect(x, X + 17, Y + 28, s * 0.14, 7, 3.5);
      x.fill();
      x.fillStyle = "rgba(90,150,170,.13)";
      roundRect(x, X + 10, Y + s - 21, s - 20, 10, 5);
      x.fill();
    }
  // The floor slopes down to the drain.
  const dx = U(8),
    dy = U(-8);
  const g = x.createRadialGradient(dx, dy, 2.2 * S, dx, dy, 5.6 * S);
  g.addColorStop(0, "rgba(60,125,155,.34)");
  g.addColorStop(1, "rgba(60,125,155,0)");
  x.fillStyle = g;
  x.beginPath();
  x.arc(dx, dy, 5.6 * S, 0, 7);
  x.fill();
  x.strokeStyle = "rgba(70,135,155,.28)";
  x.lineWidth = 6;
  x.lineCap = "round";
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    x.beginPath();
    x.moveTo(dx + Math.cos(a) * 2.7 * S, dy + Math.sin(a) * 2.7 * S);
    x.lineTo(dx + Math.cos(a) * 6.2 * S, dy + Math.sin(a) * 6.2 * S);
    x.stroke();
  }
  // Puddles with a glint.
  const puddle = (cx, cz, rx, rz, rot) => {
    x.save();
    x.translate(U(cx), U(cz));
    x.rotate(rot);
    x.fillStyle = "rgba(120,200,235,.34)";
    x.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2,
        k = 1 + 0.16 * Math.sin(a * 3 + rot * 5) + 0.08 * Math.sin(a * 5 + 1),
        px = Math.cos(a) * rx * S * k,
        py = Math.sin(a) * rz * S * k;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.closePath();
    x.fill();
    x.strokeStyle = "rgba(255,255,255,.9)";
    x.lineWidth = 8;
    x.beginPath();
    x.ellipse(-rx * S * 0.2, -rz * S * 0.25, rx * S * 0.5, rz * S * 0.4, 0, Math.PI * 1.05, Math.PI * 1.45);
    x.stroke();
    x.restore();
  };
  puddle(-15, -12, 3.2, 2, 0.4);
  puddle(18, -1, 2.4, 1.5, -0.3);
  puddle(22, 12.5, 2, 1.3, 0.9);
  puddle(-27, 13, 1.8, 1.2, 0.2);
  puddle(-4, 28, 1.6, 1, 0);
  // Striped bath rug.
  x.save();
  x.translate(U(-5), U(15));
  x.rotate(0.25);
  const RX = 4.2 * S,
    RY = 2.8 * S;
  x.fillStyle = "rgba(60,40,90,.16)";
  x.beginPath();
  x.ellipse(10, 14, RX + 14, RY + 14, 0, 0, 7);
  x.fill();
  x.strokeStyle = "#ffd6e6";
  x.lineWidth = 5;
  for (let i = 0; i < 110; i++) {
    const a = (i / 110) * Math.PI * 2;
    x.beginPath();
    x.moveTo(Math.cos(a) * RX * 0.98, Math.sin(a) * RY * 0.98);
    x.lineTo(Math.cos(a) * (RX + 18), Math.sin(a) * (RY + 18));
    x.stroke();
  }
  for (const [k, c] of [
    [1, "#ffb3cf"],
    [0.82, "#ffffff"],
    [0.64, "#8fd8ff"],
    [0.46, "#ffffff"],
    [0.28, "#ffd23f"],
  ]) {
    x.fillStyle = c;
    x.beginPath();
    x.ellipse(0, 0, RX * k, RY * k, 0, 0, 7);
    x.fill();
  }
  for (let i = 0; i < 900; i++) {
    const a = prand() * 6.283,
      r = Math.sqrt(prand());
    x.fillStyle = prand() < 0.5 ? "rgba(255,255,255,.35)" : "rgba(190,110,150,.12)";
    x.beginPath();
    x.arc(Math.cos(a) * RX * r, Math.sin(a) * RY * r, pr(2, 5), 0, 7);
    x.fill();
  }
  x.restore();
  // Soap suds around the soap bar.
  x.lineWidth = 3;
  for (let i = 0; i < 34; i++) {
    const a = prand() * 6.283,
      r = pr(2.3, 3.6);
    x.fillStyle = "rgba(255,255,255,.92)";
    x.strokeStyle = "rgba(130,195,220,.6)";
    x.beginPath();
    x.arc(U(-8 + Math.cos(a) * r * 1.2), U(-3 + Math.sin(a) * r * 0.85), pr(6, 16), 0, 7);
    x.fill();
    x.stroke();
  }
  // Clean sparkles.
  x.fillStyle = "rgba(255,255,255,.95)";
  for (let i = 0; i < 40; i++) {
    const X = pr(140, w - 140),
      Y = pr(140, h - 140),
      r = pr(8, 18);
    x.beginPath();
    x.moveTo(X, Y - r);
    x.quadraticCurveTo(X, Y, X + r, Y);
    x.quadraticCurveTo(X, Y, X, Y + r);
    x.quadraticCurveTo(X, Y, X - r, Y);
    x.quadraticCurveTo(X, Y, X, Y - r);
    x.fill();
  }
  // Mosaic border of the arena.
  const B = 2.8 * S,
    c = B / 4,
    count = Math.ceil(w / c);
  x.fillStyle = "#8cc9c9";
  x.fillRect(0, 0, w, B);
  x.fillRect(0, h - B, w, B);
  x.fillRect(0, 0, B, h);
  x.fillRect(w - B, 0, B, h);
  const chip = (X, Y, col) => {
    x.fillStyle = col;
    roundRect(x, X + 3, Y + 3, c - 6, c - 6, 6);
    x.fill();
  };
  for (let r = 0; r < 4; r++)
    for (let i = 0; i < count; i++) {
      const wave = Math.sin((i + r * 1.5) * (Math.PI / 5)) > 0,
        col = r === 0 || r === 3 ? "#2aa3a8" : r === 1 ? (wave ? "#57cbd0" : "#ffffff") : wave ? "#ffffff" : "#8fdcdc",
        a = i * c,
        o = r * c;
      chip(a, o, col);
      chip(a, h - c - o, col);
      chip(o, a, col);
      chip(w - c - o, a, col);
    }
  x.strokeStyle = "#1f8f9a";
  x.lineWidth = 8;
  x.strokeRect(B + 4, B + 4, w - 2 * B - 8, h - 2 * B - 8);
}
function drawBathTile(x, w, h) {
  x.fillStyle = "#cfdfe2";
  x.fillRect(0, 0, w, h);
  const s = w / 2;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const X = i * s,
        Y = j * s;
      x.fillStyle = (i + j) % 2 ? "#fbfaf6" : "#f5f7f3";
      roundRect(x, X + 5, Y + 5, s - 10, s - 10, 10);
      x.fill();
      x.fillStyle = "rgba(255,255,255,.9)";
      roundRect(x, X + 20, Y + 18, s * 0.32, 10, 5);
      x.fill();
      x.fillStyle = "rgba(120,150,160,.12)";
      roundRect(x, X + 12, Y + s - 24, s - 24, 12, 6);
      x.fill();
    }
}
function drawBathWall(x, w, h) {
  x.fillStyle = "#a3d8d3";
  x.fillRect(0, 0, w, h);
  const n = 4,
    s = w / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const X = i * s,
        Y = j * s,
        g = x.createLinearGradient(X, Y, X + s, Y + s);
      g.addColorStop(0, "#eefcf9");
      g.addColorStop(1, "#cdeee9");
      x.fillStyle = g;
      roundRect(x, X + 4, Y + 4, s - 8, s - 8, 8);
      x.fill();
      x.fillStyle = "rgba(255,255,255,.85)";
      roundRect(x, X + 12, Y + 11, s * 0.3, 6, 3);
      x.fill();
    }
}
function drawBathBand(x, w, h) {
  x.fillStyle = "#8cc9c9";
  x.fillRect(0, 0, w, h);
  const c = h / 2;
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < w / c; i++) {
      const wave = Math.sin((i + r * 1.5) * (Math.PI / 4)) > 0;
      x.fillStyle = r === 0 ? (wave ? "#2aa3a8" : "#bff0ee") : wave ? "#ffffff" : "#57cbd0";
      roundRect(x, i * c + 3, r * c + 3, c - 6, c - 6, 6);
      x.fill();
    }
}
// Whirlpool water: darker in the middle, foam arms that trail behind the (counter-clockwise) spin.
function drawSwirl(x, w, h) {
  x.clearRect(0, 0, w, h);
  const cx = w / 2,
    cy = h / 2,
    R = w / 2 - 2,
    g = x.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, "rgba(28,84,150,1)");
  g.addColorStop(0.12, "rgba(45,125,195,.92)");
  g.addColorStop(0.45, "rgba(95,185,230,.62)");
  g.addColorStop(0.85, "rgba(140,215,245,.42)");
  g.addColorStop(1, "rgba(160,225,245,0)");
  x.fillStyle = g;
  x.beginPath();
  x.arc(cx, cy, R, 0, 7);
  x.fill();
  x.lineCap = "round";
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * Math.PI * 2;
    for (const [lw, col] of [
      [26, "rgba(215,245,255,.35)"],
      [9, "rgba(255,255,255,.85)"],
    ]) {
      x.strokeStyle = col;
      x.lineWidth = lw;
      x.beginPath();
      for (let t = 0; t <= 1.001; t += 0.02) {
        const r = R * (0.1 + 0.82 * t),
          a = a0 + t * 3.3,
          px = cx + Math.cos(a) * r,
          py = cy + Math.sin(a) * r;
        t ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.stroke();
    }
  }
  seed(71);
  for (let i = 0; i < 70; i++) {
    const a = prand() * 6.283,
      r = R * pr(0.15, 0.9);
    x.strokeStyle = "rgba(255,255,255,.8)";
    x.lineWidth = 2;
    x.beginPath();
    x.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, pr(2.5, 7), 0, 7);
    x.stroke();
  }
}
function drawGrate(x, w, h) {
  const c = w / 2,
    g = x.createRadialGradient(c * 0.7, c * 0.6, 4, c, c, c);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.5, "#d3dde6");
  g.addColorStop(1, "#8e9fb0");
  x.fillStyle = g;
  x.beginPath();
  x.arc(c, c, c, 0, 7);
  x.fill();
  x.strokeStyle = "#26304d";
  x.lineCap = "round";
  x.lineWidth = 11;
  for (const r of [0.3, 0.52, 0.74])
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.2 + r;
      x.beginPath();
      x.arc(c, c, c * r, a, a + Math.PI / 3 - 0.42);
      x.stroke();
    }
  x.fillStyle = "#26304d";
  x.beginPath();
  x.arc(c, c, c * 0.11, 0, 7);
  x.fill();
  x.strokeStyle = "#6f8193";
  x.lineWidth = 9;
  x.beginPath();
  x.arc(c, c, c - 5, 0, 7);
  x.stroke();
}
function drawMirror(x, w, h) {
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#f6fcff");
  g.addColorStop(0.55, "#cfe8f6");
  g.addColorStop(1, "#a8d2ea");
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  x.fillStyle = "rgba(255,255,255,.7)";
  for (const [a, b] of [
    [0.34, 0.16],
    [0.62, 0.07],
  ]) {
    x.beginPath();
    x.moveTo(w * a, 0);
    x.lineTo(w * (a + b), 0);
    x.lineTo(w * (a + b - 0.45), h);
    x.lineTo(w * (a - 0.45), h);
    x.closePath();
    x.fill();
  }
}
function bathTextures() {
  if (tex.bathFloor) return;
  tex.bathFloor = keepT(canvasTex(2048, 2048, drawBathFloor));
  tex.bathTile = keepT(canvasTex(512, 512, drawBathTile, { repeat: [1, 1] }));
  tex.bathWall = keepT(canvasTex(512, 512, drawBathWall, { repeat: [1, 1] }));
  tex.bathBand = keepT(canvasTex(512, 64, drawBathBand, { repeat: [1, 1] }));
  tex.swirl = keepT(canvasTex(512, 512, drawSwirl));
  tex.grate = keepT(canvasTex(256, 256, drawGrate));
  tex.mirror = keepT(canvasTex(256, 256, drawMirror));
  texMat.bathFloor = keepM(toonMat("#ffffff", { map: tex.bathFloor, gloss: 0.3, rim: 0 }));
  texMat.bathTile = keepM(toonMat("#ffffff", { map: tex.bathTile, gloss: 0.35, rim: 0 }));
  texMat.bathWall = keepM(toonMat("#ffffff", { map: tex.bathWall, gloss: 0.45, rim: 0 }));
  texMat.bathBand = keepM(toonMat("#ffffff", { map: tex.bathBand, gloss: 0.35, rim: 0 }));
  texMat.grate = keepM(toonMat("#ffffff", { map: tex.grate, gloss: 1, rim: 0.2 }));
  texMat.mirror = keepM(new T.MeshBasicMaterial({ map: tex.mirror }));
}
// Rounded box by its real size (rbox grows by its radius along x and y).
function rb(b, x, y, z, w, h, d, r, c, g = 0, rot) {
  r = Math.min(r, w / 4 - 0.002, h / 4 - 0.002, d / 2 - 0.002);
  return b.rbox(x, y, z, w - 2 * r, h - 2 * r, d, r, c, g, rot);
}
// Bathtub body: the lower half of a long capsule, its top flattened into the water line.
const tubG = () =>
  cg("tubBody", () => {
    const g = new T.CapsuleGeometry(1, 2.2, 10, 40);
    g.rotateZ(Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, 0);
    g.computeVertexNormals();
    return g;
  });
const sailG = () =>
  cg("sail", () => {
    const s = new T.Shape();
    s.moveTo(0, 0);
    s.lineTo(1, 0);
    s.lineTo(0, 1);
    s.closePath();
    return new T.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false }).translate(0, 0, -0.06);
  });
const heartG = () =>
  cg("heart", () => {
    const s = new T.Shape();
    s.moveTo(0, -0.9);
    s.bezierCurveTo(-0.2, -0.6, -1, -0.25, -1, 0.25);
    s.bezierCurveTo(-1, 0.75, -0.3, 0.95, 0, 0.45);
    s.bezierCurveTo(0.3, 0.95, 1, 0.75, 1, 0.25);
    s.bezierCurveTo(1, -0.25, 0.2, -0.6, 0, -0.9);
    const g = new T.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.06, bevelSegments: 2 });
    g.center();
    return g;
  });
function buildBathroom(night) {
  bathTextures();
  const tint = night ? "#aab6ee" : "#ffffff";
  for (const k of ["bathWall", "bathBand", "bathTile"]) texMat[k].color.set(tint);
  const R = new Builder(),
    A = new Builder();
  // Floor: big tiles over the whole room, the mosaic floor of the arena on top.
  const floor = mesh(scaleUV(new T.PlaneGeometry(260, 260), 260 / 17, 260 / 17), texMat.bathTile, world, 0, -0.02, 0);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  solids.push(floor);
  const mat = mesh(new T.PlaneGeometry(68, 68), texMat.bathFloor, world, 0, 0.02, 0);
  mat.rotation.x = -Math.PI / 2;
  mat.castShadow = false;
  solids.push(mat);
  // Tiled walls with a mosaic band, a tiled skirting and the ceiling.
  const W = 66,
    H = 118;
  for (const [x, z, ry] of [
    [0, -W, 0],
    [0, W, Math.PI],
    [-W, 0, Math.PI / 2],
    [W, 0, -Math.PI / 2],
  ]) {
    const wall = mesh(scaleUV(new T.PlaneGeometry(2 * W, H), (2 * W) / 26, H / 26), texMat.bathWall, world, x, H / 2 - 0.02, z);
    wall.rotation.y = ry;
    wall.castShadow = false;
    const band = mesh(scaleUV(new T.PlaneGeometry(2 * W, 3.4), (2 * W) / 27.2, 1), texMat.bathBand, world, x - Math.sign(x) * 0.1, 44, z - Math.sign(z) * 0.1);
    band.rotation.y = ry;
    band.castShadow = false;
  }
  R.box(0, H, 0, 2 * W + 2, 1, 2 * W + 2, "#f4fbff");
  for (const [x, z, w, d] of [
    [0, -W + 0.4, 2 * W, 0.8],
    [0, W - 0.4, 2 * W, 0.8],
    [-W + 0.4, 0, 0.8, 2 * W],
    [W - 0.4, 0, 0.8, 2 * W],
  ]) {
    R.box(x, 1.5, z, w, 3, d, "#7fd0cf", 0.4);
    R.box(x, 3.15, z, w, 0.3, d * 1.35, "#5bbcbd", 0.3);
  }
  // Clawfoot bathtub along the far wall, brimming with foam.
  const tx = -24,
    tz = -50,
    top = 24;
  R.put(tubG(), [tx, top, tz], [0, 0, 0], [14, 20, 14], "#fbfdff", 0.75);
  for (const s of [-1, 1]) {
    R.rod([tx - 15.4, top, tz + s * 14], [tx + 15.4, top, tz + s * 14], 1.3, "#ffffff", 0.8);
    R.torus(tx + s * 15.4, top, tz, 14, 1.3, "#ffffff", 0.8, [Math.PI / 2, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2], Math.PI);
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const fx = tx + sx * 17,
        fz = tz + sz * 7;
      // Lion's-paw foot: a curved leg flaring into the tub, a ball and three claws.
      R.rod([fx - sx * 0.6, 7.6, fz], [fx + sx * 0.5, 3, fz + sz * 0.3], 0.75, "#f2c14e", 0.9);
      R.sphere(fx - sx * 0.7, 7.4, fz, 1.5, 0.8, 1.5, "#f2c14e", 0.9);
      R.sphere(fx + sx * 0.55, 1.5, fz + sz * 0.35, 1.25, 1.35, 1.25, "#f2c14e", 0.9);
      for (let k = 0; k < 3; k++) {
        const a = Math.atan2(sx, sz) + (k - 1) * 0.65;
        R.sphere(fx + sx * 0.55 + Math.sin(a) * 1.15, 0.45, fz + sz * 0.35 + Math.cos(a) * 1.15, 0.5, 0.45, 0.62, "#e5ad38", 0.9, [0, a, 0]);
      }
    }
  const water = new T.Shape();
  water.absarc(-15.4, 0, 12.6, Math.PI / 2, (Math.PI * 3) / 2, false);
  water.absarc(15.4, 0, 12.6, -Math.PI / 2, Math.PI / 2, false);
  const wm = mesh(new T.ShapeGeometry(water, 24), toonMat("#8fdcf4", { gloss: 0.9, rim: 0 }), world, tx, top + 0.08, tz);
  wm.rotation.x = -Math.PI / 2;
  wm.castShadow = false;
  seed(33);
  for (let i = 0; i < 70; i++) {
    const u = pr(-1, 1),
      v = pr(-1, 1),
      r = pr(1.4, i < 18 ? 4.6 : 3),
      px = tx + u * 26,
      pz = tz + v * 10;
    if (Math.hypot(Math.max(0, Math.abs(px - tx) - 15.4), pz - tz) > 11.5) continue;
    R.sphere(px, top + r * pr(0.25, 0.7), pz, r, r * 0.85, r, i % 4 ? "#ffffff" : "#eaf7ff", 0.3, [0, 0, 0], true);
  }
  duckParts(new Builder()).mesh(worldMat, group(world, tx + 9, top + 1.2, tz + 14)).parent.scale.setScalar(0.9);
  // Taps on the wall, a hand shower on a rail and the curtain on its rod.
  R.rod([tx, 34, -W], [tx, 34, -59.5], 1.1, "#e4ecf3", 1);
  R.torus(tx, 31.5, -59.5, 2.5, 1.1, "#e4ecf3", 1, [0, Math.PI / 2, Math.PI / 2], Math.PI / 2);
  R.cyl(tx, 30.7, -57, 1.2, 1.6, "#e4ecf3", 1);
  for (const s of [-1, 1]) {
    R.rod([tx + s * 7, 33, -W], [tx + s * 7, 33, -63.2], 0.8, "#e4ecf3", 1);
    R.cyl(tx + s * 7, 34.2, -63.2, 0.9, 2.2, "#e4ecf3", 1);
    R.box(tx + s * 7, 35.5, -63.2, 3.4, 0.6, 0.6, "#e4ecf3", 1);
    R.sphere(tx + s * 7, 35.9, -63.2, 0.55, 0.3, 0.55, s < 0 ? "#ff5d5d" : "#4f9dff", 0.6);
  }
  R.rod([tx + 20, 36, -W + 0.8], [tx + 20, 84, -W + 0.8], 0.55, "#e4ecf3", 1);
  R.rod([tx + 20, 70, -W + 1.2], [tx + 20, 70, -61], 0.7, "#e4ecf3", 1);
  R.cyl(tx + 20, 70, -59.6, 3.2, 1.2, "#e4ecf3", 1, [Math.PI / 2 - 0.35, 0, 0]);
  R.cyl(tx + 20, 70.4, -58.9, 2.7, 0.3, "#b8c7d6", 0.8, [Math.PI / 2 - 0.35, 0, 0]);
  const hose = new T.CatmullRomCurve3(
    [
      [tx + 7, 32.4, -63.2],
      [tx + 11, 27, -62.4],
      [tx + 17, 27.5, -62],
      [tx + 21.5, 38, -62.6],
      [tx + 21.5, 56, -62.4],
      [tx + 20.6, 67.5, -61],
    ].map((p) => v3(...p)),
  );
  R.put(new T.TubeGeometry(hose, 48, 0.45, 8), [0, 0, 0], [0, 0, 0], [1, 1, 1], "#c9d4df", 0.6);
  const rodY = 100,
    rodZ = tz + 12.5;
  R.rod([tx - 31, rodY, rodZ], [tx + 31, rodY, rodZ], 0.6, "#e4ecf3", 1);
  for (const s of [-1, 1]) R.rod([tx + s * 31, rodY, rodZ], [tx + s * 31, rodY, -W], 0.6, "#e4ecf3", 1);
  for (let i = 0; i < 9; i++) {
    const x = tx - 30 + i * 1.9;
    R.torus(x, rodY - 0.4, rodZ, 0.8, 0.14, "#e4ecf3", 1, [0, Math.PI / 2, 0]);
    R.cyl(x, rodY - 36, rodZ + (i % 2) * 0.7, 1.15, 70, i % 2 ? "#ffffff" : "#9fe2ff", 0.15);
  }
  for (let i = 0; i < 7; i++) R.cyl(tx - 31 - (i % 2) * 0.6, rodY - 36, rodZ - 3 - i * 2, 1.1, 70, i % 2 ? "#9fe2ff" : "#ffffff", 0.15);
  // Vanity with a basin, a mirror and a light on the right wall.
  const vx = W - 11,
    vz = 4;
  rb(R, vx, 15, vz, 20, 30, 34, 0.8, "#8fd8cc", 0.3);
  for (const s of [-1, 1]) {
    rb(R, vx - 10.2, 14, vz + s * 8.3, 0.8, 24, 15.4, 0.3, "#b3ebe2", 0.3);
    R.sphere(vx - 10.8, 20, vz + s * 2.2, 0.7, 0.7, 0.7, "#ffd23f", 0.8);
  }
  rb(R, vx - 0.5, 30.7, vz, 22, 1.6, 37, 0.3, "#ffffff", 0.5);
  R.put(G.hemi, [vx - 1.5, 36, vz], [Math.PI, 0, 0], [7.2, 4.2, 7.2], "#ffffff", 0.75);
  R.torus(vx - 1.5, 36, vz, 7, 0.45, "#ffffff", 0.75, [Math.PI / 2, 0, 0]);
  R.cyl(vx - 1.5, 35.9, vz, 6.7, 0.1, "#cfeefa", 0.9);
  R.rod([W - 3, 31.5, vz], [W - 3, 43, vz], 0.75, "#e4ecf3", 1);
  R.torus(W - 5.5, 43, vz, 2.5, 0.75, "#e4ecf3", 1, [0, 0, 0], Math.PI);
  R.cyl(W - 8, 41.8, vz, 0.8, 2.4, "#e4ecf3", 1);
  R.rod([W - 3, 38, vz], [W - 5.5, 39.2, vz + 3], 0.35, "#e4ecf3", 1);
  const mirror = mesh(new T.PlaneGeometry(30, 32), texMat.mirror, world, W - 1.05, 64, vz);
  mirror.rotation.y = -Math.PI / 2;
  mirror.castShadow = false;
  rb(R, W - 0.45, 64, vz, 1.1, 35, 33, 0.3, "#ffffff", 0.4);
  rb(R, W - 1.6, 83, vz, 2.2, 2.2, 26, 0.5, "#ffffff", 0.4);
  const bar = mesh(G.box, night ? glow("#fff1c9", 2.2) : material("#fff7df", 0.3), world, W - 2.8, 82.3, vz);
  bar.scale.set(0.4, 0.8, 24);
  bar.castShadow = false;
  if (night) bar.layers.set(FX);
  // Things on the counter.
  rb(R, vx - 3, 34.5, vz - 11.5, 3.2, 6, 3.2, 0.6, "#ffb3c6", 0.5);
  R.cyl(vx - 3, 38.2, vz - 11.5, 0.5, 1.4, "#ffffff", 0.4);
  R.box(vx - 3.9, 38.9, vz - 11.5, 2.4, 0.5, 0.6, "#ffffff", 0.4);
  R.cyl(vx - 3, 33.4, vz + 12, 1.8, 3.8, "#4fbfff", 0.6);
  for (const [s, c] of [
    [-1, "#ffd23f"],
    [1, "#ff6b9d"],
  ]) {
    R.rod([vx - 3 + s * 0.5, 33, vz + 12], [vx - 3 + s * 1.4, 41, vz + 12 + s * 0.6], 0.28, c, 0.5);
    R.box(vx - 3 + s * 1.5, 41.6, vz + 12 + s * 0.65, 0.6, 1.4, 0.7, "#ffffff");
  }
  R.torus(W - 1.2, 44, -22, 3, 0.35, "#e4ecf3", 1, [0, Math.PI / 2, 0]);
  rb(R, W - 1.6, 37.5, -22, 1.4, 12, 8, 0.5, "#ffd23f", 0.2);
  R.box(W - 2.35, 34, -22, 0.1, 1.2, 8.1, "#ffffff");
  // Bathroom scale by the vanity.
  rb(A, 44, 0.8, -26, 11, 1.6, 11, 0.4, "#ffffff", 0.5);
  A.cyl(44, 1.62, -28, 2.2, 0.1, "#dff4ff", 0.8);
  A.box(44, 1.7, -28.6, 0.2, 0.08, 1.8, "#ff5d5d");
  // Heated towel rail with a towel on the left wall.
  for (const s of [-1, 1]) R.rod([-W + 2.4, 18, -4 + s * 9], [-W + 2.4, 66, -4 + s * 9], 0.55, "#e4ecf3", 1);
  for (let y = 22; y <= 62; y += 8) R.rod([-W + 2.4, y, -13], [-W + 2.4, y, 5], 0.4, "#e4ecf3", 1);
  rb(R, -W + 3.2, 49, -4, 1.6, 26, 15, 0.5, "#ffb3c6", 0.1);
  R.box(-W + 3.2, 42, -4, 1.7, 2.2, 15.1, "#ffffff");
  R.box(-W + 3.2, 56, -4, 1.7, 1.2, 15.1, "#ffffff");
  // Door on the left wall.
  rb(R, -W + 0.8, 26, 36, 1.4, 52, 24, 0.6, "#ffffff", 0.3);
  rb(R, -W + 1.5, 26, 36, 0.6, 46, 19, 0.3, "#f2f7fb", 0.3);
  R.sphere(-W + 2.2, 26, 45, 1, 1, 1, "#ffd23f", 0.9);
  // Washing machine on the front wall, with a window and a shelf above.
  const mx = -34,
    mz = W - 13.5;
  rb(R, mx, 16, mz, 30, 32, 26, 1.2, "#f7f9fb", 0.5);
  R.box(mx, 28.6, mz - 13.1, 28, 4.6, 0.5, "#e3e9ef", 0.3);
  R.cyl(mx + 10, 28.6, mz - 13.4, 1.5, 0.8, "#ffffff", 0.6, [Math.PI / 2, 0, 0]);
  R.box(mx - 4, 28.6, mz - 13.4, 7, 2, 0.3, "#2b4b7a", 0.8);
  R.torus(mx - 2, 13, mz - 13.2, 8.3, 1.1, "#e4ecf3", 1);
  R.sphere(mx - 2, 13, mz - 13.2, 7.3, 7.3, 1.4, "#4f7fc0", 1);
  R.sphere(mx - 4.2, 15.6, mz - 14.4, 2, 1.2, 0.4, "#cfe6ff", 0.9, [0, 0, 0.7]);
  rb(R, mx - 7, 36.5, mz - 2, 6, 9, 4.5, 0.8, "#ff9f1c", 0.5);
  R.cyl(mx - 7, 41.6, mz - 2, 1, 1.4, "#ffffff", 0.5);
  for (let i = 0; i < 3; i++) rb(R, mx + 6, 33.2 + i * 1.5, mz, 12, 1.5, 9, 0.3, ["#8fe0cf", "#ffffff", "#ffb38a"][i], 0.1);
  const view = mesh(new T.PlaneGeometry(30, 24), night ? texMat.windowNight : texMat.windowDay, world, 18, 72, W - 0.1);
  view.rotation.y = Math.PI;
  view.castShadow = false;
  view.receiveShadow = false;
  const frost = mesh(new T.PlaneGeometry(30, 11), new T.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: night ? 0.35 : 0.6, depthWrite: false }), world, 18, 65.5, W - 0.3);
  frost.rotation.y = Math.PI;
  frost.castShadow = false;
  frost.layers.set(FX);
  R.box(18, 85, W - 0.8, 33, 1.8, 1.8, "#ffffff");
  R.box(18, 59, W - 0.8, 33, 1.8, 1.8, "#ffffff");
  R.box(2.5, 72, W - 0.8, 1.8, 27.8, 1.8, "#ffffff");
  R.box(33.5, 72, W - 0.8, 1.8, 27.8, 1.8, "#ffffff");
  R.box(18, 72, W - 0.6, 1, 24, 1.2, "#ffffff");
  rb(R, 18, 57.6, W - 3, 36, 1.2, 5.4, 0.3, "#ffffff", 0.3);
  R.cyl(8, 59.8, W - 3, 1.6, 3.2, "#fff4d6", 0.2);
  R.cyl(8, 61.85, W - 3, 0.08, 0.9, "#3a2f5b");
  const flame = mesh(G.sphereLo, night ? glow("#ffc56b", 2.6) : material("#ffd88a", 0.3), world, 8, 62.7, W - 3);
  flame.scale.set(0.35, 0.6, 0.35);
  flame.castShadow = false;
  if (night) flame.layers.set(FX);
  R.cyl(28, 60.4, W - 3, 1.8, 3.6, "#e58e5a", 0.2);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    R.put(leafG, [28 + Math.sin(a) * 0.4, 62, W - 3 + Math.cos(a) * 0.4], [Math.cos(a) * 0.5, a, 0], [1.2, 2, 1.2], k % 2 ? "#5cc56d" : "#48ad5b");
  }
  // A big potted plant in the corner.
  R.cyl(54, 5, 52, 5, 10, "#e58e5a", 0.2);
  R.torus(54, 10, 52, 5, 0.6, "#d0784a", 0.2, [Math.PI / 2, 0, 0]);
  R.cyl(54, 9.8, 52, 4.6, 0.3, "#6b4a2a");
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2 + k * 0.4;
    R.put(leafG, [54 + Math.sin(a) * 1.2, 9.5, 52 + Math.cos(a) * 1.2], [Math.cos(a) * (0.35 + (k % 3) * 0.12), a, 0], [4.2, 7 + (k % 3), 4.2], ["#5cc56d", "#48ad5b", "#6fd36d"][k % 3], 0.2);
  }
  // Seashell night light by the door.
  const shell = mesh(G.hemi, night ? glow("#ffd08a", 2.4) : material("#ffe2c4", 0.3), world, -W + 0.6, 9, 20);
  shell.rotation.z = -Math.PI / 2;
  shell.scale.set(1.8, 0.9, 2);
  shell.castShadow = false;
  if (night) shell.layers.set(FX);
  // ----- arena props (cover) -----
  makeDuck(-21, -21, 0.78, 1.65);
  makeDuck(2, -24.5, 2.6, 1);
  makeBottles(21, 21);
  makeToothCup(-21, 21);
  makeLaundryBasket(22, -22);
  makeToiletRoll(0, 23.5);
  makeSlippers(-24.5, 0);
  makeHairDryer(23.5, 1);
  makeTowels(12.5, 17);
  makeSoapBar(-8, -3);
  makeSponge(13, 6);
  makeBathBombs(-11.5, 11.5);
  makeToyBoat(-4, -13);
  makeNailPolish(3, 3);
  makeDrain(night);
  makeBathBubbles(night);
  R.mesh(worldMat, world, { cast: false });
  A.mesh(worldMat, world);
  if (night) {
    const lamp = new T.PointLight("#ffd6a0", 480, 130, 1.6);
    lamp.position.set(50, 70, 4);
    scene.add(lamp);
    const moon = new T.PointLight("#9fb4ff", 280, 140, 1.5);
    moon.position.set(18, 62, 52);
    scene.add(moon);
    const glowLamp = new T.PointLight("#ffc27a", 110, 45, 1.8);
    glowLamp.position.set(-60, 9, 20);
    scene.add(glowLamp);
  }
}
function makeBottles(x, z) {
  const b = new Builder();
  rb(b, -1.8, 4.8, -0.8, 4.4, 9.6, 2.8, 0.8, "#ff8fb8", 0.6);
  rb(b, -1.8, 4.3, -0.8, 4.55, 4, 2.95, 0.4, "#ffffff", 0.2);
  b.put(heartG(), [-1.8, 4.3, 0.72], [0, 0, 0], [0.8, 0.8, 0.8], "#ff5d8f", 0.4);
  b.cyl(-1.8, 10, -0.8, 0.6, 1, "#ffffff", 0.4);
  rb(b, -1.8, 11, -0.8, 1.6, 1.2, 1.6, 0.3, "#ffffff", 0.4);
  b.box(-1.8, 11.1, 0.4, 0.5, 0.45, 2, "#ffffff", 0.4);
  rb(b, 2.1, 3.9, 0.6, 3.6, 7.8, 2.4, 0.7, "#7fd8ff", 0.6);
  rb(b, 2.1, 3.6, 0.6, 3.75, 3, 2.55, 0.35, "#ffffff", 0.2);
  b.put(starG, [2.1, 3.6, 1.95], [0, 0, 0], [0.55, 0.55, 0.3], "#2f8fd8", 0.4);
  b.cyl(2.1, 8.4, 0.6, 1.1, 1.2, "#2f8fd8", 0.5);
  b.cyl(0.3, 2.2, 3, 1.5, 4.4, "#c9a2ff", 0.6);
  b.sphere(0.3, 4.4, 3, 1.5, 0.6, 1.5, "#c9a2ff", 0.6);
  b.cyl(0.3, 5.2, 3, 0.7, 1, "#ffffff", 0.3);
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x - 1.8, z - 0.8, 2.5, 11.5, m);
  addObstacle(x + 2.1, z + 0.6, 2.1, 9);
  addObstacle(x + 0.3, z + 3, 1.6, 5.7);
}
function makeToothCup(x, z) {
  const b = new Builder();
  b.cyl(0, 3.2, 0, 2.5, 6.4, "#ffd23f", 0.55);
  b.torus(0, 6.4, 0, 2.42, 0.24, "#ffc21a", 0.55, [Math.PI / 2, 0, 0]);
  b.cyl(0, 6.3, 0, 2.3, 0.1, "#c99a1a");
  b.torus(0, 2, 0, 2.52, 0.12, "#ffffff", 0.3, [Math.PI / 2, 0, 0]);
  for (const [rx, rz, c] of [
    [0.22, -0.2, "#4f9dff"],
    [-0.2, 0.25, "#ff6b9d"],
  ])
    b.at([0, 1, 0], [rx, 0, rz], [1, 1, 1], (q) => {
      q.cyl(0, 5.5, 0, 0.36, 11, c, 0.6);
      rb(q, 0, 11.6, 0.15, 0.9, 2.4, 0.8, 0.2, c, 0.6);
      q.box(0, 11.7, 0.75, 0.72, 2, 0.9, "#ffffff");
      q.box(0, 11.7, 1.23, 0.74, 2, 0.08, "#7fdcff");
    });
  const tube = [4.4, 2.6],
    tr = 0.6;
  b.at([tube[0], 0.95, tube[1]], [0, tr, 0], [1, 1, 1], (q) => {
    q.sphere(0, 0, 0, 3.3, 0.95, 1.35, "#ffffff", 0.45);
    q.sphere(0.6, 0, 0, 0.55, 0.97, 1.37, "#4fbfff", 0.45);
    q.sphere(-0.6, 0, 0, 0.3, 0.97, 1.37, "#ff5d5d", 0.45);
    q.box(3.3, 0.05, 0, 0.6, 0.3, 2.9, "#ffffff", 0.3);
    q.cyl(-3.4, 0, 0, 0.62, 1.1, "#ff5d5d", 0.5, [0, 0, Math.PI / 2]);
    q.sphere(-4.4, -0.45, 0.2, 0.75, 0.45, 0.55, "#ffffff", 0.4);
    q.sphere(-4.9, -0.4, 0.3, 0.35, 0.35, 0.35, "#7fdcff", 0.4);
  });
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z, 2.6, 6.6, m);
  for (const s of [-1, 1]) {
    const [ox, oz] = localToWorld(x + tube[0], z + tube[1], tr, s * 1.7, 0);
    addObstacle(ox, oz, 1.25, 1.9);
  }
}
function makeLaundryBasket(x, z) {
  const b = new Builder();
  b.cyl(0, 3.6, 0, 4, 7.2, "#e6bf7a", 0.15);
  for (const y of [1.1, 2.5, 3.9, 5.3]) b.torus(0, y, 0, 4.03, 0.26, "#c99a55", 0.15, [Math.PI / 2, 0, 0]);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    b.cyl(Math.sin(a) * 4.05, 3.6, Math.cos(a) * 4.05, 0.13, 7.1, "#d6ab66");
  }
  b.torus(0, 7.2, 0, 4, 0.48, "#b8864a", 0.25, [Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) b.torus(s * 4.3, 6.2, 0, 1, 0.26, "#b8864a", 0.25, [0, Math.PI / 2, 0], Math.PI);
  b.sphere(-1, 7.2, -0.6, 2.8, 1.2, 2.4, "#ff9ecb", 0.1);
  b.sphere(1.4, 7.5, 1, 2.2, 1.1, 2, "#7fd8ff", 0.1);
  b.sphere(0.4, 7.9, -1.6, 1.4, 0.8, 1.3, "#ffffff", 0.1);
  b.capsule(3.4, 5.6, 2.3, 0.5, 3, "#ffffff", 0.1, [0.25, 0, -0.1]);
  for (const y of [4.8, 6]) b.torus(3.46, y, 2.52, 0.52, 0.12, "#ff5d5d", 0.2, [Math.PI / 2 + 0.25, 0, 0]);
  b.sphere(3.6, 3.9, 2.9, 0.6, 0.8, 0.9, "#ffffff", 0.1);
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z, 4.3, 7.4, m);
}
function makeToiletRoll(x, z) {
  const b = new Builder();
  b.cyl(0, 2.2, 0, 2.2, 5.6, "#fffdf7", 0.1, [0, 0, Math.PI / 2]);
  b.cyl(0, 2.2, 0, 0.9, 5.7, "#c99a62", 0.1, [0, 0, Math.PI / 2]);
  b.cyl(0, 2.2, 0, 0.7, 5.75, "#6b4a2a", 0, [0, 0, Math.PI / 2]);
  for (const s of [-2.2, -1.1, 0, 1.1, 2.2]) b.torus(s, 2.2, 0, 2.21, 0.05, "#e9e4da", 0, [0, Math.PI / 2, 0]);
  b.box(0, 0.05, -3.9, 4.6, 0.08, 7.8, "#fffdf7", 0.1);
  for (const pz of [-2.4, -4.9, -7.4]) b.box(0, 0.1, pz, 4.62, 0.03, 0.12, "#ddd6c8");
  b.put(heartG(), [0, 0.12, -6.2], [-Math.PI / 2, 0, 0], [0.55, 0.55, 0.2], "#8fd8ff", 0.2);
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x - 1.4, z, 2.2, 4.4, m);
  addObstacle(x + 1.4, z, 2.2, 4.4);
}
function makeSlippers(x, z) {
  const b = new Builder();
  for (const s of [-1, 1]) {
    const sz = z + s * 3,
      rot = -s * 0.12;
    b.at([0, 0, s * 3], [0, rot, 0], [1, 1, 1], (q) => {
      q.rbox(0, 0.45, 0, 10, 0.5, 4.2, 0.2, "#ff9ec2", 0.2);
      q.sphere(2.2, 1.1, 0, 3.4, 1.9, 2.25, "#ffd1e3", 0.1);
      q.sphere(-3.4, 0.9, 0, 1.9, 0.95, 2.1, "#ffd1e3", 0.1);
      q.sphere(-1.1, 1.62, 0, 1.9, 0.3, 1.55, "#e86f9f", 0.2);
      for (const e of [-1, 1]) {
        q.sphere(4.55, 2.25, e * 0.9, 0.34, 0.4, 0.3, "#2b2744", 0.9);
        q.sphere(4.75, 2.4, e * 0.95, 0.1, 0.1, 0.06, "#ffffff", 0.2);
        q.capsule(2.8, 3.9, e * 0.95, 0.55, 2.3, "#ffd1e3", 0.1, [e * 0.25, 0, 0.4]);
        q.capsule(2.95, 3.9, e * 1.02, 0.3, 1.8, "#ff9ec2", 0.1, [e * 0.25, 0, 0.4]);
      }
      q.sphere(5.55, 1.75, 0, 0.3, 0.25, 0.3, "#ff6b9d", 0.5);
    });
    const [fx, fz] = localToWorld(x, sz, rot, 2.4, 0),
      [hx, hz] = localToWorld(x, sz, rot, -3.1, 0);
    addObstacle(fx, fz, 2.4, 3.2);
    addObstacle(hx, hz, 2.1, 1.3);
  }
  solids.push(b.mesh(worldMat, group(world, x, 0, z)));
}
function makeHairDryer(x, z) {
  const b = new Builder(),
    c = "#b98cff",
    d = "#8e6bd8";
  b.cyl(0, 1.8, 0, 1.8, 6, c, 0.6, [Math.PI / 2, 0, 0]);
  b.cyl(0, 1.8, 3.1, 1.85, 0.4, d, 0.4, [Math.PI / 2, 0, 0]);
  for (const r of [1.3, 0.75]) b.torus(0, 1.8, 3.32, r, 0.1, "#4a3a7a", 0.2);
  b.cyl(0, 1.8, -3.6, 1.2, 1.4, d, 0.5, [Math.PI / 2, 0, 0]);
  b.cyl(0, 1.8, -4.4, 1.25, 0.3, "#4a3a7a", 0.4, [Math.PI / 2, 0, 0]);
  b.capsule(3.2, 1.15, 0.6, 1, 3, c, 0.6, [0, 0, Math.PI / 2]);
  b.sphere(3, 2.05, 0.6, 0.45, 0.25, 0.35, "#ffd23f", 0.6);
  b.sphere(4.1, 2.05, 0.6, 0.3, 0.2, 0.3, "#ff5d5d", 0.6);
  const cord = [
    [5, 0.4, 0.6],
    [6.8, 0.3, 1.8],
    [6.2, 0.3, 4],
    [7.8, 0.3, 5.6],
    [8.6, 0.3, 3.4],
  ];
  for (let i = 1; i < cord.length; i++) b.rod(cord[i - 1], cord[i], 0.22, "#3a2f5b", 0.2);
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z - 1.6, 2, 3.6, m);
  addObstacle(x, z + 1.6, 2, 3.6);
  addObstacle(x, z - 3.9, 1.4, 3.1);
  addObstacle(x + 3.3, z + 0.6, 1.2, 2.2);
}
function makeTowels(x, z) {
  const b = new Builder();
  b.rbox(0, 0.35, 0, 6.8, 0.3, 5, 0.2, "#8fe0cf", 0.1);
  for (const s of [-2.2, 2.2]) b.rbox(s, 0.35, 0, 0.7, 0.34, 5.04, 0.18, "#ffffff", 0.1);
  b.cyl(3.55, 0.35, 0, 0.35, 5, "#8fe0cf", 0.1, [Math.PI / 2, 0, 0]);
  b.at([0.3, 1.02, 0.2], [0, 0.22, 0], [1, 1, 1], (q) => {
    q.rbox(0, 0, 0, 5.8, 0.3, 4.4, 0.2, "#ffb38a", 0.1);
    q.rbox(0, 0, 0, 0.9, 0.34, 4.44, 0.18, "#ffffff", 0.1);
    q.cyl(-3.05, 0, 0, 0.35, 4.4, "#ffb38a", 0.1, [Math.PI / 2, 0, 0]);
  });
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z, 3.4, 1.35, m);
}
function makeSoapBar(x, z) {
  const b = new Builder();
  b.sphere(0, 0.63, 0, 2.7, 0.66, 1.75, "#ffc2d9", 0.85);
  b.put(heartG(), [0, 1.2, 0], [-Math.PI / 2, 0, 0], [0.75, 0.75, 0.35], "#ffe0ec", 0.6);
  seed(19);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + pr(-0.2, 0.2),
      r = pr(0.25, 0.55);
    b.sphere(Math.cos(a) * 2.75, r * 0.6, Math.sin(a) * 1.85, r, r * 0.8, r, "#ffffff", 0.5, [0, 0, 0], true);
  }
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z, 2.2, 1.3, m);
}
function makeSponge(x, z) {
  const b = new Builder(),
    rot = 0.4;
  b.at([0, 0, 0], [0, rot, 0], [1, 1, 1], (q) => {
    q.rbox(0, 0.75, 0, 5.6, 0.9, 3.8, 0.3, "#ffd84a", 0.1);
    q.rbox(0, 1.72, 0, 5.8, 0.36, 3.8, 0.12, "#5fcf6a", 0.1);
    seed(23);
    for (let i = 0; i < 34; i++) {
      const side = i % 3,
        u = pr(-2.7, 2.7),
        v = pr(0.3, 1.3),
        r = pr(0.12, 0.26);
      if (side === 0) q.sphere(u, v, 1.92, r, r, 0.05, "#e2b52c", 0, [0, 0, 0], true);
      else if (side === 1) q.sphere(u, v, -1.92, r, r, 0.05, "#e2b52c", 0, [0, 0, 0], true);
      else q.sphere(Math.sign(u) * 3.12, v, pr(-1.6, 1.6), 0.05, r, r, "#e2b52c", 0, [0, 0, 0], true);
    }
  });
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z, 3, 2, m);
}
function makeBathBombs(x, z) {
  const b = new Builder(),
    cols = ["#ffffff", "#ffd23f", "#ff5d7a", "#4fbfff"];
  seed(29);
  for (const [px, pz, r, c] of [
    [-1.3, -0.6, 1.5, "#ff9ecb"],
    [1.5, 0.3, 1.3, "#7fe0d6"],
    [0.1, 2.1, 1.2, "#c9a2ff"],
  ]) {
    b.sphere(px, r, pz, r, r, r, c, 0.25);
    b.torus(px, r, pz, r * 1.01, 0.08, "#ffffff", 0.3, [Math.PI / 2 + 0.3, 0, 0.2]);
    for (let i = 0; i < 14; i++) {
      const u = pr(-1, 1),
        a = pr(0, 6.28),
        k = Math.sqrt(1 - u * u);
      b.sphere(px + Math.cos(a) * k * r, r + u * r, pz + Math.sin(a) * k * r, 0.13, 0.13, 0.13, cols[i % 4], 0.3, [0, 0, 0], true);
    }
    addObstacle(x + px, z + pz, r, r * 2);
  }
  solids.push(b.mesh(worldMat, group(world, x, 0, z)));
}
function makeToyBoat(x, z) {
  const g = group(world, x, 0, z);
  g.rotation.y = 0.5;
  const b = new Builder();
  b.sphere(0, 0.9, 0, 3.4, 1.1, 1.9, "#ff5d5d", 0.6);
  b.rbox(0, 2.0, 0, 5.2, 0.1, 2.6, 0.08, "#ffffff", 0.4);
  b.torus(0, 1.1, 0, 1, 0.12, "#ffffff", 0.3, [Math.PI / 2, 0, 0]);
  rb(b, -0.8, 2.9, 0, 2.6, 1.8, 1.8, 0.3, "#ffd23f", 0.4);
  rb(b, -0.8, 3.95, 0, 3, 0.4, 2.2, 0.15, "#4f9dff", 0.4);
  for (const s of [-1, 1]) b.cyl(-0.8, 3, s * 0.92, 0.32, 0.1, "#bfe8ff", 0.9, [Math.PI / 2, 0, 0]);
  b.rod([1.2, 2, 0], [1.2, 8.2, 0], 0.13, "#8b5a2b");
  b.put(sailG(), [1.35, 2.6, 0], [0, 0, 0], [3.4, 5.2, 1], "#ffffff", 0.2);
  b.put(sailG(), [1.3, 7.3, 0], [0, 0, -Math.PI / 2], [0.9, 1.4, 1], "#4f9dff", 0.2);
  b.sphere(3.4, 1.3, 0, 0.35, 0.35, 0.35, "#ffffff", 0.3);
  const m = b.mesh(worldMat, g);
  addObstacle(x, z, 2.8, 3.8, m);
}
function makeNailPolish(x, z) {
  const b = new Builder();
  rb(b, 0, 1.3, 0, 2.6, 2.6, 2.4, 0.45, "#ff4d8d", 0.95);
  b.sphere(-0.55, 1.9, 1.15, 0.28, 0.6, 0.1, "#ffd1e3", 0.9);
  b.cyl(0, 2.85, 0, 0.55, 0.5, "#ffc2d9", 0.6);
  b.cyl(0, 4.5, 0, 0.72, 2.9, "#2b2744", 0.9);
  b.sphere(0, 5.95, 0, 0.72, 0.28, 0.72, "#2b2744", 0.9);
  b.sphere(2.3, 0.05, 1.1, 1.45, 0.07, 1.05, "#ff4d8d", 0.95);
  const m = b.mesh(worldMat, group(world, x, 0, z));
  addObstacle(x, z, 1.6, 6, m);
}
// The drain: a chrome grate in the floor. Every 36 seconds the water gathers (a warning ring), then swirls into it.
function makeDrain(night) {
  const D = DRAIN,
    grate = mesh(G.circle, texMat.grate, world, D.x, 0.06, D.z);
  grate.scale.set(D.core, D.core, 1);
  grate.rotation.x = -Math.PI / 2;
  grate.castShadow = false;
  const b = new Builder();
  b.torus(D.x, 0.07, D.z, D.core + 0.08, 0.17, "#e4ecf3", 1, [Math.PI / 2, 0, 0]);
  b.mesh(worldMat, world, { cast: false });
  const g = group(world, D.x, 0, D.z),
    disc = (r, y, k) => {
      const m = new T.Mesh(G.circle, new T.MeshBasicMaterial({ map: tex.swirl, transparent: true, depthWrite: false, opacity: 0 }));
      m.material.color.setScalar(k);
      m.scale.set(r, r, 1);
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.layers.set(FX);
      m.renderOrder = 3;
      g.add(m);
      return m;
    },
    outer = disc(D.pull, 0.09, night ? 0.8 : 1),
    inner = disc(D.core + 2.4, 0.11, night ? 0.9 : 1.1),
    ring = new T.Mesh(
      cg("drainRing", () => new T.RingGeometry(D.pull - 0.4, D.pull, 96)),
      new T.MeshBasicMaterial({ color: "#ffffff", transparent: true, depthWrite: false, opacity: 0 }),
    );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  ring.layers.set(FX);
  ring.renderOrder = 4;
  g.add(ring);
  g.visible = false;
  const warnC = new T.Color("#ffb13b").multiplyScalar(1.3),
    actC = new T.Color("#4fc3ff").multiplyScalar(1.4);
  let lvl = 0,
    spin = 0;
  animated.push((dt) => {
    const on = options.arena === "bathroom" && mode !== "menu",
      c = time % 36,
      act = on && c > 27,
      warn = on && c > 23 && !act,
      want = act ? 1 : warn ? 0.2 + (0.3 * (c - 23)) / 4 : 0;
    lvl += (want - lvl) * (1 - Math.exp(-dt * 2.5));
    g.visible = lvl > 0.01 || warn || act;
    if (!g.visible) return;
    spin += dt * (0.4 + lvl * 2.4);
    outer.rotation.z = spin;
    inner.rotation.z = spin * 2.2;
    outer.material.opacity = lvl * 0.9;
    inner.material.opacity = Math.min(1, lvl * 1.1);
    ring.material.color.copy(act ? actC : warnC);
    ring.material.opacity = warn ? 0.35 + 0.25 * Math.sin(worldClock * 9) : act ? 0.5 + 0.12 * Math.sin(worldClock * 14) : 0;
  });
}
// Soap bubbles drifting up around the room (the ones above the tub come out of the foam).
function makeBathBubbles(night) {
  const n = 28,
    im = new T.InstancedMesh(G.sphereMid, bubbleMat, n);
  im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  seed(97);
  const list = [];
  for (let i = 0; i < n; i++) {
    const tub = i < 14,
      b = {
        x: tub ? pr(-50, 2) : pr(-62, 62),
        z: tub ? pr(-60, -40) : pr(-62, 62),
        y0: tub ? pr(25, 95) : pr(14, 95),
        s: pr(0.8, 2.4),
        v: pr(1.2, 3),
        ph: pr(0, 6.28),
        lo: tub ? 25 : 14,
      };
    if (!tub && Math.abs(b.x) < 38 && Math.abs(b.z) < 38) b.lo = 30;
    list.push(b);
    im.setColorAt(i, _c.set(night ? "#c9d3ff" : "#ffffff"));
  }
  im.castShadow = false;
  im.receiveShadow = false;
  im.frustumCulled = false;
  im.layers.set(FX);
  world.add(im);
  let t = 0;
  const step = () => {
    list.forEach((b, i) => {
      const span = 96 - b.lo,
        y = b.lo + ((((b.y0 - b.lo + t * b.v) % span) + span) % span);
      _m4.compose(_p.set(b.x + Math.sin(t * 0.6 + b.ph) * 2, y, b.z + Math.cos(t * 0.5 + b.ph) * 2), _q.identity(), _s.setScalar(b.s * Math.min(1, (y - b.lo) / 4)));
      im.setMatrixAt(i, _m4);
    });
    im.instanceMatrix.needsUpdate = true;
  };
  step();
  animated.push((dt) => {
    t += dt;
    step();
  });
}
// ---------- weapons (baked, cached per weapon id) ----------
const steelC = "#dfe9f0",
  woodC = "#c98a4c";
function buildWeapon(id) {
  const b = new Builder();
  if (id === 0) {
    b.capsule(0, 0, 0.12, 0.07, 0.26, "#ff4d6d", 0.3, [Math.PI / 2, 0, 0]);
    b.rbox(0, 0, 0.32, 0.34, 0.1, 0.08, 0.04, "#ffc93d", 0.7);
    const clip = [
      [-0.07, 0.36],
      [-0.12, 1.12],
      [0, 1.24],
      [0.12, 1.12],
      [0.12, 0.5],
      [0.04, 0.44],
      [-0.04, 0.5],
      [-0.04, 1.02],
      [0.04, 1.02],
      [0.04, 0.62],
    ].map(([x, z]) => v3(x, 0, z));
    b.put(new T.TubeGeometry(new T.CatmullRomCurve3(clip), 64, 0.03, 8), [0, 0, 0], [0, 0, 0], [1, 1, 1], steelC, 1);
  } else if (id === 1) {
    b.rod([0, -0.18, -0.02], [0, 0.1, 0.08], 0.06, woodC, 0.2);
    b.rod([0, 0.1, 0.08], [-0.2, 0.4, 0.14], 0.05, woodC, 0.2);
    b.rod([0, 0.1, 0.08], [0.2, 0.4, 0.14], 0.05, woodC, 0.2);
    b.sphere(-0.2, 0.41, 0.14, 0.065, 0.065, 0.065, "#ffc93d", 0.5);
    b.sphere(0.2, 0.41, 0.14, 0.065, 0.065, 0.065, "#ffc93d", 0.5);
    b.rod([-0.2, 0.4, 0.14], [-0.03, 0.3, -0.12], 0.018, "#ff4d4d", 0.3);
    b.rod([0.2, 0.4, 0.14], [0.03, 0.3, -0.12], 0.018, "#ff4d4d", 0.3);
    b.rbox(0, 0.3, -0.13, 0.1, 0.08, 0.06, 0.02, "#8b5a2b");
  } else if (id === 2) {
    b.cyl(0, 0, 0.42, 0.11, 0.7, "#29c7ff", 0.6, [Math.PI / 2, 0, 0]);
    b.cyl(0, 0, 0.34, 0.115, 0.2, "#ffffff", 0.4, [Math.PI / 2, 0, 0]);
    b.cone(0, 0, 0.88, 0.11, 0.2, "#0b8fd6", 0.5, [Math.PI / 2, 0, 0]);
    b.sphere(0, 0, 1, 0.035, 0.035, 0.035, "#0b6fb0", 0.6);
    b.rbox(0, -0.17, 0.12, 0.1, 0.3, 0.14, 0.04, "#3a2f5b", 0.2);
    b.cyl(0, 0, 0.06, 0.1, 0.12, "#0b8fd6", 0.4, [Math.PI / 2, 0, 0]);
  } else if (id === 3) {
    b.put(
      new T.TubeGeometry(
        new T.CatmullRomCurve3([v3(0, -0.62, 0.32), v3(0, -0.3, 0.56), v3(0, 0, 0.62), v3(0, 0.3, 0.56), v3(0, 0.62, 0.32)]),
        24,
        0.035,
        8,
      ),
      [0, 0, 0],
      [0, 0, 0],
      [1, 1, 1],
      woodC,
      0.2,
    );
    b.rod([0, -0.62, 0.32], [0, 0.62, 0.32], 0.008, "#ffffff");
    b.rod([0, 0, -0.15], [0, 0, 0.95], 0.016, "#e8c07a");
    b.cone(0, 0, 1.0, 0.035, 0.12, "#dfe9f0", 1, [Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]) b.box(s * 0.04, 0, -0.08, 0.08, 0.005, 0.14, "#ff6fb5", 0.1, [0, 0, s * 0.4]);
    b.capsule(0, 0, 0.62, 0.045, 0.12, "#ff4d6d", 0.2, [0, 0, 0]);
  } else if (id === 4) {
    b.rbox(0, 0, 0.35, 0.14, 0.14, 0.9, 0.05, "#c98a4c", 0.2);
    b.rbox(0, -0.16, 0.02, 0.12, 0.3, 0.16, 0.04, "#8b5a2b", 0.2);
    for (let i = 0; i < 3; i++) b.torus(0, 0, 0.25 + i * 0.2, 0.1, 0.025, ["#ff4d6d", "#4fbfff", "#ffc93d"][i], 0.4);
    b.rod([0, 0.08, 0.78], [0, 0.12, 0.85], 0.03, "#3a2f5b");
  } else if (id === 5) {
    b.rod([0, 0, -0.1], [0, 0, 1.05], 0.03, "#f0c880", 0.2);
    b.cone(0, 0, 1.12, 0.03, 0.14, "#f0c880", 0.2, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.box(Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.08, 0.02, 0.13, 0.08, ["#ff4d6d", "#ffc93d", "#4fbfff"][i % 3], 0.3, [0, 0, a]);
    }
    b.sphere(0, 0, 0.7, 0.1, 0.08, 0.08, "#6cc24a", 0.5);
  } else if (id === 6) {
    b.rod([0, 0, -0.1], [0, 0, 0.55], 0.045, steelC, 1);
    b.rbox(0, 0, 0.64, 0.36, 0.06, 0.2, 0.03, steelC, 1);
    for (let i = -1; i <= 1; i++) {
      b.rod([i * 0.13, 0, 0.7], [i * 0.13, 0, 1.12], 0.028, steelC, 1);
      b.cone(i * 0.13, 0, 1.16, 0.028, 0.08, steelC, 1, [Math.PI / 2, 0, 0]);
    }
    b.capsule(0, 0, 0.05, 0.06, 0.18, "#4fbfff", 0.3, [Math.PI / 2, 0, 0]);
  } else if (id === 7) {
    b.rod([0, 0, -0.1], [0, 0, 0.75], 0.05, "#ffc93d", 0.4);
    b.cyl(0, 0, 0.88, 0.2, 0.5, "#ff5d5d", 0.6, [0, 0, Math.PI / 2]);
    for (const s of [-1, 1]) b.cyl(s * 0.27, 0, 0.88, 0.21, 0.06, "#ffc93d", 0.5, [0, 0, Math.PI / 2]);
  } else if (id === 8) {
    for (const s of [-1, 1]) {
      b.at([s * 0.02, 0, 0.55], [0, s * 0.14, 0], [1, 1, 1], (q) => {
        q.put(new T.CylinderGeometry(0.005, 0.07, 0.72, 4), [0, 0, 0], [Math.PI / 2, Math.PI / 4, 0], [1, 1, 0.35], steelC, 1);
      });
      b.torus(s * 0.11, 0, 0.08, 0.1, 0.035, "#ff9f1c", 0.5, [Math.PI / 2, 0, 0]);
    }
    b.sphere(0, 0.02, 0.2, 0.04, 0.04, 0.04, "#3a2f5b", 0.8);
  } else if (id === 9) {
    b.rbox(0, 0, 0.3, 0.14, 0.16, 0.9, 0.05, "#a970ff", 0.5);
    b.rbox(0, -0.18, 0, 0.12, 0.28, 0.14, 0.04, "#7b4fd0", 0.4);
    b.put(
      new T.TubeGeometry(
        new T.CatmullRomCurve3([v3(-0.52, 0, 0.58), v3(-0.25, 0, 0.74), v3(0, 0, 0.78), v3(0.25, 0, 0.74), v3(0.52, 0, 0.58)]),
        20,
        0.035,
        8,
      ),
      [0, 0, 0],
      [0, 0, 0],
      [1, 1, 1],
      "#ffc93d",
      0.5,
    );
    b.rod([-0.52, 0, 0.58], [0, 0, 0.36], 0.008, "#ffffff");
    b.rod([0.52, 0, 0.58], [0, 0, 0.36], 0.008, "#ffffff");
    b.rod([0, 0.1, 0.2], [0, 0.1, 0.95], 0.025, "#4fbfff", 0.3);
    b.cyl(0, 0.1, 1, 0.07, 0.05, "#ff4d4d", 0.5, [Math.PI / 2, 0, 0]);
  }
  if (id === 10) {
    // Water pistol: an orange body, a blue tank on top and a yellow nozzle.
    b.rbox(0, 0, 0.3, 0.16, 0.14, 0.52, 0.06, "#ff9f1c", 0.6);
    b.cyl(0, 0.17, 0.26, 0.12, 0.34, "#5fd0ff", 0.9, [Math.PI / 2, 0, 0]);
    b.sphere(0, 0.17, 0.44, 0.12, 0.12, 0.07, "#5fd0ff", 0.9);
    b.sphere(0, 0.17, 0.09, 0.12, 0.12, 0.07, "#5fd0ff", 0.9);
    b.cyl(0, 0.02, 0.66, 0.045, 0.2, "#ffd23f", 0.5, [Math.PI / 2, 0, 0]);
    b.rbox(0, -0.2, 0.12, 0.08, 0.28, 0.12, 0.04, "#3a2f5b", 0.2);
    b.sphere(0, 0.3, 0.26, 0.04, 0.04, 0.04, "#ffffff", 0.4);
  } else if (id === 11) {
    // Fly swatter: a long handle and a flat green mesh head.
    b.rod([0, 0, -0.05], [0, 0, 0.82], 0.035, "#ffcf3d", 0.4);
    b.rbox(0, 0, -0.06, 0.06, 0.06, 0.2, 0.03, "#ff4d6d", 0.3);
    b.rbox(0, 0, 1.08, 0.36, 0.02, 0.4, 0.03, "#7bd94f", 0.5);
    for (const k of [-0.2, -0.07, 0.07, 0.2]) {
      b.rbox(k, 0.02, 1.08, 0.008, 0.008, 0.4, 0.004, "#3f8f2f", 0.2);
      b.rbox(0, 0.02, 1.08 + k, 0.36, 0.008, 0.008, 0.004, "#3f8f2f", 0.2);
    }
  }
  return b;
}
const weaponGeoCache = new Map();
function weaponGeo(id) {
  let g = weaponGeoCache.get(id);
  if (!g) {
    g = keepG(buildWeapon(id).build());
    weaponGeoCache.set(id, g);
  }
  return g;
}

// ---------- loot items ----------
function buildLootItem(type, id) {
  const b = new Builder();
  if (type === "weapon") return buildWeapon(id);
  if (type === "armor") {
    b.sphere(0, 0, 0, 0.42, 0.5, 0.12, "#dfe9f5", 1);
    b.torus(0, 0, 0, 0.42, 0.04, "#9fb6cf", 0.8, [0, 0, 0]);
    b.put(starG, [0, 0, 0.12], [0, 0, 0], [0.16, 0.16, 0.16], "#4fbfff", 0.6);
  } else if (type === "consumable" && id === 0) {
    b.cyl(0, 0, 0, 0.34, 0.13, "#e7a95a", 0.1);
    for (let i = 0; i < 7; i++) {
      const a = i * 2.2,
        r = i ? 0.2 : 0;
      b.sphere(Math.sin(a) * r, 0.07, Math.cos(a) * r, 0.045, 0.03, 0.045, "#6b3e22", 0.3, [0, 0, 0], true);
    }
    b.torus(0, 0, 0, 0.34, 0.04, "#d58e3f", 0.1, [Math.PI / 2, 0, 0]);
  } else if (type === "consumable" && id === 1) {
    b.rbox(0, 0, 0, 0.8, 0.07, 0.28, 0.05, "#ffcf9e", 0.2);
    b.rbox(0, 0.02, 0, 0.3, 0.07, 0.22, 0.03, "#fff0f4", 0.3);
    for (let i = 0; i < 6; i++)
      b.sphere(-0.3 + (i % 3) * 0.05 + (i > 2 ? 0.52 : 0), 0.04, -0.06 + (i % 2) * 0.12, 0.012, 0.01, 0.012, "#e0a070", 0, [0, 0, 0], true);
  } else if (type === "consumable") {
    b.torus(0, 0, 0, 0.24, 0.11, "#eef3f8", 0.6, [Math.PI / 2, 0, 0]);
    b.torus(0, 0, 0, 0.14, 0.035, "#c98a4c", 0.1, [Math.PI / 2, 0, 0]);
    b.rbox(0.3, -0.02, 0.02, 0.14, 0.1, 0.2, 0.02, "#eef3f8", 0.5);
  } else if (type === "gadget" && id === 0) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      pts.push(v3(Math.cos(t * Math.PI * 10) * 0.18, -0.28 + t * 0.56, Math.sin(t * Math.PI * 10) * 0.18));
    }
    b.put(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 160, 0.03, 8), [0, 0, 0], [0, 0, 0], [1, 1, 1], steelC, 1);
    b.cyl(0, 0.3, 0, 0.22, 0.05, "#ff4d6d", 0.5);
    b.cyl(0, -0.3, 0, 0.22, 0.05, "#ff4d6d", 0.5);
  } else if (type === "gadget" && id === 1) {
    b.put(
      new T.TubeGeometry(
        new T.CatmullRomCurve3([v3(0, 0.35, 0), v3(0, -0.1, 0), v3(0, -0.28, 0.12), v3(0, -0.18, 0.26), v3(0, -0.05, 0.22)]),
        40,
        0.035,
        8,
      ),
      [0, 0, 0],
      [0, 0, 0],
      [1, 1, 1],
      steelC,
      1,
    );
    b.torus(0, 0.36, 0, 0.12, 0.04, "#e8c07a", 0.1);
    b.torus(-0.02, 0.1, -0.05, 0.2, 0.05, "#e8c07a", 0.1, [Math.PI / 2, 0.2, 0]);
  } else if (type === "gadget" && id === 2) {
    b.cyl(0, 0, 0, 0.12, 0.55, "#9aa5b1", 0.5);
    b.cyl(0, 0.32, 0, 0.13, 0.14, "#6c3fd1", 0.4);
    b.sphere(0, 0.55, 0, 0.16, 0.14, 0.16, "#ffffff", 0.1);
    b.sphere(0.12, 0.6, 0.05, 0.12, 0.1, 0.12, "#ffffff", 0.1);
    b.sphere(-0.1, 0.62, -0.04, 0.11, 0.09, 0.11, "#ffffff", 0.1);
  } else if (type === "gadget") {
    b.rbox(0, 0, 0, 0.62, 0.06, 0.36, 0.03, "#e3a15f", 0.2);
    b.rod([-0.25, 0.05, -0.12], [-0.25, 0.05, 0.12], 0.015, steelC, 1);
    b.rod([0.25, 0.05, -0.12], [0.25, 0.05, 0.12], 0.015, steelC, 1);
    b.rod([-0.25, 0.05, 0.12], [0.25, 0.05, 0.12], 0.015, steelC, 1);
    b.put(new T.CylinderGeometry(0.12, 0.12, 0.08, 3), [0.05, 0.07, 0], [0, 0.3, 0], [1, 1, 1], "#ffd23f", 0.3);
  } else {
    b.put(new T.ConeGeometry(0.2, 0.55, 24), [0, 0, 0], [Math.PI, 0, 0], [1, 1, 1], "#ff5d7a", 0.5);
    b.torus(0, -0.05, 0, 0.15, 0.03, "#ffd23f", 0.4, [Math.PI / 2, 0, 0]);
    b.torus(0, 0.12, 0, 0.1, 0.025, "#4fbfff", 0.4, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9;
      b.box(
        Math.sin(a) * 0.12,
        0.33 + (i % 3) * 0.06,
        Math.cos(a) * 0.12,
        0.07,
        0.012,
        0.04,
        ["#ffd23f", "#4fbfff", "#7bd94f", "#ff9ecb"][i % 4],
        0.2,
        [i, a, 0],
      );
    }
    b.rod([0, -0.27, 0], [0.05, -0.42, 0.03], 0.012, "#ffffff");
  }
  return b;
}
const lootGeoCache = new Map();
function lootGeo(type, id) {
  const k = type + ":" + id;
  let g = lootGeoCache.get(k);
  if (!g) {
    g = keepG(buildLootItem(type, id).build());
    lootGeoCache.set(k, g);
  }
  return g;
}
const lootColor = (l) =>
  l.type === "weapon"
    ? qcolors[l.q]
    : l.type === "armor"
      ? "#6fd3ff"
      : l.type === "gadget"
        ? "#c38bff"
        : l.type === "grenade"
          ? "#ff7b9c"
          : "#ffd27a";
const ringDiscG = cg("ringDisc", () => new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2));
function createLootModel(l) {
  const g = group(dynamic, l.x, 0, l.z),
    c = lootColor(l),
    item = new T.Mesh(lootGeo(l.type, l.id), lootMat);
  item.castShadow = true;
  item.receiveShadow = false;
  const holder = group(g, 0, 0.75, 0);
  holder.add(item);
  if (l.type === "weapon") {
    item.rotation.z = -0.55;
    item.position.z = -0.35;
    holder.scale.setScalar(l.q === 3 ? 1.55 : 1.3);
  } else holder.scale.setScalar(1.25);
  const ring = new T.Mesh(ringDiscG, ringMat(c));
  ring.position.y = 0.04;
  ring.scale.setScalar(l.q === 3 ? 1.25 : 0.95);
  ring.layers.set(FX);
  ring.renderOrder = 6;
  g.add(ring);
  let pillar = null;
  if (l.type === "weapon") {
    pillar = new T.Mesh(pillarG, pillarMat(c));
    pillar.scale.set(1, [1.3, 2.2, 3.4, 9][l.q], 1);
    pillar.layers.set(FX);
    pillar.renderOrder = 7;
    g.add(pillar);
  }
  const model = { group: g, holder, item, ring, pillar };
  lootModels.set(l, model);
  return model;
}

// ---------- hats (cosmetic, cached per hat id) ----------
function buildHat(id) {
  const b = new Builder();
  let spin = null;
  if (id === 1) {
    b.at([0.02, 0.4, -0.02], [-0.12, 0, -0.16], [1, 1, 1], (q) => {
      q.cone(0, 0.26, 0, 0.2, 0.52, "#ff6fb5", 0.4);
      q.torus(0, 0.13, 0, 0.16, 0.028, "#ffd23f", 0.4, [Math.PI / 2, 0, 0]);
      q.torus(0, 0.31, 0, 0.09, 0.022, "#4fbfff", 0.4, [Math.PI / 2, 0, 0]);
      q.sphere(0, 0.55, 0, 0.075, 0.075, 0.075, "#ffffff", 0.2);
    });
  } else if (id === 2) {
    b.cyl(0, 0.49, 0, 0.03, 0.12, "#3a2f5b", 0.4);
    spin = new Builder();
    spin.sphere(0, 0, 0, 0.05, 0.05, 0.05, "#ffd23f", 0.6);
    spin.rbox(0.19, 0, 0, 0.34, 0.02, 0.09, 0.01, "#ff5d5d", 0.5, [0.25, 0, 0]);
    spin.rbox(-0.19, 0, 0, 0.34, 0.02, 0.09, 0.01, "#4fbfff", 0.5, [-0.25, 0, 0]);
  } else if (id === 3 || id === 9) {
    const fur = id === 3 ? "#ff9f43" : "#c98b52",
      inner = id === 3 ? "#ff9ecb" : "#f3d2a2";
    for (const s of [-1, 1]) {
      if (id === 3) {
        b.cone(s * 0.2, 0.47, -0.02, 0.11, 0.2, fur, 0.2, [0, 0, -s * 0.38]);
        b.cone(s * 0.2, 0.46, 0.015, 0.065, 0.14, inner, 0.2, [0, 0, -s * 0.38]);
      } else {
        b.sphere(s * 0.26, 0.4, -0.02, 0.11, 0.11, 0.06, fur, 0.2, [0, 0, -s * 0.5]);
        b.sphere(s * 0.26, 0.4, 0.02, 0.06, 0.06, 0.03, inner, 0.2, [0, 0, -s * 0.5]);
      }
    }
  } else if (id === 4) {
    b.at([0.25, 0.36, 0.12], [0.35, 0.2, -0.95], [1, 1, 1], (q) => {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        q.sphere(Math.sin(a) * 0.085, 0, Math.cos(a) * 0.085, 0.034, 0.012, 0.062, "#ffffff", 0.1, [0, a, 0]);
      }
      q.sphere(0, 0.012, 0, 0.045, 0.025, 0.045, "#ffc93d", 0.3);
    });
  } else if (id === 5) {
    b.at([0, 0.46, -0.02], [-0.08, 0, 0.1], [1, 1, 1], (q) => {
      q.cyl(0, 0, 0, 0.33, 0.03, "#2b2744", 0.5);
      q.cyl(0, 0.19, 0, 0.19, 0.36, "#2b2744", 0.5);
      q.cyl(0, 0.06, 0, 0.197, 0.06, "#ff5d7a", 0.4);
    });
  } else if (id === 6) {
    for (const s of [-1, 1]) {
      b.capsule(s * 0.12, 0.7, -0.05, 0.065, 0.34, "#ffffff", 0.1, [-0.15, 0, -s * 0.22]);
      b.capsule(s * 0.12 + s * 0.002, 0.7, -0.01, 0.036, 0.27, "#ffb3c6", 0.1, [-0.15, 0, -s * 0.22]);
    }
  } else if (id === 7) {
    b.cyl(0, 0.49, 0, 0.23, 0.14, "#ffffff", 0.2);
    b.sphere(0, 0.68, 0, 0.21, 0.16, 0.21, "#ffffff", 0.2);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      b.sphere(Math.sin(a) * 0.15, 0.62, Math.cos(a) * 0.15, 0.12, 0.11, 0.12, "#ffffff", 0.2);
    }
  } else if (id === 8) {
    b.at([0, 0.43, -0.02], [-0.1, 0, 0.06], [1, 1, 1], (q) => {
      q.cyl(0, 0, 0, 0.52, 0.03, "#f2d08a", 0.2);
      q.cyl(0, 0.1, 0, 0.25, 0.2, "#f2d08a", 0.2);
      q.cyl(0, 0.05, 0, 0.255, 0.06, "#ff5d7a", 0.3);
      q.sphere(0.2, 0.07, 0.16, 0.06, 0.06, 0.04, "#ffd23f", 0.3);
    });
  } else if (id === 10) {
    b.cyl(0, 0.5, 0, 0.23, 0.12, "#ffd23f", 1);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.cone(Math.sin(a) * 0.2, 0.62, Math.cos(a) * 0.2, 0.055, 0.14, "#ffd23f", 1);
      b.sphere(Math.sin(a) * 0.2, 0.7, Math.cos(a) * 0.2, 0.025, 0.025, 0.025, "#ffffff", 0.6);
    }
    b.sphere(0, 0.5, 0.23, 0.045, 0.045, 0.02, "#ff4d6d", 1);
    b.sphere(0.16, 0.5, 0.165, 0.035, 0.035, 0.02, "#4fbfff", 1, [0, 0.8, 0]);
    b.sphere(-0.16, 0.5, 0.165, 0.035, 0.035, 0.02, "#6fd36d", 1, [0, -0.8, 0]);
  } else if (id === 11) {
    // Shower cap: a puffy dome with dots and a frilled elastic.
    b.put(G.hemi, [0, 0.1, -0.01], [0, 0, 0], [0.45, 0.46, 0.44], "#8fd6ff", 0.35);
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      b.sphere(Math.sin(a) * 0.44, 0.1, Math.cos(a) * 0.43 - 0.01, 0.07, 0.06, 0.07, "#ffffff", 0.2);
    }
    for (const [a, e] of [
      [0.3, 0.5],
      [1.6, 0.35],
      [2.9, 0.6],
      [4.2, 0.4],
      [5.4, 0.62],
      [0.9, 1.05],
      [3.6, 1.1],
      [2.2, 0.95],
      [5, 1.2],
    ]) {
      const c = Math.cos(e);
      b.sphere(Math.sin(a) * 0.45 * c, 0.1 + Math.sin(e) * 0.46, Math.cos(a) * 0.44 * c - 0.01, 0.05, 0.05, 0.05, "#ffffff", 0.2);
    }
  }
  return { main: b.parts.length ? keepG(b.build()) : null, spin: spin ? keepG(spin.build()) : null, spinY: 0.57 };
}
const hatCache = new Map();
function hatGeo(id) {
  if (!hatCache.has(id)) hatCache.set(id, buildHat(id));
  return hatCache.get(id);
}
// ---------- characters ----------
const skinTones = ["#ffd6ae", "#f6c08f", "#e8a878", "#ffe2c6", "#c98b62"];
const canopyMat = keepM(toonMat("#ffffff", { vc: true, side: T.DoubleSide, rim: 0.3 }));
const shadowMat = keepM(
  new T.MeshBasicMaterial({
    map: tex.blob,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }),
);
const starMat = glow("#ffe066", 2.6);
function canopyGeo(main) {
  const g = new T.SphereGeometry(1.5, 32, 8, 0, Math.PI * 2, 0, Math.PI * 0.47).toNonIndexed(),
    p = g.attributes.position,
    c = new Float32Array(p.count * 3),
    A = new T.Color(main),
    B = new T.Color("#ffffff");
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
      cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3,
      sec = Math.floor(((Math.atan2(cx, cz) + Math.PI) / (Math.PI * 2)) * 8) % 2;
    (sec ? A : B).toArray(c, i * 3);
    (sec ? A : B).toArray(c, i * 3 + 3);
    (sec ? A : B).toArray(c, i * 3 + 6);
  }
  g.setAttribute("color", new T.BufferAttribute(c, 3));
  return g;
}
// Generated, painted heroes. Originals remain in hero-preview; game copies share GPU assets.
const animeTemplates = new Map();
if (window.MiniHeroData) {
  window.MiniHeroes = { catalog: window.MiniHeroData, loaded: 0, ready: null };
  // While the heroes load: their portraits fill in one by one, and a game tip changes every few seconds.
  const tips = typeof txt === "function" ? txt("load.tips") : [];
  let tipN = Math.floor(Math.random() * Math.max(1, tips.length));
  const showTip = () => {
    if ($("heroLoadingTip") && tips.length) $("heroLoadingTip").textContent = "💡 " + tips[tipN++ % tips.length];
  };
  showTip();
  const tipTimer = setInterval(showTip, 3200);
  window.MiniHeroes.ready = (async () => {
    const loader = new GX.GLTFLoader();
    const thumbnail = new T.WebGLRenderer({ antialias: true, alpha: true });
    thumbnail.setSize(160, 180); thumbnail.setPixelRatio(1); thumbnail.outputColorSpace = T.SRGBColorSpace;
    thumbnail.toneMapping = T.NeutralToneMapping;
    const thumbScene = new T.Scene(), thumbCamera = new T.PerspectiveCamera(32, 160 / 180, 0.1, 20);
    thumbCamera.position.set(0, 1.05, 4.2); thumbCamera.lookAt(0, 0.95, 0);
    thumbScene.add(new T.HemisphereLight(0xffffff, 0x606080, 2));
    const thumbKey = new T.DirectionalLight(0xfff5e5, 2.4); thumbKey.position.set(-3, 4, 5); thumbScene.add(thumbKey);
    // Heroes come built into the page (base64: the desktop and one-file versions) or as separate .glb files
    // (the web version: all ten download at once, and its service worker keeps them for offline play).
    const files = window.MiniHeroData.map(entry => entry.base64 ? null : fetch(entry.url).then(r => {
      if (!r.ok) throw new Error("Hero file " + entry.url + ": " + r.status);
      return r.arrayBuffer();
    }));
    files.forEach(f => f?.catch(() => {}));
    for (const [index, entry] of window.MiniHeroData.entries()) {
      const buffer = entry.base64 ? Uint8Array.from(atob(entry.base64), c => c.charCodeAt(0)).buffer : await files[index];
      const gltf = await loader.parseAsync(buffer, "");
      gltf.scene.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(gltf.scene), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
      // The hammer sits above hero 04's head, so use a taller overall silhouette.
      const scale = (entry.id === 3 ? 2.12 : 1.8) / size.y;
      const normalize = new T.Matrix4().makeScale(scale, scale, scale);
      normalize.setPosition(-center.x * scale, -box.min.y * scale, -center.z * scale);
      const parts = [];
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        const geometry = o.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(normalize, o.matrixWorld));
        window.HeroAnimation.prepareGeometry(T, geometry, entry.id);
        geometry.computeBoundingSphere();
        keepG(geometry);
        const source = (Array.isArray(o.material) ? o.material[0] : o.material).clone();
        source.roughness = 0.85;
        source.metalness = 0;
        source.envMapIntensity = 0.45;
        for (const value of Object.values(source)) if (value && value.isTexture) {
          value.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          keepT(value);
        }
        keepM(source);
        parts.push({ geometry, material: source });
        o.geometry.dispose();
      });
      if (!parts.length) throw new Error("Empty hero model " + entry.id);
      animeTemplates.set(entry.id, parts);
      const thumbModel = new T.Group();
      for (const part of parts) thumbModel.add(new T.Mesh(part.geometry, part.material));
      thumbScene.add(thumbModel); thumbnail.render(thumbScene, thumbCamera);
      entry.portrait = thumbnail.domElement.toDataURL("image/webp", 0.85);
      thumbScene.remove(thumbModel);
      window.MiniHeroes.loaded = animeTemplates.size;
      document.documentElement.dataset.heroesLoaded = String(animeTemplates.size);
      const status = $("heroLoadingText"),
        n = animeTemplates.size,
        slot = $("heroLoadingRow")?.children[n - 1];
      if (status) status.textContent = typeof txt === "function" ? txt("load.heroes", n) : "Загрузка героев · " + n + " / 10";
      if (slot) {
        slot.style.backgroundImage = "url(" + entry.portrait + ")";
        slot.className = "in";
      }
      if ($("heroLoadingBar")) $("heroLoadingBar").style.width = n * 10 + "%";
      // Base64 is no longer needed after GLTF parsing.
      delete entry.base64;
    }
    thumbnail.dispose();
    clearInterval(tipTimer);
    return window.MiniHeroes;
  })();
}
function createAnimeActorModel(a) {
  const heroId = Number.isInteger(a.hero) && a.hero >= 0 && a.hero < 10 ? a.hero : a.id % 10;
  const parts = animeTemplates.get(heroId);
  if (!parts) throw new Error("Hero " + heroId + " is not loaded");
  const root = group(dynamic), pivot = group(root, 0, 0.85, 0), visual = group(pivot, 0, -0.85, 0);
  const materials = [], rigs = [];
  for (const part of parts) {
    const mat = part.material.clone();
    materials.push(mat);
    const mesh = new T.SkinnedMesh(part.geometry, mat);
    const rig = window.HeroAnimation.createRig(T, mesh, heroId);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    visual.add(mesh);
    rigs.push(rig);
  }
  const head = group(pivot, 0, 0.6, 0), eyes = group(head);
  // Compatibility anchors keep the established movement, hit, heal and stun effects.
  const limbs = [-1, 1].map(s => ({ leg: group(pivot, s * 0.18, -0.37, 0), arm: group(pivot) }));
  const hand = group(pivot), weapon = new T.Object3D(), vest = new T.Object3D();
  hand.add(weapon); pivot.add(vest);
  const chute = group(root, 0, 2.6, 0), canopy = new T.Mesh(canopyGeo(a.color), canopyMat);
  canopy.scale.y = 0.45; canopy.castShadow = true; chute.add(canopy);
  const cords = new Builder();
  for (let i = 0; i < 6; i++) {
    const ang = i / 6 * Math.PI * 2;
    cords.rod([Math.sin(ang) * 1.36, 0, Math.cos(ang) * 1.36], [Math.sin(ang) * 0.22, -1.52, -0.3 + Math.cos(ang) * 0.1], 0.012, "#f4efe6");
  }
  cords.mesh(canopyMat, chute, { cast: false });
  const stars = group(head, 0, 0.62, 0);
  for (let i = 0; i < 3; i++) {
    const star = new T.Mesh(starG, starMat);
    star.scale.setScalar(0.075); star.layers.set(FX); stars.add(star);
  }
  stars.visible = false;
  const shadow = new T.Mesh(G.circle, shadowMat);
  shadow.rotation.x = -Math.PI / 2; shadow.scale.setScalar(0.7); shadow.layers.set(FX); shadow.renderOrder = 2; dynamic.add(shadow);
  root.traverse(o => { if (o.isMesh) o.userData.actorId = a.id; });
  for (const effect of [chute, stars]) effect.traverse(o => { o.userData.noAim = true; });
  root.userData.heroId = heroId;
  const model = { root, pivot, head, eyes, limbs, hand, weapon, vest, chute, canopy, stars, shadow, mat: materials[0], wmat: materials[0], materials, rigs,
    anime: true, heroId, weaponId: a.slots[a.slot].id, spin: null, hp: a.hp, flash: 0, squash: 0, air: !a.landed, blinkT: 3, blink: 0, dust: 0, heal: 0, alive: true };
  actorModels.set(a.id, model);
  return model;
}

function createActorModel(a) {
  if (window.MiniHeroes) return createAnimeActorModel(a);
  const main = new T.Color(a.color),
    shirt = "#" + main.clone().lerp(new T.Color("#ffffff"), 0.2).getHexString(),
    dark = "#" + main.clone().multiplyScalar(0.6).getHexString(),
    mainH = "#" + main.getHexString(),
    skin = skinTones[a.id % skinTones.length];
  const mat = toonMat("#ffffff", { vc: true, rim: 0.8 });
  const root = group(dynamic),
    pivot = group(root, 0, 0.85, 0);
  const body = new Builder();
  body.at([0, -0.85, 0], [0, 0, 0], [1, 1, 1], (b) => {
    b.sphere(0, 0.75, 0, 0.3, 0.33, 0.26, shirt, 0.15);
    b.torus(0, 0.5, 0, 0.265, 0.05, "#3d4470", 0.3, [Math.PI / 2, 0, 0]);
    b.rbox(0, 0.5, 0.25, 0.12, 0.09, 0.05, 0.02, "#ffd166", 0.8);
    b.put(starG, [0, 0.8, 0.255], [0, 0, 0], [0.075, 0.075, 0.075], "#ffffff", 0.3);
    b.rbox(0, 0.8, -0.3, 0.4, 0.44, 0.2, 0.08, "#f4e3c1", 0.1);
    b.rbox(0, 0.93, -0.34, 0.43, 0.2, 0.17, 0.07, mainH, 0.35);
    b.rod([0.13, 1.0, -0.36], [0.22, 1.45, -0.42], 0.02, steelC, 1);
    b.sphere(0.22, 1.47, -0.42, 0.05, 0.05, 0.05, mainH, 0.5);
  });
  body.mesh(mat, pivot);
  const head = group(pivot, 0, 0.51, 0),
    hb = new Builder();
  hb.sphere(0, 0, 0, 0.37, 0.35, 0.34, skin, 0.1);
  hb.sphere(-0.365, -0.03, 0, 0.07, 0.09, 0.06, skin);
  hb.sphere(0.365, -0.03, 0, 0.07, 0.09, 0.06, skin);
  hb.sphere(0, -0.04, 0.335, 0.055, 0.045, 0.04, skin, 0.25);
  hb.sphere(-0.21, -0.08, 0.26, 0.075, 0.045, 0.02, "#ff9aa2", 0, [0, -0.62, 0]);
  hb.sphere(0.21, -0.08, 0.26, 0.075, 0.045, 0.02, "#ff9aa2", 0, [0, 0.62, 0]);
  hb.put(torusG(0.075, 0.02, Math.PI * 0.8), [0, -0.115, 0.318], [0, 0, Math.PI * 1.1], [1, 1, 1], "#7a2c3c");
  hb.capsule(-0.125, 0.155, 0.305, 0.02, 0.075, "#3a2a28", 0, [0, 0, Math.PI / 2 - (a.id ? 0.2 : -0.1)]);
  hb.capsule(0.125, 0.155, 0.305, 0.02, 0.075, "#3a2a28", 0, [0, 0, Math.PI / 2 + (a.id ? 0.2 : -0.1)]);
  hb.put(G.hemi, [0, 0.07, 0], [0, 0, 0], [0.395, 0.37, 0.385], mainH, 0.75);
  hb.torus(0, 0.07, 0, 0.388, 0.036, "#ffffff", 0.5, [Math.PI / 2, 0, 0]);
  hb.sphere(0, 0.08, 0.31, 0.3, 0.04, 0.16, dark, 0.5, [0.12, 0, 0]);
  hb.sphere(0, 0.44, 0, 0.075, 0.065, 0.075, "#ffffff", 0.6);
  hb.mesh(mat, head);
  const eb = new Builder();
  for (const s of [-1, 1]) {
    eb.sphere(s * 0.125, 0.03, 0.29, 0.082, 0.1, 0.05, "#ffffff", 0.9);
    eb.sphere(s * 0.12, 0.015, 0.328, 0.05, 0.064, 0.03, "#2b2744", 1);
    eb.sphere(s * 0.105 + 0.012, 0.05, 0.352, 0.019, 0.019, 0.01, "#ffffff", 0.2);
  }
  const eyes = eb.mesh(mat, head, { cast: false });
  const limbs = [];
  for (const s of [-1, 1]) {
    const leg = group(pivot, s * 0.13, -0.35, 0),
      lb = new Builder();
    lb.capsule(0, -0.17, 0, 0.1, 0.18, "#3d4470", 0.1);
    lb.rbox(0, -0.39, 0.05, 0.22, 0.16, 0.35, 0.07, "#ffffff", 0.3);
    lb.rbox(0, -0.46, 0.05, 0.23, 0.04, 0.36, 0.02, dark, 0.2);
    lb.mesh(mat, leg);
    const arm = group(pivot, s * 0.32, 0.1, 0),
      ab = new Builder();
    ab.capsule(0, -0.14, 0, 0.075, 0.16, shirt, 0.1);
    ab.sphere(0, -0.31, 0, 0.1, 0.1, 0.1, "#ffffff", 0.35);
    ab.mesh(mat, arm);
    limbs.push({ leg, arm });
  }
  let spin = null;
  if (a.hat) {
    const hg = hatGeo(a.hat);
    if (hg.main) {
      const hm = new T.Mesh(hg.main, mat);
      hm.castShadow = true;
      head.add(hm);
    }
    if (hg.spin) {
      spin = new T.Mesh(hg.spin, mat);
      spin.position.y = hg.spinY;
      head.add(spin);
    }
  }
  // Weapon paint: vertex colours tinted by a per-model material, so fading and hit flashes still work.
  const paint = (typeof PAINTS !== "undefined" && PAINTS[a.paint]) || null,
    wmat = paint && paint.color ? toonMat(paint.color, { vc: true, rim: 0.8, emissive: paint.glow }) : mat;
  const hand = group(limbs[1].arm, 0, -0.31, 0.03),
    weapon = new T.Mesh(weaponGeo(a.slots[a.slot].id), wmat);
  weapon.castShadow = true;
  hand.add(weapon);
  const vb = new Builder();
  vb.at([0, -0.85, 0], [0, 0, 0], [1, 1, 1], (b) => {
    b.sphere(0, 0.77, 0.015, 0.318, 0.3, 0.285, "#d9e6f2", 1);
    b.put(starG, [0, 0.8, 0.3], [0, 0, 0], [0.07, 0.07, 0.07], "#4fbfff", 0.6);
    b.sphere(-0.29, 0.95, 0, 0.12, 0.07, 0.12, "#d9e6f2", 1);
    b.sphere(0.29, 0.95, 0, 0.12, 0.07, 0.12, "#d9e6f2", 1);
  });
  const vest = vb.mesh(mat, pivot);
  vest.visible = false;
  const chute = group(root, 0, 2.6, 0),
    canopy = new T.Mesh(canopyGeo(mainH), canopyMat);
  canopy.scale.y = 0.45;
  canopy.castShadow = true;
  chute.add(canopy);
  const sb = new Builder();
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    sb.rod([Math.sin(ang) * 1.36, 0, Math.cos(ang) * 1.36], [Math.sin(ang) * 0.22, -1.52, -0.3 + Math.cos(ang) * 0.1], 0.012, "#f4efe6");
  }
  sb.mesh(canopyMat, chute, { cast: false });
  const stars = group(head, 0, 0.62, 0);
  for (let i = 0; i < 3; i++) {
    const s = new T.Mesh(starG, starMat);
    s.scale.setScalar(0.075);
    s.layers.set(FX);
    s.castShadow = false;
    stars.add(s);
  }
  stars.visible = false;
  const shadow = new T.Mesh(G.circle, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.setScalar(0.7);
  shadow.layers.set(FX);
  shadow.renderOrder = 2;
  dynamic.add(shadow);
  root.traverse((o) => {
    if (o.isMesh) o.userData.actorId = a.id;
  });
  for (const o of [chute, stars, hand])
    o.traverse((c) => {
      c.userData.noAim = true;
    });
  const model = {
    root,
    pivot,
    head,
    eyes,
    limbs,
    hand,
    weapon,
    weaponId: a.slots[a.slot].id,
    chute,
    canopy,
    vest,
    stars,
    shadow,
    mat,
    wmat,
    spin,
    hp: a.hp,
    flash: 0,
    squash: 0,
    air: !a.landed,
    blinkT: 1 + Math.random() * 3,
    blink: 0,
    dust: 0,
    heal: 0,
    alive: true,
  };
  actorModels.set(a.id, model);
  return model;
}
function supportHeight(x, z, y) {
  let h = 0;
  for (const o of obstacles) {
    if (o.h <= y + 0.05 && Math.hypot(x - o.x, z - o.z) < o.r - 0.12) h = Math.max(h, o.h);
  }
  return h;
}
const _axis = new T.Vector3();
function animateActor(a, m, dt, isPlayer) {
  const w = weapons[a.slots[a.slot].id],
    ranged = !!w.cap,
    grounded = a.landed && a.vy === 0,
    run = a.moving && grounded,
    t = worldClock + a.id * 1.7;
  m.root.position.set(a.x, a.y, a.z);
  m.root.rotation.y = a.angle;
  if (m.air && grounded) m.squash = 1;
  m.air = !grounded;
  m.squash = Math.max(0, m.squash - dt * 4.5);
  const lost = m.hp - a.hp;
  if (lost > 2.5) m.flash = Math.max(m.flash, Math.min(1, 0.45 + lost / 25));
  m.hp = a.hp;
  m.flash = Math.max(0, m.flash - dt * 6);
  m.mat.emissive.setRGB(m.flash * 0.95, m.flash * 0.8, m.flash * 0.8);
  if (m.spin) m.spin.rotation.y += dt * (run || !a.landed ? 22 : 7);
  const bob = run ? Math.abs(Math.sin(a.step)) * 0.08 : Math.sin(t * 2.4) * 0.012,
    s = m.squash * m.squash;
  m.pivot.position.y = 0.85 + bob - s * 0.18;
  m.pivot.scale.set(1 + s * 0.22, 1 - s * 0.26 + (!grounded && a.vy > 3 ? 0.06 : 0), 1 + s * 0.22);
  const rolling = a.inv > 0 && a.roll > 2.5;
  if (rolling) {
    const d = a.rollDir || { x: Math.sin(a.angle), z: Math.cos(a.angle) },
      ca = Math.cos(a.angle),
      sa = Math.sin(a.angle),
      lx = d.x * ca - d.z * sa,
      lz = d.x * sa + d.z * ca;
    _axis.set(lz, 0, -lx).normalize();
    m.pivot.quaternion.setFromAxisAngle(_axis, (1 - a.inv / 0.32) * Math.PI * 2);
  } else m.pivot.rotation.set(run ? 0.12 : 0, 0, run ? Math.sin(a.step) * 0.05 : Math.sin(t * 1.3) * 0.015);
  const [L, R] = m.limbs;
  L.leg.rotation.x = run ? Math.sin(a.step) * 0.75 : !grounded ? -0.35 : 0;
  R.leg.rotation.x = run ? -Math.sin(a.step) * 0.75 : !grounded ? 0.25 : 0;
  let la = run ? -Math.sin(a.step) * 0.7 : Math.sin(t * 1.8) * 0.06,
    lz = 0,
    ra;
  if (!a.landed) {
    la = -2.75;
    ra = -2.75;
    lz = -0.25;
  } else if (a.use > 0) {
    la = -2.25;
    lz = -0.55;
  }
  if (ra === undefined) {
    if (ranged) {
      ra = -1.3 + Math.max(0, a.animation) * 1.6;
      if (a.use <= 0) {
        la = -1.05;
        lz = -0.62;
      }
    } else if (a.animation > 0) {
      const p = 1 - a.animation / 0.22;
      ra = -2.8 + p * 2.9;
    } else ra = -0.55 + Math.sin(t * 1.8) * 0.05;
  }
  L.arm.rotation.set(la, 0, lz);
  R.arm.rotation.set(ra, 0, a.landed ? 0.08 : 0.25);
  m.hand.rotation.set(ranged || !a.landed ? -ra : -ra * 0.35 - 0.4, 0, 0);
  m.hand.visible = a.landed;
  m.head.rotation.x = isPlayer ? clamp(cameraPitch * 0.45, -0.15, 0.35) : 0;
  m.head.rotation.y = !a.landed ? Math.sin(t) * 0.2 : 0;
  m.blinkT -= dt;
  if (m.blinkT < 0) {
    m.blinkT = 2.2 + Math.random() * 3.5;
    m.blink = 0.12;
  }
  m.blink -= dt;
  m.eyes.scale.y = m.blink > 0 ? 0.12 : 1;
  m.chute.visible = !a.landed;
  if (!a.landed) {
    m.chute.rotation.z = Math.sin(t * 1.4) * 0.1;
    m.chute.rotation.x = Math.cos(t * 1.1) * 0.08;
  }
  m.vest.visible = a.armor > 0;
  m.stars.visible = a.stun > 0;
  if (a.stun > 0) {
    m.stars.rotation.y = worldClock * 6;
    m.stars.children.forEach((s, i) => {
      const ang = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(ang) * 0.38, Math.sin(worldClock * 8 + i) * 0.04, Math.sin(ang) * 0.38);
      s.rotation.set(worldClock * 3, worldClock * 4 + i, 0);
    });
  }
  const id = a.slots[a.slot].id;
  if (!m.anime && m.weaponId !== id) {
    m.weapon.geometry = weaponGeo(id);
    m.weaponId = id;
  }
  const h = supportHeight(a.x, a.z, a.y),
    lift = Math.min(1, Math.max(0, (a.y - h) / 7));
  m.shadow.position.set(a.x, h + 0.035, a.z);
  m.shadow.scale.setScalar(0.72 * (1 - lift * 0.55));
  if (run) {
    m.dust -= dt;
    if (m.dust <= 0) {
      m.dust = 0.22;
      fxSpawn({
        kind: "puff",
        x: a.x - Math.sin(a.angle) * 0.2,
        y: a.y + 0.12,
        z: a.z - Math.cos(a.angle) * 0.2,
        vx: 0,
        vy: 0.6,
        vz: 0,
        life: 0.45,
        max: 0.45,
        size: 0.16,
        color: arenaKind === "garden" ? "#e7f5d0" : arenaKind === "bathroom" ? "#eaf8fd" : "#fff1dc",
      });
    }
  }
  // Cosmetic trail behind a moving hero (the shop shows it on the menu hero for a few seconds).
  const trail = a.trail && typeof TRAILS !== "undefined" ? TRAILS[a.trail] : null;
  if (trail && trail.kind && !a.down && ((a.moving || !grounded) || (a.trailShow && worldClock < a.trailShow))) {
    m.trailT = (m.trailT || 0) - dt;
    if (m.trailT <= 0) {
      m.trailT = trail.kind === "bubble" ? 0.09 : 0.05;
      spawnTrail(trail, a.x - Math.sin(a.angle) * 0.35 + (prand() - 0.5) * 0.3, a.y + 0.25 + prand() * 0.6, a.z - Math.cos(a.angle) * 0.35 + (prand() - 0.5) * 0.3);
    }
  }
  // Duos: a downed hero lies on its belly and crawls, weapon put away.
  if (a.down) {
    const c = a.moving ? Math.sin(a.step * 1.6) : Math.sin(t * 2) * 0.15;
    m.pivot.rotation.set(1.3, 0, c * 0.1);
    m.pivot.position.y = 0.3;
    m.pivot.scale.set(1, 1, 1);
    L.leg.rotation.x = 0.3 + c * 0.45;
    R.leg.rotation.x = 0.3 - c * 0.45;
    L.arm.rotation.set(-2.7 + c * 0.55, 0, -0.35);
    R.arm.rotation.set(-2.7 - c * 0.55, 0, 0.35);
    m.hand.visible = false;
    m.head.rotation.set(-0.75, 0, 0);
  }
  if (m.anime) {
    // How fast the hero turns (for leaning into turns) and the emote being played, if any.
    const turnNow = dt > 0 ? (((a.angle - (m.lastAngle ?? a.angle) + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / dt : 0;
    m.lastAngle = a.angle;
    m.turn = (m.turn || 0) + (clamp(turnNow, -8, 8) - (m.turn || 0)) * (1 - Math.exp(-dt * 10));
    const emo = a.emote && typeof EMOTES !== "undefined" ? EMOTES[a.emote.k] : null,
      emoT = emo ? worldClock - a.emote.at : 0;
    if (emo && emoT > emo.len && !a.emote.loop) a.emote = null;
    const state = { time: t, step: a.step, run, grounded, landed: a.landed, vy: a.vy,
      attack: a.animation, ranged, down: a.down, use: a.use, roll: rolling,
      aimPitch: isPlayer ? cameraPitch : 0, flash: m.flash, squash: s, turn: m.turn,
      emote: emo && a.emote ? { k: emo.anim, t: emoT, len: a.emote.loop ? 1e9 : emo.len } : null };
    for (const rig of m.rigs) window.HeroAnimation.updateRig(rig, state, dt);
    if (isPlayer && qaMode) {
      canvas.dataset.heroAnimation = m.rigs[0]?.state || "idle";
      canvas.dataset.heroStride = m.rigs[0]?.bones[3].rotation.x.toFixed(3) || "0";
    }
    for (const material of m.materials) material.emissive.copy(m.mat.emissive);
    // Keep the planted stride readable without scaling the painted face and accessories.
    if (!rolling && !a.down) {
      m.pivot.scale.set(1 + s * .06, 1 - s * .1, 1 + s * .06);
      m.pivot.position.y = .85 + (run ? Math.abs(Math.sin(a.step)) * .065 : Math.sin(t * 2.4) * .008) - s * .08;
    }
  }
  if (a.use > 0) {
    m.heal -= dt;
    if (m.heal <= 0) {
      m.heal = 0.14;
      const ang = Math.random() * 6.28;
      fxSpawn({
        kind: "plus",
        x: a.x + Math.cos(ang) * 0.45,
        y: a.y + 0.6,
        z: a.z + Math.sin(ang) * 0.45,
        vx: 0,
        vy: 1.4,
        vz: 0,
        life: 0.8,
        max: 0.8,
        size: 0.11,
        color: a.useType === 2 ? "#6fd3ff" : "#6dff8a",
      });
    }
  }
}
function spawnTrail(trail, x, y, z) {
  const k = trail.kind;
  if (k === "star" || k === "rainbow") {
    const color = k === "rainbow" ? "#" + new T.Color().setHSL((worldClock * 0.6) % 1, 0.85, 0.62).getHexString() : trail.color;
    fxSpawn({ kind: "star", x, y, z, vx: (prand() - 0.5) * 0.6, vy: pr(0.2, 0.8), vz: (prand() - 0.5) * 0.6, life: 0.55, max: 0.55, size: pr(0.09, 0.16), color, drag: 2 });
  } else if (k === "puff")
    fxSpawn({ kind: "puff", x, y: y - 0.15, z, vx: 0, vy: 0.35, vz: 0, life: 0.6, max: 0.6, size: pr(0.16, 0.26), color: trail.colors[Math.floor(prand() * trail.colors.length)], drag: 2 });
  else if (k === "flame") {
    fxSpawn({ kind: "puff", x, y: y - 0.2, z, vx: 0, vy: 1.1, vz: 0, life: 0.4, max: 0.4, size: pr(0.12, 0.2), color: prand() < 0.5 ? "#ff8a3d" : "#ffc23d", drag: 1.5 });
    if (prand() < 0.4) fxSpawn({ kind: "star", x, y, z, vx: 0, vy: 1.4, vz: 0, life: 0.35, max: 0.35, size: 0.08, color: "#fff1a8", drag: 1 });
  } else if (k === "bubble") particles.push({ x, z, y, vx: (prand() - 0.5) * 0.4, vy: 0.6, vz: (prand() - 0.5) * 0.4, life: 0.9, max: 0.9, size: pr(0.08, 0.15), kind: "bubble" });
  else if (k === "confetti" && particles.length < 500) particles.push({ x, z, y, vx: (prand() - 0.5) * 1.6, vy: pr(0.6, 1.6), vz: (prand() - 0.5) * 1.6, life: 0.7, max: 0.7, color: "#ffd23f", size: 0.1 });
}
function updateModels(dt) {
  for (const a of actors) {
    const m = actorModels.get(a.id) || createActorModel(a);
    if (!a.alive) {
      // Knocked out: the hero is flung up with a spin for a moment, then pops in a puff.
      if (m.alive) {
        m.alive = false;
        m.dying = 0.32;
        m.dieSpin = a.id % 2 ? -1 : 1;
      }
      if (m.dying > 0) {
        m.dying -= dt;
        const p = Math.min(1, 1 - m.dying / 0.32);
        m.root.position.set(a.x, a.y + Math.sin(p * Math.PI) * 0.9, a.z);
        m.pivot.rotation.set(-p * 1.1, 0, m.dieSpin * p * 2.4);
        m.pivot.scale.setScalar(1 - p * 0.4);
        if (m.dying <= 0) spawnPoof(a.x, a.y, a.z, a.color);
        else continue;
      }
      m.root.visible = false;
      m.shadow.visible = false;
      continue;
    }
    if (!m.alive) {
      // Back in the match (king of the hill): undo the knock-out spin.
      m.dying = 0;
      m.pivot.rotation.set(0, 0, 0);
      m.pivot.scale.setScalar(1);
    }
    m.alive = true;
    m.root.visible = true;
    m.shadow.visible = true;
    animateActor(a, m, dt, a === player);
  }
  if (player && actorModels.has(player.id)) {
    const m = actorModels.get(player.id),
      d = camera.position.distanceTo(_v.set(player.x, player.y + 1.1, player.z)),
      op = Math.max(0.22, Math.min(1, (d - 1) / 1.3)),
      fade = op < 0.99;
    if (fade !== !!m.faded) {
      m.faded = fade;
      for (const mm of new Set(m.materials || [m.mat, m.wmat])) {
        mm.transparent = fade;
        mm.depthWrite = !fade;
        mm.needsUpdate = true;
      }
    }
    for (const mm of new Set(m.materials || [m.mat, m.wmat])) mm.opacity = fade ? op : 1;
  }
  const wanted = new Set(loot);
  for (const [l, m] of lootModels)
    if (!wanted.has(l)) {
      if (mode === "play") sparkle(l.x, 0.8, l.z, lootColor(l), 14);
      dynamic.remove(m.group);
      lootModels.delete(l);
    }
  for (const l of loot) {
    const m = lootModels.get(l) || createLootModel(l);
    m.group.position.set(l.x, 0, l.z);
    m.holder.position.y = 0.78 + Math.sin(worldClock * 2.3 + l.spin) * 0.12;
    m.holder.rotation.y = worldClock * 1.2 + l.spin;
    const pulse = 1 + Math.sin(worldClock * 3 + l.spin) * 0.06;
    m.ring.scale.setScalar((l.q === 3 ? 1.3 : 0.95) * pulse);
    if (m.pillar) m.pillar.rotation.y = worldClock * 0.5;
  }
}
// ---------- effects ----------
function instanced(geo, mat, max, layer = 0) {
  const m = new T.InstancedMesh(geo, mat, max);
  m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  if (layer) m.layers.set(layer);
  scene.add(m);
  return m;
}
const MAXC = 700,
  MAXP = 520,
  MAXS = 560,
  MAXPL = 90;
const confettiIM = instanced(
  cg("confG", () => new T.PlaneGeometry(1, 0.62)),
  keepM(toonMat("#ffffff", { side: T.DoubleSide, rim: 0 })),
  MAXC,
  FX,
);
const puffIM = instanced(G.sphereLo, keepM(toonMat("#ffffff", { rim: 0.45 })), MAXP, 0);
puffIM.castShadow = true;
const sparkIM = instanced(G.octa, keepM(new T.MeshBasicMaterial({ color: "#ffffff" })), MAXS, FX);
const plusIM = instanced(
  cg("plusG", () => new Builder().box(0, 0, 0, 1, 0.32, 0.32).box(0, 0, 0, 0.32, 1, 0.32).build()),
  keepM(new T.MeshBasicMaterial({ color: "#ffffff" })),
  MAXPL,
  FX,
);
// Soap bubbles: see-through, with a rainbow film at the rim.
const MAXB = 240,
  bubbleMat = keepM(
    new T.MeshPhongMaterial({ color: "#ffffff", specular: "#ffffff", shininess: 90, transparent: true, opacity: 0.2, depthWrite: false }),
  );
bubbleMat.onBeforeCompile = (s) => {
  s.fragmentShader = s.fragmentShader.replace(
    "#include <dithering_fragment>",
    `#include <dithering_fragment>
    vec3 bn = normalize(vNormal);
    float fr = pow(1.0 - abs(dot(bn, normalize(vViewPosition))), 1.6);
    vec3 film = 0.55 + 0.45 * cos(6.2831 * (fr * 1.6 + vec3(0.0, 0.33, 0.67)));
    float hl = pow(max(dot(bn, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 36.0) + 0.5 * pow(max(dot(bn, normalize(vec3(0.5, -0.4, 0.75))), 0.0), 60.0);
    gl_FragColor.rgb = mix(vec3(0.86, 0.95, 1.0), film, clamp(fr * 1.2, 0.0, 1.0)) + hl * 1.2;
    #ifdef USE_INSTANCING_COLOR
      gl_FragColor.rgb *= vColor;
    #endif
    gl_FragColor.a = clamp(opacity + fr * 0.95 + hl, 0.0, 1.0);`,
  );
};
bubbleMat.customProgramCacheKey = () => "mini-bubble-2";
const bubbleIM = instanced(G.sphereMid, bubbleMat, MAXB, FX);
const confettiPalette = ["#ff4d6d", "#ffd23f", "#4fbfff", "#7bd94f", "#b77cff", "#ff9f1c", "#ffffff", "#ff84c6"].map((c) => new T.Color(c));
const engineFx = [];
let seenBullets = new WeakSet(),
  seenGrenades = new Map(),
  deathSeen = new Set();
function fxSpawn(o) {
  if (engineFx.length < 1200) engineFx.push(o);
}
function spawnPoof(x, y, z, color) {
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2,
      sp = pr(1.6, 2.8);
    fxSpawn({
      kind: "puff",
      x: x + Math.cos(a) * 0.3,
      y: y + 0.5 + prand() * 0.9,
      z: z + Math.sin(a) * 0.3,
      vx: Math.cos(a) * sp,
      vy: pr(0.3, 1.6),
      vz: Math.sin(a) * sp,
      life: pr(0.5, 0.8),
      max: 0.8,
      size: pr(0.45, 0.7),
      color: "#efeae2",
      drag: 3.5,
    });
  }
  for (let i = 0; i < 14; i++) {
    const a = prand() * 6.28,
      sp = pr(3, 6);
    fxSpawn({
      kind: "star",
      x,
      y: y + 1,
      z,
      vx: Math.cos(a) * sp,
      vy: pr(2, 6),
      vz: Math.sin(a) * sp,
      life: pr(0.4, 0.8),
      max: 0.8,
      size: pr(0.08, 0.14),
      color: i % 2 ? "#ffe066" : color,
      grav: 9,
    });
  }
}
function sparkle(x, y, z, color, n = 10) {
  for (let i = 0; i < n; i++) {
    const a = prand() * 6.28,
      sp = pr(1, 3);
    fxSpawn({
      kind: "star",
      x,
      y: y + pr(0, 0.5),
      z,
      vx: Math.cos(a) * sp,
      vy: pr(1.5, 4),
      vz: Math.sin(a) * sp,
      life: pr(0.35, 0.7),
      max: 0.7,
      size: pr(0.06, 0.11),
      color,
      grav: 5,
    });
  }
}
function explode(x, y, z) {
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2,
      sp = pr(4, 7);
    fxSpawn({
      kind: "puff",
      x,
      y: y + 0.3,
      z,
      vx: Math.cos(a) * sp,
      vy: pr(1, 4),
      vz: Math.sin(a) * sp,
      life: pr(0.5, 0.9),
      max: 0.9,
      size: pr(0.6, 1.1),
      color: i % 3 ? "#fff4d6" : "#ffd27a",
      drag: 4,
    });
  }
  for (let i = 0; i < 22; i++) {
    const a = prand() * 6.28,
      sp = pr(5, 10);
    fxSpawn({
      kind: "star",
      x,
      y: y + 0.5,
      z,
      vx: Math.cos(a) * sp,
      vy: pr(3, 8),
      vz: Math.sin(a) * sp,
      life: pr(0.4, 0.8),
      max: 0.8,
      size: pr(0.1, 0.18),
      color: "#ffe066",
      grav: 12,
    });
  }
  fxSpawn({ kind: "flash", x, y: y + 0.8, z, life: 0.14, max: 0.14, size: 1.7, color: "#fff0b0" });
}
function updateEngineFx(dt) {
  for (let i = engineFx.length - 1; i >= 0; i--) {
    const f = engineFx[i];
    f.life -= dt;
    if (f.life <= 0) {
      engineFx.splice(i, 1);
      continue;
    }
    const k = f.drag ? Math.exp(-f.drag * dt) : 1;
    f.vx = (f.vx || 0) * k;
    f.vz = (f.vz || 0) * k;
    f.vy = ((f.vy || 0) - (f.grav || 0) * dt) * (f.drag ? Math.exp(-f.drag * 0.5 * dt) : 1);
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z += f.vz * dt;
    if (f.y < 0.03 && f.grav) {
      f.y = 0.03;
      f.vy *= -0.35;
    }
  }
}
function pooled(key, index, geometry, mat) {
  let pool = effectPool.get(key);
  if (!pool) {
    pool = [];
    effectPool.set(key, pool);
  }
  if (!pool[index]) {
    const m = new T.Mesh(geometry, typeof mat === "function" ? mat() : mat);
    m.castShadow = false;
    m.receiveShadow = false;
    effectGroup.add(m);
    pool[index] = m;
  }
  pool[index].visible = true;
  return pool[index];
}
const trailG = cg("trailG", () => new T.CylinderGeometry(0, 0.09, 1, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5));
const arcG = cg("arcG", () => new T.RingGeometry(0.62, 1, 40, 1, -1.25, 2.5));
const discG = cg("discG", () => new T.CircleGeometry(1, 48));
const shockG = cg("shockG", () => new T.TorusGeometry(1, 0.05, 6, 72));
const knotG = cg("knotG", () => new T.ConeGeometry(0.12, 0.18, 10));
const stringG = cg("stringG", () => new T.CylinderGeometry(0.012, 0.012, 1.6, 4).translate(0, -0.8, 0));
const arrowG = cg("arrowG", () => {
  const b = new Builder();
  b.rod([0, 0, -0.55], [0, 0, 0.35], 0.025, "#e8c07a");
  b.cone(0, 0, 0.42, 0.045, 0.14, "#dfe9f0", 1, [Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) b.box(s * 0.04, 0, -0.48, 0.08, 0.006, 0.16, "#ff6fb5", 0.1, [0, 0, s * 0.5]);
  return b.build();
});
const boltG = cg("boltG", () => {
  const b = new Builder();
  b.rod([0, 0, -0.5], [0, 0, 0.3], 0.03, "#4fbfff", 0.3);
  b.cyl(0, 0, 0.34, 0.075, 0.06, "#ff4d4d", 0.5, [Math.PI / 2, 0, 0]);
  return b.build();
});
const projLook = {
  1: { geo: G.sphereLo, mat: material("#b9c4cf", 0.5), s: 0.12, trail: "#ffffff" },
  2: { geo: G.sphereLo, mat: glow("#29c7ff", 2.6), s: 0.13, trail: "#29c7ff" },
  3: { geo: arrowG, mat: lootMat, s: 1, trail: "#ffe9a8" },
  4: { geo: torusG(0.13, 0.035), mat: material("#ff4d6d", 0.3), s: 1, trail: "#ff7b9c" },
  9: { geo: boltG, mat: lootMat, s: 1, trail: "#b77cff" },
  d: { geo: G.sphereLo, mat: glow("#ffe066", 2.6), s: 0.11, trail: "#ffe066" },
};
const Z = v3(0, 0, 1),
  _dir = new T.Vector3(),
  _qq = new T.Quaternion(),
  _sc = new T.Vector3(),
  _ps = new T.Vector3();
let catModel = null;
function createCat() {
  const g = group(effectGroup),
    mat = lootMat,
    b = new Builder();
  b.sphere(0, 1.4, 0, 1.2, 1.05, 2.05, "#ff9f43", 0.15);
  b.sphere(0, 1.12, 0.25, 0.98, 0.72, 1.62, "#fff1e0", 0.1);
  for (let i = 0; i < 4; i++)
    b.put(
      torusG(1, 0.11),
      [0, 1.42, -1.15 + i * 0.72],
      [0, 0, 0],
      [1.14 - Math.abs(i - 1.5) * 0.07, 1 - Math.abs(i - 1.5) * 0.07, 1],
      "#e67e22",
      0.1,
    );
  b.mesh(mat, g);
  const head = group(g, 0, 2.2, 1.85),
    h = new Builder();
  h.sphere(0, 0, 0, 1, 0.88, 0.9, "#ff9f43", 0.15);
  h.sphere(-0.26, -0.28, 0.66, 0.42, 0.3, 0.3, "#fff1e0", 0.1);
  h.sphere(0.26, -0.28, 0.66, 0.42, 0.3, 0.3, "#fff1e0", 0.1);
  h.sphere(0, -0.12, 0.9, 0.12, 0.09, 0.08, "#ff7b9c", 0.6);
  for (const s of [-1, 1]) {
    h.sphere(s * 0.38, 0.14, 0.7, 0.26, 0.3, 0.12, "#d7f56b", 0.9);
    h.sphere(s * 0.38, 0.14, 0.8, 0.06, 0.24, 0.05, "#1d1a2e", 1);
    h.sphere(s * 0.33, 0.24, 0.84, 0.05, 0.05, 0.02, "#ffffff", 0.2);
    h.cone(s * 0.56, 0.82, 0, 0.36, 0.72, "#ff9f43", 0.1, [0, 0, -s * 0.35]);
    h.cone(s * 0.55, 0.78, 0.1, 0.2, 0.48, "#ff9ecb", 0.1, [0, 0, -s * 0.35]);
    for (let k = 0; k < 3; k++) h.rod([s * 0.4, -0.25, 0.8], [s * 1.35, -0.12 - k * 0.14, 0.85], 0.012, "#ffffff");
  }
  h.put(torusG(0.1, 0.022, Math.PI), [-0.1, -0.36, 0.84], [0, 0, Math.PI], [1, 1, 1], "#5a2233");
  h.put(torusG(0.1, 0.022, Math.PI), [0.1, -0.36, 0.84], [0, 0, Math.PI], [1, 1, 1], "#5a2233");
  h.mesh(mat, head);
  const legs = [];
  for (const [x, z] of [
    [-0.65, 1.1],
    [0.65, 1.1],
    [-0.65, -1.1],
    [0.65, -1.1],
  ]) {
    const lg = group(g, x, 1, z),
      lb = new Builder();
    lb.capsule(0, -0.42, 0, 0.26, 0.5, "#ff9f43", 0.1);
    lb.sphere(0, -0.85, 0.1, 0.32, 0.22, 0.36, "#fff1e0", 0.2);
    lb.mesh(mat, lg);
    legs.push(lg);
  }
  const tail = group(g, 0, 1.7, -1.9),
    tb = new Builder();
  tb.put(
    new T.TubeGeometry(new T.CatmullRomCurve3([v3(0, 0, 0), v3(0, 0.8, -0.6), v3(0, 1.8, -0.7), v3(0, 2.5, -0.2)]), 30, 0.2, 12),
    [0, 0, 0],
    [0, 0, 0],
    [1, 1, 1],
    "#ff9f43",
    0.1,
  );
  tb.sphere(0, 2.5, -0.2, 0.24, 0.24, 0.24, "#fff1e0", 0.1);
  tb.mesh(mat, tail);
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { g, head, legs, tail, lx: 0, lz: 0 };
}
function renderEffects(dt) {
  hidePooledEffects();
  updateEngineFx(dt);
  let nc = 0,
    np = 0,
    ns = 0,
    npl = 0,
    nmz = 0,
    nbf = 0,
    nb = 0;
  const putC = (x, y, z, s, rx, ry, rz, c) => {
    if (nc >= MAXC) return;
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m4.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
    confettiIM.setMatrixAt(nc, _m4);
    confettiIM.setColorAt(nc, c);
    nc++;
  };
  const putP = (x, y, z, s, c, sy = s) => {
    if (np >= MAXP || s <= 0.001) return;
    _q.identity();
    _m4.compose(_p.set(x, y, z), _q, _s.set(s, sy, s));
    puffIM.setMatrixAt(np, _m4);
    _c.set(c);
    puffIM.setColorAt(np, _c);
    np++;
  };
  const putS = (x, y, z, s, c, k = 2.4, spin = 0) => {
    if (ns >= MAXS || s <= 0.001) return;
    _e.set(spin, spin * 1.3, 0);
    _q.setFromEuler(_e);
    _m4.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
    sparkIM.setMatrixAt(ns, _m4);
    _c.set(c).multiplyScalar(k);
    sparkIM.setColorAt(ns, _c);
    ns++;
  };
  const putB = (x, y, z, s) => {
    if (nb >= MAXB || s <= 0.01) return;
    _m4.compose(_p.set(x, y, z), _q.identity(), _s.set(s, s, s));
    bubbleIM.setMatrixAt(nb, _m4);
    bubbleIM.setColorAt(nb, _c.set(options.night ? "#c3ccff" : "#ffffff"));
    nb++;
  };
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i],
      kind = p.kind || (p.steam ? "steam" : "confetti"),
      max = p.max || (p.steam ? 2 : 1.1),
      t = Math.max(0, Math.min(1, p.life / max)),
      age = 1 - t,
      y = Math.max(0.03, p.y);
    if (kind === "steam")
      putP(p.x, y, p.z, (p.size || 0.35) * (1.2 + age * 2.6) * Math.min(1, age * 7) * (t < 0.3 ? t / 0.3 : 1), "#ffffff");
    else if (kind === "dust") putP(p.x, y, p.z, (p.size || 0.1) * 1.7 * (0.8 + age * 0.6) * t, "#fbf4e6");
    else if (kind === "water") putS(p.x, y, p.z, 0.075 * (0.4 + t), "#8fe1ff", 1.5, i);
    else if (kind === "bubble") putB(p.x, y, p.z, (p.size || 0.2) * Math.min(1, age * 6) * (t < 0.15 ? 0.5 + t * 3.3 : 1));
    else if (kind === "hit" || kind === "spark")
      putS(p.x, y, p.z, (p.size || 0.1) * 1.5 * (0.3 + t), p.color || "#fff1a8", 2.6, worldClock * 6 + i);
    else {
      const c = i % 5 < 2 ? _c.set(p.color || "#ffd23f") : confettiPalette[(i * 7) % confettiPalette.length];
      putC(p.x, y, p.z, 0.2 + (i % 3) * 0.06, worldClock * 3 + i, worldClock * 4 + i * 0.7, i, c);
    }
  }
  for (const f of engineFx) {
    const t = Math.max(0, f.life / f.max);
    if (f.kind === "puff") putP(f.x, f.y, f.z, f.size * (t < 0.35 ? t / 0.35 : 1) * (1 + (1 - t) * 0.5), f.color);
    else if (f.kind === "star") putS(f.x, f.y, f.z, f.size * (0.4 + t), f.color, 2.8, worldClock * 7 + f.x);
    else if (f.kind === "plus" && npl < MAXPL) {
      _q.copy(camera.quaternion);
      _m4.compose(_p.set(f.x, f.y, f.z), _q, _s.setScalar(f.size * Math.min(1, t * 3)));
      plusIM.setMatrixAt(npl, _m4);
      _c.set(f.color).multiplyScalar(1.8);
      plusIM.setColorAt(npl, _c);
      npl++;
    } else if (f.kind === "flash") {
      const m = pooled(
        "boomflash",
        nbf++,
        G.sphereLo,
        () =>
          new T.MeshBasicMaterial({
            color: new T.Color("#fff0b0").multiplyScalar(1.8),
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
          }),
      );
      m.layers.set(FX);
      m.position.set(f.x, f.y, f.z);
      m.scale.setScalar(f.size * (1.4 - t * 0.7));
      m.material.opacity = t * t * 0.85;
    } else if (f.kind === "muzzle") {
      const m = pooled(
        "muzzle",
        nmz++,
        flatStarG,
        () =>
          new T.MeshBasicMaterial({
            color: new T.Color("#fff1a8").multiplyScalar(3),
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            side: T.DoubleSide,
          }),
      );
      m.layers.set(FX);
      m.position.set(f.x, f.y, f.z);
      m.quaternion.copy(camera.quaternion);
      m.rotateZ(f.x * 13);
      m.scale.setScalar(f.size * (0.6 + t * 0.6));
      m.material.color.set(f.color).multiplyScalar(3);
      m.material.opacity = Math.min(1, t * 2);
    }
  }
  for (const c of clouds) {
    const life = c.life ?? 7,
      grow = Math.min(1, (7 - life) * 2.5),
      shrink = Math.min(1, life / 1.2),
      r = c.r || 4;
    for (let j = 0; j < 11; j++) {
      const a = j * 2.4 + c.x,
        rr = (j % 3 === 0 ? 0.2 : 0.55 + (j % 4) * 0.12) * r * 0.62,
        s = (1.25 + (j % 3) * 0.35) * grow * shrink * (1 + Math.sin(worldClock * 1.7 + j) * 0.06);
      putP(
        c.x + Math.sin(a + worldClock * 0.15) * rr,
        0.7 + (j % 4) * 0.55 + Math.sin(worldClock + j) * 0.1,
        c.z + Math.cos(a + worldClock * 0.15) * rr,
        s,
        j % 4 ? "#eef0f5" : "#d9dde8",
      );
    }
  }
  // Big soap bubbles from the bathroom drain (their paths come from the match clock).
  if (typeof drainBubbles === "function")
    for (const b of drainBubbles()) putB(b.x, b.y, b.z, b.r * Math.min(1, b.t * 3) * (1 + 0.05 * Math.sin(worldClock * 7 + b.key)));
  confettiIM.count = nc;
  puffIM.count = np;
  sparkIM.count = ns;
  plusIM.count = npl;
  bubbleIM.count = nb;
  for (const im of [confettiIM, puffIM, sparkIM, plusIM, bubbleIM]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
  // Projectiles with glowing trails; muzzle flashes appear when a new projectile is seen.
  bullets.forEach((b, i) => {
    const look = projLook[b.wid] || projLook.d,
      m = pooled("bullet", i, look.geo, look.mat);
    m.geometry = look.geo;
    m.material = look.mat;
    m.layers.set(FX);
    _dir.set(b.dx || 0, b.dy || 0, b.dz || 1).normalize();
    _qq.setFromUnitVectors(Z, _dir);
    m.position.set(b.x, b.y, b.z);
    m.quaternion.copy(_qq);
    m.scale.setScalar(look.s);
    if (b.wid === 4) m.rotateY(worldClock * 20);
    const tr = pooled(
      "trail",
      i,
      trailG,
      () =>
        new T.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending }),
    );
    tr.layers.set(FX);
    tr.position.copy(m.position);
    tr.quaternion.copy(_qq);
    const travelled = ((b.max || b.life) - b.life) * 30;
    tr.scale.set(1, 1, Math.min(2.2, travelled + 0.2));
    tr.material.color.set(look.trail).multiplyScalar(1.6);
    if (!seenBullets.has(b)) {
      seenBullets.add(b);
      fxSpawn({ kind: "muzzle", x: b.x, y: b.y, z: b.z, life: 0.08, max: 0.08, size: 0.42, color: look.trail });
    }
  });
  const alive = new Set(grenades);
  for (const [g, pos] of seenGrenades)
    if (!alive.has(g)) {
      explode(pos.x, pos.y, pos.z);
      seenGrenades.delete(g);
    }
  grenades.forEach((b, i) => {
    const m = pooled("grenade", i, lootGeo("grenade", 0), lootMat);
    m.castShadow = true;
    m.position.set(b.x, b.y, b.z);
    m.rotation.set(worldClock * 9, worldClock * 5, 0);
    m.scale.setScalar(1.3);
    seenGrenades.set(b, { x: b.x, y: b.y, z: b.z });
    if (Math.random() < 0.35)
      fxSpawn({
        kind: "star",
        x: b.x,
        y: b.y + 0.2,
        z: b.z,
        vx: pr(-1, 1),
        vy: pr(0.5, 2),
        vz: pr(-1, 1),
        life: 0.25,
        max: 0.25,
        size: 0.06,
        color: "#ffcf5a",
        grav: 3,
      });
  });
  rings.forEach((r, i) => {
    const kind = r.kind || (r.arc ? "swing" : "boom"),
      total = r.total || r.life || 1,
      t = Math.max(0, Math.min(1, r.life / total));
    if (kind === "swing") {
      const m = pooled(
        "swing",
        i,
        arcG,
        () =>
          new T.MeshBasicMaterial({
            color: "#ffffff",
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            blending: T.AdditiveBlending,
          }),
      );
      m.layers.set(FX);
      m.position.set(r.x, (r.y || 0) + 1, r.z);
      m.rotation.set(-Math.PI / 2, 0, (r.angle || 0) - Math.PI / 2);
      m.scale.setScalar(r.r * (0.8 + (1 - t) * 0.3));
      m.material.color.set(r.color || "#fff4c4").multiplyScalar(1.6);
      m.material.opacity = t * 0.85;
    } else if (kind === "warn") {
      const d = pooled("warnDisc", i, discG, () => new T.MeshBasicMaterial({ color: "#ff5a3d", transparent: true, depthWrite: false }));
      d.layers.set(FX);
      d.position.set(r.x, 0.06, r.z);
      d.rotation.x = -Math.PI / 2;
      d.scale.setScalar(r.r);
      d.material.color.set(r.color || "#ff6b4a").multiplyScalar(1.3);
      d.material.opacity = 0.22 + 0.14 * Math.sin(worldClock * 18);
      const o = pooled("warnRing", i, shockG, () => new T.MeshBasicMaterial({ color: "#ffffff", transparent: true, depthWrite: false }));
      o.layers.set(FX);
      o.position.set(r.x, 0.09, r.z);
      o.rotation.x = Math.PI / 2;
      o.scale.set(r.r * Math.max(0.05, t), r.r * Math.max(0.05, t), 1);
      o.material.color.set("#fff0d0").multiplyScalar(1.8);
      o.material.opacity = 0.9;
    } else {
      const m = pooled(
        "shock",
        i,
        shockG,
        () => new T.MeshBasicMaterial({ color: "#ffffff", transparent: true, depthWrite: false, blending: T.AdditiveBlending }),
      );
      m.layers.set(FX);
      m.position.set(r.x, (r.y || 0) + 0.25, r.z);
      m.rotation.x = Math.PI / 2;
      const s = r.r * (0.2 + (1 - t) * 1.05);
      m.scale.set(s, s, 1 + (1 - t) * 6);
      m.material.color.set(r.color || "#ffe09b").multiplyScalar(2);
      m.material.opacity = t;
    }
  });
  balloons.forEach((b, i) => {
    const m = pooled("balloon", i, G.sphere, material(b.color, 0.2));
    m.material = material(b.color, 0.2);
    m.castShadow = true;
    const sw = Math.sin(worldClock * 1.6 + i) * 0.25;
    m.position.set(b.x + sw, b.y + 2, b.z);
    m.scale.set(0.55, 0.7, 0.55);
    const k = pooled("knot", i, knotG, material(b.color, 0.2));
    k.material = material(b.color, 0.2);
    k.position.set(b.x + sw, b.y + 1.28, b.z);
    const s = pooled("string", i, stringG, material("#fff4e6"));
    s.position.set(b.x + sw, b.y + 1.22, b.z);
    s.rotation.z = Math.sin(worldClock * 2.3 + i) * 0.2;
  });
  traps.forEach((t, i) => {
    const m = pooled("trap", i, lootGeo("gadget", 3), lootMat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(t.x, 0.06, t.z);
    m.rotation.y = i * 1.7;
    m.scale.setScalar(1.8);
  });
  if (cat) {
    if (!catModel || !catModel.g.parent) catModel = createCat();
    const cm = catModel,
      moved = Math.hypot(cat.x - cm.lx, cat.z - cm.lz) > dt * 0.8;
    cm.lx = cat.x;
    cm.lz = cat.z;
    const mode = cat.mode || "hunt";
    cm.g.visible = true;
    cm.g.position.set(cat.x, 0, cat.z);
    cm.g.rotation.y = cat.angle || 0;
    const crouch = mode === "warn",
      leap = mode === "pounce";
    cm.g.scale.set(1, crouch ? 0.86 : 1, leap ? 1.22 : 1);
    cm.g.rotation.z = crouch ? Math.sin(worldClock * 26) * 0.04 : 0;
    cm.legs.forEach((l, k) => {
      l.rotation.x = leap
        ? k < 2
          ? -0.9
          : 0.9
        : moved
          ? Math.sin(worldClock * 10 + (k % 2 ? Math.PI : 0) + (k > 1 ? Math.PI / 2 : 0)) * 0.55
          : 0;
    });
    cm.tail.rotation.set(crouch ? -0.35 : 0, Math.sin(worldClock * (crouch ? 14 : 2.2)) * (crouch ? 0.35 : 0.5), 0);
    cm.head.rotation.set(crouch ? 0.15 : 0, Math.sin(worldClock * 0.9) * 0.15, 0);
    cm.g.position.y = moved && !leap ? Math.abs(Math.sin(worldClock * 10)) * 0.08 : 0;
  } else if (catModel) catModel.g.visible = false;
}
// ---------- camera ----------
let camDist = 5.5,
  camFov = 62,
  viewShift = null;
function menuFocusX() {
  const intro = document.querySelector(".intro"),
    side = document.querySelector(".sidePanel");
  if (!intro || innerWidth <= 700) return innerWidth * 0.74;
  const ir = intro.getBoundingClientRect(),
    sr = side ? side.getBoundingClientRect() : null,
    right = sr && sr.width > 0 ? sr.left : innerWidth;
  return Math.min(innerWidth * 0.86, Math.max(innerWidth * 0.55, (ir.right + right) / 2));
}
function refreshMenuHero() {
  if (!menuHero) return;
  dynamic.remove(menuHero.root);
  dynamic.remove(menuHero.shadow);
  disposeDetached(menuHero.root);
  menuHero = null;
}
function updateCamera(dt) {
  if (mode === "menu") {
    const hx = arenaKind === "garden" ? 3 : 4,
      hz = arenaKind === "kitchen" ? 13 : 12;
    if (!menuHero) {
      const a = makeActor(hx, hz, 0);
      a.landed = true;
      a.slots[1] = item(9, 3);
      a.slot = 1;
      menuHero = createActorModel(a);
      menuHero.actor = a;
      actorModels.delete(0);
    }
    const orbit = 0.42 + Math.sin(worldClock * 0.13) * 0.2,
      cx = hx + Math.sin(orbit) * 5.1,
      cz = hz + Math.cos(orbit) * 5.1,
      a = menuHero.actor;
    a.angle = Math.atan2(cx - hx, cz - hz) - 0.32 + Math.sin(worldClock * 0.5) * 0.12;
    a.moving = false;
    a.vy = 0;
    a.y = 0;
    a.animation = Math.max(0, (a.animation || 0) - dt);
    if (Math.sin(worldClock * 0.7) > 0.995 && a.animation <= 0) a.animation = 0.22;
    // Now and then the hero in the menu shows off an emote or its victory dance.
    if (!a.emote && worldClock > (a.nextEmote ?? 5) && typeof ownedEmotes === "function") {
      const list = ownedEmotes();
      a.emote = { k: Math.random() < 0.5 ? emoteIndex(profile.dance) : list[Math.floor(Math.random() * list.length)], at: worldClock };
      a.nextEmote = worldClock + 9 + Math.random() * 5;
    }
    menuHero.root.visible = true;
    menuHero.shadow.visible = true;
    animateActor(a, menuHero, dt, false);
    menuHero.limbs[0].arm.rotation.set(-0.2 + Math.sin(worldClock * 1.3) * 0.08, 0, -0.25 - Math.max(0, Math.sin(worldClock * 0.9)) * 1.9);
    camera.position.set(cx, 1.95, cz);
    camera.lookAt(hx, 1.02, hz);
    if (camera.fov !== 48) {
      camera.fov = 48;
      camera.updateProjectionMatrix();
    }
    const W = innerWidth,
      H = innerHeight,
      shift = Math.round(W / 2 - menuFocusX()),
      key = W + "x" + H + ":" + shift;
    if (viewShift !== key) {
      viewShift = key;
      camera.setViewOffset(W, H, shift, Math.round(-H * 0.03), W, H);
    }
  } else if (mode === "end" && player?.alive && player.emote?.loop) {
    // Victory: the camera circles the winner while it dances, the hero to the right of the results.
    const ang = player.angle + Math.sin(worldClock * 0.3) * 0.7,
      eye = v3(player.x, player.y + 1.05, player.z),
      want = v3(player.x + Math.sin(ang) * 4.4, player.y + 1.8, player.z + Math.cos(ang) * 4.4),
      dir = want.clone().sub(eye),
      len = dir.length();
    raycaster.set(eye, dir.normalize());
    raycaster.far = len;
    const hits = raycaster.intersectObjects(solids, false);
    if (hits.length) want.copy(eye).addScaledVector(dir, Math.max(1.2, hits[0].distance - 0.3));
    camera.position.lerp(want, 1 - Math.exp(-dt * 3));
    camera.lookAt(eye);
    if (Math.abs(camera.fov - 50) > 0.01) {
      camera.fov = camFov = 50;
      camera.updateProjectionMatrix();
    }
    const W = innerWidth,
      H = innerHeight,
      key = "end:" + W + "x" + H;
    if (viewShift !== key) {
      viewShift = key;
      camera.setViewOffset(W, H, Math.round(-W * 0.24), 0, W, H);
    }
  } else if (spectate) {
    if (viewShift !== null) {
      viewShift = null;
      camera.clearViewOffset();
    }
    const t = spectate.target,
      killcam = stats.killer && t === stats.killer && spectate.t < 2.6;
    let desired, look;
    if (killcam) {
      const p = spectate.pos,
        dx = t.x - p.x,
        dz = t.z - p.z,
        d = Math.hypot(dx, dz) || 1;
      // Behind and beside the knock-out spot, so the poof and the balloon stay out of the way.
      desired = v3(p.x - (dx / d) * 3.2 + (dz / d) * 1.8, p.y + 3.1, p.z - (dz / d) * 3.2 - (dx / d) * 1.8);
      look = v3(t.x, t.y + 1.1, t.z);
      spectate.yaw = Math.atan2(-dx, -dz);
    } else {
      const f = t || spectate.pos,
        want = t ? t.angle + Math.PI : spectate.yaw,
        dy = ((((want - spectate.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
      spectate.yaw += dy * (1 - Math.exp(-dt * 1.8));
      const eye = v3(f.x, (f.y || 0) + 1.35, f.z),
        back = v3(Math.sin(spectate.yaw) * Math.cos(0.32), Math.sin(0.32), Math.cos(spectate.yaw) * Math.cos(0.32));
      desired = eye.clone().addScaledVector(back, 6.8);
      const dir = desired.clone().sub(eye),
        len = dir.length();
      raycaster.set(eye, dir.normalize());
      raycaster.far = len;
      const hits = raycaster.intersectObjects(solids, false);
      if (hits.length) desired.copy(eye).addScaledVector(dir, Math.max(0.8, hits[0].distance - 0.3));
      look = eye.clone().addScaledVector(back, -12);
    }
    cameraYaw = spectate.yaw;
    camera.position.lerp(desired, 1 - Math.exp(-dt * (spectate.focusT < 0.8 ? 4 : 9)));
    camera.lookAt(look);
    const fov = profile.fov || 62;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = camFov = fov;
      camera.updateProjectionMatrix();
    }
  } else {
    if (viewShift !== null) {
      viewShift = null;
      camera.clearViewOffset();
    }
    const eye = v3(player.x, player.y + 1.35, player.z),
      aiming = (mouse.right || pad.aim) && mode === "play";
    camDist += ((aiming ? cameraDist * 0.72 : cameraDist) - camDist) * (1 - Math.exp(-dt * 10));
    const base = (profile.fov || 62) + fovPunch,
      fov = aiming ? base - 12 : base;
    camFov += (fov - camFov) * (1 - Math.exp(-dt * 10));
    if (Math.abs(camera.fov - camFov) > 0.01) {
      camera.fov = camFov;
      camera.updateProjectionMatrix();
    }
    const back = v3(Math.sin(cameraYaw) * Math.cos(cameraPitch), Math.sin(cameraPitch), Math.cos(cameraYaw) * Math.cos(cameraPitch));
    const shoulder = v3(Math.cos(cameraYaw) * 0.65, 0.25, -Math.sin(cameraYaw) * 0.65),
      desired = eye.clone().addScaledVector(back, camDist).add(shoulder);
    const dir = desired.clone().sub(eye),
      len = dir.length();
    raycaster.set(eye, dir.normalize());
    raycaster.far = len;
    const hits = raycaster.intersectObjects(solids, false);
    if (hits.length) desired.copy(eye).addScaledVector(dir, Math.max(0.6, hits[0].distance - 0.3));
    camera.position.lerp(desired, 1 - Math.exp(-dt * 14));
    camera.lookAt(eye.clone().addScaledVector(back, -20).add(shoulder));
    if (profile.shake && recoil > 0) {
      camera.position.x += Math.sin(worldClock * 95) * recoil * 0.16;
      camera.position.y += Math.cos(worldClock * 100) * recoil * 0.12;
    }
    // Trauma shake: smooth layered noise, its strength the square of the trauma, with a slight roll.
    if (profile.shake && trauma > 0.001) {
      const k = trauma * trauma,
        tt = performance.now() / 1000 * 26;
      camera.position.x += (Math.sin(tt * 1.7) + Math.sin(tt * 2.9 + 1.3) * 0.5) * k * 0.2;
      camera.position.y += (Math.sin(tt * 2.3 + 0.7) + Math.sin(tt * 3.7) * 0.5) * k * 0.16;
      camera.rotateZ(Math.sin(tt * 1.3 + 2.1) * k * 0.05);
    }
  }
  cam = [camera.position.x, camera.position.y, camera.position.z];
  target = [0, 0, 0];
  camera.updateMatrixWorld();
}
function projectWorld(x, y, z) {
  const v = v3(x, y, z).project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (0.5 - v.y * 0.5) * innerHeight, visible: v.z > -1 && v.z < 1 };
}
// Resize only when the window, pixel ratio or quality really change (three.js floors canvas sizes).
function syncView() {
  const q = profile.quality;
  if (q !== appliedQuality) {
    appliedQuality = q;
    applyShadowQuality();
    appliedSize = "";
  }
  const dpr = window.devicePixelRatio || 1,
    ratio = q === "low" ? 1 : q === "high" ? Math.min(dpr, 1.5) : Math.min(dpr, 2),
    key = innerWidth + "x" + innerHeight + "@" + ratio;
  if (key === appliedSize) return;
  appliedSize = key;
  viewShift = null;
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  composer.setPixelRatio(ratio);
  composer.setSize(innerWidth, innerHeight);
  inkPass.uniforms.thickness.value = Math.max(1, ratio * 0.85);
}
function updateAmbient(dt) {
  for (const f of animated) f(dt);
  for (let i = 0; i < nightLamps.length; i++) {
    const f = nightLamps[i],
      b = f.userData.base,
      ph = f.userData.phase;
    f.position.set(
      b.x + Math.sin(worldClock * 0.5 + ph) * 1.6,
      b.y + Math.sin(worldClock * 0.9 + ph * 2) * 0.6,
      b.z + Math.cos(worldClock * 0.4 + ph) * 1.6,
    );
    f.scale.setScalar(0.06 + 0.05 * Math.max(0, Math.sin(worldClock * 2.2 + ph * 3)));
  }
  if (sky) {
    sky.position.copy(camera.position);
    sky.material.uniforms.time.value = worldClock;
  }
  for (const m of pillarMats.values()) m.uniforms.time.value = worldClock;
  if (zoneWall) {
    const show = mode !== "menu" && zone < 43;
    zoneWall.visible = show;
    if (show) {
      zoneWall.scale.set(zone, 1, zone);
      zoneWall.material.uniforms.time.value = worldClock;
      zoneWall.material.uniforms.radius.value = Math.max(2, zone);
    }
  }
  if (hillWall) {
    const h = mode !== "menu" && typeof koth === "function" && koth() ? KOTH.hill : null;
    hillWall.visible = hillDisc.visible = hillRing.visible = !!h;
    if (h) {
      const col = KOTH.contested ? "#ff5d5d" : KOTH.holder >= 0 && KOTH.holder === player?.team ? "#5fe39a" : "#ffc93d";
      hillWall.material = pillarMat(col);
      hillWall.material.uniforms.time.value = worldClock;
      hillWall.position.set(h.x, 0, h.z);
      hillWall.scale.set(h.r, 1, h.r);
      hillRing.position.set(h.x, 0.08, h.z);
      hillRing.scale.set(h.r, 1, h.r);
      hillRing.material.color.set(col);
      hillDisc.position.set(h.x, 0.05, h.z);
      hillDisc.scale.setScalar(h.r);
      hillDisc.material.color.set(col);
      hillDisc.material.opacity = 0.18 + 0.06 * Math.sin(worldClock * 3);
    }
  }
  if (hazardDecal) {
    const cyc = time % 36,
      on = mode === "play" && arenaKind === "kitchen" && cyc > 23;
    hazardDecal.visible = on;
    if (on) hazardDecal.material.opacity = cyc > 27 ? 0.42 + 0.1 * Math.sin(worldClock * 14) : 0.16 + 0.12 * Math.sin(worldClock * 9);
  }
}
function render(dt) {
  syncView();
  const sim = paused && mode === "play" && !net.on ? 0 : dt;
  updateCamera(dt);
  updateAmbient(sim);
  if (mode !== "menu") {
    if (menuHero) {
      menuHero.root.visible = false;
      menuHero.shadow.visible = false;
    }
    updateModels(sim);
    renderEffects(sim);
  } else if (menuHero?.actor && (menuHero.actor.trailShow || 0) > worldClock - 1.5) {
    // The shop shows a trail on the hero in the menu.
    updateEffects(sim);
    renderEffects(sim);
  } else {
    hidePooledEffects();
    for (const im of [confettiIM, puffIM, sparkIM, plusIM, bubbleIM]) im.count = 0;
    engineFx.length = 0;
    if (catModel) catModel.g.visible = false;
  }
  renderer.shadowMap.needsUpdate = true;
  if (profile.quality === "low") renderer.render(scene, camera);
  else composer.render(dt);
}
function hidePooledEffects() {
  // Steam and confetti share source indices, so their separate pools are sparse.
  for (const pool of effectPool.values()) for (const m of pool) if (m) m.visible = false;
}
