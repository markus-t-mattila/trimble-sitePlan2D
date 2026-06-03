import { IfcAPI } from "web-ifc";

/*
Module-level singleton: there is exactly one IfcAPI per realm (main thread OR
worker). Re-calling getIfcApi() inside the same realm returns the same
already-initialized instance, so the WASM is fetched-and-compiled once.

The WASM lives under `<base>wasm/web-ifc.wasm` — the public/wasm/ folder is
copied into the build at the project root by the copy-wasm.mjs script, and
Vite's `base` is set to `/trimble-sitePlan2D/` in production (the repo's
GitHub Pages subpath) and `/` in dev. `import.meta.env.BASE_URL` reflects
that value at runtime, which gives us an ABSOLUTE URL — important because
this code runs in a Web Worker too, and the worker's `self.location` is the
bundled worker file (`/assets/worker-…`), so a relative path would resolve
to `/assets/wasm/web-ifc.wasm` and 404.
*/

let apiPromise: Promise<IfcAPI> | null = null;

export function getIfcApi(): Promise<IfcAPI> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = new IfcAPI();
      // SetWasmPath signature: (path: string, absolute?: boolean)
      // BASE_URL already ends with "/" so concatenation gives e.g.
      //   /trimble-sitePlan2D/wasm/   (Pages)
      //   /wasm/                       (dev)
      api.SetWasmPath(`${import.meta.env.BASE_URL}wasm/`, true);
      await api.Init();
      return api;
    })();
  }
  return apiPromise;
}

export function __resetIfcApiSingletonForTests(): void {
  apiPromise = null;
}
