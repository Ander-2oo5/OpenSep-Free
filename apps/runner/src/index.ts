import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  workerEventSchema,
  type WorkerEvent,
  type WorkerManifest,
} from "@opensep/contracts";
import {
  assertPathWithin,
  ensureStorage,
  fileSize,
  jobResultsDir,
  jobWorkDir,
  JobRepository,
  loadConfig,
  removeJobFiles,
  sha256File,
  type ClaimedJob,
  type OpenSepConfig,
} from "@opensep/server-core";

const config = loadConfig();
await ensureStorage(config);
const repository = new JobRepository(config.databasePath);
const runnerId = `runner-${process.pid}-${randomUUID()}`;
const leaseMs = 30_000;
let shuttingDown = false;

process.on("SIGINT", () => { shuttingDown = true; });
process.on("SIGTERM", () => { shuttingDown = true; });

interface PendingArtifact {
  readonly stem: string;
  readonly path: string;
  readonly mime: string;
}

function terminateChild(child: { readonly exitCode: number | null; kill(signal?: NodeJS.Signals): boolean }): void {
  if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 5_000).unref();
}

async function processJob(job: ClaimedJob): Promise<void> {
  const workRoot = jobWorkDir(config, job.id);
  const stagedResults = resolve(workRoot, "results");
  const finalResults = jobResultsDir(config, job.id);
  await rm(workRoot, { recursive: true, force: true });
  await rm(finalResults, { recursive: true, force: true });
  await mkdir(stagedResults, { recursive: true });
  const manifest: WorkerManifest = {
    protocolVersion: 1,
    jobId: job.id,
    inputPath: job.inputPath,
    workDir: resolve(workRoot, "processor"),
    resultsDir: stagedResults,
    profileId: job.profileId,
    outputFormat: job.outputFormat,
  };
  const manifestPath = resolve(workRoot, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest), { encoding: "utf8", flag: "wx" });

  const child = spawn(config.pythonCommand, [config.workerScript, "--manifest", manifestPath], {
    cwd: config.rootDir,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENSEP_FFMPEG: config.ffmpegCommand,
      OPENSEP_FFPROBE: config.ffprobeCommand,
      OPENSEP_AUDIOSEP_PYTHON: config.audioSepPython,
      OPENSEP_AUDIOSEP_ROOT: config.audioSepRoot,
      OPENSEP_AUDIOSEP_ADAPTER: config.audioSepAdapter,
    },
  });
  const artifacts: PendingArtifact[] = [];
  let completed = false;
  let protocolError: Error | null = null;
  let stderr = "";

  const leaseTimer = setInterval(() => {
    if (!repository.renewLease(job.id, runnerId, leaseMs)) terminateChild(child);
  }, 10_000);
  const cancelTimer = setInterval(() => {
    if (repository.isCancellationRequested(job.id)) terminateChild(child);
  }, 500);

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000);
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = workerEventSchema.parse(JSON.parse(line) as unknown);
      handleWorkerEvent(job.id, event, artifacts);
      if (event.type === "completed") completed = true;
      if (event.type === "error") protocolError = new Error(`${event.code}: ${event.message}`);
    } catch (error) {
      protocolError = error instanceof Error ? error : new Error(String(error));
      terminateChild(child);
      break;
    }
  }

  const exitCode = await new Promise<number | null>((resolveExit) => {
    if (child.exitCode !== null) resolveExit(child.exitCode);
    else child.once("exit", (code) => resolveExit(code));
  });
  clearInterval(leaseTimer);
  clearInterval(cancelTimer);

  if (repository.isCancellationRequested(job.id)) {
    repository.markCancelled(job.id);
    await rm(workRoot, { recursive: true, force: true });
    return;
  }
  if (protocolError || exitCode !== 0 || !completed || artifacts.length === 0) {
    const detail = protocolError?.message ?? (stderr.trim() || `El worker terminó con código ${String(exitCode)}.`);
    repository.failJob(job.id, "PROCESSING_FAILED", detail.slice(0, 500));
    await rm(workRoot, { recursive: true, force: true });
    return;
  }

  await mkdir(resolve(finalResults, ".."), { recursive: true });
  await rename(stagedResults, finalResults);
  const publishedArtifacts = [];
  for (const artifact of artifacts) {
    const stagedPath = assertPathWithin(stagedResults, artifact.path);
    const finalPath = assertPathWithin(finalResults, resolve(finalResults, basename(stagedPath)));
    publishedArtifacts.push({
      job_id: job.id,
      stem: artifact.stem,
      path: finalPath,
      filename: basename(finalPath),
      mime: artifact.mime,
      bytes: await fileSize(finalPath),
      sha256: await sha256File(finalPath),
    });
  }
  repository.publishArtifactsAndComplete(job.id, publishedArtifacts);
  await rm(workRoot, { recursive: true, force: true });
}

function handleWorkerEvent(jobId: string, event: WorkerEvent, artifacts: PendingArtifact[]): void {
  switch (event.type) {
    case "ready":
      repository.setProgress(jobId, "preparing", 5, "Procesador preparado");
      return;
    case "progress":
      repository.setProgress(jobId, event.stage, event.progress, event.message);
      return;
    case "artifact":
      artifacts.push({ stem: event.stem, path: event.path, mime: event.mime });
      return;
    case "completed":
    case "error":
      return;
  }
}

async function cleanupExpiredJobs(): Promise<void> {
  for (const jobId of repository.expiredTerminalJobIds()) {
    await removeJobFiles(config, jobId);
    repository.deleteJob(jobId);
  }
}

async function workerLoop(): Promise<void> {
  while (!shuttingDown) {
    repository.recoverExpiredLeases();
    const job = repository.claimNextJob(runnerId, leaseMs);
    if (!job) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
      continue;
    }
    try {
      await processJob(job);
    } catch (error) {
      repository.failJob(job.id, "RUNNER_FAILED", error instanceof Error ? error.message : String(error));
    }
  }
}

await cleanupExpiredJobs();
const cleanupTimer = setInterval(() => void cleanupExpiredJobs(), 60 * 60 * 1_000);
cleanupTimer.unref();
await Promise.all(Array.from({ length: config.runnerConcurrency }, () => workerLoop()));
repository.close();
