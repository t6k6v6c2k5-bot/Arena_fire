// Процедурные low-poly модели игроков и оружия от первого лица. Без внешних ассетов:
// детали запекаются построителем (geo.js) в несколько мешей, цвет хранится в вершинах.
import * as THREE from 'three';
import { Part, cachedGeo, cachedMesh, glossMat, matteMat, shade } from './geo.js';
import { buildGun } from './guns.js';

export { buildGun };

// ---------- звено руки: единичная длина вдоль +Z, растягивается между двумя точками ----------
function limbMesh(kind, color) {
  const [rf, rb] = kind === 'up' ? [0.056, 0.047] : [0.047, 0.037];
  return cachedMesh(`limb${kind}${color}`, () => new Part().tz(rf, rb, 1, color, 0, 0, 0, { seg: 8 }));
}
export function placeLimb(m, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 0.001;
  m.rotation.order = 'YXZ';
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0);
  m.scale.set(1, 1, len);
}

const C = { glove: 0x1b1d21, boot: 0x17181b, sole: 0x3a3c40, vest: 0x2b3037, pouch: 0x383e47, plate: 0x424a54, pack: 0x434a3b, skin: [0xe2b896, 0xc89672, 0x9c6b48, 0x6d4630] };

// ---------- перчатка (с пальцами) ----------
function glovePart(left) {
  const p = new Part();
  const g = C.glove, g2 = shade(g, 1.6);
  p.box(0.074, 0.082, 0.07, g, 0, 0, 0);
  p.box(0.07, 0.014, 0.074, g2, 0, 0.044, 0);                                // костяшки
  for (let i = 0; i < 4; i++) p.box(0.062, 0.017, 0.034, g, 0, 0.032 - i * 0.021, -0.05); // пальцы
  for (let i = 0; i < 4; i++) p.box(0.056, 0.014, 0.012, g2, 0, 0.032 - i * 0.021, -0.07);
  p.box(0.022, 0.024, 0.06, g, left ? 0.044 : -0.044, 0.026, -0.02, 0, left ? -0.3 : 0.3, 0); // большой палец
  p.box(0.06, 0.05, 0.02, shade(g, 0.8), 0, -0.02, 0.045);                    // манжета
  return p;
}
const gloveMesh = (left) => cachedMesh(`glove${left ? 'L' : 'R'}`, () => glovePart(left));

// ---------- части тела (кэшируются по команде / тону кожи) ----------
function palette(team) {
  return team === 0
    ? { U: 0x3f72bd, UD: 0x2c5391, UL: 0x5a8ad0, helmet: 0x253a58, accent: 0x7db4ff, patch: 0x1d3a68 }
    : { U: 0xc04f43, UD: 0x8c362d, UL: 0xd96a5b, helmet: 0x55231f, accent: 0xff8c8c, patch: 0x5e211b };
}

function torsoPart(team) {
  const c = palette(team), p = new Part();
  p.ty(0.168, 0.172, 0.2, c.U, 0, 0.08, 0, { sz: 0.68, seg: 10 });               // живот
  p.ty(0.222, 0.19, 0.29, c.U, 0, 0.3, 0, { sz: 0.66, seg: 12 });                // грудь
  p.box(0.4, 0.07, 0.19, c.U, 0, 0.44, 0);                                       // трапеции
  p.ty(0.092, 0.1, 0.06, c.UD, 0, 0.478, 0, { seg: 10 });                        // воротник
  p.box(0.34, 0.31, 0.06, C.vest, 0, 0.28, -0.135);                              // броня спереди
  p.box(0.27, 0.25, 0.016, C.plate, 0, 0.3, -0.172);
  p.box(0.34, 0.3, 0.05, C.vest, 0, 0.28, 0.14);                                 // броня сзади
  for (const sx of [-1, 1]) {
    p.box(0.055, 0.26, 0.22, C.vest, sx * 0.19, 0.25, 0.0);                      // боковые панели
    p.box(0.1, 0.026, 0.24, C.vest, sx * 0.125, 0.455, 0.0);                     // лямки
    p.box(0.07, 0.012, 0.07, shade(C.vest, 1.5), sx * 0.125, 0.472, -0.07);
  }
  for (let i = -1; i <= 1; i++) {                                                // подсумки магазинов
    p.box(0.078, 0.105, 0.052, C.pouch, i * 0.108, 0.1, -0.2);
    p.box(0.08, 0.032, 0.056, shade(C.pouch, 0.75), i * 0.108, 0.148, -0.202);
    p.box(0.014, 0.02, 0.01, 0x9aa3ad, i * 0.108, 0.148, -0.232);
  }
  p.box(0.15, 0.07, 0.046, C.pouch, 0, 0.395, -0.185);                           // админ-подсумок
  p.box(0.152, 0.02, 0.05, shade(C.pouch, 0.75), 0, 0.425, -0.186);
  p.box(0.12, 0.034, 0.01, c.accent, 0, 0.345, -0.204);                          // полоса команды
  p.box(0.048, 0.1, 0.04, 0x1d2025, -0.17, 0.33, -0.15);                         // рация
  p.ty(0.005, 0.005, 0.14, 0x15171a, -0.17, 0.46, -0.15, { seg: 5 });
  p.box(0.07, 0.02, 0.07, 0x15171a, 0.15, 0.36, -0.17);                          // нашивка/фонарь
  // рюкзак
  p.box(0.3, 0.34, 0.12, C.pack, 0, 0.27, 0.22);
  p.box(0.28, 0.1, 0.13, shade(C.pack, 1.15), 0, 0.46, 0.225);
  p.box(0.26, 0.05, 0.002, shade(C.pack, 0.7), 0, 0.28, 0.282);
  for (const sx of [-1, 1]) { p.box(0.06, 0.15, 0.1, shade(C.pack, 0.9), sx * 0.18, 0.2, 0.22); p.box(0.04, 0.24, 0.02, 0x1d2025, sx * 0.1, 0.22, 0.285); }
  p.ty(0.05, 0.05, 0.3, 0x9d8b63, 0, 0.08, 0.27, { rz: Math.PI / 2, seg: 8 }); // скатка
  return p;
}
function pelvisPart(team) {
  const c = palette(team), p = new Part();
  p.ty(0.172, 0.168, 0.17, c.UD, 0, 0, 0, { sz: 0.7, seg: 10 });
  p.ty(0.178, 0.178, 0.05, 0x1c1e22, 0, 0.06, 0, { sz: 0.72, seg: 10 });          // ремень
  p.box(0.06, 0.04, 0.012, 0x9aa3ad, 0, 0.06, -0.133);                           // пряжка
  for (const sx of [-1, 1]) p.box(0.07, 0.09, 0.05, C.pouch, sx * 0.13, 0.025, -0.11, 0, sx * 0.4, 0);
  p.box(0.15, 0.1, 0.06, C.pouch, 0, 0.03, 0.15);
  p.box(0.16, 0.025, 0.065, shade(C.pouch, 0.7), 0, 0.075, 0.15);
  return p;
}
function headPart(skin) {
  const p = new Part();
  p.ty(0.047, 0.053, 0.1, shade(skin, 0.95), 0, -0.02, 0, { seg: 8 });
  p.ball(0.105, skin, 0, 0.1, 0, { sy: 1.08, sz: 1.04, ws: 10, hs: 8 });
  p.ball(0.075, skin, 0, 0.05, -0.028, { sy: 0.82, ws: 8, hs: 6 });
  p.box(0.06, 0.034, 0.05, skin, 0, 0.012, -0.07);
  p.box(0.022, 0.032, 0.032, shade(skin, 0.92), 0, 0.085, -0.115);                 // нос
  for (const sx of [-1, 1]) {
    p.box(0.016, 0.05, 0.03, shade(skin, 0.94), sx * 0.106, 0.1, 0.0);              // уши
    p.box(0.03, 0.014, 0.006, 0xe9e6e0, sx * 0.041, 0.118, -0.1);                   // глаза
    p.box(0.014, 0.014, 0.007, 0x3a2f28, sx * 0.041, 0.118, -0.103);
    p.box(0.048, 0.01, 0.01, shade(skin, 0.45), sx * 0.042, 0.142, -0.1);           // брови
  }
  p.box(0.042, 0.007, 0.006, 0x6a3d36, 0, 0.044, -0.108);                          // рот
  p.box(0.07, 0.03, 0.02, shade(skin, 0.8), 0, 0.02, -0.1);                         // щетина
  return p;
}
function helmetPart(team) {
  const c = palette(team), p = new Part();
  p.ball(0.128, c.helmet, 0, 0.152, 0.004, { t1: Math.PI * 0.55, sy: 0.92, ws: 12, hs: 6 });
  p.ty(0.133, 0.131, 0.02, shade(c.helmet, 0.8), 0, 0.152, 0.004, { seg: 12 });
  p.box(0.21, 0.1, 0.06, c.helmet, 0, 0.1, 0.105);                               // затыльник
  p.box(0.17, 0.016, 0.06, shade(c.helmet, 1.2), 0, 0.158, -0.12, -0.12);         // козырёк
  for (const sx of [-1, 1]) {
    p.box(0.012, 0.03, 0.1, 0x9aa3ad, sx * 0.13, 0.18, -0.01);                     // рельсы
    p.ty(0.04, 0.04, 0.034, 0x15171a, sx * 0.118, 0.08, 0.0, { rz: Math.PI / 2, seg: 10 }); // наушники
    p.box(0.008, 0.07, 0.012, 0x141619, sx * 0.1, 0.035, -0.05, 0, 0, sx * 0.2);    // подбородочный ремень
  }
  p.box(0.12, 0.008, 0.02, 0x141619, 0, -0.025, -0.08);
  p.box(0.05, 0.04, 0.035, 0x1d2025, 0, 0.2, -0.125);                            // крепление ПНВ
  p.box(0.1, 0.04, 0.05, 0x23272d, 0, 0.25, -0.1, -0.7);                         // поднятый ПНВ
  for (const sx of [-1, 1]) p.ty(0.017, 0.017, 0.03, 0x111418, sx * 0.028, 0.262, -0.12, { rx: 0.9, seg: 8 });
  p.box(0.11, 0.006, 0.05, shade(c.helmet, 1.45), -0.02, 0.268, -0.02, 0, 0.3, 0);   // камуфляжные пятна
  p.box(0.07, 0.006, 0.045, shade(c.helmet, 0.6), 0.04, 0.262, 0.05, 0, -0.4, 0);
  return p;
}
function glassesPart() {
  const p = new Part();
  p.box(0.19, 0.01, 0.012, 0x0c0e11, 0, 0.1385, -0.106);
  p.box(0.19, 0.008, 0.012, 0x0c0e11, 0, 0.098, -0.106);
  for (const sx of [-1, 1]) {
    p.box(0.008, 0.045, 0.012, 0x0c0e11, sx * 0.085, 0.118, -0.106);
    p.box(0.008, 0.045, 0.012, 0x0c0e11, sx * 0.0, 0.118, -0.106);
    p.box(0.01, 0.01, 0.1, 0x0c0e11, sx * 0.1, 0.125, -0.058);
  }
  return p;
}
function thighPart(team, side) {
  const c = palette(team), p = new Part();
  p.ball(0.088, c.UD, 0, 0, 0, { ws: 8, hs: 6 });
  p.ty(0.082, 0.066, 0.46, c.UD, 0, -0.23, 0, { sz: 0.95, seg: 9 });
  p.box(0.036, 0.15, 0.12, shade(c.UD, 0.85), side * 0.082, -0.2, -0.01);          // карман
  p.box(0.038, 0.04, 0.125, c.UD, side * 0.084, -0.13, -0.01);
  p.box(0.01, 0.02, 0.02, 0x9aa3ad, side * 0.103, -0.13, -0.07);
  p.box(0.05, 0.06, 0.06, c.patch, -side * 0.055, -0.12, -0.045);                  // камуфляж
  p.box(0.045, 0.05, 0.05, shade(c.UL, 0.9), -side * 0.03, -0.3, -0.05);
  p.box(0.045, 0.06, 0.05, c.patch, side * 0.02, -0.3, 0.06);
  if (side > 0) { // кобура
    p.box(0.048, 0.16, 0.09, 0x16181b, 0.108, -0.12, 0.0);
    p.box(0.052, 0.035, 0.095, 0x25282d, 0.108, -0.05, 0.0);
    p.box(0.1, 0.02, 0.1, 0x16181b, 0.06, -0.2, 0.0);
  }
  return p;
}
function shinPart(team) {
  const c = palette(team), p = new Part();
  p.ball(0.068, c.UD, 0, 0, 0, { ws: 8, hs: 6 });
  p.box(0.086, 0.1, 0.05, C.vest, 0, -0.012, -0.064);                              // наколенник
  p.box(0.07, 0.07, 0.02, C.plate, 0, -0.012, -0.093);
  p.ty(0.062, 0.047, 0.34, c.UD, 0, -0.17, 0, { seg: 9 });
  p.box(0.045, 0.05, 0.05, c.patch, 0.02, -0.15, 0.04);
  p.ty(0.056, 0.063, 0.17, C.boot, 0, -0.325, 0, { seg: 9 });                       // голенище
  p.box(0.03, 0.12, 0.012, 0x24262a, 0, -0.325, -0.065);                            // шнуровка
  p.box(0.106, 0.07, 0.27, C.boot, 0, -0.395, -0.05);                               // ступня
  p.box(0.098, 0.05, 0.07, shade(C.boot, 1.7), 0, -0.405, -0.17);                   // носок
  p.box(0.11, 0.022, 0.29, C.sole, 0, -0.429, -0.05);                               // подошва
  p.box(0.104, 0.034, 0.06, C.sole, 0, -0.405, 0.075);                              // каблук
  return p;
}
function elbowPart(team) { const c = palette(team); return new Part().ball(0.055, c.UD, 0, 0, 0, { ws: 8, hs: 6 }).box(0.07, 0.05, 0.05, C.vest, 0, 0.0, 0.03); }
function shoulderPart(team) {
  const c = palette(team);
  return new Part().ball(0.07, c.U, 0, 0, 0, { ws: 8, hs: 6 }).box(0.1, 0.012, 0.11, c.accent, 0, 0.065, 0).box(0.09, 0.02, 0.1, C.vest, 0, 0.056, 0);
}
function shadowPart() { return new Part().ty(0.42, 0.42, 0.004, 0x000000, 0, 0, 0, { seg: 16 }); }

let shadowMat = null;

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

const hashName = (s) => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };

export function makePlayerModel(team, name) {
  const c = palette(team);
  const skin = C.skin[hashName(name) % C.skin.length];
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.92;
  root.add(body);

  // тень-пятно под ногами
  shadowMat ??= new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false });
  const sh = new THREE.Mesh(cachedGeo('shadow', shadowPart), shadowMat);
  sh.position.y = 0.02;
  root.add(sh);

  body.add(cachedMesh(`pelvis${team}`, () => pelvisPart(team)));
  const torso = new THREE.Group();
  torso.position.y = 0.08;
  body.add(torso);
  const chest = cachedMesh(`torso${team}`, () => torsoPart(team));
  torso.add(chest);

  const head = new THREE.Group();
  head.position.set(0, 0.57, 0);
  body.add(head);
  head.add(cachedMesh(`head${team}_${skin}`, () => new Part().append(headPart(skin)).append(helmetPart(team)).append(glassesPart())));

  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, -0.04, 0);
    body.add(hip);
    hip.add(cachedMesh(`thigh${team}_${side}`, () => thighPart(team, side)));
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    hip.add(knee);
    knee.add(cachedMesh(`shin${team}`, () => shinPart(team)));
    legs.push({ hip, knee });
  }

  // торс-вращатель с руками и оружием (наклоняется по pitch)
  const aim = new THREE.Group();
  aim.position.set(0, 0.46, 0);
  body.add(aim);
  const slot = new THREE.Group();
  aim.add(slot);
  const limbs = {
    uR: limbMesh('up', c.U), fR: limbMesh('fore', c.U), uL: limbMesh('up', c.U), fL: limbMesh('fore', c.U),
  };
  const gloveR = gloveMesh(false), gloveL = gloveMesh(true);
  const elbR = cachedMesh(`elbow${team}`, () => elbowPart(team)), elbL = cachedMesh(`elbow${team}`, () => elbowPart(team));
  aim.add(cachedMesh(`shoulders${team}`, () => new Part().append(shoulderPart(team), 0.235, 0, 0).append(shoulderPart(team), -0.235, 0, 0)));
  for (const o of [...Object.values(limbs), gloveR, gloveL, elbR, elbL]) aim.add(o);

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
      const sR = [0.235, 0, 0], sL = [-0.235, 0, 0];
      const eR = [(sR[0] + hr[0]) / 2 + 0.1, (sR[1] + hr[1]) / 2 - 0.16, (sR[2] + hr[2]) / 2 + 0.08];
      const eL = [(sL[0] + hl[0]) / 2 - 0.1, (sL[1] + hl[1]) / 2 - 0.16, (sL[2] + hl[2]) / 2 + 0.05];
      placeLimb(limbs.uR, sR, eR); placeLimb(limbs.fR, eR, hr);
      placeLimb(limbs.uL, sL, eL); placeLimb(limbs.fL, eL, hl);
      elbR.position.set(eR[0], eR[1], eR[2]); elbL.position.set(eL[0], eL[1], eL[2]);
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
      body.position.y = 0.92 + Math.abs(Math.sin(ph)) * 0.035 * k;
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
      sh.visible = age < 0.4;
    },
    revive() { root.rotation.x = 0; sh.visible = true; },
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
  const handR = new THREE.Group();
  handR.add(gloveMesh(false));
  group.add(handR);
  const handL = new THREE.Group();
  handL.add(gloveMesh(true));
  group.add(handL);
  const armR = limbMesh('fore', sleeveColor);
  const armL = limbMesh('fore', sleeveColor);
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
