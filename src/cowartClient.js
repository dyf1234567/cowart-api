const CANVAS_ENDPOINT = '/api/canvas'
const SELECTION_ENDPOINT = '/api/selection'
const VIEW_STATE_ENDPOINT = '/api/view-state'
const MODEL_PREFERENCES_ENDPOINT = '/api/model-preferences'
const PROVIDER_CONFIG_ENDPOINT = '/api/provider-config'
const PROFILES_ENDPOINT = '/api/profiles'

const TOOL_GET_CANVAS_STATE = 'get_cowart_canvas_state'
const TOOL_SAVE_CANVAS_STATE = 'save_cowart_canvas_state'
const TOOL_SAVE_SELECTION_STATE = 'save_cowart_selection_state'
const TOOL_SAVE_VIEW_STATE = 'save_cowart_view_state'
const TOOL_SAVE_REFERENCE_IMAGE = 'save_cowart_reference_image'
const TOOL_READ_PAGE_ASSET = 'read_cowart_page_asset'
const TOOL_DOWNLOAD_FILE = 'download_cowart_file'
const TOOL_COPY_IMAGE_TO_CLIPBOARD = 'copy_cowart_image_to_clipboard'
const TOOL_INSERT_HTML_DRAFT = 'insert_cowart_html_draft'
const TOOL_GET_MODEL_PREFERENCES = 'get_cowart_model_preferences'
const TOOL_SAVE_MODEL_PREFERENCES = 'save_cowart_model_preferences'
const TOOL_GET_PROVIDER_CONFIG = 'get_cowart_provider_config'
const TOOL_SAVE_PROVIDER_CONFIG = 'save_cowart_provider_config'
const TOOL_SAVE_PROFILE = 'save_cowart_provider_profile'
const TOOL_DELETE_PROFILE = 'delete_cowart_provider_profile'
const WIDGET_PAYLOAD_TIMEOUT_MS = 5000

globalThis.__COWART_WIDGET_FETCH_GUARD__ = true

export const IS_COWART_WIDGET_BUILD =
  typeof __COWART_WIDGET_BUILD__ !== 'undefined' && __COWART_WIDGET_BUILD__

export function hasCowartWidgetBridge() {
  return Boolean(window.cowartMcp && typeof window.cowartMcp.callServerTool === 'function')
}

function currentWidgetPayload() {
  return window.openai?.toolOutput && typeof window.openai.toolOutput === 'object'
    ? window.openai.toolOutput
    : {}
}

function hasWidgetStorageTarget() {
  const payload = currentWidgetPayload()
  return Boolean(payload.projectDir || payload.canvasDir)
}

function serverToolArgs(extra = {}) {
  const payload = currentWidgetPayload()
  return removeUndefined({
    projectDir: payload.projectDir,
    canvasDir: payload.canvasDir,
    ...extra
  })
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([_key, item]) => item !== undefined))
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

async function waitForWidgetPayload(signal) {
  if (!hasCowartWidgetBridge()) return
  if (hasWidgetStorageTarget()) return

  await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('Cowart widget storage target was not ready. Refusing to read or write without projectDir/canvasDir.'))
    }, WIDGET_PAYLOAD_TIMEOUT_MS)
    const cleanup = () => {
      window.clearTimeout(timer)
      window.removeEventListener('openai:set_globals', handleGlobals)
      signal?.removeEventListener('abort', handleAbort)
    }
    const finish = () => {
      cleanup()
      resolve()
    }
    const handleGlobals = () => {
      if (hasWidgetStorageTarget()) finish()
    }
    const handleAbort = () => {
      cleanup()
      reject(abortError())
    }

    window.addEventListener('openai:set_globals', handleGlobals, { once: true })
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

async function callCowartServerTool(name, args = {}, options = {}) {
  await waitForWidgetPayload(options.signal)
  if (options.signal?.aborted) throw abortError()
  const result = await window.cowartMcp.callServerTool({
    name,
    arguments: serverToolArgs(args)
  })
  if (result?.isError) {
    const message = result.content?.find((item) => item.type === 'text')?.text
    throw new Error(message || `Cowart server tool failed: ${name}`)
  }
  return result.structuredContent ?? result
}

async function fetchJson(url, options = {}) {
  const headers = new Headers(options.headers)
  const token = document.querySelector('meta[name="cowart-session"]')?.content
  if (token) headers.set('x-cowart-session', token)
  const response = await window.fetch(url, { ...options, headers })
  if (!response.ok) {
    throw new Error(`Cowart request failed: ${response.status} - ${response.statusText}`)
  }
  return response.json()
}

// Fail closed: an HTTP port is not proof of project identity or authorization.
async function httpFallback(_requestFactory, bridgeError) {
  throw new Error(`Cowart MCP 调用失败；为避免写错项目，已禁用跨端口回退。${bridgeError.message}`, { cause: bridgeError })
}

export async function loadCowartCanvasState(signal) {
  if (hasCowartWidgetBridge()) {
    const state = await callCowartServerTool(
      TOOL_GET_CANVAS_STATE,
      { hydrateAssets: false },
      { signal }
    )
    return {
      projectDir: state.projectDir,
      canvasDir: state.canvasDir,
      snapshot: state.snapshot,
      viewState: state.viewState ?? null,
      storage: state.storage,
      skippedRecords: []
    }
  }

  const [canvasData, viewStateData] = await Promise.all([
    fetchJson(CANVAS_ENDPOINT, { signal }),
    fetchJson(VIEW_STATE_ENDPOINT, { signal })
  ])
  return {
    projectDir: canvasData.projectDir,
    canvasDir: canvasData.canvasDir,
    snapshot: canvasData.snapshot,
    viewState: viewStateData.viewState ?? null,
    storage: canvasData.storage,
    skippedRecords: []
  }
}

export async function refreshCowartCanvasSnapshot(signal) {
  if (hasCowartWidgetBridge()) {
    const state = await callCowartServerTool(
      TOOL_GET_CANVAS_STATE,
      { hydrateAssets: false },
      { signal }
    )
    return state.snapshot
  }

  const canvasData = await fetchJson(CANVAS_ENDPOINT, { signal })
  return canvasData.snapshot
}

export async function saveCowartCanvasSnapshot(snapshot, options = {}) {
  if (hasCowartWidgetBridge()) {
    try {
      return await callCowartServerTool(TOOL_SAVE_CANVAS_STATE, {
        snapshot,
        protectImageRecords: options.protectImageRecords,
        acknowledgedImageShapeDeletes: options.acknowledgedImageShapeDeletes
      })
    } catch (bridgeError) {
      return httpFallback(
        (base) => fetchJson(`${base}${CANVAS_ENDPOINT}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(snapshot)
        }),
        bridgeError
      )
    }
  }

  return fetchJson(CANVAS_ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ snapshot, protectImageRecords: true, acknowledgedImageShapeDeletes: options.acknowledgedImageShapeDeletes ?? [] })
  })
}

export async function saveCowartSelectionState(selection) {
  if (hasCowartWidgetBridge()) {
    try {
      return await callCowartServerTool(TOOL_SAVE_SELECTION_STATE, { selection })
    } catch (bridgeError) {
      return httpFallback(
        (base) => fetchJson(`${base}${SELECTION_ENDPOINT}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(selection)
        }),
        bridgeError
      )
    }
  }

  return fetchJson(SELECTION_ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(selection)
  })
}

export async function saveCowartViewState(viewState) {
  if (hasCowartWidgetBridge()) {
    try {
      return await callCowartServerTool(TOOL_SAVE_VIEW_STATE, { viewState })
    } catch (bridgeError) {
      return httpFallback(
        (base) => fetchJson(`${base}${VIEW_STATE_ENDPOINT}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(viewState)
        }),
        bridgeError
      )
    }
  }

  return fetchJson(VIEW_STATE_ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(viewState)
  })
}

export async function saveCowartReferenceImage(reference) {
  if (!hasCowartWidgetBridge()) {
    return fetchJson('/api/reference-image', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reference)
    })
  }

  return callCowartServerTool(TOOL_SAVE_REFERENCE_IMAGE, reference)
}

export async function downloadCowartFile(download) {
  if (!hasCowartWidgetBridge()) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 文件下载桥。')
  }

  return callCowartServerTool(TOOL_DOWNLOAD_FILE, download)
}

export async function copyCowartImageToClipboard(image) {
  if (!hasCowartWidgetBridge()) {
    throw new Error('当前 Cowart 画布没有可用的系统剪贴板桥。')
  }

  return callCowartServerTool(TOOL_COPY_IMAGE_TO_CLIPBOARD, image)
}

export async function updateCowartHtmlDraft({ draftShapeId, htmlContent }) {
  if (!hasCowartWidgetBridge()) {
    return fetchJson('/api/html-draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftShapeId, htmlContent })
    })
  }

  try {
    return await callCowartServerTool(TOOL_INSERT_HTML_DRAFT, {
      draftShapeId,
      htmlContent,
      updateExistingDraft: true
    })
  } catch (bridgeError) {
    return httpFallback(
      (base) => fetchJson(`${base}/api/html-draft`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftShapeId, htmlContent })
      }),
      bridgeError
    )
  }
}

export async function readCowartPageAsset(assetUrl, options = {}) {
  if (!hasCowartWidgetBridge()) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 文件读取桥。')
  }

  return callCowartServerTool(TOOL_READ_PAGE_ASSET, { assetUrl }, options)
}

export async function loadCowartModelPreferences(signal) {
  if (hasCowartWidgetBridge()) {
    const result = await callCowartServerTool(TOOL_GET_MODEL_PREFERENCES, {}, { signal })
    return result.preferences ?? null
  }

  const payload = await fetchJson(MODEL_PREFERENCES_ENDPOINT, { signal })
  return payload.preferences ?? null
}

export async function saveCowartModelPreferences(preferences) {
  if (hasCowartWidgetBridge()) {
    try {
      return await callCowartServerTool(TOOL_SAVE_MODEL_PREFERENCES, { preferences })
    } catch (bridgeError) {
      return httpFallback(
        (base) => fetchJson(`${base}${MODEL_PREFERENCES_ENDPOINT}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(preferences)
        }),
        bridgeError
      )
    }
  }

  return fetchJson(MODEL_PREFERENCES_ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(preferences)
  })
}

export async function loadCowartProviderConfig(signal) {
  if (hasCowartWidgetBridge()) {
    const result = await callCowartServerTool(TOOL_GET_PROVIDER_CONFIG, {}, { signal })
    return result.config ?? null
  }

  const payload = await fetchJson(PROVIDER_CONFIG_ENDPOINT, { signal })
  return payload.config ?? null
}

export async function loadCowartProfiles(signal) {
  if (hasCowartWidgetBridge()) {
    const result = await callCowartServerTool(TOOL_GET_PROVIDER_CONFIG, {}, { signal })
    return result.profiles ?? []
  }

  const payload = await fetchJson(PROFILES_ENDPOINT, { signal })
  return payload.profiles ?? []
}

export async function saveCowartProfile(profile) {
  if (hasCowartWidgetBridge()) {
    try {
      return await callCowartServerTool(TOOL_SAVE_PROFILE, { profile })
    } catch (bridgeError) {
      return httpFallback(
        (base) => fetchJson(`${base}${PROFILES_ENDPOINT}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(profile)
        }),
        bridgeError
      )
    }
  }

  return fetchJson(PROFILES_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile)
  })
}

export async function deleteCowartProfile(profileId) {
  if (hasCowartWidgetBridge()) {
    try {
      return await callCowartServerTool(TOOL_DELETE_PROFILE, { profileId })
    } catch (bridgeError) {
      return httpFallback(
        (base) => fetchJson(`${base}${PROFILES_ENDPOINT}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ profileId })
        }),
        bridgeError
      )
    }
  }

  return fetchJson(PROFILES_ENDPOINT, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId })
  })
}

export async function saveCowartProviderConfig(configPatch) {
  if (hasCowartWidgetBridge()) {
    try {
      return await callCowartServerTool(TOOL_SAVE_PROVIDER_CONFIG, { config: configPatch })
    } catch (bridgeError) {
      return httpFallback(
        (base) => fetchJson(`${base}${PROVIDER_CONFIG_ENDPOINT}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(configPatch)
        }),
        bridgeError
      )
    }
  }

  return fetchJson(PROVIDER_CONFIG_ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(configPatch)
  })
}
