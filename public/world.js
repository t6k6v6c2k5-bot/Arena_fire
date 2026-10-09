// Оформление арены из набора Kenney «Mini Arena» (CC0, www.kenney.nl).
// Здесь только расчёт: функция возвращает плоские массивы для одного BufferGeometry, поэтому
// вся арена рисуется одним вызовом отрисовки. Столкновения по-прежнему задают BOXES из shared.js,
// сюда они попадают лишь как «где стоит стена, ящик или колонна».

const rngOf = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// Размеры исходных деталей набора (метры): нужны, чтобы вписать их в размеры коллайдеров.
const WALL_T = 0.6, BLOCK_H = 0.5, COLUMN_W = 0.6, STATUE_H = 1.34, RACK_H = 0.47;

export function buildWorldMesh(kit, boxes, map, opts = {}) {
  const pos = [], nor = [], col = [], idx = [];
  const linear = opts.linear !== false;
  const rnd = rngOf(opts.seed ?? 11);

  // Деталь kit[name] с масштабом (sx,sy,sz), поворотом вокруг Y и сдвигом. tint — множитель яркости, recolor — замена цвета.
  function put(name, o) {
    const m = kit[name];
    if (!m) return;
    const { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rot = 0, tint = 1, recolor = null } = o;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const base = pos.length / 3;
    for (let v = 0; v < m.c.length; v++) {
      const px = m.p[v * 3] * sx, py = m.p[v * 3 + 1] * sy, pz = m.p[v * 3 + 2] * sz;
      pos.push(x + px * cs + pz * sn, y + py, z - px * sn + pz * cs);
      // нормаль при неравномерном масштабе делится на масштаб
      let nx = m.n[v * 3] / sx, ny = m.n[v * 3 + 1] / sy, nz = m.n[v * 3 + 2] / sz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      nor.push(nx * cs + nz * sn, ny, -nx * sn + nz * cs);
      const hex = m.c[v];
      let r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
      if (recolor) [r, g, b] = recolor(r, g, b);
      r = Math.min(1, r * tint); g = Math.min(1, g * tint); b = Math.min(1, b * tint);
      if (linear) { r = toLinear(r); g = toLinear(g); b = toLinear(b); }
      col.push(r, g, b);
    }
    for (const i of m.i) idx.push(base + i);
  }

  const inBox = (x, z, pad) => boxes.some((b) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad);
  const HW = map.halfW, HD = map.halfD;

  // ---- Пол: плитки 2×2 в шахматном порядке с лёгким разбросом яркости ----
  for (let ix = 0; ix < HW; ix++) {
    for (let iz = 0; iz < HD; iz++) {
      put('floor', { x: -HW + ix * 2 + 1, z: -HD + iz * 2 + 1, sx: 2, sz: 2, tint: ((ix + iz) & 1 ? 0.93 : 1.0) * (0.98 + rnd() * 0.04) });
    }
  }
  // трещины и кирпичная крошка на полу
  for (let k = 0, tries = 0; k < 46 && tries < 400; tries++) {
    const x = (rnd() * 2 - 1) * (HW - 2), z = (rnd() * 2 - 1) * (HD - 2);
    if (inBox(x, z, 0.6)) continue;
    put('floor-detail', { x, z, y: 0.002, sx: 1.4, sz: 1.4, rot: Math.floor(rnd() * 4) * Math.PI / 2, tint: 0.97 });
    k++;
  }

  // ---- Коллайдеры -> детали набора ----
  for (const b of boxes) {
    const alongX = b.w >= b.d;
    const len = alongX ? b.w : b.d, thick = alongX ? b.d : b.w;
    const rot = alongX ? 0 : Math.PI / 2;
    const cx = b.x, cz = b.z;
    if (b.c === 'wall') {
      // стена из секций: длина секции примерно равна высоте
      const n = Math.max(1, Math.round(len / Math.max(b.h, 1.5)));
      const seg = len / n;
      for (let i = 0; i < n; i++) {
        const off = -len / 2 + (i + 0.5) * seg;
        put('wall', { x: alongX ? cx + off : cx, y: b.y0, z: alongX ? cz : cz + off, sx: seg, sy: b.h, sz: thick / WALL_T, rot });
      }
    } else if (b.c === 'crate') {
      put('block', { x: cx, y: b.y0, z: cz, sx: b.w, sy: b.h / BLOCK_H, sz: b.d });
    } else if (b.c === 'pillar') {
      put('column', { x: cx, y: b.y0, z: cz, sx: b.w / COLUMN_W, sy: b.h, sz: b.d / COLUMN_W });
    } else if (b.c === 'building') {
      put('block', { x: cx, y: b.y0, z: cz, sx: b.w, sy: b.h / BLOCK_H, sz: b.d, tint: 0.92 });
      // бортик по краю крыши, кубок в центре, колонны по углам
      const top = b.y1, n = Math.round(b.w / 1.0);
      for (let i = 0; i < n; i++) {
        const off = -b.w / 2 + (i + 0.5) * (b.w / n);
        const e = b.w / 2 - 0.28;
        put('border-straight', { x: cx + off, y: top, z: cz - e, sx: b.w / n, sy: 1, sz: 0.5, rot: 0 });
        put('border-straight', { x: cx + off, y: top, z: cz + e, sx: b.w / n, sy: 1, sz: 0.5, rot: Math.PI });
        put('border-straight', { x: cx - e, y: top, z: cz + off, sx: b.d / n, sy: 1, sz: 0.5, rot: Math.PI / 2 });
        put('border-straight', { x: cx + e, y: top, z: cz + off, sx: b.d / n, sy: 1, sz: 0.5, rot: -Math.PI / 2 });
      }
      put('trophy', { x: cx, y: top, z: cz, sx: 3.2, sy: 3.2, sz: 3.2 });
      for (const [sx2, sz2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put('column', { x: cx + sx2 * (b.w / 2 - 0.9), y: top, z: cz + sz2 * (b.d / 2 - 0.9), sx: 1.4, sy: 1.5, sz: 1.4 });
    } else if (b.c === 'statue') {
      const s = b.h / STATUE_H;
      put('statue', { x: cx, y: b.y0, z: cz, sx: s, sy: s, sz: s, rot: cx < 0 ? Math.PI / 2 : -Math.PI / 2 });
    } else if (b.c === 'rack') {
      const s = b.h / RACK_H;
      put('weapon-rack', { x: cx, y: b.y0, z: cz, sx: s, sy: s, sz: s, rot: cz < 0 ? 0 : Math.PI });
    }
  }

  // ---- Баннеры и ворота на торцевых стенах, у баз команд ----
  const blue = (r, g, b) => (r > g * 1.4 && r > b * 1.4 ? [b * 0.9, g * 1.05, Math.min(1, r * 1.1)] : [r, g, b]);
  for (const side of [-1, 1]) {
    const face = side * (HW - 0.0);          // внутренняя грань торцевой стены
    const rot = side < 0 ? Math.PI / 2 : -Math.PI / 2;   // лицом в арену
    for (const z of [-15, -9, 9, 15]) {
      put('banner', { x: face - side * 0.12, y: 2.6, z, sx: 3, sy: 3, sz: 3, rot, recolor: side < 0 ? blue : null });
    }
    put('wall-gate', { x: face - side * 0.2, y: 0, z: 0, sx: 6, sy: 5.5, sz: 1, rot });
  }

  // ---- Деревья за стеной: макушки видны над ней ----
  for (let i = 0; i < 40; i++) {
    const t = i / 40, a = t * Math.PI * 2;
    const ring = 1 + Math.sin(i * 12.9898) * 0.5;
    // эллипс чуть больше арены, неровный
    const ex = Math.cos(a) * (HW + 5 + ring * 3), ez = Math.sin(a) * (HD + 5 + ring * 3);
    const s = 5 + rnd() * 2.2;
    put('tree', { x: ex, y: -0.03, z: ez, sx: s, sy: s, sz: s, rot: rnd() * 6.28, tint: 0.95 + rnd() * 0.1 });
  }

  // ---- Обломки: чуть оживляют пол в пустых местах ----
  for (let k = 0, tries = 0; k < 12 && tries < 200; tries++) {
    const x = (rnd() * 2 - 1) * (HW - 8), z = (rnd() * 2 - 1) * (HD - 3);
    if (inBox(x, z, 2.2) || Math.abs(x) > HW - 7) continue;
    put('bricks', { x, z, sx: 1, sy: 1, sz: 1, rot: rnd() * 6.28 });
    k++;
  }

  return { positions: pos, normals: nor, colors: col, indices: idx };
}
