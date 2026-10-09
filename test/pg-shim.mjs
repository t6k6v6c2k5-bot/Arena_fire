// Тестовая «заглушка» пула pg поверх psql: позволяет проверить настоящий SQL на локальном PostgreSQL без пакета pg.
import { spawnSync } from 'child_process';

const NUM = new Set(['id', 'xp', 'coins', 'kills', 'deaths', 'headshots', 'matches', 'wins', 'secs', 'best_kills', 'streak', 'clan_id', 'owner_id',
  'members', 'created_at', 'at', 'hs', 'win', 'skill', 'users', 'user_id']);
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (Array.isArray(v)) return `'{${v.map((x) => String(x).replace(/[\\"]/g, '\\$&')).join(',')}}'`;
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}
function parseCsv(s) {
  const rows = []; let row = [], cur = '', q = false, i = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
export function psqlPool(port = 5433, db = 'af') {
  return {
    on() {},
    async query(text, params = []) {
      const sql = text.replace(/\$(\d+)/g, (_m, n) => lit(params[Number(n) - 1]));
      const r = spawnSync('psql', ['-h', '/tmp', '-p', String(port), '-U', 'postgres', '-d', db, '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
      if (r.status !== 0) {
        const e = new Error(r.stderr.trim());
        const m = /violates unique constraint "([^"]+)"/.exec(r.stderr);
        if (m) { e.code = '23505'; e.constraint = m[1]; }
        throw e;
      }
      const t = parseCsv(r.stdout);
      if (!t.length) return { rows: [] };
      const [head, ...body] = t;
      return { rows: body.map((cells) => Object.fromEntries(head.map((h, i) => {
        let v = cells[i];
        if (v === '') v = null;
        else if (NUM.has(h)) v = Number(v);
        else if (h === 'equipped') v = JSON.parse(v);
        return [h, v];
      }))) };
    },
  };
}
