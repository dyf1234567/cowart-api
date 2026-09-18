import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalTaskRunner, codexTaskCommand } from '../mcp/lib/local-task-runner.mjs';

const root = await mkdtemp(join(tmpdir(), 'cowart-task-test-'));
const canvasDir = join(root, 'canvas');
const children = [];
const spawnProcess = (command, args, options) => {
  const child = new EventEmitter();
  Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: 12345, input: '' });
  child.stdin.on('data', (chunk) => { child.input += chunk; });
  children.push({ child, command, args, options });
  return child;
};
const stopProcess = (child) => queueMicrotask(() => child.emit('close', 1));
const options = { projectDir: root, canvasDir, pluginRoot: resolve('.'), spawnProcess, stopProcess };
const runner = createLocalTaskRunner(options);
const request = (id = 'test-request-000001', extra = {}) => ({ requestId: id, confirmed: true, prompt: '测试海报 " & exit 1', ...extra });
await assert.rejects(() => runner.submit(request(undefined, { confirmed: false })));
await assert.rejects(() => runner.submit(request(undefined, { prompt: 'a'.repeat(50_001) })));
const first = await runner.submit(request(undefined, { command: 'evil', projectDir: 'wrong' }));
const competing = createLocalTaskRunner(options);
await assert.rejects(() => competing.list(), { status: 409 });
await assert.rejects(() => competing.close(), { status: 409 });
assert.equal(first.status, 'running');
assert.equal(children.length, 1);
assert.equal(children[0].options.cwd, root);
assert.equal(children[0].options.shell, false);
assert.ok(children[0].args.includes('--approve-for-me'));
assert.ok(children[0].args.includes('--ephemeral'));
assert.ok(!children[0].args.some((arg) => arg.includes('bypass')));
assert.ok(!children[0].args.some((arg) => arg.includes('测试')));
assert.ok(children[0].child.input.includes('测试海报'));
assert.equal((await runner.submit(request())).id, first.id);
assert.equal(children.length, 1);
await assert.rejects(() => runner.submit(request(undefined, { prompt: 'different' })), { status: 409 });
await assert.rejects(() => runner.submit(request('test-request-000002')), { status: 409 });
const emit = (event) => children.at(-1).child.stdout.write(`${JSON.stringify(event)}\n`);
emit({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'SECRET RAW TOOL OUTPUT' } });
const text = Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '完成海报' } }) + '\n');
// Split within a Chinese UTF-8 character.
const split = text.indexOf(Buffer.from('完')) + 1;
children[0].child.stdout.write(text.subarray(0, split));
children[0].child.stdout.write(text.subarray(split));
emit({ type: 'turn.completed' });
children[0].child.emit('close', 0);
assert.equal((await runner.list())[0].status, 'completed');
assert.equal((await runner.list())[0].result, '完成海报');
assert.ok(!JSON.stringify(await runner.list()).includes('SECRET'));
const second = await runner.submit(request('test-request-000002'));
await runner.cancel(second.id);
assert.equal((await runner.list())[0].status, 'cancelled');
await runner.submit(request('test-request-000003'));
children.at(-1).child.emit('close', 0);
assert.equal((await runner.list())[0].status, 'failed', 'exit zero without turn.completed is not success');
await runner.submit(request('test-request-000004'));
emit({ type: 'turn.failed', error: { message: 'quota exceeded' } });
children.at(-1).child.emit('close', 1);
assert.equal((await runner.list())[0].message, 'quota exceeded');
await runner.submit(request('test-request-000005'));
children.at(-1).child.emit('error', new Error('ENOENT'));
assert.equal((await runner.list())[0].status, 'failed');
await runner.close();
const journal = await readFile(join(canvasDir, '.cowart-tasks.json'), 'utf8');
assert.ok(!journal.includes('测试海报'), 'prompts must not persist');
const recovered = createLocalTaskRunner(options);
assert.equal((await recovered.list()).length, 5);
assert.equal((await recovered.submit(request())).id, first.id);
assert.equal(children.length, 5, 'restart must not retry a request');
await recovered.close();
const interrupted = JSON.parse(journal);
interrupted[0].status = 'running';
await writeFile(join(canvasDir, '.cowart-tasks.json'), JSON.stringify(interrupted));
const afterCrash = createLocalTaskRunner(options);
assert.equal((await afterCrash.list()).find((job) => job.id === first.id).status, 'interrupted');
await afterCrash.close();
const timed = createLocalTaskRunner({ ...options, timeoutMs: 15 });
await timed.submit(request('test-request-000006'));
await delay(35);
assert.equal((await timed.list())[0].status, 'timed_out');
await timed.close();
// A live orphan must remain a blocker after more than one restart, including
// the interrupted/timed_out journal states written by earlier startups.
for (const status of ['running', 'interrupted', 'timed_out']) {
  await writeFile(join(canvasDir, '.cowart-tasks.json'), JSON.stringify([{ id: 'orphan', requestId: 'orphan-request-0001', status, executorPid: process.pid }]));
  const before = children.length;
  for (let restart = 0; restart < 3; restart++) {
    const restarted = createLocalTaskRunner(options);
    await assert.rejects(() => restarted.submit(request('orphan-new-request-0001')), { status: 409 });
    await restarted.close();
  }
  assert.equal(children.length, before, 'never spawn while old executor is alive');
}
assert.equal(codexTaskCommand(root, { CODEX_CLI_PATH: 'fixed-cli' }).command, 'fixed-cli');
console.log('PASS: scoped spawn, consent, idempotency, concurrency, UTF-8 progress, failure, cancellation, timeout, restart and redacted history.');

// Opt-in real local CLI smoke test; no generation API or remote design writes.
if (process.argv.includes('--live')) {
  const liveRoot = await mkdtemp(join(tmpdir(), 'cowart-task-live-'));
  const live = createLocalTaskRunner({ projectDir: liveRoot, canvasDir: join(liveRoot, 'canvas'), pluginRoot: resolve('.'), timeoutMs: 120_000 });
  try {
    const job = await live.submit({ requestId: 'live-smoke-test-0001', confirmed: true, prompt: 'This is an executor connectivity smoke test, not a design task. Do not call any tools, read files, generate images, or change any files/designs. Reply exactly COWART_EXECUTOR_OK.' });
    let result;
    do { await delay(1000); result = (await live.list()).find((item) => item.id === job.id); } while (['starting', 'running', 'cancelling'].includes(result.status));
    console.log(JSON.stringify(result));
    assert.equal(result.status, 'completed');
    assert.ok(result.result.includes('COWART_EXECUTOR_OK'));
  } finally { await live.close(); }
}
