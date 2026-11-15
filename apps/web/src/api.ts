import type {
  ApiErrorBody,
  CapabilitiesResponse,
  Job,
  OutputFormat,
  ProfileId,
  RemoteJobRequest,
} from "@opensep/contracts";

export class ApiClientError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiErrorBody | null;
    throw new ApiClientError(body?.error.code ?? "REQUEST_FAILED", body?.error.message ?? "La solicitud falló.", response.status);
  }
  return await response.json() as T;
}

export const api = {
  capabilities: (force = false) => requestJson<CapabilitiesResponse>(
    force ? "/api/capabilities/recheck" : "/api/capabilities",
    force ? { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } : undefined,
  ),
  listJobs: (demo = false) => requestJson<{ jobs: Job[] }>(`/api/jobs?limit=40&demo=${String(demo)}`),
  getJob: (id: string) => requestJson<{ job: Job }>(`/api/jobs/${id}`),
  getBatch: (id: string) => requestJson<{ batch: { id: string; name: string; jobs: Job[] } }>(`/api/batches/${id}`),
  cancelJob: (id: string) => requestJson<{ job: Job }>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  createUpload: async (input: {
    file: File;
    profileId: ProfileId;
    outputFormat: OutputFormat;
    publishToDemo: boolean;
  }) => {
    const body = new FormData();
    body.append("profileId", input.profileId);
    body.append("outputFormat", input.outputFormat);
    body.append("publishToDemo", String(input.publishToDemo));
    body.append("file", input.file);
    return requestJson<{ job: Job }>("/api/jobs", { method: "POST", body });
  },
  createRemote: (input: RemoteJobRequest) => requestJson<{ job: Job }>("/api/jobs/remote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }),
  createBatch: async (input: { files: readonly File[]; name: string; profileId: ProfileId; outputFormat: OutputFormat }) => {
    const body = new FormData();
    body.append("name", input.name);
    body.append("profileId", input.profileId);
    body.append("outputFormat", input.outputFormat);
    input.files.forEach((file) => body.append("files", file));
    return requestJson<{ batch: { id: string; jobs: Job[] } }>("/api/batches", { method: "POST", body });
  },
};
