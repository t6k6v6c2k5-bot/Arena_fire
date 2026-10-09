// Контрактный тест хранилища: одна и та же проверка для памяти и (если запущен) локального PostgreSQL.
import assert from 'assert';
import { MemoryStore, PgStore } from '../db.js';
import { psqlPool } from './pg-shim.mjs';
import { spawnSync } from 'child_process';

async function run(name, store) {
  await store.init();
  const rej = async (p, code) => { try { await p; } catch (e) { assert.strictEqual(e.code, code, `${name}: ${e.message}`); return; } assert.fail(`${name}: ожидалась ошибка ${code}`); };
  const a = await store.createUser({ email: 'a@x.io', nick: 'Alpha', pass: 'h1', equipped: { gun: 'gun_std' } });
  const b = await store.createUser({ email: 'b@x.io', nick: 'Beta', pass: 'h2' });
  assert.strictEqual(a.coins, 200); assert.strictEqual(a.equipped.gun, 'gun_std');
  await rej(store.createUser({ email: 'A@X.io', nick: 'Zed', pass: 'h' }), 'email_taken');
  await rej(store.createUser({ email: 'z@x.io', nick: 'alpha', pass: 'h' }), 'nick_taken');
  assert.strictEqual((await store.userByEmail('A@x.IO')).id, a.id);
  assert.strictEqual((await store.userByNick('BETA')).id, b.id);
  assert.strictEqual(await store.userById(999), null);

  // матч
  const u = await store.applyMatch(a.id, { xp: 100, coins: 60, kills: 7, deaths: 3, hs: 2, win: true, secs: 300, skill: 1 });
  assert.deepStrictEqual([u.xp, u.coins, u.kills, u.deaths, u.headshots, u.matches, u.wins, u.best_kills], [100, 260, 7, 3, 2, 1, 1, 7]);
  await store.applyMatch(a.id, { xp: 10, coins: 5, kills: 2, deaths: 1, hs: 0, win: false, secs: 60 });
  const h = await store.matchesOf(a.id, 5);
  assert.strictEqual(h.length, 2); assert.strictEqual(h[0].kills, 2); assert.strictEqual(h[1].win, 1);
  await store.applyMatch(b.id, { xp: 50, coins: 0, kills: 20, deaths: 0, hs: 0, win: false, secs: 100 });
  assert.deepStrictEqual((await store.topUsers('xp', 10)).map((x) => x.nick), ['Alpha', 'Beta']);
  assert.deepStrictEqual((await store.topUsers('kills', 10)).map((x) => x.nick), ['Beta', 'Alpha']);
  const c0 = await store.counts(); assert.strictEqual(c0.users, 2); assert.strictEqual(c0.matches, 3); assert.strictEqual(c0.kills, 29);

  // ежедневный бонус
  assert.ok(await store.claimDaily(a.id, '2026-01-01', 1, 50));
  assert.strictEqual(await store.claimDaily(a.id, '2026-01-01', 2, 50), null);
  assert.strictEqual((await store.userById(a.id)).coins, 260 + 5 + 50);

  // магазин
  const coins = (await store.userById(a.id)).coins;
  const after = await store.buy(a.id, 'gun_olive', 300 > coins ? 1 : 300);
  assert.ok(after.coins < coins);
  await rej(store.buy(a.id, 'gun_olive', 300), 'owned');
  await rej(store.buy(b.id, 'gun_gold', 6000), 'no_coins');
  assert.deepStrictEqual(await store.owned(a.id), ['gun_olive']);
  await store.setEquipped(a.id, { gun: 'gun_olive', armor: 'arm_std', tracer: 'tr_std' });
  assert.strictEqual((await store.userById(a.id)).equipped.gun, 'gun_olive');

  // кланы
  await store.applyMatch(b.id, { xp: 0, coins: 600, kills: 0, deaths: 0, hs: 0, win: false, secs: 0 });
  await rej(store.createClan(a.id, { name: 'X', tag: 'X', descr: '' }, 99999), 'no_coins');
  const cid = await store.createClan(b.id, { name: 'Волки', tag: 'WLK', descr: 'hi' }, 500);
  assert.strictEqual((await store.userById(b.id)).clan_id, cid);
  assert.strictEqual((await store.userById(b.id)).coins, 300);
  await rej(store.createClan(b.id, { name: 'Другой', tag: 'DR', descr: '' }, 0), 'in_clan');
  await rej(store.createClan(a.id, { name: 'волки', tag: 'AA', descr: '' }, 0), 'clan_name_taken');
  await rej(store.createClan(a.id, { name: 'Другие', tag: 'wlk', descr: '' }, 0), 'clan_tag_taken');
  assert.strictEqual((await store.userById(a.id)).clan_id, null);
  await store.joinClan(a.id, cid, 30);
  await rej(store.joinClan(a.id, cid, 30), 'in_clan');
  const cl = await store.clanById(cid);
  assert.strictEqual(cl.members, 2); assert.strictEqual(cl.kills, 29);
  assert.strictEqual((await store.clanList('вол')).length, 1); assert.strictEqual((await store.clanList('zzz')).length, 0);
  assert.deepStrictEqual((await store.clanMembers(cid)).map((m) => m.nick), ['Alpha', 'Beta']);
  assert.deepStrictEqual(await store.clanTags([a.id, 12345]), { [a.id]: 'WLK' });
  assert.strictEqual((await store.topUsers('xp', 5))[0].clan_tag, 'WLK');
  const c3 = await store.createUser({ email: 'c@x.io', nick: 'Gamma', pass: 'h' });
  await rej(store.joinClan(c3.id, cid, 2), 'clan_full');
  await rej(store.kick(a.id, b.id), 'not_owner');
  await store.kick(b.id, a.id);
  assert.strictEqual((await store.userById(a.id)).clan_id, null);
  await store.joinClan(a.id, cid, 30);
  await store.leaveClan(b.id);                         // глава уходит — клан переходит к Alpha
  assert.strictEqual((await store.clanById(cid)).owner_id, a.id);
  await store.leaveClan(a.id);                         // последний ушёл — клан удалён
  assert.strictEqual(await store.clanById(cid), null);
  await rej(store.leaveClan(a.id), 'no_clan');
  console.log(`store.test: ${name} — все проверки пройдены`);
}

await run('память', new MemoryStore());

const up = spawnSync('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'af', '-q', '-c', 'drop schema public cascade; create schema public;']);
if (up.status === 0) await run('PostgreSQL', new PgStore(psqlPool()));
else console.log('store.test: локальный PostgreSQL не запущен — проверена только память');
