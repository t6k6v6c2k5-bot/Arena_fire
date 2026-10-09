// Общие правила прогрессии и каталог косметики. Используется и сервером, и сайтом, и игрой.
// Всё косметическое: на баланс стрельбы не влияет.

export const MAX_LEVEL = 100;
export const START_COINS = 200;
export const CLAN_COST = 500;
export const CLAN_MAX = 30;

// Суммарный опыт, нужный для уровня L (L=1 — 0 опыта): 50·(L−1)·L → 100, 300, 600, 1000…
export const xpForLevel = (L) => 50 * (L - 1) * L;
export function levelFromXp(xp) {
  const n = Math.floor((-1 + Math.sqrt(1 + 0.08 * Math.max(0, xp))) / 2);
  return Math.min(MAX_LEVEL, n + 1);
}
export function levelInfo(xp) {
  const level = levelFromXp(xp);
  const lo = xpForLevel(level);
  const hi = level >= MAX_LEVEL ? lo : xpForLevel(level + 1);
  return { level, cur: xp - lo, need: hi - lo, pct: hi > lo ? Math.min(1, (xp - lo) / (hi - lo)) : 1 };
}

// Звания по уровню.
const RANKS = ['Новобранец', 'Рядовой', 'Ефрейтор', 'Сержант', 'Старшина', 'Лейтенант', 'Капитан', 'Майор', 'Полковник', 'Генерал'];
export const rankName = (level) => RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 10))];

// Награда за матч. secs — сколько игрок реально провёл в матче.
export function matchReward({ kills = 0, deaths = 0, hs = 0, win = false, draw = false, secs = 0 }) {
  kills = Math.max(0, Math.min(200, kills | 0));
  hs = Math.max(0, Math.min(kills, hs | 0));
  secs = Math.max(0, secs | 0);
  if (secs < 20 && kills === 0) return { xp: 0, coins: 0 };
  let xp = 20 + kills * 12 + hs * 6 + (win ? 60 : draw ? 25 : 12);
  if (secs < 120) xp = Math.round(xp * Math.max(0.2, secs / 120)); // ливнувшим — меньше
  xp = Math.min(xp, 700);
  const coins = Math.round(xp * 0.6) + (win && secs >= 120 ? 20 : 0);
  return { xp, coins };
}

// Ежедневный бонус: серия подряд идущих дней.
export const dailyBonus = (streak) => 50 + 25 * Math.min(Math.max(streak, 1) - 1, 6);

// ---------- Каталог ----------
// gun: tint (множитель цвета), glow (подсветка тёмных деталей), shine (блеск)
// armor: цвета бронежилета/подсумков/рюкзака/шлема (командный цвет формы остаётся)
// tracer: цвет трассера
export const ITEMS = [
  { id: 'gun_std',   type: 'gun', name: 'Заводской',        price: 0,    lvl: 1,  tint: [1, 1, 1], glow: 0x000000, shine: 30 },
  { id: 'gun_olive', type: 'gun', name: 'Олива',            price: 300,  lvl: 3,  tint: [0.85, 1.25, 0.7], glow: 0x1a2a10, shine: 24 },
  { id: 'gun_sand',  type: 'gun', name: 'Пустыня',          price: 600,  lvl: 6,  tint: [1.5, 1.25, 0.85], glow: 0x3a2e14, shine: 22 },
  { id: 'gun_arctic', type: 'gun', name: 'Арктика',         price: 1000, lvl: 10, tint: [1.4, 1.5, 1.7], glow: 0x2c3946, shine: 50 },
  { id: 'gun_neon',  type: 'gun', name: 'Неон',             price: 1800, lvl: 15, tint: [0.7, 1.4, 1.6], glow: 0x00555f, shine: 80 },
  { id: 'gun_crim',  type: 'gun', name: 'Багровый',         price: 2500, lvl: 20, tint: [1.7, 0.7, 0.7], glow: 0x4a0a0a, shine: 70 },
  { id: 'gun_gold',  type: 'gun', name: 'Золото',           price: 6000, lvl: 30, tint: [2.2, 1.7, 0.6], glow: 0x5a4108, shine: 120 },

  { id: 'arm_std',   type: 'armor', name: 'Стандартная',    price: 0,    lvl: 1,  vest: 0x2b3037, pouch: 0x383e47, plate: 0x424a54, pack: 0x434a3b, helm: 0 },
  { id: 'arm_woods', type: 'armor', name: 'Лесная',         price: 400,  lvl: 4,  vest: 0x2f3a28, pouch: 0x3d4a33, plate: 0x4f5a42, pack: 0x3a4a2a, helm: 0x34422a },
  { id: 'arm_desert', type: 'armor', name: 'Песчаная',      price: 800,  lvl: 8,  vest: 0x6b5b3e, pouch: 0x7d6c4a, plate: 0x8f7d58, pack: 0x74633f, helm: 0x7b6a48 },
  { id: 'arm_urban', type: 'armor', name: 'Городская',      price: 1400, lvl: 12, vest: 0x3c3f45, pouch: 0x4b4f57, plate: 0x6a707a, pack: 0x30333a, helm: 0x3a3d44 },
  { id: 'arm_night', type: 'armor', name: 'Ночной рейд',    price: 2200, lvl: 18, vest: 0x15171c, pouch: 0x1f2229, plate: 0x2a2e36, pack: 0x101216, helm: 0x14161b },
  { id: 'arm_gold',  type: 'armor', name: 'Элитная',        price: 5000, lvl: 28, vest: 0x5a4a1e, pouch: 0x76622a, plate: 0xb38f2e, pack: 0x4a3c18, helm: 0x8a6d1f },

  { id: 'tr_std',    type: 'tracer', name: 'Классический',  price: 0,    lvl: 1,  color: 0xffe9a8 },
  { id: 'tr_green',  type: 'tracer', name: 'Зелёный',       price: 250,  lvl: 2,  color: 0x7dffa0 },
  { id: 'tr_cyan',   type: 'tracer', name: 'Ледяной',       price: 500,  lvl: 5,  color: 0x7fe9ff },
  { id: 'tr_pink',   type: 'tracer', name: 'Розовый',       price: 900,  lvl: 9,  color: 0xff7fd5 },
  { id: 'tr_red',    type: 'tracer', name: 'Раскалённый',   price: 1500, lvl: 14, color: 0xff5a3c },
  { id: 'tr_violet', type: 'tracer', name: 'Плазма',        price: 2800, lvl: 22, color: 0xb98cff },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
export const TYPES = ['gun', 'armor', 'tracer'];
export const TYPE_NAMES = { gun: 'Оружие', armor: 'Броня', tracer: 'Трассеры' };
export const DEFAULT_EQUIP = { gun: 'gun_std', armor: 'arm_std', tracer: 'tr_std' };
export const FREE_ITEMS = ITEMS.filter((i) => i.price === 0).map((i) => i.id);

// Приводит сохранённую экипировку к валидной.
export function cleanEquip(eq, owned) {
  const out = { ...DEFAULT_EQUIP };
  if (eq && typeof eq === 'object') {
    for (const t of TYPES) {
      const it = ITEM_BY_ID[eq[t]];
      if (it && it.type === t && (it.price === 0 || !owned || owned.includes(it.id))) out[t] = it.id;
    }
  }
  return out;
}

// Валидация данных регистрации (общая для клиента и сервера).
export const NICK_RE = /^[A-Za-z0-9А-Яа-яЁё_\-]{3,16}$/;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const CLAN_NAME_RE = /^[A-Za-z0-9А-Яа-яЁё _\-]{3,20}$/;
export const CLAN_TAG_RE = /^[A-Z0-9]{2,4}$/;

// Достижения вычисляются из статистики, отдельного хранилища не нужно. u — профиль в том виде, как его отдаёт API.
const kdr = (u) => (u.deaths ? u.kills / u.deaths : u.kills);
export const ACHIEVEMENTS = [
  { id: 'first', icon: '🎯', name: 'Первая кровь', desc: 'Первое убийство', test: (u) => u.kills >= 1 },
  { id: 'k100', icon: '💥', name: 'Сотня', desc: '100 убийств', test: (u) => u.kills >= 100 },
  { id: 'k1000', icon: '☠️', name: 'Тысячник', desc: '1000 убийств', test: (u) => u.kills >= 1000 },
  { id: 'hs50', icon: '🦅', name: 'Меткий глаз', desc: '50 попаданий в голову', test: (u) => u.headshots >= 50 },
  { id: 'hs500', icon: '👁️', name: 'Снайпер', desc: '500 попаданий в голову', test: (u) => u.headshots >= 500 },
  { id: 'm10', icon: '🎖️', name: 'Ветеран', desc: '10 матчей', test: (u) => u.matches >= 10 },
  { id: 'w10', icon: '🏆', name: 'Победитель', desc: '10 побед', test: (u) => u.wins >= 10 },
  { id: 'w100', icon: '👑', name: 'Чемпион', desc: '100 побед', test: (u) => u.wins >= 100 },
  { id: 'best20', icon: '🔥', name: 'Бойня', desc: '20 убийств за один матч', test: (u) => u.best_kills >= 20 },
  { id: 'kd2', icon: '🧊', name: 'Хладнокровие', desc: 'K/D от 2 при 100+ убийствах', test: (u) => u.kills >= 100 && kdr(u) >= 2 },
  { id: 'l10', icon: '⭐', name: 'Десятый уровень', desc: 'Достигните 10 уровня', test: (u) => u.level >= 10 },
  { id: 'l30', icon: '🌟', name: 'Тридцатый уровень', desc: 'Достигните 30 уровня', test: (u) => u.level >= 30 },
  { id: 'hour', icon: '⏱️', name: 'Час в бою', desc: '60 минут в матчах', test: (u) => u.secs >= 3600 },
  { id: 'clan', icon: '🛡️', name: 'Не один', desc: 'Вступите в клан', test: (u) => !!u.clan },
];
