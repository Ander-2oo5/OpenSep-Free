import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { JobRepository } from "../src/db.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<JobRepository> {
  const root = await mkdtemp(join(tmpdir(), "opensep-db-"));
  roots.push(root);
  return new JobRepository(join(root, "test.sqlite"));
}

describe("JobRepository", () => {
  it("claims a queued job exactly once", async () => {
    const repo = await repository();
    const job = repo.createJob({
      kind: "upload",
      profileId: "four-stems",
      outputFormat: "wav-16",
      originalName: "canción 🎵.wav",
      inputPath: "D:/input.wav",
      retentionHours: 1,
    });
    expect(repo.claimNextJob("runner-a", 30_000)?.id).toBe(job.id);
    expect(repo.claimNextJob("runner-b", 30_000)).toBeNull();
    repo.close();
  });

  it("cancels a queued job without running it", async () => {
    const repo = await repository();
    const job = repo.createJob({
      kind: "upload",
      profileId: "vocals",
      outputFormat: "mp3-320",
      originalName: "voice.mp3",
      inputPath: "D:/voice.mp3",
      retentionHours: 1,
    });
    expect(repo.requestCancel(job.id)?.state).toBe("cancelled");
    expect(repo.claimNextJob("runner", 30_000)).toBeNull();
    repo.close();
  });

  it("deduplicates idempotent job creation", async () => {
    const repo = await repository();
    const first = repo.createJob({
      kind: "upload", profileId: "vocals", outputFormat: "flac-24",
      originalName: "a.wav", inputPath: "D:/a.wav", retentionHours: 1, idempotencyKey: "same-request",
    });
    const second = repo.createJob({
      kind: "upload", profileId: "vocals", outputFormat: "flac-24",
      originalName: "b.wav", inputPath: "D:/b.wav", retentionHours: 1, idempotencyKey: "same-request",
    });
    expect(second.id).toBe(first.id);
    repo.close();
  });

  it("creates every job in a batch atomically", async () => {
    const repo = await repository();
    const batch = repo.createBatchWithJobs("Lote", ["one.wav", "two.wav"].map((originalName) => ({
      kind: "upload" as const, profileId: "vocals" as const, outputFormat: "wav-16" as const,
      originalName, inputPath: `D:/${originalName}`, retentionHours: 1,
    })));
    expect(batch.jobs.map((job) => job.originalName)).toEqual(["one.wav", "two.wav"]);
    expect(repo.getBatch(batch.id)?.jobs).toHaveLength(2);
    repo.close();
  });
});
