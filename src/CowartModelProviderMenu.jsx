import { useCallback, useEffect, useState } from 'react'
import {
  DefaultMainMenu,
  DefaultMainMenuContent,
  TldrawUiMenuGroup,
  TldrawUiMenuSubmenu
} from 'tldraw'
import {
  loadCowartModelPreferences,
  loadCowartProfiles,
  saveCowartModelPreferences
} from './cowartClient.js'
import { CowartProviderConfigDialog, profileTypeLabel } from './CowartProviderConfigDialog.jsx'

function useCowartImageProvider() {
  const [preferences, setPreferences] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [isSaving, setIsSaving] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [loadedPreferences, loadedProfiles] = await Promise.all([
        loadCowartModelPreferences(),
        loadCowartProfiles()
      ])
      setPreferences(loadedPreferences)
      setProfiles(Array.isArray(loadedProfiles) ? loadedProfiles : [])
    } catch {
      // Keep defaults when preferences or profiles are not available.
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const selectedProfileId = preferences?.imageProvider === 'openai' ? null : preferences?.imageProfileId ?? null

  const selectDefault = useCallback(async () => {
    setIsSaving(true)
    try {
      await saveCowartModelPreferences({
        version: 1,
        imageProvider: 'openai',
        imageModel: 'openai',
        imageProfileId: null,
        updatedAt: new Date().toISOString()
      })
      setPreferences((current) => ({
        ...(current ?? {}),
        imageProvider: 'openai',
        imageModel: 'openai',
        imageProfileId: null
      }))
    } finally {
      setIsSaving(false)
    }
  }, [])

  const selectProfile = useCallback(
    async (profile) => {
      setIsSaving(true)
      try {
        await saveCowartModelPreferences({
          version: 1,
          imageProvider: profile.provider,
          imageModel: profile.settings?.model || null,
          imageProfileId: profile.id,
          updatedAt: new Date().toISOString()
        })
        setPreferences((current) => ({
          ...(current ?? {}),
          imageProvider: profile.provider,
          imageModel: profile.settings?.model || null,
          imageProfileId: profile.id
        }))
      } finally {
        setIsSaving(false)
      }
    },
    []
  )

  return { profiles, selectedProfileId, isSaving, selectDefault, selectProfile, reload }
}

export function CowartMainMenu(props) {
  const [dialog, setDialog] = useState(null)
  const [menuKey, setMenuKey] = useState(0)

  return (
    <>
      <DefaultMainMenu {...props}>
        <DefaultMainMenuContent />
        <TldrawUiMenuGroup id="cowart-model-provider">
          <CowartImageProviderMenu key={menuKey} onOpenDialog={(next) => setDialog(next)} />
        </TldrawUiMenuGroup>
      </DefaultMainMenu>
      {dialog && (
        <CowartProviderConfigDialog
          defaultProvider={dialog.provider}
          onClose={() => setDialog(null)}
          onSaved={() => setMenuKey((current) => current + 1)}
          profile={dialog.profile ?? null}
        />
      )}
    </>
  )
}

function CowartImageProviderMenu({ onOpenDialog }) {
  const { profiles, selectedProfileId, isSaving, selectDefault, selectProfile, reload } =
    useCowartImageProvider()

  return (
    <TldrawUiMenuSubmenu id="cowart-model-provider" label="模型选择">
      <TldrawUiMenuGroup id="cowart-model-provider-options">
        <button
          className="tlui-button tlui-button__menu tlui-button__checkbox cowart-provider-menu-item"
          disabled={isSaving}
          onClick={selectDefault}
          type="button"
        >
          <span className="cowart-provider-menu-check">{selectedProfileId === null ? '✓' : ''}</span>
          <span className="tlui-button__label cowart-provider-menu-label">Codex 默认</span>
        </button>

        {profiles.map((profile) => (
          <button
            className="tlui-button tlui-button__menu tlui-button__checkbox cowart-provider-menu-item"
            disabled={isSaving}
            key={profile.id}
            onClick={() => selectProfile(profile)}
            type="button"
          >
            <span className="cowart-provider-menu-check">{selectedProfileId === profile.id ? '✓' : ''}</span>
            <span className="tlui-button__label cowart-provider-menu-label">
              {profile.name}
              <span className="cowart-provider-menu-type">{profileTypeLabel(profile.provider)}</span>
            </span>
            <span
              className="cowart-provider-menu-config"
              onClick={(event) => {
                event.stopPropagation()
                onOpenDialog({ profile })
              }}
              role="button"
              tabIndex={0}
            >
              配置
            </span>
          </button>
        ))}
      </TldrawUiMenuGroup>

      <TldrawUiMenuGroup id="cowart-model-provider-add">
        <button
          className="tlui-button tlui-button__menu cowart-provider-menu-item"
          onClick={() => onOpenDialog({ profile: null, provider: 'custom' })}
          type="button"
        >
          <span className="tlui-button__label cowart-provider-menu-label">添加画像…</span>
        </button>
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
}
