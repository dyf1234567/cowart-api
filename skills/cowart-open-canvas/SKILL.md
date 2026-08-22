---
name: cowart-open-canvas
description: Open the native Cowart Codex widget together with the local Cowart web canvas. Use when the user asks to open, launch, view, or work in the Cowart canvas or wants an infinite canvas inside Codex.
---

# Cowart Open Canvas

## Workflow

1. Use the Cowart MCP `render_cowart_canvas_widget` tool to open the canvas as a native Codex widget. Pass the user's active Codex workspace as `projectDir`; do not pass the Cowart plugin repository directory.

```json
{
  "projectDir": "/absolute/path/to/user/codex-project"
}
```

The tool returns `openai/outputTemplate: ui://widget/cowart/canvas.html`, which tells Codex to render the widget directly.

2. The widget routes its write tool calls through the Codex host proxy, and some Codex versions reject those calls with `-32000 MCP proxy request failed`. The local web service does not have this problem because its `/api` endpoints are same-origin with the page. Always start the local service and open it alongside the widget.

First probe whether the service is already running:

```text
GET http://127.0.0.1:43217/api/profiles
```

If it responds, reuse it. Otherwise start it in the background from the Cowart plugin root (the directory that contains `package.json`, two levels above this SKILL.md), keeping the process running, with the user's active Codex workspace as the project directory:

```bash
# bash / macOS / Linux
COWART_PROJECT_DIR=/absolute/path/to/user/codex-project npm run dev
```

```powershell
# Windows PowerShell
$env:COWART_PROJECT_DIR = "C:\absolute\path\to\user\codex-project"; npm run dev
```

Run `npm install` first if `node_modules` is missing. The default URL is `http://127.0.0.1:43217/`; if the service output prints a different `Local:` URL (the port increments when 43217 is taken), use that actual URL instead.

3. Open the resulting local URL in the Codex in-app browser when the Browser tool chain is available. Use the Browser plugin's `control-in-app-browser` skill as the source of truth for opening the in-app browser. The correct model-side flow is:

   1. Use tool discovery for the Node REPL JavaScript execution tool if it is not already visible. The required callable tool is the `js` execution tool, commonly exposed as `mcp__node_repl__js`; `js_reset` and `js_add_node_module_dir` are not sufficient for browser control.
   2. In a fresh Node REPL session, bootstrap the Browser runtime with the Browser plugin's packaged client. Resolve `browser-client.mjs` from the current environment's `CODEX_HOME` (default `~/.codex`) so the skill does not depend on a specific username or plugin version:

```js
const os = await import("node:os");
const path = await import("node:path");
const fs = await import("node:fs/promises");

const homeDir = nodeRepl.homeDir ?? os.homedir();
const codexHome = globalThis.process?.env?.CODEX_HOME ?? path.join(homeDir, ".codex");
const browserRoot = path.join(codexHome, "plugins", "cache", "openai-bundled", "browser");
const versions = (await fs.readdir(browserRoot)).sort();
const browserClientPath = path.join(browserRoot, versions.at(-1), "scripts", "browser-client.mjs");

const { setupBrowserRuntime } = await import(browserClientPath);
await setupBrowserRuntime({ globals: globalThis });
globalThis.browser = await agent.browsers.get("iab");
nodeRepl.write(await browser.documentation());
```

   3. Select or create a tab, make the browser visible because this skill is meant to open the canvas for the user, and navigate with `tab.goto(url)`:

```js
await (await browser.capabilities.get("visibility")).set(true);
let selectedTab = null;
try {
  selectedTab = await browser.tabs.selected();
} catch (error) {
  if (!String(error?.message ?? error).includes("No active tab")) throw error;
}
globalThis.tab = selectedTab ?? await browser.tabs.new();
if ((await tab.url()) !== url) {
  await tab.goto(url);
}
```

Do not call `tab.goto(url)` if the selected tab is already on the Cowart URL; that reloads the page and can disturb work in progress. If browser control is unavailable, or browser bootstrap fails before navigation with a tool-layer/session-metadata error such as `codex/sandbox-state-meta: missing field sandboxPolicy`, treat the service start as successful and give the user the local URL instead of retrying browser control.

4. Confirm both surfaces are open for the user, and tell them they share the same canvas data:

```text
canvas/pages/<page-id>/cowart-canvas.json
canvas/pages/<page-id>/assets/
```

Saving profiles, provider configs, and canvas snapshots always works in the local web page; use it whenever the widget reports a save failure. If the MCP tool is not visible in the current session, use tool discovery for Cowart widget/render capabilities. If the plugin was just installed or upgraded, tell the user a new Codex conversation may be required for the new MCP tool schema to load.

## Constraints

Keep the local web service running for the whole session; do not stop it after opening the page. Do not inspect canvas files, run builds, check storage layout, take screenshots, or perform other validation steps unless opening the canvas fails or the user explicitly asks for those checks.
