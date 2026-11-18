import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import archiver from "archiver";
import {
  outputFormatSchema,
  profileIdSchema,
  remoteJobRequestSchema,
  type ApiErrorBody,
  type CapabilitiesResponse,
  type Job,
} from "@opensep/contracts";
import {
  assertPathWithin,
  detectCapabilities,
  downloadRemoteFile,
  ensureStorage,
  jobUploadPath,
  JobRepository,
  loadConfig,
  normalizeProviderUrl,
  RemoteFetchError,
  safeDisplayName,
  type OpenSepConfig,
} from "@opensep/server-core";
import { z } from "zod";

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

interface ServerOptions {
  readonly config?: OpenSepConfig;
  readonly repository?: JobRepository;
  readonly logger?: boolean;
  readonly capabilitiesOverride?: CapabilitiesResponse;
}

function errorBody(request: FastifyRequest, error: ApiError): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId: request.id,
      ...(error.field ? { field: error.field } : {}),
    },
  };
}

function fieldValue(fields: Readonly<Record<string, string>>, name: string): string {
  const value = fields[name];
  if (!value) throw new ApiError(422, "VALIDATION_ERROR", `Falta el campo ${name}.`, name);
  return value;
}

function parseBoolean(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "on";
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const webMimeTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  await ensureStorage(config);
  const repository = options.repository ?? new JobRepository(config.databasePath);
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: config.maxUploadBytes + 1_048_576 });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) callback(null, true);
      else callback(new ApiError(403, "ORIGIN_NOT_ALLOWED", "Este origen no puede usar la API local."), false);
    },
  });
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 100, fields: 20, parts: 120 },
  });

  let capabilityCache: CapabilitiesResponse | null = null;
  let capabilityCheckedAt = 0;
  async function capabilities(force = false): Promise<CapabilitiesResponse> {
    if (options.capabilitiesOverride) return options.capabilitiesOverride;
    if (force || !capabilityCache || Date.now() - capabilityCheckedAt > 15_000) {
      capabilityCache = await detectCapabilities(config);
      capabilityCheckedAt = Date.now();
    }
    return capabilityCache;
  }

  async function requireProfile(profileId: string): Promise<void> {
    const parsed = profileIdSchema.safeParse(profileId);
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "El perfil de separación no es válido.", "profileId");
    const available = (await capabilities()).capabilities.find((item) => item.id === parsed.data);
    if (!available?.available) {
      throw new ApiError(503, "PROCESSOR_UNAVAILABLE", available?.reason ?? "El procesador local no está disponible.");
    }
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(errorBody(request, error));
    }
    if (error instanceof RemoteFetchError) {
      const status = error.code === "FILE_TOO_LARGE" ? 413 : error.code === "REMOTE_URL_BLOCKED" ? 422 : 502;
      return reply.status(status).send(errorBody(request, new ApiError(status, error.code, error.message)));
    }
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      return reply.status(422).send(errorBody(request, new ApiError(
        422,
        "VALIDATION_ERROR",
        issue?.message ?? "Los datos enviados no son válidos.",
        issue?.path.join("."),
      )));
    }
    if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.status(413).send(errorBody(request, new ApiError(413, "FILE_TOO_LARGE", "El archivo supera el límite configurado.")));
    }
    const frameworkStatus = (error as { statusCode?: number }).statusCode;
    if (frameworkStatus && frameworkStatus >= 400 && frameworkStatus < 500) {
      return reply.status(frameworkStatus).send(errorBody(request, new ApiError(
        frameworkStatus,
        "BAD_REQUEST",
        frameworkStatus === 415 ? "El tipo de contenido enviado no es compatible." : "La solicitud no tiene un formato válido.",
      )));
    }
    request.log.error({ err: error }, "request failed");
    return reply.status(500).send(errorBody(request, new ApiError(500, "INTERNAL_ERROR", "No se pudo completar la solicitud.")));
  });

  app.addHook("onClose", async () => repository.close());

  app.get("/api/health", async () => ({ status: "ok", time: new Date().toISOString() }));
  app.get("/api/capabilities", async () => capabilities());
  app.post("/api/capabilities/recheck", async () => capabilities(true));
  app.get("/api/models", async () => ({ models: (await capabilities()).capabilities }));

  app.get("/api/jobs", async (request) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      demo: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    })
      .parse(request.query);
    return { jobs: repository.listJobs({ limit: query.limit, completedOnly: query.demo }) };
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request) => {
    const job = repository.getJob(request.params.id);
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "No se encontró el trabajo solicitado.");
    return { job };
  });

  app.post("/api/jobs", async (request, reply) => {
    const jobId = randomUUID();
    const fields: Record<string, string> = {};
    let inputPath: string | null = null;
    let originalName: string | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === "field") {
          fields[part.fieldname] = String(part.value);
          continue;
        }
        if (inputPath) {
          part.file.resume();
          throw new ApiError(422, "TOO_MANY_FILES", "Envía un solo archivo por trabajo.");
        }
        originalName = safeDisplayName(part.filename);
        inputPath = jobUploadPath(config, jobId, originalName);
        await mkdir(dirname(inputPath), { recursive: true });
        await pipeline(part.file, (await import("node:fs")).createWriteStream(inputPath, { flags: "wx" }));
        if (part.file.truncated) throw new ApiError(413, "FILE_TOO_LARGE", "El archivo supera el límite configurado.");
      }
      if (!inputPath || !originalName) throw new ApiError(422, "FILE_REQUIRED", "Selecciona un archivo de audio.", "file");
      const profileId = profileIdSchema.parse(fieldValue(fields, "profileId"));
      const outputFormat = outputFormatSchema.parse(fieldValue(fields, "outputFormat"));
      await requireProfile(profileId);
      const job = repository.createJob({
        id: jobId,
        kind: "upload",
        profileId,
        outputFormat,
        originalName,
        inputPath,
        publishToDemo: parseBoolean(fields.publishToDemo),
        idempotencyKey: request.headers["idempotency-key"]?.toString() ?? null,
        retentionHours: config.retentionHours,
      });
      if (job.id !== jobId) await rm(resolve(config.uploadsDir, jobId), { recursive: true, force: true });
      return reply.status(201).send({ job });
    } catch (error) {
      await rm(resolve(config.uploadsDir, jobId), { recursive: true, force: true });
      throw error;
    }
  });

  app.post("/api/jobs/remote", async (request, reply) => {
    const body = remoteJobRequestSchema.parse(request.body);
    await requireProfile(body.profileId);
    const normalized = normalizeProviderUrl(body.url, body.source);
    const jobId = randomUUID();
    const rawName = safeDisplayName(basename(new URL(normalized).pathname) || "remote-audio");
    const originalName = extname(rawName) ? rawName : `${rawName}.bin`;
    const inputPath = jobUploadPath(config, jobId, originalName);
    try {
      const downloaded = await downloadRemoteFile(normalized, inputPath, config.maxRemoteBytes);
      const job = repository.createJob({
        id: jobId,
        kind: "remote",
        profileId: body.profileId,
        outputFormat: body.outputFormat,
        originalName,
        inputPath,
        remoteUrl: downloaded.finalUrl,
        publishToDemo: body.publishToDemo,
        idempotencyKey: request.headers["idempotency-key"]?.toString() ?? null,
        retentionHours: config.retentionHours,
      });
      if (job.id !== jobId) await rm(resolve(config.uploadsDir, jobId), { recursive: true, force: true });
      return reply.status(201).send({ job });
    } catch (error) {
      await rm(resolve(config.uploadsDir, jobId), { recursive: true, force: true });
      throw error;
    }
  });

  app.post("/api/batches", async (request, reply) => {
    const fields: Record<string, string> = {};
    const files: Array<{ id: string; inputPath: string; originalName: string }> = [];
    let batchBytes = 0;
    try {
      for await (const part of request.parts()) {
        if (part.type === "field") {
          fields[part.fieldname] = String(part.value);
          continue;
        }
        const id = randomUUID();
        if (files.length >= config.maxBatchFiles) {
          part.file.resume();
          throw new ApiError(413, "BATCH_TOO_LARGE", `El lote admite como máximo ${config.maxBatchFiles} archivos.`);
        }
        const originalName = safeDisplayName(part.filename);
        const inputPath = jobUploadPath(config, id, originalName);
        await mkdir(dirname(inputPath), { recursive: true });
        await pipeline(part.file, (await import("node:fs")).createWriteStream(inputPath, { flags: "wx" }));
        if (part.file.truncated) throw new ApiError(413, "FILE_TOO_LARGE", `${originalName} supera el límite configurado.`);
        batchBytes += (await stat(inputPath)).size;
        if (batchBytes > config.maxBatchBytes) {
          throw new ApiError(413, "BATCH_TOO_LARGE", "El tamaño total del lote supera el límite configurado.");
        }
        files.push({ id, inputPath, originalName });
      }
      if (files.length === 0) throw new ApiError(422, "FILE_REQUIRED", "Selecciona al menos un archivo.", "files");
      const profileId = profileIdSchema.parse(fieldValue(fields, "profileId"));
      const outputFormat = outputFormatSchema.parse(fieldValue(fields, "outputFormat"));
      await requireProfile(profileId);
      const batch = repository.createBatchWithJobs(fields.name?.trim() || `Lote de ${files.length} archivos`, files.map((file) => ({
        ...file,
        kind: "upload",
        profileId,
        outputFormat,
        publishToDemo: false,
        retentionHours: config.retentionHours,
      })));
      return reply.status(201).send({ batch });
    } catch (error) {
      await Promise.all(files.map((file) => rm(resolve(config.uploadsDir, file.id), { recursive: true, force: true })));
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/api/batches/:id", async (request) => {
    const batch = repository.getBatch(request.params.id);
    if (!batch) throw new ApiError(404, "BATCH_NOT_FOUND", "No se encontró el lote solicitado.");
    return { batch };
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (request) => {
    const existing = repository.getJob(request.params.id);
    if (!existing) throw new ApiError(404, "JOB_NOT_FOUND", "No se encontró el trabajo solicitado.");
    if (["completed", "failed", "cancelled"].includes(existing.state)) {
      throw new ApiError(409, "JOB_NOT_CANCELLABLE", "El trabajo ya terminó y no puede cancelarse.");
    }
    const job = repository.requestCancel(request.params.id);
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "No se encontró el trabajo solicitado.");
    return { job };
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/api/jobs/:id/events", async (request, reply) => {
    const job = repository.getJob(request.params.id);
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "No se encontró el trabajo solicitado.");
    const headerId = request.headers["last-event-id"];
    let cursor = Number(request.query.after ?? headerId ?? 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify({ job })}\n\n`);
    let closed = false;
    let lastHeartbeat = Date.now();
    request.raw.once("close", () => { closed = true; });
    while (!closed) {
      const events = repository.listEventsAfter(request.params.id, cursor);
      for (const event of events) {
        cursor = event.id;
        reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      if (Date.now() - lastHeartbeat > 15_000) {
        reply.raw.write(": heartbeat\n\n");
        lastHeartbeat = Date.now();
      }
      const current = repository.getJob(request.params.id);
      if (current && ["completed", "failed", "cancelled"].includes(current.state) && events.length === 0) {
        reply.raw.end();
        break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
  });

  app.get<{ Params: { id: string; artifactId: string } }>("/api/jobs/:id/artifacts/:artifactId", async (request, reply) => {
    const artifact = repository.getArtifact(request.params.id, request.params.artifactId);
    if (!artifact) throw new ApiError(404, "ARTIFACT_NOT_FOUND", "No se encontró el archivo solicitado.");
    const resultRoot = resolve(config.resultsDir, request.params.id);
    const path = assertPathWithin(resultRoot, artifact.path);
    reply.header("content-type", artifact.mime);
    reply.header("content-length", artifact.bytes);
    reply.header("content-disposition", contentDisposition(artifact.filename));
    return reply.send(createReadStream(path));
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id/download.zip", async (request, reply) => {
    const job = repository.getJob(request.params.id);
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "No se encontró el trabajo solicitado.");
    if (job.state !== "completed" || job.artifacts.length === 0) {
      throw new ApiError(409, "RESULT_NOT_READY", "Los resultados todavía no están listos.");
    }
    const resultRoot = resolve(config.resultsDir, job.id);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "application/zip",
      "content-disposition": contentDisposition(`${job.originalName.replace(/\.[^.]+$/, "")}-stems.zip`),
      "cache-control": "private, max-age=0",
    });
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (error) => reply.raw.destroy(error));
    archive.pipe(reply.raw);
    for (const artifact of job.artifacts) {
      const stored = repository.getArtifact(job.id, artifact.id);
      if (!stored) continue;
      archive.file(assertPathWithin(resultRoot, stored.path), { name: artifact.filename });
    }
    await archive.finalize();
  });

  const webRoot = resolve(config.rootDir, "apps", "web", "dist");
  const webIndex = resolve(webRoot, "index.html");
  if (existsSync(webIndex)) {
    const serveWeb = async (request: FastifyRequest, reply: FastifyReply) => {
      const pathname = decodeURIComponent(new URL(request.raw.url ?? "/", "http://127.0.0.1").pathname);
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        return reply.status(404).send(errorBody(request, new ApiError(404, "API_ROUTE_NOT_FOUND", "No existe la ruta solicitada.")));
      }
      const relativePath = pathname.replace(/^\/+/, "");
      const requestedPath = relativePath ? assertPathWithin(webRoot, resolve(webRoot, relativePath)) : webIndex;
      let filePath = requestedPath;
      try {
        const file = await stat(requestedPath);
        if (!file.isFile()) filePath = webIndex;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        filePath = webIndex;
      }
      reply.header("content-type", webMimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream");
      return reply.send(createReadStream(filePath));
    };
    app.get("/", serveWeb);
    app.get("/*", serveWeb);
  }

  return app;
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });
  await app.listen({ host: config.host, port: config.port });
}
