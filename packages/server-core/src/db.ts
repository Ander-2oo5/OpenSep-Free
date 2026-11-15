import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  Artifact,
  Job,
  JobEvent,
  JobKind,
  JobState,
  OutputFormat,
  ProfileId,
} from "@opensep/contracts";
import { assertTransition, isTerminal } from "./state.js";

interface JobRow {
  id: string;
  batch_id: string | null;
  kind: JobKind;
  state: JobState;
  progress: number;
  profile_id: ProfileId;
  output_format: OutputFormat;
  original_name: string;
  input_path: string;
  remote_url: string | null;
  publish_to_demo: number;
  error_code: string | null;
  error_message: string | null;
  cancel_requested_at: string | null;
  runner_id: string | null;
  lease_expires_at: string | null;
  attempts: number;
  version: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string;
}

interface ArtifactRow {
  id: string;
  job_id: string;
  stem: string;
  path: string;
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
}

interface EventRow {
  id: number;
  job_id: string;
  type: string;
  payload_json: string;
  created_at: string;
}

export interface CreateJobInput {
  readonly id?: string;
  readonly batchId?: string | null;
  readonly kind: JobKind;
  readonly profileId: ProfileId;
  readonly outputFormat: OutputFormat;
  readonly originalName: string;
  readonly inputPath: string;
  readonly remoteUrl?: string | null;
  readonly publishToDemo?: boolean;
  readonly idempotencyKey?: string | null;
  readonly retentionHours: number;
}

export interface ClaimedJob {
  readonly id: string;
  readonly state: JobState;
  readonly profileId: ProfileId;
  readonly outputFormat: OutputFormat;
  readonly originalName: string;
  readonly inputPath: string;
  readonly attempts: number;
  readonly version: number;
}

export interface PendingArtifactInput {
  readonly job_id: string;
  readonly stem: string;
  readonly path: string;
  readonly filename: string;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: string;
}

const migration = `
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('upload', 'remote')),
  state TEXT NOT NULL CHECK (state IN ('queued','preparing','processing','encoding','cancelling','completed','failed','cancelled')),
  progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  profile_id TEXT NOT NULL,
  output_format TEXT NOT NULL,
  original_name TEXT NOT NULL,
  input_path TEXT NOT NULL,
  remote_url TEXT,
  publish_to_demo INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  error_code TEXT,
  error_message TEXT,
  cancel_requested_at TEXT,
  runner_id TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(state, created_at);
CREATE INDEX IF NOT EXISTS jobs_batch_idx ON jobs(batch_id);
CREATE INDEX IF NOT EXISTS jobs_expiry_idx ON jobs(expires_at, state);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stem TEXT NOT NULL,
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_job_idx ON artifacts(job_id);

CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_events_job_idx ON job_events(job_id, id);
`;

export class JobRepository {
  readonly #db: DatabaseSync;

  constructor(databasePath: string) {
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.#db.exec(migration);
  }

  close(): void {
    this.#db.close();
  }

  createBatch(name: string): string {
    const id = randomUUID();
    this.#db.prepare("INSERT INTO batches (id, name, created_at) VALUES (?, ?, ?)")
      .run(id, name, new Date().toISOString());
    return id;
  }

  createBatchWithJobs(name: string, inputs: readonly CreateJobInput[]): { readonly id: string; readonly jobs: Job[] } {
    const batchId = randomUUID();
    const now = new Date();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("INSERT INTO batches (id, name, created_at) VALUES (?, ?, ?)")
        .run(batchId, name, now.toISOString());
      const insert = this.#db.prepare(`
        INSERT INTO jobs (
          id, batch_id, kind, state, progress, profile_id, output_format,
          original_name, input_path, remote_url, publish_to_demo, idempotency_key,
          created_at, expires_at
        ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const input of inputs) {
        const id = input.id ?? randomUUID();
        const expiresAt = new Date(now.getTime() + input.retentionHours * 3_600_000).toISOString();
        insert.run(
          id,
          batchId,
          input.kind,
          input.profileId,
          input.outputFormat,
          input.originalName,
          input.inputPath,
          input.remoteUrl ?? null,
          input.publishToDemo ? 1 : 0,
          input.idempotencyKey ?? null,
          now.toISOString(),
          expiresAt,
        );
        this.#insertEvent(id, "queued", { progress: 0 });
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    const batch = this.getBatch(batchId);
    if (!batch) throw new Error("Created batch could not be read");
    return { id: batch.id, jobs: batch.jobs };
  }

  createJob(input: CreateJobInput): Job {
    const id = input.id ?? randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.retentionHours * 3_600_000).toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (input.idempotencyKey) {
        const existing = this.#db.prepare("SELECT id FROM jobs WHERE idempotency_key = ?")
          .get(input.idempotencyKey) as { id: string } | undefined;
        if (existing) {
          this.#db.exec("COMMIT");
          const job = this.getJob(existing.id);
          if (!job) throw new Error("Idempotent job disappeared");
          return job;
        }
      }
      this.#db.prepare(`
        INSERT INTO jobs (
          id, batch_id, kind, state, progress, profile_id, output_format,
          original_name, input_path, remote_url, publish_to_demo, idempotency_key,
          created_at, expires_at
        ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.batchId ?? null,
        input.kind,
        input.profileId,
        input.outputFormat,
        input.originalName,
        input.inputPath,
        input.remoteUrl ?? null,
        input.publishToDemo ? 1 : 0,
        input.idempotencyKey ?? null,
        now.toISOString(),
        expiresAt,
      );
      this.#insertEvent(id, "queued", { progress: 0 });
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    const job = this.getJob(id);
    if (!job) throw new Error("Created job could not be read");
    return job;
  }

  getJob(id: string): Job | null {
    const row = this.#db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as unknown as JobRow | undefined;
    if (!row) return null;
    const artifacts = this.#db.prepare("SELECT * FROM artifacts WHERE job_id = ? ORDER BY stem, id")
      .all(id) as unknown as ArtifactRow[];
    return this.#mapJob(row, artifacts);
  }

  listJobs(options: { readonly limit?: number; readonly completedOnly?: boolean } = {}): Job[] {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const rows = options.completedOnly
      ? this.#db.prepare("SELECT * FROM jobs WHERE state = 'completed' AND publish_to_demo = 1 ORDER BY finished_at DESC LIMIT ?").all(limit)
      : this.#db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit);
    return (rows as unknown as JobRow[]).map((row) => {
      const artifacts = this.#db.prepare("SELECT * FROM artifacts WHERE job_id = ? ORDER BY stem, id")
        .all(row.id) as unknown as ArtifactRow[];
      return this.#mapJob(row, artifacts);
    });
  }

  getBatch(id: string): { readonly id: string; readonly name: string; readonly jobs: Job[] } | null {
    const batch = this.#db.prepare("SELECT id, name FROM batches WHERE id = ?").get(id) as { id: string; name: string } | undefined;
    if (!batch) return null;
    const rows = this.#db.prepare("SELECT * FROM jobs WHERE batch_id = ? ORDER BY created_at")
      .all(id) as unknown as JobRow[];
    return {
      ...batch,
      jobs: rows.map((row) => {
        const artifacts = this.#db.prepare("SELECT * FROM artifacts WHERE job_id = ? ORDER BY stem, id")
          .all(row.id) as unknown as ArtifactRow[];
        return this.#mapJob(row, artifacts);
      }),
    };
  }

  claimNextJob(runnerId: string, leaseMs: number): ClaimedJob | null {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#db.prepare("SELECT * FROM jobs WHERE state = 'queued' AND attempts < 3 ORDER BY created_at LIMIT 1")
        .get() as unknown as JobRow | undefined;
      if (!row) {
        this.#db.exec("COMMIT");
        return null;
      }
      const now = new Date();
      const lease = new Date(now.getTime() + leaseMs).toISOString();
      const result = this.#db.prepare(`
        UPDATE jobs
        SET state = 'preparing', progress = MAX(progress, 2), runner_id = ?,
            lease_expires_at = ?, attempts = attempts + 1, version = version + 1,
            started_at = COALESCE(started_at, ?)
        WHERE id = ? AND state = 'queued' AND version = ?
      `).run(runnerId, lease, now.toISOString(), row.id, row.version);
      if (result.changes !== 1) throw new Error("Concurrent job claim detected");
      this.#insertEvent(row.id, "state", { state: "preparing", progress: 2 });
      this.#db.exec("COMMIT");
      return {
        id: row.id,
        state: "preparing",
        profileId: row.profile_id,
        outputFormat: row.output_format,
        originalName: row.original_name,
        inputPath: row.input_path,
        attempts: row.attempts + 1,
        version: row.version + 1,
      };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  renewLease(jobId: string, runnerId: string, leaseMs: number): boolean {
    const lease = new Date(Date.now() + leaseMs).toISOString();
    const result = this.#db.prepare(`
      UPDATE jobs SET lease_expires_at = ?, version = version + 1
      WHERE id = ? AND runner_id = ? AND state IN ('preparing','processing','encoding','cancelling')
    `).run(lease, jobId, runnerId);
    return result.changes === 1;
  }

  setProgress(jobId: string, state: JobState, progress: number, message: string): void {
    const row = this.#db.prepare("SELECT state, progress, version FROM jobs WHERE id = ?")
      .get(jobId) as { state: JobState; progress: number; version: number } | undefined;
    if (!row) throw new Error("Job not found");
    if (row.state === "cancelling") return;
    if (row.state !== state) assertTransition(row.state, state);
    const nextProgress = Math.max(row.progress, Math.min(100, progress));
    const result = this.#db.prepare(`
      UPDATE jobs SET state = ?, progress = ?, version = version + 1
      WHERE id = ? AND version = ?
    `).run(state, nextProgress, jobId, row.version);
    if (result.changes !== 1) throw new Error("Concurrent job update detected");
    this.#insertEvent(jobId, "progress", { state, progress: nextProgress, message });
  }

  addArtifact(input: Omit<ArtifactRow, "id" | "filename"> & { readonly filename: string }): Artifact {
    const id = randomUUID();
    this.#db.prepare(`
      INSERT INTO artifacts (id, job_id, stem, path, filename, mime, bytes, sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.job_id, input.stem, input.path, input.filename, input.mime, input.bytes, input.sha256, new Date().toISOString());
    this.#insertEvent(input.job_id, "artifact", { artifactId: id, stem: input.stem, filename: input.filename });
    return {
      id,
      jobId: input.job_id,
      stem: input.stem,
      filename: input.filename,
      mime: input.mime,
      bytes: input.bytes,
      sha256: input.sha256,
      downloadUrl: `/api/jobs/${input.job_id}/artifacts/${id}`,
    };
  }

  publishArtifactsAndComplete(jobId: string, artifacts: readonly PendingArtifactInput[]): void {
    const row = this.#db.prepare("SELECT state, version FROM jobs WHERE id = ?")
      .get(jobId) as { state: JobState; version: number } | undefined;
    if (!row) throw new Error("Job not found");
    assertTransition(row.state, "completed");
    const now = new Date().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.#db.prepare(`
        INSERT INTO artifacts (id, job_id, stem, path, filename, mime, bytes, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const artifact of artifacts) {
        const artifactId = randomUUID();
        insert.run(
          artifactId,
          jobId,
          artifact.stem,
          artifact.path,
          artifact.filename,
          artifact.mime,
          artifact.bytes,
          artifact.sha256,
          now,
        );
        this.#insertEvent(jobId, "artifact", { artifactId, stem: artifact.stem, filename: artifact.filename });
      }
      const result = this.#db.prepare(`
        UPDATE jobs SET state = 'completed', progress = 100, finished_at = ?,
          runner_id = NULL, lease_expires_at = NULL, version = version + 1
        WHERE id = ? AND version = ?
      `).run(now, jobId, row.version);
      if (result.changes !== 1) throw new Error("Concurrent completion detected");
      this.#insertEvent(jobId, "completed", { progress: 100 });
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  getArtifact(jobId: string, artifactId: string): ArtifactRow | null {
    return (this.#db.prepare("SELECT * FROM artifacts WHERE id = ? AND job_id = ?")
      .get(artifactId, jobId) as unknown as ArtifactRow | undefined) ?? null;
  }

  completeJob(jobId: string): void {
    const row = this.#db.prepare("SELECT state, version FROM jobs WHERE id = ?")
      .get(jobId) as { state: JobState; version: number } | undefined;
    if (!row) throw new Error("Job not found");
    assertTransition(row.state, "completed");
    const now = new Date().toISOString();
    const result = this.#db.prepare(`
      UPDATE jobs SET state = 'completed', progress = 100, finished_at = ?,
        runner_id = NULL, lease_expires_at = NULL, version = version + 1
      WHERE id = ? AND version = ?
    `).run(now, jobId, row.version);
    if (result.changes !== 1) throw new Error("Concurrent completion detected");
    this.#insertEvent(jobId, "completed", { progress: 100 });
  }

  failJob(jobId: string, code: string, message: string): void {
    const row = this.#db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state: JobState } | undefined;
    if (!row || isTerminal(row.state)) return;
    const now = new Date().toISOString();
    this.#db.prepare(`
      UPDATE jobs SET state = 'failed', error_code = ?, error_message = ?, finished_at = ?,
        runner_id = NULL, lease_expires_at = NULL, version = version + 1 WHERE id = ?
    `).run(code, message, now, jobId);
    this.#insertEvent(jobId, "failed", { code, message });
  }

  requestCancel(jobId: string): Job | null {
    const row = this.#db.prepare("SELECT state, version FROM jobs WHERE id = ?")
      .get(jobId) as { state: JobState; version: number } | undefined;
    if (!row) return null;
    if (isTerminal(row.state)) return this.getJob(jobId);
    const now = new Date().toISOString();
    if (row.state === "queued") {
      this.#db.prepare(`
        UPDATE jobs SET state = 'cancelled', cancel_requested_at = ?, finished_at = ?, version = version + 1
        WHERE id = ? AND version = ?
      `).run(now, now, jobId, row.version);
      this.#insertEvent(jobId, "cancelled", {});
    } else {
      this.#db.prepare(`
        UPDATE jobs SET state = 'cancelling', cancel_requested_at = ?, version = version + 1
        WHERE id = ? AND version = ?
      `).run(now, jobId, row.version);
      this.#insertEvent(jobId, "state", { state: "cancelling" });
    }
    return this.getJob(jobId);
  }

  isCancellationRequested(jobId: string): boolean {
    const row = this.#db.prepare("SELECT cancel_requested_at FROM jobs WHERE id = ?")
      .get(jobId) as { cancel_requested_at: string | null } | undefined;
    return row?.cancel_requested_at !== null && row?.cancel_requested_at !== undefined;
  }

  markCancelled(jobId: string): void {
    const row = this.#db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state: JobState } | undefined;
    if (!row || isTerminal(row.state)) return;
    const now = new Date().toISOString();
    this.#db.prepare(`
      UPDATE jobs SET state = 'cancelled', finished_at = ?, runner_id = NULL,
        lease_expires_at = NULL, version = version + 1 WHERE id = ?
    `).run(now, jobId);
    this.#insertEvent(jobId, "cancelled", {});
  }

  listEventsAfter(jobId: string, afterId: number): JobEvent[] {
    const rows = this.#db.prepare(`
      SELECT id, job_id, type, payload_json, created_at FROM job_events
      WHERE job_id = ? AND id > ? ORDER BY id LIMIT 500
    `).all(jobId, afterId) as unknown as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      type: row.type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  recoverExpiredLeases(maxAttempts = 3): number {
    const now = new Date().toISOString();
    const rows = this.#db.prepare(`
      SELECT id, attempts, cancel_requested_at FROM jobs
      WHERE state IN ('preparing','processing','encoding','cancelling')
        AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
    `).all(now) as unknown as Array<{ id: string; attempts: number; cancel_requested_at: string | null }>;
    for (const row of rows) {
      if (row.cancel_requested_at) {
        this.markCancelled(row.id);
      } else if (row.attempts >= maxAttempts) {
        this.failJob(row.id, "PROCESSOR_RETRY_EXHAUSTED", "El procesador se interrumpió demasiadas veces.");
      } else {
        this.#db.prepare(`
          UPDATE jobs SET state = 'queued', runner_id = NULL, lease_expires_at = NULL,
            error_code = NULL, error_message = NULL, version = version + 1 WHERE id = ?
        `).run(row.id);
        this.#insertEvent(row.id, "requeued", { reason: "expired_lease" });
      }
    }
    return rows.length;
  }

  expiredTerminalJobIds(): string[] {
    const now = new Date().toISOString();
    const rows = this.#db.prepare(`
      SELECT id FROM jobs WHERE expires_at < ? AND state IN ('completed','failed','cancelled')
    `).all(now) as unknown as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  deleteJob(id: string): void {
    this.#db.prepare("DELETE FROM jobs WHERE id = ? AND state IN ('completed','failed','cancelled')").run(id);
  }

  #insertEvent(jobId: string, type: string, payload: Readonly<Record<string, unknown>>): void {
    this.#db.prepare("INSERT INTO job_events (job_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)")
      .run(jobId, type, JSON.stringify(payload), new Date().toISOString());
  }

  #mapJob(row: JobRow, artifacts: readonly ArtifactRow[]): Job {
    return {
      id: row.id,
      batchId: row.batch_id,
      kind: row.kind,
      state: row.state,
      progress: row.progress,
      profileId: row.profile_id,
      outputFormat: row.output_format,
      originalName: row.original_name,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      expiresAt: row.expires_at,
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        jobId: artifact.job_id,
        stem: artifact.stem,
        filename: artifact.filename,
        mime: artifact.mime,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        downloadUrl: `/api/jobs/${artifact.job_id}/artifacts/${artifact.id}`,
      })),
    };
  }
}
