import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { deleteCowartProfile, saveCowartProfile } from './cowartClient.js'

export const PROFILE_TYPE_OPTIONS = [
  { id: 'custom', label: '自定义 API（OpenAI 兼容）' },
  { id: 'dashscope', label: '阿里千问（DashScope）' },
  { id: 'comfyui', label: '本地 ComfyUI' }
]

export function profileTypeLabel(provider) {
  return PROFILE_TYPE_OPTIONS.find((option) => option.id === provider)?.label ?? provider
}

function defaultSettings(provider) {
  if (provider === 'comfyui') {
    return {
      serverUrl: 'http://127.0.0.1:8188',
      checkpoint: '',
      workflow: '',
      promptNodePath: '',
      negativeNodePath: '',
      imageNodePath: '',
      denoise: 0.75
    }
  }
  return {
    apiKey: '',
    baseUrl: '',
    model: provider === 'dashscope' ? 'wan2.7-image-pro' : '',
    configured: false,
    apiKeyPreview: ''
  }
}

function stopInputEvent(event) {
  event.stopPropagation()
}

function stopDialogEvent(event) {
  event.stopPropagation()
}

// profile 为 null 时表示新建画像；否则编辑已有画像。
export function CowartProviderConfigDialog({ profile, defaultProvider = 'custom', onClose, onSaved }) {
  const isEditing = Boolean(profile?.id)
  const [name, setName] = useState(profile?.name ?? '')
  const [provider, setProvider] = useState(profile?.provider ?? defaultProvider)
  const [settings, setSettings] = useState(() => ({
    ...defaultSettings(profile?.provider ?? defaultProvider),
    ...(profile?.settings ?? {})
  }))
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    // 新建时切换类型会重置表单字段，避免残留其它类型的值。
    if (!isEditing) {
      setSettings((current) => ({ ...defaultSettings(provider), apiKeyPreview: current.apiKeyPreview }))
    }
  }, [provider, isEditing])

  function updateSettings(field, value) {
    setSettings((current) => ({ ...current, [field]: value }))
  }

  async function submitProfile(event) {
    event.preventDefault()
    setIsSaving(true)
    setMessage('')

    const trimmedName = name.trim()
    if (!trimmedName) {
      setMessage('请填写画像名称')
      setIsSaving(false)
      return
    }

    let payload = null
    if (provider === 'dashscope' || provider === 'custom') {
      const apiKey = apiKeyInput.trim()
      if (!apiKey && !settings.configured) {
        setMessage('请填写 API Key')
        setIsSaving(false)
        return
      }
      if (!settings.baseUrl.trim()) {
        setMessage(provider === 'dashscope' ? '请填写 DASHSCOPE_BASE_URL' : '请填写 API Base URL')
        setIsSaving(false)
        return
      }
      payload = {
        apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model || (provider === 'dashscope' ? 'wan2.7-image-pro' : '')
      }
    } else if (provider === 'comfyui') {
      if (!settings.serverUrl.trim()) {
        setMessage('请填写 ComfyUI 服务地址')
        setIsSaving(false)
        return
      }
      if (settings.workflow.trim()) {
        try {
          JSON.parse(settings.workflow)
        } catch {
          setMessage('Workflow 不是合法的 JSON')
          setIsSaving(false)
          return
        }
      }
      const denoise = Number(settings.denoise)
      payload = {
        serverUrl: settings.serverUrl,
        checkpoint: settings.checkpoint,
        workflow: settings.workflow,
        promptNodePath: settings.promptNodePath,
        negativeNodePath: settings.negativeNodePath,
        imageNodePath: settings.imageNodePath,
        denoise: Number.isFinite(denoise) ? denoise : 0.75
      }
    }

    if (!payload) {
      setIsSaving(false)
      return
    }

    try {
      const result = await saveCowartProfile({
        id: profile?.id,
        name: trimmedName,
        provider,
        settings: payload
      })
      setApiKeyInput('')
      setToast('已保存')
      window.setTimeout(() => {
        onSaved?.(result?.profile ?? null)
        onClose()
      }, 700)
    } catch (error) {
      setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsSaving(false)
    }
  }

  async function removeProfile() {
    if (!isEditing) return
    setIsDeleting(true)
    setMessage('')
    try {
      await deleteCowartProfile(profile.id)
      setToast('已删除')
      window.setTimeout(() => {
        onSaved?.(null)
        onClose()
      }, 700)
    } catch (error) {
      setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`)
      setIsDeleting(false)
    }
  }

  const title = isEditing ? `编辑画像：${profile.name}` : '添加图片模型画像'
  const apiKeySection = provider === 'dashscope' || provider === 'custom'

  const dialog = (
    <div className="cowart-config-backdrop" role="presentation" onMouseDown={onClose}>
      {toast && <div className="cowart-config-toast">{toast}</div>}
      <form
        aria-label={title}
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
        onSubmit={submitProfile}
        onWheel={stopDialogEvent}
        onWheelCapture={stopDialogEvent}
      >
        <div className="cowart-config-dialog-header">
          <h2>{title}</h2>
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

        <label className="cowart-config-field">
          <span>画像名称</span>
          <input
            disabled={isSaving || isDeleting}
            onChange={(event) => setName(event.target.value)}
            onClick={stopInputEvent}
            onKeyDown={stopInputEvent}
            onPointerDown={stopInputEvent}
            placeholder={provider === 'comfyui' ? '本地 ComfyUI' : '我的自定义 API'}
            value={name}
          />
        </label>

        <label className="cowart-config-field">
          <span>类型</span>
          <select
            disabled={isEditing || isSaving || isDeleting}
            onChange={(event) => setProvider(event.target.value)}
            onClick={stopInputEvent}
            onKeyDown={stopInputEvent}
            onPointerDown={stopInputEvent}
            value={provider}
          >
            {PROFILE_TYPE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {apiKeySection && (
          <>
            <label className="cowart-config-field">
              <span>{provider === 'dashscope' ? 'DASHSCOPE_API_KEY' : 'API_KEY'}</span>
              <input
                autoComplete="off"
                disabled={isSaving || isDeleting}
                onChange={(event) => setApiKeyInput(event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder={settings.configured ? settings.apiKeyPreview || '已配置，留空保持不变' : 'sk-...'}
                type="password"
                value={apiKeyInput}
              />
            </label>

            <label className="cowart-config-field">
              <span>{provider === 'dashscope' ? 'DASHSCOPE_BASE_URL' : 'API_BASE_URL'}</span>
              <input
                disabled={isSaving || isDeleting}
                onChange={(event) => updateSettings('baseUrl', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder={
                  provider === 'dashscope'
                    ? 'https://<workspace-id>.cn-beijing.maas.aliyuncs.com/api/v1'
                    : 'https://api.example.com/v1'
                }
                value={settings.baseUrl}
              />
            </label>

            <label className="cowart-config-field">
              <span>模型</span>
              <input
                disabled={isSaving || isDeleting}
                onChange={(event) => updateSettings('model', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder={provider === 'dashscope' ? 'wan2.7-image-pro' : 'gpt-image-1 / sd-webui 等'}
                value={settings.model}
              />
            </label>
          </>
        )}

        {provider === 'comfyui' && (
          <>
            <label className="cowart-config-field">
              <span>ComfyUI 服务地址</span>
              <input
                disabled={isSaving || isDeleting}
                onChange={(event) => updateSettings('serverUrl', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="http://127.0.0.1:8188"
                value={settings.serverUrl}
              />
            </label>

            <label className="cowart-config-field">
              <span>Checkpoint 模型名（内置工作流用）</span>
              <input
                disabled={isSaving || isDeleting}
                onChange={(event) => updateSettings('checkpoint', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="sd_xl_base_1.0.safetensors"
                value={settings.checkpoint}
              />
            </label>

            <label className="cowart-config-field">
              <span>Workflow（API 格式 JSON，留空则用内置工作流）</span>
              <textarea
                className="cowart-config-textarea"
                disabled={isSaving || isDeleting}
                onChange={(event) => updateSettings('workflow', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder='{"3": {"class_type": "KSampler", ...}}'
                rows={5}
                value={settings.workflow}
              />
            </label>

            <label className="cowart-config-field">
              <span>正向提示词注入路径（如 6.inputs.text）</span>
              <input
                disabled={isSaving || isDeleting}
                onChange={(event) => updateSettings('promptNodePath', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="6.inputs.text"
                value={settings.promptNodePath}
              />
            </label>

            <label className="cowart-config-field">
              <span>负向提示词注入路径（可选，如 7.inputs.text）</span>
              <input
                disabled={isSaving || isDeleting}
                onChange={(event) => updateSettings('negativeNodePath', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="7.inputs.text"
                value={settings.negativeNodePath}
              />
            </label>

            <label className="cowart-config-field">
              <span>参考图 LoadImage 节点 ID（图生图用，可选）</span>
              <input
                disabled={isSaving || isDeleting}
                onChange={(event) => updateSettings('imageNodePath', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="10"
                value={settings.imageNodePath}
              />
            </label>

            <label className="cowart-config-field">
              <span>图生图重绘幅度 denoise（0-1）</span>
              <input
                disabled={isSaving || isDeleting}
                max="1"
                min="0"
                onChange={(event) => updateSettings('denoise', event.target.value)}
                onClick={stopInputEvent}
                onKeyDown={stopInputEvent}
                onPointerDown={stopInputEvent}
                placeholder="0.75"
                step="0.05"
                type="number"
                value={settings.denoise}
              />
            </label>
          </>
        )}

        <div className="cowart-config-actions">
          <span className="cowart-config-message">{message}</span>
          {isEditing && (
            <button
              className="cowart-config-delete"
              disabled={isSaving || isDeleting}
              onClick={(event) => {
                event.preventDefault()
                removeProfile()
              }}
              type="button"
            >
              {isDeleting ? '删除中…' : '删除画像'}
            </button>
          )}
          <button className="cowart-config-cancel" onClick={onClose} type="button">
            取消
          </button>
          <button disabled={isSaving || isDeleting} type="submit">
            保存
          </button>
        </div>
      </form>
    </div>
  )

  return createPortal(dialog, document.body)
}
