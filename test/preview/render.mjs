// Рисует модели игроков/оружия в SVG для визуальной проверки. Запуск: node --import ./register.mjs render.mjs out.svg [what]
import fs from 'node:fs';
import { mul, apply, Object3D, Mesh, Sprite } from './rec-three.mjs';
import * as M from '../../public/models.js';

const out = process.argv[2] || '/tmp/claude-0/preview.svg';
const what = process.argv[3] || 'players';

function collect(root, base = null) {
  const faces = [];
  (function walk(o, pm, vis) {
    const m = mul(pm, o.local());
    const v = vis && o.visible !== false;
    if (o instanceof Mesh && v && o.geometry?.attributes?.position?.array && !(o.material?.transparent && (o.material?.blending || o.material?.opacity < 1))) {
      const pa = o.geometry.attributes.position.array, ca = o.geometry.attributes.color?.array;
      const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
      for (let i = 0; i + 8 < pa.length; i += 9) {
        const p = [0, 1, 2].map((k) => apply(m, [pa[i + k * 3], pa[i + k * 3 + 1], pa[i + k * 3 + 2]]));
        let col = o.material?.col ?? 0x888888;
        if (ca) col = (Math.round(l2s(ca[i]) * 255) << 16) | (Math.round(l2s(ca[i + 1]) * 255) << 8) | Math.round(l2s(ca[i + 2]) * 255);
        faces.push({ p, col, tri: true });
      }
    } else if (o instanceof Mesh && v && o.geometry?.v && !(o.material?.transparent && (o.material?.blending || o.material?.opacity < 1))) {
      const g = o.geometry;
      const wv = g.v.map((p) => apply(m, p));
      const c = wv.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((x) => x / wv.length);
      for (const f of g.f) faces.push({ p: f.map((i) => wv[i]), c, col: o.material?.col ?? 0x888888 });
    }
    for (const ch of o.children) walk(ch, m, v);
  })(root, base || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], true);
  return faces;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };

// камера: yaw вокруг Y, pitch; смотрит на target с расстояния dist (перспектива)
function panel(root, { yaw = 0, pitch = 0.1, scale = 200, cx, cy, target = [0, 0.9, 0], dist = 6, w = 400, h = 460, label = '', base = null }) {
  const faces = collect(root, base);
  const cy_ = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const toCam = (p) => {
    let x = p[0] - target[0], y = p[1] - target[1], z = p[2] - target[2];
    let x1 = x * cy_ - z * sy, z1 = x * sy + z * cy_;
    let y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    return [x1, y2, z2]; // z2 > 0 — к камере
  };
  const L = norm([-0.5, 0.8, 0.6]);
  const items = [];
  for (const f of faces) {
    const q = f.p.map(toCam);
    if (q.length < 3) continue;
    let n = norm(cross(sub(q[1], q[0]), sub(q[2], q[0])));
    const fc0 = null;
    const cc = f.c ? toCam(f.c) : fc0;
    const fc = q.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((x) => x / q.length);
    if (!f.tri && dot(n, sub(fc, cc)) < 0) n = n.map((x) => -x);
    if (n[2] <= 0.0) continue; // обратная грань
    const depth = fc[2];
    const lit = 0.45 + 0.55 * Math.max(0, dot(n, L));
    const r = ((f.col >> 16) & 255) * lit, g = ((f.col >> 8) & 255) * lit, b = (f.col & 255) * lit;
    const pts = q.map((p) => { const k = dist / (dist - p[2]); return [cx + p[0] * scale * k, cy - p[1] * scale * k]; });
    items.push({ depth, pts, fill: `rgb(${r | 0},${g | 0},${b | 0})` });
  }
  items.sort((a, b) => a.depth - b.depth);
  let s = `<g><rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="#cfe0ee" stroke="#456"/><text x="${cx - w / 2 + 8}" y="${cy - h / 2 + 18}" font-size="14" fill="#123">${label}</text>`;
  s += `<clipPath id="c${Math.round(cx)}_${Math.round(cy)}"><rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}"/></clipPath><g clip-path="url(#c${Math.round(cx)}_${Math.round(cy)})">`;
  for (const it of items) s += `<polygon points="${it.pts.map((p) => p.map((x) => x.toFixed(1)).join(',')).join(' ')}" fill="${it.fill}" stroke="${it.fill}" stroke-width="0.6"/>`;
  return s + '</g></g>';
}

let svg = '', W = 0, H = 0;
if (what === 'players') {
  const cols = [];
  const views = [[0.0, 'спереди'], [Math.PI / 2, 'сбоку'], [Math.PI, 'сзади'], [0.6, '3/4']];
  H = 2 * 470 + 10; W = 4 * 410 + 10;
  [0, 1].forEach((team, r) => {
    const m = M.makePlayerModel(team, 'Тест');
    m.setWeapon(r === 0 ? 0 : 2);
    m.update(0.016, 0, 0, 0);
    views.forEach(([yaw, name], i) => { svg += panel(m.root, { yaw: yaw + Math.PI, pitch: 0.08, cx: 210 + i * 410, cy: 240 + r * 470, scale: 230, label: `команда ${team} · ${name}`, target: [0, 0.95, 0], dist: 7 }); });
  });
} else if (what === 'close') {
  W = 3 * 520 + 10; H = 540;
  const m = M.makePlayerModel(0, 'Анна'); m.setWeapon(0); m.update(0.016, 0, 0.0, 0);
  [[Math.PI, 'лицо'], [Math.PI * 1.25, '3/4'], [Math.PI / 2 + Math.PI, 'профиль']].forEach(([yaw, n], i) => {
    svg += panel(m.root, { yaw, pitch: 0.05, cx: 260 + i * 520, cy: 270, scale: 1100, w: 510, h: 530, label: n, target: [0, 1.52, 0], dist: 5 });
  });
} else if (what === 'running') {
  const poses = [0, 1.0, 2.0, 3.0];
  W = 4 * 410 + 10; H = 480;
  const m = M.makePlayerModel(0, 'Бег');
  m.setWeapon(1);
  poses.forEach((ph, i) => { m.phase = ph; m.update(0.0001, 6, 0.2, 0); svg += panel(m.root, { yaw: Math.PI / 2 + Math.PI, pitch: 0.05, cx: 210 + i * 410, cy: 240, scale: 230, label: `бег, фаза ${ph}`, target: [0, 0.95, 0], dist: 7 }); });
} else if (what === 'guns') {
  const n = 5; W = 2 * 640 + 10; H = 3 * 300 + 10;
  for (let i = 0; i < n; i++) {
    const g = M.buildGun(i);
    svg += panel(g, { yaw: Math.PI / 2 + 0.25, pitch: 0.12, cx: 320 + (i % 2) * 640, cy: 150 + Math.floor(i / 2) * 300, scale: 420, w: 630, h: 290, label: `оружие ${i}`, target: [0, 0, i === 1 ? 0 : i === 4 ? -0.3 : -0.2], dist: 5 });
  }
} else if (what === 'vm') {
  W = 3 * 520 + 10; H = 2 * 400 + 10;
  for (let i = 0; i < 5; i++) {
    const v = M.buildViewmodel(i, 0x2a4f8a);
    M.animateViewmodel(v, { ads: i === 4 ? 1 : 0, k: 0 });
    svg += panel(v.group, { yaw: Math.PI / 2 + 0.7, pitch: 0.15, cx: 260 + (i % 3) * 520, cy: 200 + Math.floor(i / 3) * 400, scale: 330, w: 510, h: 390, label: `вьюмодель ${i}`, target: [0.05, -0.1, -0.3], dist: 4 });
  }
  // перезарядка автомата
  const v = M.buildViewmodel(0, 0x2a4f8a); M.animateViewmodel(v, { rl: 0.5 });
  svg += panel(v.group, { yaw: Math.PI / 2 + 0.7, pitch: 0.15, cx: 260 + 2 * 520, cy: 600, scale: 330, w: 510, h: 390, label: 'перезарядка (50%)', target: [0.05, -0.1, -0.3], dist: 4 });
}
fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#9ab"/>${svg}</svg>`);
console.log('ok', out, W, H);
