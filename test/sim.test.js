// Юнит-проверки общего ядра: коллизии, прыжки, лучи, детерминизм.
import assert from 'node:assert/strict';
import * as S from '../public/shared.js';

const mk = (x, z) => ({ x, y: 0, z, vx: 0, vy: 0, vz: 0, onGround: true });
const run = (p, inp, steps) => { for (let i = 0; i < steps; i++) S.stepPlayer(p, inp); };

// 1. Игрок идёт вперёд (yaw=0 → -Z) и упирается в стену здания в центре (z от -3 до 3).
{
  const p = mk(0, -10);
  // центральная стена полосы B(0,-12,8,1.5,h=2) блокирует путь из -10 в -Z, идём к зданию (+Z): yaw=PI
  run(p, { mx: 0, mz: 1, yaw: Math.PI, jump: false }, 120);
  assert.ok(p.z <= -3.4 + 1e-6, `игрок прошёл сквозь здание: z=${p.z}`);
  assert.ok(p.z > -3.6, `игрок не дошёл до здания: z=${p.z}`);
}

// 2. Границы карты.
{
  const p = mk(0, 0);
  run(p, { mx: 1, mz: 0, yaw: 0, jump: false }, 600);
  assert.ok(p.x <= S.MAP.halfW - S.PLAYER.hw + 1e-6, `вышел за карту: x=${p.x}`);
}

// 3. Прыжок на низкий ящик (12,0, 2x2, h=1): подходим с юга (+Z), смотрим в -Z.
{
  const p = mk(12, 5);
  // идём в -Z (yaw=0, mz=1), прыгаем за ~1.2м до ящика
  let jumped = false;
  let stoodOnCrate = false;
  for (let i = 0; i < 90; i++) {
    const jump = !jumped && p.z < 2.9;
    if (jump) jumped = true;
    S.stepPlayer(p, { mx: 0, mz: 1, yaw: 0, jump });
    if (p.onGround && p.y >= 0.99 && p.y <= 1.01) stoodOnCrate = true;
  }
  assert.ok(stoodOnCrate, 'не запрыгнул на ящик');
}

// 4. Гравитация и приземление.
{
  const p = mk(-30, 18);
  p.y = 5; p.onGround = false;
  run(p, { mx: 0, mz: 0, yaw: 0, jump: false }, 90);
  assert.equal(p.y, 0);
  assert.ok(p.onGround);
}

// 5. Луч: попадает в здание, не попадает в пустоту.
{
  const t = S.rayWorld(0, 1.6, -10, 0, 0, 1, 100);
  assert.ok(Math.abs(t - 6.5) < 0.1 || t < 100, `луч в здание: t=${t}`);
  const miss = S.rayWorld(-30, 1.6, 0, 0, 1, 0, 50);
  assert.equal(miss, 50);
}

// 6. Детерминизм: одинаковые входы → одинаковое состояние (основа предсказания клиента).
{
  const a = mk(-29.5, -4), b = mk(-29.5, -4);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 600; i++) {
    const inp = { mx: rnd() * 2 - 1, mz: rnd() * 2 - 1, yaw: rnd() * 6, jump: rnd() < 0.05 };
    S.stepPlayer(a, inp); S.stepPlayer(b, JSON.parse(JSON.stringify(inp)));
  }
  assert.deepEqual(a, b);
}

// 7. Точки спавна и вейпоинты не внутри препятствий.
{
  for (const team of S.SPAWNS) for (const [x, z] of team) {
    assert.ok(!S.BOXES.some((b) => x > b.x0 - 0.4 && x < b.x1 + 0.4 && z > b.z0 - 0.4 && z < b.z1 + 0.4), `спавн в стене: ${x},${z}`);
  }
  assert.ok(S.WAYPOINTS.length > 50, `мало вейпоинтов: ${S.WAYPOINTS.length}`);
}

console.log('sim.test.js: все проверки пройдены');
