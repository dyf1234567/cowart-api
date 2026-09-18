export function resolveImageProfile(preferences, profiles) {
  const provider = preferences?.imageProvider
  if (!provider || provider === 'openai') return null
  const id = preferences.imageProfileId
  const profile = id
    ? profiles.find((item) => item.id === id)
    : profiles.find((item) => item.provider === provider && (!preferences.imageModel || item.settings?.model === preferences.imageModel))
  if (!profile || profile.provider !== provider) {
    throw new Error('所选图片配置不存在或与提供方不匹配，请重新选择配置；不会自动切换提供方。')
  }
  return profile
}

export function ardotSource(meta = {}) {
  const source = meta.cowartArdotSource
  if (!source || typeof source.fileUrl !== 'string' || typeof source.nodeId !== 'string') return null
  try {
    const url = new URL(source.fileUrl)
    if (url.origin !== 'https://ardot.tencent.com' || !/^\/file\/[^/]+\/?$/.test(url.pathname) || !source.nodeId.trim()) return null
    return { fileUrl: url.href, nodeId: source.nodeId.trim() }
  } catch { return null }
}

export function ardotAssetInstructions(profile, profiles) {
  const id = profile?.provider === 'ardot' ? profile.settings?.imageProfileId : profile?.id
  const lines = ['Ardot 负责可编辑文字、布局和图层；素材生图是独立步骤，不是放弃 Ardot 的回退。优先复用用户提供的图片，只在任务需要时生成素材。']
  if (!id) return [...lines, '未选择素材生图服务。使用现有图片；确实缺少素材时请用户选择服务，不自动调用其他 API。']
  if (id === 'openai') return [...lines, '素材服务：明确选择 Codex 图片生成。生成所需背景或主体图，保留需要编辑的海报文字给 Ardot 排版。']
  const selected = profiles.find((item) => item.id === id)
  const scripts = { dashscope: 'generate-dashscope-image.mjs', custom: 'generate-custom-api-image.mjs', comfyui: 'generate-comfyui-image.mjs' }
  if (!selected || !scripts[selected.provider]) throw new Error('Ardot 素材生图配置不存在或不是位图服务，请重新选择；不会递归调用 Ardot 或静默切换 API。')
  return [...lines,
    profile?.provider === 'ardot'
      ? `素材服务：${selected.provider}，画像 ID ${JSON.stringify(id)}。运行插件 scripts/generate-ardot-material.mjs --ardot-profile ${JSON.stringify(profile.id)} --prompt <素材需求>；图生图时追加 --reference <源图片路径>。该脚本按 Ardot 配置调用 ${scripts[selected.provider]} 并隔离环境变量覆盖。`
      : `素材服务：${selected.provider}，画像 ID ${JSON.stringify(id)}。需要新素材时运行插件 scripts/${scripts[selected.provider]} --profile ${JSON.stringify(id)} --prompt <素材需求>；图生图时追加 --reference <源图片路径>。`,
    '使用脚本返回的 outputPath，检查图片后通过实时 Ardot upload_images/register_assets 工具导入。不得把 API Key 或 OAuth token 写进提示词或设计文件。失败时停止，不更换服务。'
  ]
}

export function ardotEditInstructions(source, shapeId) {
  if (!source) throw new Error('缺少 Ardot 文件和节点绑定，不能从位图推断源文件。')
  return [
    '编辑模式：ardot-edit。使用 ardot-design-router 和 ardot-design-core，不使用 cowart-image-edit 或位图重绘。',
    `Ardot source: ${JSON.stringify(source)}`,
    `Cowart source image shape: ${shapeId}`,
    '先通过 Ardot 工具验证文件权限和节点存在，再读取源图层。截图只用于理解标注，不能用截图重绘冒充源文件编辑。',
    '保留源节点；复制目标节点为新版本，在副本上修改文字、图层和布局。不要修改同文件中的其他设计。',
    '验证并导出修改后的副本，使用 insert_cowart_image 放到源图片右侧，replaceAiImageHolder:false，保留原图和标注。',
    '新图片 shapeMeta.cowartArdotSource 必须包含实际 fileUrl 和副本 nodeId；不要沿用旧节点 id。',
    'OAuth、节点或导出不可用时明确报错，不要切换图片生成服务。'
  ]
}

export function ardotCreationInstructions(kind, shapeId, pageCount = 1) {
  const domain = kind === 'slides' ? 'ardot-slides' : 'ardot-ui-design'
  return [
    `生成模式：Ardot ${kind}。读取 ${domain} 与 ardot-design-core，创建可编辑设计，不走 HTML 生成流程。`,
    `Cowart anchorShapeId: ${shapeId}; required output count: ${pageCount}.`,
    '读取目标 Cowart shape 的尺寸；UI 按目标纵横比设计，Slides 按 16:9 设计。',
    '验证设计后按页导出 PNG，下载实际返回的导出文件，用 insert_cowart_image 插入 Cowart。Cowart 中是位图预览，图层编辑在 Ardot。',
    '保留原占位框；第一张以该框为 anchorShapeId，后续以刚插入的 shapeId 为锚点，placement:right，matchAnchor:false，replaceAiImageHolder:false；不要重叠或拉伸。',
    '每張输出设置 shapeMeta.cowartArdotSource={fileUrl:<实际文件URL>,nodeId:<实际导出节点ID>}，并返回可编辑文件链接。',
    'OAuth 未授权、工具或导出不可用时停止并明确说明，不回退 HTML、默认生图或其他服务。'
  ]
}
