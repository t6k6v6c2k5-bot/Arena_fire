// Авторитетный сервер Arena Fire: комнаты, боты, хитскан с лаг-компенсацией.
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import * as S from './public/shared.js';
import { Room, num } from './game.js';
import { verifyInitData } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clamp = S.clamp;
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const REQUIRE_TG = process.env.REQUIRE_TG === '1';


// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
const rooms = new Map();

app.get('/health', (_req, res) => {
  let humans = 0;
  for (const r of rooms.values()) humans += r.humans().length;
  res.json({ ok: true, rooms: rooms.size, humans });
});
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 15000,
  maxHttpBufferSize: 1e5,
});

// ---------- Комнаты ----------
let roomSeq = 1;
function findRoom(skill) {
  for (const r of rooms.values()) if (r.skillIdx === skill && r.humans().length < S.MATCH.maxHumans) return r;
  const r = new Room(roomSeq++, skill);
  rooms.set(r.id, r);
  return r;
}

io.on('connection', (socket) => {
  let room = null;
  let me = null;

  socket.on('join', (data, cb) => {
    if (me) return;
    data = data || {};
    const user = verifyInitData(String(data.initData || ''), BOT_TOKEN);
    if (REQUIRE_TG && !user) {
      socket.emit('denied', { reason: 'Откройте игру через Telegram' });
      return;
    }
    let name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username : String(data.name || '');
    name = String(name || 'Игрок').replace(/[<>&"'\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Игрок';

    const skill = S.clamp(Math.floor(num(data.skill, 0)), 0, 2);
    room = findRoom(skill);
    me = room.addHuman(socket, name);
    me.assist = data.touch ? 1 : 0.3; // помощь прицеливания: полная на телефоне, лёгкая на ПК
    room.fillBots();
    socket.emit('welcome', room.welcome(me));
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('input', (m) => { if (me && room) room.queueInput(me, m); });

  socket.on('p', (cb) => { if (typeof cb === 'function') cb(); });

  socket.on('disconnect', () => {
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

server.listen(PORT, () => console.log(`Arena Fire listening on :${PORT} (telegram auth ${BOT_TOKEN ? 'on' : 'off'}${REQUIRE_TG ? ', required' : ''})`));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { io.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000); });
