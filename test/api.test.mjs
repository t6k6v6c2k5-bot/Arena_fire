// Тест HTTP API (аккаунты, магазин, кланы, рейтинг) на мини-express и хранилище в памяти.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./server-hooks.mjs', import.meta.url);
const { default: express, inject } = await import('./stub-express.mjs');
const { MemoryStore } = await import('../db.js');
const { createApi } = await import('../api.js');
const { makeSessions } = await import('../accounts.js');
const { ITEM_BY_ID } = await import('../public/catalog.js');

const store = new MemoryStore();
const sessions = makeSessions('test-secret');
const api = createApi({ store, sessions, listRooms: () => [{ id: 1 }], onlineCount: () => 3 });
const app = express(); app.use('/api', api);

const call = (method, url, body, cookie, extra = {}) => inject(app, { method, url: '/api' + url, body, headers: { ...(cookie ? { cookie } : {}), ...extra } });
const cookieOf = (r) => /af_session=([^;]*)/.exec(r.headers['set-cookie'])?.[0];

// --- регистрация ---
let r = await call('POST', '/register', { email: 'bad', nick: 'Alpha', password: '12345678' });
assert.equal(r.status, 400); assert.match(r.body.error, /email/);
r = await call('POST', '/register', { email: 'a@x.io', nick: 'A b', password: '12345678' }); assert.equal(r.status, 400);
r = await call('POST', '/register', { email: 'a@x.io', nick: 'Alpha', password: '1234' }); assert.equal(r.status, 400);
r = await call('POST', '/register', { email: 'a@x.io', nick: 'Alpha', password: 'secret123' });
assert.equal(r.status, 200); assert.equal(r.body.user.nick, 'Alpha'); assert.equal(r.body.user.coins, 200); assert.equal(r.body.user.level, 1);
assert.ok(!('pass' in r.body.user)); assert.match(r.headers['set-cookie'], /HttpOnly/); assert.match(r.headers['set-cookie'], /SameSite=Lax/);
const ca = cookieOf(r);
assert.notEqual(JSON.stringify(r.body).includes('s1$'), true, 'хеш пароля в ответе');
r = await call('POST', '/register', { email: 'A@x.io', nick: 'Other', password: 'secret123' }); assert.equal(r.status, 400); assert.match(r.body.error, /email/);
r = await call('POST', '/register', { email: 'z@x.io', nick: 'alpha', password: 'secret123' }); assert.equal(r.status, 400); assert.match(r.body.error, /позывной/);

// --- сессия ---
r = await call('GET', '/me'); assert.equal(r.body.user, null);
r = await call('GET', '/me', undefined, ca); assert.equal(r.body.user.nick, 'Alpha'); assert.equal(r.body.daily.available, true);
r = await call('GET', '/me', undefined, 'af_session=1.99999999999.abc.def'); assert.equal(r.body.user, null, 'подделанная сессия');
r = await call('GET', '/shop'); assert.equal(r.status, 401);

// --- вход ---
r = await call('POST', '/login', { login: 'a@x.io', password: 'wrong' }); assert.equal(r.status, 401);
r = await call('POST', '/login', { login: 'nobody@x.io', password: 'whatever1' }); assert.equal(r.status, 401);
assert.equal((await call('POST', '/login', { login: 'alpha', password: 'secret123' })).status, 200, 'вход по нику');
r = await call('POST', '/login', { login: 'A@X.IO', password: 'secret123' }); assert.equal(r.status, 200);

// --- безопасность запросов ---
r = await inject(app, { method: 'POST', url: '/api/login', raw: 'login=a', headers: { 'content-type': 'text/plain' } }); assert.equal(r.status, 415);
r = await call('POST', '/login', { login: 'a@x.io', password: 'x' }, null, { origin: 'https://evil.example' }); assert.equal(r.status, 403);
r = await call('POST', '/login', { login: 'a@x.io', password: 'x' }, null, { origin: 'http://localhost' }); assert.equal(r.status, 401);
r = await inject(app, { method: 'POST', url: '/api/login', raw: '{bad', headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 400);

// --- ежедневный бонус ---
r = await call('POST', '/daily', {}, ca); assert.equal(r.status, 200); assert.equal(r.body.coins, 50); assert.equal(r.body.user.coins, 250); assert.equal(r.body.daily.available, false);
r = await call('POST', '/daily', {}, ca); assert.equal(r.status, 400);

// --- магазин ---
r = await call('GET', '/shop', undefined, ca);
assert.ok(r.body.items.length > 10); assert.ok(r.body.owned.includes('gun_std')); assert.equal(r.body.equipped.gun, 'gun_std');
r = await call('POST', '/shop/buy', { id: 'gun_std' }, ca); assert.equal(r.status, 400, 'бесплатное не покупается');
r = await call('POST', '/shop/buy', { id: 'nope' }, ca); assert.equal(r.status, 400);
r = await call('POST', '/shop/buy', { id: 'gun_olive' }, ca); assert.equal(r.status, 400); assert.match(r.body.error, /уровень 3/);
const ua = await store.userByNick('Alpha');
await store.applyMatch(ua.id, { xp: 400, coins: 1000, kills: 10, deaths: 2, hs: 3, win: true, secs: 300 }); // уровень 3, монет много
r = await call('POST', '/shop/buy', { id: 'gun_olive' }, ca); assert.equal(r.status, 200); assert.equal(r.body.user.coins, 250 + 1000 - 300);
assert.ok(r.body.user.owned.includes('gun_olive'));
r = await call('POST', '/shop/buy', { id: 'gun_olive' }, ca); assert.equal(r.status, 400); assert.match(r.body.error, /Уже/);
r = await call('POST', '/shop/buy', { id: 'gun_gold' }, ca); assert.equal(r.status, 400); assert.match(r.body.error, /уровень/);
r = await call('POST', '/shop/equip', { id: 'gun_sand' }, ca); assert.equal(r.status, 400);
r = await call('POST', '/shop/equip', { id: 'gun_olive' }, ca); assert.equal(r.status, 200); assert.equal(r.body.equipped.gun, 'gun_olive');
r = await call('GET', '/me', undefined, ca); assert.equal(r.body.user.equipped.gun, 'gun_olive');
assert.ok(ITEM_BY_ID.gun_olive);

// --- профиль/рейтинг/статистика ---
r = await call('GET', '/profile/ALPHA'); assert.equal(r.status, 200); assert.equal(r.body.user.kills, 10); assert.ok(!('email' in r.body.user)); assert.ok(!('coins' in r.body.user));
assert.equal(r.body.history.length, 1);
assert.equal((await call('GET', '/profile/ghost')).status, 404);
r = await call('GET', '/leaderboard?by=kills'); assert.equal(r.body.rows[0].nick, 'Alpha'); assert.equal(r.body.rows[0].level, 3);
assert.equal((await call('GET', '/leaderboard?by=DROP')).body.by, 'xp');
r = await call('GET', '/stats'); assert.deepEqual([r.body.users, r.body.online, r.body.rooms, r.body.db], [1, 3, 1, 'memory']);

// --- кланы ---
r = await call('POST', '/clans', { name: 'Волки', tag: 'WLK' }); assert.equal(r.status, 401);
r = await call('POST', '/clans', { name: 'x', tag: 'WLK' }, ca); assert.equal(r.status, 400);
r = await call('POST', '/clans', { name: 'Волки', tag: 'w!' }, ca); assert.equal(r.status, 400);
r = await call('POST', '/clans', { name: 'Волки', tag: 'wlk', descr: 'Мы волки' }, ca); assert.equal(r.status, 200);
const cid = r.body.id;
r = await call('GET', '/me', undefined, ca); assert.equal(r.body.user.clan.tag, 'WLK'); assert.equal(r.body.user.clan.owner, true); assert.equal(r.body.user.coins, 1000 + 250 - 300 - 500);
r = await call('POST', '/clans', { name: 'Другие', tag: 'DR' }, ca); assert.equal(r.status, 400); assert.match(r.body.error, /уже состоите/);

r = await call('POST', '/register', { email: 'b@x.io', nick: 'Beta', password: 'secret456' }); const cb = cookieOf(r);
r = await call('POST', `/clans/${cid}/join`, {}, cb); assert.equal(r.status, 200);
r = await call('POST', `/clans/${cid}/join`, {}, cb); assert.equal(r.status, 400);
assert.equal((await call('POST', '/clans/999/join', {}, cb)).status, 404);
r = await call('GET', `/clans/${cid}`, undefined, cb);
assert.equal(r.body.clan.members, 2); assert.equal(r.body.mine, true); assert.equal(r.body.owner, false); assert.equal(r.body.members[0].nick, 'Alpha'); assert.equal(r.body.members[0].owner, true);
r = await call('GET', '/clans?q=волк'); assert.equal(r.body.clans.length, 1); assert.equal(r.body.cost, 500);
const ub = await store.userByNick('Beta');
r = await call('POST', '/clans/kick', { id: ua.id }, cb); assert.equal(r.status, 403);
r = await call('POST', '/clans/kick', { id: ub.id }, ca); assert.equal(r.status, 200);
assert.equal((await call('GET', '/me', undefined, cb)).body.user.clan, null);
r = await call('POST', '/clans/leave', {}, cb); assert.equal(r.status, 400);
r = await call('POST', '/clans/leave', {}, ca); assert.equal(r.status, 200);
assert.equal((await call('GET', `/clans/${cid}`)).status, 404, 'пустой клан удалён');

// --- смена пароля ---
r = await call('POST', '/password', { old: 'bad', new: 'newpassword1' }, ca); assert.equal(r.status, 400);
r = await call('POST', '/password', { old: 'secret123', new: 'short' }, ca); assert.equal(r.status, 400);
r = await call('POST', '/password', { old: 'secret123', new: 'newpassword1' }, ca); assert.equal(r.status, 200);
const ca2 = cookieOf(r);
assert.equal((await call('GET', '/me', undefined, ca)).body.user, null, 'старая сессия должна стать недействительной');
assert.equal((await call('GET', '/me', undefined, ca2)).body.user.nick, 'Alpha');
assert.equal((await call('POST', '/login', { login: 'alpha', password: 'newpassword1' })).status, 200);

// --- выход, ограничение попыток ---
r = await call('POST', '/logout', {}, ca2); assert.match(r.headers['set-cookie'], /Max-Age=0/);
let limited = false;
for (let i = 0; i < 12; i++) { r = await call('POST', '/login', { login: 'beta', password: 'wrong' + i }); if (r.status === 429) limited = true; }
assert.ok(limited, 'перебор пароля должен ограничиваться');
assert.equal((await call('GET', '/nope')).status, 404);

console.log('api.test.mjs: все проверки пройдены');
