import { useEffect, useState } from 'react'
import { localTaskRequest } from './localTasks.js'

const labels = { starting: '启动中', running: '执行中', cancelling: '取消中', cancelled: '已取消', completed: '执行结束', failed: '执行失败', interrupted: '已中断', timed_out: '已超时' }
const active = new Set(['starting', 'running', 'cancelling'])

export default function LocalTaskPanel() {
  const [jobs, setJobs] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState('')
  useEffect(() => {
    let alive = true
    let timer
    let inFlight = false
    async function refresh() {
      if (inFlight) return
      inFlight = true
      try {
        const result = await localTaskRequest()
        if (alive) {
          setJobs(result.jobs)
          setError('')
          const requestId = sessionStorage.getItem('cowart-pending-task')
          if (result.jobs.some((job) => job.requestId === requestId)) sessionStorage.removeItem('cowart-pending-task')
          setPending(sessionStorage.getItem('cowart-pending-task') || '')
        }
      } catch (failure) { if (alive) setError(failure.message) }
      finally { inFlight = false }
    }
    const changed = () => { setOpen(true); void refresh() }
    window.addEventListener('cowart-task-change', changed)
    void refresh()
    timer = window.setInterval(refresh, 1800)
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('cowart-task-change', changed) }
  }, [])
  async function cancel(id) {
    try {
      const { job } = await localTaskRequest('DELETE', { id })
      setJobs((current) => current.map((item) => item.id === id ? job : item))
    } catch (failure) { setError(failure.message) }
  }
  const running = jobs.find((job) => active.has(job.status))
  return <aside className="cowart-local-tasks" aria-label="本地自动任务">
    <button onClick={() => setOpen(!open)} aria-expanded={open}>自动任务{running ? ` · ${labels[running.status]}` : jobs.length ? ` · ${labels[jobs[0].status]}` : ''}</button>
    {open && <section>
      <h3>本地自动执行</h3>
      <p>关闭此面板不取消任务。结果会自动同步到画布；服务重启后不会自动重试。</p>
      {error && <p role="alert">{error}</p>}
      {pending && <p role="status">请求正在确认，或提交结果未知。请先检查此处任务状态和画布，勿重复提交。</p>}
      {!jobs.length && <p>尚无任务。在画布中点击生成或编辑，再确认执行即可。</p>}
      {jobs.slice(0, 10).map((job) => <article key={job.id}>
        <strong>{labels[job.status] || job.status}</strong> <small>{new Date(job.createdAt).toLocaleTimeString()}</small>
        <p role="status">{job.message}</p>
        {active.has(job.status) && <button disabled={job.status === 'cancelling'} onClick={() => cancel(job.id)}>取消任务</button>}
        {job.result && <details open={job.status === 'completed' || job.status === 'failed'}><summary>执行结果</summary><pre>{job.result}</pre></details>}
      </article>)}
    </section>}
  </aside>
}
