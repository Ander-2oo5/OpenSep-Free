import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localRoot = join(process.env.LOCALAPPDATA ?? appRoot, "OpenSep");
const dataDir = join(localRoot, "data");
const logsDir = join(localRoot, "logs");
const stateDir = join(localRoot, "state");
const modelsDir = join(localRoot, "models");
const lockPath = join(stateDir, "launcher.lock");
const pidPath = join(stateDir, "processes.json");
const url = "http://127.0.0.1:8787";

mkdirSync(logsDir, { recursive: true });
mkdirSync(stateDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(modelsDir, { recursive: true });

function rotateLog(path) {
  if (!existsSync(path) || statSync(path).size < 5 * 1024 * 1024) return;
  rmSync(`${path}.1`, { force: true });
  renameSync(path, `${path}.1`);
}

function openBrowser() {
  const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function isHealthy() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  return false;
}

function stopInstalledProcesses() {
  if (!existsSync(pidPath)) {
    rmSync(lockPath, { force: true });
    return;
  }
  try {
    const state = JSON.parse(readFileSync(pidPath, "utf8"));
    const pid = Number(state.supervisorPid);
    let commandLine = "";
    if (Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid) {
      try {
        commandLine = execFileSync("powershell.exe", [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\").CommandLine`,
        ], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
      } catch {
        commandLine = "";
      }
    }
    if (commandLine.includes("launcher.mjs") && commandLine.toLowerCase().includes(appRoot.toLowerCase())) {
      spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    }
  } finally {
    rmSync(pidPath, { force: true });
    rmSync(lockPath, { force: true });
  }
}

if (process.argv.includes("--shutdown")) {
  stopInstalledProcesses();
  process.exit(0);
}

if (await isHealthy()) {
  openBrowser();
  process.exit(0);
}

let lockHandle;
try {
  lockHandle = openSync(lockPath, "wx");
  closeSync(lockHandle);
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  if (await waitForHealth(30_000)) openBrowser();
  else {
    stopInstalledProcesses();
    lockHandle = openSync(lockPath, "wx");
    closeSync(lockHandle);
  }
}

const node = process.execPath;
const apiTsx = join(appRoot, "apps", "api", "node_modules", "tsx", "dist", "cli.mjs");
const runnerTsx = join(appRoot, "apps", "runner", "node_modules", "tsx", "dist", "cli.mjs");
const ffmpeg = join(appRoot, "runtime", "ffmpeg", "ffmpeg.exe");
const ffprobe = join(appRoot, "runtime", "ffmpeg", "ffprobe.exe");
const demucsPython = join(appRoot, "runtime", "demucs", "Scripts", "python.exe");
const audioSepPython = join(appRoot, "runtime", "audiosep", "Scripts", "python.exe");
const required = [apiTsx, runnerTsx, ffmpeg, ffprobe, demucsPython, audioSepPython];
for (const path of required) {
  if (!existsSync(path)) {
    rmSync(lockPath, { force: true });
    throw new Error(`La instalación está incompleta. No existe: ${path}`);
  }
}

const env = {
  ...process.env,
  OPENSEP_ROOT_DIR: appRoot,
  OPENSEP_DATA_DIR: dataDir,
  OPENSEP_PYTHON: demucsPython,
  OPENSEP_FFMPEG: ffmpeg,
  OPENSEP_FFPROBE: ffprobe,
  OPENSEP_AUDIOSEP_PYTHON: audioSepPython,
  OPENSEP_AUDIOSEP_ROOT: join(appRoot, "vendor", "AudioSep"),
  TORCH_HOME: modelsDir,
  HF_HOME: join(modelsDir, "huggingface"),
};

function startService(name, entry, tsx) {
  const logPath = join(logsDir, `${name}.log`);
  rotateLog(logPath);
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(node, [tsx, entry], {
    cwd: appRoot,
    env,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  child.once("exit", (code) => {
    log.write(`${new Date().toISOString()} ${name} terminó con código ${String(code)}\n`);
    log.end();
    if (!shuttingDown) shutdown(1);
  });
  return child;
}

let shuttingDown = false;
const api = startService("api", join(appRoot, "apps", "api", "src", "index.ts"), apiTsx);
const runner = startService("runner", join(appRoot, "apps", "runner", "src", "index.ts"), runnerTsx);
writeFileSync(pidPath, JSON.stringify({ supervisorPid: process.pid, apiPid: api.pid, runnerPid: runner.pid }));

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [api, runner]) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  rmSync(pidPath, { force: true });
  rmSync(lockPath, { force: true });
  setTimeout(() => process.exit(exitCode), 1_000).unref();
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
process.on("exit", () => {
  rmSync(pidPath, { force: true });
  rmSync(lockPath, { force: true });
});

if (await waitForHealth(60_000)) openBrowser();
else shutdown(1);

