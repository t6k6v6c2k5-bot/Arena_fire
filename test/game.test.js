// Тест серверной логики без сети: комнаты, боты, хитскан, лаг-компенсация, матч, проверка Telegram.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as S from '../public/shared.js';
import { Room, Player } from '../game.js';
import { verifyInitData } from '../auth.js';

function fakeSock() {
  const s = { events: [], last: {} };
  s.emit = (ev, data) => { s.events.push([ev, data]); s.last[ev] = data; };
  s.volatile = { emit: s.emit };
  s.count = (ev) => s.events.filter((e) => e[0] === ev).length;
  return s;
}
const tickN = (room, n) => { for (let i = 0; i < n; i++) room.tick(); };

// 1. Комната, боты и баланс команд.
{
  const room = new Room(1);
  const sock = fakeSock();
  const me = room.addHuman(sock, 'Тест');
  room.fillBots();
  assert.equal(room.players.size, S.MATCH.botsTotal);
  assert.equal(room.teamCount(0), 4);
  assert.equal(room.teamCount(1), 4);
  // второй человек вытесняет бота
  const sock2 = fakeSock();
  room.addHuman(sock2, 'Второй');
  room.fillBots();
  assert.equal(room.players.size, S.MATCH.botsTotal);
  assert.equal(room.bots().length, 6);
  room.removePlayer(me.id);
  room.fillBots();
  assert.equal(room.players.size, S.MATCH.botsTotal);
}

// 2. Ввод человека: ack растёт, позиция меняется, снапшоты корректны.
{
  const room = new Room(2);
  const sock = fakeSock();
  const me = room.addHuman(sock, 'Бегун');
  room.fillBots();
  me.z = 10; // свободная полоса, чтобы не упереться в укрытие у базы
  const x0 = me.x;
  const dir = me.team === 0 ? -Math.PI / 2 : Math.PI / 2; // лицом к центру
  for (let seq = 1; seq <= 30; seq++) {
    me.queue.push({ seq, mx: 0, mz: 1, yaw: dir, pitch: 0, jump: false, fire: false, reload: false, weapon: 0, rt: Date.now() });
    room.tick();
  }
  assert.equal(me.ack, 30, `ack=${me.ack}`);
  assert.ok(Math.abs(me.x - x0) > 3, `игрок не сдвинулся: ${x0} → ${me.x}`);
  const snap = sock.last.snap;
  assert.ok(snap && snap.me && snap.p.length === S.MATCH.botsTotal);
  assert.equal(snap.ack, 30);
  for (const row of snap.p) for (const v of row) assert.ok(Number.isFinite(v), 'NaN в снапшоте');
  assert.equal(sock.count('roster') >= 1, true);
}

// 3. Хитскан: попадание, урон, убийство, счёт, событие kill.
function duel() {
  const room = new Room(3);
  const sockA = fakeSock(), sockB = fakeSock();
  const a = new Player('Стрелок', 0, false, sockA);
  const b = new Player('Цель', 1, false, sockB);
  room.players.set(a.id, a); room.players.set(b.id, b);
  room.spawn(a); room.spawn(b);
  for (const p of [a, b]) { p.protectUntil = 0; p.nextFire = 0; }
  a.x = -10; a.z = 18; a.yaw = -Math.PI / 2; a.pitch = Math.atan2(1.15 - S.PLAYER.eye, 15);
  b.x = 5; b.z = 18;
  return { room, a, b, sockA, sockB };
}
{
  const { room, a, b, sockA, sockB } = duel();
  room.fire(a, Date.now());
  assert.equal(b.hp, 100 - 26, `урон по корпусу: hp=${b.hp}`);
  assert.equal(sockA.count('hit'), 1);
  assert.equal(sockB.count('hurt'), 1);
  assert.equal(sockA.count('shot'), 1);
  // добиваем
  let guard = 0;
  while (b.alive && guard++ < 40) { a.nextFire = 0; room.fire(a, Date.now()); if (a.wp[0].mag === 0) a.wp[0].mag = 30; a.reloading = false; }
  assert.ok(!b.alive, 'цель не убита');
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
  assert.equal(room.scores[0], 1);
  const kill = sockA.events.find((e) => e[0] === 'kill')[1];
  assert.equal(kill.k, a.id); assert.equal(kill.v, b.id);
}

// 4. Огонь по своим не проходит; защита после спавна работает.
{
  const { room, a, b } = duel();
  b.team = 0;
  room.fire(a, Date.now());
  assert.equal(b.hp, 100, 'friendly fire');
  b.team = 1; b.protectUntil = room.t + 5; a.nextFire = 0;
  room.fire(a, Date.now());
  assert.equal(b.hp, 100, 'урон по защищённому игроку');
}

// 5. Лаг-компенсация: цель была на линии 100 мс назад, сейчас ушла в сторону.
{
  const { room, a, b } = duel();
  const now = Date.now();
  b.z = 21; // «сейчас» цель в стороне от линии огня
  b.hist = [{ ts: now - 150, x: 5, y: 0, z: 18 }, { ts: now - 50, x: 5, y: 0, z: 18 }];
  const pos = room.posAt(b, now - 100);
  assert.ok(Math.abs(pos.z - 18) < 1e-6, `posAt z=${pos.z}`);
  room.fire(a, now - 100);
  assert.equal(b.hp, 74, `с компенсацией должно быть попадание, hp=${b.hp}`);
  a.nextFire = 0;
  room.fire(a, now);
  assert.equal(b.hp, 74, 'без компенсации выстрел должен пройти мимо');
}

// 6. Перезарядка и боезапас.
{
  const { room, a } = duel();
  a.wp[0].mag = 3;
  for (let i = 0; i < 3; i++) { a.nextFire = 0; room.fire(a, Date.now()); }
  assert.equal(a.wp[0].mag, 0);
  assert.ok(a.reloading, 'автоперезарядка не началась');
  const res0 = a.wp[0].res;
  a.alive = true;
  tickN(room, Math.ceil(S.WEAPONS[0].reload / S.DT) + 3);
  assert.ok(!a.reloading);
  assert.equal(a.wp[0].mag, 30);
  assert.equal(a.wp[0].res, res0 - 30);
}

// 7. Дробовик: несколько дробин, урон складывается.
{
  const { room, a, b } = duel();
  a.weapon = 2; a.x = b.x - 4; a.pitch = Math.atan2(1.15 - S.PLAYER.eye, 4); // 4 м до цели, в корпус
  room.fire(a, Date.now());
  assert.ok(b.hp < 100 && b.hp <= 100 - S.WEAPONS[2].dmg, `дробовик не попал: hp=${b.hp}`);
}

// 7a. Новые стволы: падение урона с дистанции, рост разброса, снайперка убивает выстрелом в голову.
{
  assert.equal(S.WEAPONS.length, 5);
  const { room, a, b, sockA } = duel();
  a.ads = true; a.assist = 0;
  // ближний выстрел против дальнего (линия z=18 свободна по всей длине)
  const dmgAt = (dist) => {
    a.x = -28; a.z = 18; a.yaw = -Math.PI / 2; b.x = -28 + dist; b.z = 18;
    a.pitch = Math.atan2(1.15 - S.PLAYER.eye, dist);
    b.hp = 100; b.hist = []; a.nextFire = 0; a.bloom = 0; a.wp[0].mag = 30; a.reloading = false;
    room.fire(a, Date.now());
    return 100 - b.hp;
  };
  const near = dmgAt(12);
  let far = 0;
  for (let i = 0; i < 12 && !(far > 0 && far < 30); i++) far = dmgAt(56); // разброс может увести пулю мимо узкого тела
  assert.equal(near, 26, `урон вблизи: ${near}`);
  assert.ok(far > 0 && far < 22, `урон на 56 м должен падать: ${far}`);

  // рост разброса от очереди и его затухание
  a.bloom = 0; a.nextFire = 0; a.wp[0].mag = 30;
  for (let i = 0; i < 8; i++) { a.nextFire = 0; room.fire(a, Date.now()); }
  assert.ok(a.bloom > 0.02, `разброс не растёт: ${a.bloom}`);
  a.alive = true;
  tickN(room, S.TICK);
  assert.ok(a.bloom < 0.01, `разброс не затухает: ${a.bloom}`);

  // снайперка: голова — смерть с одного выстрела, ads обязателен для точности
  a.weapon = 4; a.ads = true; a.x = -10; a.z = 18; b.x = 5; b.z = 18; b.hp = 100; b.alive = true; b.protectUntil = 0; a.nextFire = 0; a.reloading = false;
  a.pitch = Math.atan2(1.68 - S.PLAYER.eye, 15);
  room.fire(a, Date.now());
  assert.ok(!b.alive, 'снайперка не убила выстрелом в голову');
  const kill = sockA.events.filter((e) => e[0] === 'kill').at(-1)[1];
  assert.equal(kill.hs, 1);
  assert.equal(kill.w, 4);
  assert.ok(kill.d >= 14 && kill.d <= 16, `дистанция убийства: ${kill.d}`);
  const hit = sockA.events.filter((e) => e[0] === 'hit').at(-1)[1];
  assert.ok(hit.d >= 90, `урон в событии hit: ${hit.d}`);
}

// 7a2. Зоны попадания: ноги < туловище < голова, зона приходит в событии hit; мимо узкого тела пуля летит дальше.
{
  const { room, a, b, sockA } = duel();
  a.ads = true; a.assist = 0; a.weapon = 4;
  const shootAt = (h) => {
    a.x = -10; a.z = 18; a.yaw = -Math.PI / 2; b.x = 5; b.z = 18; b.y = 0;
    a.pitch = Math.atan2(h - S.PLAYER.eye, 15);
    b.hp = 1000; b.alive = true; b.hist = []; b.protectUntil = 0; a.nextFire = 0; a.reloading = false; a.bloom = 0; a.wp[4].mag = 5;
    room.fire(a, Date.now());
    return sockA.events.filter((e) => e[0] === 'hit').at(-1)[1];
  };
  const leg = shootAt(0.4), torso = shootAt(1.15), head = shootAt(1.65);
  assert.equal(leg.z, 0); assert.equal(torso.z, 1); assert.equal(head.z, 2);
  assert.equal(leg.d, Math.round(90 * S.ZONE_LEG_MULT));
  assert.equal(torso.d, 90);
  assert.equal(head.d, 225);
  assert.ok(leg.d < torso.d && torso.d < head.d);
  assert.equal(head.hs, 1); assert.equal(leg.hs, 0);
  // луч мимо тела на 0.35 м вбок: раньше попал бы в широкую коробку 0.8, теперь — нет
  const before = b.hp;
  a.x = -10; a.z = 18; b.x = 5; b.z = 18.35; b.hist = [];
  a.pitch = Math.atan2(1.15 - S.PLAYER.eye, 15); a.nextFire = 0; a.wp[4].mag = 5;
  room.fire(a, Date.now());
  assert.equal(b.hp, before, 'пуля мимо тела не должна попадать');
  // rayPlayer напрямую
  assert.equal(S.rayPlayer(0, 1.0, 0, 0, 0, -1, 0, 0, -5).zone, 1);
  assert.equal(S.rayPlayer(0, 0.3, 0, 0, 0, -1, 0, 0, -5).zone, 0);
  assert.equal(S.rayPlayer(0, 1.7, 0, 0, 0, -1, 0, 0, -5).zone, 2);
  assert.equal(S.rayPlayer(0, 2.5, 0, 0, 0, -1, 0, 0, -5).zone, -1);
}

// 7b. Помощь прицеливания: выстрел мимо на ~3° попадает только с assist; сквозь стену не тянет.
{
  const { room, a, b } = duel();
  a.pitch = Math.atan2(1.15 - S.PLAYER.eye, 15);
  a.yaw = -Math.PI / 2 + 0.05; // ~2.9° в сторону: на 15 м это ~0.75 м мимо цели
  let miss = 0, hit = 0;
  for (let i = 0; i < 20; i++) { b.hp = 100; a.nextFire = 0; a.bloom = 0; a.wp[0].mag = 30; a.assist = 0; room.fire(a, Date.now()); if (b.hp < 100) hit++; }
  for (let i = 0; i < 20; i++) { b.hp = 100; a.nextFire = 0; a.bloom = 0; a.wp[0].mag = 30; a.assist = 1; room.fire(a, Date.now()); if (b.hp < 100) miss++; }
  assert.equal(hit, 0, `без помощи выстрел мимо должен промахиваться, попаданий: ${hit}`);
  assert.ok(miss >= 14, `с помощью прицеливания должно попадать: ${miss}/20`);
  // за стеной помощь не работает: ставим цель за центральным зданием
  b.x = 0; b.z = 4.5; b.hp = 100; a.x = 0; a.z = -4.5; a.yaw = 0.05; a.pitch = 0;
  for (let i = 0; i < 10; i++) { a.nextFire = 0; a.wp[0].mag = 30; room.fire(a, Date.now()); }
  assert.equal(b.hp, 100, 'помощь прицеливания пробила стену');
}

// 7c. Сложность ботов: у лёгких меньше здоровья и урона, чем у сложных.
{
  const easy = new Room(10, 0), hard = new Room(11, 2);
  assert.ok(easy.skill.hp < hard.skill.hp && easy.skill.dmg < hard.skill.dmg && easy.skill.react[0] > hard.skill.react[0]);
  const p = new Player('Бот', 1, true); easy.players.set(p.id, p); easy.spawn(p);
  assert.equal(p.hp, easy.skill.hp);
  const hum = new Player('Человек', 0, false, fakeSock()); easy.players.set(hum.id, hum); easy.spawn(hum);
  assert.equal(hum.hp, 100);
  // контролируемая дуэль: один бот стреляет по неподвижной цели с 15 м, 8 секунд, 24 повтора
  const duelDamage = (skill) => {
    let total = 0;
    for (let rep = 0; rep < 24; rep++) {
      const room = new Room(200 + rep, skill);
      const h = new Player('Мишень', 0, false, fakeSock());
      const bot = new Player('Бот', 1, true);
      room.players.set(h.id, h); room.players.set(bot.id, bot);
      room.spawn(h); room.spawn(bot);
      h.protectUntil = 0; bot.protectUntil = 0;
      h.x = 5; h.z = 18; bot.x = -10; bot.z = 18; bot.yaw = -Math.PI / 2;
      const orig = room.damage.bind(room);
      room.damage = (att, vic, amt, head) => { if (vic === h) total += amt; return orig(att, vic, amt, head); };
      for (let i = 0; i < S.TICK * 8; i++) { room.tick(); h.hp = 100; h.x = 5; h.z = 18; }
    }
    return total / 24;
  };
  const dEasy = duelDamage(0), dMid = duelDamage(1), dHard = duelDamage(2);
  console.log(`  урон по цели за 8 с: лёгкие ${dEasy.toFixed(0)}, средние ${dMid.toFixed(0)}, сложные ${dHard.toFixed(0)}`);
  assert.ok(dEasy < dMid && dEasy < dHard, "лёгкие боты должны быть слабее остальных");
  assert.ok(dEasy < dHard * 0.7, `лёгкие боты не заметно слабее сложных: ${dEasy} против ${dHard}`);
}

// 8. Полный матч с ботами: бои, события, итоги и перезапуск.
{
  const room = new Room(4);
  const sock = fakeSock();
  const me = room.addHuman(sock, 'Наблюдатель');
  room.fillBots();
  const start = new Map([...room.players.values()].filter((p) => p.bot).map((p) => [p.id, [p.x, p.z]]));
  tickN(room, S.TICK * 20);
  let moved = 0;
  for (const p of room.players.values()) {
    if (!p.bot) continue;
    const s = start.get(p.id);
    if (s && Math.hypot(p.x - s[0], p.z - s[1]) > 2) moved++;
  }
  assert.ok(moved >= 3, `боты почти не двигаются: ${moved}`);
  assert.ok(sock.count('shot') > 5, `боты не стреляют: ${sock.count('shot')}`);
  for (const p of room.players.values()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'NaN позиция');
    assert.ok(Math.abs(p.x) <= 32 && Math.abs(p.z) <= 22, `вне карты: ${p.x},${p.z}`);
  }
  // доигрываем до конца матча
  me.alive = true;
  let ticks = 0;
  while (room.state === 0 && ticks++ < S.TICK * (S.MATCH.time + 5)) room.tick();
  assert.equal(room.state, 1, 'матч не завершился');
  assert.equal(sock.count('over'), 1);
  assert.ok(room.scores[0] + room.scores[1] > 0, 'за матч не было ни одного убийства');
  tickN(room, S.TICK * (S.MATCH.over + 1));
  assert.equal(room.state, 0, 'новый матч не начался');
  assert.deepEqual(room.scores, [0, 0]);
  assert.ok(sock.count('start') >= 1);
}

// 9. Подпись Telegram initData.
{
  const token = '123456:TEST-TOKEN';
  const user = JSON.stringify({ id: 42, first_name: 'Иван', username: 'ivan' });
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAH', user };
  const dcs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  const good = new URLSearchParams({ ...fields, hash }).toString();
  assert.equal(verifyInitData(good, token)?.id, 42);
  assert.equal(verifyInitData(good, 'другой-токен'), null);
  assert.equal(verifyInitData(good.replace('Aya', 'x') + 'x', token), null);
  const tampered = new URLSearchParams({ ...fields, user: JSON.stringify({ id: 43 }), hash }).toString();
  assert.equal(verifyInitData(tampered, token), null);
  const old = new URLSearchParams({ ...fields, auth_date: '1000', hash }).toString();
  assert.equal(verifyInitData(old, token), null);
}

console.log('game.test.js: все проверки пройдены');
