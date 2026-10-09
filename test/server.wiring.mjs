// Проверка обвязки server.js: гости и аккаунты, комнаты (быстрая/своя/по коду), награды, чат, health.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./server-hooks.mjs', import.meta.url);
process.env.PORT = '0';
process.env.SESSION_SECRET = 'wiring-secret';
delete process.env.DATABASE_URL;

const { created, inject } = await import('./stub-express.mjs');
const { state } = await import('./stub-socketio.mjs');
await import('../server.js');
assert.equal(typeof state.onConnection, 'function', 'server.js не подписался на connection');
const app = created[0];

function sock(cookie = '') {
  const h = {}, got = {};
  const s = { on: (ev, fn) => { h[ev] = fn; }, emit: (ev, d) => { (got[ev] ??= []).push(d); }, join() {}, got, h, id: 's' + Math.random(), handshake: { headers: { cookie } } };
  s.volatile = s;
  return s;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const health = async () => (await inject(app, { url: '/health' })).body;
const connect = (cookie) => { const s = sock(cookie); state.onConnection(s); return s; };
const join = async (s, d) => { s.h.join(d); await wait(30); };

// --- страницы и 404 ---
assert.match((await inject(app, { url: '/' })).file, /index\.html$/);
assert.match((await inject(app, { url: '/login' })).file, /auth\.html$/);
assert.match((await inject(app, { url: '/profile/Bob' })).file, /profile\.html$/);
assert.match((await inject(app, { url: '/clan/5' })).file, /clan\.html$/);
assert.match((await inject(app, { url: '/nope' })).file, /404\.html$/);

// --- без аккаунта и не гость — отказ ---
const x = connect(); await join(x, { name: 'Аноним' });
assert.ok(x.got.denied?.[0].login, 'без входа и без guest должен быть отказ'); assert.ok(!x.got.welcome);

// --- гость ---
const a = connect(); await join(a, { guest: true, name: '<b>Игрок&Один</b>' });
assert.ok(a.got.welcome, 'нет welcome');
const w = a.got.welcome[0];
assert.equal(w.players.length, 8); assert.equal(w.account, 0);
assert.equal((await health()).humans, 1);
const me = w.players.find((p) => p.id === w.id);
assert.ok(!/[<>&]/.test(me.name), 'имя не очищено'); assert.equal(me.tag, 'ГОСТЬ');

a.h.join({ guest: true, name: 'повтор' }); await wait(30);
assert.equal(a.got.welcome.length, 1, 'повторный join игнорируется');

a.h.input({ seq: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, jump: false, fire: false, reload: false, weapon: 0, rt: Date.now() });
a.h.input('мусор'); a.h.input(null); a.h.input({ seq: 'x' });
await wait(250);
assert.ok(a.got.snap?.length > 3, 'нет снапшотов');
assert.equal(a.got.snap.at(-1).ack >= 1, true, 'ввод не обработан');
let pinged = false; a.h.p(() => { pinged = true; }); assert.ok(pinged);

const b = connect(); await join(b, { guest: true, name: 'Второй' });
assert.equal((await health()).rooms, 1, 'второй игрок должен попасть в ту же комнату');
const c = connect(); await join(c, { guest: true, name: 'Хард', skill: 2, touch: true });
assert.equal(c.got.welcome[0].skill, 2); assert.equal((await health()).rooms, 2);
const d = connect(); await join(d, { guest: true, name: 'Нет такой сложности', skill: 99 });
assert.equal(d.got.welcome[0].skill, 2, 'неверная сложность должна ограничиваться');

// --- аккаунт ---
async function signup(nick) {
  const r = await inject(app, { method: 'POST', url: '/api/register', body: { email: nick + '@x.io', nick, password: 'password1' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { cookie: /af_session=[^;]*/.exec(r.headers['set-cookie'])[0], id: r.body.user.id };
}
const ua = await signup('Hero');
const h1 = connect(ua.cookie); await join(h1, { mode: 'quick', skill: 0 });
const wh = h1.got.welcome[0];
assert.equal(wh.account, 1); const mh = wh.players.find((p) => p.id === wh.id);
assert.equal(mh.name, 'Hero'); assert.equal(mh.eq.gun, 'gun_std'); assert.equal(mh.lv, 1);
const h2 = connect(ua.cookie); await join(h2, { mode: 'quick' });
assert.match(h2.got.denied[0].reason, /уже в игре/, 'один аккаунт — одно подключение');

// --- свои комнаты: создание, список, вход по id и по коду ---
const ub = await signup('Host');
const host = connect(ub.cookie); await join(host, { mode: 'create', skill: 1, roomName: 'Тест <i>арена</i>', priv: false });
const wr = host.got.welcome[0];
assert.match(wr.code, /^[A-Z2-9]{5}$/); assert.ok(!/[<>]/.test(wr.roomName));
let rooms = (await inject(app, { url: '/api/rooms' })).body.rooms;
const listed = rooms.find((r) => r.id === wr.room);
assert.ok(listed && listed.custom === 1 && listed.humans === 1, 'публичная комната в списке');
const g1 = connect(); await join(g1, { mode: 'create', guest: true }); assert.ok(g1.got.denied, 'гость не создаёт комнаты');
const g2 = connect(); await join(g2, { mode: 'room', roomId: wr.room, guest: true, name: 'Гость2' });
assert.equal(g2.got.welcome[0].room, wr.room, 'вход в комнату по id');
const priv = connect((await signup('Priv')).cookie); await join(priv, { mode: 'create', priv: true });
const pw = priv.got.welcome[0];
rooms = (await inject(app, { url: '/api/rooms' })).body.rooms;
assert.ok(!rooms.some((r) => r.id === pw.room), 'приватная комната скрыта');
const g3 = connect(); await join(g3, { mode: 'room', roomId: pw.room, guest: true, name: 'Ломлюсь' });
assert.ok(g3.got.denied, 'в приватную по id нельзя');
const g4 = connect(); await join(g4, { mode: 'code', code: pw.code.toLowerCase(), guest: true, name: 'Друг' });
assert.equal(g4.got.welcome[0].room, pw.room, 'вход по коду');
const g5 = connect(); await join(g5, { mode: 'code', code: 'ZZZZZ', guest: true, name: 'Нет' });
assert.match(g5.got.denied[0].reason, /не найдена/);
assert.ok(![...(await inject(app, { url: '/api/rooms' })).body.rooms].some((r) => r.id === pw.room));
const g6 = connect(); await join(g6, { mode: 'quick', skill: 1, guest: true, name: 'Быстрый' });
assert.notEqual(g6.got.welcome[0].room, wr.room, 'быстрый поиск не заходит в пользовательские комнаты');

// --- режимы и платформы ---
const m1 = connect(); await join(m1, { guest: true, name: 'Ffa', gm: 'ffa', skill: 0 });
assert.equal(m1.got.welcome[0].mode, 'ffa'); assert.equal(m1.got.welcome[0].teams, 0);
const m2 = connect(); await join(m2, { guest: true, name: 'Gg', gm: 'gg' });
assert.equal(m2.got.welcome[0].mode, 'gg'); assert.notEqual(m2.got.welcome[0].room, m1.got.welcome[0].room);
const m3 = connect(); await join(m3, { guest: true, name: 'Bad', gm: 'хак' });
assert.equal(m3.got.welcome[0].mode, 'tdm', 'неизвестный режим → командный бой');
const tp = connect(); await join(tp, { guest: true, name: 'Тач', gm: 'ffa', touch: true });
assert.equal(tp.got.welcome[0].room, m1.got.welcome[0].room, 'телефон и ПК играют в одних комнатах');
const ros = tp.got.welcome[0].players;
assert.equal(ros.find((p) => p.name === 'Тач').pl, 'm', 'у телефона значок m');
assert.equal(ros.find((p) => p.name === 'Ffa').pl, 'p', 'у ПК значок p');
const hostM = connect((await signup('MobHost')).cookie); await join(hostM, { mode: 'create', gm: 'hs', touch: true, roomName: 'Тач-арена' });
const mw = hostM.got.welcome[0];
assert.equal(mw.mode, 'hs');
const pcTry = connect(); await join(pcTry, { mode: 'room', roomId: mw.room, guest: true, name: 'Пк' });
assert.equal(pcTry.got.welcome[0].room, mw.room, 'ПК заходит в комнату телефона из списка');
const byCode = connect(); await join(byCode, { mode: 'code', code: mw.code, guest: true, name: 'Друг' });
assert.equal(byCode.got.welcome[0].room, mw.room, 'по коду тоже заходит');
const lst = (await inject(app, { url: '/api/rooms' })).body.rooms;
assert.ok(lst.some((r) => r.id === mw.room && r.mode === 'hs'), 'комната есть в общем списке');
for (const s of [m1, m2, m3, tp, hostM, pcTry, byCode]) s.h.disconnect?.();

// --- чат лобби ---
const ch = connect(ua.cookie); ch.h.lobby(); await wait(10);
assert.ok(ch.got['chat:history']);
ch.h.chat('привет\u0000 всем'); await wait(30);
const g7 = connect(); g7.h.chat('я гость'); await wait(20);
assert.equal(state.rooms.lobby, undefined); // заглушка не хранит комнаты — проверяем только отсутствие падений

for (const s of [a, b, c, d, h1, h2, host, g2, priv, g4, g6, x, ch, g7, g1, g3, g5]) s.h.disconnect?.();
await wait(50);
assert.equal((await health()).rooms, 0, 'пустые комнаты не удалены');
const prof = await inject(app, { url: '/api/profile/Hero' });
assert.equal(prof.status, 200);

console.log('server.wiring.mjs: все проверки пройдены');
process.exit(0);
