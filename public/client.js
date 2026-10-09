// Arena Fire — клиент: Three.js рендер, управление (тач + ПК), предсказание движения, интерполяция, HUD, звук.
import * as THREE from 'three';
import * as S from './shared.js';
import { makePlayerModel, buildViewmodel, animateViewmodel } from './models.js';
import { buildWorldMesh } from './world.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { ITEM_BY_ID } from './catalog.js';

const $ = (id) => document.getElementById(id);
const clamp = S.clamp;
// Платформа: телефон (тач, авто-огонь и помощь прицела) или ПК (мышь и клавиатура, без помощников). Можно переопределить в настройках.
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* память устройства недоступна */ } };
const platform = ['pc', 'mobile'].includes(lsGet('af_platform')) ? lsGet('af_platform') : (matchMedia('(pointer: coarse)').matches ? 'mobile' : 'pc');
const isTouch = platform === 'mobile';
document.body.classList.toggle('touch-ui', isTouch);

// Параметры запуска из лобби: ?mode=quick|create|room|code&skill=&room=&code=&rn=&priv=
const Q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
let accountDone = false;
let account = null; // профиль вошедшего игрока (null — гость)
const accountReady = (typeof fetch === 'function' ? fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => { account = d && d.user ? d.user : null; }) : Promise.resolve()).catch(() => {}).then(() => { accountDone = true; });
const modeGoal = (id, n) => ({ tdm: 'Первые до 40 убийств', hs: 'Голова убивает сразу', ffa: 'До 20 убийств', gg: `Пройдите все ${n} оружий`, hill: 'Держите зону: очки идут за секунды' }[id] || '');
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Набор оружия (основное, тяжёлое, пистолет) хранится на устройстве; сервер всё равно проверяет его сам.
const readLoadout = () => { try { return S.cleanLoadout(JSON.parse(lsGet('af_loadout'))); } catch { return S.DEFAULT_LOADOUT.slice(); } };
let loadout = readLoadout();
const PLAT_MARK = { m: ' 📱', p: ' 🖥' };
const dispName = (pi) => (pi ? (pi.tag ? `[${pi.tag}] ${pi.name}` : pi.name) + (PLAT_MARK[pi.pl] || '') : '?');

const INTERP = 100; // мс задержки интерполяции чужих игроков

// ---------- Состояние ----------
let socket = null;
let joined = false;
let wantJoin = false;
let myId = 0;
let myTeam = 0;
let modeName = 'Командный бой';
let modeId = 'tdm', teamsMode = true, modeLim = 40, ggN = S.GG_ORDER.length, gunMode = false, hillMode = false;
let hillGroup = null, hillState = null, hillMats = [];
let joinPrefs = null; // что именно просим у сервера: быстрый бой, комнату, код...
const isEnemy = (team) => !teamsMode || team !== myTeam; // в режимах «каждый сам за себя» врагов нет своих
const roster = new Map();

const view = { yaw: 0, pitch: 0 };
const me = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true };
const prev = { x: 0, y: 0, z: 0 };
let alive = false;
let deathAt = 0;
let info = { hp: 100, w: 0, wp: S.WEAPONS.map((w) => [w.mag, w.reserve]), rl: 0, resp: 0, prot: 0, bl: 0, ads: 0 };
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

const input = { fireHeld: false, fireLatch: false, localTap: false, reloadLatch: false, jumpBtn: false, ads: false };
const keys = {};
let locked = false;
let sens = parseFloat(localStorage.getItem('af_sens') || '1') || 1;

const serverNow = () => Date.now() + clockOff;

// ---------- Рендер ----------
const canvas = $('c');
const QUALITY = { low: 1, mid: 1.5, high: 2 };
const quality = QUALITY[lsGet('af_quality')] ? lsGet('af_quality') : (isTouch ? 'mid' : 'high');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[quality]));
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

// Запасной вид арены (простые коробки) показывается, пока грузится набор деталей Kenney; если набор не загрузился, так и остаётся.
const plainWorld = new THREE.Group();
async function loadKitWorld() {
  if (typeof fetch !== 'function') return;
  const kit = await (await fetch('/world/kit.json')).json();
  const w = buildWorldMesh(kit, S.BOXES, S.MAP);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(w.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(w.normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(w.colors, 3));
  g.setIndex(w.indices);
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.frustumCulled = false;
  scene.remove(plainWorld);
  scene.add(mesh);
}

function buildWorld() {
  scene.add(plainWorld);
  for (const b of S.BOXES) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    const m = new THREE.Mesh(g, boxMat(b.c));
    m.position.set(b.x, b.y + b.h / 2, b.z);
    plainWorld.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat);
    e.position.copy(m.position);
    plainWorld.add(e);
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
  plainWorld.add(floor);

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
loadKitWorld().catch((e) => console.warn('набор деталей арены не загрузился, остаётся простой вид', e));

// ---------- Модели игроков ----------
const remotes = new Map();
const fx = createFx(scene);
const audio = createAudio();
const camPos = { x: 0, y: 0, z: 0 }; // позиция камеры обычными числами
fx.onCasingBounce = (x, z) => {
  const d = Math.hypot(x - camPos.x, z - camPos.z);
  if (d < 12) audio.casing(earPan(x, z), d);
};

// базис взгляда (как на сервере)
function basis() {
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  return { fx: -sy * cp, fy: sp, fz: -cy * cp, rx: cy, rz: -sy, ux: sy * sp, uy: cp, uz: cy * sp };
}
function earPan(x, z) {
  const dx = x - camPos.x, dz = z - camPos.z;
  const d = Math.hypot(dx, dz);
  return d > 0.2 ? clamp((dx * Math.cos(view.yaw) - dz * Math.sin(view.yaw)) / d, -1, 1) : 0;
}

function makeRemote(pi) {
  const vteam = teamsMode ? pi.team : 1; // без команд все соперники выглядят одинаково
  const m = makePlayerModel(vteam, pi.name, pi.eq, pi.tag, pi.pl);
  scene.add(m.root);
  return { m, model: m.root, tag: m.tag, team: pi.team, wasAlive: true, deadAt: 0, lx: 0, lz: 0, stepN: 0 };
}

function updateRemoteModel(r, x, y, z, yaw, pitch, alv, weapon, dt, nowS) {
  const m = r.m, root = r.model;
  const spd = Math.min(9, Math.hypot(x - r.lx, z - r.lz) / Math.max(dt, 0.001));
  r.lx = x; r.lz = z;
  root.position.set(x, y, z);
  root.rotation.y = yaw;
  if (alv) {
    if (!r.wasAlive) { r.wasAlive = true; m.revive(); }
    root.visible = true;
    m.setWeapon(clamp(weapon | 0, 0, S.WEAPONS.length - 1));
    m.update(dt, spd, pitch, nowS);
    r.tag.visible = teamsMode && r.team === myTeam;
    if (spd > 2) {
      const n = Math.floor(m.phase / Math.PI);
      if (n !== r.stepN) {
        r.stepN = n;
        const dist = Math.hypot(x - camPos.x, z - camPos.z);
        if (dist < 22) audio.step(0.22, earPan(x, z), dist);
      }
    }
  } else {
    if (r.wasAlive) { r.wasAlive = false; r.deadAt = performance.now(); }
    const age = (performance.now() - r.deadAt) / 1000;
    m.setDead(age);
    root.visible = age < 3.2;
    r.tag.visible = false;
  }
}

function updateRemotes(dt) {
  if (!buf.length) return;
  const nowS = performance.now() / 1000;
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
    updateRemoteModel(r, x, y, z, yaw, pitch, ra[6], ra[7], dt, nowS);
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
const vm = { kick: 0, bob: 0, swap: 0, flash: 0, cyc: -1, cycDur: 0.1, ads: 0, swx: 0, swy: 0, roll: 0, rlStart: 0, rlDur: 1, lookX: 0, lookY: 0 };
let vmViews = [];
let vmShown = false;
const sleeveColor = (team) => (team === 0 ? 0x2a4f8a : 0x8e3029);

function buildViewmodels() {
  for (const v of vmViews) if (v) vmScene.remove(v.group);
  const need = new Set(gunMode ? S.GG_ORDER : loadout);
  vmViews = S.WEAPONS.map((_, i) => {
    if (!need.has(i)) return null;
    const v = buildViewmodel(i, sleeveColor(teamsMode ? myTeam : 0), roster.get(myId)?.eq?.gun);
    v.group.visible = false;
    vmScene.add(v.group);
    return v;
  });
}

function reloadProgress() {
  if (!(info.rl > 0)) return -1;
  return clamp((performance.now() - vm.rlStart) / vm.rlDur, 0, 1);
}

function updateViewmodel(dt, speed) {
  const scoped = scopeOn();
  vmShown = joined && alive && !menuOpen && !scoped && !!vmViews[selWeapon];
  if (!vmViews.length) return;
  vmViews.forEach((v, i) => { if (v) v.group.visible = vmShown && i === selWeapon; });
  vm.kick *= Math.exp(-dt * 13);
  vm.bob += dt * speed * 1.5;
  vm.swap = Math.max(0, vm.swap - dt * 4);
  vm.flash -= dt;
  vm.ads = adsAmt;
  const tx = clamp(-vm.lookX * 0.45, -0.035, 0.035), ty = clamp(vm.lookY * 0.45, -0.03, 0.03);
  vm.lookX = vm.lookY = 0;
  vm.swx += (tx - vm.swx) * Math.min(1, dt * 10);
  vm.swy += (ty - vm.swy) * Math.min(1, dt * 10);
  if (vm.cyc !== -1) {
    vm.cyc += dt / vm.cycDur;
    if (vm.cyc > 1) vm.cyc = -1;
  }
  if (!vmShown || !vmViews[selWeapon]) return;
  animateViewmodel(vmViews[selWeapon], {
    kick: vm.kick, ads: adsAmt, rl: reloadProgress(), swap: vm.swap, bob: vm.bob, k: Math.min(1, speed / 6),
    swx: vm.swx, swy: vm.swy, cyc: vm.cyc, flash: vm.flash, roll: vm.roll,
  });
}

// ---------- Прицеливание, отдача, тряска ----------
const BASE_FOV = 72;
const SHAKE = [0.0030, 0.0022, 0.0090, 0.0020, 0.0130, 0.0026, 0.0045, 0.0065, 0.0085, 0.0085];
let adsAmt = 0;
let curFov = BASE_FOV;
let shakeAmp = 0;
let localBloom = 0;
const recoil = { acc: 0, t: 0 };
let killStreak = 0;
let multi = { n: 0, t: 0 };
let stepDist = 0;
let wasGround = true;
let lastVy = 0;

const scopeOn = () => joined && alive && !menuOpen && selWeapon === 4 && adsAmt > 0.88;

// ---------- HUD ----------
const el = {
  s0: $('s0'), s1: $('s1'), timer: $('timer'), fps: $('fps'), ping: $('ping'),
  hpnum: $('hpnum'), hpfill: $('hpfill'), wname: $('wname'), ammo: $('ammo'), reload: $('reload'),
  prot: $('prot'), msg: $('msg'), hitm: $('hitm'), vig: $('dmgvig'), dir: $('dmgdir'),
  feed: $('killfeed'), sb: $('scoreboard'), crosshair: $('crosshair'),
  scope: $('scope'), nums: $('dmgnums'), streak: $('streak'),
  wb: [0, 1, 2].map((i) => $('wb' + i)),
  wn: [0, 1, 2].map((i) => $('wb' + i).querySelector('.wn')),
  wa: [0, 1, 2].map((i) => $('wb' + i).querySelector('.wa')),
  pips: $('pips'), rlfill: $('rlfill'), radar: $('radar'),
  hill: $('hillbar'), hillState: $('hillState'), hillTimer: $('hillTimer'), hillFill: $('hillFill'),
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
  updateWbar();
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
  updatePips(a[0], w.mag);
}
// Полоски патронов: пересоздаём при смене оружия, а при стрельбе только гасим лишние.
let pipsFor = -1, pipEls = [], pipMag = -1;
function updatePips(mag, cap) {
  if (pipsFor !== selWeapon) {
    pipsFor = selWeapon; pipMag = -1; pipEls = [];
    el.pips.innerHTML = '';
    el.pips.classList.toggle('many', cap > 40);
    el.pips.style.width = `${Math.min(150, cap * 7)}px`;
    for (let k = 0; k < cap; k++) { const i = document.createElement('i'); el.pips.appendChild(i); pipEls.push(i); }
  }
  if (pipMag === mag) return;
  pipMag = mag;
  for (let k = 0; k < pipEls.length; k++) pipEls[k].classList.toggle('off', k >= mag);
}
// Три слота набора: подписи ставим при входе в бой, патроны обновляем на лету.
function buildWbar() {
  for (let s = 0; s < 3; s++) {
    el.wn[s].textContent = S.WEAPONS[loadout[s]].name;
    el.wb[s].classList.toggle('hidden', gunMode);
  }
}
function updateWbar() {
  for (let s = 0; s < 3; s++) {
    const wi = loadout[s];
    const a = info.wp?.[wi];
    el.wb[s].classList.toggle('on', wi === selWeapon);
    el.wb[s].classList.toggle('empty', !!a && a[0] <= 0 && a[1] <= 0);
    if (a) el.wa[s].textContent = a[1] >= 999 ? `${a[0]} / ∞` : `${a[0]} / ${a[1]}`;
  }
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function addKill(d) {
  const k = roster.get(d.k), v = roster.get(d.v);
  const row = document.createElement('div');
  row.className = 'k' + (d.k === myId || d.v === myId ? ' me' : '');
  const a = document.createElement('span'); a.className = 'c' + (k?.team ?? 0); a.textContent = dispName(k);
  const mid = document.createElement('span');
  mid.textContent = ` [${S.WEAPONS[d.w]?.short || '?'}${d.hs ? ' 🎯' : ''}${d.d >= 5 ? ' ' + d.d + 'м' : ''}] `;
  const b = document.createElement('span'); b.className = 'c' + (v?.team ?? 1); b.textContent = dispName(v);
  row.append(a, mid, b);
  el.feed.appendChild(row);
  while (el.feed.children.length > 5) el.feed.firstChild.remove();
  setTimeout(() => row.remove(), 5000);
}

function showDamage(d) {
  if (!d.d) return;
  const n = document.createElement('div');
  n.className = 'n' + (d.k ? ' k' : d.hs ? ' hs' : d.z === 0 ? ' lg' : '');
  n.textContent = String(d.d);
  n.style.setProperty('--dx', `${Math.round((Math.random() - 0.3) * 60)}px`);
  n.style.left = `${Math.round((Math.random() - 0.5) * 30 + 14)}px`;
  n.style.top = `${Math.round(-30 - Math.random() * 16)}px`;
  el.nums.appendChild(n);
  while (el.nums.children.length > 8) el.nums.firstChild.remove();
  setTimeout(() => n.remove(), 800);
}
let streakTimer = 0;
function banner(text) {
  el.streak.textContent = text;
  el.streak.classList.remove('on');
  void el.streak.offsetWidth;
  el.streak.classList.add('on');
  clearTimeout(streakTimer);
  streakTimer = setTimeout(() => el.streak.classList.remove('on'), 1700);
}
const MULTI = ['', '', 'ДВОЙНОЕ УБИЙСТВО', 'ТРОЙНОЕ УБИЙСТВО', 'КВАДРО-УБИЙСТВО', 'РЕЗНЯ'];
function onMyKill(d) {
  const now = performance.now();
  killStreak++;
  multi.n = now - multi.t < 4000 ? multi.n + 1 : 1;
  multi.t = now;
  audio.kill(killStreak);
  const v = roster.get(d.v);
  if (multi.n >= 2) { banner(MULTI[Math.min(5, multi.n)]); audio.streak(multi.n); }
  else if (killStreak === 5 || killStreak === 10 || killStreak === 15) { banner(`СЕРИЯ ×${killStreak}`); audio.streak(4); }
  else if (d.hs) banner('В ГОЛОВУ!');
  flashMsg('', `Вы убили: ${dispName(v)}${d.d >= 5 ? ` · ${d.d} м` : ''}`, 1500);
}

function buildScoreboard() {
  if (!lastSnap) return;
  el.sb.replaceChildren();
  const groups = teamsMode ? [0, 1] : [-1];
  for (const team of groups) {
    const rows = lastSnap.p.filter((r) => team < 0 || roster.get(r[0])?.team === team)
      .sort((a, b) => (gunMode ? (b[10] || 0) - (a[10] || 0) : 0) || b[8] - a[8] || a[9] - b[9]);
    const table = document.createElement('table');
    const head = document.createElement('tr');
    head.className = 'head' + (team < 0 ? 0 : team);
    const cols = team < 0 ? [modeName, gunMode ? 'Этап' : 'У', 'С'] : [`${S.TEAM_NAMES[team]} — ${lastSnap.sc[team]}`, 'У', 'С'];
    for (const [i, t] of cols.entries()) {
      const th = document.createElement('th'); th.textContent = t; if (i === 0) th.style.textAlign = 'left'; head.appendChild(th);
    }
    table.appendChild(head);
    for (const r of rows) {
      const pi = roster.get(r[0]);
      const tr = document.createElement('tr');
      tr.className = (r[0] === myId ? 'me ' : '') + (pi?.bot ? 'bot' : '');
      for (const t of [dispName(pi), gunMode ? `${(r[10] || 0) + 1}/${ggN}` : r[8], r[9]]) { const td = document.createElement('td'); td.textContent = t; tr.appendChild(td); }
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
  socket.on('denied', (d) => {
    wantJoin = false; $('status').textContent = d?.reason || 'Доступ закрыт'; $('playBtn').disabled = false; joinBusy = false; refreshMenu();
    if (d?.login) $('loginLink').classList.remove('hidden');
  });
  socket.on('reward', (d) => showReward(d));
  socket.on('ggup', (d) => { flashMsg(`Этап ${d.gg + 1} из ${ggN}`, `Новое оружие: ${(S.WEAPONS[d.w] || {}).name || ''}`, 1800); });

  socket.on('welcome', (d) => {
    myId = d.id; myTeam = d.team;
    modeId = d.mode || 'tdm'; modeName = d.modeName || 'Командный бой'; teamsMode = d.teams !== 0; modeLim = d.lim || 0; ggN = d.ggN || S.GG_ORDER.length; gunMode = modeId === 'gg'; hillMode = !!d.hill;
    $('wbar').classList.toggle('hidden', gunMode);
    document.body.classList.toggle('solo', !teamsMode);
    el.hill.classList.toggle('hidden', !hillMode);
    hillState = null; if (hillGroup) hillGroup.visible = false;
    buildWbar();
    $('modeTag').textContent = modeName;
    setRoster(d.players);
    resetNetState();
    joined = true;
    buildViewmodels();
    killStreak = 0; multi = { n: 0, t: 0 };
    joinBusy = false; lastWelcome = d; $('status').textContent = '';
    $('playBtn').disabled = false;
    $('hud').classList.remove('hidden');
    $('touch').classList.remove('hidden');
    closeMenu();
    lockPointer();
    flashMsg(teamsMode ? `Вы в команде «${S.TEAM_NAMES[myTeam]}»` : modeName, `${modeGoal(modeId, ggN)} · боты: ${d.skillName || 'Лёгкие'}`, 3200);
  });
  socket.on('roster', (d) => setRoster(d.players));

  socket.on('snap', onSnap);
  socket.on('shot', onShot);
  socket.on('hit', (d) => {
    el.hitm.classList.toggle('hs', !!d.hs);
    el.hitm.classList.toggle('lg', d.z === 0);
    el.hitm.classList.add('on');
    setTimeout(() => el.hitm.classList.remove('on'), 90);
    audio.hit(d.z ?? (d.hs ? 2 : 1));
    showDamage(d);
  });
  socket.on('hurt', (d) => {
    el.vig.classList.add('on');
    setTimeout(() => el.vig.classList.remove('on'), 60);
    const aw = Math.atan2(-(d.x - me.x), -(d.z - me.z));
    const rel = S.angDiff(aw, view.yaw);
    el.dir.style.transform = `rotate(${-rel}rad)`;
    el.dir.classList.add('on');
    setTimeout(() => el.dir.classList.remove('on'), 60);
    audio.hurt();
    shakeAmp = Math.max(shakeAmp, 0.012);
  });
  socket.on('kill', (d) => {
    addKill(d);
    const vr = remotes.get(d.v);
    if (vr) fx.death(vr.model.position.x, vr.model.position.y, vr.model.position.z);
    if (d.v === myId) { killStreak = 0; multi = { n: 0, t: 0 }; }
    if (d.k === myId) onMyKill(d);
  });
  socket.on('over', (d) => showEnd(d));
  socket.on('start', () => { $('endscreen').classList.add('hidden'); $('endReward').textContent = ''; matchState = 0; syncScoreboard(); flashMsg('Новый матч!', '', 2000); });

  setInterval(() => {
    if (!socket?.connected) return;
    const t0 = performance.now();
    socket.emit('p', () => { ping = Math.round(performance.now() - t0); });
  }, 2000);
}

function resetNetState() {
  buf.length = 0; pending.length = 0; lastSnap = null; clockInit = false;
  clearRemotes();
  fx.clear();
  alive = false;
}

async function doJoin() {
  if (!accountDone) await accountReady;
  const name = ($('nameInput').value || '').trim().slice(0, 16);
  if (!account) lsSet('af_name', name);
  const jp = joinPrefs || { mode: 'quick', skill: pick.skill, gm: pick.gm };
  socket.emit('join', {
    mode: ['quick', 'create', 'room', 'code'].includes(jp.mode) ? jp.mode : 'quick', skill: jp.skill | 0, roomId: jp.roomId | 0, code: jp.code || '',
    roomName: jp.roomName || '', priv: !!jp.priv, gm: MODE_LIST.includes(jp.gm) ? jp.gm : 'tdm', guest: !account, name, touch: isTouch, loadout,
  });
}

// Награда за матч приходит от сервера чуть позже итогов.
let lastReward = null;
function rewardText(d) { return `+${d.xp} опыта · +${d.coins} монет${d.levelUp ? ` · НОВЫЙ УРОВЕНЬ ${d.level}!` : ''}`; }
function showReward(d) {
  lastReward = d;
  $('endReward').textContent = rewardText(d);
  if (d.levelUp) flashMsg('НОВЫЙ УРОВЕНЬ', `Теперь у вас ${d.level} уровень`, 3500);
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
  const prevRl = info.rl || 0;
  alive = !!m.alive;
  info = m;
  if (alive && m.rl > 0 && !(prevRl > 0)) {
    const wr = S.WEAPONS[m.w] || S.WEAPONS[0];
    vm.rlDur = wr.reload * 1000;
    vm.rlStart = performance.now() - (wr.reload - m.rl) * 1000;
    audio.reload(m.w, m.rl);
  }

  if (alive) {
    if (!wasAlive) {
      pending.length = 0;
      selWeapon = m.w;
      vm.swap = 1;
      adsAmt = 0; input.ads = false; localBloom = 0; recoil.acc = 0;
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
    input.ads = false;
    shakeAmp = Math.max(shakeAmp, 0.02);
    audio.die();
  }

  if (teamsMode) { el.s0.textContent = s.sc[0]; el.s1.textContent = s.sc[1]; }
  else { // свои очки против лучшего соперника
    let mine = 0, best = 0;
    for (const r of s.p) { const v = gunMode ? (r[10] || 0) : r[8]; if (r[0] === myId) mine = v; else if (v > best) best = v; }
    el.s0.textContent = gunMode ? `${mine + 1}/${ggN}` : mine; el.s1.textContent = gunMode ? `${best + 1}/${ggN}` : best;
  }
  if (s.hl) applyHill(s.hl);
  if (gunMode && alive && m.w !== selWeapon) { selWeapon = m.w; vm.swap = 1; vm.cyc = -1; input.ads = false; localBloom = 0; audio.swap(); updateAmmo(); }
  el.timer.textContent = fmtTime(s.rem);
  if (s.st === 1) updateEndCountdown(s);
  syncScoreboard();
  updateHud();
  refreshMsg();
}

function showEnd(d) {
  matchState = 1;
  const draw = teamsMode ? d.winner === -1 : !d.winId;
  const won = teamsMode ? d.winner === myTeam : d.winId === myId;
  $('endTitle').textContent = draw ? 'НИЧЬЯ' : won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
  $('endTitle').style.color = draw ? '#fff' : won ? '#4ade80' : '#f87171';
  $('endSub').textContent = teamsMode ? `${S.TEAM_NAMES[0]} ${d.scores[0]} : ${d.scores[1]} ${S.TEAM_NAMES[1]}` : (roster.get(d.winId) ? `Победитель: ${dispName(roster.get(d.winId))}` : modeName);
  $('endReward').textContent = account ? 'Начисляем награду…' : 'Войдите в аккаунт, чтобы копить опыт и монеты';
  $('endscreen').classList.remove('hidden');
  syncScoreboard();
}
function updateEndCountdown(s) {
  $('endSub').textContent = (teamsMode ? `${S.TEAM_NAMES[0]} ${s.sc[0]} : ${s.sc[1]} ${S.TEAM_NAMES[1]}` : (roster.get(s.wid) ? `Победитель: ${dispName(roster.get(s.wid))}` : modeName)) + ` · новый матч через ${s.rem}`;
}

function onShot(d) {
  const w = S.WEAPONS[d.w] || S.WEAPONS[0];
  const own = d.id === myId;
  if (!own) radarSeen.set(d.id, performance.now() + 1800); // стрелявший на миг виден на радаре
  const ox = d.o[0], oy = d.o[1], oz = d.o[2];
  const b = basis();
  let whizD = 99, whizSide = 0;
  const tracerColor = ITEM_BY_ID[roster.get(d.id)?.eq?.tracer]?.color ?? 0xffe3a0;
  for (const e of d.e) {
    let dx = e[0] - ox, dy = e[1] - oy, dz = e[2] - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) continue;
    dx /= len; dy /= len; dz /= len;
    let sx, sy, sz;
    if (own) {
      const k = 1 - adsAmt;
      sx = camPos.x + b.fx * 0.9 + b.rx * 0.15 * k + b.ux * -0.12 * k;
      sy = camPos.y + b.fy * 0.9 + b.uy * -0.12 * k;
      sz = camPos.z + b.fz * 0.9 + b.rz * 0.15 * k + b.uz * -0.12 * k;
    } else {
      // примерно у дула модели противника
      const rx = -dz, rz = dx, rl = Math.hypot(rx, rz) || 1;
      sx = ox + dx * 0.9 + (rx / rl) * 0.18; sy = oy - 0.27 + dy * 0.9; sz = oz + dz * 0.9 + (rz / rl) * 0.18;
    }
    fx.tracer({ x: sx, y: sy, z: sz }, { x: e[0], y: e[1], z: e[2] }, 300, tracerColor);
    if (len < w.range - 1) {
      if (e[3]) fx.blood(e[0], e[1], e[2], dx, dy, dz, e[4] === 2);
      else fx.impact(e[0], e[1], e[2], dx, dy, dz, d.w === 4 ? 1.6 : d.w === 2 ? 0.8 : 1);
    }
    if (!own) { // близкий пролёт пули
      const t = clamp((camPos.x - ox) * dx + (camPos.y - oy) * dy + (camPos.z - oz) * dz, 0, len);
      const qx = ox + dx * t - camPos.x, qy = oy + dy * t - camPos.y, qz = oz + dz * t - camPos.z;
      const dist = Math.hypot(qx, qy, qz);
      if (dist < whizD) { whizD = dist; whizSide = qx * b.rx + qz * b.rz; }
    }
  }
  if (!own) {
    const r = remotes.get(d.id);
    r?.m.fire();
    const dist = Math.hypot(ox - camPos.x, oy - camPos.y, oz - camPos.z);
    const vol = clamp(1 / (1 + dist / 12), 0.06, 1);
    audio.shot(d.w, vol, earPan(ox, oz), dist);
    if (whizD < 2.8) audio.whiz(clamp(whizSide, -1, 1), (1 - whizD / 2.8) * 0.8);
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
    yaw: view.yaw, pitch: view.pitch, jump, fire, reload, weapon: selWeapon, ads: !!(active && input.ads), rt: Math.round(serverNow() - INTERP),
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
  const z = Math.max(0.25, curFov / BASE_FOV); // в прицеле чувствительность ниже
  view.yaw = S.wrapAngle(view.yaw - dx * mult * sens * z);
  view.pitch = clamp(view.pitch - dy * mult * sens * z, -1.5, 1.5);
  vm.lookX += dx * mult * z; vm.lookY += dy * mult * z;
}

function changeWeapon(i) {
  if (gunMode || i === selWeapon || !loadout.includes(i) || !joined || !alive) return;
  selWeapon = i;
  vm.swap = 1; vm.cyc = -1;
  input.ads = false;
  localBloom = 0;
  localNextFire = performance.now() / 1000 + 0.35;
  audio.swap();
  updateAmmo();
  updateWbar();
}

function setAds(on) {
  if (!!on === input.ads) return;
  input.ads = !!on;
  if (on) audio.ads();
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
  if (a[0] <= 0) { if (nowS > localNextFire) { audio.empty(); localNextFire = nowS + 0.25; } return; }
  a[0]--;
  localNextFire = nowS + w.rate;
  vm.kick = 1; vm.flash = 0.05; vm.roll = (Math.random() - 0.5) * 0.25;
  const ud = vmViews[selWeapon]?.ud;
  const slow = !!ud && (ud.type === 'bolt' || ud.type === 'shell');
  vm.cycDur = slow ? Math.max(0.3, w.rate * 0.7) : 0.07;
  vm.cyc = 0;
  audio.shot(selWeapon, 0.85, 0, 0);
  const k = adsAmt;
  // отдача: подбрасывание вверх и лёгкий увод, потом камера частично возвращается
  const up = w.kick[0] * (0.85 + Math.random() * 0.3) * (1 - k * 0.4);
  view.pitch = clamp(view.pitch + up, -1.5, 1.5);
  view.yaw = S.wrapAngle(view.yaw + (Math.random() - 0.5) * 2 * w.kick[1] * (1 - k * 0.4));
  recoil.acc += up * 0.7; recoil.t = nowS;
  shakeAmp = Math.max(shakeAmp, SHAKE[selWeapon] * (1 - k * 0.5));
  localBloom = Math.min(w.bloomMax, localBloom + w.bloom);
  // гильза и дымок
  const b = basis();
  const kk = 1 - k;
  const mx = camPos.x + b.fx * 0.55 + b.rx * 0.13 * kk, my = camPos.y + b.fy * 0.55 + b.uy * -0.07 * kk, mz = camPos.z + b.fz * 0.55 + b.rz * 0.13 * kk;
  const sp = 1.6 + Math.random() * 0.8;
  fx.casing(mx, my, mz,
    b.rx * sp + b.ux * 0.4 - b.fx * 0.3 + me.vx * 0.5, 1.3 + Math.random() * 0.8, b.rz * sp + b.uz * 0.4 - b.fz * 0.3 + me.vz * 0.5, selWeapon === 2 || selWeapon === 9);
  if (Math.random() < 0.6) fx.smoke(camPos.x + b.fx * 1.1 + b.rx * 0.1 * kk, camPos.y + b.fy * 1.1 - 0.08 * kk, camPos.z + b.fz * 1.1 + b.rz * 0.1 * kk, selWeapon === 4 ? 1.8 : selWeapon === 8 ? 1.4 : 1);
  updateAmmo();
}

// клавиатура / мышь
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); syncScoreboard(); }
  if (e.code === 'KeyR' && !e.repeat) input.reloadLatch = true;
  if (e.code === 'Space') e.preventDefault();
  if (/^Digit[1-3]$/.test(e.code)) changeWeapon(loadout[+e.code.slice(5) - 1]);
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') syncScoreboard();
});
window.addEventListener('blur', releaseInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseInputs(); });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (isTouch || !locked) return;
  if (e.button === 2) { setAds(true); return; }
  if (e.button !== 0) return;
  input.fireHeld = true; input.fireLatch = true; input.localTap = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fireHeld = false;
  if (e.button === 2) setAds(false);
});
window.addEventListener('mousemove', (e) => { if (locked && !menuOpen) applyLook(e.movementX, e.movementY, 0.0022); });
window.addEventListener('wheel', (e) => {
  if (!locked) return;
  const at = Math.max(0, loadout.indexOf(selWeapon));
  changeWeapon(loadout[(at + (e.deltaY > 0 ? 1 : 2)) % 3]);
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
  applyLook(e.clientX - look.x, e.clientY - look.y, 0.0058);
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
  applyLook(e.clientX - fireTouch.x, e.clientY - fireTouch.y, 0.0058);
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
hold($('bAds'), () => setAds(!input.ads));
el.wb.forEach((b, i) => {
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation?.(); if (!menuOpen) changeWeapon(loadout[i]); });
});
hold($('bScore'), () => { sbPinned = !sbPinned; syncScoreboard(); });
hold($('bMenu'), () => openMenu());

document.addEventListener('touchmove', (e) => { if (e.target?.closest?.('.card, .lcol, .rcol, .lbody')) return; e.preventDefault(); }, { passive: false });

function releaseInputs() {
  for (const k of Object.keys(keys)) keys[k] = false;
  input.fireHeld = false; input.fireLatch = false; input.jumpBtn = false; input.localTap = false; input.ads = false;
  joy.id = null; joy.x = joy.y = 0; look.id = null; fireTouch.id = null;
  resetJoyVisual();
}

// ---------- Меню ----------
const MODE_LIST = ['tdm', 'hill', 'hs', 'ffa', 'gg'];
const SKILLS = ['Лёгкие', 'Средние', 'Сложные'];
const TABS = [['quick', 'Быстрая игра'], ['rooms', 'Комнаты'], ['create', 'Своя комната'], ['code', 'По коду']];
const MODE_TXT = {
  tdm: 'Две команды по четыре бойца. Первые до 40 убийств.',
  hill: 'Держите зону: пока вы в ней одни, команде идут очки.',
  hs: 'Считается только голова. Выстрел в неё убивает сразу.',
  ffa: 'Каждый сам за себя. До 20 убийств.',
  gg: 'Убили — получили новое оружие. Пройдите все восемь.',
};
const SV = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const MODE_SVG = {
  tdm: SV('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c.5-3.5 3-5 6-5M22 20c-.5-3.5-3-5-6-5M9 20c.5-3 1.5-4 3-4s2.5 1 3 4"/>'),
  hill: SV('<path d="M6 21V3M6 4h12l-2.5 4.5L18 13H6"/>'),
  hs: SV('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>'),
  ffa: SV('<path d="M12 3l2.5 6 6.5.5-5 4.3 1.6 6.4L12 16.8 6.4 20.2 8 13.8 3 9.5 9.5 9z"/>'),
  gg: SV('<path d="M3 10h13l2 2h3v3h-6l-1 3H8l1-3H3z"/><path d="M6 10V8h8v2"/>'),
};
const WDESC = {
  rifle: 'Надёжная классика: хорош на любой дистанции.',
  smg: 'Льёт очередью вблизи и легко держится в руках.',
  carbine: 'Лёгкий и точный: отдача мягче, чем у автомата.',
  lmg: 'Сто патронов в ленте. Долго перезаряжается, зато не жалеет свинец.',
  dmr: 'Одиночные выстрелы на дальнюю дистанцию, в голову — наповал.',
  shotgun: 'Помпа: в упор сносит почти любого.',
  sniper: 'Один точный выстрел решает бой. Сильное приближение.',
  autosg: 'Скорострельный дробовик, страшен в тесных проходах.',
  pistol: 'Быстро достаётся, патронов хватит надолго.',
  revolver: 'Шесть тяжёлых выстрелов, в голову — наповал.',
};
// Полоски характеристик без цифр: просто «много или мало».
const wStats = (w) => {
  const dmg = Math.min(1, (w.dmg * (w.pellets > 1 ? w.pellets * 0.6 : 1)) / 90);
  const rate = Math.min(1, 1 / w.rate / 15);
  const acc = 1 - Math.min(1, (w.spread * w.adsMul) / 0.04);
  return [['Урон', dmg], ['Темп', rate], ['Точность', acc]];
};
const bar = (v) => `<i>${[1, 2, 3, 4, 5].map((k) => `<u class="${k <= Math.max(1, Math.round(v * 5)) ? 'f' : ''}"></u>`).join('')}</i>`;

const pick = { tab: 'quick', gm: 'tdm', skill: 0, roomId: 0 };
{
  const qm = Q.get('mode');
  pick.gm = MODE_LIST.includes(Q.get('gm')) ? Q.get('gm') : MODE_LIST.includes(lsGet('af_gm')) ? lsGet('af_gm') : 'tdm';
  pick.skill = Q.get('skill') !== null ? clamp(parseInt(Q.get('skill'), 10) || 0, 0, 2) : clamp(parseInt(lsGet('af_skill'), 10) || 0, 0, 2);
  pick.tab = { create: 'create', room: 'rooms', code: 'code' }[qm] || 'quick';
  if (qm === 'room') pick.roomId = parseInt(Q.get('room'), 10) || 0;
}
let joinBusy = false;
let lastWelcome = null;

function renderLoadout() {
  const box = $('loadout');
  if (pick.gm === 'gg' && (pick.tab === 'quick' || pick.tab === 'create')) {
    box.innerHTML = '<p class="muted">В гонке вооружений оружие выдаём сами: с каждым убийством следующее.</p>';
    return;
  }
  box.innerHTML = [0, 1, 2].map((slot) => {
    const w = S.WEAPONS[loadout[slot]];
    const chips = S.WEAPONS.map((x, i) => (x.slot === slot ? `<button data-slot="${slot}" data-w="${i}" class="${loadout[slot] === i ? 'on' : ''}">${x.name}</button>` : '')).join('');
    const bars = wStats(w).map(([n, v]) => `<span>${n}</span>${bar(v)}`).join('');
    return `<div class="ls"><div class="lt"><span>${S.SLOT_NAMES[slot]}</span><b>${w.name}</b></div><div class="bars">${bars}</div><div class="wd">${WDESC[w.id] || ''}</div><div class="chips">${chips}</div></div>`;
  }).join('');
}

function refreshMenu() {
  $('launch').className = `launch tab-${pick.tab}${joined ? ' paused' : ''}`;
  $('tabs').innerHTML = TABS.map(([id, n]) => `<button data-tab="${id}" class="${id === pick.tab ? 'on' : ''}">${n}</button>`).join('');
  $('modeGrid').innerHTML = MODE_LIST.map((id) => `<button class="mc ${id === pick.gm ? 'sel' : ''}" data-gm="${id}"><span class="ic">${MODE_SVG[id]}</span><span><b>${S.MODES[id].name}${id === 'hill' ? ' <em class="new">новое</em>' : ''}</b><small>${MODE_TXT[id]}</small></span></button>`).join('');
  $('skillSeg').innerHTML = '<span>Боты</span>' + SKILLS.map((n, i) => `<button data-skill="${i}" class="${i === pick.skill ? 'on' : ''}">${n}</button>`).join('');
  renderLoadout();
  const guestCreate = pick.tab === 'create' && !account;
  const labels = { quick: 'В БОЙ', create: 'СОЗДАТЬ И ИГРАТЬ', code: 'ВОЙТИ ПО КОДУ', rooms: 'В БОЙ' };
  $('playBtn').textContent = joined ? 'ПРОДОЛЖИТЬ' : guestCreate ? 'НУЖЕН АККАУНТ' : labels[pick.tab];
  $('playBtn').classList.toggle('hidden', pick.tab === 'rooms' && !joined);
  $('playBtn').disabled = joinBusy || (!joined && guestCreate);
  $('createNote').textContent = account ? 'Режим и сложность выберите выше. После создания покажем код для друзей.' : 'Свои комнаты открыты игрокам с аккаунтом. Войдите, и они появятся.';
  $('pauseBox').classList.toggle('hidden', !joined);
  $('loadBox').classList.toggle('hidden', joined);
  if (joined && lastWelcome) $('pauseInfo').textContent = `${modeName} · боты: ${lastWelcome.skillName || 'Лёгкие'}${lastWelcome.code ? ` · код комнаты ${lastWelcome.code}` : ''}`;
}

function openMenu() {
  menuOpen = true;
  $('menu').classList.remove('hidden');
  refreshMenu();
  releaseInputs();
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeMenu() {
  menuOpen = false;
  $('menu').classList.add('hidden');
}

async function loadRooms() {
  if (typeof fetch !== 'function') return;
  try {
    const r = await fetch('/api/rooms', { credentials: 'same-origin' });
    const { rooms } = await r.json();
    $('roomList').innerHTML = rooms.length
      ? rooms.map((x) => `<div class="rrow ${x.id === pick.roomId ? 'pre' : ''}"><div class="nm">${esc(x.name)}<small>${esc(x.modeName)} · ${SKILLS[x.skill] || ''} · ${x.state ? 'итоги матча' : 'идёт бой'}</small></div><span class="cnt">${x.humans}/${x.max}</span><button data-room="${x.id}" ${x.humans >= x.max || joinBusy ? 'disabled' : ''}>Войти</button></div>`).join('')
      : '<div class="rempty">Открытых комнат пока нет.<br>Создайте свою на соседней вкладке или начните быструю игру.</div>';
  } catch { $('roomList').innerHTML = '<div class="rempty">Не удалось загрузить список. Попробуйте ещё раз через пару секунд.</div>'; }
}

function startJoin(jp) {
  if (jp.mode === 'code' && jp.code.length !== 5) { $('status').textContent = 'Код состоит из 5 символов'; return; }
  audio.init();
  toggleFullscreen(true);
  joinPrefs = jp;
  lsSet('af_gm', pick.gm); lsSet('af_skill', String(pick.skill)); lsSet('af_loadout', JSON.stringify(loadout));
  wantJoin = true; joinBusy = true;
  $('playBtn').disabled = true;
  $('status').textContent = 'Подключение…';
  ensureSocket();
  if (socket.connected) doJoin();
}
function currentJoin() {
  if (pick.tab === 'create') return { mode: 'create', skill: pick.skill, gm: pick.gm, roomName: $('roomName').value.trim(), priv: $('roomPriv').checked };
  if (pick.tab === 'code') return { mode: 'code', code: $('codeInput').value.trim().toUpperCase() };
  return { mode: 'quick', skill: pick.skill, gm: pick.gm };
}

$('tabs').addEventListener('click', (e) => {
  const b = e.target?.closest?.('button');
  if (!b || !b.dataset.tab) return;
  pick.tab = b.dataset.tab; $('status').textContent = '';
  refreshMenu();
  if (pick.tab === 'rooms') loadRooms();
});
$('modeGrid').addEventListener('click', (e) => { const b = e.target?.closest?.('button'); if (!b || !b.dataset.gm) return; pick.gm = b.dataset.gm; lsSet('af_gm', pick.gm); refreshMenu(); });
$('skillSeg').addEventListener('click', (e) => { const b = e.target?.closest?.('button'); if (!b || b.dataset.skill === undefined) return; pick.skill = clamp(parseInt(b.dataset.skill, 10) || 0, 0, 2); lsSet('af_skill', String(pick.skill)); refreshMenu(); });
$('loadout').addEventListener('click', (e) => {
  const b = e.target?.closest?.('button');
  if (!b || b.dataset.w === undefined) return;
  loadout[+b.dataset.slot] = +b.dataset.w;
  loadout = S.cleanLoadout(loadout);
  lsSet('af_loadout', JSON.stringify(loadout));
  renderLoadout();
});
$('roomList').addEventListener('click', (e) => {
  const b = e.target?.closest?.('button');
  if (!b || !b.dataset.room || joinBusy) return;
  startJoin({ mode: 'room', roomId: parseInt(b.dataset.room, 10) || 0 });
});
$('codeInput').addEventListener('input', (e) => { e.target.value = String(e.target.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
$('codeInput').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('playBtn').click(); });
$('roomName').addEventListener('keydown', (e) => e.stopPropagation());
$('changeBtn').addEventListener('click', () => { location.href = '/play'; });
setInterval(() => { if (menuOpen && !joined && pick.tab === 'rooms') loadRooms(); }, 4000);

$('nameInput').value = lsGet('af_name') || '';
$('codeInput').value = (Q.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
$('roomName').value = Q.get('rn') || '';
$('roomPriv').checked = Q.get('priv') === '1';
accountReady.then(() => {
  const guest = !account;
  $('nameRow').classList.toggle('hidden', !guest);
  $('loginLink').classList.toggle('hidden', !guest);
  $('who').textContent = guest ? 'Вы играете как гость: прогресс не сохраняется' : `${account.nick} · ур. ${account.level} · ${account.rank}`;
  refreshMenu();
});
$('sens').value = String(sens);
$('sens').addEventListener('input', (e) => { sens = parseFloat(e.target.value) || 1; lsSet('af_sens', String(sens)); });
$('nameInput').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('playBtn').click(); });
refreshMenu();
if (pick.tab === 'rooms') loadRooms();

// ---------- Полный экран ----------
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = !!window.navigator.standalone || matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches;
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const canFs = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

function toggleFullscreen(forceEnter = false) {
  try {
    if (fsElement()) {
      if (!forceEnter) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      return;
    }
    const d = document.documentElement;
    const rq = d.requestFullscreen || d.webkitRequestFullscreen;
    if (!rq) return;
    const p = rq.call(d, { navigationUI: 'hide' });
    p?.then?.(() => { try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* ignore */ } });
    p?.catch?.(() => {});
  } catch { /* ignore */ }
}
// iPhone в обычном браузере не умеет Fullscreen API — подсказываем установку на экран «Домой»
$('iosHint').classList.toggle('hidden', !(isIOS && !isStandalone));
$('fsBtn').classList.toggle('hidden', !canFs);
$('fsBtn').addEventListener('click', () => toggleFullscreen());
hold($('bFull'), () => toggleFullscreen());

$('playBtn').addEventListener('click', () => {
  if (joined) { audio.init(); toggleFullscreen(true); closeMenu(); lockPointer(); return; }
  if (joinBusy) return;
  startJoin(currentJoin());
});

// ---------- Индикатор цели под прицелом ----------
let lockShown = false;
let lockHit = false;
function updateTargetLock() {
  let hit = false;
  if (joined && alive && !menuOpen) {
    const ox = camPos.x, oy = camPos.y, oz = camPos.z;
    const cp = Math.cos(view.pitch);
    const dx = -Math.sin(view.yaw) * cp, dy = Math.sin(view.pitch), dz = -Math.cos(view.yaw) * cp;
    for (const r of remotes.values()) {
      if (!isEnemy(r.team) || !r.wasAlive || !r.model.visible) continue;
      const p = r.model.position;
      const t = S.rayAABB(ox, oy, oz, dx, dy, dz, p.x - 0.55, p.y, p.z - 0.55, p.x + 0.55, p.y + 1.85, p.z + 0.55);
      if (t < S.WEAPONS[selWeapon].range && S.rayWorld(ox, oy, oz, dx, dy, dz, t) >= t) { hit = true; break; }
    }
  }
  lockHit = hit;
  if (hit !== lockShown) { lockShown = hit; el.crosshair.classList.toggle('lock', hit); }
}

// ---------- Авто-огонь: стреляем сами, пока враг под прицелом ----------
let autoFire = isTouch && (localStorage.getItem('af_auto') === null ? true : localStorage.getItem('af_auto') === '1');
function setAuto(on) {
  autoFire = isTouch && !!on; // на ПК авто-огня нет — честная игра мышью
  try { localStorage.setItem('af_auto', autoFire ? '1' : '0'); } catch { /* ignore */ }
  $('autoFire').checked = autoFire;
  $('bAuto').classList.toggle('on', autoFire);
}
$('autoRow').classList.toggle('hidden', !isTouch); // авто-огня на ПК нет
$('quality').value = quality;
$('quality').addEventListener('change', (e) => { try { localStorage.setItem('af_quality', e.target.value); } catch { /* ignore */ } $('status').textContent = 'Качество применится после перезагрузки страницы'; });
$('autoFire').addEventListener('change', (e) => setAuto(e.target.checked));
hold($('bAuto'), () => setAuto(!autoFire));
setAuto(autoFire);
function autoFireUpdate(nowS) {
  if (!autoFire || !lockHit || !joined || !alive || menuOpen || matchState === 1) return;
  if (info.rl > 0 || nowS < localNextFire) return;
  if (selWeapon === 4 && adsAmt < 0.85) return; // снайперка: только в оптике
  const a = info.wp?.[selWeapon];
  if (!a || a[0] <= 0) return;
  input.localTap = true;
  input.fireLatch = true; // одиночный импульс на тик: для неавтоматов сервер видит нажатие
}

// ---------- Зона «Захват точки» ----------
function ensureHill() {
  if (hillGroup) return;
  const mat = (opacity, side) => new THREE.MeshBasicMaterial({ color: 0xe3b04b, transparent: true, opacity, side, depthWrite: false, fog: false });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 7, 48, 1, true), mat(0.16, THREE.DoubleSide));
  wall.position.y = 3.5;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.06, 48), mat(0.22, THREE.DoubleSide));
  disc.position.y = 0.05;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.01, 1.01, 0.14, 48, 1, true), mat(0.75, THREE.DoubleSide));
  rim.position.y = 0.08;
  hillGroup = new THREE.Group();
  hillGroup.add(wall, disc, rim);
  hillMats = [wall.material, disc.material, rim.material];
  scene.add(hillGroup);
}
const HILL_COLOR = { '-1': 0xe3b04b, 0: 0x3b82f6, 1: 0xef4444, 2: 0xfacc15 };
function applyHill(h) {
  hillState = h;
  ensureHill();
  hillGroup.visible = true;
  hillGroup.position.set(h[0], 0, h[1]);
  hillGroup.scale.set(h[2], 1, h[2]);
  const o = h[3];
  for (const m of hillMats) m.color?.setHex?.(HILL_COLOR[o] ?? 0xe3b04b);
  const mine = o === myTeam, foe = (o === 0 || o === 1) && o !== myTeam;
  const inside = alive && Math.hypot(me.x - h[0], me.z - h[1]) <= h[2];
  el.hillState.textContent = (o === 2 ? 'Точка спорная' : o === -1 ? 'Точка свободна' : mine ? 'Точка ваша' : 'Точка у врага') + (inside ? ' · вы в зоне' : '');
  el.hill.classList.toggle('mine', mine);
  el.hill.classList.toggle('foe', foe);
  el.hill.classList.toggle('hot', o === 2);
  el.hillTimer.textContent = `переезд через ${h[4]} с`;
  el.hillFill.style.width = `${clamp(h[4] / S.HILL_TIME, 0, 1) * 100}%`;
}

// ---------- Радар ----------
const radarSeen = new Map();
const radarCtx = el.radar.getContext ? el.radar.getContext('2d') : null;
let radarT = 0;
function drawRadar(nowMs) {
  if (!radarCtx || nowMs - radarT < 66) return;
  radarT = nowMs;
  const c = radarCtx, W = 150, H = 104, sc = 2.6, by = H * 0.64;
  c.clearRect(0, 0, W, H);
  if (!(joined && alive && !menuOpen)) return;
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
  const px = (x, z) => W / 2 + ((x - me.x) * cy - (z - me.z) * sy) * sc;
  const py = (x, z) => by + ((x - me.x) * sy + (z - me.z) * cy) * sc;
  c.fillStyle = 'rgba(150,172,192,0.38)';
  for (const b of S.BOXES) {
    if (Math.abs(b.x - me.x) > 45 || Math.abs(b.z - me.z) > 30) continue;
    c.beginPath();
    c.moveTo(px(b.x0, b.z0), py(b.x0, b.z0)); c.lineTo(px(b.x1, b.z0), py(b.x1, b.z0));
    c.lineTo(px(b.x1, b.z1), py(b.x1, b.z1)); c.lineTo(px(b.x0, b.z1), py(b.x0, b.z1));
    c.closePath(); c.fill();
  }
  if (hillState) {
    const [hx, hz, hr, ho] = hillState;
    c.beginPath();
    for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; const X = px(hx + Math.cos(a) * hr, hz + Math.sin(a) * hr), Y = py(hx + Math.cos(a) * hr, hz + Math.sin(a) * hr); if (k) c.lineTo(X, Y); else c.moveTo(X, Y); }
    c.fillStyle = `${ho === 0 ? 'rgba(59,130,246' : ho === 1 ? 'rgba(239,68,68' : 'rgba(250,204,21'},0.28)`;
    c.fill(); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.5; c.stroke();
  }
  if (lastSnap) {
    for (const r of lastSnap.p) {
      if (r[0] === myId || !r[6]) continue;
      const pi = roster.get(r[0]);
      const ally = teamsMode && pi?.team === myTeam;
      if (!ally && !((radarSeen.get(r[0]) || 0) > nowMs)) continue;
      let X = px(r[1], r[3]), Y = py(r[1], r[3]);
      X = clamp(X, 4, W - 4); Y = clamp(Y, 4, H - 4);
      c.beginPath(); c.arc(X, Y, 3.2, 0, 6.283);
      c.fillStyle = ally ? (myTeam === 0 ? '#60a5fa' : '#f87171') : '#ff3b3b';
      c.fill();
      if (!ally) { c.strokeStyle = 'rgba(255,80,80,0.6)'; c.lineWidth = 1; c.beginPath(); c.arc(X, Y, 6, 0, 6.283); c.stroke(); }
    }
  }
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.beginPath(); c.moveTo(W / 2, by); c.lineTo(W / 2 - 38, by - 70); c.lineTo(W / 2 + 38, by - 70); c.closePath(); c.fill();
  c.fillStyle = '#fff';
  c.beginPath(); c.moveTo(W / 2, by - 6); c.lineTo(W / 2 + 4.5, by + 4); c.lineTo(W / 2 - 4.5, by + 4); c.closePath(); c.fill();
}

// ---------- Прицеливание / отдача ----------
function updateAds(dt, nowS) {
  const want = joined && alive && !menuOpen && input.ads ? 1 : 0;
  const rate = selWeapon === 4 ? 8 : 11;
  adsAmt += (want - adsAmt) * Math.min(1, dt * rate);
  if (Math.abs(want - adsAmt) < 0.003) adsAmt = want;
  const w = S.WEAPONS[selWeapon];
  const t = adsAmt * adsAmt * (3 - 2 * adsAmt);
  curFov = BASE_FOV + (w.zoom - BASE_FOV) * t;
  // возврат камеры после очереди
  if (recoil.acc > 0.0001 && nowS - recoil.t > 0.09) {
    const r = Math.min(recoil.acc, recoil.acc * dt * 5 + dt * 0.015);
    view.pitch -= r; recoil.acc -= r;
  }
  localBloom = Math.max(0, localBloom - 0.05 * dt);
  shakeAmp *= Math.exp(-dt * 16);
}

// ---------- Камера и цикл ----------
let bobT = 0;
let lastFov = 0;
function updateCamera(dt) {
  if (!joined) {
    const t = performance.now() / 1000 * 0.12;
    camPos.x = Math.cos(t) * 36; camPos.y = 14; camPos.z = Math.sin(t) * 26;
    camera.position.set(camPos.x, camPos.y, camPos.z);
    camera.lookAt(0, 2, 0);
    if (lastFov !== BASE_FOV) { camera.fov = BASE_FOV; camera.updateProjectionMatrix(); lastFov = BASE_FOV; }
    return 0;
  }
  const a = acc / S.DT;
  const px = prev.x + (me.x - prev.x) * a;
  const py = prev.y + (me.y - prev.y) * a;
  const pz = prev.z + (me.z - prev.z) * a;
  const speed = Math.hypot(me.vx, me.vz);
  if (alive) {
    bobT += dt * speed * 1.5;
    const bob = me.onGround ? Math.sin(bobT * 2) * 0.025 * Math.min(1, speed / 6) * (1 - adsAmt * 0.8) : 0;
    camPos.x = px; camPos.y = py + S.PLAYER.eye + bob; camPos.z = pz;
    camera.position.set(camPos.x, camPos.y, camPos.z);
    const sh = shakeAmp;
    camera.rotation.set(view.pitch + (Math.random() - 0.5) * sh, view.yaw + (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh * 0.6);
    // шаги и приземление
    if (me.onGround) {
      stepDist += speed * dt;
      if (speed > 1.5 && stepDist > 2.2) { stepDist = 0; audio.step(0.18 * (1 - adsAmt * 0.4)); }
      if (!wasGround && lastVy < -4) { audio.land(clamp(-lastVy / 14, 0.2, 0.7)); shakeAmp = Math.max(shakeAmp, 0.006); }
    }
    wasGround = me.onGround; lastVy = me.vy;
  } else {
    const k = Math.min(1, (performance.now() - deathAt) / 600);
    camPos.x = px; camPos.y = py + S.PLAYER.eye * (1 - k) + 0.25 * k; camPos.z = pz;
    camera.position.set(camPos.x, camPos.y, camPos.z);
    camera.rotation.set(view.pitch * (1 - k * 0.5), view.yaw, k * 0.7);
  }
  const fov = alive ? curFov : BASE_FOV;
  if (Math.abs(fov - lastFov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); lastFov = fov; }
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

  updateAds(dt, nowMs / 1000);
  updateTargetLock();
  autoFireUpdate(nowMs / 1000);
  localFireUpdate(nowMs / 1000);
  updateRemotes(dt);
  const speed = updateCamera(dt);
  updateViewmodel(dt, speed);
  fx.update(dt, camPos);

  // прицел: зазор соответствует реальному разбросу оружия
  const w = S.WEAPONS[selWeapon];
  const bl = Math.max(info.bl || 0, localBloom);
  const hs = Math.hypot(me.vx, me.vz);
  const spreadRad = (w.spread + bl) * (1 + hs * 0.12) * (1 + (w.adsMul - 1) * adsAmt) + (me.onGround ? 0 : 0.03);
  const px = Math.tan(spreadRad) / Math.tan((curFov * Math.PI) / 360) * (window.innerHeight / 2);
  const g = clamp(px + 3, 4, 90);
  gap += (g - gap) * Math.min(1, dt * 16);
  const scoped = scopeOn();
  el.crosshair.style.setProperty('--g', gap.toFixed(1) + 'px');
  el.crosshair.style.display = joined && alive && !scoped ? '' : 'none';
  el.crosshair.style.opacity = String(1 - adsAmt * 0.6);
  el.scope.classList.toggle('hidden', !scoped);
  el.prot.classList.toggle('hidden', !(info.prot && alive));
  if (info.rl > 0) el.rlfill.style.width = `${Math.round(reloadProgress() * 100)}%`;
  drawRadar(nowMs);

  renderer.clear();
  renderer.render(scene, camera);
  if (vmShown) {
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
  get ads() { return adsAmt; },
  get fov() { return curFov; },
  get streak() { return killStreak; },
  get autoFire() { return autoFire; },
  setAuto,
  fx, audio, scene, vmScene,
  get vmPos() { const v = vmViews[selWeapon]; return v ? v.group.position : null; },
  get vmShown() { return vmShown; },
  get mode() { return modeId; },
  get teams() { return teamsMode; },
  get gun() { return gunMode; },
  get sel() { return selWeapon; },
  get scoped() { return scopeOn(); },
};
