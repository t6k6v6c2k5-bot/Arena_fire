// Локальный сервер для предпросмотра сайта без установленных пакетов: статика + настоящий API на хранилище в памяти.
// Запуск: node --import ./test/dev-register.mjs test/devserver.mjs 8099
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { inject } from './stub-express.mjs';
import { MemoryStore } from '../db.js';
import { createApi } from '../api.js';
import { makeSessions, hashPassword } from '../accounts.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
const store = new MemoryStore();
const api = createApi({ store, sessions: makeSessions('dev'), listRooms: () => [
  { id: 1, name: 'Комната 1', skill: 1, skillName: 'Средние', humans: 3, max: 8, state: 0, rem: 211, custom: 0, score: [12, 9] },
  { id: 2, name: 'Арена друзей', skill: 2, skillName: 'Сложные', humans: 8, max: 8, state: 1, rem: 9, custom: 1, score: [40, 33] }], onlineCount: () => 17 });
const app = express(); app.use('/api', api);

// демо-данные
const names = ['Viking', 'Shadow', 'Ghost', 'Hawk', 'Mamba', 'Фокс', 'Рысь'];
for (const [i, n] of names.entries()) {
  const u = await store.createUser({ email: n.toLowerCase() + '@x.io', nick: n, pass: await hashPassword('password1'), equipped: {} });
  for (let k = 0; k < 4 + i; k++) await store.applyMatch(u.id, { xp: 80 + i * 40, coins: 60, kills: 6 + i * 3 + k, deaths: 5 + k, hs: 2 + i, win: (k + i) % 2 === 0, secs: 300 });
}
const cid = await store.createClan((await store.userByNick('Viking')).id, { name: 'Северные волки', tag: 'WLF', descr: 'Играем по вечерам' }, 0);
await store.joinClan((await store.userByNick('Shadow')).id, cid, 30);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json', '.json': 'application/json' };
const PAGES = { '/': 'index.html', '/login': 'auth.html', '/register': 'auth.html', '/lobby': 'lobby.html', '/play': 'play.html', '/shop': 'shop.html', '/clans': 'clans.html', '/leaders': 'leaders.html', '/profile': 'profile.html', '/settings': 'settings.html' };
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const out = await inject(app, { method: req.method, url: req.url, headers: req.headers, raw: raw || undefined });
      const h = { 'Content-Type': 'application/json' };
      if (out.headers['set-cookie']) h['Set-Cookie'] = out.headers['set-cookie'];
      res.writeHead(out.status, h); res.end(JSON.stringify(out.body));
    });
    return;
  }
  let file = PAGES[url] || (url.startsWith('/profile/') ? 'profile.html' : url.startsWith('/clan/') ? 'clan.html' : url.slice(1));
  const p = path.join(root, file);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(Number(process.argv[2] || 8099), () => console.log('dev server up'));
