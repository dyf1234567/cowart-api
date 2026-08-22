#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

const DEFAULT_SERVER_URL = "http://127.0.0.1:8188";
const DEFAULT_PROMPT_NODE_PATH = "6.inputs.text";
const DEFAULT_NEGATIVE_NODE_PATH = "7.inputs.text";
const DEFAULT_DENOISE = 0.75;

function printUsage() {
  console.error(`Usage:
  node scripts/generate-comfyui-image.mjs --prompt "..." [--width 1024 --height 1024]
  node scripts/generate-comfyui-image.mjs --prompt "..." --reference ./base.png   (image-to-image)

Behaviour:
  - Uses the workflow JSON configured in the Cowart canvas UI (or --workflow-file) when present,
    injecting the prompt into the configured node path (default 6.inputs.text).
  - Falls back to a built-in standard workflow (CheckpointLoaderSimple -> KSampler -> SaveImage)
    when no workflow is configured; the checkpoint name is required in that case.
  - With --reference the image is uploaded via /upload/image and wired into a LoadImage node,
    so both text-to-image and image-to-image editing are supported.

Environment:
  COMFYUI_SERVER_URL        Defaults to http://127.0.0.1:8188.
  COMFYUI_CHECKPOINT        Checkpoint file name for the built-in workflow.
  COMFYUI_WORKFLOW_FILE     Optional path to an API-format workflow JSON.
  COWART_COMFYUI_TIMEOUT    Polling timeout in seconds (default 600).`);
}

function parseArgs(argv) {
  const args = { reference: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      if (key === "reference") {
        args.reference.push(next);
      } else {
        args[key] = next;
      }
      i += 1;
    }
  }
  return args;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readComfyuiConfig() {
  const configDir =
    nonEmptyString(process.env.COWART_CONFIG_DIR) ||
    (nonEmptyString(process.env.APPDATA) ? join(process.env.APPDATA, "Cowart") : join(homedir(), ".cowart"));
  const providerConfig = await readJsonIfExists(join(configDir, "provider-config.json"));
  return providerConfig?.comfyui ?? {};
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeFileName(value, fallback = "comfyui-image.png") {
  const raw = basename(String(value || fallback));
  const ext = extname(raw) || ".png";
  const base = raw
    .slice(0, raw.length - extname(raw).length)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "comfyui-image"}${ext}`;
}

async function readPrompt(args) {
  const prompt = nonEmptyString(args.prompt);
  if (prompt) return prompt;

  const promptFile = nonEmptyString(args["prompt-file"]);
  if (promptFile) {
    return await readFile(resolve(promptFile), "utf8");
  }

  throw new Error("A prompt is required. Pass --prompt or --prompt-file.");
}

function setNodePath(workflow, nodePath, value) {
  const parts = String(nodePath).split(".").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Invalid node path "${nodePath}". Expected a form like "6.inputs.text".`);
  }

  let cursor = workflow;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cursor || typeof cursor !== "object" || !(part in cursor)) {
      throw new Error(`Node path "${nodePath}" does not exist in the workflow.`);
    }
    cursor = cursor[part];
  }

  cursor[parts[parts.length - 1]] = value;
}

function findNodeIdsByClassType(workflow, classType) {
  return Object.keys(workflow).filter((nodeId) => workflow[nodeId]?.class_type === classType);
}

async function loadUserWorkflow(args, config) {
  const workflowFile = nonEmptyString(args["workflow-file"]) || nonEmptyString(process.env.COMFYUI_WORKFLOW_FILE);
  if (workflowFile) {
    return JSON.parse(await readFile(resolve(workflowFile), "utf8"));
  }

  const configured = nonEmptyString(config.workflow);
  if (configured) {
    try {
      return JSON.parse(configured);
    } catch {
      throw new Error("The ComfyUI workflow stored in Cowart config is not valid JSON.");
    }
  }

  return null;
}

function randomSeed() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

function builtInTxt2ImgWorkflow({ checkpoint, prompt, negativePrompt, width, height }) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: randomSeed(),
        steps: 25,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "Cowart", images: ["6", 0] } },
  };
}

function builtInImg2ImgWorkflow({ checkpoint, prompt, negativePrompt, uploadedImageName, denoise }) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 1] } },
    "4": { class_type: "LoadImage", inputs: { image: uploadedImageName } },
    "5": { class_type: "VAEEncode", inputs: { pixels: ["4", 0], vae: ["1", 2] } },
    "6": {
      class_type: "KSampler",
      inputs: {
        seed: randomSeed(),
        steps: 25,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["5", 0],
      },
    },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
    "8": { class_type: "SaveImage", inputs: { filename_prefix: "Cowart", images: ["7", 0] } },
  };
}

async function uploadImage(serverUrl, referencePath) {
  const filePath = resolve(referencePath);
  const buffer = await readFile(filePath);
  const fileName = basename(filePath) || "reference.png";

  const form = new FormData();
  form.append("image", new Blob([buffer]), fileName);
  form.append("overwrite", "true");

  const response = await fetch(`${serverUrl}/upload/image`, { method: "POST", body: form });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ComfyUI /upload/image failed: ${response.status} ${text.slice(0, 500)}`);
  }

  const payload = JSON.parse(text);
  if (!nonEmptyString(payload?.name)) {
    throw new Error(`ComfyUI /upload/image did not return a file name: ${text.slice(0, 500)}`);
  }
  return payload.name;
}

function injectIntoUserWorkflow(workflow, { prompt, promptNodePath, negativeNodePath, uploadedImageName, imageNodePath, denoise }) {
  const resolvedPromptPath =
    nonEmptyString(promptNodePath) ||
    (() => {
      const encodeNodes = findNodeIdsByClassType(workflow, "CLIPTextEncode");
      if (encodeNodes.length === 0) return null;
      return `${encodeNodes[0]}.inputs.text`;
    })();

  if (!resolvedPromptPath) {
    throw new Error("The configured workflow has no CLIPTextEncode node; set a prompt node path like 6.inputs.text.");
  }
  setNodePath(workflow, resolvedPromptPath, prompt);

  const resolvedNegativePath = nonEmptyString(negativeNodePath);
  if (resolvedNegativePath) {
    setNodePath(workflow, resolvedNegativePath, "watermark, low quality, blurry");
  }

  if (uploadedImageName) {
    let loadNodeId = nonEmptyString(imageNodePath);
    if (!loadNodeId) {
      const loadNodes = findNodeIdsByClassType(workflow, "LoadImage");
      loadNodeId = loadNodes[0] ?? null;
    }
    if (!loadNodeId || !workflow[loadNodeId]) {
      throw new Error(
        "Image editing needs a LoadImage node in the configured workflow. Add one and set its node id in the Cowart ComfyUI config (参考图 LoadImage 节点 ID)."
      );
    }
    workflow[loadNodeId].inputs = workflow[loadNodeId].inputs ?? {};
    workflow[loadNodeId].inputs.image = uploadedImageName;

    for (const samplerId of findNodeIdsByClassType(workflow, "KSampler")) {
      if (typeof workflow[samplerId].inputs?.denoise === "number") {
        workflow[samplerId].inputs.denoise = denoise;
      }
    }
  }
}

async function queuePrompt(serverUrl, workflow) {
  const response = await fetch(`${serverUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ComfyUI /prompt failed: ${response.status} ${text.slice(0, 1000)}`);
  }

  const payload = JSON.parse(text);
  const promptId = nonEmptyString(payload?.prompt_id);
  if (!promptId) {
    throw new Error(`ComfyUI /prompt did not return prompt_id: ${text.slice(0, 500)}`);
  }
  return promptId;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitForHistory(serverUrl, promptId, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const response = await fetch(`${serverUrl}/history/${promptId}`);
    if (response.ok) {
      const payload = await response.json();
      const entry = payload?.[promptId];
      if (entry?.status?.status_str === "error") {
        throw new Error(`ComfyUI execution failed: ${JSON.stringify(entry.status).slice(0, 1000)}`);
      }
      const outputs = entry?.outputs;
      if (outputs && Object.keys(outputs).length > 0) {
        return outputs;
      }
    }
    await sleep(2000);
  }

  throw new Error(`Timed out after ${timeoutSeconds}s waiting for ComfyUI prompt ${promptId}.`);
}

function findOutputImages(outputs) {
  const images = [];
  for (const nodeOutput of Object.values(outputs)) {
    for (const item of nodeOutput?.images ?? []) {
      if (item?.type === "output" && nonEmptyString(item.filename)) {
        images.push(item);
      }
    }
  }
  return images;
}

async function downloadOutputImage(serverUrl, image, outputPath) {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output",
  });
  const response = await fetch(`${serverUrl}/view?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`ComfyUI /view failed: ${response.status} for ${image.filename}`);
  }
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const config = await readComfyuiConfig();
  const serverUrl = (
    nonEmptyString(args["server-url"]) ||
    nonEmptyString(process.env.COMFYUI_SERVER_URL) ||
    nonEmptyString(config.serverUrl) ||
    DEFAULT_SERVER_URL
  ).replace(/\/+$/, "");

  const prompt = await readPrompt(args);
  const width = Number(args.width) > 0 ? Number(args.width) : 1024;
  const height = Number(args.height) > 0 ? Number(args.height) : 1024;
  const denoise = (() => {
    const value = Number(args.denoise ?? config.denoise ?? DEFAULT_DENOISE);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_DENOISE;
  })();

  const referencePaths = Array.isArray(args.reference) ? args.reference.filter(Boolean) : [];
  const isImg2Img = referencePaths.length > 0;

  let uploadedImageName = null;
  if (isImg2Img) {
    uploadedImageName = await uploadImage(serverUrl, referencePaths[0]);
  }

  const userWorkflow = await loadUserWorkflow(args, config);
  let workflow;
  let workflowSource;

  if (userWorkflow) {
    workflowSource = "configured";
    workflow = userWorkflow;
    injectIntoUserWorkflow(workflow, {
      prompt,
      promptNodePath: nonEmptyString(args["prompt-node-path"]) || config.promptNodePath || DEFAULT_PROMPT_NODE_PATH,
      negativeNodePath: nonEmptyString(args["negative-node-path"]) || config.negativeNodePath,
      uploadedImageName,
      imageNodePath: nonEmptyString(args["image-node-path"]) || config.imageNodePath,
      denoise,
    });
  } else {
    workflowSource = "built-in";
    const checkpoint =
      nonEmptyString(args.checkpoint) || nonEmptyString(process.env.COMFYUI_CHECKPOINT) || nonEmptyString(config.checkpoint);
    if (!checkpoint) {
      throw new Error(
        "No workflow is configured and no checkpoint name is available. Configure a workflow in the Cowart ComfyUI settings, or set COMFYUI_CHECKPOINT / --checkpoint for the built-in workflow."
      );
    }

    workflow = isImg2Img
      ? builtInImg2ImgWorkflow({ checkpoint, prompt, negativePrompt: "watermark, low quality, blurry", uploadedImageName, denoise })
      : builtInTxt2ImgWorkflow({ checkpoint, prompt, negativePrompt: "watermark, low quality, blurry", width, height });
  }

  const promptId = await queuePrompt(serverUrl, workflow);
  const timeoutSeconds = Number(nonEmptyString(process.env.COWART_COMFYUI_TIMEOUT)) || 600;
  const outputs = await waitForHistory(serverUrl, promptId, timeoutSeconds);
  const outputImages = findOutputImages(outputs);
  if (outputImages.length === 0) {
    throw new Error(`ComfyUI finished prompt ${promptId} but produced no output images. Make sure the workflow contains a SaveImage node.`);
  }

  const outDir = resolve(nonEmptyString(args["out-dir"]) || nonEmptyString(process.env.COWART_GENERATED_IMAGE_DIR) || "generated-images");
  await mkdir(outDir, { recursive: true });
  const outputName = safeFileName(nonEmptyString(args.output) || `comfyui-${timestamp()}.png`);
  const outputPath = resolve(outDir, outputName);
  await downloadOutputImage(serverUrl, outputImages[0], outputPath);

  const result = {
    provider: "comfyui",
    mode: isImg2Img ? "img2img" : "txt2img",
    workflowSource,
    serverUrl,
    promptId,
    outputPath,
    referenceImages: referencePaths,
    outputImages: outputImages.map((item) => item.filename),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
