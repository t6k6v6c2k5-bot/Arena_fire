// Проверка подписи Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
import crypto from 'crypto';

export function verifyInitData(initData, botToken, maxAgeSec = 86400 * 7) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
    const auth = Number(params.get('auth_date'));
    if (!auth || Date.now() / 1000 - auth > maxAgeSec) return null;
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}
