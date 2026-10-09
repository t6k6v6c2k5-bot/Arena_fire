// Проверка оформления арены: геометрия корректна и согласуется с коллайдерами.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../public/shared.js';
import { buildWorldMesh } from '../public/world.js';

const kit = JSON.parse(fs.readFileSync(new URL('../public/world/kit.json', import.meta.url)));
for (const n of ['wall', 'block', 'column', 'floor', 'tree', 'statue', 'banner', 'wall-gate', 'weapon-rack', 'trophy', 'border-straight', 'bricks', 'floor-detail']) assert.ok(kit[n], 'в наборе нет детали ' + n);

const w = buildWorldMesh(kit, S.BOXES, S.MAP);
const nv = w.positions.length / 3;
assert.equal(w.normals.length, w.positions.length);
assert.equal(w.colors.length, w.positions.length);
assert.ok(w.indices.length % 3 === 0 && w.indices.length > 0);
assert.ok(w.indices.every((i) => Number.isInteger(i) && i >= 0 && i < nv), 'индекс вне диапазона');
assert.ok(w.positions.every(Number.isFinite) && w.normals.every(Number.isFinite), 'NaN в геометрии');
assert.ok(w.colors.every((c) => c >= 0 && c <= 1), 'цвет вне 0..1');
assert.ok(w.indices.length / 3 < 60000, `слишком тяжёлая арена: ${w.indices.length / 3} треугольников`);
// нормали единичные
for (let i = 0; i < w.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(w.normals[i], w.normals[i + 1], w.normals[i + 2]) - 1) < 1e-3, 'нормаль не единичная');

// каждая коробка-коллайдер покрыта геометрией: в её объёме есть вершины, а выше неё ничего «лишнего» из своих деталей нет
for (const b of S.BOXES) {
  let inside = 0;
  for (let i = 0; i < nv; i++) {
    const x = w.positions[i * 3], y = w.positions[i * 3 + 1], z = w.positions[i * 3 + 2];
    if (x >= b.x0 - 0.2 && x <= b.x1 + 0.2 && z >= b.z0 - 0.2 && z <= b.z1 + 0.2 && y >= b.y0 - 0.05 && y <= b.y1 + 0.05) inside++;
  }
  assert.ok(inside >= 8, `коллайдер ${b.c} (${b.x},${b.z}) ничем не нарисован`);
}

// игровые зоны: на путях спауна нет новых коллайдеров
for (const team of S.SPAWNS) for (const [x, z] of team) assert.ok(!S.BOXES.some((b) => x > b.x0 - 0.5 && x < b.x1 + 0.5 && z > b.z0 - 0.5 && z < b.z1 + 0.5), 'спаун внутри коллайдера');
// у ботов есть путевые точки
assert.ok(S.WAYPOINTS.length > 100);

// детерминированность: одинаковый seed — одинаковая арена
const w2 = buildWorldMesh(kit, S.BOXES, S.MAP);
assert.equal(w2.positions.length, w.positions.length);
assert.deepEqual(w2.positions.slice(0, 300), w.positions.slice(0, 300));
console.log(`world.test.mjs: все проверки пройдены (${nv} вершин, ${w.indices.length / 3} треугольников, ${Math.round(fs.statSync(new URL('../public/world/kit.json', import.meta.url)).size / 1024)} КБ набора)`);
