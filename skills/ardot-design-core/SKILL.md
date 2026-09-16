---
name: ardot-design-core
description: Shared Ardot Remote MCP workflow, schema, layout rules, components, variables, and visual verification. Use with an Ardot domain skill when creating or editing Ardot designs in Cowart.
---

# Ardot Design Core

Read [Codex compatibility](references/codex-compatibility.md) first. It defines the runtime contract for all bundled Ardot references.

## Preparation and workflow

1. Use the user's existing design URL for edits; create a design only when a new design is requested. Inspect live tool schemas. Retain the exact returned fileUrl and pass it to every tool that requires it. Reuse the returned file rather than creating duplicates.
2. Read file/editor state to obtain real page and node IDs, including on newly created files. Do not assume a fixed page ID or wait for WorkBuddy-only context events. If the server reports loading, retry the read, not creation.
3. Read [schema](references/ardot-schema.md), [editing rules](rules/design-rules.md), and the relevant sibling domain SKILL.md. Load the live editor schema once when needed; omit repeated schema payloads only after reading it.
4. Respect the user's style and language. Choose a coherent palette, typography, hierarchy, and spacing. [Style guide](rules/style-guide.md) and live search_style_guide/build_style_guide are optional inspiration when no visual direction was supplied.
5. Before inserting root nodes, call locate_available_space. For changes to existing nodes, inspect their structure and preserve unrelated content.
6. Read [batch editing](tool-usage/batch-edit.md) before batch_edit. Keep each call within 25 operations. Use actual node IDs and exact available font family/style strings. Keep text editable.
7. Use capture_layout for structural checks. Screenshot completed sections in batches within the live tool's quota; inspect all issues together before a correction batch. Download verification images into a task-specific workspace subdirectory.
8. Return the editable Ardot link and verified exports requested by the user. Cowart poster insertion is handled by [cowart-ardot-poster](../cowart-ardot-poster/SKILL.md); load its export/insertion steps without creating a second design.

## Conditional references

- Components/instances/variants: [component guide](func-rule/component-instance/GUIDE.md).
- Variable binding or theme modes: [variables](func-rule/design-variables/GUIDE.md) and [apply_variables](tool-usage/apply-variables.md).
- Shared text/paint/effect styles: [shared styles](func-rule/shared-styles/GUIDE.md).
- Shadows, blur, gradients: [effects](rules/effects-guide.md).
- Operation examples: [workflows](workflows/ardot-workflow.md).
- Scene catalogs: scenes.json / scenes-en.json, only when scene-specific examples are useful.

Do the canvas work in the current conversation. User choices take precedence over template aesthetics and optional planning conventions.
