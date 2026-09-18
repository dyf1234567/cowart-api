import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const ACTIVE = new Set(['starting', 'running', 'cancelling']);
const clean = (value) => String(value ?? '').replace(/\b(?:sk-[\w-]{8,}|Bearer\s+[^\s"']+)/gi, '[redacted]').slice(-12000);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Browser input can supply a task, never a command, executable, cwd or CLI flags.
export function codexTaskCommand(projectDir, env = process.env) {
  return {
    command: env.CODEX_CLI_PATH || (process.platform === 'win32' ? 'codex.exe' : 'codex'),
    // --approve-for-me selects workspace-write + automatic approval review itself;
    // current CLI rejects combining it with --sandbox.
    args: ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--approve-for-me', '-C', projectDir, '-'],
  };
}

export function stopTaskProcess(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    // Only the process tree we spawned, never an image-name/global kill.
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
    killer.on('error', () => child.kill());
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  }
}

export function createLocalTaskRunner({ projectDir, canvasDir, pluginRoot, spawnProcess = spawn, stopProcess = stopTaskProcess, timeoutMs = 30 * 60_000 }) {
  projectDir = resolve(projectDir);
  canvasDir = resolve(canvasDir);
  const file = join(canvasDir, '.cowart-tasks.json');
  const lockFile = join(canvasDir, '.cowart-task-runner.lock');
  let ownsLock = false;
  const jobs = new Map();
  const orphanedPids = new Set();
  let active = null;
  let closed = false;
  let writes = Promise.resolve();
  const publicJob = ({ digest, executorPid, ...job }) => ({ ...job });
  const persist = () => {
    const data = JSON.stringify([...jobs.values()].slice(-50));
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(canvasDir, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, data, { mode: 0o600 });
      await rename(temporary, file);
    });
    return writes;
  };
  const ready = (async () => {
    await mkdir(canvasDir, { recursive: true });
    const candidate = `${lockFile}.${randomUUID()}.tmp`;
    const acquire = async () => {
      // Publish complete ownership metadata atomically; a second server must
      // never observe a newly-created but still empty JSON lock.
      await writeFile(candidate, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
      try { await link(candidate, lockFile); ownsLock = true; }
      finally { await unlink(candidate).catch(() => {}); }
    };
    try {
      await acquire();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(await readFile(lockFile, 'utf8')); }
      catch { throw fail('任务服务锁损坏，请关闭该画布服务后检查 .cowart-task-runner.lock；未执行任务。', 503); }
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw fail('任务服务锁的进程信息无效。', 503);
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (failure) { if (failure.code === 'ESRCH') alive = false; }
      if (alive) throw fail('此画布已有本地任务服务，请使用原服务或关闭后重试。', 409);
      await unlink(lockFile);
      await acquire();
    }
    let previous;
    try { previous = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const job of previous.slice(-50)) {
      if (ACTIVE.has(job.status) || ['interrupted', 'timed_out'].includes(job.status)) {
        if (Number.isInteger(job.executorPid) && job.executorPid > 0) orphanedPids.add(job.executorPid);
        job.status = 'interrupted';
        job.message = '本地服务已重启，任务状态未知。请先检查画布和 Ardot，勿直接重复付费任务。';
      }
      jobs.set(job.id, job);
    }
  })();
  // Fail requests clearly, without an unhandled rejection before the UI connects.
  void ready.catch(() => {});

  async function submit(body) {
    await ready;
    if (closed) throw fail('任务服务正在关闭。', 503);
    for (const pid of orphanedPids) {
      try { process.kill(pid, 0); }
      catch (error) { if (error.code === 'ESRCH') { orphanedPids.delete(pid); continue; } }
      throw fail('上次服务中断的执行器可能仍在运行。请先检查并停止旧任务，再提交新任务，避免重复计费。', 409);
    }
    if (!body || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 50_000) throw fail('任务内容为空或过长。');
    if (body.confirmed !== true) throw fail('请确认将使用 Codex 额度及任务中选定的服务。');
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || '')) throw fail('缺少有效请求 ID。');
    const digest = createHash('sha256').update(body.prompt).digest('hex');
    const old = [...jobs.values()].find((job) => job.requestId === body.requestId);
    if (old) {
      if (old.digest !== digest) throw fail('请求 ID 已用于其他内容。', 409);
      return publicJob(old);
    }
    if (active) throw fail('已有任务正在执行，请完成或取消后再提交，避免同时修改画布。', 409);
    const job = { id: randomUUID(), requestId: body.requestId, digest, status: 'starting', createdAt: new Date().toISOString(), message: '正在启动本机 Codex…', result: '' };
    jobs.set(job.id, job);
    while (jobs.size > 50) jobs.delete(jobs.keys().next().value);
    active = { job, child: null, timer: null };
    const run = active;
    try { await persist(); } catch (error) { active = null; jobs.delete(job.id); throw error; }
    if (closed || active !== run || job.status === 'cancelling') {
      job.status = closed ? 'interrupted' : 'cancelled';
      job.message = '执行启动前已取消。';
      if (active === run) active = null;
      await persist();
      return publicJob(job);
    }
    const { command, args } = codexTaskCommand(projectDir);
    let completed = false;
    let turnFailed = false;
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    const update = () => { job.updatedAt = new Date().toISOString(); void persist().catch(() => {}); };
    const consume = (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'turn.completed') completed = true;
      if (event.type === 'turn.failed' || event.type === 'error') {
        turnFailed = true;
        job.message = clean(event.error?.message || event.message || 'Codex 执行失败');
      }
      if (event.type === 'item.started') job.message = `正在执行：${event.item?.type || '任务步骤'}`;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        job.result = clean(event.item.text);
        job.message = '已收到 Codex 进度说明，任务仍在执行…';
      }
      update();
    };
    const finish = (code, error) => {
      if (active !== run) return;
      clearTimeout(run.timer);
      if (job.status === 'cancelling') {
        job.status = 'cancelled'; job.message = '本地执行已停止；远端已提交的请求可能仍在运行或计费，请检查结果。';
      } else if (job.status !== 'timed_out' && job.status !== 'interrupted') {
        job.status = !error && code === 0 && completed && !turnFailed ? 'completed' : 'failed';
        if (job.status === 'completed') job.message = '执行结束，请查看结果说明和画布。';
        else if (error) job.message = clean(`无法启动 Codex：${error.message}。请确认 CLI 已安装并登录。`);
        else if (!turnFailed) job.message = `Codex 未正常完成（退出码 ${code ?? '未知'}）。请检查登录、额度和权限；不会自动重试。`;
      }
      job.finishedAt = new Date().toISOString();
      active = null;
      update();
    };
    try {
      run.child = spawnProcess(command, args, { cwd: projectDir, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, COWART_PROJECT_DIR: projectDir, COWART_CANVAS_DIR: canvasDir } });
      run.child.on('error', (error) => finish(null, error));
      run.child.on('close', (code) => { buffer += decoder.end(); if (buffer.trim()) consume(buffer); finish(code); });
      run.child.stdout.on('data', (chunk) => {
        buffer += decoder.write(chunk);
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
        if (buffer.length > 2_000_000) { buffer = ''; turnFailed = true; job.message = '执行器输出超出限制。'; stopProcess(run.child); }
      });
      // Raw command/tool output can contain credentials; never send it to the web UI.
      run.child.stderr.resume();
      run.child.stdin.on('error', (error) => { if (active === run) { turnFailed = true; job.message = clean(error.message); } });
      job.status = 'running';
      job.executorPid = run.child.pid;
      job.message = 'Codex 正在执行；完成后画布会自动刷新。';
      run.timer = setTimeout(() => { job.status = 'timed_out'; job.message = '任务超过 30 分钟，正在停止本地进程；请检查远端结果，不会自动重试。'; stopProcess(run.child); update(); }, timeoutMs);
      run.timer.unref?.();
      // Persist the child identity before providing a prompt, so crash recovery
      // cannot launch another task while an orphan still changes this canvas.
      await persist();
      if (active !== run || closed || job.status === 'cancelling') {
        stopProcess(run.child);
        return publicJob(job);
      }
      run.child.stdin.end([
        'Execute this Cowart canvas task using the installed Cowart plugin and Ardot MCP when requested. This is a standalone local canvas job, not an app conversation. Do not use app thread creation, message sending, or recursive task submission.',
        `Fixed projectDir: ${projectDir}\nFixed canvasDir: ${canvasDir}\nCowart plugin root: ${pluginRoot}`,
        'Read the relevant SKILL.md under that plugin root before acting. All Cowart tool calls must explicitly use the fixed projectDir and canvasDir. Use the specified provider only. Read references from the local paths in the task. Insert generated results into this canvas, preserving originals. Only perform the requested design/image task, not unrelated repository edits or configuration changes.',
        'The user confirmed execution and use of the selected services for this task only. Do not expose credentials. If authorization, login, quota, tools, or user decisions are missing, stop and clearly report what is needed. Never disable the sandbox or bypass approval. Do not retry paid generation automatically. State actual output paths/Ardot links and whether insertion succeeded; do not claim success without checking.',
        '\nUser canvas task:\n', body.prompt,
      ].join('\n\n'));
      update();
    } catch (error) { stopProcess(run.child); finish(null, error); }
    return publicJob(job);
  }

  return {
    submit,
    async list() { await ready; return [...jobs.values()].reverse().map(publicJob); },
    async cancel(id) {
      await ready;
      const job = jobs.get(id);
      if (!job) throw fail('任务不存在。', 404);
      if (active?.job.id === id) { job.status = 'cancelling'; job.message = '正在停止本地执行…'; stopProcess(active.child); await persist(); }
      return publicJob(job);
    },
    async close() {
      closed = true;
      if (active) {
        const run = active;
        run.job.status = 'interrupted'; run.job.message = '本地服务关闭，任务已中断，请检查远端结果。'; clearTimeout(run.timer);
        if (run.child) {
          await new Promise((resolveStop, rejectStop) => {
            const timer = setTimeout(() => rejectStop(new Error('执行器仍未停止，保留任务服务锁。')), 10000);
            run.child.once('close', () => { clearTimeout(timer); resolveStop(); });
            stopProcess(run.child);
          });
        }
        active = null;
      }
      try { await ready; await persist(); }
      finally { if (ownsLock) { ownsLock = false; await unlink(lockFile).catch(() => {}); } }
    },
  };
}
