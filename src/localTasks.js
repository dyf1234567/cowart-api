// Same-origin only: never fall back from a widget to an arbitrary local port.
export async function localTaskRequest(method = 'GET', body) {
  const token = document.querySelector('meta[name="cowart-session"]')?.content
  if (!token) throw new Error('缺少本地画布会话，请刷新页面；内嵌画布请使用宿主消息桥。')
  const response = await fetch('/api/tasks', {
    method, headers: { 'content-type': 'application/json', 'x-cowart-session': token },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.error || `任务请求失败：${response.status}`), { status: response.status })
  return result
}

function confirmLocalTask(prompt) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.className = 'cowart-task-confirm'
    const heading = document.createElement('h2')
    heading.textContent = '自动执行此画布任务？'
    const info = document.createElement('p')
    info.textContent = '将使用本机已登录的 Codex 执行，消耗 Codex 额度；任务中选定的生图 API 可能收费，相关素材会发送到所选服务。结果自动回到画布。不需要复制到对话。'
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = '查看任务内容'
    const pre = document.createElement('pre')
    pre.textContent = prompt
    details.append(summary, pre)
    const start = document.createElement('button')
    start.textContent = '确认并自动执行'
    const cancel = document.createElement('button')
    cancel.textContent = '取消'
    let confirmed = false
    start.onclick = () => { confirmed = true; dialog.close() }
    cancel.onclick = () => dialog.close()
    dialog.addEventListener('close', () => { dialog.remove(); resolve(confirmed) }, { once: true })
    dialog.append(heading, info, details, start, cancel)
    document.body.append(dialog)
    dialog.showModal()
    cancel.focus()
  })
}

let submitting = false
export async function submitLocalCanvasTask(message) {
  if (submitting) throw new Error('正在提交任务，请勿重复点击。')
  submitting = true
  try {
    if (!await confirmLocalTask(message.prompt)) throw new Error('已取消，任务未提交。')
    const body = { prompt: message.prompt, confirmed: true, requestId: crypto.randomUUID() }
    // Record before sending: after a lost response, check status, never auto-resubmit.
    sessionStorage.setItem('cowart-pending-task', body.requestId)
    window.dispatchEvent(new Event('cowart-task-change'))
    const { job } = await localTaskRequest('POST', body)
    sessionStorage.removeItem('cowart-pending-task')
    window.dispatchEvent(new Event('cowart-task-change'))
    if (job.status === 'failed') throw new Error(job.message)
    return { status: 'accepted', taskId: job.id }
  } catch (error) {
    if (error.status >= 400 && error.status < 500) sessionStorage.removeItem('cowart-pending-task')
    window.dispatchEvent(new Event('cowart-task-change'))
    throw error
  } finally { submitting = false }
}
