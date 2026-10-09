// Arena Fire: сайт + аккаунты + авторитетный игровой сервер (Express, Socket.io, PostgreSQL).
import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import * as S from './public/shared.js';
import { Room, num } from './game.js';
import { createStore } from './db.js';
import { createApi } from './api.js';
import { makeSessions, parseCookies, COOKIE } from './accounts.js';
import { cleanEquip, FREE_ITEMS, matchReward, levelFromXp, DEFAULT_EQUIP } from './public/catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MAX_ROOMS = 60;

if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET не задан: сессии сбросятся при перезапуске. Добавьте переменную SESSION_SECRET в Railway.');
const sessions = makeSessions(process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'));
const store = await createStore();

// ---------- Комнаты ----------
const rooms = new Map();
let roomSeq = 1;
const inGame = new Map(); // uid -> socket.id: один аккаунт — одно подключение к матчу

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += A[crypto.randomInt(A.length)];
    if (![...rooms.values()].some((r) => r.code === c)) return c;
  }
}

async function giveReward(room, p, res) {
  const rw = matchReward(res);
  const before = await store.userById(p.uid);
  if (!before) return;
  const u = await store.applyMatch(p.uid, { ...rw, kills: res.kills, deaths: res.deaths, hs: res.hs, win: res.win, secs: res.secs, skill: res.skill });
  if (!u || !p.sock) return;
  const l0 = levelFromXp(before.xp), l1 = levelFromXp(u.xp);
  p.sock.emit('reward', { xp: rw.xp, coins: rw.coins, level: l1, levelUp: l1 > l0, totalXp: u.xp });
}

function makeRoom(skill, opts) {
  const r = new Room(roomSeq++, skill, opts);
  r.onResult = (p, res) => { giveReward(r, p, res).catch((e) => console.error('reward', e)); };
  rooms.set(r.id, r);
  return r;
}
function findRoom(skill, mode) {
  for (const r of rooms.values()) if (!r.custom && r.skillIdx === skill && r.mode.id === mode && r.humans().length < S.MATCH.maxHumans) return r;
  return makeRoom(skill, { mode });
}
function listRooms() {
  const out = [];
  for (const r of rooms.values()) {
    if (r.priv || !r.humans().length) continue;
    out.push({ id: r.id, name: r.name || `Комната ${r.id}`, skill: r.skillIdx, skillName: r.skill.name, humans: r.humans().length, max: S.MATCH.maxHumans,
      state: r.state, rem: Math.max(0, Math.ceil(r.state === 0 ? r.endT : r.overT)), custom: r.custom ? 1 : 0, score: r.scores, mode: r.mode.id, modeName: r.mode.name });
  }
  return out;
}
const onlineCount = () => io.engine?.clientsCount ?? 0;

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.get('/health', (_req, res) => {
  let humans = 0;
  for (const r of rooms.values()) humans += r.humans().length;
  res.json({ ok: true, rooms: rooms.size, humans, db: store.kind });
});

const api = createApi({ store, sessions, listRooms, onlineCount });
app.use('/api', api);

app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build'), { maxAge: '7d' }));
app.use(express.static(PUB, { maxAge: '5m', extensions: ['html'], index: false }));

// Красивые адреса страниц.
const PAGES = { '/': 'index.html', '/login': 'auth.html', '/register': 'auth.html', '/lobby': 'lobby.html', '/play': 'play.html',
  '/shop': 'shop.html', '/clans': 'clans.html', '/leaders': 'leaders.html', '/profile': 'profile.html', '/settings': 'settings.html' };
for (const [url, file] of Object.entries(PAGES)) app.get(url, (_req, res) => res.sendFile(path.join(PUB, file)));
app.get('/profile/:nick', (_req, res) => res.sendFile(path.join(PUB, 'profile.html')));
app.get('/clan/:id', (_req, res) => res.sendFile(path.join(PUB, 'clan.html')));
app.use((_req, res) => res.status(404).sendFile(path.join(PUB, '404.html')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  pingInterval: 10000,
  pingTimeout: 15000,
  maxHttpBufferSize: 1e5,
});

// ---------- Сокеты ----------
const chatLog = [];
const cleanName = (s) => String(s || 'Игрок').replace(/[<>&"'\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Игрок';

io.on('connection', (socket) => {
  let room = null, me = null, joining = false, uid = null, lastChat = 0;

  const authUser = async () => {
    const token = parseCookies(socket.handshake?.headers?.cookie)[COOKIE];
    return api.userFromToken(token);
  };

  // Лобби: чат и онлайн для вошедших игроков.
  socket.on('lobby', async () => {
    socket.join?.('lobby');
    socket.emit('chat:history', chatLog);
  });
  socket.on('chat', async (text) => {
    const now = Date.now();
    if (now - lastChat < 1500 || typeof text !== 'string') return;
    lastChat = now;
    const u = await authUser();
    if (!u) return;
    const t = text.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    if (!t) return;
    const clan = u.clan_id ? await store.clanById(u.clan_id) : null;
    const msg = { nick: u.nick, tag: clan ? clan.tag : '', text: t, t: now };
    chatLog.push(msg); if (chatLog.length > 40) chatLog.shift();
    io.to?.('lobby').emit('chat', msg);
  });

  socket.on('join', async (data) => {
    if (me || joining) return;
    joining = true;
    try {
      data = data && typeof data === 'object' ? data : {};
      const user = await authUser();
      if (!user && !data.guest) { socket.emit('denied', { reason: 'Войдите в аккаунт или играйте как гость', login: 1 }); return; }
      if (user && inGame.has(user.id)) { socket.emit('denied', { reason: 'Этот аккаунт уже в игре на другом устройстве' }); return; }

      const skill = S.clamp(Math.floor(num(data.skill, 0)), 0, 2);
      const gm = S.MODES[data.gm] ? data.gm : 'tdm';
      let r = null;
      if (data.mode === 'create') {
        if (!user) { socket.emit('denied', { reason: 'Создавать комнаты могут только игроки с аккаунтом', login: 1 }); return; }
        if (rooms.size >= MAX_ROOMS) { socket.emit('denied', { reason: 'Сервер перегружен, попробуйте позже' }); return; }
        r = makeRoom(skill, { name: cleanName(data.roomName).slice(0, 24) || `Комната ${user.nick}`, priv: !!data.priv, custom: true, code: newCode(), mode: gm });
      } else if (data.mode === 'room') {
        r = rooms.get(Math.floor(num(data.roomId, -1)));
        if (!r || r.priv) { socket.emit('denied', { reason: 'Комната не найдена' }); return; }
      } else if (data.mode === 'code') {
        const code = String(data.code || '').toUpperCase().trim();
        r = [...rooms.values()].find((x) => x.code && x.code === code);
        if (!r) { socket.emit('denied', { reason: 'Комната с таким кодом не найдена' }); return; }
      } else {
        if (rooms.size >= MAX_ROOMS) { r = [...rooms.values()].find((x) => !x.custom && x.humans().length < S.MATCH.maxHumans); }
        r = r || findRoom(skill, gm);
      }
      if (!r) { socket.emit('denied', { reason: 'Нет свободных комнат' }); return; }
      if (r.humans().length >= S.MATCH.maxHumans) { socket.emit('denied', { reason: 'Комната заполнена' }); return; }
      if (me) return; // отключился/присоединился во время ожидания

      let name, extra = {};
      if (user) {
        const owned = [...new Set([...FREE_ITEMS, ...(await store.owned(user.id))])];
        const clan = user.clan_id ? await store.clanById(user.clan_id) : null;
        name = user.nick;
        extra = { uid: user.id, equip: cleanEquip(user.equipped, owned), tag: clan ? clan.tag : '', level: levelFromXp(user.xp) };
        uid = user.id; inGame.set(uid, socket.id);
      } else {
        name = cleanName(data.name);
        extra = { equip: { ...DEFAULT_EQUIP }, tag: 'ГОСТЬ' };
      }
      room = r;
      me = room.addHuman(socket, name, extra);
      me.assist = data.touch ? 1 : 0; // помощь прицеливания только на телефоне; ПК играет честно, без помощи
      me.plat = data.touch ? 'm' : 'p'; // у ника в игре показываем, с чего человек играет
      room.fillBots();
      socket.emit('welcome', { ...room.welcome(me), account: user ? 1 : 0 });
    } catch (e) {
      console.error('join', e);
      socket.emit('denied', { reason: 'Ошибка входа в комнату' });
    } finally { joining = false; }
  });

  socket.on('input', (m) => { if (me && room) room.queueInput(me, m); });
  socket.on('p', (cb) => { if (typeof cb === 'function') cb(); });

  socket.on('disconnect', () => {
    if (uid && inGame.get(uid) === socket.id) inGame.delete(uid);
    if (room && me) {
      room.removePlayer(me.id);
      if (!room.humans().length) rooms.delete(room.id);
    }
    room = null; me = null;
  });
});

setInterval(() => {
  for (const r of rooms.values()) {
    try { r.tick(); } catch (e) { console.error('tick error', e); }
  }
}, 1000 / S.TICK);

server.listen(PORT, () => console.log(`Arena Fire listening on :${PORT} (db: ${store.kind})`));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { io.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000); });
