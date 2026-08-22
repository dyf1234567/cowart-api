import { useCallback, useEffect, useState } from 'react'
import {
  DefaultMainMenu,
  DefaultMainMenuContent,
  TldrawUiMenuGroup,
  TldrawUiMenuSubmenu
} from 'tldraw'
import { loadCowartModelPreferences, saveCowartModelPreferences } from './cowartClient.js'
import { CowartProviderConfigDialog } from './CowartProviderConfigDialog.jsx'

export const IMAGE_PROVIDER_OPTIONS = [
  { id: 'openai', label: 'Codex 默认', model: 'openai' },
  { id: 'dashscope', label: '阿里千问', model: 'wan2.7-image-pro' },
  { id: 'custom', label: '自定义 API', model: null },
  { id: 'comfyui', label: '本地 ComfyUI', model: null }
]

function useCowartImageProvider() {
  const [provider, setProvider] = useState('openai')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let isCancelled = false

    async function loadPreferences() {
      try {
        const preferences = await loadCowartModelPreferences()
        const nextProvider = preferences?.imageProvider
        if (!isCancelled && IMAGE_PROVIDER_OPTIONS.some((option) => option.id === nextProvider)) {
          setProvider(nextProvider)
        }
      } catch {
        // Keep OpenAI as the UI default when preferences are not available.
      }
    }

    loadPreferences()

    return () => {
      isCancelled = true
    }
  }, [])

  const saveProvider = useCallback(async (nextProvider) => {
    const option = IMAGE_PROVIDER_OPTIONS.find((item) => item.id === nextProvider) ?? IMAGE_PROVIDER_OPTIONS[0]
    setProvider(option.id)
    setIsSaving(true)

    try {
      await saveCowartModelPreferences({
        version: 1,
        imageProvider: option.id,
        imageModel: option.model,
        updatedAt: new Date().toISOString()
      })
    } catch {
      setProvider('openai')
    } finally {
      setIsSaving(false)
    }
  }, [])

  return { provider, isSaving, saveProvider }
}

export function CowartMainMenu(props) {
  const [configProvider, setConfigProvider] = useState(null)

  return (
    <>
      <DefaultMainMenu {...props}>
        <DefaultMainMenuContent />
        <TldrawUiMenuGroup id="cowart-model-provider">
          <CowartImageProviderMenu onConfigure={(providerId) => setConfigProvider(providerId)} />
        </TldrawUiMenuGroup>
      </DefaultMainMenu>
      {configProvider && (
        <CowartProviderConfigDialog
          onClose={() => setConfigProvider(null)}
          provider={configProvider}
        />
      )}
    </>
  )
}

function CowartImageProviderMenu({ onConfigure }) {
  const { provider, isSaving, saveProvider } = useCowartImageProvider()

  return (
    <TldrawUiMenuSubmenu id="cowart-model-provider" label="模型选择">
      <TldrawUiMenuGroup id="cowart-model-provider-options">
        {IMAGE_PROVIDER_OPTIONS.map((option) => (
          <button
            className="tlui-button tlui-button__menu tlui-button__checkbox cowart-provider-menu-item"
            disabled={isSaving}
            key={option.id}
            onClick={() => saveProvider(option.id)}
            type="button"
          >
            <span className="cowart-provider-menu-check">{provider === option.id ? '✓' : ''}</span>
            <span className="tlui-button__label cowart-provider-menu-label">{option.label}</span>
            {option.id !== 'openai' && (
              <span
                className="cowart-provider-menu-config"
                onClick={(event) => {
                  event.stopPropagation()
                  onConfigure(option.id)
                }}
                role="button"
                tabIndex={0}
              >
                配置
              </span>
            )}
          </button>
        ))}
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
}
