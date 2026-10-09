// Игровая логика сервера (без зависимостей): игроки, комнаты, боты, хитскан с лаг-компенсацией.
// Вынесена из server.js, чтобы её можно было тестировать без сети.
import * as S from './public/shared.js';

const clamp = S.clamp;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Сложность ботов: 0 — лёгкая, 1 — средняя, 2 — сложная.
export const BOT_SKILL = [
  { name: 'Лёгкие',   hp: 70,  dmg: 0.4, spread: 2.5, range: 35, react: [0.7, 1.3],   err: 0.16, aimTol: 0.06, burst: [0.2, 0.4],   pause: [0.6, 1.2],   turn: 2.2, strafe: 0.5, jump: 0 },
  { name: 'Средние',  hp: 100, dmg: 0.5, spread: 2.0, range: 40, react: [0.45, 0.9],  err: 0.10, aimTol: 0.08, burst: [0.25, 0.5],  pause: [0.4, 0.9],   turn: 3.0, strafe: 0.8, jump: 0.08 },
  { name: 'Сложные',  hp: 100, dmg: 0.7, spread: 1.5, range: 50, react: [0.3, 0.65],  err: 0.07, aimTol: 0.10, burst: [0.3, 0.7],   pause: [0.25, 0.6],  turn: 4.5, strafe: 0.9, jump: 0.15 },
];
// Помощь прицеливания: конус (рад), в котором выстрел притягивается к видимому врагу.
const ASSIST_ANGLE = 0.08;
const ASSIST_PULL = 0.85;

// ---------- Игроки ----------
const BOT_NAMES = ['Волк', 'Тень', 'Гвоздь', 'Ястреб', 'Шторм', 'Кобра', 'Дымок', 'Лис', 'Бизон', 'Рысь', 'Барс', 'Сокол'];
let nextId = 1;

function newAI() {
  return {
    target: null, lastSeen: 0, visible: false, nextScan: 0, reactAt: 0,
    strafe: 1, strafeT: 0, errYaw: 0, errPitch: 0, errT: 0,
    wp: null, wpT: 0, chkT: 0, sx: 0, sz: 0, burstUntil: 0, pauseUntil: 0,
  };
}

class Player {
  constructor(name, team, bot = false, sock = null) {
    this.id = nextId++;
    this.name = name;
    this.team = team;
    this.bot = bot;
    this.sock = sock;
    this.kills = 0;
    this.deaths = 0;
    this.alive = false;
    this.hp = 100;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.onGround = true;
    this.yaw = 0; this.pitch = 0;
    this.weapon = 0;
    this.wp = null;
    this.nextFire = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.prevFire = false;
    this.bloom = 0;   // рост разброса от очереди
    this.ads = false; // прицеливание
    this.queue = [];
    this.ack = 0;
    this.hist = [];
    this.respawnAt = 0;
    this.protectUntil = 0;
    this.ai = bot ? newAI() : null;
    this.assist = 0; // 0..1: помощь прицеливания (для тач-игроков 1)
    this.uid = null;        // id аккаунта (null — гость или бот)
    this.equip = null;      // экипировка из магазина {gun, armor, tracer}
    this.tag = '';          // тег клана
    this.level = 0;
    this.hs = 0;            // хедшоты за матч
    this.joinT = 0;         // время комнаты, когда игрок вошёл в матч
    this.reported = false;  // результат матча уже записан
    this.gg = 0;            // этап «гонки вооружений»
  }
}

class Room {
  constructor(id, skill = 0, opts = {}) {
    this.id = id;
    this.name = String(opts.name || '').slice(0, 24);
    this.code = opts.code || '';          // код комнаты для входа друзей
    this.priv = !!opts.priv;              // приватная: не видна в списке
    this.custom = !!opts.custom;          // создана игроком: в быстрый поиск не попадает
    this.onResult = null;                 // (player, итог) — запись результата в профиль
    this.skillIdx = clamp(Math.floor(num(skill, 0)), 0, BOT_SKILL.length - 1);
    this.skill = BOT_SKILL[this.skillIdx];
    this.mode = S.MODES[opts.mode] || S.MODES.tdm;
    this.winId = 0;
    this.players = new Map();
    this.t = 0;
    this.state = 0; // 0 — бой, 1 — итоги
    this.scores = [0, 0];
    this.endT = this.mode.time;
    this.overT = 0;
    this.winner = -1;
    this.rosterDirty = true;
    this.botIdx = Math.floor(Math.random() * BOT_NAMES.length);
  }

  humans() { return [...this.players.values()].filter((p) => !p.bot); }
  bots() { return [...this.players.values()].filter((p) => p.bot); }
  teamCount(team) { let n = 0; for (const p of this.players.values()) if (p.team === team) n++; return n; }
  smallerTeam() {
    const a = this.teamCount(0), b = this.teamCount(1);
    return a === b ? (Math.random() < 0.5 ? 0 : 1) : a < b ? 0 : 1;
  }

  emit(ev, data) { for (const p of this.players.values()) if (p.sock) p.sock.emit(ev, data); }

  addBot() {
    const name = BOT_NAMES[this.botIdx++ % BOT_NAMES.length];
    const b = new Player(name, this.smallerTeam(), true);
    this.players.set(b.id, b);
    this.spawn(b);
    this.rosterDirty = true;
  }

  addHuman(sock, name, extra = {}) {
    const p = new Player(name, this.smallerTeam(), false, sock);
    p.uid = extra.uid || null; p.equip = extra.equip || null; p.tag = extra.tag || ''; p.level = extra.level || 0;
    p.joinT = this.t;
    this.players.set(p.id, p);
    this.spawn(p);
    this.trimBots();
    this.rosterDirty = true;
    return p;
  }

  // Дружественный ли игрок b для a (в командных режимах — та же команда, иначе врагов нет «своих»).
  friend(a, b) { return this.mode.team && a.team === b.team; }

  result(p, loss = false) {
    const win = !loss && (this.mode.team ? this.winner === p.team : this.winId === p.id);
    const draw = !loss && (this.mode.team ? this.winner === -1 : this.winId === 0);
    return { kills: p.kills, deaths: p.deaths, hs: p.hs, win, draw, secs: Math.max(0, Math.round(this.t - p.joinT)), skill: this.skillIdx, mode: this.mode.id };
  }

  report(p, loss = false) {
    if (p.reported || p.bot || !p.uid || !this.onResult) return;
    p.reported = true;
    try { this.onResult(p, this.result(p, loss)); } catch (e) { console.error('onResult', e); }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (p && this.state === 0 && (p.kills || p.deaths)) this.report(p, true); // ливнул до конца матча — поражение
    if (!this.players.delete(id)) return;
    this.rosterDirty = true;
    this.fillBots();
  }

  trimBots() {
    while (this.players.size > S.MATCH.botsTotal) {
      const bots = this.bots();
      if (!bots.length) break;
      const big = this.teamCount(0) >= this.teamCount(1) ? 0 : 1;
      const pick = bots.find((b) => b.team === big) || bots[0];
      this.players.delete(pick.id);
    }
  }

  fillBots() {
    if (!this.humans().length) return;
    while (this.players.size < S.MATCH.botsTotal) this.addBot();
  }

  pickSpawn(team) {
    const pts = S.SPAWNS[team];
    const enemies = [...this.players.values()].filter((o) => o.alive && (o.team !== team || !this.mode.team));
    let best = pts[0], bestScore = -1;
    for (const pt of pts) {
      let md = 1e9;
      for (const e of enemies) md = Math.min(md, Math.hypot(e.x - pt[0], e.z - pt[1]));
      const score = Math.min(md, 60) + Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = pt; }
    }
    return best;
  }

  spawn(p) {
    const pt = this.pickSpawn(p.team);
    p.x = pt[0]; p.y = 0; p.z = pt[1];
    p.vx = p.vy = p.vz = 0;
    p.onGround = true;
    p.hp = p.bot ? this.skill.hp : 100;
    p.alive = true;
    p.weapon = this.mode.gun ? S.GG_ORDER[p.gg] : 0;
    p.wp = S.WEAPONS.map((w) => ({ mag: w.mag, res: p.bot ? 9999 : w.reserve }));
    p.reloading = false;
    p.nextFire = this.t + 0.4;
    p.prevFire = false;
    p.bloom = 0;
    p.ads = false;
    p.protectUntil = this.t + S.MATCH.protect;
    p.yaw = p.team === 0 ? -Math.PI / 2 : Math.PI / 2;
    p.pitch = 0;
    p.hist = [];
    p.queue = [];
    if (p.ai) Object.assign(p.ai, newAI());
  }

  // ----- Оружие -----
  startReload(p) {
    const w = S.WEAPONS[p.weapon], ws = p.wp[p.weapon];
    if (p.reloading || ws.mag >= w.mag || ws.res <= 0) return;
    p.reloading = true;
    p.reloadEnd = this.t + w.reload;
  }

  posAt(o, rt) {
    const h = o.hist, n = h.length;
    if (!n) return { x: o.x, y: o.y, z: o.z };
    if (rt >= h[n - 1].ts) return { x: o.x, y: o.y, z: o.z };
    for (let i = n - 1; i > 0; i--) {
      if (h[i - 1].ts <= rt) {
        const a = h[i - 1], b = h[i];
        const f = (rt - a.ts) / Math.max(1, b.ts - a.ts);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
      }
    }
    return { x: h[0].x, y: h[0].y, z: h[0].z };
  }

  fire(p, rtIn) {
    if (this.state !== 0 || !p.alive) return;
    const w = S.WEAPONS[p.weapon], ws = p.wp[p.weapon];
    if (p.reloading || this.t < p.nextFire) return;
    if (ws.mag <= 0) { this.startReload(p); return; }
    ws.mag--;
    p.nextFire = this.t + w.rate;

    const now = Date.now();
    const rt = clamp(num(rtIn, now - 100), now - 350, now);

    const ox = p.x, oy = p.y + S.PLAYER.eye, oz = p.z;
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const rx = cy, rz = -sy;
    const ux = sy * sp, uy = cp, uz = cy * sp;
    const hsp = Math.hypot(p.vx, p.vz);
    let spread = (w.spread + p.bloom) * (1 + hsp * 0.12) * (p.ads ? w.adsMul : 1) + (p.onGround ? 0 : 0.03);
    if (p.bot) spread *= this.skill.spread;

    const targets = [];
    for (const o of this.players.values()) {
      if (o === p || !o.alive || this.friend(o, p) || this.t < o.protectUntil) continue;
      const pos = this.posAt(o, rt);
      targets.push({ p: o, x: pos.x, y: pos.y, z: pos.z });
    }

    // Помощь прицеливания: если враг в конусе вокруг линии прицела и виден — притягиваем линию к нему.
    let bx = fx, by = fy, bz = fz;
    if (p.assist > 0 && !p.bot) {
      const lim = ASSIST_ANGLE * p.assist;
      let bestAng = lim, aim = null;
      for (const tg of targets) {
        const ax = tg.x - ox, ay = tg.y + 1.2 - oy, az = tg.z - oz;
        const d = Math.hypot(ax, ay, az);
        if (d < 1 || d > w.range) continue;
        const ang = Math.acos(clamp((ax * fx + ay * fy + az * fz) / d, -1, 1));
        if (ang >= bestAng) continue;
        if (S.rayWorld(ox, oy, oz, ax / d, ay / d, az / d, d) < d - 0.01) continue;
        bestAng = ang; aim = [ax / d, ay / d, az / d];
      }
      if (aim) {
        const k = ASSIST_PULL * Math.min(1, p.assist);
        bx = fx + (aim[0] - fx) * k; by = fy + (aim[1] - fy) * k; bz = fz + (aim[2] - fz) * k;
        const bl = Math.hypot(bx, by, bz);
        bx /= bl; by /= bl; bz /= bl;
      }
    }

    const dmgTo = new Map();
    const ends = [];
    for (let i = 0; i < w.pellets; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * spread;
      const ca = Math.cos(a) * rr, sa = Math.sin(a) * rr;
      let dx = bx + rx * ca + ux * sa, dy = by + uy * sa, dz = bz + rz * ca + uz * sa;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl; dy /= dl; dz /= dl;

      let dist = S.rayWorld(ox, oy, oz, dx, dy, dz, w.range);
      let hitT = null, zone = -1;
      for (const tg of targets) {
        const r = S.rayPlayer(ox, oy, oz, dx, dy, dz, tg.x, tg.y, tg.z);
        if (r.t < dist) { dist = r.t; hitT = tg; zone = r.zone; }
      }
      if (hitT) {
        const head = zone === 2;
        const rec = dmgTo.get(hitT.p) || { dmg: 0, head: false, dist: 0, zone: -1 };
        const fall = w.fall ? Math.max(w.fall[2], 1 - Math.max(0, dist - w.fall[0]) / w.fall[1]) : 1;
        const zm = head ? w.head : zone === 0 ? S.ZONE_LEG_MULT : 1;
        // «Только хедшоты»: голова убивает сразу, тело почти не страдает
        rec.dmg += this.mode.id === 'hs' ? (head ? 999 : w.dmg * zm * fall * 0.25) : w.dmg * zm * fall;
        rec.dist = Math.max(rec.dist, dist);
        rec.head = rec.head || head;
        if (zone > rec.zone) rec.zone = zone; // в событие идёт самая тяжёлая зона
        dmgTo.set(hitT.p, rec);
      }
      if (ends.length < 4) ends.push([r2(ox + dx * dist), r2(oy + dy * dist), r2(oz + dz * dist), hitT ? 1 : 0, zone]);
    }

    p.bloom = Math.min(w.bloomMax, p.bloom + w.bloom);
    this.emit('shot', { id: p.id, w: p.weapon, o: [r2(ox), r2(oy), r2(oz)], e: ends });

    for (const [vic, rec] of dmgTo) {
      this.damage(p, vic, Math.max(1, Math.round(rec.dmg * (p.bot ? this.skill.dmg : 1))), rec.head, rec.dist, rec.zone);
    }
    if (ws.mag <= 0) this.startReload(p);
  }

  damage(att, vic, amount, head, dist = 0, zone = head ? 2 : 1) {
    if (!vic.alive || this.state !== 0 || this.t < vic.protectUntil) return;
    vic.hp -= amount;
    const killed = vic.hp <= 0;
    if (att.sock) att.sock.emit('hit', { hs: head ? 1 : 0, k: killed ? 1 : 0, d: amount, z: zone });
    if (vic.sock) vic.sock.emit('hurt', { x: r2(att.x), z: r2(att.z), hp: Math.max(0, vic.hp) });
    if (killed) this.kill(att, vic, head, dist, zone);
  }

  kill(att, vic, head, dist = 0, zone = head ? 2 : 1) {
    vic.alive = false;
    vic.hp = 0;
    vic.deaths++;
    vic.reloading = false;
    vic.queue = [];
    vic.respawnAt = this.t + S.MATCH.respawn;
    att.kills++;
    if (head) att.hs++;
    this.emit('kill', { k: att.id, v: vic.id, w: att.weapon, hs: head ? 1 : 0, d: Math.round(dist), z: zone });
    if (this.mode.team) {
      this.scores[att.team]++;
      if (this.scores[att.team] >= this.mode.killLimit) this.endMatch();
    } else if (this.mode.gun) {
      att.gg++;
      if (att.gg >= S.GG_ORDER.length) { this.winId = att.id; this.endMatch(); return; }
      att.weapon = S.GG_ORDER[att.gg];                    // следующее оружие, свежие патроны
      att.wp[att.weapon] = { mag: S.WEAPONS[att.weapon].mag, res: att.bot ? 9999 : S.WEAPONS[att.weapon].reserve };
      att.reloading = false; att.bloom = 0; att.ads = false;
      att.nextFire = Math.max(att.nextFire, this.t + 0.4);
      if (att.sock) att.sock.emit('ggup', { gg: att.gg, w: att.weapon });
    } else if (att.kills >= this.mode.killLimit) { this.winId = att.id; this.endMatch(); }
  }

  endMatch() {
    if (this.state !== 0) return;
    this.state = 1;
    this.overT = S.MATCH.over;
    if (this.mode.team) this.winner = this.scores[0] > this.scores[1] ? 0 : this.scores[1] > this.scores[0] ? 1 : -1;
    else {
      this.winner = -1;
      if (!this.winId) { // время вышло: лидер по этапу/убийствам, при равенстве — ничья
        const key = (p) => (this.mode.gun ? p.gg * 1000 : 0) + p.kills;
        const sorted = [...this.players.values()].sort((a, b) => key(b) - key(a));
        if (sorted.length && key(sorted[0]) > 0 && (sorted.length < 2 || key(sorted[0]) > key(sorted[1]))) this.winId = sorted[0].id;
      }
    }
    for (const p of this.players.values()) this.report(p);
    this.emit('over', { winner: this.winner, winId: this.winId, scores: this.scores });
  }

  resetMatch() {
    this.state = 0;
    this.scores = [0, 0];
    this.endT = this.mode.time;
    this.winner = -1;
    this.winId = 0;
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; p.hs = 0; p.gg = 0; p.reported = false; p.joinT = this.t; this.spawn(p); }
    this.emit('start', {});
  }

  // ----- Сеть: разбор пакетов клиента -----
  rosterEntry(o) {
    return { id: o.id, name: o.name, team: o.team, bot: o.bot ? 1 : 0, tag: o.tag, lv: o.level, eq: o.equip, pl: o.plat || '' };
  }

  welcome(p) {
    return {
      id: p.id, team: p.team, room: this.id, roomName: this.name, code: this.code, tick: S.TICK, mode: this.mode.id, modeName: this.mode.name, teams: this.mode.team ? 1 : 0, lim: this.mode.killLimit, ggN: S.GG_ORDER.length, skill: this.skillIdx, skillName: this.skill.name,
      players: [...this.players.values()].map((o) => (this.rosterEntry(o))),
    };
  }

  queueInput(p, m) {
    if (!m || typeof m !== 'object' || p.queue.length > 12) return;
    const seq = Math.floor(num(m.seq, -1));
    if (seq < 0) return;
    p.queue.push({
      seq,
      mx: clamp(num(m.mx), -1, 1),
      mz: clamp(num(m.mz), -1, 1),
      yaw: num(m.yaw),
      pitch: num(m.pitch),
      jump: !!m.jump,
      fire: !!m.fire,
      reload: !!m.reload,
      ads: !!m.ads,
      weapon: Number.isInteger(m.weapon) ? m.weapon : p.weapon,
      rt: num(m.rt, Date.now() - 100),
    });
  }

  // ----- Ввод -----
  applyInput(p, inp) {
    p.yaw = S.wrapAngle(num(inp.yaw));
    p.pitch = clamp(num(inp.pitch), -1.5, 1.5);
    p.ads = !!inp.ads;
    S.stepPlayer(p, inp);

    const wi = inp.weapon;
    if (!this.mode.gun && Number.isInteger(wi) && wi >= 0 && wi < S.WEAPONS.length && wi !== p.weapon) {
      p.weapon = wi;
      p.reloading = false;
      p.nextFire = Math.max(p.nextFire, this.t + 0.35);
      p.bloom = 0;
    }
    if (inp.reload) this.startReload(p);

    const w = S.WEAPONS[p.weapon];
    const edge = inp.fire && !p.prevFire;
    p.prevFire = !!inp.fire;
    if (inp.fire && (w.auto || edge)) this.fire(p, inp.rt);
  }

  handleQueue(p) {
    const q = p.queue;
    if (q.length > 8) q.splice(0, q.length - 8);
    const n = Math.min(q.length, q.length > 4 ? 3 : q.length > 2 ? 2 : 1);
    for (let i = 0; i < n; i++) {
      const inp = q.shift();
      p.ack = inp.seq;
      if (p.alive) this.applyInput(p, inp);
    }
  }

  // ----- Боты -----
  los(a, b) {
    const ox = a.x, oy = a.y + S.PLAYER.eye, oz = a.z;
    const dx = b.x - ox, dy = b.y + 1.3 - oy, dz = b.z - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return S.rayWorld(ox, oy, oz, dx / d, dy / d, dz / d, d) >= d - 0.01;
  }

  pickWaypoint(b) {
    const cands = [];
    for (const w of S.WAYPOINTS) {
      const dx = w[0] - b.x, dz = w[1] - b.z;
      const d = Math.hypot(dx, dz);
      if (d < 5 || d > 22) continue;
      if (S.rayWorld(b.x, 0.5, b.z, dx / d, 0, dz / d, d) < d) continue;
      cands.push(w);
    }
    const list = cands.length ? cands : S.WAYPOINTS;
    if (Math.random() < 0.55) {
      const hx = Math.random() < 0.5 ? 0 : (b.team === 0 ? 24 : -24);
      const hz = (Math.random() - 0.5) * 20;
      let best = list[0], bd = 1e9;
      for (const w of list) {
        const d = Math.hypot(w[0] - hx, w[1] - hz);
        if (d < bd) { bd = d; best = w; }
      }
      return best;
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  botTick(b) {
    const ai = b.ai, t = this.t, sk = this.skill;
    if (!b.alive || this.state !== 0) return;

    if (t >= ai.nextScan) {
      ai.nextScan = t + 0.15 + Math.random() * 0.1;
      let best = null, bd = 1e9;
      for (const o of this.players.values()) {
        if (!o.alive || this.friend(o, b)) continue;
        const d = Math.hypot(o.x - b.x, o.z - b.z);
        if (d < bd && d < sk.range && this.los(b, o)) { best = o; bd = d; }
      }
      if (best) {
        if (!ai.target || ai.target.id !== best.id || t - ai.lastSeen > 1) ai.reactAt = t + sk.react[0] + Math.random() * (sk.react[1] - sk.react[0]);
        ai.target = best; ai.lastSeen = t; ai.visible = true;
      } else {
        ai.visible = false;
        if (ai.target && t - ai.lastSeen > 3) ai.target = null;
      }
    }
    if (ai.target && !ai.target.alive) { ai.target = null; ai.visible = false; }

    let mx = 0, mz = 0, jump = false, fire = false, reload = false;
    let wantYaw = b.yaw, wantPitch = 0;
    const dt = S.DT;

    if (ai.target && (ai.visible || t - ai.lastSeen < 0.8)) {
      const tg = ai.target;
      const dx = tg.x - b.x, dz = tg.z - b.z, dy = tg.y + (this.mode.id === 'hs' ? 1.62 : 1.2) - (b.y + S.PLAYER.eye);
      const d = Math.hypot(dx, dz);
      if (t >= ai.errT) {
        ai.errT = t + 0.35;
        ai.errYaw = (Math.random() - 0.5) * sk.err;
        ai.errPitch = (Math.random() - 0.5) * sk.err * 0.7;
      }
      wantYaw = Math.atan2(-dx, -dz) + ai.errYaw;
      wantPitch = Math.atan2(dy, d) + ai.errPitch;
      if (t >= ai.strafeT) {
        ai.strafe = Math.random() < 0.5 ? -1 : 1;
        ai.strafeT = t + 0.7 + Math.random() * 1.2;
        if (Math.random() < sk.jump) jump = true;
      }
      mx = ai.strafe * sk.strafe;
      mz = d > 16 ? 1 : d < 6 ? -0.7 : 0.15;
      const yawErr = Math.abs(S.angDiff(wantYaw, b.yaw));
      if (ai.visible && t >= ai.reactAt && yawErr < sk.aimTol && d < S.WEAPONS[b.weapon].range) {
        if (t < ai.burstUntil) fire = true;
        else if (t >= ai.pauseUntil) {
          ai.burstUntil = t + sk.burst[0] + Math.random() * (sk.burst[1] - sk.burst[0]);
          ai.pauseUntil = ai.burstUntil + sk.pause[0] + Math.random() * (sk.pause[1] - sk.pause[0]);
          fire = true;
        }
      }
    } else {
      if (!ai.wp || t > ai.wpT || Math.hypot(ai.wp[0] - b.x, ai.wp[1] - b.z) < 1.4) {
        ai.wp = this.pickWaypoint(b);
        ai.wpT = t + 7;
      }
      const dx = ai.wp[0] - b.x, dz = ai.wp[1] - b.z;
      wantYaw = Math.atan2(-dx, -dz);
      mz = 1;
    }

    if (t >= ai.chkT) {
      ai.chkT = t + 0.5;
      const moved = Math.hypot(b.x - ai.sx, b.z - ai.sz);
      ai.sx = b.x; ai.sz = b.z;
      if (moved < 0.35 && (mz !== 0 || mx !== 0)) {
        ai.wp = null;
        ai.strafe = -ai.strafe;
        jump = true;
      }
    }

    const ws = b.wp[b.weapon];
    if (ws.mag === 0 || (!ai.target && ws.mag < 10)) reload = true;

    const maxTurn = (ai.target ? sk.turn : 3.0) * dt;
    const yaw = S.wrapAngle(b.yaw + clamp(S.angDiff(wantYaw, b.yaw), -maxTurn, maxTurn));
    const pitch = b.pitch + clamp(wantPitch - b.pitch, -3 * dt, 3 * dt);

    this.applyInput(b, { mx, mz, yaw, pitch, jump, fire, reload, weapon: 0, rt: Date.now() });
  }

  // ----- Тик -----
  tick() {
    this.t += S.DT;
    const now = Date.now();

    if (this.state === 0) {
      this.endT -= S.DT;
      if (this.endT <= 0) this.endMatch();
    } else {
      this.overT -= S.DT;
      if (this.overT <= 0) this.resetMatch();
    }

    for (const p of this.players.values()) {
      if (p.bot) this.botTick(p);
      else this.handleQueue(p);
    }

    for (const p of this.players.values()) {
      if (p.bloom > 0) p.bloom = Math.max(0, p.bloom - 0.05 * S.DT);
      if (p.reloading && this.t >= p.reloadEnd) {
        const w = S.WEAPONS[p.weapon], ws = p.wp[p.weapon];
        if (p.bot) ws.res = 9999;
        const take = Math.min(w.mag - ws.mag, ws.res);
        ws.mag += take; ws.res -= take;
        p.reloading = false;
      }
      if (!p.alive && this.state === 0 && this.t >= p.respawnAt) this.spawn(p);
      if (p.alive) {
        p.hist.push({ ts: now, x: p.x, y: p.y, z: p.z });
        while (p.hist.length && now - p.hist[0].ts > 1000) p.hist.shift();
      }
    }

    if (this.rosterDirty) {
      this.rosterDirty = false;
      this.emit('roster', { players: [...this.players.values()].map((p) => (this.rosterEntry(p))) });
    }

    this.sendSnapshots(now);
  }

  sendSnapshots(now) {
    const list = [];
    for (const p of this.players.values()) {
      list.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), p.alive ? 1 : 0, p.weapon, p.kills, p.deaths, p.gg]);
    }
    const base = {
      t: now, st: this.state, rem: Math.max(0, Math.ceil(this.state === 0 ? this.endT : this.overT)),
      sc: this.scores, win: this.winner, wid: this.winId, p: list,
    };
    for (const p of this.players.values()) {
      if (!p.sock) continue;
      p.sock.volatile.emit('snap', {
        ...base,
        ack: p.ack,
        me: {
          x: r3(p.x), y: r3(p.y), z: r3(p.z), vx: r3(p.vx), vy: r3(p.vy), vz: r3(p.vz), g: p.onGround ? 1 : 0,
          hp: Math.max(0, Math.round(p.hp)), alive: p.alive ? 1 : 0, w: p.weapon,
          wp: p.wp ? p.wp.map((s) => [s.mag, s.res]) : [],
          rl: p.reloading ? Math.max(0, r2(p.reloadEnd - this.t)) : 0,
          resp: p.alive ? 0 : Math.max(0, Math.ceil(p.respawnAt - this.t)),
          prot: this.t < p.protectUntil ? 1 : 0,
          bl: r3(p.bloom), ads: p.ads ? 1 : 0, gg: p.gg,
        },
      });
    }
  }
}


export { Player, Room, num };
