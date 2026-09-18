import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorizeLocalApi } from '../mcp/lib/local-api-security.mjs';
import { probeLocalCanvas } from './probe-local-canvas.mjs';
import { resolveImageProfile, ardotSource, ardotEditInstructions, ardotAssetInstructions, ardotCreationInstructions } from '../src/ardotRouting.js';

const request = (headers = {}) => ({ socket: { localPort: 43217 }, headers: { host: '127.0.0.1:43217', 'x-cowart-session': 'test-capability', ...headers } });
assert.equal(authorizeLocalApi(request(), 'test-capability'), true);
for (const headers of [
  { origin: 'https://evil.example' }, { origin: 'null' },
  { host: 'evil.example:43217' }, { host: '127.0.0.1:43218' },
  { 'x-cowart-session': '' }, { 'sec-fetch-site': 'cross-site' }
]) assert.equal(authorizeLocalApi(request(headers), 'test-capability'), false);

const raster = { id: 'image-api', provider: 'custom', name: 'test', settings: {} };
const ardot = { id: 'layout', provider: 'ardot', settings: { imageProfileId: raster.id } };
const profiles = [raster, ardot];
assert.equal(resolveImageProfile({ imageProvider: 'openai' }, profiles), null);
assert.equal(resolveImageProfile({ imageProvider: 'ardot', imageProfileId: ardot.id }, profiles), ardot);
assert.throws(() => resolveImageProfile({ imageProvider: 'ardot', imageProfileId: 'deleted' }, profiles));
assert.throws(() => resolveImageProfile({ imageProvider: 'ardot', imageProfileId: raster.id }, profiles));
assert.throws(() => ardotAssetInstructions({ ...ardot, settings: { imageProfileId: ardot.id } }, profiles));
assert.throws(() => ardotAssetInstructions({ ...ardot, settings: { imageProfileId: 'deleted' } }, profiles));
assert.ok(ardotAssetInstructions(ardot, profiles).join('\n').includes('generate-custom-api-image.mjs'));
assert.ok(ardotAssetInstructions(ardot, profiles).join('\n').includes('--ardot-profile "layout"'));
assert.equal(ardotSource({}), null);
assert.equal(ardotSource({ cowartArdotSource: { fileUrl: 'https://evil.example/file/1', nodeId: '1:2' } }), null);
const source = ardotSource({ cowartArdotSource: { fileUrl: 'https://ardot.tencent.com/file/1', nodeId: '1:2' } });
assert.deepEqual(source, { fileUrl: 'https://ardot.tencent.com/file/1', nodeId: '1:2' });
assert.throws(() => ardotEditInstructions(null, 'shape:1'));
assert.ok(ardotEditInstructions(source, 'shape:1').join('\n').includes('1:2'));
assert.ok(ardotCreationInstructions('slides', 'shape:slides', 3).join('\n').includes('ardot-slides'));
assert.ok(ardotCreationInstructions('ui', 'shape:ui').join('\n').includes('ardot-ui-design'));

// A failed project-scoped MCP write must never perform an HTTP write to any port.
let fetchCount = 0;
globalThis.window = {
  openai: { toolOutput: { projectDir: 'C:/project-B' } },
  cowartMcp: { callServerTool: async () => { throw new Error('bridge denied'); } },
  fetch: async () => { fetchCount++; throw new Error('Unexpected HTTP'); }
};
const client = await import('../src/cowartClient.js');
for (const operation of [
  () => client.saveCowartCanvasSnapshot({ store: {}, schema: {} }),
  () => client.saveCowartViewState({}),
  () => client.saveCowartSelectionState({}),
  () => client.saveCowartModelPreferences({}),
  () => client.saveCowartProfile({}),
  () => client.deleteCowartProfile('test'),
  () => client.saveCowartProviderConfig({}),
  () => client.updateCowartHtmlDraft({ draftShapeId: 'shape:1', htmlContent: '' })
]) await assert.rejects(operation, /禁用跨端口回退/);
assert.equal(fetchCount, 0);
delete globalThis.window;

// Exercise the real local HTTP middleware in an isolated, disposable project.
const root = await mkdtemp(join(tmpdir(), 'cowart-http-safety-'));
process.env.COWART_PROJECT_DIR = root;
process.env.COWART_CONFIG_DIR = join(root, 'config');
const { createServer } = await import('vite');
const config = (await import('../vite.config.js')).default;
const server = await createServer({ ...config, configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { ...config.server, port: 0, open: false } });
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const html = await (await fetch(base)).text();
  const token = html.match(/name="cowart-session" content="([^"]+)"/)?.[1];
  assert.ok(token, 'HTML must supply a session capability');
  for (const method of ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS']) {
    const denied = await fetch(`${base}/api/canvas`, { method, headers: { origin: 'https://evil.example' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
  assert.equal((await fetch(`${base}/api/canvas`)).status, 403);
  assert.equal((await fetch(`${base}/api/canvas`, { headers: { origin: base, 'x-cowart-session': token } })).status, 200);
  assert.equal((await fetch(`${base}/api/canvas`, { headers: { origin: 'https://evil.example', 'x-cowart-session': token } })).status, 403);
  assert.equal((await fetch(`${base}/api/reference-image`, { method: 'POST', headers: { 'x-cowart-session': token, 'content-type': 'application/json' }, body: '{}' })).status, 400);
  const taskHeaders = { 'x-cowart-session': token, 'content-type': 'application/json' };
  assert.equal((await probeLocalCanvas({ projectDir: root, url: base })).status, 'ready');
  assert.equal((await probeLocalCanvas({ projectDir: join(root, 'other-project'), url: base })).status, 'mismatch');
  assert.equal((await probeLocalCanvas({ projectDir: root, canvasDir: join(root, 'wrong-canvas'), url: base })).status, 'mismatch');
  await assert.rejects(() => probeLocalCanvas({ projectDir: root, url: 'https://example.com' }));
  const deniedProbe = await probeLocalCanvas({ projectDir: root, fetchImpl: async () => new Response('', { status: 403 }) });
  assert.equal(deniedProbe.status, 'incompatible', '403 must not trigger a second server');

  const { createTLStore } = await import('tldraw');
  const { saveCowartCanvasSnapshot } = await import('../mcp/lib/canvas-storage.mjs');
  const fixtureStore = createTLStore();
  const schema = fixtureStore.schema.serialize();
  fixtureStore.dispose();
  const snapshot = { schema, store: {
    'page:page': { id: 'page:page', typeName: 'page', name: 'Page', index: 'a1', meta: {} }
  } };
  const backend = structuredClone(snapshot);
  backend.store['asset:new'] = { id: 'asset:new', typeName: 'asset', type: 'image', meta: {}, props: { w: 1, h: 1, name: 'new.png', isAnimated: false, mimeType: 'image/png', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=' } };
  backend.store['shape:new'] = { id: 'shape:new', typeName: 'shape', type: 'image', parentId: 'page:page', index: 'a1', x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {}, props: { w: 1, h: 1, assetId: 'asset:new', playing: true, url: '', crop: null, flipX: false, flipY: false, altText: 'backend result' } };
  assert.equal((await saveCowartCanvasSnapshot({ projectDir: root }, backend)).ok, true);
  const put = async (payload) => (await fetch(`${base}/api/canvas`, { method: 'PUT', headers: taskHeaders, body: JSON.stringify(payload) })).json();
  assert.equal((await put({ snapshot, protectImageRecords: false })).ok, false, 'stale web snapshot must not erase backend image');
  assert.equal((await put(snapshot)).ok, false, 'legacy client must also preserve images');
  const preserved = await (await fetch(`${base}/api/canvas`, { headers: taskHeaders })).json();
  assert.ok(preserved.snapshot.store['shape:new']);
  assert.equal((await put({ snapshot, acknowledgedImageShapeDeletes: ['shape:new'] })).ok, true, 'explicit user deletion remains possible');
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await fetch(`${base}/api/tasks`, { method })).status, 403);
    assert.equal((await fetch(`${base}/api/tasks`, { method, headers: { ...taskHeaders, origin: 'null' } })).status, 403);
  }
  assert.equal((await fetch(`${base}/api/tasks`, { headers: taskHeaders })).status, 200);
  assert.equal((await fetch(`${base}/api/tasks`, { method: 'POST', headers: taskHeaders, body: '{}' })).status, 400);
  assert.equal((await fetch(`${base}/api/tasks/unknown`, { headers: taskHeaders })).status, 404);
} finally { await server.close(); }
console.log('PASS: local HTTP session/origin checks, no cross-project fallback, explicit routes, Ardot bindings and independent material provider.');
// tldraw/React's Node scheduler keeps a MessagePort alive. All assertions and
// server.close() above have completed; this standalone probe has no more work.
process.exit(0);
