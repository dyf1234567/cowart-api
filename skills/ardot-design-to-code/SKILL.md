---
name: ardot-design-to-code
description: Convert Ardot designs into frontend code, or extract website styles and tokens into an Ardot design guide. Use when an Ardot design is the source or destination of the conversion.
---

# Ardot Design to Code

Read [core](../ardot-design-core/SKILL.md) and its Codex compatibility contract first.

- Design to implementation: [conversion workflow](workflows/design-to-code-workflow.md) and [code guidelines](references/guidelines-code.md). Read [Tailwind guidance](references/guidelines-tailwind.md) only when using Tailwind.
- Website to Ardot design guide: [extraction workflow](workflows/extract-style-guide-from-web.md). Use the active browser skill for browser interaction.

Honor an existing project's framework, conventions and requested output. For a standalone artifact without a specified stack, a plain HTML/CSS/JS deliverable is a reasonable stated default. Ask only about consequential unresolved choices; do not impose a repeated confirmation dialog.

Read real node/style data, preserve text and layout in code, and export only assets that need to be images or vectors. The live export_nodes returns URLs; download those exact URLs to local asset files. It does not accept the legacy outputDir argument. Use batch_read properties, not an invented fullData flag.

Run appropriate build and browser checks for the requested implementation. Do not publish, deploy or upload local/private website data unless included in the user's request.
