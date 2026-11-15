import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Agent, fetch } from "undici";

export class RemoteFetchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function blockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a = 0, b = 0] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    a >= 224;
}

function blockedIp(address: string): boolean {
  if (isIP(address) === 4) return blockedIpv4(address);
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return blockedIpv4(normalized.slice(7));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff");
}

async function resolveRemoteUrl(value: string): Promise<{ readonly url: URL; readonly address: string; readonly family: 4 | 6 }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteFetchError("REMOTE_URL_INVALID", "La URL remota no es válida.");
  }
  if (url.protocol !== "https:") {
    throw new RemoteFetchError("REMOTE_URL_BLOCKED", "Solo se permiten enlaces HTTPS.");
  }
  if (url.username || url.password) {
    throw new RemoteFetchError("REMOTE_URL_BLOCKED", "No se permiten credenciales dentro de la URL.");
  }
  if (url.port && url.port !== "443") {
    throw new RemoteFetchError("REMOTE_URL_BLOCKED", "El puerto remoto no está permitido.");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => {
    throw new RemoteFetchError("REMOTE_FETCH_FAILED", "No se pudo resolver el servidor remoto.");
  });
  if (addresses.length === 0 || addresses.some((entry) => blockedIp(entry.address))) {
    throw new RemoteFetchError("REMOTE_URL_BLOCKED", "La URL apunta a una red privada o reservada.");
  }
  const selected = addresses[0];
  if (!selected) throw new RemoteFetchError("REMOTE_FETCH_FAILED", "No se pudo resolver el servidor remoto.");
  return { url, address: selected.address, family: selected.family === 6 ? 6 : 4 };
}

export async function validateRemoteUrl(value: string): Promise<URL> {
  return (await resolveRemoteUrl(value)).url;
}

export function normalizeProviderUrl(value: string, source: string): string {
  const url = new URL(value);
  if (source === "dropbox") {
    url.searchParams.set("dl", "1");
    return url.toString();
  }
  if (source === "google-drive") {
    const match = url.pathname.match(/\/file\/d\/([^/]+)/) ?? url.searchParams.get("id")?.match(/(.+)/);
    const id = match?.[1] ?? match?.[0];
    if (!id) throw new RemoteFetchError("REMOTE_URL_INVALID", "No se encontró el identificador público de Google Drive.");
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  }
  if (source === "mega") {
    throw new RemoteFetchError("REMOTE_SOURCE_UNSUPPORTED", "MEGA requiere el adaptador opcional de descarga, que no está instalado.");
  }
  return url.toString();
}

export async function downloadRemoteFile(
  initialUrl: string,
  destination: string,
  maxBytes: number,
): Promise<{ readonly finalUrl: string; readonly bytes: number; readonly contentType: string | null }> {
  let url = initialUrl;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const resolved = await resolveRemoteUrl(url);
    const validated = resolved.url;
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
      },
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(validated, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "OpenSep/0.1 remote importer" },
        dispatcher,
      }).catch(() => {
        throw new RemoteFetchError("REMOTE_FETCH_FAILED", "No se pudo descargar el archivo remoto.");
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new RemoteFetchError("REMOTE_FETCH_FAILED", "La redirección remota no indicó un destino.");
        url = new URL(location, validated).toString();
        await response.body?.cancel();
        continue;
      }
      if (!response.ok || !response.body) {
        throw new RemoteFetchError("REMOTE_FETCH_FAILED", `El servidor remoto respondió con ${response.status}.`);
      }
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > maxBytes) {
        throw new RemoteFetchError("FILE_TOO_LARGE", "El archivo remoto supera el límite configurado.");
      }

      await mkdir(dirname(destination), { recursive: true });
      const handle = await open(destination, "wx");
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > maxBytes) {
            throw new RemoteFetchError("FILE_TOO_LARGE", "El archivo remoto supera el límite configurado.");
          }
          await handle.write(buffer);
        }
      } catch (error) {
        await handle.close();
        await rm(destination, { force: true });
        if (controller.signal.aborted) {
          throw new RemoteFetchError("REMOTE_FETCH_FAILED", "La descarga remota superó el tiempo permitido.");
        }
        throw error;
      }
      await handle.close();
      return { finalUrl: validated.toString(), bytes, contentType: response.headers.get("content-type") };
    } finally {
      clearTimeout(timeout);
      await dispatcher.close();
    }
  }
  throw new RemoteFetchError("REMOTE_FETCH_FAILED", "El enlace remoto produjo demasiadas redirecciones.");
}
