import { build } from 'esbuild'
import path from 'node:path'
import process from 'node:process'

const [entryArg, outputArg] = process.argv.slice(2)
if (!entryArg || !outputArg) throw new Error('usage: node scripts/bundle-backend.mjs <entry> <outfile>')

await build({
  entryPoints: [path.resolve(entryArg)],
  outfile: path.resolve(outputArg),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js: `import { createRequire as __toolnestCreateRequire } from 'node:module';
const require = __toolnestCreateRequire(import.meta.url);
const __toolnestParentPid = Number(process.env.TOOLNEST_PLUGIN_PARENT_PID ?? 0);
const __toolnestParentIntervalRaw = Number(process.env.TOOLNEST_PLUGIN_PARENT_CHECK_INTERVAL_MS ?? 5000);
const __toolnestParentInterval = Number.isFinite(__toolnestParentIntervalRaw)
  ? Math.min(60000, Math.max(100, Math.trunc(__toolnestParentIntervalRaw)))
  : 5000;
if (Number.isInteger(__toolnestParentPid) && __toolnestParentPid > 1) {
  const __toolnestParentTimer = setInterval(() => {
    try { process.kill(__toolnestParentPid, 0); }
    catch { process.kill(process.pid, 'SIGTERM'); }
  }, __toolnestParentInterval);
  __toolnestParentTimer.unref();
}`,
  },
})
