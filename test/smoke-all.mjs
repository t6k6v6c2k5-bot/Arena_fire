// Запускает дымовой тест клиента для каждого режима игры.
import { spawnSync } from 'child_process';
// Режимы и разные наборы оружия: вместе покрывают все десять стволов (гонка вооружений проходит их по очереди).
const RUNS = [['tdm', ''], ['hill', '6,9,7'], ['ffa', '3,4,1'], ['hs', '5,2,7'], ['tdm', '8,4,7'], ['gg', '']];
for (const [mode, lo] of RUNS) {
  const r = spawnSync(process.execPath, ['test/client.smoke.mjs'], { env: { ...process.env, SMOKE_MODE: mode, SMOKE_LOADOUT: lo }, encoding: 'utf8' });
  process.stdout.write(`[${mode} ${lo || 'стандартный набор'}] ${r.stdout}`);
  if (r.status !== 0) { process.stderr.write(r.stderr); process.exit(1); }
}
