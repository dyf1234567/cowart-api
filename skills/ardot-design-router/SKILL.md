---
name: ardot-design-router
description: Route explicitly Ardot-based creation and source-layer editing to UI, slides, poster, or design-to-code. Do not route bitmap annotation edits into Ardot merely because the image or selected provider originated there.
---

# Ardot Design Router

## Cowart edit modes

- `bitmap-edit` / 图片标注编辑: use `cowart-image-edit`, not Ardot tools. The image provider choice cannot override this explicit operation.
- `ardot-edit` / Ardot 源文件编辑: require the selected image's `meta.cowartArdotSource.fileUrl` and `nodeId` or an explicit user-supplied source. Verify access and node existence with live Ardot tools. Do not infer a file from the screenshot. Preserve the source node, edit a duplicate, verify/export it, insert a new image beside the original and bind that new image to the duplicate's actual fileUrl/nodeId.
- Missing source binding: request the actual file and frame; do not pretend a raster is an editable design. Only create a reconstruction when explicitly requested and label it as such.
- All Ardot exports inserted in Cowart (poster, UI, slide) must set `shapeMeta.cowartArdotSource` with the actual exported fileUrl/nodeId. Cowart shows a bitmap preview, not native Ardot layers.
- `image-to-ardot-poster`: use the clean selected image as material in a new poster, not as an editable source. Follow cowart-ardot-poster's image import and separate material-provider workflow. Ardot UI/slides/source edits may use that same explicitly selected material provider without switching the design workflow away from Ardot.
- For Cowart AI HTML/UI or Slides routed to Ardot, return exported image previews with bindings; do not claim those previews are HTML embeds or Cowart's HTML presentation player.

Read [core](../ardot-design-core/SKILL.md), then the single best matching domain entrypoint using the file-reading tool. Codex does not provide WorkBuddy's Skill(name) call or automatic companion injection.

| Requested result | Skill |
|---|---|
| Interface, landing page, dashboard, mobile screen, components or tokens | [UI design](../ardot-ui-design/SKILL.md) |
| Ardot presentation/deck | [Slides](../ardot-slides/SKILL.md) |
| Poster, banner, cover, livestream promotion, logo or illustration | [Poster](../ardot-poster/SKILL.md) |
| Design to frontend code, website style/token extraction | [Design to code](../ardot-design-to-code/SKILL.md) |

For a Cowart poster, use [cowart-ardot-poster](../cowart-ardot-poster/SKILL.md) as the outer workflow and the poster/core skills as design guidance. Do not invoke a missing livestream-poster skill. Keep the user's selected design node as the primary target.

Ask one concise question only when the desired deliverable cannot be inferred. Ordinary coding or PowerPoint requests should not be redirected into Ardot unless the user chose Ardot.
