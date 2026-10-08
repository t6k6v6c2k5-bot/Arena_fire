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
    value: id === 'nameInput' ? 'Тестер' : id === 'sens' ? '1' : id === 'skill' ? '0' : '',
    setPointerCapture() {}, releasePointerCapture() {},
  });
}
const docHandlers = {};
globalThis.document = {
  getElementById: (id) => (els[id] ??= elem(id)),
  createElement: () => make({ getContext: () => make() }),
  addEventListener: (t, fn) => { (docHandlers[t] ??= []).push(fn); },
  body: make(),
  documentElement: make({ requestFullscreen: () => Promise.resolve() }),
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
let joinData = null;
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
      joinData = m.data;
      room = new Room(1, m.data.skill);
      human = room.addHuman(serverSock, m.data.name);
      human.assist = m.data.touch ? 1 : 0.3;
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

// ---------- поддельный AudioContext: считаем созданные узлы, чтобы проверить, что звуки реально синтезируются ----------
const audioStats = { osc: 0, src: 0 };
globalThis.AudioContext = function () {
  const base = { currentTime: 1, sampleRate: 8000, state: 'running', createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) };
  return new Proxy(base, {
    get: (t2, p) => {
      if (p in t2) return t2[p];
      if (p === 'destination') return make();
      if (p === 'createOscillator') return () => { audioStats.osc++; return make(); };
      if (p === 'createBufferSource') return () => { audioStats.src++; return make(); };
      return () => make();
    },
  });
};

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
assert.equal(joinData.touch, true, 'клиент не сообщил про тач-режим');
assert.equal(joinData.skill, 0, 'сложность ботов не передана');
assert.equal(room.skill.name, 'Лёгкие');
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

// 4b. Попадание по неподвижной цели через весь конвейер (тач-кнопка → сервер с лагом → hit у клиента).
{
  const enemy = [...room.players.values()].find((p) => p.bot && p.team !== human.team);
  enemy.bot = false; enemy.ai = null; enemy.protectUntil = 0; // стоит на месте
  human.protectUntil = 0;
  for (const p of room.players.values()) if (p !== enemy && p !== human) { p.x = 0; p.z = -20; p.vx = p.vz = 0; p.protectUntil = 0; }
  human.x = -10; human.z = 18; human.y = 0;
  enemy.x = 6; enemy.z = 18; enemy.y = 0; enemy.hp = 100; enemy.hist = [];
  A.view.yaw = -Math.PI / 2;
  A.view.pitch = Math.atan2(1.15 - S.PLAYER.eye, 16);
  const hitsBefore = received.hit || 0;
  runFrames(20);
  for (let i = 0; i < 25; i++) { human.hp = 1e6; if (i === 0) ptr('bFire', 'pointerdown'); runFrames(1); }
  ptr('bFire', 'pointerup');
  human.hp = 100;
  runFrames(10);
  assert.ok((received.hit || 0) - hitsBefore >= 2, `клиент не получил попаданий: ${(received.hit || 0) - hitsBefore}`);
  assert.ok(enemy.hp < 100 || !enemy.alive, 'враг не получил урон');
}

// 4c. Авто-огонь: враг под прицелом, кнопку огня не нажимаем — стрельба идёт сама; без врага под прицелом — нет.
{
  assert.equal(A.autoFire, true, 'на таче авто-огонь по умолчанию включён');
  const enemy = [...room.players.values()].find((p) => p.team !== human.team && p.alive);
  const saved = [...room.players.values()].filter((p) => p !== human).map((p) => [p, p.bot, p.ai]);
  for (const p of room.players.values()) if (p !== enemy && p !== human) { p.x = 0; p.z = -20; p.vx = p.vz = 0; p.protectUntil = 0; p.bot = false; p.ai = null; }
  enemy.bot = false; enemy.ai = null; enemy.protectUntil = 0; human.protectUntil = 0;
  human.x = -10; human.z = 18; human.y = 0; enemy.x = 6; enemy.z = 18; enemy.y = 0; enemy.hp = 100; enemy.hist = [];
  A.view.yaw = -Math.PI / 2; A.view.pitch = Math.atan2(1.15 - S.PLAYER.eye, 16);
  A.setAuto(false);
  runFrames(25);
  const before = human.wp[0].mag;
  runFrames(40);
  assert.equal(human.wp[0].mag, before, 'при выключенном авто-огне стрельбы быть не должно');
  A.setAuto(true);
  for (let i = 0; i < 40; i++) { human.hp = 1e6; A.view.yaw = -Math.PI / 2; A.view.pitch = Math.atan2(1.15 - S.PLAYER.eye, 16); runFrames(1); }
  human.hp = 100;
  assert.ok(human.wp[0].mag < before, 'авто-огонь не стрелял по врагу под прицелом');
  assert.ok(enemy.hp < 100 || !enemy.alive, 'авто-огонь не нанёс урон');
  // отвернулись — перестал
  A.view.yaw = Math.PI / 2;
  runFrames(10);
  const m1 = human.wp[0].mag;
  runFrames(40);
  assert.equal(human.wp[0].mag, m1, 'авто-огонь стреляет без цели');
  A.setAuto(true);
  for (const [p, bot, ai] of saved) { p.bot = bot; p.ai = ai; }
}

// 5. Смена оружия: панель внизу и клавиши 1–5, все пять видов.
ptr('wb1', 'pointerdown');
runFrames(20);
assert.equal(A.weapon, 1);
assert.equal(human.weapon, 1, 'сервер не переключил оружие');
for (let i = 0; i < S.WEAPONS.length; i++) {
  press('Digit' + (i + 1)); release('Digit' + (i + 1));
  runFrames(14);
  assert.equal(A.weapon, i, `клиент не выбрал оружие ${i}`);
  assert.equal(human.weapon, i, `сервер не выбрал оружие ${i}`);
}
// чужие модели показывают оружие из снапшота и не ломаются
for (const r of A.remotes.values()) {
  assert.ok(r.m.weapon >= 0 && r.m.weapon < S.WEAPONS.length, 'у модели нет оружия');
}

// 5a. Прицеливание: кнопка ◎ — сужение FOV, замедление, серверный флаг ads.
press('Digit1'); release('Digit1');
runFrames(20);
assert.equal(A.fov, 72, 'FOV вне прицела должен быть базовым');
ptr('bAds', 'pointerdown'); ptr('bAds', 'pointerup');
runFrames(40);
assert.ok(A.ads > 0.95, `ADS не включился: ${A.ads}`);
assert.ok(A.fov < 60, `FOV не сузился: ${A.fov}`);
assert.equal(human.ads, true, 'сервер не получил ads');
assert.equal(A.scoped, false, 'у автомата не должно быть оптики');
// стрельба в прицеле, потом выключаем (повторное нажатие)
ptr('bFire', 'pointerdown'); runFrames(10); ptr('bFire', 'pointerup'); runFrames(10);
ptr('bAds', 'pointerdown'); ptr('bAds', 'pointerup');
runFrames(40);
assert.ok(A.ads < 0.05 && A.fov > 71, 'ADS не выключился');
assert.equal(human.ads, false);

// 5b. Снайперка: оптика включается, вьюмодель скрывается; смена оружия снимает прицел.
press('Digit5'); release('Digit5'); runFrames(20);
ptr('bAds', 'pointerdown'); ptr('bAds', 'pointerup');
runFrames(60);
assert.equal(A.scoped, true, 'оптика снайперки не включилась');
assert.equal(A.vmShown, false, 'оружие должно прятаться в оптике');
assert.ok(Math.abs(A.fov - S.WEAPONS[4].zoom) < 2, `FOV в оптике: ${A.fov}`);
press('Digit1'); release('Digit1'); runFrames(30);
assert.equal(A.scoped, false);
assert.ok(A.ads < 0.1, 'смена оружия должна снимать прицел');

// 5c. Перезарядка: вьюмодель анимируется без NaN, звук механизма.
runFrames(10);
human.wp[0].mag = 5;
const oscBefore = audioStats.osc;
ptr('bReload', 'pointerdown'); ptr('bReload', 'pointerup');
runFrames(20);
assert.ok(human.reloading, 'перезарядка не началась');
for (let i = 0; i < 130; i++) {
  runFrames(1);
  const vp = A.vmPos;
  assert.ok(vp && Number.isFinite(vp.x) && Number.isFinite(vp.y) && Number.isFinite(vp.z), 'NaN в позе оружия при перезарядке');
}
assert.equal(human.wp[0].mag, 30, 'перезарядка не завершилась');
assert.ok(audioStats.osc > oscBefore, 'звуки перезарядки не синтезировались');

// 5d. Все виды оружия: выстрелы, перезарядки, ничего не падает и сцена без NaN.
function sceneIsFinite(o, depth = 0) {
  const p = o.position;
  if (p && typeof p.x === 'number') {
    for (const v of [p.x, p.y, p.z, o.scale.x, o.scale.y, o.scale.z, o.rotation.x, o.rotation.y, o.rotation.z]) if (!Number.isFinite(v)) return o;
  }
  for (const c of Array.isArray(o.children) ? o.children : []) { const bad = sceneIsFinite(c, depth + 1); if (bad) return bad; }
  return null;
}
for (let i = 0; i < S.WEAPONS.length; i++) {
  press('Digit' + (i + 1)); release('Digit' + (i + 1));
  runFrames(30);
  human.protectUntil = 0;
  const checkAll = (what) => {
    assert.equal(sceneIsFinite(A.scene), null, `NaN в сцене (${what}, оружие ${i})`);
    assert.equal(sceneIsFinite(A.vmScene), null, `NaN во вьюмодели (${what}, оружие ${i})`);
  };
  ptr('bFire', 'pointerdown');
  for (let f = 0; f < 30; f++) { runFrames(1); checkAll('стрельба'); }
  ptr('bFire', 'pointerup');
  ptr('bReload', 'pointerdown'); ptr('bReload', 'pointerup');
  for (let f = 0; f < 60 * Math.ceil(S.WEAPONS[i].reload) + 10; f++) { runFrames(1); if (f % 3 === 0) checkAll('перезарядка'); }
}
press('Digit1'); release('Digit1'); runFrames(30);

// 5e. Эффекты и звук.
assert.ok(audioStats.osc > 20 && audioStats.src > 20, `звуков синтезировано: osc ${audioStats.osc}, noise ${audioStats.src}`);
{
  const { surfaceInfo } = await import('../public/fx.js');
  assert.deepEqual(surfaceInfo(6, 1, -5, 0, -1, 0), { n: [0, 1, 0], c: 'crate' }, 'верх ящика');
  assert.deepEqual(surfaceInfo(0, 3, -22, 0, 0, -1), { n: [0, 0, 1], c: 'wall' }, 'внутренняя сторона стены');
  assert.deepEqual(surfaceInfo(10, 0, 10, 0, -1, 0).n, [0, 1, 0], 'пол');
}

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
