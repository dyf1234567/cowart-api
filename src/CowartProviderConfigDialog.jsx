import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadCowartProviderConfig, saveCowartProviderConfig } from './cowartClient.js'

const PROVIDER_DIALOG_META = {
  dashscope: {
    title: '配置阿里千问（DashScope）',
    ariaLabel: '配置阿里千问'
  },
  custom: {
    title: '配置自定义 API（OpenAI 兼容）',
    ariaLabel: '配置自定义 API'
  },
  comfyui: {
    title: '配置本地 ComfyUI',
    ariaLabel: '配置本地 ComfyUI'
  }
}

function emptyProviderSections() {
  return {
    dashscope: { apiKey: '', baseUrl: '', model: 'wan2.7-image-pro', configured: false, apiKeyPreview: '' },
    custom: { apiKey: '', baseUrl: '', model: '', configured: false, apiKeyPreview: '' },
    comfyui: {
      configured: false,
      serverUrl: 'http://127.0.0.1:8188',
      checkpoint: '',
      workflow: '',
      promptNodePath: '',
      negativeNodePath: '',
      imageNodePath: '',
      denoise: 0.75
    }
  }
}

function stopInputEvent(event) {
  event.stopPropagation()
}

function stopDialogEvent(event) {
  event.stopPropagation()
}

export function CowartProviderConfigDialog({ provider, onClose }) {
  const meta = PROVIDER_DIALOG_META[provider] ?? PROVIDER_DIALOG_META.dashscope
  const [sections, setSections] = useState(emptyProviderSections)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    let isCancelled = false

    async function loadConfig() {
      try {
        const config = await loadCowartProviderConfig()
        if (isCancelled || !config) return
        setSections((current) => ({
          ...current,
          dashscope: { ...current.dashscope, ...config.dashscope },
          custom: { ...current.custom, ...config.custom },
          comfyui: { ...current.comfyui, ...config.comfyui }
        }))
      } catch {
        if (!isCancelled) setMessage('读取配置失败')
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    loadConfig()

    return () => {
      isCancelled = true
    }
  }, [])

  function updateSection(field, value) {
    setSections((current) => ({
      ...current,
      [provider]: { ...current[provider], [field]: value }
    }))
  }

  async function saveConfig(event) {
    event.preventDefault()
    setIsSaving(true)
    setMessage('')

    const section = sections[provider]
    let patch = null

    if (provider === 'dashscope' || provider === 'custom') {
      const apiKey = apiKeyInput.trim()
      if (!apiKey && !section.configured) {
        setMessage('请填写 API Key')
        setIsSaving(false)
        return
      }
      if (!section.baseUrl.trim()) {
        setMessage(provider === 'dashscope' ? '请填写 DASHSCOPE_BASE_URL' : '请填写 API Base URL')
        setIsSaving(false)
        return
      }
      patch = {
        apiKey,
        baseUrl: section.baseUrl,
        model: section.model || (provider === 'dashscope' ? 'wan2.7-image-pro' : '')
      }
    } else if (provider === 'comfyui') {
      if (!section.serverUrl.trim()) {
        setMessage('请填写 ComfyUI 服务地址')
        setIsSaving(false)
        return
      }
      if (section.workflow.trim()) {
        try {
          JSON.parse(section.workflow)
        } catch {
          setMessage('Workflow 不是合法的 JSON')
          setIsSaving(false)
          return
        }
      }
      const denoise = Number(section.denoise)
      patch = {
        serverUrl: section.serverUrl,
        checkpoint: section.checkpoint,
        workflow: section.workflow,
        promptNodePath: section.promptNodePath,
        negativeNodePath: section.negativeNodePath,
        imageNodePath: section.imageNodePath,
        denoise: Number.isFinite(denoise) ? denoise : 0.75
      }
    }

    if (!patch) {
      setIsSaving(false)
      return
    }

    try {
      const result = await saveCowartProviderConfig({ [provider]: patch })
      const nextConfig = result?.config
      if (nextConfig) {
        setSections((current) => ({
          ...current,
          dashscope: { ...current.dashscope, ...nextConfig.dashscope },
          custom: { ...current.custom, ...nextConfig.custom },
          comfyui: { ...current.comfyui, ...nextConfig.comfyui }
        }))
      }
      setApiKeyInput('')
      setToast('已保存')
      window.setTimeout(onClose, 700)
    } catch {
      setMessage('保存失败')
    } finally {
      setIsSaving(false)
    }
  }

  const section = sections[provider]

  const dialog = (
    <div className="cowart-config-backdrop" role="presentation" onMouseDown={onClose}>
      {toast && <div className="cowart-config-toast">{toast}</div>}
      <form
        aria-label={meta.ariaLabel}
        className="cowart-config-dialog"
        onClick={stopDialogEvent}
        onKeyDown={stopDialogEvent}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseDownCapture={stopDialogEvent}
        onPointerDown={stopDialogEvent}
        onPointerDownCapture={stopDialogEvent}
        onPointerMove={stopDialogEvent}
        onPointerMoveCapture={stopDialogEvent}
        onPointerUp={stopDialogEvent}
        onPointerUpCapture={stopDialogEvent}
        onSubmit={saveConfig}
        onWheel={stopDialogEvent}
        onWheelCapture={stopDialogEvent}
      >
        <div className="cowart-config-dialog-header">
          <h2>{meta.title}</h2>
          <button
            aria-label="关闭"
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
            onPointerDown={stopInputEvent}
            type="button"
          >
            ×
          </button>
        </div>

        {(provider === 'dashscope' || provider === 'custom') && (
          <>
            <label className="cowart-config-field">
              <span>{provider === 'dashscope' ? 'DASHSCOPE_API_KEY' : 'API_KEY'}</span>
              <input
                autoComplete="off"
                disabled={isLoading || isSaving}
                onChange={(event) => setApiKeyInput(event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder={section.configured ? section.apiKeyPreview : 'sk-...'}
                type="password"
                value={apiKeyInput}
              />
            </label>

            <label className="cowart-config-field">
              <span>{provider === 'dashscope' ? 'DASHSCOPE_BASE_URL' : 'API_BASE_URL'}</span>
              <input
                disabled={isLoading || isSaving}
                onChange={(event) => updateSection('baseUrl', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder={
                  provider === 'dashscope'
                    ? 'https://<workspace-id>.cn-beijing.maas.aliyuncs.com/api/v1'
                    : 'https://api.example.com/v1'
                }
                value={section.baseUrl}
              />
            </label>

            <label className="cowart-config-field">
              <span>模型</span>
              <input
                disabled={isLoading || isSaving}
                onChange={(event) => updateSection('model', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder={provider === 'dashscope' ? 'wan2.7-image-pro' : 'gpt-image-1 / sd-webui 等'}
                value={section.model}
              />
            </label>
          </>
        )}

        {provider === 'comfyui' && (
          <>
            <label className="cowart-config-field">
              <span>ComfyUI 服务地址</span>
              <input
                disabled={isLoading || isSaving}
                onChange={(event) => updateSection('serverUrl', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="http://127.0.0.1:8188"
                value={section.serverUrl}
              />
            </label>

            <label className="cowart-config-field">
              <span>Checkpoint 模型名（内置工作流用）</span>
              <input
                disabled={isLoading || isSaving}
                onChange={(event) => updateSection('checkpoint', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="sd_xl_base_1.0.safetensors"
                value={section.checkpoint}
              />
            </label>

            <label className="cowart-config-field">
              <span>Workflow（API 格式 JSON，留空则用内置工作流）</span>
              <textarea
                className="cowart-config-textarea"
                disabled={isLoading || isSaving}
                onChange={(event) => updateSection('workflow', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder='{"3": {"class_type": "KSampler", ...}}'
                rows={5}
                value={section.workflow}
              />
            </label>

            <label className="cowart-config-field">
              <span>正向提示词注入路径（如 6.inputs.text）</span>
              <input
                disabled={isLoading || isSaving}
                onChange={(event) => updateSection('promptNodePath', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="6.inputs.text"
                value={section.promptNodePath}
              />
            </label>

            <label className="cowart-config-field">
              <span>负向提示词注入路径（可选，如 7.inputs.text）</span>
              <input
                disabled={isLoading || isSaving}
                onChange={(event) => updateSection('negativeNodePath', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="7.inputs.text"
                value={section.negativeNodePath}
              />
            </label>

            <label className="cowart-config-field">
              <span>参考图 LoadImage 节点 ID（图生图用，可选）</span>
              <input
                disabled={isLoading || isSaving}
                onChange={(event) => updateSection('imageNodePath', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="10"
                value={section.imageNodePath}
              />
            </label>

            <label className="cowart-config-field">
              <span>图生图重绘幅度 denoise（0-1）</span>
              <input
                disabled={isLoading || isSaving}
                max="1"
                min="0"
                onChange={(event) => updateSection('denoise', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="0.75"
                step="0.05"
                type="number"
                value={section.denoise}
              />
            </label>
          </>
        )}

        <div className="cowart-config-actions">
          <span className="cowart-config-message">{message}</span>
          <button className="cowart-config-cancel" onClick={onClose} type="button">
            取消
          </button>
          <button disabled={isLoading || isSaving} type="submit">
            保存
          </button>
        </div>
      </form>
    </div>
  )

  return createPortal(dialog, document.body)
}
