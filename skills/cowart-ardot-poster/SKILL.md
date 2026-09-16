---
name: cowart-ardot-poster
description: Create an editable marketing poster with Tencent Design Ardot Remote MCP, export the finished frame as a bitmap, and place it into the Cowart canvas. Use when the user asks for an Ardot poster in Cowart or when the selected Cowart provider profile is ardot.
---

# Cowart Ardot Poster

Create the poster in Tencent Design Ardot, keep the design editable there, export the final poster, and insert that exported bitmap into Cowart. Ardot is an OAuth-protected MCP service, not an OpenAI-compatible image API.

## Preconditions

- `ardot-remote` must resolve to `https://ardot.tencent.com/mcp`.
- The user must complete Ardot OAuth authorization with the `mcp:use` scope. Cowart never stores the OAuth access token.
- The Cowart canvas should be open. Use Cowart MCP tools to read selection and insert the final bitmap.
- Inspect every live Ardot tool schema before calling it. Ardot tools evolve; never invent argument names from this document.

If Ardot returns an authentication error, stop the Ardot workflow and ask the user to complete the official OAuth connection. Do not silently fall back to another image provider.

## Workflow

For design guidance, read the bundled `../ardot-design-core/SKILL.md` and `../ardot-poster/SKILL.md`. This skill owns the Cowart selection, file creation, export and insertion workflow; reuse the same Ardot file/frame when loading those companions.

1. Read the Cowart selection with `get_cowart_selection`.
   - If exactly one selected shape is an AI image holder, use its `props.w`, `props.h`, parent, position, rotation, and shape id as the target contract.
   - Otherwise use the requested poster size. If none is supplied, use a practical portrait poster ratio such as 3:4 and insert the result into a clear area of the current Cowart page.

2. Connect to Ardot and inspect current context.
   - For a new poster, call `create_design` with `fileName` and retain its returned file URL. Most remote tools require this exact `fileUrl`; do not call them without a target file.
   - Fetch `fetch_guidelines` with `topic: "posters"` before designing. Read the live instructions and editor schema.
   - Call the live `fetch_editor_state` and `fetch_file_info` tools when available.
   - If no writable design file is active, use the currently exposed Ardot tool for creating or opening a design file. If the live tool set has no such capability, report that an Ardot file must be opened; do not pretend a file was created.
   - Confirm write permission before editing.

3. Build an editable poster frame in Ardot.
   - Convert the Cowart target ratio to pixel dimensions that preserve the exact aspect ratio. Prefer a long edge around 1600 px unless the user requests another export size.
   - Use `search_style_guide`, `build_style_guide`, or other live design-system tools only when they materially help the requested style.
   - Use `locate_available_space` and `batch_edit` to create one poster Frame and its editable text, shape, and image layers. Keep a clear hierarchy and descriptive layer names.
   - Use `register_assets` and `upload_images` for real imagery according to the live schema. The current `G` operation creates labeled placeholders only; it does not generate images. Preserve requested visible copy as editable text layers whenever possible.
   - Keep each `batch_edit` call within Ardot's documented recommendation of no more than 25 operations.

4. Verify before export.
   - Audit all text nodes with `batch_read` and check layout with `capture_layout` before visual verification. Follow the live poster guidelines, including their font-size floor.
   - Use `capture_screenshot` on the poster Frame only after the complete batch of edits; obey its live quota (currently at most two calls per repair batch).
   - Inspect the screenshot for clipping, overlap, unreadable text, incorrect copy, and aspect-ratio mismatch.
   - Collect all detected problems and fix them together before the optional second capture. Do not run incremental screenshot loops or export an unverified first draft.

5. Export the poster Frame.
   - The verified remote schema takes `fileUrl`, `nodeIds`, `format`, and optional `scale` / `quality`. Use `scale: 1` when the Frame already has the required pixel dimensions.
   - Call `export_nodes` using its live schema and the format selected in the Ardot Cowart profile (`png` by default; `jpeg` or `webp` when configured).
   - Use the exact file, resource, or download URL returned by Ardot. If a URL is returned, download that specific result to a new timestamped local file. Never substitute a stale file.
   - Visually inspect the exported bitmap and confirm its dimensions and content.

6. Insert the exported bitmap into Cowart.
   - For a selected AI image holder, call `insert_cowart_image` with its id as `anchorShapeId` and leave `replaceAiImageHolder` unset or `true`.
   - Without a holder, call `insert_cowart_image` as a standalone image and use the exported poster's natural aspect ratio.
   - Preserve the holder dimensions and rotation. Do not stretch or crop the export.

7. Report both artifacts.
   - Confirm the Ardot design file/frame identifier and link when returned.
   - Confirm the Cowart image shape id, saved asset path, final dimensions, and replaced holder id when applicable.

## Failure handling

- OAuth or trust required: ask for authorization and stop; no provider fallback.
- No writable Ardot file and no create/open tool: ask the user to open or create an Ardot file.
- Export tool unavailable: keep the editable Ardot result and explain that Cowart insertion cannot finish until export is available.
- Export result is not locally retrievable: do not claim insertion succeeded; report the exact returned resource and the retrieval problem.
