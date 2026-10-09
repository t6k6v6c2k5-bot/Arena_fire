// Аккаунты: хеширование паролей (scrypt), подписанные сессии, куки, ограничение попыток.
import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
const N = 16384;

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 32, { N, r: 8, p: 1 });
  return `s1$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  try {
    const [v, n, salt, hash] = String(stored).split('$');
    if (v !== 's1') return false;
    const want = Buffer.from(hash, 'base64');
    const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: 8, p: 1 });
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch { return false; }
}

const b64u = (b) => Buffer.from(b).toString('base64url');
const fp = (u) => crypto.createHash('sha256').update(String(u.pass)).digest('base64url').slice(0, 8);

export const SESSION_DAYS = 30;
export const COOKIE = 'af_session';

export function makeSessions(secret) {
  const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  return {
    issue(user, now = Date.now()) {
      const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
      const body = `${user.id}.${exp}.${fp(user)}`;
      return `${body}.${sign(body)}`;
    },
    // Возвращает id пользователя и отпечаток пароля (проверить по загруженному пользователю).
    parse(token, now = Date.now()) {
      if (typeof token !== 'string' || token.length > 200) return null;
      const parts = token.split('.');
      if (parts.length !== 4) return null;
      const [id, exp, f, sig] = parts;
      const want = sign(`${id}.${exp}.${f}`);
      if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
      if (Number(exp) < now / 1000) return null;
      const uid = Number(id);
      return Number.isInteger(uid) && uid > 0 ? { uid, fp: f } : null;
    },
    fp,
  };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) { try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* мусор */ } }
  }
  return out;
}

export function cookieHeader(token, secure) {
  const age = token ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
}

// Простое окно ограничения: не более max попыток за windowMs на ключ.
export class RateLimit {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.m = new Map(); }
  hit(key, now = Date.now()) {
    let e = this.m.get(key);
    if (!e || now - e.t > this.windowMs) { e = { t: now, n: 0 }; this.m.set(key, e); }
    e.n++;
    if (this.m.size > 5000) for (const [k, v] of this.m) if (now - v.t > this.windowMs) this.m.delete(k);
    return e.n <= this.max;
  }
  reset(key) { this.m.delete(key); }
}
