import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await mkdtemp(join(tmpdir(), 'cowart-material-probe-'));
process.env.COWART_CONFIG_DIR = join(root, 'config');
const storage = await import('../mcp/lib/canvas-storage.mjs');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
let calls = 0;
let requestError;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/images/generations');
    assert.equal(req.headers.authorization, 'Bearer probe-only-not-a-real-key');
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    assert.equal(payload.model, 'mock-material');
    assert.equal(payload.prompt, 'material pipeline probe');
    calls++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ b64_json: png }] }));
  } catch (error) { requestError = error; res.statusCode = 500; res.end('probe failed'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const material = await storage.saveCowartProfile({ name: 'Mock bitmap API', provider: 'custom', settings: {
    apiKey: 'probe-only-not-a-real-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'mock-material', callMode: 'images'
  } });
  const design = await storage.saveCowartProfile({ name: 'Mock Ardot', provider: 'ardot', settings: { imageProfileId: material.profile.id } });
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./generate-ardot-material.mjs', import.meta.url)),
      '--ardot-profile', design.profile.id, '--prompt', 'material pipeline probe', '--out-dir', root], {
      env: { ...process.env, COWART_CUSTOM_BASE_URL: 'http://127.0.0.1:1/wrong-service', COWART_CUSTOM_API_KEY: 'wrong-key', COWART_CUSTOM_API_MODEL: 'wrong-model' }, windowsHide: true
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => stdout += chunk);
    child.stderr.on('data', (chunk) => stderr += chunk);
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
  const generated = await run();
  if (requestError) throw requestError;
  assert.equal(generated.code, 0, generated.stderr);
  const result = JSON.parse(generated.stdout);
  assert.deepEqual(await readFile(result.outputPath), Buffer.from(png, 'base64'));
  assert.equal(calls, 1);
  assert.equal(generated.stdout.includes('probe-only-not-a-real-key'), false);
  await storage.deleteCowartProfile(material.profile.id);
  assert.notEqual((await run()).code, 0);
  assert.equal(calls, 1, 'Deleted material profile must not fall back to any API');
  console.log(`PASS: Ardot material profile -> actual custom API script -> isolated mock HTTP -> PNG; env isolation and missing-profile failure. Test asset: ${result.outputPath}`);
} finally { await new Promise((resolve) => server.close(resolve)); }
