// Процедурные low-poly модели: игроки и оружие. Без внешних ассетов.
import * as THREE from 'three';

// ---------- вспомогательное ----------
const matCache = new Map();
function mat(color, o = {}) {
  const key = `${color}|${o.phong ? 'p' : 'l'}|${o.shin ?? ''}|${o.flat ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = o.phong
      ? new THREE.MeshPhongMaterial({ color, shininess: o.shin ?? 55, specular: 0x555555, flatShading: o.flat ?? false })
      : new THREE.MeshLambertMaterial({ color, flatShading: o.flat ?? true });
    matCache.set(key, m);
  }
  return m;
}
const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
function box(parent, w, h, d, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
// цилиндр вдоль оси Z (радиусы на концах, длина)
function cyl(parent, r0, r1, len, material, x = 0, y = 0, z = 0, seg = 8) {
  const g = cached(`c${r0},${r1},${len},${seg}`, () => { const q = new THREE.CylinderGeometry(r1, r0, len, seg, 1); q.rotateX(Math.PI / 2); return q; });
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function capsule(parent, r, len, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(cached(`k${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 3, 8)), material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function sphere(parent, r, material, x = 0, y = 0, z = 0, ws = 8, hs = 6) {
  const m = new THREE.Mesh(cached(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)), material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Звено-цилиндр единичной длины вдоль +Z: растягивается между двумя точками
function makeLimb(r0, r1, material) {
  const g = cached(`limb${r0},${r1}`, () => { const q = new THREE.CylinderGeometry(r1, r0, 1, 6, 1); q.rotateX(Math.PI / 2); return q; });
  const m = new THREE.Mesh(g, material);
  m.rotation.order = 'YXZ';
  return m;
}
export function placeLimb(m, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 0.001;
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0);
  m.scale.set(1, 1, len);
}

// ---------- оружие ----------
const C = {
  metal: 0x2e3238, dark: 0x16181c, steel: 0x8a929c, wood: 0x80522d, polymer: 0x24272c,
  olive: 0x3f4b38, brass: 0xc79a3a, glove: 0x1b1d21, lens: 0x2a5a8a,
};

let flashMat = null;
function makeFlash(size) {
  if (!flashMat) flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const f = new THREE.Group();
  const g1 = cached('flashA', () => { const q = new THREE.PlaneGeometry(0.34, 0.12); q.rotateY(Math.PI / 2); q.translate(0, 0, -0.1); return q; });
  const g2 = cached('flashB', () => { const q = new THREE.PlaneGeometry(0.34, 0.12); q.rotateY(Math.PI / 2); q.rotateZ(Math.PI / 2); q.translate(0, 0, -0.1); return q; });
  const g3 = cached('flashC', () => new THREE.PlaneGeometry(0.2, 0.2));
  f.add(new THREE.Mesh(g1, flashMat), new THREE.Mesh(g2, flashMat), new THREE.Mesh(g3, flashMat));
  f.scale.setScalar(size);
  f.visible = false;
  return f;
}

// Возвращает Group; userData: mag, mover (затвор/помпа), muzzle, eject, grip, fore, hold, magBase, moverBase
export function buildGun(index) {
  const g = new THREE.Group();
  const metal = mat(C.metal, { phong: true, shin: 70 });
  const dark = mat(C.dark, { phong: true, shin: 40 });
  const steel = mat(C.steel, { phong: true, shin: 90 });
  const wood = mat(C.wood, { phong: true, shin: 30, flat: false });
  const poly = mat(C.polymer, { phong: true, shin: 25 });
  const ud = g.userData;
  const mag = new THREE.Group();
  const mover = new THREE.Group();
  g.add(mag); g.add(mover);

  if (index === 0) { // автомат
    box(g, 0.062, 0.085, 0.40, metal, 0, 0, 0);
    box(g, 0.056, 0.02, 0.30, metal, 0, 0.05, -0.03);
    box(g, 0.072, 0.07, 0.24, wood, 0, -0.008, -0.30);
    box(g, 0.075, 0.025, 0.2, dark, 0, 0.028, -0.30);
    cyl(g, 0.013, 0.013, 0.34, dark, 0, 0.014, -0.52);
    cyl(g, 0.011, 0.011, 0.22, steel, 0, 0.05, -0.40);
    box(g, 0.012, 0.045, 0.012, dark, 0, 0.065, -0.66);
    box(g, 0.026, 0.05, 0.014, dark, 0, 0.07, -0.34);
    box(g, 0.054, 0.10, 0.24, wood, 0, -0.02, 0.31, 0.06);
    box(g, 0.05, 0.11, 0.06, poly, 0, -0.095, 0.12, 0.35);
    box(mag, 0.055, 0.12, 0.07, poly, 0, -0.095, -0.03, 0.12);
    box(mag, 0.055, 0.10, 0.07, poly, 0, -0.19, -0.005, 0.38);
    box(mover, 0.018, 0.028, 0.05, steel, 0.042, 0.022, -0.04);
    ud.muzzle = [0, 0.014, -0.70]; ud.eject = [0.04, 0.03, -0.02];
    ud.grip = [0, -0.12, 0.12]; ud.fore = [0, -0.05, -0.32]; ud.hold = [0.12, -0.16, -0.16];
    ud.magDrop = [0, -0.2, 0.0]; ud.magHold = [0, -0.1, -0.03]; ud.type = 'mag'; ud.sightY = 0.078; ud.adsZ = -0.34; ud.travel = 0.05; ud.flashSize = 1;
  } else if (index === 1) { // пистолет
    box(g, 0.042, 0.036, 0.20, steel, 0, 0.044, -0.03);
    box(mover, 0.044, 0.04, 0.2, steel, 0, 0.043, -0.03);
    box(g, 0.04, 0.04, 0.2, dark, 0, 0.006, -0.02);
    box(g, 0.046, 0.115, 0.062, poly, 0, -0.07, 0.075, 0.2);
    box(g, 0.012, 0.03, 0.012, dark, 0, 0.074, -0.12);
    box(g, 0.012, 0.025, 0.02, dark, 0, 0.07, 0.07);
    box(mag, 0.034, 0.09, 0.044, metal, 0, -0.1, 0.08, 0.2);
    ud.muzzle = [0, 0.044, -0.135]; ud.eject = [0.03, 0.06, -0.02];
    ud.grip = [0, -0.085, 0.075]; ud.fore = [-0.025, -0.1, 0.06]; ud.hold = [0.04, -0.1, -0.34];
    ud.magDrop = [0, -0.22, 0.04]; ud.magHold = [0, -0.09, 0.08]; ud.type = 'mag'; ud.sightY = 0.085; ud.adsZ = -0.3; ud.travel = 0.07; ud.flashSize = 0.7;
  } else if (index === 2) { // дробовик
    box(g, 0.066, 0.085, 0.30, metal, 0, 0, 0.03);
    cyl(g, 0.02, 0.02, 0.62, dark, 0, 0.026, -0.44);
    cyl(g, 0.015, 0.015, 0.5, metal, 0, -0.022, -0.40);
    box(g, 0.012, 0.03, 0.012, dark, 0, 0.056, -0.74);
    box(mover, 0.078, 0.062, 0.2, wood, 0, -0.04, -0.34);
    box(g, 0.056, 0.10, 0.26, wood, 0, -0.025, 0.31, 0.08);
    box(g, 0.05, 0.10, 0.06, wood, 0, -0.09, 0.11, 0.3);
    box(mag, 0.03, 0.02, 0.07, metal, 0, -0.05, 0.05);
    ud.muzzle = [0, 0.026, -0.76]; ud.eject = [0.04, 0.02, 0.0];
    ud.grip = [0, -0.11, 0.11]; ud.fore = [0, -0.075, -0.34]; ud.hold = [0.12, -0.17, -0.13];
    ud.magDrop = [0, -0.05, 0.04]; ud.magHold = [0.02, -0.07, 0.08]; ud.type = 'shell'; ud.sightY = 0.062; ud.adsZ = -0.3; ud.travel = 0.13; ud.pumpHand = true; ud.flashSize = 1.5;
  } else if (index === 3) { // пистолет-пулемёт
    box(g, 0.058, 0.08, 0.30, metal, 0, 0, 0);
    box(g, 0.042, 0.042, 0.22, dark, 0, 0.012, -0.25);
    cyl(g, 0.016, 0.016, 0.12, steel, 0, 0.012, -0.4);
    box(g, 0.04, 0.02, 0.22, dark, 0, 0.055, -0.02);
    box(g, 0.03, 0.03, 0.04, poly, 0, 0.082, -0.07);
    box(g, 0.012, 0.012, 0.19, steel, 0, -0.01, 0.23);
    box(g, 0.04, 0.05, 0.012, steel, 0, -0.01, 0.33);
    box(g, 0.046, 0.10, 0.056, poly, 0, -0.09, 0.09, 0.25);
    box(mag, 0.04, 0.18, 0.06, poly, 0, -0.14, -0.015);
    box(mover, 0.016, 0.022, 0.04, steel, 0.036, 0.025, -0.02);
    ud.muzzle = [0, 0.012, -0.47]; ud.eject = [0.035, 0.03, -0.02];
    ud.grip = [0, -0.1, 0.09]; ud.fore = [0, -0.04, -0.27]; ud.hold = [0.11, -0.15, -0.2];
    ud.magDrop = [0, -0.2, 0.0]; ud.magHold = [0, -0.1, -0.015]; ud.type = 'mag'; ud.sightY = 0.1; ud.adsZ = -0.3; ud.travel = 0.04; ud.flashSize = 0.8;
  } else { // снайперская винтовка
    box(g, 0.06, 0.082, 0.42, metal, 0, 0, 0.04);
    cyl(g, 0.014, 0.014, 0.72, dark, 0, 0.014, -0.56);
    cyl(g, 0.02, 0.02, 0.06, dark, 0, 0.014, -0.93);
    cyl(g, 0.03, 0.03, 0.27, dark, 0, 0.098, -0.02);
    cyl(g, 0.036, 0.036, 0.05, dark, 0, 0.098, -0.17);
    cyl(g, 0.034, 0.034, 0.05, dark, 0, 0.098, 0.13);
    box(g, 0.024, 0.026, 0.02, mat(C.lens, { phong: true, shin: 120 }), 0, 0.098, -0.2);
    box(g, 0.03, 0.04, 0.03, metal, 0, 0.055, -0.1);
    box(g, 0.03, 0.04, 0.03, metal, 0, 0.055, 0.07);
    box(g, 0.056, 0.105, 0.32, mat(C.olive, { phong: true, shin: 20, flat: false }), 0, -0.02, 0.4, 0.05);
    box(g, 0.05, 0.10, 0.06, poly, 0, -0.095, 0.17, 0.3);
    box(g, 0.05, 0.05, 0.22, mat(C.olive, { phong: true, shin: 20, flat: false }), 0, -0.04, -0.25);
    box(mag, 0.04, 0.08, 0.06, metal, 0, -0.07, 0.0);
    box(mover, 0.016, 0.016, 0.07, steel, 0.05, 0.02, 0.1);
    sphere(mover, 0.016, steel, 0.05, 0.02, 0.14, 6, 4);
    ud.muzzle = [0, 0.014, -0.96]; ud.eject = [0.045, 0.03, 0.08];
    ud.grip = [0, -0.12, 0.17]; ud.fore = [0, -0.06, -0.25]; ud.hold = [0.12, -0.17, -0.12];
    ud.magDrop = [0, -0.18, 0.0]; ud.magHold = [0, -0.07, 0.0]; ud.type = 'bolt'; ud.travel = 0.09; ud.sightY = 0.1; ud.adsZ = -0.22; ud.flashSize = 1.7;
  }
  ud.mag = mag; ud.mover = mover;
  ud.flash = makeFlash(ud.flashSize || 1);
  ud.flash.position.set(ud.muzzle[0], ud.muzzle[1], ud.muzzle[2]);
  g.add(ud.flash);
  return g;
}

// ---------- игрок ----------
export function makeTag(text, color) {
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
  s.position.set(0, 2.1, 0);
  s.renderOrder = 10;
  return s;
}

export function makePlayerModel(team, name) {
  const unif = team === 0 ? 0x2f5fa8 : 0xb03d33;
  const unifDark = team === 0 ? 0x1e3c6e : 0x6e241f;
  const helmet = team === 0 ? 0x1f3350 : 0x4a1f1c;
  const accent = team === 0 ? 0x7db4ff : 0xff8c8c;
  const mU = mat(unif), mD = mat(unifDark), mH = mat(helmet, { flat: false });
  const mVest = mat(0x2a2f36), mPouch = mat(0x353b43), mSkin = mat(0xe0b393, { flat: false });
  const mBoot = mat(0x17181b), mGlove = mat(C.glove), mPack = mat(0x3a4038);

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.92;
  root.add(body);

  // таз и торс
  box(body, 0.34, 0.17, 0.22, mD, 0, 0.0, 0);
  const torso = new THREE.Group();
  torso.position.y = 0.08;
  body.add(torso);
  const chest = box(torso, 0.40, 0.36, 0.23, mU, 0, 0.24, 0);
  box(torso, 0.43, 0.29, 0.255, mVest, 0, 0.27, 0.003);
  box(torso, 0.09, 0.11, 0.05, mPouch, -0.1, 0.2, -0.145);
  box(torso, 0.09, 0.11, 0.05, mPouch, 0.1, 0.2, -0.145);
  box(torso, 0.38, 0.045, 0.235, mat(0x1c1e22), 0, 0.045, 0);
  box(torso, 0.30, 0.34, 0.13, mPack, 0, 0.29, 0.185);
  box(torso, 0.26, 0.07, 0.11, mat(0x2e332d), 0, 0.5, 0.185);
  box(torso, 0.14, 0.03, 0.02, mat(accent, { flat: true }), 0, 0.33, -0.13); // цветная полоса команды на груди

  // голова
  const head = new THREE.Group();
  head.position.set(0, 0.57, 0);
  body.add(head);
  cyl(head, 0.045, 0.05, 0.1, mSkin, 0, -0.02, 0, 6).rotation.x = Math.PI / 2;
  sphere(head, 0.105, mSkin, 0, 0.1, 0, 8, 6);
  const hel = new THREE.Mesh(cached('helm', () => new THREE.SphereGeometry(0.125, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.56)), mH);
  hel.position.set(0, 0.125, 0.004);
  head.add(hel);
  box(head, 0.2, 0.025, 0.07, mH, 0, 0.1, -0.1);
  box(head, 0.17, 0.04, 0.03, mat(0x0c1118, { phong: true, shin: 100 }), 0, 0.105, -0.108);

  // ноги
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, -0.04, 0);
    body.add(hip);
    capsule(hip, 0.07, 0.3, mD, 0, -0.22, 0);
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    hip.add(knee);
    capsule(knee, 0.06, 0.27, mD, 0, -0.2, 0);
    box(knee, 0.075, 0.085, 0.09, mVest, 0, -0.1, -0.04); // наколенник
    box(knee, 0.12, 0.09, 0.26, mBoot, 0, -0.39, -0.045);
    legs.push({ hip, knee });
  }

  // торс-вращатель с руками и оружием (наклоняется по pitch)
  const aim = new THREE.Group();
  aim.position.set(0, 0.46, 0);
  body.add(aim);
  const slot = new THREE.Group();
  aim.add(slot);
  const limbs = {
    uR: makeLimb(0.05, 0.045, mU), fR: makeLimb(0.045, 0.04, mU),
    uL: makeLimb(0.05, 0.045, mU), fL: makeLimb(0.045, 0.04, mU),
  };
  const gloveR = box(aim, 0.075, 0.075, 0.1, mGlove);
  const gloveL = box(aim, 0.075, 0.075, 0.1, mGlove);
  for (const l of Object.values(limbs)) aim.add(l);
  sphere(aim, 0.065, mU, 0.21, 0.0, 0, 6, 5);
  sphere(aim, 0.065, mU, -0.21, 0.0, 0, 6, 5);

  const tag = makeTag(name, team === 0 ? '#9cc7ff' : '#ffa3a3');
  root.add(tag);

  const guns = [];
  let cur = -1;
  const m = {
    root, body, head, aim, legs, tag, chest, kick: 0, flashT: 0, phase: 0, dead: false, weapon: -1,
    fire() { m.kick = 1; m.flashT = 0.05; },
    gun() { return guns[cur]; },
    setWeapon(i) {
      if (i === cur) return;
      if (cur >= 0) slot.remove(guns[cur]);
      if (!guns[i]) guns[i] = buildGun(i);
      const gun = guns[i];
      slot.add(gun);
      cur = i; m.weapon = i;
      const ud = gun.userData;
      slot.position.set(ud.hold[0], ud.hold[1], ud.hold[2]);
      const hr = [ud.hold[0] + ud.grip[0], ud.hold[1] + ud.grip[1], ud.hold[2] + ud.grip[2]];
      const hl = [ud.hold[0] + ud.fore[0], ud.hold[1] + ud.fore[1], ud.hold[2] + ud.fore[2]];
      const sR = [0.21, 0, 0], sL = [-0.21, 0, 0];
      const eR = [(sR[0] + hr[0]) / 2 + 0.09, (sR[1] + hr[1]) / 2 - 0.15, (sR[2] + hr[2]) / 2 + 0.08];
      const eL = [(sL[0] + hl[0]) / 2 - 0.09, (sL[1] + hl[1]) / 2 - 0.15, (sL[2] + hl[2]) / 2 + 0.05];
      placeLimb(limbs.uR, sR, eR); placeLimb(limbs.fR, eR, hr);
      placeLimb(limbs.uL, sL, eL); placeLimb(limbs.fL, eL, hl);
      gloveR.position.set(hr[0], hr[1], hr[2]);
      gloveL.position.set(hl[0], hl[1], hl[2]);
    },
    // dt, горизонтальная скорость, наклон прицела, время
    update(dt, speed, pitch, time) {
      const k = Math.min(1, speed / 5.5);
      m.phase += speed * dt * 2.3;
      const ph = m.phase;
      for (let i = 0; i < 2; i++) {
        const p = ph + (i === 0 ? 0 : Math.PI);
        legs[i].hip.rotation.x = Math.sin(p) * 0.75 * k;
        legs[i].knee.rotation.x = Math.max(0, -Math.cos(p)) * 1.0 * k + 0.06;
      }
      body.position.y = 0.92 + Math.abs(Math.sin(ph)) * 0.035 * k - 0.0;
      torso.rotation.x = 0.06 * k;
      torso.rotation.z = Math.sin(ph) * 0.03 * k;
      chest.scale.y = 1 + Math.sin(time * 2.2) * 0.012;
      m.kick *= Math.exp(-dt * 14);
      aim.rotation.x = clampP(pitch) + m.kick * 0.07;
      slot.position.z = (guns[cur]?.userData.hold[2] ?? 0) + m.kick * 0.05;
      head.rotation.x = clampP(pitch) * 0.8;
      const fl = guns[cur]?.userData.flash;
      if (fl) {
        m.flashT -= dt;
        fl.visible = m.flashT > 0;
        if (fl.visible) fl.rotation.z = Math.random() * 6.28;
      }
    },
    // падение: age в секундах с момента смерти
    setDead(age) {
      const k = Math.min(1, age / 0.45);
      root.rotation.x = 1.45 * k;
      body.position.y = 0.92 - 0.05 * k;
      legs[0].knee.rotation.x = 0.5 * k; legs[1].knee.rotation.x = 0.9 * k;
      legs[0].hip.rotation.x = -0.2 * k; legs[1].hip.rotation.x = 0.3 * k;
    },
    revive() { root.rotation.x = 0; },
  };
  function clampP(v) { return Math.max(-1.1, Math.min(1.1, v)); }
  m.setWeapon(0);
  return m;
}

// ---------- оружие от первого лица ----------
export function buildViewmodel(index, sleeveColor) {
  const group = new THREE.Group();
  const gun = buildGun(index);
  group.add(gun);
  const ud = gun.userData;
  const glove = mat(C.glove, { phong: true, shin: 20 });
  const sleeve = mat(sleeveColor);
  const handR = new THREE.Group();
  box(handR, 0.075, 0.085, 0.11, glove, 0, 0, 0);
  box(handR, 0.02, 0.03, 0.07, glove, -0.04, 0.03, -0.01);
  group.add(handR);
  const handL = new THREE.Group();
  box(handL, 0.08, 0.075, 0.12, glove, 0, 0, 0);
  box(handL, 0.02, 0.03, 0.07, glove, 0.045, 0.03, -0.01);
  group.add(handL);
  const armR = makeLimb(0.05, 0.045, sleeve);
  const armL = makeLimb(0.05, 0.045, sleeve);
  group.add(armR); group.add(armL);
  const v = { group, gun, handR, handL, armR, armL, ud, index };
  animateViewmodel(v, {});
  return v;
}

// кусочно-линейная кривая: pts = [[p, значение], ...]
export function kf(p, pts) {
  if (p <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (p <= pts[i][0]) {
      const [p0, v0] = pts[i - 1], [p1, v1] = pts[i];
      return v0 + (v1 - v0) * ((p - p0) / (p1 - p0 || 1));
    }
  }
  return pts[pts.length - 1][1];
}
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (t) => t * t * (3 - 2 * t);

export function updateViewmodelArms(v) {
  const r = v.handR.position, l = v.handL.position;
  placeLimb(v.armR, [r.x + 0.01, r.y - 0.02, r.z + 0.03], [r.x + 0.06, r.y - 0.2, r.z + 0.62]);
  placeLimb(v.armL, [l.x - 0.01, l.y - 0.02, l.z + 0.03], [l.x - 0.09, l.y - 0.22, l.z + 0.62]);
}

// Состояние s: kick 0..1, ads 0..1, rl 0..1 (прогресс перезарядки, <0 если нет), swap 1..0,
// bob (фаза), k (степень движения 0..1), swx/swy (инерция взгляда), cyc 0..1 (цикл затвора/помпы), flash (сек)
export function animateViewmodel(v, s) {
  const ud = v.ud;
  const kick = s.kick || 0, ads = s.ads || 0, swap = s.swap || 0, k = s.k || 0;
  const rl = s.rl ?? -1;
  const p = rl >= 0 ? rl : 0;
  const reloading = rl >= 0;

  // базовая поза: от бедра к прицеливанию
  const hipX = 0.17, hipY = -0.17, hipZ = -0.36;
  let x = lerp(hipX, 0, ads), y = lerp(hipY, -ud.sightY, ads), z = lerp(hipZ, ud.adsZ, ads);
  const bobK = k * (1 - ads * 0.85);
  x += Math.sin(s.bob || 0) * 0.010 * bobK + (s.swx || 0) * (1 - ads * 0.7);
  y += Math.abs(Math.cos(s.bob || 0)) * 0.011 * bobK + (s.swy || 0) * (1 - ads * 0.7);
  z += kick * 0.055 * (1 - ads * 0.4);
  let rx = kick * 0.085 * (1 - ads * 0.5), rz = (s.roll || 0) * kick;
  let ry = 0;

  // смена оружия
  y -= swap * 0.32; rx -= swap * 0.7; ry += swap * 0.25;

  // перезарядка
  const T = reloading ? kf(p, [[0, 0], [0.12, 1], [0.85, 1], [1, 0]]) : 0;
  const mag = ud.mag, mover = ud.mover;
  let mvOff = 0;
  let lh = [ud.fore[0], ud.fore[1], ud.fore[2]];
  mag.visible = true;
  mag.position.set(0, 0, 0);
  if (reloading) {
    y -= T * 0.05; rx += T * 0.16; rz += T * 0.30; x -= T * 0.02;
    if (ud.type === 'mag' || ud.type === 'bolt') {
      const a = kf(p, [[0, 0], [0.12, 1], [0.8, 1], [1, 0]]);
      const dropF = kf(p, [[0, 0], [0.3, 0], [0.4, 1], [0.5, 1.5], [0.62, 1], [0.78, 0], [1, 0]]);
      const mp = kf(p, [[0, 0], [0.3, 0], [0.4, 1], [0.58, 1], [0.78, 0], [1, 0]]);
      for (let i = 0; i < 3; i++) lh[i] = lerp(ud.fore[i], ud.magHold[i], a) + ud.magDrop[i] * dropF * 0.9;
      mag.position.set(ud.magDrop[0] * mp, ud.magDrop[1] * mp, ud.magDrop[2] * mp);
      mag.visible = !(p > 0.42 && p < 0.56);
      // зарядка затвора в конце
      mvOff = kf(p, [[0, 0], [0.84, 0], [0.9, 1], [0.97, 0], [1, 0]]) * ud.travel * (ud.type === 'bolt' ? 1 : 0.9);
    } else { // дробовик: по одному патрону, затем помпа
      const a = kf(p, [[0, 0], [0.12, 1], [0.72, 1], [0.8, 0], [1, 0]]);
      const pulse = Math.max(0, Math.sin(p * Math.PI * 2 * 3.2)) * kf(p, [[0.1, 0], [0.16, 1], [0.7, 1], [0.76, 0]]);
      for (let i = 0; i < 3; i++) lh[i] = lerp(ud.fore[i], ud.magHold[i], a);
      lh[1] -= pulse * 0.07; lh[2] += pulse * 0.02;
      mvOff = kf(p, [[0.78, 0], [0.84, 1], [0.92, 0], [1, 0]]) * ud.travel * 0.9;
      lh[2] = lerp(lh[2], ud.fore[2] + mvOff, kf(p, [[0.76, 0], [0.8, 1], [0.95, 1], [1, 0]]));
      lh[1] = lerp(lh[1], ud.fore[1], kf(p, [[0.76, 0], [0.8, 1]]));
      lh[0] = lerp(lh[0], ud.fore[0], kf(p, [[0.76, 0], [0.8, 1]]));
    }
  } else if (s.cyc >= 0 && s.cyc <= 1) {
    mvOff = Math.sin(Math.PI * s.cyc) * ud.travel;
    if (ud.pumpHand) lh[2] += mvOff;
    if (ud.type === 'bolt') { /* затвор без руки */ }
  }
  mover.position.set(0, 0, mvOff);
  if (ud.type === 'bolt' && s.cyc >= 0 && s.cyc <= 1) {
    // винтовка: после выстрела немного приподнимаем ствол при передёргивании
    rx += Math.sin(Math.PI * s.cyc) * 0.05;
  }

  v.group.position.set(x, y, z);
  v.group.rotation.set(rx, ry, rz);
  v.handR.position.set(ud.grip[0], ud.grip[1], ud.grip[2]);
  v.handL.position.set(lh[0], lh[1], lh[2]);
  const fl = ud.flash;
  if (fl) {
    fl.visible = (s.flash || 0) > 0;
    if (fl.visible) { fl.rotation.z = Math.random() * 6.28; const q = (ud.flashSize || 1) * (0.75 + Math.random() * 0.5) * (1 - ads * 0.35); fl.scale.set(q, q, q); }
  }
  updateViewmodelArms(v);
}
