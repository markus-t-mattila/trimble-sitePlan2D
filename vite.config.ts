import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import path from "node:path";

// GitHub Pages serves the repo under /<repo-name>/. The earlier "./" base
// worked for the HTML's own asset references but the WASM is loaded from a
// Web Worker — the worker's `self.location` is the bundled worker URL
// (`/assets/worker-HASH.js`), so a relative WASM path resolves to
// `/assets/wasm/…` and 404s.
//
// Switching to an absolute base for production builds fixes that: the worker
// resolves `import.meta.env.BASE_URL + "wasm/"` to an absolute path the
// browser can fetch from anywhere in the page (main thread OR worker). The
// dev server keeps `/` as base, which is what tsx's dev server expects.
const PAGES_BASE = "/trimble-sitePlan2D/";

export default defineConfig(({ command }) => ({
  base: command === "build" ? PAGES_BASE : "/",
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Hashed WASM filenames mean the long-cache header is safe across builds.
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".wasm")) {
            return "wasm/[name]-[hash][extname]";
          }
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    host: "127.0.0.1",
  },
  preview: {
    port: 4174,
    strictPort: true,
    host: "127.0.0.1",
  },
  optimizeDeps: {
    // web-ifc ships a WASM module that the optimizer should leave alone.
    exclude: ["web-ifc"],
  },
}));
