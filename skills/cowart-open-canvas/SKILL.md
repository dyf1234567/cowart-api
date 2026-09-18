---
name: cowart-open-canvas
description: Open or reuse one project-scoped Cowart web canvas. Use when the user asks to open, launch, view, or work in Cowart. Open the native widget instead only when explicitly requested.
---

# Open one Cowart canvas

## Choose one surface

Default to the local web canvas, which supports automatic task execution. Do not also call `render_cowart_canvas_widget`. If the user explicitly requests the native widget, call that tool with the active user workspace as `projectDir` and do not start or open the web canvas. Open both only when the user asks for both.

## Reuse the correct project service

Resolve the active user workspace, not the plugin repository. The plugin root is two levels above this file. From that root, run:

```text
node scripts/probe-local-canvas.mjs --project <absolute-user-project> --url http://127.0.0.1:43217/
```

The helper obtains the same-origin capability from the HTML without printing it, then reads `/api/canvas` and verifies both `projectDir` and `canvasDir`.

- `ready`: reuse the returned URL. Do not start another server.
- `offline` (exit 3): start the local service for that project on this exact port.
- `mismatch`, `incompatible`, or other errors: do not reuse that server, stop it, or silently increment the port. Explain the conflict and ask which project/port to use. A 403 is not proof that the service is absent.

If the user already has a Cowart tab at a different local port, probe that exact URL first. Do not scan unrelated ports.

## Start only when offline

Ensure plugin dependencies are available. Use the plugin's `node_modules/vite/bin/vite.js`, with the plugin root as the working directory, `--host 127.0.0.1 --port 43217 --strictPort`. Set `COWART_PROJECT_DIR` to the active user workspace and `COWART_CANVAS_DIR` to its `canvas` directory. Preserve an explicitly requested custom canvas directory by passing it to the probe's `--canvas` option too.

On Windows use `Start-Process -WindowStyle Hidden` with the actual Node executable and fixed Vite argument list; do not open a console window. On other systems keep the process running in the background. Do not disable sandboxing or approvals. Probe again after startup; only report success when identity validation succeeds. Port contention must fail, not move to another port automatically.

## Open or focus one browser tab

Use the installed Browser skill for browser setup and navigation; do not embed a separate browser bootstrap here. Inspect its tab list for the verified exact URL. Reuse/focus that tab without reloading it. If none exists, open one new tab; do not navigate an unrelated selected tab away from the user's work. If browser control is unavailable, return the verified URL rather than opening another surface or spawning more servers.

Do not close unrelated or pre-existing tabs automatically. Explain that old widgets from earlier conversations may remain visible; the new workflow does not open another widget.

The canvas stores data under `canvas/pages/<page-id>/`. The web task panel shows execution progress; each task needs confirmation and uses the selected services. Native widget bridge errors should be reported, not silently converted into another window.
