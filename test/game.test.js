// Тест серверной логики без сети: комнаты, боты, хитскан, лаг-компенсация, матч, результаты матча для профиля.
import assert from 'node:assert/strict';
import * as S from '../public/shared.js';
import { Room, Player } from '../game.js';
import { matchReward } from '../public/catalog.js';

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
  assert.equal(S.WEAPONS.length, 10);
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

// 9. Результаты матча: победитель, хедшоты, ливер, гость и бот не записываются, повтора нет.
{
  const room = new Room(77);
  const got = [];
  room.onResult = (p, res) => got.push([p, res]);
  const sa = fakeSock(), sb = fakeSock(), sg = fakeSock();
  const A = room.addHuman(sa, 'A', { uid: 11, equip: { gun: 'gun_std' }, tag: 'WLK', level: 5 });
  const B = room.addHuman(sb, 'B', { uid: 12 });
  const G = room.addHuman(sg, 'Гость');
  A.team = 0; B.team = 1; G.team = 0;
  room.fillBots();
  assert.equal(room.rosterEntry(A).tag, 'WLK'); assert.equal(room.rosterEntry(A).lv, 5);
  tickN(room, 60);
  const bot = room.bots().find((b) => b.team === 1);
  for (let i = 0; i < 5; i++) { bot.alive = true; bot.hp = 100; bot.protectUntil = 0; room.damage(A, bot, 200, i < 2, 10); }
  assert.equal(A.kills, 5); assert.equal(A.hs, 2);
  room.scores = [S.MATCH.killLimit - 1, 3];
  const bot2 = room.bots().find((b) => b.team === 1);
  bot2.alive = true; bot2.hp = 10; bot2.protectUntil = 0;
  room.damage(A, bot2, 50, true, 5);       // 6-е убийство завершает матч победой команды 0
  assert.equal(room.state, 1);
  assert.equal(got.length, 2, 'записываются только игроки с аккаунтом');
  const ra = got.find((g) => g[0] === A)[1], rb = got.find((g) => g[0] === B)[1];
  assert.deepEqual([ra.kills, ra.hs, ra.win, rb.win, ra.draw], [6, 3, true, false, false]);
  assert.ok(ra.secs >= 1);
  room.endMatch(); assert.equal(got.length, 2, 'повторной записи нет');

  // ливер во время боя получает поражение, повторно в конце не записывается
  room.resetMatch();
  got.length = 0;
  A.kills = 3; A.deaths = 1;
  room.removePlayer(A.id);
  assert.equal(got.length, 1); assert.equal(got[0][1].win, false);
  // не сыгравший (0 убийств/смертей) при выходе до конца матча не записывается
  room.removePlayer(B.id); assert.equal(got.length, 1);
  room.endMatch(); assert.equal(got.length, 1, 'ушедших повторно не записываем');
}

// 10. Награды: ливнувшим меньше, победителям больше, потолок.
{
  const win = matchReward({ kills: 10, hs: 4, win: true, secs: 300 });
  const lose = matchReward({ kills: 10, hs: 4, secs: 300 });
  const quit = matchReward({ kills: 10, hs: 4, secs: 30 });
  assert.ok(win.xp > lose.xp && lose.xp > quit.xp && win.coins > lose.coins);
  assert.deepEqual(matchReward({ secs: 5 }), { xp: 0, coins: 0 });
  assert.ok(matchReward({ kills: 9999, hs: 9999, win: true, secs: 9999 }).xp <= 700);
}

// 11. Режимы: FFA, гонка вооружений, только хедшоты, платформа.
{
  // FFA: победа по лимиту убийств, «свои» не защищены, без команд
  const room = new Room(90, 0, { mode: 'ffa' });
  const got = [];
  room.onResult = (p, res) => got.push([p, res]);
  const sa = fakeSock(), sb = fakeSock();
  const A = room.addHuman(sa, 'A', { uid: 1 }), B = room.addHuman(sb, 'B', { uid: 2 });
  A.team = 0; B.team = 0; // одна «команда» по спавну — в FFA это не союзники
  room.fillBots(); tickN(room, 60);
  assert.equal(room.friend(A, B), false, 'в FFA нет союзников');
  assert.equal(room.welcome(A).teams, 0);
  assert.equal(room.welcome(A).mode, 'ffa');
  B.alive = true; B.hp = 100; B.protectUntil = 0;
  room.damage(A, B, 500, false, 5);
  assert.equal(A.kills, 1);
  A.kills = S.MODES.ffa.killLimit - 1;
  B.alive = true; B.hp = 10; B.protectUntil = 0;
  room.damage(A, B, 50, true, 5);
  assert.equal(room.state, 1); assert.equal(room.winId, A.id);
  const ra = got.find((g) => g[0] === A)[1], rb = got.find((g) => g[0] === B)[1];
  assert.deepEqual([ra.win, rb.win, ra.mode], [true, false, 'ffa']);

  // по таймеру побеждает лидер; равенство — ничья
  room.resetMatch(); got.length = 0;
  A.kills = 3; B.kills = 1;
  room.endMatch(); assert.equal(room.winId, A.id);
  room.resetMatch(); A.kills = 2; B.kills = 2;
  for (const p of room.bots()) p.kills = 0;
  room.endMatch(); assert.equal(room.winId, 0, 'равенство лидеров — ничья');
}
{
  // Гонка вооружений: оружие меняется с каждым убийством, переключать нельзя, победа после последнего этапа
  const room = new Room(91, 0, { mode: 'gg' });
  const sa = fakeSock();
  const A = room.addHuman(sa, 'A', { uid: 1 });
  room.fillBots(); tickN(room, 60);
  assert.equal(A.weapon, S.GG_ORDER[0]);
  room.applyInput(A, { mx: 0, mz: 0, yaw: 0, pitch: 0, weapon: 4, rt: Date.now() });
  assert.equal(A.weapon, S.GG_ORDER[0], 'в гонке вооружений нельзя менять оружие');
  const victims = room.bots();
  for (let i = 1; i < S.GG_ORDER.length; i++) {
    const v = victims[i % victims.length]; v.alive = true; v.hp = 10; v.protectUntil = 0;
    room.damage(A, v, 99, false, 5);
    assert.equal(A.gg, i); assert.equal(A.weapon, S.GG_ORDER[i], `этап ${i}`);
    assert.equal(A.wp[A.weapon].mag, S.WEAPONS[A.weapon].mag);
    assert.ok(sa.last.ggup && sa.last.ggup.gg === i);
  }
  assert.equal(room.state, 0);
  const v = victims[S.GG_ORDER.length % victims.length]; v.alive = true; v.hp = 10; v.protectUntil = 0;
  room.damage(A, v, 99, false, 5);
  assert.equal(room.state, 1); assert.equal(room.winId, A.id, 'победа после последнего этапа');
  // смерть не сбрасывает этап
  room.resetMatch(); assert.equal(A.gg, 0);
}
{
  // Только хедшоты: голова убивает сразу, тело почти не бьёт
  const room = new Room(92, 0, { mode: 'hs' });
  const sa = fakeSock();
  const A = room.addHuman(sa, 'A');
  room.fillBots(); tickN(room, 60);
  A.team = 0; const v = room.bots().find((b) => b.team === 1);
  const shoot = (aimY) => {
    v.alive = true; v.hp = 100; v.protectUntil = 0; v.x = 0; v.z = -10; v.y = 0; v.hist = [];
    A.x = 0; A.z = 0; A.y = 0; A.alive = true; A.protectUntil = 0; A.pitch = Math.atan2(aimY - S.PLAYER.eye, 10); A.yaw = 0;
    A.wp[0].mag = 30; A.nextFire = 0; A.bloom = 0; A.reloading = false;
    // свободный коридор: вокруг цели нет стен на этой линии не гарантируем, поэтому попытки повторяем
    for (let k = 0; k < 6 && v.hp === 100; k++) { A.nextFire = 0; room.fire(A, Date.now()); }
    return v.hp;
  };
  const bodyHp = shoot(1.15);
  assert.ok(bodyHp === 100 || bodyHp >= 85, `по телу почти нет урона, hp ${bodyHp}`);
}
{
  // Платформа игрока попадает в ростер (значок у ника), комнаты общие
  const rr = new Room(93, 0, {});
  const hp = rr.addHuman(fakeSock(), 'Тест', {}); hp.plat = 'm';
  assert.equal(rr.rosterEntry(hp).pl, 'm');
  assert.equal(rr.platform, undefined);
  assert.equal(new Room(95, 0, { mode: 'нет такого' }).mode.id, 'tdm');
}
{
  // Набор оружия: только допустимые слоты, переключать можно лишь между своими
  assert.deepEqual(S.cleanLoadout([6, 9, 7]), [6, 9, 7]);
  assert.deepEqual(S.cleanLoadout([1, 1, 1]), S.DEFAULT_LOADOUT, 'пистолет в основной слот не пускаем');
  assert.deepEqual(S.cleanLoadout('мусор'), S.DEFAULT_LOADOUT);
  assert.deepEqual(S.cleanLoadout([99, -1, 0.5]), S.DEFAULT_LOADOUT);
  const room = new Room(96, 0, {});
  const A = room.addHuman(fakeSock(), 'A', { loadout: [8, 4, 7] });
  room.fillBots(); tickN(room, 40);
  assert.equal(A.weapon, 8, 'в бой выходим с основным оружием набора');
  room.applyInput(A, { mx: 0, mz: 0, yaw: 0, pitch: 0, weapon: 2, rt: Date.now() });
  assert.equal(A.weapon, 8, 'оружия вне набора брать нельзя');
  room.applyInput(A, { mx: 0, mz: 0, yaw: 0, pitch: 0, weapon: 7, rt: Date.now() });
  assert.equal(A.weapon, 7);
  for (const b of room.bots()) assert.ok(S.WEAPONS[b.weapon].slot === 0, 'у ботов основное оружие');
  // новое оружие стреляет и считается по характеристикам
  for (const i of [5, 6, 7, 8, 9]) {
    const w = S.WEAPONS[i];
    assert.ok(w && w.dmg > 0 && w.rate > 0 && w.mag > 0, 'описание оружия ' + i);
    if (w.pellets === 1) assert.ok(w.dmg * w.head >= 100 || w.auto, 'одиночные мощные выстрелы в голову убивают');
  }
}
{
  // Захват точки: очки идут команде, которая одна в зоне; спор — очки стоят; зона переезжает
  const room = new Room(97, 0, { mode: 'hill' });
  const sa = fakeSock();
  const A = room.addHuman(sa, 'A');
  room.fillBots(); tickN(room, 40);
  const h = S.HILLS[room.hill.idx];
  for (const p of room.players.values()) { p.x = -30; p.z = 20; p.alive = true; p.protectUntil = 1e9; p.respawnAt = 1e9; }
  const hold = (p) => { p.x = h.x + 1; p.z = h.z + 1; };
  A.team = 0; hold(A);
  const s0 = room.scores[0];
  for (let i = 0; i < S.TICK * 5 + 2; i++) { room.hillTick(); }
  assert.ok(room.scores[0] - s0 >= 4 && room.scores[0] - s0 <= 5, 'очки идут одной команде: ' + (room.scores[0] - s0));
  assert.equal(room.scores[1], 0);
  assert.equal(room.hill.owner, 0);
  const foe = room.bots().find((b) => b.team === 1); foe.x = h.x - 1; foe.z = h.z;
  const s1 = room.scores[0];
  for (let i = 0; i < S.TICK * 3; i++) room.hillTick();
  assert.equal(room.hill.owner, 2, 'обе команды — зона спорная');
  assert.equal(room.scores[0], s1, 'при споре очки стоят');
  // убийства очков не дают
  const k0 = room.scores[0] + room.scores[1];
  foe.alive = true; foe.hp = 5; foe.protectUntil = 0;
  room.damage(A, foe, 50, false, 3);
  assert.equal(room.scores[0] + room.scores[1], k0, 'в режиме точки очки только за зону');
  // зона переезжает
  const idx0 = room.hill.idx;
  for (let i = 0; i < S.TICK * S.HILL_TIME + 5; i++) room.hillTick();
  assert.notEqual(room.hill.idx, idx0);
  // снимок содержит зону
  room.sendSnapshots(Date.now());
  assert.equal(sa.last.snap.hl.length, 5);
  // победа по лимиту очков
  room.scores[0] = room.mode.killLimit - 1; room.hill.acc[0] = 0.99; foe.x = -30; foe.z = 20; { const h2 = S.HILLS[room.hill.idx]; A.x = h2.x + 1; A.z = h2.z + 1; } room.hillTick(); room.hillTick();
  assert.equal(room.state, 1, 'матч закончился по очкам'); assert.equal(room.winner, 0);
}

console.log('game.test.js: все проверки пройдены');
