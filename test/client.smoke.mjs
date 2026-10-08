// Дымовой тест клиента: запускает настоящий public/client.js в Node с заглушками DOM/Three
// и подключает его к настоящему серверному Room (без сети, с виртуальным временем и задержкой ~50 мс).
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as S from '../public/shared.js';
import { Room } from '../game.js';

register('./three-hooks.mjs', import.meta.url);

// ---------- виртуальное время ----------
const T0 = 1_700_000_000_000;
let vt = T0;
Date.now = () => vt;
Object.defineProperty(globalThis, 'performance', { value: { now: () => vt - T0 }, configurable: true, writable: true });

// ---------- «всеядные» заглушки DOM ----------
function make(over = {}) {
  const cache = {};
  const f = function () {};
  return new Proxy(f, {
    get(_t, p) {
      if (p in over) return over[p];
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      if (p === Symbol.iterator) return undefined;
      return (cache[p] ??= make());
    },
    set(_t, p, v) { over[p] = v; cache[p] = v; return true; },
    apply() { return make(); },
    construct() { return make(); },
  });
}
const els = {};
function elem(id) {
  const handlers = {};
  return make({
    addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
    __h: handlers,
    value: id === 'nameInput' ? 'Тестер' : id === 'sens' ? '1' : '',
    setPointerCapture() {}, releasePointerCapture() {},
  });
}
const docHandlers = {};
globalThis.document = {
  getElementById: (id) => (els[id] ??= elem(id)),
  createElement: () => make({ getContext: () => make() }),
  addEventListener: (t, fn) => { (docHandlers[t] ??= []).push(fn); },
  body: make(),
  hidden: false,
  pointerLockElement: null,
  exitPointerLock() {},
};
const winHandlers = {};
globalThis.window = globalThis;
globalThis.addEventListener = (t, fn) => { (winHandlers[t] ??= []).push(fn); };
globalThis.innerWidth = 844; globalThis.innerHeight = 390; globalThis.devicePixelRatio = 2;
globalThis.matchMedia = () => ({ matches: true }); // тач-режим
globalThis.localStorage = { getItem: () => null, setItem() {} };
let rafCb = null;
globalThis.requestAnimationFrame = (fn) => { rafCb = fn; return 1; };

// ---------- «сеть»: клиент <-> настоящий Room ----------
const LAT = 3; // кадров задержки в каждую сторону (~50 мс)
let frameNo = 0;
const toClient = [];
const toServer = [];
const handlers = {};
let room = null;
let human = null;
const sent = [];
const received = {};

const serverSock = {
  emit: (ev, d) => toClient.push({ due: frameNo + LAT, ev, d: JSON.parse(JSON.stringify(d)) }),
};
serverSock.volatile = serverSock;

globalThis.io = () => ({
  connected: true,
  on: (ev, fn) => { handlers[ev] = fn; },
  emit: (ev, data, cb) => {
    sent.push(ev);
    if (ev === 'p') { cb?.(); return; }
    toServer.push({ due: frameNo + LAT, ev, data: JSON.parse(JSON.stringify(data)) });
  },
});

function pump() {
  for (let i = toServer.length - 1; i >= 0; i--) {
    const m = toServer[i];
    if (m.due > frameNo) continue;
    toServer.splice(i, 1);
    if (m.ev === 'join') {
      room = new Room(1);
      human = room.addHuman(serverSock, m.data.name);
      room.fillBots();
      serverSock.emit('welcome', room.welcome(human));
    } else if (m.ev === 'input' && human) room.queueInput(human, m.data);
  }
  toServer.sort((a, b) => a.due - b.due);
  while (toClient.length && toClient[0].due <= frameNo) {
    const m = toClient.shift();
    received[m.ev] = (received[m.ev] || 0) + 1;
    handlers[m.ev]?.(m.d);
  }
}

function runFrames(n) {
  for (let i = 0; i < n; i++) {
    vt += 1000 / 60;
    frameNo++;
    pump();
    if (frameNo % 2 === 0) room?.tick();
    rafCb(performance.now());
  }
}
const press = (code) => winHandlers.keydown.forEach((f) => f({ code, target: { tagName: 'BODY' }, preventDefault() {}, repeat: false }));
const release = (code) => winHandlers.keyup.forEach((f) => f({ code }));
const ptr = (id, type, extra = {}) => els[id].__h[type].forEach((f) => f({ pointerId: 1, clientX: 100, clientY: 100, preventDefault() {}, currentTarget: make(), ...extra }));

// ---------- запуск клиента ----------
await import('../public/client.js');
const A = globalThis.__arena;
assert.ok(rafCb, 'клиент не запустил цикл отрисовки');

// 1. Меню: орбитальная камера, ничего не падает.
runFrames(30);
assert.equal(A.joined, false);

// 2. Подключение.
els.playBtn.__h.click.forEach((f) => f({}));
runFrames(40);
assert.ok(sent.includes('join'), 'клиент не отправил join');
assert.equal(A.joined, true, 'welcome не обработан');
assert.ok(received.snap > 5, `снапшотов получено: ${received.snap}`);
assert.equal(A.remotes.size, S.MATCH.botsTotal - 1, `моделей других игроков: ${A.remotes.size}`);
assert.equal(A.alive, true);

// 3. Движение с предсказанием: идём вперёд, сервер и клиент должны сходиться.
const dir = human.team === 0 ? -Math.PI / 2 : Math.PI / 2;
A.view.yaw = dir;
human.z = 10; // свободная полоса
runFrames(10);
const x0 = A.me.x;
press('KeyW');
let maxJump = 0, aheadSum = 0, aheadN = 0, prevPos = { x: A.me.x, z: A.me.z };
for (let i = 0; i < 90; i++) {
  runFrames(1);
  maxJump = Math.max(maxJump, Math.hypot(A.me.x - prevPos.x, A.me.z - prevPos.z));
  prevPos = { x: A.me.x, z: A.me.z };
  const sm = A.buf.at(-1)?.me;
  if (i > 30 && sm) { aheadSum += Math.hypot(A.me.x - sm.x, A.me.z - sm.z); aheadN++; }
}
release('KeyW');
runFrames(20);
// предсказание: клиент идёт плавно и опережает последнее состояние сервера на неподтверждённые вводы
assert.ok(maxJump < 0.35, `клиент дёргается при реконсиляции: скачок ${maxJump.toFixed(2)} м за кадр`);
assert.ok(aheadSum / aheadN > 0.25, `нет упреждения предсказания: ${(aheadSum / aheadN).toFixed(2)} м`);
assert.ok(Math.abs(A.me.x - x0) > 4, `клиент не сдвинулся: ${x0} → ${A.me.x}`);
const err = Math.hypot(A.me.x - human.x, A.me.z - human.z);
assert.ok(err < 0.15, `рассинхрон предсказания с сервером: ${err.toFixed(3)} м`);
assert.ok(A.pending < 12, `очередь неподтверждённых вводов растёт: ${A.pending}`);

// 4. Стрельба через тач-кнопку: патроны уменьшаются и на сервере, и в HUD-данных клиента.
const mag0 = human.wp[0].mag;
runFrames(80); // дать защите спавна закончиться
ptr('bFire', 'pointerdown');
runFrames(25);
ptr('bFire', 'pointerup');
runFrames(10);
assert.ok(human.wp[0].mag < mag0, `сервер не списал патроны: ${human.wp[0].mag}`);
assert.ok(A.info.wp[0][0] < mag0, `клиент не видит расход патронов: ${A.info.wp[0][0]}`);
assert.ok(received.shot > 3, `событий shot: ${received.shot}`);

// 5. Смена оружия и перезарядка.
ptr('bWeapon', 'pointerdown'); ptr('bWeapon', 'pointerup');
runFrames(20);
assert.equal(A.weapon, 1);
assert.equal(human.weapon, 1, 'сервер не переключил оружие');
ptr('bReload', 'pointerdown'); ptr('bReload', 'pointerup');
runFrames(5);
ptr('bWeapon', 'pointerdown'); ptr('bWeapon', 'pointerup'); // 2 → дробовик
ptr('bWeapon', 'pointerdown'); ptr('bWeapon', 'pointerup'); // 0 → автомат
runFrames(10);
human.wp[0].mag = 5;
ptr('bReload', 'pointerdown'); ptr('bReload', 'pointerup');
runFrames(20);
assert.ok(human.reloading, 'перезарядка не началась');
runFrames(150);
assert.equal(human.wp[0].mag, 30, 'перезарядка не завершилась');

// 6. Таблица счёта (Tab) и тач-переключатель.
press('Tab'); runFrames(5); release('Tab'); runFrames(5);
ptr('bScore', 'pointerdown'); ptr('bScore', 'pointerup'); runFrames(5);
ptr('bScore', 'pointerdown'); ptr('bScore', 'pointerup'); runFrames(5);

// 7. Смерть и возрождение.
const killer = [...room.players.values()].find((p) => p.bot && p.team !== human.team);
human.protectUntil = 0;
room.damage(killer, human, 500, true);
runFrames(15);
assert.equal(A.alive, false, 'клиент не узнал о смерти');
assert.ok(received.kill >= 1, 'нет события kill');
runFrames(60 * 4);
assert.equal(A.alive, true, 'возрождение не дошло до клиента');
const err2 = Math.hypot(A.me.x - human.x, A.me.z - human.z);
assert.ok(err2 < 0.2, `после респавна позиция расходится: ${err2.toFixed(3)}`);
assert.equal(A.pending < 10, true);

// 8. Конец матча и новый матч.
room.endT = 0.05;
runFrames(30);
assert.ok(received.over >= 1, 'клиент не получил over');
runFrames(60 * (S.MATCH.over + 2));
assert.ok(received.start >= 1, 'клиент не получил start нового матча');
assert.equal(A.alive, true);

// 9. Долгий прогон: ничего не падает, нет NaN, очереди ограничены.
runFrames(60 * 20);
for (const v of [A.me.x, A.me.y, A.me.z, A.view.yaw, A.view.pitch]) assert.ok(Number.isFinite(v), 'NaN в состоянии клиента');
assert.ok(A.buf.length <= 40);

console.log(`client.smoke.mjs: все проверки пройдены (снапшотов ${received.snap}, выстрелов ${received.shot}, убийств ${received.kill})`);
process.exit(0);
