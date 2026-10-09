// Хранилище: PostgreSQL (если задан DATABASE_URL и установлен пакет pg) или память (для разработки/тестов).
// Оба варианта дают один и тот же асинхронный интерфейс; ошибки — Error с полем code.
import { START_COINS } from './public/catalog.js';

export const dbErr = (code) => Object.assign(new Error(code), { code });

const TOP_BY = { xp: 'xp', kills: 'kills', wins: 'wins', headshots: 'headshots' };

// ============================================================================
//  PostgreSQL
// ============================================================================
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id serial PRIMARY KEY,
     email text NOT NULL,
     nick text NOT NULL,
     pass text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     xp int NOT NULL DEFAULT 0,
     coins int NOT NULL DEFAULT ${START_COINS},
     kills int NOT NULL DEFAULT 0,
     deaths int NOT NULL DEFAULT 0,
     headshots int NOT NULL DEFAULT 0,
     matches int NOT NULL DEFAULT 0,
     wins int NOT NULL DEFAULT 0,
     secs int NOT NULL DEFAULT 0,
     best_kills int NOT NULL DEFAULT 0,
     streak int NOT NULL DEFAULT 0,
     last_daily text,
     clan_id int,
     equipped jsonb NOT NULL DEFAULT '{}'::jsonb
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_u ON users (lower(email))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_nick_u ON users (lower(nick))`,
  `CREATE INDEX IF NOT EXISTS users_clan_i ON users (clan_id)`,
  `CREATE TABLE IF NOT EXISTS user_items (
     user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     item_id text NOT NULL,
     at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, item_id)
   )`,
  `CREATE TABLE IF NOT EXISTS clans (
     id serial PRIMARY KEY,
     name text NOT NULL,
     tag text NOT NULL,
     owner_id int NOT NULL,
     descr text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS clans_name_u ON clans (lower(name))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS clans_tag_u ON clans (upper(tag))`,
  `CREATE TABLE IF NOT EXISTS match_log (
     id serial PRIMARY KEY,
     user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     at timestamptz NOT NULL DEFAULT now(),
     kills int NOT NULL, deaths int NOT NULL, hs int NOT NULL, win int NOT NULL,
     xp int NOT NULL, coins int NOT NULL, secs int NOT NULL, skill int NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS match_log_user_i ON match_log (user_id, id DESC)`,
];

const UCOLS = `id, email, nick, pass, xp, coins, kills, deaths, headshots, matches, wins, secs, best_kills, streak, last_daily, clan_id, equipped,
  (extract(epoch from created_at) * 1000)::float8 AS created_at`;

export class PgStore {
  constructor(pool) { this.pool = pool; this.kind = 'postgres'; }

  q(text, params = []) { return this.pool.query(text, params); }

  async init() {
    for (const s of SCHEMA) await this.q(s);
  }

  mapUnique(e) {
    if (e && e.code === '23505') {
      const c = String(e.constraint || e.message || '');
      if (c.includes('email')) return dbErr('email_taken');
      if (c.includes('nick')) return dbErr('nick_taken');
      if (c.includes('clans_name')) return dbErr('clan_name_taken');
      if (c.includes('clans_tag')) return dbErr('clan_tag_taken');
    }
    return e;
  }

  async createUser({ email, nick, pass, equipped = {} }) {
    try {
      const r = await this.q(
        `INSERT INTO users (email, nick, pass, equipped) VALUES ($1, $2, $3, $4::jsonb) RETURNING ${UCOLS}`,
        [email, nick, pass, JSON.stringify(equipped)]);
      return r.rows[0];
    } catch (e) { throw this.mapUnique(e); }
  }
  async userById(id) { return (await this.q(`SELECT ${UCOLS} FROM users WHERE id = $1`, [id])).rows[0] || null; }
  async userByEmail(email) { return (await this.q(`SELECT ${UCOLS} FROM users WHERE lower(email) = lower($1)`, [email])).rows[0] || null; }
  async userByNick(nick) { return (await this.q(`SELECT ${UCOLS} FROM users WHERE lower(nick) = lower($1)`, [nick])).rows[0] || null; }
  async setPass(id, pass) { await this.q(`UPDATE users SET pass = $2 WHERE id = $1`, [id, pass]); }

  async claimDaily(id, today, streak, coins) {
    const r = await this.q(
      `UPDATE users SET last_daily = $2, streak = $3, coins = coins + $4
       WHERE id = $1 AND last_daily IS DISTINCT FROM $2 RETURNING ${UCOLS}`, [id, today, streak, coins]);
    return r.rows[0] || null;
  }

  async applyMatch(id, m) {
    const r = await this.q(
      `UPDATE users SET xp = xp + $2, coins = coins + $3, kills = kills + $4, deaths = deaths + $5,
         headshots = headshots + $6, matches = matches + 1, wins = wins + $7, secs = secs + $8,
         best_kills = GREATEST(best_kills, $4) WHERE id = $1 RETURNING ${UCOLS}`,
      [id, m.xp, m.coins, m.kills, m.deaths, m.hs, m.win ? 1 : 0, m.secs]);
    const u = r.rows[0];
    if (!u) return null;
    await this.q(
      `INSERT INTO match_log (user_id, kills, deaths, hs, win, xp, coins, secs, skill) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, m.kills, m.deaths, m.hs, m.win ? 1 : 0, m.xp, m.coins, m.secs, m.skill | 0]);
    return u;
  }
  async matchesOf(id, limit = 15) {
    return (await this.q(
      `SELECT kills, deaths, hs, win, xp, coins, secs, skill, (extract(epoch from at) * 1000)::float8 AS at
       FROM match_log WHERE user_id = $1 ORDER BY id DESC LIMIT $2`, [id, limit])).rows;
  }

  async topUsers(by = 'xp', limit = 50) {
    const col = TOP_BY[by] || 'xp';
    return (await this.q(
      `SELECT u.id, u.nick, u.xp, u.kills, u.deaths, u.headshots, u.wins, u.matches, c.tag AS clan_tag
       FROM users u LEFT JOIN clans c ON c.id = u.clan_id
       WHERE u.matches > 0 ORDER BY u.${col} DESC, u.id LIMIT $1`, [limit])).rows;
  }
  async counts() {
    const r = await this.q(`SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM match_log)::int AS matches, (SELECT coalesce(sum(kills),0) FROM users)::int AS kills`);
    return r.rows[0];
  }

  // ----- магазин -----
  async owned(id) { return (await this.q(`SELECT item_id FROM user_items WHERE user_id = $1`, [id])).rows.map((r) => r.item_id); }
  async buy(id, itemId, price) {
    const r = await this.q(
      `WITH u AS (UPDATE users SET coins = coins - $2 WHERE id = $1 AND coins >= $2
                    AND NOT EXISTS (SELECT 1 FROM user_items WHERE user_id = $1 AND item_id = $3) RETURNING id)
       INSERT INTO user_items (user_id, item_id) SELECT id, $3 FROM u RETURNING item_id`, [id, price, itemId]);
    if (r.rows.length) return this.userById(id);
    if ((await this.owned(id)).includes(itemId)) throw dbErr('owned');
    throw dbErr('no_coins');
  }
  async setEquipped(id, equipped) {
    await this.q(`UPDATE users SET equipped = $2::jsonb WHERE id = $1`, [id, JSON.stringify(equipped)]);
  }

  // ----- кланы -----
  async clanById(id) {
    return (await this.q(
      `SELECT c.id, c.name, c.tag, c.owner_id, c.descr, (extract(epoch from c.created_at) * 1000)::float8 AS created_at,
              count(u.id)::int AS members, coalesce(sum(u.kills), 0)::int AS kills, coalesce(sum(u.xp), 0)::int AS xp, coalesce(sum(u.wins), 0)::int AS wins
       FROM clans c LEFT JOIN users u ON u.clan_id = c.id WHERE c.id = $1 GROUP BY c.id`, [id])).rows[0] || null;
  }
  async clanList(q = '', limit = 50) {
    return (await this.q(
      `SELECT c.id, c.name, c.tag, c.descr, count(u.id)::int AS members, coalesce(sum(u.kills), 0)::int AS kills, coalesce(sum(u.xp), 0)::int AS xp
       FROM clans c LEFT JOIN users u ON u.clan_id = c.id
       WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.tag ILIKE '%' || $1 || '%')
       GROUP BY c.id ORDER BY xp DESC, c.id LIMIT $2`, [q, limit])).rows;
  }
  async clanMembers(cid) {
    return (await this.q(
      `SELECT id, nick, xp, kills, deaths, wins, matches FROM users WHERE clan_id = $1 ORDER BY xp DESC, id`, [cid])).rows;
  }
  async createClan(uid, { name, tag, descr }, cost) {
    const u = await this.userById(uid);
    if (!u) throw dbErr('not_found');
    if (u.clan_id) throw dbErr('in_clan');
    if (u.coins < cost) throw dbErr('no_coins');
    let c;
    try {
      c = (await this.q(`INSERT INTO clans (name, tag, owner_id, descr) VALUES ($1, $2, $3, $4) RETURNING id`, [name, tag, uid, descr])).rows[0];
    } catch (e) { throw this.mapUnique(e); }
    const r = await this.q(
      `UPDATE users SET clan_id = $2, coins = coins - $3 WHERE id = $1 AND clan_id IS NULL AND coins >= $3 RETURNING id`, [uid, c.id, cost]);
    if (!r.rows.length) {
      await this.q(`DELETE FROM clans WHERE id = $1`, [c.id]);
      throw dbErr('no_coins');
    }
    return c.id;
  }
  async joinClan(uid, cid, max) {
    const r = await this.q(
      `UPDATE users SET clan_id = $2 WHERE id = $1 AND clan_id IS NULL
         AND (SELECT count(*) FROM users WHERE clan_id = $2) < $3 RETURNING id`, [uid, cid, max]);
    if (r.rows.length) return;
    const u = await this.userById(uid);
    if (u && u.clan_id) throw dbErr('in_clan');
    throw dbErr('clan_full');
  }
  async leaveClan(uid) {
    const u = await this.userById(uid);
    if (!u || !u.clan_id) throw dbErr('no_clan');
    const cid = u.clan_id;
    await this.q(`UPDATE users SET clan_id = NULL WHERE id = $1`, [uid]);
    const c = (await this.q(`SELECT owner_id FROM clans WHERE id = $1`, [cid])).rows[0];
    if (c && c.owner_id === uid) {
      const next = (await this.q(`SELECT id FROM users WHERE clan_id = $1 ORDER BY xp DESC, id LIMIT 1`, [cid])).rows[0];
      if (next) await this.q(`UPDATE clans SET owner_id = $2 WHERE id = $1`, [cid, next.id]);
      else await this.q(`DELETE FROM clans WHERE id = $1`, [cid]);
    }
  }
  async kick(ownerId, targetId) {
    const o = await this.userById(ownerId);
    if (!o || !o.clan_id) throw dbErr('no_clan');
    const c = (await this.q(`SELECT owner_id FROM clans WHERE id = $1`, [o.clan_id])).rows[0];
    if (!c || c.owner_id !== ownerId) throw dbErr('not_owner');
    if (targetId === ownerId) throw dbErr('not_found');
    const r = await this.q(`UPDATE users SET clan_id = NULL WHERE id = $1 AND clan_id = $2 RETURNING id`, [targetId, o.clan_id]);
    if (!r.rows.length) throw dbErr('not_found');
  }
  async clanTags(ids) {
    if (!ids.length) return {};
    const rows = (await this.q(`SELECT u.id, c.tag FROM users u JOIN clans c ON c.id = u.clan_id WHERE u.id = ANY($1::int[])`, [ids])).rows;
    return Object.fromEntries(rows.map((r) => [r.id, r.tag]));
  }
}

// ============================================================================
//  Память
// ============================================================================
export class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.users = new Map(); this.items = new Map(); this.clans = new Map(); this.log = [];
    this.uid = 1; this.cid = 1;
  }
  async init() {}
  pub(u) { return u ? { ...u, equipped: { ...u.equipped } } : null; }
  find(f) { for (const u of this.users.values()) if (f(u)) return u; return null; }

  async createUser({ email, nick, pass, equipped = {} }) {
    if (this.find((u) => u.email.toLowerCase() === email.toLowerCase())) throw dbErr('email_taken');
    if (this.find((u) => u.nick.toLowerCase() === nick.toLowerCase())) throw dbErr('nick_taken');
    const u = {
      id: this.uid++, email, nick, pass, created_at: Date.now(), xp: 0, coins: START_COINS, kills: 0, deaths: 0, headshots: 0,
      matches: 0, wins: 0, secs: 0, best_kills: 0, streak: 0, last_daily: null, clan_id: null, equipped: { ...equipped },
    };
    this.users.set(u.id, u); this.items.set(u.id, new Set());
    return this.pub(u);
  }
  async userById(id) { return this.pub(this.users.get(id)); }
  async userByEmail(email) { return this.pub(this.find((u) => u.email.toLowerCase() === String(email).toLowerCase())); }
  async userByNick(nick) { return this.pub(this.find((u) => u.nick.toLowerCase() === String(nick).toLowerCase())); }
  async setPass(id, pass) { const u = this.users.get(id); if (u) u.pass = pass; }

  async claimDaily(id, today, streak, coins) {
    const u = this.users.get(id);
    if (!u || u.last_daily === today) return null;
    u.last_daily = today; u.streak = streak; u.coins += coins;
    return this.pub(u);
  }
  async applyMatch(id, m) {
    const u = this.users.get(id);
    if (!u) return null;
    u.xp += m.xp; u.coins += m.coins; u.kills += m.kills; u.deaths += m.deaths; u.headshots += m.hs;
    u.matches++; u.wins += m.win ? 1 : 0; u.secs += m.secs; u.best_kills = Math.max(u.best_kills, m.kills);
    this.log.push({ user_id: id, at: Date.now(), kills: m.kills, deaths: m.deaths, hs: m.hs, win: m.win ? 1 : 0, xp: m.xp, coins: m.coins, secs: m.secs, skill: m.skill | 0 });
    return this.pub(u);
  }
  async matchesOf(id, limit = 15) {
    return this.log.filter((l) => l.user_id === id).slice(-limit).reverse().map(({ user_id, ...r }) => r);
  }
  async topUsers(by = 'xp', limit = 50) {
    const col = TOP_BY[by] || 'xp';
    return [...this.users.values()].filter((u) => u.matches > 0)
      .sort((a, b) => b[col] - a[col] || a.id - b.id).slice(0, limit)
      .map((u) => ({ id: u.id, nick: u.nick, xp: u.xp, kills: u.kills, deaths: u.deaths, headshots: u.headshots, wins: u.wins, matches: u.matches, clan_tag: u.clan_id ? this.clans.get(u.clan_id).tag : null }));
  }
  async counts() {
    let kills = 0; for (const u of this.users.values()) kills += u.kills;
    return { users: this.users.size, matches: this.log.length, kills };
  }

  async owned(id) { return [...(this.items.get(id) || [])]; }
  async buy(id, itemId, price) {
    const u = this.users.get(id), set = this.items.get(id);
    if (!u) throw dbErr('not_found');
    if (set.has(itemId)) throw dbErr('owned');
    if (u.coins < price) throw dbErr('no_coins');
    u.coins -= price; set.add(itemId);
    return this.pub(u);
  }
  async setEquipped(id, equipped) { const u = this.users.get(id); if (u) u.equipped = { ...equipped }; }

  members(cid) { return [...this.users.values()].filter((u) => u.clan_id === cid); }
  agg(c) {
    const ms = this.members(c.id);
    return { id: c.id, name: c.name, tag: c.tag, owner_id: c.owner_id, descr: c.descr, created_at: c.created_at, members: ms.length,
      kills: ms.reduce((s, u) => s + u.kills, 0), xp: ms.reduce((s, u) => s + u.xp, 0), wins: ms.reduce((s, u) => s + u.wins, 0) };
  }
  async clanById(id) { const c = this.clans.get(id); return c ? this.agg(c) : null; }
  async clanList(q = '', limit = 50) {
    q = q.toLowerCase();
    return [...this.clans.values()].filter((c) => !q || c.name.toLowerCase().includes(q) || c.tag.toLowerCase().includes(q))
      .map((c) => this.agg(c)).sort((a, b) => b.xp - a.xp || a.id - b.id).slice(0, limit);
  }
  async clanMembers(cid) {
    return this.members(cid).sort((a, b) => b.xp - a.xp || a.id - b.id)
      .map((u) => ({ id: u.id, nick: u.nick, xp: u.xp, kills: u.kills, deaths: u.deaths, wins: u.wins, matches: u.matches }));
  }
  async createClan(uid, { name, tag, descr }, cost) {
    const u = this.users.get(uid);
    if (!u) throw dbErr('not_found');
    if (u.clan_id) throw dbErr('in_clan');
    if (u.coins < cost) throw dbErr('no_coins');
    for (const c of this.clans.values()) {
      if (c.name.toLowerCase() === name.toLowerCase()) throw dbErr('clan_name_taken');
      if (c.tag.toUpperCase() === tag.toUpperCase()) throw dbErr('clan_tag_taken');
    }
    const c = { id: this.cid++, name, tag, owner_id: uid, descr, created_at: Date.now() };
    this.clans.set(c.id, c); u.clan_id = c.id; u.coins -= cost;
    return c.id;
  }
  async joinClan(uid, cid, max) {
    const u = this.users.get(uid);
    if (!u) throw dbErr('not_found');
    if (u.clan_id) throw dbErr('in_clan');
    if (this.members(cid).length >= max) throw dbErr('clan_full');
    u.clan_id = cid;
  }
  async leaveClan(uid) {
    const u = this.users.get(uid);
    if (!u || !u.clan_id) throw dbErr('no_clan');
    const cid = u.clan_id; u.clan_id = null;
    const c = this.clans.get(cid);
    if (c && c.owner_id === uid) {
      const next = this.members(cid).sort((a, b) => b.xp - a.xp || a.id - b.id)[0];
      if (next) c.owner_id = next.id; else this.clans.delete(cid);
    }
  }
  async kick(ownerId, targetId) {
    const o = this.users.get(ownerId);
    if (!o || !o.clan_id) throw dbErr('no_clan');
    const c = this.clans.get(o.clan_id);
    if (!c || c.owner_id !== ownerId) throw dbErr('not_owner');
    const t = this.users.get(targetId);
    if (targetId === ownerId || !t || t.clan_id !== o.clan_id) throw dbErr('not_found');
    t.clan_id = null;
  }
  async clanTags(ids) {
    const out = {};
    for (const id of ids) { const u = this.users.get(id); if (u && u.clan_id) out[id] = this.clans.get(u.clan_id).tag; }
    return out;
  }
}

export async function createStore(env = process.env, log = console) {
  const url = env.DATABASE_URL;
  if (url) {
    try {
      const pg = await import('pg');
      const Pool = pg.Pool || pg.default.Pool;
      const pool = new Pool({ connectionString: url, max: 8, ssl: env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined });
      pool.on('error', (e) => log.error('pg pool error', e.message));
      const store = new PgStore(pool);
      await store.init();
      log.log('База данных: PostgreSQL');
      return store;
    } catch (e) {
      log.error('PostgreSQL недоступен, работаем в памяти:', e.message);
      const mem = new MemoryStore();
      mem.degraded = true; // сайт покажет предупреждение: прогресс не сохраняется
      return mem;
    }
  } else {
    log.warn('DATABASE_URL не задан: данные хранятся в памяти и пропадут при перезапуске');
  }
  return new MemoryStore();
}
