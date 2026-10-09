// Запускает дымовой тест клиента для каждого режима игры.
import { spawnSync } from 'child_process';
for (const mode of ['tdm', 'hs', 'ffa', 'gg']) {
  const r = spawnSync(process.execPath, ['test/client.smoke.mjs'], { env: { ...process.env, SMOKE_MODE: mode }, encoding: 'utf8' });
  process.stdout.write(`[${mode}] ${r.stdout}`);
  if (r.status !== 0) { process.stderr.write(r.stderr); process.exit(1); }
}
