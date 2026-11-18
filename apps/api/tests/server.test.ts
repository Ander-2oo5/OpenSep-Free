import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { CapabilitiesResponse } from "@opensep/contracts";
import { JobRepository, type OpenSepConfig } from "@opensep/server-core";
import { buildServer } from "../src/server.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "opensep-api-"));
  roots.push(root);
  const config: OpenSepConfig = {
    rootDir: root, dataDir: join(root, "data"), databasePath: join(root, "data", "db.sqlite"),
    uploadsDir: join(root, "data", "uploads"), workDir: join(root, "data", "work"), resultsDir: join(root, "data", "results"),
    host: "127.0.0.1", port: 0, publicUrl: "http://127.0.0.1", allowedOrigins: ["http://127.0.0.1:5173"], maxUploadBytes: 1_000_000,
    maxRemoteBytes: 1_000_000, maxBatchFiles: 20, maxBatchBytes: 3_000_000, retentionHours: 1, runnerConcurrency: 1,
    pythonCommand: "python", ffmpegCommand: "ffmpeg", ffprobeCommand: "ffprobe", workerScript: join(root, "worker.py"),
    audioSepPython: join(root, "audiosep-python.exe"), audioSepRoot: join(root, "AudioSep"), audioSepAdapter: join(root, "audiosep_adapter.py"),
  };
  await (await import("node:fs/promises")).mkdir(config.dataDir, { recursive: true });
  await mkdir(join(root, "apps", "web", "dist"), { recursive: true });
  await writeFile(join(root, "apps", "web", "dist", "index.html"), "<!doctype html><title>OpenSep</title><main>Aplicación local</main>");
  const repository = new JobRepository(config.databasePath);
  const capabilities: CapabilitiesResponse = {
    checkedAt: new Date().toISOString(), python: true, ffmpeg: true, ffprobe: true, processor: true,
    capabilities: [{ id: "vocals", name: "Voz", description: "Test", stems: ["vocals", "instrumental"], available: true, status: "ready", reason: null }],
  };
  const app = await buildServer({ config, repository, logger: false, capabilitiesOverride: capabilities });
  return { app, repository, config };
}

describe("API", () => {
  it("serves the production web app and preserves API 404 responses", async () => {
    const { app } = await fixture();
    const home = await app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.headers["content-type"]).toContain("text/html");
    expect(home.body).toContain("Aplicación local");
    const spa = await app.inject({ method: "GET", url: "/jobs/example" });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain("Aplicación local");
    const missingApi = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json().error.code).toBe("API_ROUTE_NOT_FOUND");
    const apiRoot = await app.inject({ method: "GET", url: "/api" });
    expect(apiRoot.statusCode).toBe(404);
    expect(apiRoot.json().error.code).toBe("API_ROUTE_NOT_FOUND");
    await app.close();
  });

  it("returns a stable not-found error", async () => {
    const { app } = await fixture();
    const response = await app.inject({ method: "GET", url: "/api/jobs/00000000-0000-0000-0000-000000000000" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("JOB_NOT_FOUND");
    await app.close();
  });

  it("creates and cancels an uploaded job", async () => {
    const { app } = await fixture();
    const boundary = "----opensep-test-boundary";
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="profileId"\r\n\r\nvocals\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="outputFormat"\r\n\r\nmp3-320\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="demo.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFFfake-audio\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const created = await app.inject({ method: "POST", url: "/api/jobs", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(created.statusCode).toBe(201);
    const id = created.json().job.id as string;
    const cancelled = await app.inject({ method: "POST", url: `/api/jobs/${id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().job.state).toBe("cancelled");
    await app.close();
  });

  it("rejects malformed remote input as validation error", async () => {
    const { app } = await fixture();
    const response = await app.inject({ method: "POST", url: "/api/jobs/remote", payload: { url: "not-a-url" } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("keeps demo=false false and preserves Fastify client errors", async () => {
    const { app, repository, config } = await fixture();
    repository.createJob({
      kind: "upload", profileId: "vocals", outputFormat: "wav-16",
      originalName: "private.wav", inputPath: join(config.uploadsDir, "private.wav"), retentionHours: 1,
    });
    const listed = await app.inject({ method: "GET", url: "/api/jobs?demo=false" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().jobs).toHaveLength(1);
    const unsupported = await app.inject({ method: "POST", url: "/api/jobs", headers: { "content-type": "text/plain" }, payload: "x" });
    expect(unsupported.statusCode).toBe(406);
    expect(unsupported.json().error.code).toBe("BAD_REQUEST");
    await app.close();
  });

  it("creates a batch whose complete job list remains queryable", async () => {
    const { app } = await fixture();
    const boundary = "----opensep-batch-boundary";
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nMi lote\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="profileId"\r\n\r\nvocals\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="outputFormat"\r\n\r\nwav-16\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="uno.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFFone\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="dos.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFFtwo\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const created = await app.inject({ method: "POST", url: "/api/batches", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(created.statusCode).toBe(201);
    expect(created.json().batch.jobs).toHaveLength(2);
    const loaded = await app.inject({ method: "GET", url: `/api/batches/${created.json().batch.id}` });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().batch.name).toBe("Mi lote");
    expect(loaded.json().batch.jobs).toHaveLength(2);
    await app.close();
  });

  it("downloads completed artifacts as a ZIP archive", async () => {
    const { app, repository, config } = await fixture();
    const job = repository.createJob({
      kind: "upload", profileId: "vocals", outputFormat: "wav-16",
      originalName: "sample.wav", inputPath: join(config.uploadsDir, "sample.wav"), retentionHours: 1,
    });
    repository.claimNextJob("test-runner", 30_000);
    repository.setProgress(job.id, "processing", 50, "Separando");
    repository.setProgress(job.id, "encoding", 90, "Codificando");
    const resultDir = join(config.resultsDir, job.id);
    await mkdir(resultDir, { recursive: true });
    const artifactPath = join(resultDir, "vocals.wav");
    await writeFile(artifactPath, "RIFF");
    repository.addArtifact({
      job_id: job.id, stem: "vocals", path: artifactPath, filename: "vocals.wav",
      mime: "audio/wav", bytes: 4, sha256: "a".repeat(64),
    });
    repository.completeJob(job.id);
    const response = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/download.zip` });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.subarray(0, 2).toString("ascii")).toBe("PK");
    await app.close();
  });
});
