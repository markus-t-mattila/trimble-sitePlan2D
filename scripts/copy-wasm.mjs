/*
Copy web-ifc.wasm out of node_modules so Vite can serve it from /public/wasm/
during dev and bundle it (with a hashed filename) at build time. Runs as the
`prepare` lifecycle script after `npm install`.
*/

import { copyFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const targetDir = resolve(root, "public", "wasm");
const wasmSource = resolve(root, "node_modules", "web-ifc", "web-ifc.wasm");
const wasmMtSource = resolve(root, "node_modules", "web-ifc", "web-ifc-mt.wasm");

async function fileExists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(targetDir, { recursive: true });

  if (!(await fileExists(wasmSource))) {
    // First install — web-ifc may not be present yet (e.g. running prepare
    // before deps resolve). Skip silently; the build step will copy when ready.
    return;
  }

  await copyFile(wasmSource, resolve(targetDir, "web-ifc.wasm"));
  if (await fileExists(wasmMtSource)) {
    await copyFile(wasmMtSource, resolve(targetDir, "web-ifc-mt.wasm"));
  }
  console.log("[copy-wasm] web-ifc wasm copied to public/wasm/");
}

main().catch((err) => {
  console.error("[copy-wasm] failed:", err);
  process.exitCode = 1;
});
