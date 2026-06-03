/*
Purpose:
Local HTTPS development server for the trimble-sitePlan2D Trimble Connect
extension. Terminates HTTPS on a self-signed cert and proxies every request
(except `/manifest.json`) to an internal Vite dev (or `vite preview`) server,
including WebSocket upgrades for HMR. The `/manifest.json` route serves a
rewritten manifest whose production base URL is swapped for the local one so
the extension is loaded from this dev server.

Logic:
- Generate a self-signed certificate on first run via openssl (no npm deps).
- Spawn `vite` (or `vite preview` when --preview is passed) on an internal
  HTTP port (e.g. 5174 / 4174), wait for the port to accept TCP, then bind the
  outer HTTPS listener.
- Tunnel every HTTP request (keep-alive, streaming) to Vite via `http.request`.
- Tunnel every WebSocket upgrade via raw `net.connect`, so Vite HMR works.
- Intercept GET /manifest.json: read repo manifest, replace prod base URL with
  current local base URL on the fly. The on-disk manifest stays prod.
- Add permissive CORS so Trimble Connect can fetch the manifest cross-origin.

Configuration (env overrides shown in parens):
- HOST           (DEV_HOST)            default "localhost"
- PORT           (DEV_PORT)            default 5173
- INTERNAL_PORT  (DEV_INTERNAL_PORT)   default 5174 (dev) / 4174 (preview)
- PROD_BASE_URL  (DEV_PROD_BASE_URL)   default reads from manifest.json

Possible side effects:
- Generates dev-server/cert/{key.pem,cert.pem} if missing.
- Spawns a child Vite process and forwards SIGINT/SIGTERM.
- Binds an HTTPS listener on the configured port.
*/

import { createServer as createHttpsServer } from "node:https";
import type { Server as HttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse, RequestOptions, OutgoingHttpHeaders } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { connect as netConnect } from "node:net";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";
import type { Duplex } from "node:stream";

const IS_PREVIEW = process.argv.includes("--preview");

const HOST: string = process.env.DEV_HOST ?? "localhost";
const PORT: number = Number(process.env.DEV_PORT ?? 5173);
const INTERNAL_HOST = "127.0.0.1";
const DEFAULT_INTERNAL_PORT = IS_PREVIEW ? 4174 : 5174;
const INTERNAL_PORT: number = Number(process.env.DEV_INTERNAL_PORT ?? DEFAULT_INTERNAL_PORT);

const SCRIPT_DIR: string = fileURLToPath(new URL("./", import.meta.url));
const PROJECT_ROOT: string = resolve(SCRIPT_DIR, "..");
const CERT_DIR: string = join(SCRIPT_DIR, "cert");
const KEY_PATH: string = join(CERT_DIR, "key.pem");
const CERT_PATH: string = join(CERT_DIR, "cert.pem");
const MANIFEST_PATH: string = join(PROJECT_ROOT, "manifest.json");

const READY_TIMEOUT_MS = 30_000;
const READY_RETRY_MS = 200;

/*
Purpose:
Read the on-disk manifest's `url` field and derive the production base URL
(everything before the last path segment). Used as the search string when
rewriting manifest URLs to point at the local dev server. Honors the
DEV_PROD_BASE_URL override and normalizes a trailing slash.
*/
export async function readProductionBaseUrl(): Promise<string> {
  const envOverride = process.env.DEV_PROD_BASE_URL;
  if (envOverride) {
    return envOverride.endsWith("/") ? envOverride : `${envOverride}/`;
  }

  const raw = await readFile(MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw) as { url?: unknown };
  const url = typeof parsed.url === "string" ? parsed.url : "";
  const lastSlash = url.lastIndexOf("/");
  if (lastSlash <= 0) {
    throw new Error("manifest.json url field is missing or invalid; cannot derive production base URL.");
  }
  return url.slice(0, lastSlash + 1);
}

/*
Purpose:
Pure function (unit-testable) that rewrites the raw manifest JSON string by
replacing every literal occurrence of `prodBaseUrl` with `localBaseUrl`. This
keeps the on-disk manifest in production form while serving a dev-friendly
copy from the local server.
*/
export function rewriteManifest(rawJson: string, prodBaseUrl: string, localBaseUrl: string): string {
  return rawJson.split(prodBaseUrl).join(localBaseUrl);
}

/*
Purpose:
Ensure dev-server/cert/{key.pem,cert.pem} exist by shelling out to openssl
when missing. Cert is valid for localhost + 127.0.0.1 + ::1 for one year.
Mirrors the openssl config from the reference vanilla-JS server.
*/
export async function ensureSelfSignedCert(): Promise<{ key: Buffer; cert: Buffer }> {
  if (!existsSync(CERT_DIR)) {
    await mkdir(CERT_DIR, { recursive: true });
  }

  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    const opensslConfig = [
      "[req]",
      "distinguished_name=req_dn",
      "x509_extensions=v3_req",
      "prompt=no",
      "[req_dn]",
      "CN=localhost",
      "[v3_req]",
      "subjectAltName=@alt_names",
      "basicConstraints=CA:FALSE",
      "keyUsage=digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "[alt_names]",
      "DNS.1=localhost",
      "IP.1=127.0.0.1",
      "IP.2=::1",
      "",
    ].join("\n");
    const configPath = join(CERT_DIR, "openssl.cnf");
    await writeFile(configPath, opensslConfig, "utf8");

    console.log("[dev-server] Generating self-signed cert in dev-server/cert/ ...");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey", "rsa:2048",
        "-nodes",
        "-keyout", KEY_PATH,
        "-out", CERT_PATH,
        "-days", "365",
        "-config", configPath,
      ],
      { stdio: "inherit" },
    );
  }

  return {
    key: await readFile(KEY_PATH),
    cert: await readFile(CERT_PATH),
  };
}

/*
Purpose:
Apply permissive CORS + no-cache headers used by all responses we generate
directly (i.e. /manifest.json and OPTIONS preflight). Vite-proxied responses
are streamed through untouched.
*/
function applyCommonHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "*");
  response.setHeader("Cache-Control", "no-store");
}

/*
Purpose:
Serve a rewritten manifest.json so the dev-server URL replaces the production
GitHub Pages URL while still being valid against the manifest schema.
*/
async function serveDevManifest(
  localBaseUrl: string,
  productionBaseUrl: string,
  response: ServerResponse,
): Promise<void> {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  const rewritten = rewriteManifest(raw, productionBaseUrl, localBaseUrl);
  applyCommonHeaders(response);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.statusCode = 200;
  response.end(rewritten);
}

/*
Purpose:
Forward a normal HTTP request to the internal Vite server and stream the
response back. Preserves the request method, headers, and body; overwrites
`host` so Vite sees the internal host (some Vite middleware checks it).
*/
function proxyHttpRequest(
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
): void {
  const forwardedHeaders: OutgoingHttpHeaders = { ...clientRequest.headers };
  forwardedHeaders.host = `${INTERNAL_HOST}:${INTERNAL_PORT}`;

  const proxyOptions: RequestOptions = {
    host: INTERNAL_HOST,
    port: INTERNAL_PORT,
    method: clientRequest.method,
    path: clientRequest.url,
    headers: forwardedHeaders,
  };

  const proxyRequest = httpRequest(proxyOptions, (proxyResponse) => {
    clientResponse.statusCode = proxyResponse.statusCode ?? 502;
    for (const [name, value] of Object.entries(proxyResponse.headers)) {
      if (value !== undefined) {
        clientResponse.setHeader(name, value);
      }
    }
    proxyResponse.pipe(clientResponse);
  });

  proxyRequest.on("error", (error) => {
    console.error("[dev-server] proxy error:", error);
    if (!clientResponse.headersSent) {
      clientResponse.statusCode = 502;
      clientResponse.setHeader("Content-Type", "text/plain; charset=utf-8");
      clientResponse.end(`Bad Gateway: Vite proxy error (${error.message})`);
    } else {
      clientResponse.destroy(error);
    }
  });

  clientRequest.pipe(proxyRequest);
}

/*
Purpose:
Tunnel a WebSocket upgrade (Vite HMR) by opening a raw TCP socket to the
internal Vite port, replaying the original upgrade request line + headers,
and piping bytes both directions.
*/
function proxyWebSocketUpgrade(
  request: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
): void {
  const upstream: Socket = netConnect(INTERNAL_PORT, INTERNAL_HOST);

  upstream.on("connect", () => {
    const forwardedHeaders = { ...request.headers, host: `${INTERNAL_HOST}:${INTERNAL_PORT}` };
    const headerLines: string[] = [];
    headerLines.push(`${request.method ?? "GET"} ${request.url ?? "/"} HTTP/1.1`);
    for (const [name, value] of Object.entries(forwardedHeaders)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) headerLines.push(`${name}: ${v}`);
      } else {
        headerLines.push(`${name}: ${String(value)}`);
      }
    }
    headerLines.push("", "");
    upstream.write(headerLines.join("\r\n"));
    if (head.length > 0) upstream.write(head);

    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  const cleanup = (): void => {
    upstream.destroy();
    clientSocket.destroy();
  };
  upstream.on("error", (error) => {
    console.error("[dev-server] ws upstream error:", error);
    cleanup();
  });
  clientSocket.on("error", (error) => {
    console.error("[dev-server] ws client error:", error);
    cleanup();
  });
}

/*
Purpose:
Poll the internal Vite TCP port until it accepts a connection or we hit the
overall timeout. Implemented with `net.connect` so we don't need any deps.
*/
async function waitForViteReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  const tryOnce = (): Promise<boolean> =>
    new Promise<boolean>((resolveTry) => {
      const probe = netConnect({ port, host: INTERNAL_HOST });
      const done = (ok: boolean): void => {
        probe.destroy();
        resolveTry(ok);
      };
      probe.once("connect", () => done(true));
      probe.once("error", () => done(false));
    });

  while (Date.now() < deadline) {
    if (await tryOnce()) return;
    await new Promise<void>((r) => setTimeout(r, READY_RETRY_MS));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for Vite to listen on ${INTERNAL_HOST}:${port}.`,
  );
}

/*
Purpose:
Spawn `vite` (or `vite preview`) on the internal port. Forwards SIGINT/SIGTERM
to the child and exits this process if the child dies, so killing one kills
both.
*/
function spawnVite(internalPort: number, isPreview: boolean): ChildProcess {
  const args = isPreview ? ["vite", "preview"] : ["vite"];
  args.push("--port", String(internalPort), "--strictPort", "--host", INTERNAL_HOST);

  console.log(`[dev-server] Spawning: npx ${args.join(" ")}`);
  const child = spawn("npx", args, {
    stdio: "inherit",
    cwd: PROJECT_ROOT,
    env: process.env,
  });

  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    console.log(`[dev-server] Vite child exited (code=${code}, signal=${signal}); shutting down.`);
    process.exit(code ?? 0);
  });
  child.on("error", (error: Error) => {
    console.error("[dev-server] failed to spawn Vite:", error);
    process.exit(1);
  });

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  return child;
}

/*
Purpose:
Wire up the HTTPS listener: handle OPTIONS, serve rewritten manifest, otherwise
forward to Vite. Also installs the `upgrade` listener for HMR WebSockets.
*/
function buildServer(
  key: Buffer,
  cert: Buffer,
  localBaseUrl: string,
  productionBaseUrl: string,
): HttpsServer {
  const server = createHttpsServer({ key, cert }, async (request, response) => {
    try {
      const urlObject = new URL(request.url ?? "/", localBaseUrl);
      const urlPath = urlObject.pathname;

      if (request.method === "OPTIONS") {
        applyCommonHeaders(response);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === "GET" && urlPath === "/manifest.json") {
        await serveDevManifest(localBaseUrl, productionBaseUrl, response);
        return;
      }

      proxyHttpRequest(request, response);
    } catch (error) {
      console.error("[dev-server] request error:", error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.end("Internal Server Error");
      } else {
        response.destroy();
      }
    }
  });

  server.on("upgrade", (request, socket, head) => {
    proxyWebSocketUpgrade(request, socket, head);
  });

  return server;
}

/*
Purpose:
Entry point: derive URLs, generate cert, spawn Vite, wait for readiness, then
bind the HTTPS proxy and print the startup banner.
*/
async function main(): Promise<void> {
  const productionBaseUrl = await readProductionBaseUrl();
  const localBaseUrl = `https://${HOST}:${PORT}/`;
  const { key, cert } = await ensureSelfSignedCert();

  spawnVite(INTERNAL_PORT, IS_PREVIEW);
  console.log(`[dev-server] Waiting for Vite on ${INTERNAL_HOST}:${INTERNAL_PORT} ...`);
  await waitForViteReady(INTERNAL_PORT, READY_TIMEOUT_MS);

  const server = buildServer(key, cert, localBaseUrl, productionBaseUrl);
  server.listen(PORT, HOST, () => {
    const manifestUrl = `${localBaseUrl}manifest.json`;
    const mode = IS_PREVIEW ? "preview" : "dev";
    console.log("[dev-server] trimble-sitePlan2D local development server");
    console.log(`[dev-server] Mode:     ${mode} (proxying Vite on ${INTERNAL_HOST}:${INTERNAL_PORT})`);
    console.log(`[dev-server] Cert dir: ${CERT_DIR}`);
    console.log(`[dev-server] App:      ${localBaseUrl}`);
    console.log(`[dev-server] Manifest: ${manifestUrl}`);
    console.log(`[dev-server] Production base URL replaced: ${productionBaseUrl} -> ${localBaseUrl}`);
    console.log("[dev-server]");
    console.log("[dev-server] First-time setup:");
    console.log(`[dev-server]   1. Open ${localBaseUrl} in your browser and accept the self-signed cert.`);
    console.log("[dev-server]   2. In Trimble Connect, add the extension manifest URL above.");
  });
}

/*
Purpose:
Detect whether this module was started as the program entry point (via tsx or
node) vs. imported by a test. Only the former should kick off `main()` and
spawn Vite.
*/
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(entry) === thisFile;
}

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    console.error("[dev-server] fatal:", error);
    process.exit(1);
  });
}
