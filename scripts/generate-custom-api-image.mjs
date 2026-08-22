#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

function printUsage() {
  console.error(`Usage:
  node scripts/generate-custom-api-image.mjs --prompt "..." [--width 1024 --height 1024]
  node scripts/generate-custom-api-image.mjs --prompt "..." --reference ./base.png   (uses /v1/images/edits)

Calls an OpenAI-compatible image API:
  - Without --reference: POST {baseUrl}/images/generations
  - With --reference:    POST {baseUrl}/images/edits (multipart)
  - Chat-multimodal mode (Alibaba Qwen-Image style): POST {baseUrl}/chat/completions
    with multimodal content, then downloads the returned image URL.

Options:
  --profile <name|id>     Use a saved Cowart provider profile (custom type) instead of the default section.
  --call-mode <mode>      auto | images | chat. Overrides the profile callMode.

Environment:
  COWART_CUSTOM_API_KEY     Required (or configure it from the Cowart canvas UI).
  COWART_CUSTOM_BASE_URL    e.g. https://api.example.com/v1
  COWART_CUSTOM_API_MODEL   Model name passed to the API.
  COWART_CUSTOM_CALL_MODE   auto | images | chat`);
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

async function readCustomConfig(profileRef = null) {
  if (nonEmptyString(profileRef)) {
    const { findCowartProfile } = await import("../mcp/lib/canvas-storage.mjs");
    const profile = await findCowartProfile(profileRef);
    if (!profile) throw new Error(`No Cowart provider profile named "${profileRef}".`);
    if (profile.provider !== "custom") {
      throw new Error(`Profile "${profile.name}" is a ${profile.provider} profile, expected a custom API profile.`);
    }
    return profile.settings;
  }

  const explicitConfig = nonEmptyString(process.env.COWART_CUSTOM_CONFIG);
  if (explicitConfig) {
    const payload = await readJsonIfExists(explicitConfig);
    return payload?.custom ?? payload ?? {};
  }

  const configDir =
    nonEmptyString(process.env.COWART_CONFIG_DIR) ||
    (nonEmptyString(process.env.APPDATA) ? join(process.env.APPDATA, "Cowart") : join(homedir(), ".cowart"));
  const providerConfig = await readJsonIfExists(join(configDir, "provider-config.json"));
  return providerConfig?.custom ?? {};
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeFileName(value, fallback = "custom-api-image.png") {
  const raw = basename(String(value || fallback));
  const ext = extname(raw) || ".png";
  const base = raw
    .slice(0, raw.length - extname(raw).length)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "custom-api-image"}${ext}`;
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

function resolveSize(args) {
  const explicit = nonEmptyString(args.size);
  if (explicit) return explicit;

  const width = Number(args.width);
  const height = Number(args.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return `${Math.round(width)}x${Math.round(height)}`;
  }
  return null;
}

function findImageInResponse(payload) {
  const first = payload?.data?.[0];
  if (!first) return null;
  if (nonEmptyString(first.url)) return { url: first.url, b64: null };
  if (nonEmptyString(first.b64_json)) return { url: null, b64: first.b64_json };
  return null;
}

async function saveResultImage(image, outputPath) {
  if (image.b64) {
    await writeFile(outputPath, Buffer.from(image.b64, "base64"));
    return;
  }
  const response = await fetch(image.url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to download generated image: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

const REFERENCE_MIME_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

async function generateViaGenerations({ baseUrl, apiKey, model, prompt, size, n }) {
  const body = { model, prompt, n };
  if (size) body.size = size;

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Custom API /images/generations failed: ${response.status} ${response.statusText}: ${text.slice(0, 1000)}`);
  }
  return JSON.parse(text);
}

async function generateViaEdits({ baseUrl, apiKey, model, prompt, size, n, referencePath }) {
  const filePath = resolve(referencePath);
  const buffer = await readFile(filePath);
  const fileName = basename(filePath) || "reference.png";
  const mimeType = REFERENCE_MIME_TYPES.get(extname(filePath).toLowerCase()) || "image/png";

  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("n", String(n));
  if (size) form.append("size", size);
  form.append("image", new Blob([buffer], { type: mimeType }), fileName);

  const response = await fetch(`${baseUrl}/images/edits`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Custom API /images/edits failed: ${response.status} ${response.statusText}: ${text.slice(0, 1000)}`);
  }
  return JSON.parse(text);
}

// 阿里系多模态生图路由：POST {baseUrl}/chat/completions，content 为 [{text}, {image}] 数组。
async function generateViaChatMultimodal({ baseUrl, apiKey, model, prompt, referencePath, size }) {
  // 该路由会忽略请求体里的 size 参数（实测恒返默认尺寸）；把尺寸要求写进提示词文本可以让模型按比例出图。
  const sizeInstruction = nonEmptyString(size)
    ? `\nOutput image size: ${size.replace(/x/i, " x ")} pixels (width x height). Preserve this aspect ratio.`
    : "";
  const content = [{ text: `${prompt}${sizeInstruction}` }];
  if (referencePath) {
    const filePath = resolve(referencePath);
    const buffer = await readFile(filePath);
    const mimeType = REFERENCE_MIME_TYPES.get(extname(filePath).toLowerCase()) || "image/png";
    content.push({ image: `data:${mimeType};base64,${buffer.toString("base64")}` });
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content }] }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Custom API /chat/completions failed: ${response.status} ${response.statusText}: ${text.slice(0, 1000)}`);
  }
  return JSON.parse(text);
}

// 兼容两种响应形态：OpenAI 格式 (choices 在顶层) 和 DashScope 原生格式 (包在 output 里)。
function findImageInChatResponse(payload) {
  const root = payload?.output ?? payload ?? {};
  const message = root?.choices?.[0]?.message;
  const items = Array.isArray(message?.content) ? message.content : [];
  for (const item of items) {
    if (item && typeof item === "object") {
      if (nonEmptyString(item.image)) return { url: item.image, b64: null };
      if (nonEmptyString(item.image_url?.url)) return { url: item.image_url.url, b64: null };
    }
  }
  if (typeof message?.content === "string") {
    const match = message.content.match(/https?:\/\/\S+?\.(?:png|jpe?g|webp)(?:\?\S*)?/i);
    if (match) return { url: match[0], b64: null };
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const config = await readCustomConfig(args.profile);
  const apiKey =
    nonEmptyString(process.env.COWART_CUSTOM_API_KEY) ||
    nonEmptyString(process.env.CUSTOM_API_KEY) ||
    nonEmptyString(config.apiKey);
  if (!apiKey) throw new Error("An API key is required. Set COWART_CUSTOM_API_KEY or configure the custom API from the Cowart canvas UI.");

  const baseUrl = (
    nonEmptyString(process.env.COWART_CUSTOM_BASE_URL) ||
    nonEmptyString(config.baseUrl) ||
    ""
  ).replace(/\/+$/, "");
  if (!baseUrl) throw new Error("A base URL is required. Set COWART_CUSTOM_BASE_URL or configure the custom API from the Cowart canvas UI.");

  const model =
    nonEmptyString(args.model) ||
    nonEmptyString(process.env.COWART_CUSTOM_API_MODEL) ||
    nonEmptyString(config.model);
  if (!model) throw new Error("A model name is required. Set COWART_CUSTOM_API_MODEL or configure the custom API from the Cowart canvas UI.");

  const prompt = await readPrompt(args);
  const size = resolveSize(args);
  const n = Number(args.n) || 1;
  const referencePaths = Array.isArray(args.reference) ? args.reference.filter(Boolean) : [];

  const outDir = resolve(nonEmptyString(args["out-dir"]) || nonEmptyString(process.env.COWART_GENERATED_IMAGE_DIR) || "generated-images");
  await mkdir(outDir, { recursive: true });
  const outputName = safeFileName(nonEmptyString(args.output) || `custom-api-${model}-${timestamp()}.png`);
  const outputPath = resolve(outDir, outputName);

  const request = { baseUrl, apiKey, model, prompt, size, n };
  const hasReference = referencePaths.length > 0;

  const callModeRaw = (
    nonEmptyString(args["call-mode"]) ||
    nonEmptyString(process.env.COWART_CUSTOM_CALL_MODE) ||
    nonEmptyString(config.callMode) ||
    "auto"
  ).toLowerCase();
  const callMode = ["auto", "images", "chat"].includes(callModeRaw) ? callModeRaw : "auto";

  let image = null;
  let usedMode = null;

  if (callMode === "chat") {
    const payload = await generateViaChatMultimodal({ ...request, referencePath: referencePaths[0] });
    image = findImageInChatResponse(payload);
    usedMode = "chat";
    if (!image) {
      throw new Error(`Custom API chat response did not include an image: ${JSON.stringify(payload).slice(0, 1000)}`);
    }
  } else {
    const runImagesRoute = async () => {
      const payload = hasReference
        ? await generateViaEdits({ ...request, referencePath: referencePaths[0] })
        : await generateViaGenerations(request);
      const found = findImageInResponse(payload);
      if (!found) {
        throw new Error(`Custom API response did not include an image: ${JSON.stringify(payload).slice(0, 1000)}`);
      }
      return found;
    };

    if (callMode === "images") {
      image = await runImagesRoute();
      usedMode = hasReference ? "images-edits" : "images-generations";
    } else {
      try {
        image = await runImagesRoute();
        usedMode = hasReference ? "images-edits" : "images-generations";
      } catch (imagesError) {
        if (hasReference) throw imagesError;
        console.error(
          `Cowart custom API: images route failed (${imagesError instanceof Error ? imagesError.message : imagesError}). Trying the chat/completions multimodal route...`,
        );
        const payload = await generateViaChatMultimodal(request);
        image = findImageInChatResponse(payload);
        usedMode = "chat";
        if (!image) {
          throw new Error(`Custom API chat response did not include an image: ${JSON.stringify(payload).slice(0, 1000)}`);
        }
      }
    }
  }

  await saveResultImage(image, outputPath);

  const result = {
    provider: "custom",
    callMode: usedMode,
    mode: hasReference ? "img2img" : "txt2img",
    model,
    size: size ?? null,
    imagePath: image.url ?? null,
    outputPath,
    referenceImages: referencePaths,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
