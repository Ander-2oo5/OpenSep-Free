import { z } from "zod";

export const jobStates = [
  "queued",
  "preparing",
  "processing",
  "encoding",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
] as const;

export const jobStateSchema = z.enum(jobStates);
export type JobState = z.infer<typeof jobStateSchema>;

export const profileIds = [
  "vocals", "vocals-ft", "vocals-mdx",
  "four-stems", "four-stems-ft", "four-stems-mdx", "six-stems",
  "drums", "bass", "guitar", "piano", "other",
  "percussion", "trumpet", "keyboards", "synthesizer", "violin", "acoustic-guitar",
] as const;
export const profileIdSchema = z.enum(profileIds);
export type ProfileId = z.infer<typeof profileIdSchema>;

export const outputFormats = [
  "mp3-320",
  "wav-16",
  "wav-32",
  "flac-16",
  "flac-24",
  "m4a",
] as const;
export const outputFormatSchema = z.enum(outputFormats);
export type OutputFormat = z.infer<typeof outputFormatSchema>;

export const jobKindSchema = z.enum(["upload", "remote"]);
export type JobKind = z.infer<typeof jobKindSchema>;

export const artifactSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  stem: z.string().min(1),
  filename: z.string().min(1),
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  downloadUrl: z.string().min(1),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const jobSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid().nullable(),
  kind: jobKindSchema,
  state: jobStateSchema,
  progress: z.number().min(0).max(100),
  profileId: profileIdSchema,
  outputFormat: outputFormatSchema,
  originalName: z.string().min(1),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  artifacts: z.array(artifactSchema),
});
export type Job = z.infer<typeof jobSchema>;

export const capabilityStatusSchema = z.enum([
  "ready",
  "missing_dependency",
  "missing_model",
  "unsupported_platform",
]);

export const capabilitySchema = z.object({
  id: profileIdSchema,
  name: z.string(),
  description: z.string(),
  stems: z.array(z.string()),
  available: z.boolean(),
  status: capabilityStatusSchema,
  reason: z.string().nullable(),
});
export type Capability = z.infer<typeof capabilitySchema>;

export const capabilitiesResponseSchema = z.object({
  checkedAt: z.string().datetime(),
  python: z.boolean(),
  ffmpeg: z.boolean(),
  ffprobe: z.boolean(),
  processor: z.boolean(),
  capabilities: z.array(capabilitySchema),
});
export type CapabilitiesResponse = z.infer<typeof capabilitiesResponseSchema>;

export const remoteJobRequestSchema = z.object({
  url: z.string().url(),
  source: z.enum(["direct", "google-drive", "dropbox", "mega"]).default("direct"),
  profileId: profileIdSchema,
  outputFormat: outputFormatSchema,
  publishToDemo: z.boolean().default(false),
});
export type RemoteJobRequest = z.infer<typeof remoteJobRequestSchema>;

export const workerManifestSchema = z.object({
  protocolVersion: z.literal(1),
  jobId: z.string().uuid(),
  inputPath: z.string().min(1),
  workDir: z.string().min(1),
  resultsDir: z.string().min(1),
  profileId: profileIdSchema,
  outputFormat: outputFormatSchema,
});
export type WorkerManifest = z.infer<typeof workerManifestSchema>;

export const workerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({
    type: z.literal("progress"),
    stage: z.enum(["preparing", "processing", "encoding"]),
    progress: z.number().min(0).max(100),
    message: z.string(),
  }),
  z.object({
    type: z.literal("artifact"),
    stem: z.string().min(1),
    path: z.string().min(1),
    mime: z.string().min(1),
  }),
  z.object({ type: z.literal("completed") }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type WorkerEvent = z.infer<typeof workerEventSchema>;

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly field?: string;
  };
}

export interface JobEvent {
  readonly id: number;
  readonly jobId: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export const profiles = [
  {
    id: "vocals" as const,
    name: "Voz e instrumental",
    description: "Separa la voz principal del acompañamiento.",
    stems: ["vocals", "instrumental"],
    group: "Voz / Instrumental",
    categories: ["featured", "voice"],
    engine: "demucs",
  },
  {
    id: "vocals-ft" as const,
    name: "Voz e instrumental HQ",
    description: "Modelo Demucs Fine-Tuned con mayor calidad y más tiempo de proceso.",
    stems: ["vocals", "instrumental"],
    group: "Voz / Instrumental",
    categories: ["featured", "voice"],
    engine: "demucs",
  },
  {
    id: "vocals-mdx" as const,
    name: "Voz e instrumental MDX",
    description: "Separación alternativa con el conjunto MDX Extra.",
    stems: ["vocals", "instrumental"],
    group: "Voz / Instrumental",
    categories: ["voice"],
    engine: "demucs",
  },
  {
    id: "four-stems" as const,
    name: "4 pistas",
    description: "Voz, batería, bajo y otros instrumentos.",
    stems: ["vocals", "drums", "bass", "other"],
    group: "Multistem",
    categories: ["featured", "voice", "drums", "bass"],
    engine: "demucs",
  },
  {
    id: "four-stems-ft" as const,
    name: "4 pistas HQ",
    description: "Voz, batería, bajo y otros con Demucs Fine-Tuned.",
    stems: ["vocals", "drums", "bass", "other"],
    group: "Multistem",
    categories: ["voice", "drums", "bass"],
    engine: "demucs",
  },
  {
    id: "four-stems-mdx" as const,
    name: "4 pistas MDX Extra",
    description: "Voz, batería, bajo y otros con el ensemble MDX Extra.",
    stems: ["vocals", "drums", "bass", "other"],
    group: "Multistem",
    categories: ["voice", "drums", "bass"],
    engine: "demucs",
  },
  {
    id: "six-stems" as const,
    name: "6 pistas",
    description: "Voz, batería, bajo, guitarra, piano y otros.",
    stems: ["vocals", "drums", "bass", "guitar", "piano", "other"],
    group: "Multistem",
    categories: ["featured", "voice", "drums", "bass", "guitar", "piano", "keys"],
    engine: "demucs",
  },
  {
    id: "drums" as const, name: "Batería + resto", description: "Extrae la batería completa del resto de la mezcla.",
    stems: ["drums", "other"], group: "Instrumentos", categories: ["featured", "drums", "percussion"], engine: "demucs",
  },
  {
    id: "bass" as const, name: "Bajo + resto", description: "Extrae el bajo del resto de la mezcla.",
    stems: ["bass", "other"], group: "Instrumentos", categories: ["featured", "bass"], engine: "demucs",
  },
  {
    id: "guitar" as const, name: "Guitarra + resto", description: "Extrae guitarras usando el modelo de seis pistas.",
    stems: ["guitar", "other"], group: "Guitarras", categories: ["featured", "guitar", "strings"], engine: "demucs",
  },
  {
    id: "piano" as const, name: "Piano + resto", description: "Extrae piano usando el modelo de seis pistas.",
    stems: ["piano", "other"], group: "Teclados", categories: ["featured", "piano", "keys"], engine: "demucs",
  },
  {
    id: "other" as const, name: "Otros instrumentos + resto", description: "Aísla la pista de otros instrumentos del modelo Demucs.",
    stems: ["other", "remainder"], group: "Instrumentos", categories: ["featured"], engine: "demucs",
  },
  {
    id: "percussion" as const, name: "Percusión + resto", description: "Aísla sonidos de percusión mediante consulta semántica.",
    stems: ["percussion", "other"], group: "AudioSep · Instrumentos específicos", categories: ["featured", "percussion", "drums"], engine: "audiosep",
  },
  {
    id: "trumpet" as const, name: "Trompeta + resto", description: "Aísla trompeta mediante separación guiada por texto.",
    stems: ["trumpet", "other"], group: "AudioSep · Instrumentos específicos", categories: ["featured", "wind"], engine: "audiosep",
  },
  {
    id: "keyboards" as const, name: "Teclados + resto", description: "Aísla teclados musicales mediante separación guiada por texto.",
    stems: ["keyboards", "other"], group: "AudioSep · Instrumentos específicos", categories: ["featured", "keys", "piano"], engine: "audiosep",
  },
  {
    id: "synthesizer" as const, name: "Sintetizador + resto", description: "Aísla sintetizadores mediante separación guiada por texto.",
    stems: ["synthesizer", "other"], group: "AudioSep · Instrumentos específicos", categories: ["featured", "keys"], engine: "audiosep",
  },
  {
    id: "violin" as const, name: "Violín + resto", description: "Aísla violín mediante separación guiada por texto.",
    stems: ["violin", "other"], group: "AudioSep · Instrumentos específicos", categories: ["featured", "strings"], engine: "audiosep",
  },
  {
    id: "acoustic-guitar" as const, name: "Guitarra acústica + resto", description: "Aísla guitarra acústica mediante separación guiada por texto.",
    stems: ["acoustic-guitar", "other"], group: "AudioSep · Instrumentos específicos", categories: ["featured", "guitar", "strings"], engine: "audiosep",
  },
] satisfies ReadonlyArray<{
  readonly id: ProfileId;
  readonly name: string;
  readonly description: string;
  readonly stems: readonly string[];
  readonly group: string;
  readonly categories: readonly string[];
  readonly engine: "demucs" | "audiosep";
}>;
