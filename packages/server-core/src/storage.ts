import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import type { OpenSepConfig } from "./config.js";

export async function ensureStorage(config: OpenSepConfig): Promise<void> {
  await Promise.all([
    mkdir(config.dataDir, { recursive: true }),
    mkdir(config.uploadsDir, { recursive: true }),
    mkdir(config.workDir, { recursive: true }),
    mkdir(config.resultsDir, { recursive: true }),
  ]);
}

export function safeDisplayName(filename: string): string {
  const clean = basename(filename).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean.slice(0, 180) || "audio-file";
}

export function extensionFor(filename: string): string {
  const extension = extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".bin";
}

export function jobUploadPath(config: OpenSepConfig, jobId: string, originalName: string): string {
  return resolve(config.uploadsDir, jobId, `input${extensionFor(originalName)}`);
}

export function jobWorkDir(config: OpenSepConfig, jobId: string): string {
  return resolve(config.workDir, jobId);
}

export function jobResultsDir(config: OpenSepConfig, jobId: string): string {
  return resolve(config.resultsDir, jobId);
}

export function assertPathWithin(parent: string, candidate: string): string {
  const resolvedParent = resolve(parent);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedParent && !resolvedCandidate.startsWith(`${resolvedParent}${sep}`)) {
    throw new Error("Resolved path escapes its storage boundary");
  }
  return resolvedCandidate;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

export async function removeJobFiles(config: OpenSepConfig, jobId: string): Promise<void> {
  await Promise.all([
    rm(assertPathWithin(config.uploadsDir, resolve(config.uploadsDir, jobId)), { recursive: true, force: true }),
    rm(assertPathWithin(config.workDir, resolve(config.workDir, jobId)), { recursive: true, force: true }),
    rm(assertPathWithin(config.resultsDir, resolve(config.resultsDir, jobId)), { recursive: true, force: true }),
  ]);
}
