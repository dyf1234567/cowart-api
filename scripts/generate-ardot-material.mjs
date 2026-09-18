#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findCowartProfile } from '../mcp/lib/canvas-storage.mjs';

// Resolve the material service independently from Ardot's design/OAuth service.
// No shell command construction and no credentials in argv or output.
const argv = process.argv.slice(2);
const index = argv.indexOf('--ardot-profile');
if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith('--')) {
  throw new Error('Usage: node scripts/generate-ardot-material.mjs --ardot-profile <id> --prompt <material brief> [--reference <path>] [--out-dir <path>]');
}
const ref = argv[index + 1];
argv.splice(index, 2);
if (argv.includes('--profile')) throw new Error('Select the material profile in the Ardot profile; do not supply --profile here.');
const design = await findCowartProfile(ref);
if (!design || design.provider !== 'ardot') throw new Error('The selected Ardot profile does not exist.');
const materialId = design.settings.imageProfileId;
if (!materialId) throw new Error('No material generator selected. Use existing assets or select one in the Ardot profile.');
if (materialId === 'openai') throw new Error('Codex image generation is a host tool, not a CLI API. Use the available image-generation tool explicitly.');
const material = await findCowartProfile(materialId);
const scripts = { custom: 'generate-custom-api-image.mjs', dashscope: 'generate-dashscope-image.mjs', comfyui: 'generate-comfyui-image.mjs' };
if (!material || !scripts[material.provider]) throw new Error('The material profile must be an existing bitmap service, not Ardot.');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(COWART_CUSTOM_|CUSTOM_API_KEY$|DASHSCOPE_|COWART_DASHSCOPE_|COWART_IMAGE_MODEL$|COMFYUI_)/i.test(key)) delete env[key];
}
const child = spawn(process.execPath, [fileURLToPath(new URL(scripts[material.provider], import.meta.url)), '--profile', material.id, ...argv], {
  env, stdio: 'inherit', windowsHide: true
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
