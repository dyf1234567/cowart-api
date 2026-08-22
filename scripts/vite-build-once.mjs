import { build } from "vite";

const args = process.argv.slice(2);
let root = process.cwd();
let outDir = null;
let emptyOutDir = undefined;

if (args[0] && !args[0].startsWith("-")) {
  root = args.shift();
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--outDir") {
    outDir = args[index + 1];
    index += 1;
  } else if (arg === "--emptyOutDir") {
    emptyOutDir = true;
  }
}

try {
  await build({
    root,
    build: {
      ...(outDir ? { outDir } : {}),
      ...(emptyOutDir === undefined ? {} : { emptyOutDir }),
    },
  });
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
