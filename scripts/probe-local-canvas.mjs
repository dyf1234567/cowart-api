import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function probeLocalCanvas({ projectDir, canvasDir = join(projectDir, 'canvas'), url = 'http://127.0.0.1:43217/', fetchImpl = fetch }) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.username || target.password) throw new Error('Only a loopback HTTP canvas URL is supported.');
  const base = target.origin;
  const get = (path, headers) => fetchImpl(`${base}${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(4000) });
  let html;
  try { html = await get('/'); }
  catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return { status: 'offline', url: `${base}/` };
    throw new Error('Cannot verify local canvas; do not start a duplicate service.', { cause: error });
  }
  if (!html.ok) return { status: 'incompatible', url: `${base}/` };
  const token = (await html.text()).match(/name="cowart-session" content="([^"]+)"/)?.[1];
  if (!token) return { status: 'incompatible', url: `${base}/` };
  const response = await get('/api/canvas', { 'x-cowart-session': token });
  if (!response.ok) return { status: 'incompatible', url: `${base}/` };
  const state = await response.json();
  const normalize = (value) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  const matches = typeof state.projectDir === 'string' && typeof state.canvasDir === 'string'
    && normalize(state.projectDir) === normalize(projectDir) && normalize(state.canvasDir) === normalize(canvasDir);
  return { status: matches ? 'ready' : 'mismatch', url: `${base}/`, projectDir: state.projectDir, canvasDir: state.canvasDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const read = (key) => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
    if (!read('--project')) throw new Error('Usage: node scripts/probe-local-canvas.mjs --project <path> [--canvas <path>] [--url <loopback-url>]');
    const result = await probeLocalCanvas({ projectDir: read('--project'), canvasDir: read('--canvas'), url: read('--url') });
    console.log(JSON.stringify(result));
    process.exitCode = result.status === 'ready' ? 0 : result.status === 'offline' ? 3 : 2;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
