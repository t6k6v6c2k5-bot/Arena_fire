// Построитель low-poly геометрии: примитивы запекаются в один меш на деталь (цвет — в вершинах),
// поэтому у модели десятки деталей, но лишь несколько вызовов отрисовки.
import * as THREE from 'three';

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexToLinear(hex) {
  return [s2l(((hex >> 16) & 255) / 255), s2l(((hex >> 8) & 255) / 255), s2l((hex & 255) / 255)];
}
export function shade(hex, k) {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 255) * k)));
  return (r << 16) | (g << 8) | b;
}

let matte = null, gloss = null;
export function matteMat() {
  return (matte ??= new THREE.MeshLambertMaterial({ vertexColors: true }));
}
export function glossMat() {
  return (gloss ??= new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x555555 }));
}

// Материалы для скинов оружия: множитель цвета + подсветка тёмных деталей + блеск. Кэшируются по id скина.
const skinCache = new Map();
export function skinMaterials(skin) {
  if (!skin || skin.id === 'gun_std') return null;
  let m = skinCache.get(skin.id);
  if (!m) {
    const [r, g, b] = skin.tint;
    const matte = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: skin.glow });
    const gloss = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: skin.shine, specular: 0x777777, emissive: skin.glow });
    for (const mat of [matte, gloss]) { mat.color.r = r; mat.color.g = g; mat.color.b = b; }
    m = { matte, gloss };
    skinCache.set(skin.id, m);
  }
  return m;
}
// Заменяет общие материалы на скиновые во всех мешах поддерева (геометрия остаётся общей).
export function applySkin(root, skin) {
  const sm = skinMaterials(skin);
  if (!sm) return root;
  const a = matteMat(), b = glossMat();
  const walk = (o) => {
    if (o.material === a) o.material = sm.matte; else if (o.material === b) o.material = sm.gloss;
    if (Array.isArray(o.children)) for (const c of o.children) walk(c);
  };
  walk(root);
  return root;
}

// матрица поворота (порядок XYZ, как в three): R = Rx·Ry·Rz
function rotM(rx, ry, rz) {
  const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
  return [
    c * e, -c * f, d,
    b * d * e + a * f, -b * d * f + a * e, -b * c,
    -a * d * e + b * f, a * d * f + b * e, a * c,
  ];
}

const FACES = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];

export class Part {
  // bevel — фаска на рёбрах параллелепипедов (даёт блики на гранях, как у настоящих деталей)
  constructor(bevel = 0) { this.pos = []; this.nor = []; this.col = []; this.bevel = bevel; }

  // низкоуровневая вставка треугольника (в локальных координатах примитива → в деталь)
  _tri(M, o, sc, a, b, c, na, nb, nc, rgb) {
    for (const [p, n] of [[a, na], [b, nb], [c, nc]]) {
      const x = p[0] * sc[0], y = p[1] * sc[1], z = p[2] * sc[2];
      this.pos.push(M[0] * x + M[1] * y + M[2] * z + o[0], M[3] * x + M[4] * y + M[5] * z + o[1], M[6] * x + M[7] * y + M[8] * z + o[2]);
      const nx = n[0] / sc[0], ny = n[1] / sc[1], nz = n[2] / sc[2];
      const tx = M[0] * nx + M[1] * ny + M[2] * nz, ty = M[3] * nx + M[4] * ny + M[5] * nz, tz = M[6] * nx + M[7] * ny + M[8] * nz;
      const l = Math.hypot(tx, ty, tz) || 1;
      this.nor.push(tx / l, ty / l, tz / l);
      // лёгкая фактура: шум по вершине + запечённое затенение снизу
      const wx = M[0] * x + M[1] * y + M[2] * z + o[0], wy = M[3] * x + M[4] * y + M[5] * z + o[1], wz = M[6] * x + M[7] * y + M[8] * z + o[2];
      const hsh = Math.sin(wx * 912.3 + wy * 421.7 + wz * 733.1) * 43758.5453;
      const noise = (hsh - Math.floor(hsh) - 0.5) * 0.09;
      const k = (1 + noise) * (0.88 + 0.12 * (0.5 + 0.5 * (ty / l)));
      this.col.push(rgb[0] * k, rgb[1] * k, rgb[2] * k);
    }
  }

  // параллелепипед w×h×d с центром в (x,y,z), повороты rx,ry,rz
  box(w, h, d, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    if (this.bevel > 0 && Math.min(w, h, d) > this.bevel * 3.4) return this._bbox(w, h, d, color, x, y, z, rx, ry, rz);
    const M = rotM(rx, ry, rz), o = [x, y, z], rgb = hexToLinear(color), hs = [w / 2, h / 2, d / 2];
    for (const [n, u, v] of FACES) {
      const ax = n[0] ? 0 : n[1] ? 1 : 2, au = u[0] ? 0 : u[1] ? 1 : 2, av = v[0] ? 0 : v[1] ? 1 : 2;
      const corner = (s1, s2) => {
        const p = [0, 0, 0];
        p[ax] = (n[0] + n[1] + n[2]) * hs[ax];
        p[au] = s1 * hs[au]; p[av] = s2 * hs[av];
        return p;
      };
      const c0 = corner(-1, -1), c1 = corner(1, -1), c2 = corner(1, 1), c3 = corner(-1, 1);
      this._tri(M, o, [1, 1, 1], c0, c1, c2, n, n, n, rgb);
      this._tri(M, o, [1, 1, 1], c0, c2, c3, n, n, n, rgb);
    }
    return this;
  }

  // параллелепипед с фасками: грани + полосы на рёбрах (светлее) + треугольники в углах
  _bbox(w, h, d, color, x, y, z, rx, ry, rz) {
    const c = this.bevel, M = rotM(rx, ry, rz), o = [x, y, z], sc = [1, 1, 1];
    const rgb = hexToLinear(color), rgbE = hexToLinear(shade(color, 1.42));
    const e = [w / 2, h / 2, d / 2];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const tri = (a, b, cc, n, col) => {
      const u = sub(b, a), v = sub(cc, a);
      const gx = u[1] * v[2] - u[2] * v[1], gy = u[2] * v[0] - u[0] * v[2], gz = u[0] * v[1] - u[1] * v[0];
      if (gx * n[0] + gy * n[1] + gz * n[2] < 0) { const t = b; b = cc; cc = t; }
      this._tri(M, o, sc, a, b, cc, n, n, n, col);
    };
    const quad = (p0, p1, p2, p3, n, col) => { tri(p0, p1, p2, n, col); tri(p0, p2, p3, n, col); };
    const P = (a, va, b, vb, t, vt) => { const p = [0, 0, 0]; p[a] = va; p[b] = vb; p[t] = vt; return p; };
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, t = (a + 2) % 3;
      for (const sa of [-1, 1]) {
        const n = [0, 0, 0]; n[a] = sa;
        const E = e[b] - c, T = e[t] - c;
        quad(P(a, sa * e[a], b, -E, t, -T), P(a, sa * e[a], b, E, t, -T), P(a, sa * e[a], b, E, t, T), P(a, sa * e[a], b, -E, t, T), n, rgb);
      }
    }
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, t = (a + 2) % 3;
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const n = [0, 0, 0]; n[a] = sa * 0.7071; n[b] = sb * 0.7071;
        const T = e[t] - c;
        quad(P(a, sa * e[a], b, sb * (e[b] - c), t, -T), P(a, sa * e[a], b, sb * (e[b] - c), t, T), P(a, sa * (e[a] - c), b, sb * e[b], t, T), P(a, sa * (e[a] - c), b, sb * e[b], t, -T), n, rgbE);
      }
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      tri([sx * e[0], sy * (e[1] - c), sz * (e[2] - c)], [sx * (e[0] - c), sy * e[1], sz * (e[2] - c)], [sx * (e[0] - c), sy * (e[1] - c), sz * e[2]], [sx * 0.577, sy * 0.577, sz * 0.577], rgbE);
    }
    return this;
  }

  // усечённый конус/цилиндр вдоль Y: rt — радиус сверху, rb — снизу; sx/sz — эллиптичность
  ty(rt, rb, h, color, x = 0, y = 0, z = 0, o = {}) {
    this._tube(rt, rb, h, color, x, y, z, o, false);
    return this;
  }
  // вдоль Z: rf — радиус на переднем (−Z) конце, rbk — на заднем (+Z)
  tz(rf, rbk, len, color, x = 0, y = 0, z = 0, o = {}) {
    this._tube(rbk, rf, len, color, x, y, z, o, true);
    return this;
  }
  _tube(rt, rb, h, color, x, y, z, o, alongZ) {
    const seg = o.seg ?? 10;
    let M = rotM(o.rx || 0, o.ry || 0, o.rz || 0);
    if (alongZ) { const Q = rotM(Math.PI / 2, 0, 0); M = matMul(M, Q); }
    const sc = [o.sx ?? 1, 1, o.sz ?? 1];
    if (alongZ) { sc[0] = o.sx ?? 1; sc[2] = o.sy ?? 1; } // для Z-трубы второй масштаб — по вертикали
    const org = [x, y, z], rgb = hexToLinear(color);
    const top = [], bot = [], nrm = [];
    const slope = (rb - rt) / h;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, sn = Math.sin(a), cs = Math.cos(a);
      top.push([sn * rt, h / 2, cs * rt]); bot.push([sn * rb, -h / 2, cs * rb]);
      nrm.push([sn, slope, cs]);
    }
    const flat = o.flat;
    for (let i = 0; i < seg; i++) {
      const n0 = nrm[i], n1 = nrm[i + 1];
      const fn = flat ? norm3([n0[0] + n1[0], slope * 2, n0[2] + n1[2]]) : null;
      this._tri(M, org, sc, top[i], bot[i], bot[i + 1], fn || n0, fn || n0, fn || n1, rgb);
      this._tri(M, org, sc, top[i], bot[i + 1], top[i + 1], fn || n0, fn || n1, fn || n1, rgb);
      if (rt > 0.0005) this._tri(M, org, sc, [0, h / 2, 0], top[i], top[i + 1], [0, 1, 0], [0, 1, 0], [0, 1, 0], rgb);
      if (rb > 0.0005) this._tri(M, org, sc, [0, -h / 2, 0], bot[i + 1], bot[i], [0, -1, 0], [0, -1, 0], [0, -1, 0], rgb);
    }
  }

  // эллипсоид (или купол при t1 < π)
  ball(r, color, x = 0, y = 0, z = 0, o = {}) {
    const ws = o.ws ?? 8, hs = o.hs ?? 6, t0 = o.t0 ?? 0, t1 = o.t1 ?? Math.PI;
    const M = rotM(o.rx || 0, o.ry || 0, o.rz || 0), sc = [o.sx ?? 1, o.sy ?? 1, o.sz ?? 1];
    const org = [x, y, z], rgb = hexToLinear(color);
    const P = (i, j) => {
      const a = (i / ws) * Math.PI * 2, t = t0 + (j / hs) * (t1 - t0);
      return [Math.sin(t) * Math.sin(a) * r, Math.cos(t) * r, Math.sin(t) * Math.cos(a) * r];
    };
    const N = (p) => norm3(p);
    for (let j = 0; j < hs; j++) {
      for (let i = 0; i < ws; i++) {
        const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j);
        if (!(j === hs - 1 && t1 >= Math.PI)) this._tri(M, org, sc, a, b, c, N(a), N(b), N(c), rgb);
        if (!(j === 0 && t0 <= 0)) this._tri(M, org, sc, a, c, d, N(a), N(c), N(d), rgb);
      }
    }
    return this;
  }

  append(o, dx = 0, dy = 0, dz = 0) {
    for (let i = 0; i < o.pos.length; i += 3) this.pos.push(o.pos[i] + dx, o.pos[i + 1] + dy, o.pos[i + 2] + dz);
    for (const v of o.nor) this.nor.push(v);
    for (const v of o.col) this.col.push(v);
    return this;
  }

  get empty() { return this.pos.length === 0; }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
  mesh(glossy = false) {
    const m = new THREE.Mesh(this.geometry(), glossy ? glossMat() : matteMat());
    return m;
  }
}

function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function matMul(A, B) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return r;
}

// геометрии кэшируются по ключу: одна и та же деталь делится между всеми игроками
const cache = new Map();
export function cachedGeo(key, build) {
  let g = cache.get(key);
  if (!g) { g = build().geometry(); cache.set(key, g); }
  return g;
}
export function cachedMesh(key, build, glossy = false) {
  return new THREE.Mesh(cachedGeo(key, build), glossy ? glossMat() : matteMat());
}
