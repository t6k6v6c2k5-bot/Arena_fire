// Общее ядро: используется и сервером (авторитетная симуляция), и клиентом (предсказание движения).
// Должно быть детерминированным и не зависеть от DOM / Node-API.

export const TICK = 30;
export const DT = 1 / TICK;

export const PLAYER = { hw: 0.4, h: 1.8, eye: 1.62, speed: 6.2, jump: 6.8, gravity: 20 };

export const MATCH = {
  killLimit: 40,
  time: 300,       // секунд на матч
  respawn: 3,      // секунд до возрождения
  over: 10,        // пауза после матча
  protect: 2,      // защита после спавна
  botsTotal: 8,    // общее число игроков в комнате (люди + боты)
  maxHumans: 8,
};

export const TEAM_NAMES = ['СИНИЕ', 'КРАСНЫЕ'];

export const WEAPONS = [
  { id: 'rifle',   name: 'Автомат',  dmg: 26, rate: 0.10, mag: 30, reserve: 120, reload: 2.0, spread: 0.014, pellets: 1, auto: true,  head: 2.0, range: 150 },
  { id: 'pistol',  name: 'Пистолет', dmg: 34, rate: 0.28, mag: 12, reserve: 999, reload: 1.4, spread: 0.006, pellets: 1, auto: false, head: 2.2, range: 120 },
  { id: 'shotgun', name: 'Дробовик', dmg: 11, rate: 0.85, mag: 6,  reserve: 30,  reload: 2.6, spread: 0.075, pellets: 8, auto: false, head: 1.5, range: 40 },
];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const angDiff = (to, from) => wrapAngle(to - from);

// ---------- Карта ----------
// x,z — центр, w (по X), d (по Z), h — высота, y — основание.
function B(x, z, w, d, h, c = 'wall', y = 0) {
  return { x, y, z, w, h, d, c, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: y, y1: y + h };
}

export const MAP = { halfW: 32, halfD: 22 };

export const BOXES = [
  // внешние стены
  B(0, -22.5, 67, 1, 8), B(0, 22.5, 67, 1, 8), B(-32.5, 0, 1, 46, 8), B(32.5, 0, 1, 46, 8),
  // центральное здание и ящики вокруг
  B(0, 0, 6, 6, 3, 'building'),
  B(-6, 5, 2, 2, 1, 'crate'), B(6, -5, 2, 2, 1, 'crate'), B(-6, -5, 2, 2, 1, 'crate'), B(6, 5, 2, 2, 1, 'crate'),
  // стены полос
  B(-14, -10, 10, 1, 3), B(14, 10, 10, 1, 3), B(-14, 10, 1, 8, 3), B(14, -10, 1, 8, 3),
  B(-22, 0, 1, 10, 3), B(22, 0, 1, 10, 3),
  B(0, -12, 8, 1.5, 2), B(0, 12, 8, 1.5, 2),
  // колонны
  B(-8, -15, 2, 2, 4, 'pillar'), B(8, -15, 2, 2, 4, 'pillar'), B(-8, 15, 2, 2, 4, 'pillar'), B(8, 15, 2, 2, 4, 'pillar'),
  // укрытия у баз
  B(-26, -4, 1.5, 4, 2), B(-26, 4, 1.5, 4, 2), B(26, -4, 1.5, 4, 2), B(26, 4, 1.5, 4, 2),
  // низкие ящики (на них можно запрыгнуть)
  B(-12, 0, 2, 2, 1, 'crate'), B(12, 0, 2, 2, 1, 'crate'),
  B(-18, 16, 3, 2, 1, 'crate'), B(18, -16, 3, 2, 1, 'crate'), B(-18, -16, 3, 2, 1, 'crate'), B(18, 16, 3, 2, 1, 'crate'),
];

const spawnZ = [-16, -10, -4, 4, 10, 16];
export const SPAWNS = [
  spawnZ.map((z) => [-29.5, z]),
  spawnZ.map((z) => [29.5, z]),
];

function blockedAt(x, z, margin) {
  return BOXES.some((b) => Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin);
}

// Точки для навигации ботов
export const WAYPOINTS = (() => {
  const pts = [];
  for (let x = -29; x <= 29; x += 3.5) {
    for (let z = -19; z <= 19; z += 3.5) {
      if (!blockedAt(x, z, 1.0)) pts.push([x, z]);
    }
  }
  return pts;
})();

// ---------- Лучи ----------
export function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0;
  let tmax = Infinity;
  // X
  if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) return Infinity; }
  else {
    let t1 = (x0 - ox) / dx, t2 = (x1 - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  // Y
  if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return Infinity; }
  else {
    let t1 = (y0 - oy) / dy, t2 = (y1 - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  // Z
  if (Math.abs(dz) < 1e-9) { if (oz < z0 || oz > z1) return Infinity; }
  else {
    let t1 = (z0 - oz) / dz, t2 = (z1 - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// Ближайшее пересечение луча со статикой карты; если ближе maxD ничего нет — вернёт maxD.
export function rayWorld(ox, oy, oz, dx, dy, dz, maxD = Infinity) {
  let best = maxD;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    const t = rayAABB(ox, oy, oz, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
    if (t < best) best = t;
  }
  return best;
}

// ---------- Движение ----------
const STEP = 0.3;

function resolveH(p, axis) {
  const hw = PLAYER.hw;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    if (p.y >= b.y1 - 0.01 || p.y + PLAYER.h <= b.y0) continue;
    if (p.x + hw <= b.x0 || p.x - hw >= b.x1) continue;
    if (p.z + hw <= b.z0 || p.z - hw >= b.z1) continue;
    // «Подтяжка»: если до верха препятствия осталось меньше STEP — встаём на него, а не упираемся
    if (b.y1 - p.y <= STEP) { p.y = b.y1; if (p.vy < 0) p.vy = 0; continue; }
    if (axis === 'x') {
      p.x = p.x < b.x ? b.x0 - hw : b.x1 + hw;
      p.vx = 0;
    } else {
      p.z = p.z < b.z ? b.z0 - hw : b.z1 + hw;
      p.vz = 0;
    }
  }
}

function resolveV(p, prevY) {
  const hw = PLAYER.hw;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    if (p.x + hw <= b.x0 || p.x - hw >= b.x1) continue;
    if (p.z + hw <= b.z0 || p.z - hw >= b.z1) continue;
    if (p.vy <= 0) {
      if (prevY >= b.y1 - 0.01 && p.y < b.y1) {
        p.y = b.y1; p.vy = 0; p.onGround = true;
      }
    } else if (prevY + PLAYER.h <= b.y0 + 0.01 && p.y + PLAYER.h > b.y0) {
      p.y = b.y0 - PLAYER.h; p.vy = 0;
    }
  }
}

// inp: {mx, mz, yaw, jump}. mx — вправо, mz — вперёд. Фиксированный шаг DT.
export function stepPlayer(p, inp, dt = DT) {
  const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw);
  let mx = clamp(inp.mx || 0, -1, 1), mz = clamp(inp.mz || 0, -1, 1);
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const wx = (-sy * mz + cy * mx) * PLAYER.speed;
  const wz = (-cy * mz - sy * mx) * PLAYER.speed;
  const k = Math.min(1, (p.onGround ? 14 : 3) * dt);
  p.vx += (wx - p.vx) * k;
  p.vz += (wz - p.vz) * k;

  if (inp.jump && p.onGround) { p.vy = PLAYER.jump; p.onGround = false; }
  p.vy -= PLAYER.gravity * dt;

  p.x += p.vx * dt; resolveH(p, 'x');
  p.z += p.vz * dt; resolveH(p, 'z');

  const prevY = p.y;
  p.y += p.vy * dt;
  p.onGround = false;
  resolveV(p, prevY);
  if (p.y <= 0) { p.y = 0; if (p.vy < 0) p.vy = 0; p.onGround = true; }

  p.x = clamp(p.x, -MAP.halfW + PLAYER.hw, MAP.halfW - PLAYER.hw);
  p.z = clamp(p.z, -MAP.halfD + PLAYER.hw, MAP.halfD - PLAYER.hw);
}
