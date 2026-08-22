import assert from 'node:assert/strict'

import { createCowartAnalytics, sendTrackedWidgetMessage } from '../src/analytics.js'

const appendedScripts = []
const windowObject = {
  cowartMcp: {},
  dataLayer: [],
  location: { search: '?cowart_analytics_debug=1' }
}
const documentObject = {
  head: {
    append(script) {
      appendedScripts.push(script)
    }
  },
  createElement(tagName) {
    assert.equal(tagName, 'script')
    return {}
  },
  getElementById() {
    return null
  }
}

const analytics = createCowartAnalytics({
  windowObject,
  documentObject,
  measurementId: 'G-COWARTTEST',
  appVersion: 'test-version',
  debugMode: true
})

assert.equal(analytics.trackCanvasOpened(), true)
assert.equal(analytics.trackCanvasOpened(), false, 'canvas_opened should be emitted once per widget load')
analytics.trackAnnotationCreated()
analytics.trackAiGenerationRequested({ aiType: 'slides', hasReference: true, pageCount: 5 })
analytics.trackWidgetPromptSent({ promptType: 'ai_slides', hasReference: true })

assert.equal(appendedScripts.length, 1)
assert.equal(
  appendedScripts[0].src,
  'https://www.googletagmanager.com/gtag/js?id=G-COWARTTEST'
)

const commands = windowObject.dataLayer.map((command) => Array.from(command))
const configCommand = commands.find(([command]) => command === 'config')
assert.ok(configCommand, 'Google tag config command should be queued')
assert.equal(configCommand[2].send_page_view, false)
assert.equal(configCommand[2].page_location, 'https://www.jiqiren.ai/cowart-widget')
assert.equal(configCommand[2].allow_google_signals, true)
assert.equal(configCommand[2].allow_ad_personalization_signals, true)
assert.equal(configCommand[2].cookie_flags, 'SameSite=None;Secure')
assert.equal(configCommand[2].cookie_update, true)

const consentCommand = commands.find(([command]) => command === 'consent')
assert.ok(consentCommand, 'Consent defaults should be queued before analytics events')
for (const consentType of [
  'analytics_storage',
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
  'functionality_storage',
  'personalization_storage',
  'security_storage'
]) {
  assert.equal(consentCommand[2][consentType], 'granted', `${consentType} should be granted`)
}

const events = commands
  .filter(([command]) => command === 'event')
  .map(([_command, eventName, parameters]) => ({ eventName, parameters }))
assert.deepEqual(events.map(({ eventName }) => eventName), [
  'canvas_opened',
  'annotation_created',
  'ai_generation_requested',
  'widget_prompt_sent'
])
assert.equal(events[2].parameters.ai_type, 'slides')
assert.equal(events[2].parameters.page_count, 5)
assert.equal(events[3].parameters.prompt_type, 'ai_slides')
assert.ok(events.every(({ parameters }) => parameters.debug_mode === true))
assert.ok(events.every(({ parameters }) => parameters.send_to === 'G-COWARTTEST'))

function collectObjectKeys(value, keys = new Set()) {
  if (!value || typeof value !== 'object') return keys
  for (const [key, child] of Object.entries(value)) {
    keys.add(key)
    collectObjectKeys(child, keys)
  }
  return keys
}

const analyticsFieldNames = collectObjectKeys(commands)
for (const forbiddenField of ['prompt', 'content', 'shapeId', 'projectDir', 'canvasDir']) {
  assert.equal(analyticsFieldNames.has(forbiddenField), false, `Analytics must not contain ${forbiddenField}`)
}

const dispatchOrder = []
let completeHostMessage
const hostMessageResult = new Promise((resolve) => {
  completeHostMessage = resolve
})
const trackedMessageResult = sendTrackedWidgetMessage(
  () => {
    dispatchOrder.push('host-called')
    return hostMessageResult
  },
  { prompt: 'never include this in analytics' },
  {
    promptType: 'ai_image',
    aiType: 'image',
    hasReference: true
  },
  {
    onWidgetPromptSent(parameters) {
      dispatchOrder.push([
        'widget-prompt',
        {
          promptType: parameters.promptType,
          hasReference: parameters.hasReference,
          hasCallback: typeof parameters.eventCallback === 'function'
        }
      ])
      return true
    },
    onAiGenerationRequested(parameters) {
      dispatchOrder.push([
        'ai-generation',
        {
          aiType: parameters.aiType,
          hasReference: parameters.hasReference,
          pageCount: parameters.pageCount,
          hasCallback: typeof parameters.eventCallback === 'function',
          eventTimeout: parameters.eventTimeout
        }
      ])
      parameters.eventCallback()
      return true
    }
  }
)

assert.deepEqual(dispatchOrder, [
  ['widget-prompt', { promptType: 'ai_image', hasReference: true, hasCallback: false }],
  [
    'ai-generation',
    {
      aiType: 'image',
      hasReference: true,
      pageCount: undefined,
      hasCallback: true,
      eventTimeout: 1200
    }
  ]
])
await Promise.resolve()
assert.equal(dispatchOrder.at(-1), 'host-called', 'host bridge must run after analytics dispatch')
completeHostMessage('sent')
assert.equal(await trackedMessageResult, 'sent')

const annotationDispatchOrder = []
const annotationResult = sendTrackedWidgetMessage(
  () => {
    annotationDispatchOrder.push('host-called')
    return 'sent'
  },
  { prompt: 'annotation edit' },
  { promptType: 'annotation_edit', hasReference: true },
  {
    onWidgetPromptSent(parameters) {
      annotationDispatchOrder.push('analytics-dispatched')
      assert.equal(typeof parameters.eventCallback, 'function')
      parameters.eventCallback()
      return true
    }
  }
)
await Promise.resolve()
assert.deepEqual(annotationDispatchOrder, ['analytics-dispatched', 'host-called'])
assert.equal(await annotationResult, 'sent')

const mcpCalls = []
const mcpStoredValues = new Map()
let mcpEventCallbackCompleted = false
const mcpWindowObject = {
  cowartMcp: {
    callServerTool(call) {
      mcpCalls.push(call)
      return Promise.resolve({
        structuredContent: {
          configured: true,
          delivered: true,
          status: 204
        }
      })
    }
  },
  crypto: {
    getRandomValues(values) {
      values[0] = 123456789
      return values
    }
  },
  localStorage: {
    getItem(key) {
      return mcpStoredValues.get(key) || null
    },
    setItem(key, value) {
      mcpStoredValues.set(key, value)
    }
  },
  location: { search: '' }
}
const mcpDocumentObject = {
  head: {
    append() {
      throw new Error('MCP analytics must not load gtag.js')
    }
  }
}
const mcpAnalytics = createCowartAnalytics({
  windowObject: mcpWindowObject,
  documentObject: mcpDocumentObject,
  appVersion: 'test-version',
  debugMode: false
})
mcpAnalytics.trackAiGenerationRequested({
  aiType: 'image',
  hasReference: false,
  eventCallback() {
    mcpEventCallbackCompleted = true
  }
})
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(mcpCalls.length, 1)
assert.equal(mcpCalls[0].name, 'track_cowart_analytics_event')
assert.match(mcpCalls[0].arguments.clientId, /^123456789\.\d+$/)
assert.equal(
  mcpStoredValues.get('cowart.analytics.client_id'),
  mcpCalls[0].arguments.clientId,
  'GA4 client id should be persisted for subsequent events'
)
assert.deepEqual({
  ...mcpCalls[0].arguments,
  clientId: '<numeric-client-id>'
}, {
  clientId: '<numeric-client-id>',
  eventName: 'ai_generation_requested',
  appVersion: 'test-version',
  parameters: {
    ai_type: 'image',
    has_reference: 'no'
  }
})
assert.equal(mcpEventCallbackCompleted, true)
assert.equal(mcpWindowObject.gtag, undefined)

console.log('Cowart analytics probe OK')
