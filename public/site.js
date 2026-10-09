// Общий код страниц сайта: запросы к API, шапка, нижняя панель, уведомления, безопасный вывод.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

export async function api(path, body) {
  const opt = { credentials: 'same-origin' };
  if (body !== undefined) { opt.method = 'POST'; opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch('/api' + path, opt); } catch { throw new Error('Нет соединения с сервером'); }
  let d = {};
  try { d = await r.json(); } catch { /* пустой ответ */ }
  if (!r.ok) { const e = new Error(d.error || 'Ошибка запроса'); e.status = r.status; throw e; }
  return d;
}

let mePromise = null;
export const getMe = (force = false) => (mePromise = !force && mePromise ? mePromise : api('/me').catch(() => ({ user: null })));

// Хранилище настроек устройства (может быть недоступно — тогда работаем без него).
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
// Платформа: ПК или телефон. Определяется автоматически, можно переопределить в настройках.
export const detectPlatform = () => (matchMedia('(pointer: coarse)').matches ? 'mobile' : 'pc');
export const platform = () => { const v = store.get('af_platform'); return v === 'pc' || v === 'mobile' ? v : detectPlatform(); };

export function toast(msg, kind = '') {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'toast ' + kind; t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}

export const tagHtml = (tag) => (tag ? `<span class="tag">${esc(tag)}</span>` : '');
export function lvlHtml(u) {
  const l = u.lvl;
  return `<div class="lvl"><div class="num">${u.level}</div><div class="meta"><b>${esc(u.rank)}</b> <span class="muted small">${fmt(l.cur)} из ${fmt(l.need) || '—'} опыта</span><div class="bar"><i style="width:${Math.round(l.pct * 100)}%"></i></div></div></div>`;
}
export const kd = (k, d) => (d ? (k / d).toFixed(2) : k ? k.toFixed(2) : '0.00');
export const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '0%');

const SVG = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
export const ICON = {
  play: SVG('<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  rank: SVG('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8"/>'),
  clan: SVG('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  shop: SVG('<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>'),
  user: SVG('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
  pc: SVG('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>'),
  phone: SVG('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>'),
  team: SVG('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c.5-3.5 3-5 6-5M22 20c-.5-3.5-3-5-6-5M9 20c.5-3 1.5-4 3-4s2.5 1 3 4"/>'),
  head: SVG('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>'),
  ffa: SVG('<path d="M12 3l2.5 6 6.5.5-5 4.3 1.6 6.4L12 16.8 6.4 20.2 8 13.8 3 9.5 9.5 9z"/>'),
  gun: SVG('<path d="M3 10h13l2 2h3v3h-6l-1 3H8l1-3H3z"/><path d="M6 10V8h8v2"/>'),
};
export const MODE_ICON = { tdm: ICON.team, hs: ICON.head, ffa: ICON.ffa, gg: ICON.gun };

const NAV = [['/lobby', 'Играть', 'play'], ['/leaders', 'Рейтинг', 'rank'], ['/clans', 'Кланы', 'clan'], ['/shop', 'Магазин', 'shop']];

// Рисует шапку, нижнюю панель (на телефоне) и подвал; возвращает данные пользователя (или null).
export async function boot(active, { need = false } = {}) {
  const d = await getMe();
  const u = d.user;
  if (need && !u) { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search)); return new Promise(() => {}); }
  const top = document.createElement('header');
  top.className = 'top';
  top.innerHTML = `<div class="wrap hbar"><a class="logo" href="/"><i></i>ARENA <b>FIRE</b></a>
    <nav class="nav">${NAV.map(([h, t]) => `<a href="${h}" class="${active === h ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <div class="user">${u
      ? `<a class="chip coin" href="/shop" title="Монеты">🪙 ${fmt(u.coins)}</a><a class="chip" href="/profile">${tagHtml(u.clan && u.clan.tag)}${esc(u.nick)}<span class="muted hide-m">ур. ${u.level}</span></a>`
      : `<a class="btn ghost sm" href="/login">Войти</a><a class="btn sm hide-m" href="/register">Регистрация</a>`}</div></div>`;
  document.body.prepend(top);
  const tab = document.createElement('nav');
  tab.className = 'tabbar';
  const items = [['/leaders', 'Рейтинг', 'rank'], ['/clans', 'Кланы', 'clan'], ['/lobby', 'Играть', 'play'], ['/shop', 'Магазин', 'shop'], [u ? '/profile' : '/login', u ? 'Профиль' : 'Войти', 'user']];
  tab.innerHTML = items.map(([h, t, i]) => (i === 'play'
    ? `<a class="play ${active === h ? 'on' : ''}" href="${h}"><span>${ICON.play}</span><small>${t}</small></a>`
    : `<a href="${h}" class="${active === h || (h === '/profile' && active === '/profile') ? 'on' : ''}">${ICON[i]}${t}</a>`)).join('');
  document.body.appendChild(tab);
  const f = document.createElement('footer');
  f.innerHTML = `<div class="wrap"><span>Arena Fire · шутер 4×4 в браузере · арена по мотивам набора Kenney</span><span><a href="/lobby">Играть</a> · <a href="/leaders">Рейтинг</a> · <a href="/clans">Кланы</a>
 · <a href="/settings">Настройки</a></span></div>`;
  document.body.appendChild(f);
  api('/stats').then((s) => { if (s.degraded) { const b = document.createElement('div'); b.className = 'banner wrap'; b.style.marginTop = '12px'; b.textContent = 'База данных недоступна — прогресс временно не сохраняется.'; top.after(b); } }).catch(() => {});
  return u;
}

export const nextUrl = () => { const n = new URLSearchParams(location.search).get('next'); return n && n.startsWith('/') && !n.startsWith('//') ? n : '/lobby'; };
