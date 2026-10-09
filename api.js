// HTTP API сайта: аккаунты, профиль, магазин, кланы, рейтинг, статистика.
import express from 'express';
import {
  ITEMS, ITEM_BY_ID, TYPES, FREE_ITEMS, DEFAULT_EQUIP, cleanEquip, levelInfo, rankName, dailyBonus,
  NICK_RE, EMAIL_RE, CLAN_NAME_RE, CLAN_TAG_RE, CLAN_COST, CLAN_MAX,
} from './public/catalog.js';
import { hashPassword, verifyPassword, parseCookies, cookieHeader, COOKIE, RateLimit } from './accounts.js';

const MSG = {
  email_taken: 'Этот email уже зарегистрирован',
  nick_taken: 'Этот позывной уже занят',
  no_coins: 'Недостаточно монет',
  owned: 'Уже куплено',
  clan_name_taken: 'Клан с таким названием уже есть',
  clan_tag_taken: 'Такой тег уже занят',
  in_clan: 'Вы уже состоите в клане',
  clan_full: 'В клане нет мест',
  no_clan: 'Вы не в клане',
  not_owner: 'Только глава клана может это делать',
  not_found: 'Не найдено',
};
const STATUS = { not_found: 404, not_owner: 403 };

const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function createApi({ store, sessions, listRooms, onlineCount }) {
  const r = express.Router();
  const ipLimit = new RateLimit(30, 10 * 60 * 1000);
  const idLimit = new RateLimit(8, 10 * 60 * 1000);

  const fail = (res, status, error) => res.status(status).json({ error });
  const dbFail = (res, e) => {
    if (e && MSG[e.code]) return fail(res, STATUS[e.code] || 400, MSG[e.code]);
    console.error('api error', e);
    return fail(res, 500, 'Ошибка сервера');
  };
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => dbFail(res, e));

  r.use(express.json({ limit: '10kb' }));

  // Защита от межсайтовых запросов: только JSON и тот же источник.
  r.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (!req.is('json')) return fail(res, 415, 'Нужен JSON');
      const o = req.headers.origin;
      if (o) { try { if (new URL(o).host !== req.headers.host) return fail(res, 403, 'Запрещено'); } catch { return fail(res, 403, 'Запрещено'); } }
    }
    next();
  });

  async function userFromToken(token) {
    const s = sessions.parse(token);
    if (!s) return null;
    const u = await store.userById(s.uid);
    return u && sessions.fp(u) === s.fp ? u : null;
  }
  const loadUser = (req, res, next) => {
    userFromToken(parseCookies(req.headers.cookie)[COOKIE]).then((u) => { req.user = u; next(); }, (e) => dbFail(res, e));
  };
  const need = (req, res, next) => (req.user ? next() : fail(res, 401, 'Войдите в аккаунт'));
  r.use(loadUser);

  async function view(u) {
    const owned = [...new Set([...FREE_ITEMS, ...(await store.owned(u.id))])];
    const clan = u.clan_id ? await store.clanById(u.clan_id) : null;
    const li = levelInfo(u.xp);
    return {
      id: u.id, nick: u.nick, email: u.email, xp: u.xp, coins: u.coins, level: li.level, lvl: li, rank: rankName(li.level),
      kills: u.kills, deaths: u.deaths, headshots: u.headshots, matches: u.matches, wins: u.wins, secs: u.secs,
      best_kills: u.best_kills, streak: u.streak, created_at: u.created_at,
      clan: clan ? { id: clan.id, name: clan.name, tag: clan.tag, owner: clan.owner_id === u.id } : null,
      owned, equipped: cleanEquip(u.equipped, owned),
    };
  }
  const dailyState = (u) => ({ available: u.last_daily !== utcDay(), next: dailyBonus(u.last_daily === utcDay(Date.now() - 86400000) ? u.streak + 1 : 1) });

  // ----- аккаунты -----
  function setSession(req, res, user) {
    res.setHeader('Set-Cookie', cookieHeader(sessions.issue(user), req.secure));
  }

  r.post('/register', wrap(async (req, res) => {
    if (!ipLimit.hit('reg:' + req.ip)) return fail(res, 429, 'Слишком много попыток, подождите');
    const email = str(req.body.email, 254).toLowerCase(), nick = str(req.body.nick, 32), pw = typeof req.body.password === 'string' ? req.body.password : '';
    if (!EMAIL_RE.test(email)) return fail(res, 400, 'Введите корректный email');
    if (!NICK_RE.test(nick)) return fail(res, 400, 'Позывной: 3–16 символов, буквы, цифры, _ и -');
    if (pw.length < 8 || pw.length > 100) return fail(res, 400, 'Пароль должен быть от 8 символов');
    const u = await store.createUser({ email, nick, pass: await hashPassword(pw), equipped: DEFAULT_EQUIP });
    setSession(req, res, u);
    res.json({ user: await view(u), daily: dailyState(u) });
  }));

  const DUMMY = hashPassword('dummy-password');
  r.post('/login', wrap(async (req, res) => {
    const id = str(req.body.login, 254).toLowerCase(), pw = typeof req.body.password === 'string' ? req.body.password : '';
    if (!ipLimit.hit('login:' + req.ip) || !idLimit.hit('login:' + id)) return fail(res, 429, 'Слишком много попыток, попробуйте через 10 минут');
    const u = id.includes('@') ? await store.userByEmail(id) : await store.userByNick(id);
    const ok = await verifyPassword(pw, u ? u.pass : await DUMMY);
    if (!u || !ok) return fail(res, 401, 'Неверный логин или пароль');
    idLimit.reset('login:' + id);
    setSession(req, res, u);
    res.json({ user: await view(u), daily: dailyState(u) });
  }));

  r.post('/logout', (req, res) => { res.setHeader('Set-Cookie', cookieHeader('', req.secure)); res.json({ ok: true }); });

  r.get('/me', wrap(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: await view(req.user), daily: dailyState(req.user) });
  }));

  r.post('/password', need, wrap(async (req, res) => {
    const oldp = typeof req.body.old === 'string' ? req.body.old : '', np = typeof req.body.new === 'string' ? req.body.new : '';
    if (!idLimit.hit('pw:' + req.user.id)) return fail(res, 429, 'Слишком много попыток');
    if (!(await verifyPassword(oldp, req.user.pass))) return fail(res, 400, 'Старый пароль неверный');
    if (np.length < 8 || np.length > 100) return fail(res, 400, 'Новый пароль должен быть от 8 символов');
    const hash = await hashPassword(np);
    await store.setPass(req.user.id, hash);
    setSession(req, res, { ...req.user, pass: hash });
    res.json({ ok: true });
  }));

  r.post('/daily', need, wrap(async (req, res) => {
    const u = req.user, today = utcDay();
    if (u.last_daily === today) return fail(res, 400, 'Бонус сегодня уже получен');
    const streak = u.last_daily === utcDay(Date.now() - 86400000) ? u.streak + 1 : 1;
    const coins = dailyBonus(streak);
    const nu = await store.claimDaily(u.id, today, streak, coins);
    if (!nu) return fail(res, 400, 'Бонус сегодня уже получен');
    res.json({ coins, streak, user: await view(nu), daily: dailyState(nu) });
  }));

  // ----- профиль и рейтинг -----
  r.get('/profile/:nick', wrap(async (req, res) => {
    const u = await store.userByNick(str(req.params.nick, 32));
    if (!u) return fail(res, 404, 'Игрок не найден');
    const v = await view(u);
    delete v.email; delete v.coins;
    res.json({ user: v, history: await store.matchesOf(u.id, 15) });
  }));

  r.get('/leaderboard', wrap(async (req, res) => {
    const by = ['xp', 'kills', 'wins', 'headshots'].includes(req.query.by) ? req.query.by : 'xp';
    const rows = await store.topUsers(by, 50);
    res.json({ by, rows: rows.map((x) => ({ ...x, level: levelInfo(x.xp).level })) });
  }));

  r.get('/stats', wrap(async (_req, res) => {
    const c = await store.counts();
    res.json({ ...c, online: onlineCount(), rooms: listRooms().length, db: store.kind, degraded: !!store.degraded });
  }));

  r.get('/rooms', (req, res) => res.json({ rooms: listRooms() }));

  // ----- магазин -----
  r.get('/shop', need, wrap(async (req, res) => {
    const v = await view(req.user);
    res.json({ items: ITEMS, coins: v.coins, level: v.level, owned: v.owned, equipped: v.equipped });
  }));

  r.post('/shop/buy', need, wrap(async (req, res) => {
    const it = ITEM_BY_ID[str(req.body.id, 40)];
    if (!it || it.price <= 0) return fail(res, 400, 'Нет такого предмета');
    if (levelInfo(req.user.xp).level < it.lvl) return fail(res, 400, `Нужен уровень ${it.lvl}`);
    const nu = await store.buy(req.user.id, it.id, it.price);
    res.json({ user: await view(nu) });
  }));

  r.post('/shop/equip', need, wrap(async (req, res) => {
    const it = ITEM_BY_ID[str(req.body.id, 40)];
    if (!it) return fail(res, 400, 'Нет такого предмета');
    const v = await view(req.user);
    if (!v.owned.includes(it.id)) return fail(res, 400, 'Сначала купите предмет');
    const eq = { ...v.equipped, [it.type]: it.id };
    await store.setEquipped(req.user.id, eq);
    res.json({ equipped: eq });
  }));

  // ----- кланы -----
  r.get('/clans', wrap(async (req, res) => {
    res.json({ clans: await store.clanList(str(req.query.q, 30), 50), cost: CLAN_COST, max: CLAN_MAX });
  }));

  r.get('/clans/:id', wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const c = Number.isInteger(id) ? await store.clanById(id) : null;
    if (!c) return fail(res, 404, 'Клан не найден');
    const members = (await store.clanMembers(id)).map((m) => ({ ...m, level: levelInfo(m.xp).level, owner: m.id === c.owner_id }));
    res.json({ clan: c, members, max: CLAN_MAX, mine: !!(req.user && req.user.clan_id === id), owner: !!(req.user && req.user.id === c.owner_id) });
  }));

  r.post('/clans', need, wrap(async (req, res) => {
    const name = str(req.body.name, 20), tag = str(req.body.tag, 4).toUpperCase(), descr = str(req.body.descr, 120);
    if (!CLAN_NAME_RE.test(name)) return fail(res, 400, 'Название клана: 3–20 символов, буквы, цифры, пробел, _ и -');
    if (!CLAN_TAG_RE.test(tag)) return fail(res, 400, 'Тег: 2–4 символа, латинские буквы и цифры');
    const id = await store.createClan(req.user.id, { name, tag, descr }, CLAN_COST);
    res.json({ id });
  }));

  r.post('/clans/leave', need, wrap(async (req, res) => { await store.leaveClan(req.user.id); res.json({ ok: true }); }));

  r.post('/clans/kick', need, wrap(async (req, res) => {
    const t = parseInt(req.body.id, 10);
    if (!Number.isInteger(t)) return fail(res, 400, 'Неверный игрок');
    await store.kick(req.user.id, t);
    res.json({ ok: true });
  }));

  r.post('/clans/:id/join', need, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || !(await store.clanById(id))) return fail(res, 404, 'Клан не найден');
    await store.joinClan(req.user.id, id, CLAN_MAX);
    res.json({ ok: true });
  }));

  r.use((_req, res) => fail(res, 404, 'Не найдено'));
  r.use((err, _req, res, _next) => { // например, битый JSON
    if (err && err.type === 'entity.parse.failed') return fail(res, 400, 'Неверный запрос');
    if (err && err.type === 'entity.too.large') return fail(res, 413, 'Слишком большой запрос');
    console.error('api', err);
    return fail(res, 500, 'Ошибка сервера');
  });

  r.userFromToken = userFromToken;
  return r;
}
