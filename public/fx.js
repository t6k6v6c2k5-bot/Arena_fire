// Эффекты выстрела: трассеры, следы от пуль, частицы (пыль, искры, кровь), гильзы, дым.
import * as THREE from 'three';
import * as S from './shared.js';

const DEBRIS = { wall: 0xa9b3c0, crate: 0xc8964f, building: 0xd0705a, pillar: 0x8aa6c6, floor: 0x93a37f };

// Нормаль поверхности в точке попадания (по карте). Возвращает { n:[x,y,z], c: тип материала }.
export function surfaceInfo(px, py, pz, dx = 0, dy = 0, dz = 0) {
  const eps = 0.06;
  let best = Infinity, n = null, c = 'wall';
  if (py < eps) { best = Math.abs(py); n = [0, 1, 0]; c = 'floor'; }
  for (const b of S.BOXES) {
    if (px < b.x0 - eps || px > b.x1 + eps || py < b.y0 - eps || py > b.y1 + eps || pz < b.z0 - eps || pz > b.z1 + eps) continue;
    const cand = [
      [Math.abs(px - b.x0), -1, 0, 0], [Math.abs(px - b.x1), 1, 0, 0],
      [Math.abs(py - b.y1), 0, 1, 0], [Math.abs(py - b.y0), 0, -1, 0],
      [Math.abs(pz - b.z0), 0, 0, -1], [Math.abs(pz - b.z1), 0, 0, 1],
    ];
    for (const q of cand) {
      if (q[0] < best && q[0] < eps) { best = q[0]; n = [q[1], q[2], q[3]]; c = b.c; }
    }
  }
  if (!n) {
    const l = Math.hypot(dx, dy, dz) || 1;
    n = [-dx / l, -dy / l, -dz / l];
    if (!dx && !dy && !dz) n = [0, 1, 0];
  }
  return { n, c };
}

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(8,8,10,0.95)');
  gr.addColorStop(0.35, 'rgba(14,14,16,0.85)');
  gr.addColorStop(0.7, 'rgba(40,36,32,0.35)');
  gr.addColorStop(1, 'rgba(40,36,32,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createFx(scene) {
  const fx = { onCasingBounce: null };

  // ---------- частицы ----------
  const pGeo = new THREE.BoxGeometry(1, 1, 1);
  const parts = [];
  for (let i = 0; i < 140; i++) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    parts.push({ m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, g: 0, s0: 0.05, s1: 0.05, fade: true, bounce: false });
  }
  let pIdx = 0;
  function emit(x, y, z, vx, vy, vz, life, s0, s1, color, grav, opts = {}) {
    const p = parts[pIdx++ % parts.length];
    p.life = p.max = life; p.vx = vx; p.vy = vy; p.vz = vz; p.g = grav; p.s0 = s0; p.s1 = s1;
    p.fade = opts.fade !== false; p.bounce = !!opts.bounce; p.drag = opts.drag ?? 0; p.op = opts.op ?? 1;
    p.m.position.set(x, y, z);
    p.m.material.color.setHex(color);
    p.m.material.opacity = p.op;
    p.m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.m.scale.setScalar(s0);
    p.m.visible = true;
  }
  const rnd = (a) => (Math.random() - 0.5) * 2 * a;

  // ---------- следы от пуль ----------
  const holeTex = holeTexture();
  const decals = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    m.visible = false;
    scene.add(m);
    decals.push({ m, life: 0 });
  }
  let dIdx = 0;

  fx.impact = (x, y, z, dx, dy, dz, big = 1) => {
    const { n, c } = surfaceInfo(x, y, z, dx, dy, dz);
    const col = DEBRIS[c] ?? DEBRIS.wall;
    const d = decals[dIdx++ % decals.length];
    d.life = 14;
    d.m.position.set(x + n[0] * 0.012, y + n[1] * 0.012, z + n[2] * 0.012);
    d.m.lookAt(x + n[0], y + n[1], z + n[2]);
    d.m.rotateZ(Math.random() * 6.28);
    const sz = (0.12 + Math.random() * 0.06) * big;
    d.m.scale.set(sz, sz, 1);
    d.m.material.opacity = 1;
    d.m.visible = true;
    // пыль/щепки
    for (let i = 0; i < 4; i++) {
      emit(x + n[0] * 0.03, y + n[1] * 0.03, z + n[2] * 0.03,
        n[0] * 1.2 + rnd(0.7), n[1] * 1.2 + rnd(0.7) + 0.3, n[2] * 1.2 + rnd(0.7),
        0.55 + Math.random() * 0.3, 0.05, 0.22 * big, col, -0.3, { op: 0.6, drag: 2.5 });
    }
    // искры/осколки
    const sparkCol = c === 'crate' ? 0xd9a566 : 0xffd27a;
    for (let i = 0; i < 5; i++) {
      emit(x, y, z, n[0] * 3 + rnd(2.2), n[1] * 3 + rnd(2.2) + 0.8, n[2] * 3 + rnd(2.2),
        0.22 + Math.random() * 0.18, 0.035, 0.012, sparkCol, 9, { fade: false, bounce: c === 'crate' });
    }
  };

  fx.blood = (x, y, z, dx, dy, dz, head = false) => {
    const n = head ? 10 : 6;
    for (let i = 0; i < n; i++) {
      emit(x, y, z, dx * 1.5 + rnd(1.6), dy * 1.5 + rnd(1.6) + 1.0, dz * 1.5 + rnd(1.6),
        0.45 + Math.random() * 0.35, 0.05 + Math.random() * 0.04, 0.02, head && i % 2 ? 0xd01818 : 0x9b1111, 11, { fade: false, bounce: true });
    }
    emit(x, y, z, 0, 0.2, 0, 0.35, 0.08, 0.34, 0xa51414, 0, { op: 0.45 });
  };

  fx.smoke = (x, y, z, size = 1) => {
    emit(x, y, z, rnd(0.15), 0.35 + Math.random() * 0.2, rnd(0.15), 0.8, 0.03, 0.2 * size, 0xcfd3d8, -0.1, { op: 0.28, drag: 1 });
  };

  fx.death = (x, y, z) => {
    for (let i = 0; i < 12; i++) {
      emit(x, y + 1.1, z, rnd(2.5), 1 + Math.random() * 2, rnd(2.5), 0.6 + Math.random() * 0.4, 0.06, 0.02, 0x9b1111, 11, { fade: false, bounce: true });
    }
  };

  // ---------- трассеры (светящийся отрезок, летящий к цели) ----------
  const tGeo = new THREE.CylinderGeometry(1, 1, 1, 4, 1);
  tGeo.rotateX(Math.PI / 2);
  const tMat = new THREE.MeshBasicMaterial({ color: 0xffe3a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const tracers = [];
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(tGeo, tMat);
    m.rotation.order = 'YXZ';
    m.visible = false; m.frustumCulled = false;
    scene.add(m);
    tracers.push({ m, on: false, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, len: 0, head: 0, seg: 6, speed: 300 });
  }
  let tIdx = 0;
  fx.tracer = (a, b, speed = 300) => {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return;
    const t = tracers[tIdx++ % tracers.length];
    t.on = true; t.ox = a.x; t.oy = a.y; t.oz = a.z;
    t.dx = dx / len; t.dy = dy / len; t.dz = dz / len;
    t.len = len; t.head = 0; t.seg = Math.min(7, len * 0.5); t.speed = speed;
    t.m.visible = true;
  };

  // ---------- гильзы ----------
  const cGeo = new THREE.BoxGeometry(0.014, 0.014, 0.045);
  const cMat = new THREE.MeshBasicMaterial({ color: 0xd6a73e });
  const casings = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(cGeo, cMat);
    m.visible = false;
    scene.add(m);
    casings.push({ m, life: 0, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, bounces: 0 });
  }
  let cIdx = 0;
  fx.casing = (x, y, z, vx, vy, vz, big = false) => {
    const c = casings[cIdx++ % casings.length];
    c.life = 2.5; c.vx = vx; c.vy = vy; c.vz = vz; c.bounces = 0;
    c.sx = rnd(18); c.sy = rnd(18); c.sz = rnd(18);
    c.m.position.set(x, y, z);
    c.m.scale.setScalar(big ? 1.7 : 1);
    c.m.visible = true;
  };

  // ---------- обновление ----------
  fx.update = (dt, camPos) => {
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      const k = 1 - p.life / p.max;
      if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; p.vz *= f; }
      p.vy -= p.g * dt;
      const pos = p.m.position;
      pos.x += p.vx * dt; pos.y += p.vy * dt; pos.z += p.vz * dt;
      if (pos.y < 0.02) {
        if (p.bounce && p.vy < 0) { pos.y = 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; } else if (p.g > 0) { p.life = 0; p.m.visible = false; continue; }
      }
      p.m.scale.setScalar(p.s0 + (p.s1 - p.s0) * k);
      if (p.fade) p.m.material.opacity = p.op * (1 - k);
    }

    for (const d of decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) d.m.visible = false;
      else if (d.life < 2) d.m.material.opacity = d.life / 2;
    }

    for (const t of tracers) {
      if (!t.on) continue;
      t.head += t.speed * dt;
      const tail = Math.max(0, t.head - t.seg);
      if (tail >= t.len) { t.on = false; t.m.visible = false; continue; }
      const h = Math.min(t.head, t.len);
      const L = Math.max(0.05, h - tail);
      const mid = (h + tail) / 2;
      const px = t.ox + t.dx * mid, py = t.oy + t.dy * mid, pz = t.oz + t.dz * mid;
      t.m.position.set(px, py, pz);
      t.m.rotation.set(-Math.atan2(t.dy, Math.hypot(t.dx, t.dz)), Math.atan2(t.dx, t.dz), 0);
      const dist = camPos ? Math.hypot(px - camPos.x, py - camPos.y, pz - camPos.z) : 10;
      const r = 0.012 + dist * 0.0009;
      t.m.scale.set(r, r, L);
    }

    for (const c of casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.m.visible = false; continue; }
      c.vy -= 14 * dt;
      const pos = c.m.position;
      pos.x += c.vx * dt; pos.y += c.vy * dt; pos.z += c.vz * dt;
      if (pos.y < 0.01) {
        pos.y = 0.01;
        if (c.vy < -0.5 && c.bounces < 3) {
          if (c.bounces === 0) fx.onCasingBounce?.(pos.x, pos.z);
          c.bounces++;
          c.vy *= -0.35; c.vx *= 0.5; c.vz *= 0.5; c.sx *= 0.5; c.sy *= 0.5; c.sz *= 0.5;
        } else { c.vy = 0; c.vx *= 0.8; c.vz *= 0.8; c.sx = c.sy = c.sz = 0; }
      }
      c.m.rotation.x += c.sx * dt; c.m.rotation.y += c.sy * dt; c.m.rotation.z += c.sz * dt;
    }
  };

  fx.clear = () => {
    for (const p of parts) { p.life = 0; p.m.visible = false; }
    for (const d of decals) { d.life = 0; d.m.visible = false; }
    for (const t of tracers) { t.on = false; t.m.visible = false; }
    for (const c of casings) { c.life = 0; c.m.visible = false; }
  };

  return fx;
}
