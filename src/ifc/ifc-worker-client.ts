import * as Comlink from "comlink";
import type { IfcWorkerApi, OpenModelResult } from "./ifc-worker";
import type { StoreyObject } from "../types";

/*
Main-thread proxy around the IFC worker. The worker is created lazily on the
first method call and reused for every subsequent call. The Comlink wrapping
exposes the worker's methods as plain async functions; transferable buffers
must be passed via Comlink.transfer().
*/

let workerInstance: Worker | null = null;
let proxy: Comlink.Remote<IfcWorkerApi> | null = null;

function getProxy(): Comlink.Remote<IfcWorkerApi> {
  if (proxy && workerInstance) return proxy;
  const worker = new Worker(new URL("./ifc-worker.ts", import.meta.url), { type: "module" });
  workerInstance = worker;
  proxy = Comlink.wrap<IfcWorkerApi>(worker);
  return proxy;
}

export async function pingWorker(): Promise<"pong"> {
  return getProxy().ping();
}

export async function openModel(buffer: ArrayBuffer): Promise<OpenModelResult> {
  return getProxy().openModel(Comlink.transfer(buffer, [buffer]));
}

export async function computeStoreyObjects(
  handle: string,
  storeyExpressId: number,
  ifcTypeNames: string[],
  cutOffset: number,
  onProgress?: (fraction: number) => void,
): Promise<StoreyObject[]> {
  return getProxy().computeStoreyObjects(
    handle,
    storeyExpressId,
    ifcTypeNames,
    cutOffset,
    onProgress ? Comlink.proxy(onProgress) : undefined,
  );
}

export async function closeModel(handle: string): Promise<void> {
  return getProxy().closeModel(handle);
}

export function __terminateIfcWorkerForTests(): void {
  workerInstance?.terminate();
  workerInstance = null;
  proxy = null;
}
