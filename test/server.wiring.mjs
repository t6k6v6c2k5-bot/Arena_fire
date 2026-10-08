// Проверка обвязки server.js (join / input / disconnect / health) с заглушками express и socket.io.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./server-hooks.mjs', import.meta.url);
process.env.PORT = '0';

const { routes } = await import('./stub-express.mjs');
const { state } = await import('./stub-socketio.mjs');
await import('../server.js');
assert.equal(typeof state.onConnection, 'function', 'server.js не подписался на connection');

function sock() {
  const h = {}, got = {};
  const s = {
    on: (ev, fn) => { h[ev] = fn; },
    emit: (ev, d) => { (got[ev] ??= []).push(d); },
    got, h,
  };
  s.volatile = s;
  return s;
}
const health = () => { let out; routes['/health']({}, { json: (d) => { out = d; } }); return out; };

const a = sock(); state.onConnection(a);
a.h.join({ name: '<b>Игрок&Один</b>' });
assert.ok(a.got.welcome, 'нет welcome');
const w = a.got.welcome[0];
assert.equal(w.players.length, 8);
assert.equal(health().humans, 1);
assert.ok(!/[<>&]/.test(w.players.find((p) => p.id === w.id).name), 'имя не очищено');

a.h.join({ name: 'повтор' }); // повторный join игнорируется
assert.equal(a.got.welcome.length, 1);

a.h.input({ seq: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, jump: false, fire: false, reload: false, weapon: 0, rt: Date.now() });
a.h.input('мусор'); a.h.input(null); a.h.input({ seq: 'x' });
await new Promise((r) => setTimeout(r, 250));
assert.ok(a.got.snap?.length > 3, 'нет снапшотов');
assert.equal(a.got.snap.at(-1).ack >= 1, true, 'ввод не обработан');

let pinged = false; a.h.p(() => { pinged = true; }); assert.ok(pinged);

const b = sock(); state.onConnection(b); b.h.join({ name: 'Второй' });
assert.equal(health().humans, 2);
assert.equal(health().rooms, 1, 'второй игрок должен попасть в ту же комнату');

// другая сложность — отдельная комната, помощь прицеливания по флагу тача
const c = sock(); state.onConnection(c); c.h.join({ name: 'Хард', skill: 2, touch: true });
assert.equal(c.got.welcome[0].skill, 2);
assert.equal(health().rooms, 2, 'комнаты разной сложности должны быть раздельными');
const d = sock(); state.onConnection(d); d.h.join({ name: 'Нет такой сложности', skill: 99 });
assert.equal(d.got.welcome[0].skill, 2, 'неверная сложность должна ограничиваться');

a.h.disconnect(); b.h.disconnect(); c.h.disconnect(); d.h.disconnect();
assert.equal(health().rooms, 0, 'пустая комната не удалена');

console.log('server.wiring.mjs: все проверки пройдены');
process.exit(0);
