import { readFile } from "node:fs/promises";

import { pluginPath } from "./plugin-root.mjs";

export const COWART_GA4_MEASUREMENT_ID = "G-SJYHV19YZ9";
export const COWART_GA4_EVENT_NAMES = [
  "canvas_opened",
  "annotation_created",
  "ai_generation_requested",
  "widget_prompt_sent",
];

const ANALYTICS_LOCAL_CONFIG_PATH = pluginPath(".codex-plugin", "analytics.local.json");
const ANALYTICS_BUNDLED_CONFIG_PATH = pluginPath(".codex-plugin", "analytics.json");
const GA4_ENDPOINT = "https://www.google-analytics.com/mp/collect";
const GA4_REQUEST_TIMEOUT_MS = 5_000;
const SESSION_ID = Math.floor(Date.now() / 1000);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function apiSecretFromConfig(configPath) {
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    return nonEmptyString(config.apiSecret);
  } catch {
    return undefined;
  }
}

export async function cowartGa4ApiSecret() {
  return nonEmptyString(process.env.COWART_GA_API_SECRET)
    || await apiSecretFromConfig(ANALYTICS_LOCAL_CONFIG_PATH)
    || await apiSecretFromConfig(ANALYTICS_BUNDLED_CONFIG_PATH);
}

export function cowartGa4Payload({ clientId, eventName, parameters = {}, appVersion }) {
  return {
    client_id: clientId,
    timestamp_micros: String(Date.now() * 1000),
    non_personalized_ads: false,
    events: [
      {
        name: eventName,
        params: {
          session_id: SESSION_ID,
          engagement_time_msec: 1,
          debug_mode: 1,
          app_version: appVersion,
          app_surface: "codex_widget",
          source: "codex_plugin_mcp",
          ...parameters,
        },
      },
    ],
  };
}

export async function sendCowartGa4Event({
  clientId,
  eventName,
  parameters,
  appVersion,
  apiSecret,
  fetchImpl = globalThis.fetch,
}) {
  const resolvedSecret = nonEmptyString(apiSecret) || await cowartGa4ApiSecret();
  if (!resolvedSecret) {
    return { configured: false, delivered: false, status: null };
  }

  const endpoint = new URL(GA4_ENDPOINT);
  endpoint.searchParams.set("measurement_id", COWART_GA4_MEASUREMENT_ID);
  endpoint.searchParams.set("api_secret", resolvedSecret);

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cowartGa4Payload({ clientId, eventName, parameters, appVersion })),
    signal: AbortSignal.timeout(GA4_REQUEST_TIMEOUT_MS),
  });

  return {
    configured: true,
    delivered: response.ok,
    status: response.status,
  };
}
