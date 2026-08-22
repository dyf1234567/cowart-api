import assert from "node:assert/strict";

import {
  COWART_GA4_MEASUREMENT_ID,
  cowartGa4Payload,
  sendCowartGa4Event,
} from "../mcp/lib/ga4-analytics.mjs";

const payload = cowartGa4Payload({
  clientId: "123456789.1785751441",
  eventName: "widget_prompt_sent",
  appVersion: "test-version",
  parameters: {
    prompt_type: "annotation_edit",
    has_reference: "yes",
  },
});

assert.equal(payload.client_id, "123456789.1785751441");
assert.equal(payload.events[0].name, "widget_prompt_sent");
assert.equal(Number.isSafeInteger(payload.events[0].params.session_id), true);
assert.equal(payload.events[0].params.engagement_time_msec, 1);
assert.equal(payload.events[0].params.debug_mode, 1);
assert.equal(payload.events[0].params.prompt_type, "annotation_edit");
assert.equal(payload.events[0].params.has_reference, "yes");
assert.equal(Object.hasOwn(payload.events[0].params, "prompt"), false);

let capturedUrl;
let capturedRequest;
const result = await sendCowartGa4Event({
  clientId: "123456789.1785751441",
  eventName: "canvas_opened",
  appVersion: "test-version",
  apiSecret: "local-test-secret",
  async fetchImpl(url, request) {
    capturedUrl = new URL(url);
    capturedRequest = request;
    return { ok: true, status: 204 };
  },
});

assert.equal(capturedUrl.origin + capturedUrl.pathname, "https://www.google-analytics.com/mp/collect");
assert.equal(capturedUrl.searchParams.get("measurement_id"), COWART_GA4_MEASUREMENT_ID);
assert.equal(capturedUrl.searchParams.get("api_secret"), "local-test-secret");
assert.equal(capturedRequest.method, "POST");
assert.equal(capturedRequest.headers["content-type"], "application/json");
assert.equal(JSON.parse(capturedRequest.body).events[0].name, "canvas_opened");
assert.deepEqual(result, { configured: true, delivered: true, status: 204 });

console.log("Cowart GA4 Measurement Protocol probe OK");
