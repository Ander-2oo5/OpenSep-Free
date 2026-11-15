import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import type { CapabilitiesResponse, Capability } from "@opensep/contracts";
import { profiles } from "@opensep/contracts";
import type { OpenSepConfig } from "./config.js";

async function commandSucceeds(
  command: string,
  args: readonly string[],
  timeoutMs = 5_000,
  environment?: Readonly<Record<string, string>>,
): Promise<boolean> {
  return await new Promise((resolveResult) => {
    let settled = false;
    const child = spawn(command, [...args], {
      windowsHide: true,
      stdio: "ignore",
      shell: false,
      env: environment ? { ...process.env, ...environment } : process.env,
    });
    const timeout = setTimeout(() => {
      if (!settled) child.kill();
    }, timeoutMs);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));

    function finish(result: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    }
  });
}

export async function detectCapabilities(config: OpenSepConfig): Promise<CapabilitiesResponse> {
  const workerExists = await access(config.workerScript).then(() => true, () => false);
  const [python, ffmpeg, ffprobe] = await Promise.all([
    commandSucceeds(config.pythonCommand, ["--version"]),
    commandSucceeds(config.ffmpegCommand, ["-version"]),
    commandSucceeds(config.ffprobeCommand, ["-version"]),
  ]);
  const processor = workerExists && python
    ? await commandSucceeds(config.pythonCommand, [config.workerScript, "--check"], 15_000, {
        OPENSEP_FFMPEG: config.ffmpegCommand,
        OPENSEP_FFPROBE: config.ffprobeCommand,
      })
    : false;
  const audiosep = processor
    ? await commandSucceeds(config.pythonCommand, [config.workerScript, "--check-audiosep"], 5_000, {
        OPENSEP_AUDIOSEP_PYTHON: config.audioSepPython,
        OPENSEP_AUDIOSEP_ROOT: config.audioSepRoot,
        OPENSEP_AUDIOSEP_ADAPTER: config.audioSepAdapter,
      })
    : false;

  const missing: string[] = [];
  if (!python) missing.push("Python");
  if (!ffmpeg) missing.push("FFmpeg");
  if (!ffprobe) missing.push("FFprobe");
  if (python && !processor) missing.push("Demucs/PyTorch");
  const available = python && ffmpeg && ffprobe && processor;
  const reason = available ? null : `Falta instalar: ${missing.join(", ")}.`;
  const capabilities: Capability[] = profiles.map((profile) => {
    const profileAvailable = available && (profile.engine !== "audiosep" || audiosep);
    const profileReason = profile.engine === "audiosep" && available && !audiosep
      ? "AudioSep todavía no está preparado en esta PC. Ejecuta Instalar-OpenSep.cmd."
      : reason;
    return {
      ...profile,
      stems: [...profile.stems],
      available: profileAvailable,
      status: profileAvailable ? "ready" : "missing_dependency",
      reason: profileReason,
    };
  });

  return {
    checkedAt: new Date().toISOString(),
    python,
    ffmpeg,
    ffprobe,
    processor,
    capabilities,
  };
}
