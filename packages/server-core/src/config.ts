import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";

export interface OpenSepConfig {
  readonly rootDir: string;
  readonly dataDir: string;
  readonly databasePath: string;
  readonly uploadsDir: string;
  readonly workDir: string;
  readonly resultsDir: string;
  readonly host: string;
  readonly port: number;
  readonly publicUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly maxUploadBytes: number;
  readonly maxRemoteBytes: number;
  readonly maxBatchFiles: number;
  readonly maxBatchBytes: number;
  readonly retentionHours: number;
  readonly runnerConcurrency: number;
  readonly pythonCommand: string;
  readonly ffmpegCommand: string;
  readonly ffprobeCommand: string;
  readonly workerScript: string;
  readonly audioSepPython: string;
  readonly audioSepRoot: string;
  readonly audioSepAdapter: string;
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadConfig(): OpenSepConfig {
  const packageRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const rootDir = resolve(process.env.OPENSEP_ROOT_DIR ?? packageRoot);
  const dataDir = resolve(rootDir, process.env.OPENSEP_DATA_DIR ?? "data");
  const host = process.env.OPENSEP_HOST ?? "127.0.0.1";
  const port = readPositiveInteger("OPENSEP_API_PORT", 8787);
  const localPython = resolve(rootDir, ".venv", "Scripts", "python.exe");
  const audioSepPython = resolve(rootDir, ".audiosep-venv", "Scripts", "python.exe");
  const wingetFfmpeg = findWingetFfmpeg("ffmpeg.exe");
  const wingetFfprobe = findWingetFfmpeg("ffprobe.exe");

  return {
    rootDir,
    dataDir,
    databasePath: resolve(dataDir, "opensep.sqlite"),
    uploadsDir: resolve(dataDir, "uploads"),
    workDir: resolve(dataDir, "work"),
    resultsDir: resolve(dataDir, "results"),
    host,
    port,
    publicUrl: process.env.OPENSEP_PUBLIC_URL ?? `http://${host}:${port}`,
    allowedOrigins: (process.env.OPENSEP_ALLOWED_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173")
      .split(",").map((origin) => origin.trim()).filter(Boolean),
    maxUploadBytes: readPositiveInteger("OPENSEP_MAX_UPLOAD_BYTES", 1_048_576_000),
    maxRemoteBytes: readPositiveInteger("OPENSEP_MAX_REMOTE_BYTES", 1_048_576_000),
    maxBatchFiles: readPositiveInteger("OPENSEP_MAX_BATCH_FILES", 20),
    maxBatchBytes: readPositiveInteger("OPENSEP_MAX_BATCH_BYTES", 3_221_225_472),
    retentionHours: readPositiveInteger("OPENSEP_JOB_RETENTION_HOURS", 24),
    runnerConcurrency: readPositiveInteger("OPENSEP_RUNNER_CONCURRENCY", 1),
    pythonCommand: process.env.OPENSEP_PYTHON ?? (existsSync(localPython) ? localPython : "python"),
    ffmpegCommand: process.env.OPENSEP_FFMPEG ?? wingetFfmpeg ?? "ffmpeg",
    ffprobeCommand: process.env.OPENSEP_FFPROBE ?? wingetFfprobe ?? "ffprobe",
    workerScript: resolve(rootDir, "worker", "opensep_worker", "__main__.py"),
    audioSepPython: process.env.OPENSEP_AUDIOSEP_PYTHON ?? audioSepPython,
    audioSepRoot: resolve(process.env.OPENSEP_AUDIOSEP_ROOT ?? resolve(rootDir, "vendor", "AudioSep")),
    audioSepAdapter: resolve(rootDir, "worker", "audiosep_adapter.py"),
  };
}

function findWingetFfmpeg(executable: "ffmpeg.exe" | "ffprobe.exe"): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const packageRoot = resolve(localAppData, "Microsoft", "WinGet", "Packages");
  if (!existsSync(packageRoot)) return null;
  const packageName = readdirSync(packageRoot).find((name) => name.startsWith("Gyan.FFmpeg_"));
  if (!packageName) return null;
  const packagePath = resolve(packageRoot, packageName);
  const distribution = readdirSync(packagePath).find((name) => name.startsWith("ffmpeg-") && name.endsWith("-full_build"));
  if (!distribution) return null;
  const candidate = resolve(packagePath, distribution, "bin", executable);
  return existsSync(candidate) ? candidate : null;
}
