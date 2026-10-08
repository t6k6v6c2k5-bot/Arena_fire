// Arena Fire — клиент: Three.js рендер, управление (тач + ПК), предсказание движения, интерполяция, HUD, звук.
import * as THREE from 'three';
import * as S from './shared.js';

const $ = (id) => document.getElementById(id);
const clamp = S.clamp;
const tg = window.Telegram?.WebApp;
const isTouch = matchMedia('(pointer: coarse)').matches || ['android', 'ios'].includes(tg?.platform);
document.body.classList.toggle('touch-ui', isTouch);

try { tg?.ready(); tg?.expand(); tg?.disableVerticalSwipes?.(); } catch { /* вне Telegram */ }

const INTERP = 100; // мс задержки интерполяции чужих игроков
const WEAPON_ICON = ['🔫', '🔫', '💥'];

// ---------- Состояние ----------
let socket = null;
let joined = false;
let wantJoin = false;
let myId = 0;
let myTeam = 0;
const roster = new Map();

const view = { yaw: 0, pitch: 0 };
const me = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true };
const prev = { x: 0, y: 0, z: 0 };
let alive = false;
let deathAt = 0;
let info = { hp: 100, w: 0, wp: [[30, 120], [12, 999], [6, 30]], rl: 0, resp: 0, prot: 0 };
let menuOpen = true;
let selWeapon = 0;
let localNextFire = 0;
let matchState = 0;
let ping = 0;

const buf = [];
let lastSnap = null;
let clockOff = 0;
let clockInit = false;
const pending = [];
let seq = 0;
let acc = 0;

const input = { fireHeld: false, fireLatch: false, localTap: false, reloadLatch: false, jumpBtn: false };
const keys = {};
let locked = false;
let sens = parseFloat(localStorage.getItem('af_sens') || '1') || 1;

const serverNow = () => Date.now() + clockOff;

// ---------- Рендер ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
renderer.autoClear = false;

const HORIZON = 0xdcecf8;
const scene = new THREE.Scene();
scene.background = new THREE.Color(HORIZON);
scene.fog = new THREE.Fog(HORIZON, 40, 125);

const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 400);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x5b6b45, 1.7));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.position.set(30, 50, 20);
scene.add(sun);

// вьюмодель (оружие от первого лица) рисуется отдельным проходом — не проваливается в стены
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
vmScene.add(new THREE.AmbientLight(0xffffff, 2.0));
const vmLight = new THREE.DirectionalLight(0xffffff, 2.2);
vmLight.position.set(-1, 2, 1);
vmScene.add(vmLight);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  vmCam.aspect = w / h; vmCam.updateProjectionMatrix();
  $('rotate').style.display = isTouch && h > w ? 'flex' : 'none';
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// ---------- Карта ----------
const COLORS = { wall: 0x7f8fa3, crate: 0xc8964f, building: 0xc4604b, pillar: 0x6c8fb3 };
const mats = {};
const boxMat = (c) => (mats[c] ??= new THREE.MeshLambertMaterial({ color: COLORS[c] ?? 0x888888, flatShading: true }));
const edgeMat = new THREE.LineBasicMaterial({ color: 0x1b2430, transparent: true, opacity: 0.45 });

function buildWorld() {
  for (const b of S.BOXES) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    const m = new THREE.Mesh(g, boxMat(b.c));
    m.position.set(b.x, b.y + b.h / 2, b.z);
    scene.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat);
    e.position.copy(m.position);
    scene.add(e);
  }

  // пол с шахматной текстурой
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g2 = c.getContext('2d');
  g2.fillStyle = '#8a9b78'; g2.fillRect(0, 0, 128, 128);
  g2.fillStyle = '#7e8f6c'; g2.fillRect(0, 0, 64, 64); g2.fillRect(64, 64, 64, 64);
  g2.strokeStyle = 'rgba(0,0,0,0.07)'; g2.lineWidth = 2; g2.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 11);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), new THREE.MeshLambertMaterial({ map: tex }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // зоны баз
  for (const [team, x] of [[0, -28.5], [1, 28.5]]) {
    const z = new THREE.Mesh(new THREE.PlaneGeometry(7, 44), new THREE.MeshBasicMaterial({ color: team === 0 ? 0x3b82f6 : 0xef4444, transparent: true, opacity: 0.22 }));
    z.rotation.x = -Math.PI / 2; z.position.set(x, 0.015, 0);
    scene.add(z);
  }

  // земля за пределами арены
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ color: 0x7d9468 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03;
  scene.add(ground);

  // небо-градиент
  const skyG = new THREE.SphereGeometry(300, 16, 12);
  const cols = [];
  const c1 = new THREE.Color(HORIZON), c2 = new THREE.Color(0x3f86d6), tmp = new THREE.Color();
  const pos = skyG.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = clamp(pos.getY(i) / 300, 0, 1);
    tmp.copy(c1).lerp(c2, Math.pow(t, 0.55));
    cols.push(tmp.r, tmp.g, tmp.b);
  }
  skyG.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(skyG, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));

  // горы на горизонте
  const mm = new THREE.MeshLambertMaterial({ color: 0x7890ab, flatShading: true, fog: false });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.sin(i * 7.1) * 0.15;
    const r = 150 + (i % 3) * 14;
    const h = 22 + ((i * 37) % 30);
    const m = new THREE.Mesh(new THREE.ConeGeometry(22 + (i % 4) * 5, h, 5), mm);
    m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    scene.add(m);
  }
}
buildWorld();

// ---------- Модели игроков ----------
const lamb = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

function makeTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.5, 0.375, 1);
  s.position.set(0, 2.15, 0);
  s.renderOrder = 10;
  return s;
}

function makeRemote(pi) {
  const team = pi.team;
  const col = team === 0 ? 0x3b82f6 : 0xef4444;
  const dark = team === 0 ? 0x1e3a8a : 0x7f1d1d;
  const skin = 0xf1c9a5;
  const model = new THREE.Group();
  const box = (w, h, d, c, x, y, z, parent = model) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lamb(c));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const legL = new THREE.Group(); legL.position.set(-0.14, 0.8, 0); model.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.14, 0.8, 0); model.add(legR);
  box(0.24, 0.8, 0.26, dark, 0, -0.4, 0, legL);
  box(0.24, 0.8, 0.26, dark, 0, -0.4, 0, legR);
  box(0.56, 0.62, 0.32, col, 0, 1.11, 0);
  const head = new THREE.Group(); head.position.set(0, 1.42, 0); model.add(head);
  box(0.3, 0.3, 0.3, skin, 0, 0.17, 0, head);
  box(0.34, 0.13, 0.34, dark, 0, 0.3, 0, head);
  const arms = new THREE.Group(); arms.position.set(0, 1.3, 0); model.add(arms);
  box(0.13, 0.13, 0.5, col, -0.2, -0.15, -0.25, arms);
  box(0.13, 0.13, 0.5, col, 0.2, -0.15, -0.25, arms);
  box(0.09, 0.11, 0.62, 0x22262c, 0.1, -0.12, -0.45, arms);
  const tag = makeTag(pi.name, team === 0 ? '#9cc7ff' : '#ffa3a3');
  model.add(tag);
  scene.add(model);
  return { model, legL, legR, head, arms, tag, team, wasAlive: true, deadAt: 0, phase: 0, lx: 0, lz: 0 };
}

const remotes = new Map();

function updateRemoteModel(r, x, y, z, yaw, pitch, alv, dt) {
  const m = r.model;
  const spd = Math.min(9, Math.hypot(x - r.lx, z - r.lz) / Math.max(dt, 0.001));
  r.lx = x; r.lz = z;
  if (alv) {
    if (!r.wasAlive) { r.wasAlive = true; m.rotation.x = 0; }
    m.visible = true;
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    r.head.rotation.x = clamp(pitch, -1, 1);
    r.arms.rotation.x = clamp(pitch, -1.2, 1.2);
    r.phase += spd * dt * 2.2;
    const sw = Math.sin(r.phase) * 0.8 * Math.min(1, spd / 5);
    r.legL.rotation.x = sw; r.legR.rotation.x = -sw;
    r.tag.visible = r.team === myTeam;
  } else {
    if (r.wasAlive) { r.wasAlive = false; r.deadAt = performance.now(); }
    const age = performance.now() - r.deadAt;
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.rotation.x = 1.45 * Math.min(1, age / 350);
    m.visible = age < 3000;
    r.tag.visible = false;
  }
}

function updateRemotes(dt) {
  if (!buf.length) return;
  const rt = serverNow() - INTERP;
  let A = null, B = null;
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i].t <= rt) { A = buf[i]; B = buf[i + 1] || null; break; }
  }
  if (!A) A = buf[0];
  const f = B ? clamp((rt - A.t) / Math.max(1, B.t - A.t), 0, 1) : 0;
  const seen = new Set();
  for (const [id, ra] of A.m) {
    if (id === myId) continue;
    let r = remotes.get(id);
    if (!r) {
      const pi = roster.get(id);
      if (!pi) continue;
      r = makeRemote(pi);
      remotes.set(id, r);
    }
    seen.add(id);
    const rb = B ? B.m.get(id) : null;
    let x = ra[1], y = ra[2], z = ra[3], yaw = ra[4], pitch = ra[5];
    if (rb && rb[6] === ra[6]) {
      x += (rb[1] - x) * f; y += (rb[2] - y) * f; z += (rb[3] - z) * f;
      yaw = ra[4] + S.angDiff(rb[4], ra[4]) * f;
      pitch += (rb[5] - pitch) * f;
    }
    updateRemoteModel(r, x, y, z, yaw, pitch, ra[6], dt);
  }
  for (const [id, r] of remotes) {
    if (!seen.has(id)) { scene.remove(r.model); remotes.delete(id); }
  }
}

function clearRemotes() {
  for (const r of remotes.values()) scene.remove(r.model);
  remotes.clear();
}

// ---------- Оружие от первого лица ----------
const vm = { kick: 0, bob: 0, swap: 0, rl: 0, flash: 0 };
const vmRoot = new THREE.Group();
vmScene.add(vmRoot);

function makeGun(i) {
  const g = new THREE.Group();
  const add = (w, h, d, c, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lamb(c));
    m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
  };
  const skin = 0xf1c9a5, sleeve = 0x3a4656, metal = 0x2a2e35, dark = 0x15171b, wood = 0x7a4f2b;
  let tip;
  if (i === 0) {
    add(0.07, 0.09, 0.55, metal, 0, 0, -0.1);
    add(0.025, 0.025, 0.3, dark, 0, 0.015, -0.5);
    add(0.075, 0.07, 0.22, wood, 0, -0.005, -0.33);
    add(0.06, 0.1, 0.22, wood, 0, -0.02, 0.3);
    add(0.05, 0.16, 0.07, 0x1b1d22, 0, -0.12, -0.05, 0.25);
    add(0.02, 0.04, 0.02, dark, 0, 0.065, -0.4);
    add(0.08, 0.07, 0.12, skin, 0, -0.07, -0.35);
    add(0.07, 0.09, 0.09, skin, 0, -0.1, 0.08);
    add(0.1, 0.1, 0.4, sleeve, 0, -0.16, 0.3, -0.1);
    tip = -0.68;
  } else if (i === 1) {
    add(0.05, 0.09, 0.25, metal, 0, 0, -0.05);
    add(0.045, 0.04, 0.27, 0x8d949e, 0, 0.05, -0.06);
    add(0.05, 0.13, 0.07, 0x1b1d22, 0, -0.1, 0.05, 0.25);
    add(0.08, 0.09, 0.1, skin, 0, -0.1, 0.06);
    add(0.1, 0.1, 0.4, sleeve, 0, -0.16, 0.3, -0.1);
    tip = -0.2;
  } else {
    add(0.07, 0.09, 0.4, metal, 0, 0, 0.0);
    add(0.04, 0.04, 0.7, dark, 0, 0.02, -0.45);
    add(0.035, 0.035, 0.6, 0x3a3f47, 0, -0.03, -0.42);
    add(0.075, 0.065, 0.2, wood, 0, -0.04, -0.4);
    add(0.06, 0.1, 0.25, wood, 0, -0.03, 0.3);
    add(0.08, 0.07, 0.12, skin, 0, -0.06, -0.4);
    add(0.07, 0.09, 0.09, skin, 0, -0.1, 0.08);
    add(0.1, 0.1, 0.4, sleeve, 0, -0.16, 0.3, -0.1);
    tip = -0.82;
  }
  const fm = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Group();
  const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), fm);
  const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), fm);
  p2.rotation.y = Math.PI / 2;
  flash.add(p1, p2);
  flash.position.set(0, 0.015, tip);
  flash.visible = false;
  g.add(flash);
  g.userData.flash = flash;
  g.visible = false;
  return g;
}
const guns = [0, 1, 2].map(makeGun);
guns.forEach((g) => vmRoot.add(g));

function updateViewmodel(dt, speed) {
  const show = joined && alive && !menuOpen;
  vmRoot.visible = show;
  if (!show) return;
  guns.forEach((g, i) => { g.visible = i === selWeapon; });
  vm.kick *= Math.exp(-dt * 16);
  vm.bob += dt * speed * 1.5;
  vm.swap = Math.max(0, vm.swap - dt * 4.5);
  vm.rl += ((info.rl > 0 ? 1 : 0) - vm.rl) * Math.min(1, dt * 9);
  const k = Math.min(1, speed / 6);
  const bx = Math.sin(vm.bob) * 0.008 * k;
  const by = Math.abs(Math.cos(vm.bob)) * 0.009 * k;
  vmRoot.position.set(0.17 + bx, -0.17 + by - vm.rl * 0.17 - vm.swap * 0.3, -0.38 + vm.kick * 0.07);
  vmRoot.rotation.set(vm.kick * 0.09 + vm.rl * 0.35, 0, -vm.rl * 0.25);
  const fl = guns[selWeapon].userData.flash;
  vm.flash -= dt;
  fl.visible = vm.flash > 0;
  if (fl.visible) { fl.rotation.z = Math.random() * 6.28; const s = 0.8 + Math.random() * 0.6; fl.scale.set(s, s, s); }
}

// ---------- Трассеры и искры ----------
const tracers = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
  line.visible = false; line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIdx = 0;
const sparks = [];
for (let i = 0; i < 24; i++) {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  m.visible = false;
  scene.add(m);
  sparks.push({ m, life: 0 });
}
let sparkIdx = 0;

function spawnTracer(a, b) {
  const t = tracers[tracerIdx++ % tracers.length];
  const p = t.line.geometry.attributes.position;
  p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z);
  p.needsUpdate = true;
  t.life = 0.07; t.line.visible = true;
}
function spawnSpark(v, hit) {
  const s = sparks[sparkIdx++ % sparks.length];
  s.m.position.copy(v);
  s.m.material.color.setHex(hit ? 0xff4040 : 0xffd27a);
  s.life = 0.2; s.m.visible = true;
}
function updateFx(dt) {
  for (const t of tracers) {
    if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.visible = false; else t.line.material.opacity = Math.min(1, t.life / 0.07); }
  }
  for (const s of sparks) {
    if (s.life > 0) { s.life -= dt; if (s.life <= 0) s.m.visible = false; else s.m.scale.setScalar(s.life / 0.2 + 0.2); }
  }
}

// ---------- Звук ----------
let actx = null;
let noiseBuf = null;
function initAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    if (!noiseBuf) {
      noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
  } catch { /* звук недоступен */ }
}
function sink(pan) {
  if (!actx.createStereoPanner) return actx.destination;
  const p = actx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  p.connect(actx.destination);
  return p;
}
function playShot(w, vol = 1, pan = 0) {
  if (!actx || !noiseBuf) return;
  const t = actx.currentTime;
  const out = sink(pan);
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = w === 2 ? 1700 : w === 1 ? 2600 : 3300;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol * (w === 2 ? 0.9 : 0.55), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + (w === 2 ? 0.35 : 0.17));
  src.connect(lp); lp.connect(g); g.connect(out);
  src.start(t, Math.random() * 0.5); src.stop(t + 0.4);
  const o = actx.createOscillator();
  o.frequency.setValueAtTime(w === 2 ? 120 : 170, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  const og = actx.createGain();
  og.gain.setValueAtTime(vol * 0.5, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  o.connect(og); og.connect(out);
  o.start(t); o.stop(t + 0.2);
}
function beep(freq, dur = 0.06, vol = 0.18, type = 'square') {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function thud() {
  if (!actx || !noiseBuf) return;
  const t = actx.currentTime;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 400;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  src.connect(lp); lp.connect(g); g.connect(actx.destination);
  src.start(t); src.stop(t + 0.25);
}

// ---------- HUD ----------
const el = {
  s0: $('s0'), s1: $('s1'), timer: $('timer'), fps: $('fps'), ping: $('ping'),
  hpnum: $('hpnum'), hpfill: $('hpfill'), wname: $('wname'), ammo: $('ammo'), reload: $('reload'),
  prot: $('prot'), msg: $('msg'), hitm: $('hitm'), vig: $('dmgvig'), dir: $('dmgdir'),
  feed: $('killfeed'), sb: $('scoreboard'), crosshair: $('crosshair'),
};
let transientMsg = null;
let gap = 8;

function setMsg(main, sub) {
  el.msg.textContent = main || '';
  if (sub) { const s = document.createElement('small'); s.textContent = sub; el.msg.appendChild(s); }
}
function flashMsg(main, sub, ms = 2200) {
  transientMsg = { main, sub, until: performance.now() + ms };
  refreshMsg();
}
function refreshMsg() {
  if (matchState === 1) { setMsg('', ''); return; }
  if (joined && !alive) { setMsg('Вы убиты', `Возрождение через ${Math.max(1, info.resp)}`); return; }
  if (transientMsg && performance.now() < transientMsg.until) { setMsg(transientMsg.main, transientMsg.sub); return; }
  if (joined && alive && !isTouch && !locked && !menuOpen) { setMsg('Кликните по экрану', 'чтобы захватить мышь'); return; }
  setMsg('', '');
}

function updateHud() {
  const hp = clamp(info.hp, 0, 100);
  el.hpnum.textContent = hp;
  el.hpfill.style.width = hp + '%';
  el.hpfill.style.background = hp > 50 ? 'linear-gradient(90deg,#22c55e,#86efac)' : hp > 25 ? 'linear-gradient(90deg,#f59e0b,#fde68a)' : 'linear-gradient(90deg,#dc2626,#fca5a5)';
  updateAmmo();
  el.reload.classList.toggle('hidden', !(info.rl > 0));
  el.prot.classList.toggle('hidden', !info.prot);
}
function updateAmmo() {
  const w = S.WEAPONS[selWeapon];
  const a = info.wp?.[selWeapon] || [0, 0];
  el.wname.textContent = w.name;
  const res = a[1] >= 999 ? '∞' : a[1];
  el.ammo.innerHTML = '';
  el.ammo.append(String(a[0]));
  const sm = document.createElement('small');
  sm.textContent = ` / ${res}`;
  el.ammo.appendChild(sm);
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function addKill(d) {
  const k = roster.get(d.k), v = roster.get(d.v);
  const row = document.createElement('div');
  row.className = 'k' + (d.k === myId || d.v === myId ? ' me' : '');
  const a = document.createElement('span'); a.className = 'c' + (k?.team ?? 0); a.textContent = k?.name || '?';
  const mid = document.createElement('span'); mid.textContent = ` ${WEAPON_ICON[d.w] || '🔫'}${d.hs ? '🎯' : ''} `;
  const b = document.createElement('span'); b.className = 'c' + (v?.team ?? 1); b.textContent = v?.name || '?';
  row.append(a, mid, b);
  el.feed.appendChild(row);
  while (el.feed.children.length > 5) el.feed.firstChild.remove();
  setTimeout(() => row.remove(), 5000);
}

function buildScoreboard() {
  if (!lastSnap) return;
  el.sb.replaceChildren();
  for (const team of [0, 1]) {
    const rows = lastSnap.p.filter((r) => roster.get(r[0])?.team === team).sort((a, b) => b[8] - a[8] || a[9] - b[9]);
    const table = document.createElement('table');
    const head = document.createElement('tr');
    head.className = 'head' + team;
    for (const [i, t] of [`${S.TEAM_NAMES[team]} — ${lastSnap.sc[team]}`, 'У', 'С'].entries()) {
      const th = document.createElement('th'); th.textContent = t; if (i === 0) th.style.textAlign = 'left'; head.appendChild(th);
    }
    table.appendChild(head);
    for (const r of rows) {
      const pi = roster.get(r[0]);
      const tr = document.createElement('tr');
      tr.className = (r[0] === myId ? 'me ' : '') + (pi?.bot ? 'bot' : '');
      for (const t of [pi?.name || '?', r[8], r[9]]) { const td = document.createElement('td'); td.textContent = t; tr.appendChild(td); }
      table.appendChild(tr);
    }
    el.sb.appendChild(table);
  }
}
let sbTimer = 0;
let sbShown = false;
let sbPinned = false;
function syncScoreboard() {
  const want = sbPinned || !!keys.Tab || matchState === 1;
  if (want === sbShown) return;
  sbShown = want;
  el.sb.classList.toggle('hidden', !want);
  clearInterval(sbTimer);
  if (want) { buildScoreboard(); sbTimer = setInterval(buildScoreboard, 500); }
}

function setRoster(list) {
  roster.clear();
  for (const p of list) roster.set(p.id, p);
}

// ---------- Сеть ----------
function ensureSocket() {
  if (socket) return;
  socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });

  socket.on('connect', () => {
    $('status').textContent = '';
    if (wantJoin) doJoin();
  });
  socket.on('connect_error', () => { $('status').textContent = 'Нет соединения с сервером…'; });
  socket.on('disconnect', () => {
    if (joined) { joined = false; resetNetState(); openMenu(); $('status').textContent = 'Соединение потеряно, переподключаюсь…'; }
  });
  socket.on('denied', (d) => { wantJoin = false; $('status').textContent = d?.reason || 'Доступ закрыт'; $('playBtn').disabled = false; });

  socket.on('welcome', (d) => {
    myId = d.id; myTeam = d.team;
    setRoster(d.players);
    resetNetState();
    joined = true;
    $('playBtn').disabled = false;
    $('hud').classList.remove('hidden');
    $('touch').classList.remove('hidden');
    closeMenu();
    lockPointer();
    flashMsg(`Вы в команде «${S.TEAM_NAMES[myTeam]}»`, 'Удачи в бою!', 3000);
  });
  socket.on('roster', (d) => setRoster(d.players));

  socket.on('snap', onSnap);
  socket.on('shot', onShot);
  socket.on('hit', (d) => {
    el.hitm.classList.toggle('hs', !!d.hs);
    el.hitm.classList.add('on');
    setTimeout(() => el.hitm.classList.remove('on'), 90);
    beep(d.hs ? 1900 : 1250, 0.06, 0.2);
    if (d.k) setTimeout(() => beep(900, 0.09, 0.2), 90);
  });
  socket.on('hurt', (d) => {
    el.vig.classList.add('on');
    setTimeout(() => el.vig.classList.remove('on'), 60);
    const aw = Math.atan2(-(d.x - me.x), -(d.z - me.z));
    const rel = S.angDiff(aw, view.yaw);
    el.dir.style.transform = `rotate(${-rel}rad)`;
    el.dir.classList.add('on');
    setTimeout(() => el.dir.classList.remove('on'), 60);
    thud();
  });
  socket.on('kill', (d) => {
    addKill(d);
    if (d.k === myId) {
      const v = roster.get(d.v);
      flashMsg('', `Вы убили: ${v?.name || '?'}${d.hs ? ' 🎯' : ''}`, 1500);
    }
  });
  socket.on('over', (d) => showEnd(d));
  socket.on('start', () => { $('endscreen').classList.add('hidden'); matchState = 0; syncScoreboard(); flashMsg('Новый матч!', '', 2000); });

  setInterval(() => {
    if (!socket?.connected) return;
    const t0 = performance.now();
    socket.emit('p', () => { ping = Math.round(performance.now() - t0); });
  }, 2000);
}

function resetNetState() {
  buf.length = 0; pending.length = 0; lastSnap = null; clockInit = false;
  clearRemotes();
  alive = false;
}

function doJoin() {
  const name = ($('nameInput').value || '').trim().slice(0, 16);
  localStorage.setItem('af_name', name);
  socket.emit('join', { name, initData: tg?.initData || '' });
}

function onSnap(s) {
  const off = s.t - Date.now();
  if (!clockInit || Math.abs(off - clockOff) > 1000) { clockOff = off; clockInit = true; }
  else clockOff += (off - clockOff) * 0.05;

  s.m = new Map(s.p.map((r) => [r[0], r]));
  buf.push(s);
  if (buf.length > 40) buf.shift();
  lastSnap = s;
  matchState = s.st;

  const m = s.me;
  const wasAlive = alive;
  alive = !!m.alive;
  info = m;

  if (alive) {
    if (!wasAlive) {
      pending.length = 0;
      selWeapon = m.w;
      vm.swap = 1;
    }
    const px = me.x, pz = me.z;
    me.x = m.x; me.y = m.y; me.z = m.z; me.vx = m.vx; me.vy = m.vy; me.vz = m.vz; me.onGround = !!m.g;
    while (pending.length && pending[0].seq <= s.ack) pending.shift();
    for (const inp of pending) S.stepPlayer(me, inp);
    if (!wasAlive || Math.hypot(me.x - px, me.z - pz) > 3) { prev.x = me.x; prev.y = me.y; prev.z = me.z; }
  } else if (wasAlive) {
    deathAt = performance.now();
    pending.length = 0;
    input.fireHeld = false;
  }

  el.s0.textContent = s.sc[0];
  el.s1.textContent = s.sc[1];
  el.timer.textContent = fmtTime(s.rem);
  if (s.st === 1) updateEndCountdown(s);
  syncScoreboard();
  updateHud();
  refreshMsg();
}

function showEnd(d) {
  matchState = 1;
  const win = d.winner;
  const title = win === -1 ? 'НИЧЬЯ' : win === myTeam ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
  $('endTitle').textContent = title;
  $('endTitle').style.color = win === -1 ? '#fff' : win === myTeam ? '#4ade80' : '#f87171';
  $('endSub').textContent = `${S.TEAM_NAMES[0]} ${d.scores[0]} : ${d.scores[1]} ${S.TEAM_NAMES[1]}`;
  $('endscreen').classList.remove('hidden');
  syncScoreboard();
}
function updateEndCountdown(s) {
  $('endSub').textContent = `${S.TEAM_NAMES[0]} ${s.sc[0]} : ${s.sc[1]} ${S.TEAM_NAMES[1]} · новый матч через ${s.rem}`;
}

function onShot(d) {
  const o = new THREE.Vector3(d.o[0], d.o[1], d.o[2]);
  for (const e of d.e) {
    const end = new THREE.Vector3(e[0], e[1], e[2]);
    const dir = end.clone().sub(o);
    const len = dir.length();
    if (len < 0.01) continue;
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const start = o.clone().addScaledVector(dir, 0.8).addScaledVector(right, 0.14);
    start.y -= 0.18;
    spawnTracer(start, end);
    if (len < 149) spawnSpark(end, e[3]);
  }
  if (d.id !== myId && actx) {
    const dx = o.x - camera.position.x, dz = o.z - camera.position.z;
    const dist = Math.hypot(dx, dz);
    const vol = clamp(1 / (1 + dist / 10), 0.05, 1);
    const pan = dist > 0.1 ? (dx * Math.cos(view.yaw) - dz * Math.sin(view.yaw)) / dist : 0;
    playShot(d.w, vol, pan);
  }
}

// ---------- Ввод ----------
function readInput() {
  let mx = 0, mz = 0, jump = false;
  const active = joined && alive && !menuOpen;
  if (active) {
    if (isTouch) { mx = joy.x; mz = -joy.y; }
    mx += (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    mz += (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    jump = !!keys.Space || input.jumpBtn;
  }
  const fire = active && (input.fireHeld || input.fireLatch);
  const reload = active && input.reloadLatch;
  input.fireLatch = false;
  input.reloadLatch = false;
  return {
    seq: 0, mx: +clamp(mx, -1, 1).toFixed(3), mz: +clamp(mz, -1, 1).toFixed(3),
    yaw: view.yaw, pitch: view.pitch, jump, fire, reload, weapon: selWeapon, rt: Math.round(serverNow() - INTERP),
  };
}

function simStep() {
  prev.x = me.x; prev.y = me.y; prev.z = me.z;
  if (!joined || !alive) return;
  const inp = readInput();
  inp.seq = ++seq;
  S.stepPlayer(me, inp);
  pending.push(inp);
  if (pending.length > 90) pending.shift();
  socket.emit('input', inp);
}

function applyLook(dx, dy, mult) {
  view.yaw = S.wrapAngle(view.yaw - dx * mult * sens);
  view.pitch = clamp(view.pitch - dy * mult * sens, -1.5, 1.5);
}

function changeWeapon(i) {
  if (i === selWeapon || i < 0 || i >= S.WEAPONS.length) return;
  selWeapon = i;
  vm.swap = 1;
  localNextFire = performance.now() / 1000 + 0.35;
  updateAmmo();
}

// локальные эффекты выстрела (мгновенный отклик; урон считает сервер)
function localFireUpdate(nowS) {
  if (!joined || !alive || menuOpen) { input.localTap = false; return; }
  const w = S.WEAPONS[selWeapon];
  const want = (w.auto && input.fireHeld) || input.localTap;
  input.localTap = false;
  if (!want) return;
  const a = info.wp?.[selWeapon];
  if (!a || info.rl > 0 || nowS < localNextFire || matchState === 1) return;
  if (a[0] <= 0) { if (nowS > localNextFire) { beep(300, 0.04, 0.12); localNextFire = nowS + 0.25; } return; }
  a[0]--;
  localNextFire = nowS + w.rate;
  vm.kick = 1; vm.flash = 0.05;
  playShot(selWeapon, 1, 0);
  view.pitch = clamp(view.pitch + (selWeapon === 2 ? 0.05 : selWeapon === 1 ? 0.012 : 0.004), -1.5, 1.5);
  updateAmmo();
}

// клавиатура / мышь
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); syncScoreboard(); }
  if (e.code === 'KeyR' && !e.repeat) input.reloadLatch = true;
  if (e.code === 'Space') e.preventDefault();
  if (/^Digit[1-3]$/.test(e.code)) changeWeapon(+e.code.slice(5) - 1);
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') syncScoreboard();
});
window.addEventListener('blur', releaseInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseInputs(); });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (isTouch || !locked || e.button !== 0) return;
  input.fireHeld = true; input.fireLatch = true; input.localTap = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) input.fireHeld = false; });
window.addEventListener('mousemove', (e) => { if (locked && !menuOpen) applyLook(e.movementX, e.movementY, 0.0022); });
window.addEventListener('wheel', (e) => {
  if (!locked) return;
  changeWeapon((selWeapon + (e.deltaY > 0 ? 1 : S.WEAPONS.length - 1)) % S.WEAPONS.length);
});
canvas.addEventListener('click', () => { if (joined && !menuOpen && !isTouch && !locked) lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked && joined && !isTouch && !menuOpen) openMenu();
});
function lockPointer() {
  if (isTouch) return;
  try { const p = canvas.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* ignore */ }
}

// сенсорное управление
const joy = { id: null, cx: 0, cy: 0, x: 0, y: 0 };
const look = { id: null, x: 0, y: 0 };
const fireTouch = { id: null, x: 0, y: 0 };
const joyBase = $('joyBase'), joyKnob = $('joyKnob');
const JOY_R = 55;

function resetJoyVisual() {
  joyBase.style.left = ''; joyBase.style.top = ''; joyBase.style.bottom = '';
  joyKnob.style.transform = '';
}
$('zoneL').addEventListener('pointerdown', (e) => {
  if (menuOpen || joy.id !== null) return;
  joy.id = e.pointerId; joy.cx = e.clientX; joy.cy = e.clientY; joy.x = joy.y = 0;
  e.currentTarget.setPointerCapture(e.pointerId);
  joyBase.style.left = `${e.clientX - 60}px`; joyBase.style.top = `${e.clientY - 60}px`; joyBase.style.bottom = 'auto';
});
$('zoneL').addEventListener('pointermove', (e) => {
  if (e.pointerId !== joy.id) return;
  let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
  const l = Math.hypot(dx, dy);
  if (l > JOY_R) { dx *= JOY_R / l; dy *= JOY_R / l; }
  joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
  const nx = dx / JOY_R, ny = dy / JOY_R;
  joy.x = Math.abs(nx) < 0.1 ? 0 : nx;
  joy.y = Math.abs(ny) < 0.1 ? 0 : ny;
});
const endJoy = (e) => { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; resetJoyVisual(); };
$('zoneL').addEventListener('pointerup', endJoy);
$('zoneL').addEventListener('pointercancel', endJoy);

$('zoneR').addEventListener('pointerdown', (e) => {
  if (menuOpen || look.id !== null) return;
  look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY;
  e.currentTarget.setPointerCapture(e.pointerId);
});
$('zoneR').addEventListener('pointermove', (e) => {
  if (e.pointerId !== look.id) return;
  applyLook(e.clientX - look.x, e.clientY - look.y, 0.0045);
  look.x = e.clientX; look.y = e.clientY;
});
const endLook = (e) => { if (e.pointerId === look.id) look.id = null; };
$('zoneR').addEventListener('pointerup', endLook);
$('zoneR').addEventListener('pointercancel', endLook);

const bFire = $('bFire');
bFire.addEventListener('pointerdown', (e) => {
  if (menuOpen) return;
  e.preventDefault();
  fireTouch.id = e.pointerId; fireTouch.x = e.clientX; fireTouch.y = e.clientY;
  bFire.setPointerCapture(e.pointerId);
  input.fireHeld = true; input.fireLatch = true; input.localTap = true;
  bFire.classList.add('down');
});
bFire.addEventListener('pointermove', (e) => {
  if (e.pointerId !== fireTouch.id) return;
  applyLook(e.clientX - fireTouch.x, e.clientY - fireTouch.y, 0.0045);
  fireTouch.x = e.clientX; fireTouch.y = e.clientY;
});
const endFire = (e) => { if (e.pointerId !== fireTouch.id) return; fireTouch.id = null; input.fireHeld = false; bFire.classList.remove('down'); };
bFire.addEventListener('pointerup', endFire);
bFire.addEventListener('pointercancel', endFire);

function hold(btn, on, off) {
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); btn.classList.add('down'); on(); });
  const up = () => { btn.classList.remove('down'); off?.(); };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
}
hold($('bJump'), () => { input.jumpBtn = true; }, () => { input.jumpBtn = false; });
hold($('bReload'), () => { input.reloadLatch = true; });
hold($('bWeapon'), () => changeWeapon((selWeapon + 1) % S.WEAPONS.length));
hold($('bScore'), () => { sbPinned = !sbPinned; syncScoreboard(); });
hold($('bMenu'), () => openMenu());

document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

function releaseInputs() {
  for (const k of Object.keys(keys)) keys[k] = false;
  input.fireHeld = false; input.fireLatch = false; input.jumpBtn = false; input.localTap = false;
  joy.id = null; joy.x = joy.y = 0; look.id = null; fireTouch.id = null;
  resetJoyVisual();
}

// ---------- Меню ----------
function openMenu() {
  menuOpen = true;
  $('menu').classList.remove('hidden');
  $('playBtn').textContent = joined ? 'ПРОДОЛЖИТЬ' : 'В БОЙ';
  releaseInputs();
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeMenu() {
  menuOpen = false;
  $('menu').classList.add('hidden');
}

$('nameInput').value = localStorage.getItem('af_name') || tg?.initDataUnsafe?.user?.first_name || '';
$('sens').value = String(sens);
$('sens').addEventListener('input', (e) => { sens = parseFloat(e.target.value) || 1; localStorage.setItem('af_sens', String(sens)); });
$('nameInput').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('playBtn').click(); });

let fsRequested = false;
$('playBtn').addEventListener('click', () => {
  initAudio();
  if (!fsRequested) { fsRequested = true; try { tg?.requestFullscreen?.(); } catch { /* ignore */ } }
  if (joined) { closeMenu(); lockPointer(); return; }
  wantJoin = true;
  $('playBtn').disabled = true;
  $('status').textContent = 'Подключение…';
  ensureSocket();
  if (socket.connected) doJoin();
});

// ---------- Камера и цикл ----------
let bobT = 0;
function updateCamera(dt) {
  if (!joined) {
    const t = performance.now() / 1000 * 0.12;
    camera.position.set(Math.cos(t) * 36, 14, Math.sin(t) * 26);
    camera.lookAt(0, 2, 0);
    return 0;
  }
  const a = acc / S.DT;
  const px = prev.x + (me.x - prev.x) * a;
  const py = prev.y + (me.y - prev.y) * a;
  const pz = prev.z + (me.z - prev.z) * a;
  const speed = Math.hypot(me.vx, me.vz);
  if (alive) {
    bobT += dt * speed * 1.5;
    const bob = me.onGround ? Math.sin(bobT * 2) * 0.025 * Math.min(1, speed / 6) : 0;
    camera.position.set(px, py + S.PLAYER.eye + bob, pz);
    camera.rotation.set(view.pitch, view.yaw, 0);
  } else {
    const k = Math.min(1, (performance.now() - deathAt) / 600);
    camera.position.set(px, py + S.PLAYER.eye * (1 - k) + 0.25 * k, pz);
    camera.rotation.set(view.pitch * (1 - k * 0.5), view.yaw, k * 0.7);
  }
  return speed;
}

let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsT = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;

  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    el.fps.textContent = Math.round(fpsN / fpsAcc);
    el.ping.textContent = ping;
    fpsAcc = 0; fpsN = 0; fpsT = 0;
    refreshMsg();
  }

  acc += dt;
  let steps = 0;
  while (acc >= S.DT && steps < 5) { simStep(); acc -= S.DT; steps++; }
  if (steps >= 5) acc = 0;

  localFireUpdate(nowMs / 1000);
  updateRemotes(dt);
  const speed = updateCamera(dt);
  updateViewmodel(dt, speed);
  updateFx(dt);

  // прицел «дышит» от движения и стрельбы
  const g = 6 + speed * 1.3 + vm.kick * 8 + (me.onGround ? 0 : 6);
  gap += (g - gap) * Math.min(1, dt * 14);
  el.crosshair.style.setProperty('--g', gap.toFixed(1) + 'px');
  el.crosshair.style.display = joined && alive ? '' : 'none';
  el.prot.classList.toggle('hidden', !(info.prot && alive));

  renderer.clear();
  renderer.render(scene, camera);
  if (vmRoot.visible) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCam);
  }
}
requestAnimationFrame(frame);

// для отладки из консоли
window.__arena = {
  me, view, remotes, buf, roster,
  get joined() { return joined; },
  get alive() { return alive; },
  get info() { return info; },
  get pending() { return pending.length; },
  get weapon() { return selWeapon; },
};
