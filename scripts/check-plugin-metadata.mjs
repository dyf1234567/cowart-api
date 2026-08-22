import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(rootDir, relativePath), "utf8"));
}

const [pluginManifest, packageManifest, packageLock, marketplace] = await Promise.all([
  readJson(".codex-plugin/plugin.json"),
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson(".agents/plugins/marketplace.json"),
]);

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
assert.match(pluginManifest.version, semverPattern, "plugin.json must use strict semver");

const versions = new Map([
  [".codex-plugin/plugin.json", pluginManifest.version],
  ["package.json", packageManifest.version],
  ["package-lock.json", packageLock.version],
  ["package-lock.json root package", packageLock.packages?.[""]?.version],
]);
for (const [source, version] of versions) {
  assert.equal(
    version,
    pluginManifest.version,
    `${source} version must match .codex-plugin/plugin.json`,
  );
}

assert.equal(pluginManifest.name, "cowart");
assert.equal(pluginManifest.repository, "https://github.com/zhongerxin/Cowart");
assert.equal(pluginManifest.license, "MIT");

assert.equal(marketplace.name, "cowart-github");
const marketplacePlugin = marketplace.plugins?.find(({ name }) => name === pluginManifest.name);
assert.ok(marketplacePlugin, "marketplace must include the Cowart plugin");
assert.equal(marketplacePlugin.source?.source, "local");
assert.ok(
  marketplacePlugin.source?.path === "." || marketplacePlugin.source?.path === "./",
  "Cowart marketplace source must point at the repository root",
);
assert.equal(marketplacePlugin.policy?.installation, "AVAILABLE");
assert.equal(marketplacePlugin.policy?.authentication, "ON_INSTALL");
assert.equal(marketplacePlugin.category, pluginManifest.interface?.category);

console.log(`Cowart plugin metadata OK (${pluginManifest.version})`);
