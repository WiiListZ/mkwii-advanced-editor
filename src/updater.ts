// Portable Windows release updater. Releases are fetched from the project's GitHub repository.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const RELEASES_URL = "https://api.github.com/repos/WiiListZ/mkwii-advanced-editor/releases/latest";
const DOWNLOAD_PREFIX = "https://github.com/WiiListZ/mkwii-advanced-editor/releases/download/";
const EXE_NAME = "MKWiiAdvancedEditor.exe";

export function compareVersions(a: string, b: string) {
  const parse = (value: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
    if (!match) throw new Error(`Invalid release version: ${value}`);
    return { numbers: match.slice(1, 4).map(Number), pre: match[4] || "" };
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left.numbers[i] !== right.numbers[i]) return Math.sign(left.numbers[i] - right.numbers[i]);
  if (!left.pre && right.pre) return 1;
  if (left.pre && !right.pre) return -1;
  return left.pre.localeCompare(right.pre, undefined, { numeric: true });
}

type ReleaseAsset = { name: string; browser_download_url: string; size: number };
export type Release = { tag_name: string; name: string; body: string; html_url: string; assets: ReleaseAsset[] };

export function selectRelease(raw: Release, currentVersion: string, downloadPrefix = DOWNLOAD_PREFIX) {
  if (compareVersions(raw.tag_name, currentVersion) <= 0) return null;
  const asset = raw.assets.find((a) => a.name === EXE_NAME);
  const checksum = raw.assets.find((a) => a.name === `${EXE_NAME}.sha256`);
  if (!asset || !checksum || asset.size < 1_000_000 || asset.size > 500_000_000) return null;
  if (![asset, checksum].every((a) => a.browser_download_url.startsWith(downloadPrefix))) return null;
  return { version: raw.tag_name.replace(/^v/, ""), title: raw.name || raw.tag_name,
    notes: raw.body || "No release notes provided.", url: raw.html_url, asset, checksum };
}

const headers = { "Accept": "application/vnd.github+json", "User-Agent": "MKWiiAdvancedEditor-Updater" };
async function checkedFetch(url: string, timeout = 15000) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}`);
  return response;
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}

// Download state, polled by the UI: the download takes longer than an HTTP request may stay open.
export type DownloadState = { phase: "idle" | "downloading" | "ready" | "error"; received: number; total: number; error: string; version?: string };

export class ReleaseUpdater {
  private release: ReturnType<typeof selectRelease> = null;
  private stagedPath: string | null = null;
  private job: Promise<void> | null = null;
  private state: DownloadState = { phase: "idle", received: 0, total: 0, error: "" };
  // `source` is only changed by the tests, to serve releases from a local server.
  constructor(private currentVersion: string, private executable: string | null, private settingsDir: string,
    private source = { releasesUrl: RELEASES_URL, downloadPrefix: DOWNLOAD_PREFIX }) {}

  progress(): DownloadState { return { ...this.state, version: this.release?.version }; }

  // Release notes of the version this updater installed, kept until the next update. A version
  // installed by hand (downloaded from GitHub) has none, so its notes are not shown at start.
  private get notesFile() { return join(this.settingsDir, "updates", "installed-release.json"); }

  async installedNotes() {
    const record = JSON.parse(await readFile(this.notesFile, "utf8").catch(() => "null"));
    let current = false;
    try { current = !!record?.version && compareVersions(record.version, this.currentVersion) === 0; } catch { /* invalid record */ }
    if (!current) return { available: false, show: false };
    return { available: true, show: !record.shown, version: String(record.version), title: String(record.title || ""),
      notes: String(record.notes || ""), url: String(record.url || "") };
  }

  // After the notes were shown once they only open on request (Help › About).
  async markNotesShown() {
    const record = JSON.parse(await readFile(this.notesFile, "utf8").catch(() => "null"));
    if (record && !record.shown) await writeFile(this.notesFile, JSON.stringify({ ...record, shown: true }, null, 2));
    return { ok: true };
  }

  // Starts the download in the background (once) and returns at once; progress() follows it.
  startDownload() {
    if (!this.release) throw new Error("No newer compatible release is available");
    if (!this.job && this.state.phase !== "ready") {
      this.state = { phase: "downloading", received: 0, total: this.release.asset.size, error: "" };
      this.job = this.download()
        .then(() => { this.state = { ...this.state, phase: "ready", received: this.state.total }; })
        .catch((error: any) => { this.state = { ...this.state, phase: "error", error: error?.message || String(error) }; })
        .finally(() => { this.job = null; });
    }
    return this.progress();
  }

  async check() {
    if (!this.executable || process.platform !== "win32") return { supported: false, currentVersion: this.currentVersion, available: false };
    const response = await fetch(this.source.releasesUrl, { headers, signal: AbortSignal.timeout(15000) });
    if (response.status === 404) return { supported: true, currentVersion: this.currentVersion, available: false };
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const raw = await response.json() as Release;
    const next = selectRelease(raw, this.currentVersion, this.source.downloadPrefix);
    // A download of the same version (running or finished) stays valid.
    if (next?.version !== this.release?.version) {
      this.stagedPath = null;
      if (!this.job) this.state = { phase: "idle", received: 0, total: 0, error: "" };
    }
    this.release = next;
    return { supported: true, currentVersion: this.currentVersion, available: !!this.release,
      version: this.release?.version, title: this.release?.title, notes: this.release?.notes, url: this.release?.url };
  }

  async download() {
    const release = this.release;
    if (!release) throw new Error("No newer compatible release is available");
    const folder = join(this.settingsDir, "updates", release.version);
    await mkdir(folder, { recursive: true });
    const staged = join(folder, EXE_NAME);
    const checksumText = await (await checkedFetch(release.checksum.browser_download_url)).text();
    const expected = checksumText.match(/\b[a-fA-F0-9]{64}\b/)?.[0]?.toLowerCase();
    if (!expected) throw new Error("Release checksum is missing or invalid");
    // Already downloaded and intact (an earlier run of the editor): nothing to fetch.
    const done = await Bun.file(staged).exists() && await sha256File(staged) === expected;
    if (!done) {
      // No limit on the whole download (slow connections), only on a download that stops moving.
      const stall = new AbortController();
      let timer = setTimeout(() => stall.abort(), 60000);
      const response = await fetch(release.asset.browser_download_url, { headers, signal: stall.signal });
      if (!response.ok || !response.body) throw new Error(`Update server returned HTTP ${response.status}`);
      this.state.total = Number(response.headers.get("content-length")) || release.asset.size;
      const writer = Bun.file(staged).writer();
      try {
        for await (const chunk of response.body) {
          clearTimeout(timer);
          timer = setTimeout(() => stall.abort(), 60000);
          writer.write(chunk);
          this.state.received += chunk.length;
        }
      } catch (error: any) {
        throw new Error(stall.signal.aborted ? "The download stopped: check the connection and retry" : error?.message || String(error));
      } finally {
        clearTimeout(timer);
        await writer.end();
      }
      if (await sha256File(staged) !== expected) throw new Error("Downloaded executable failed the SHA-256 check");
    }
    const file = Bun.file(staged);
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] !== 0x4d || head[1] !== 0x5a) throw new Error("Downloaded file is not a Windows executable");
    this.stagedPath = staged;
    return { ready: true, version: release.version };
  }

  async apply() {
    if (!this.executable || !this.stagedPath) throw new Error("No verified update is ready");
    if (this.release) {
      const { version, title, notes, url } = this.release;
      await writeFile(this.notesFile, JSON.stringify({ version, title, notes, url, shown: false }, null, 2));
    }
    const script = join(this.settingsDir, "updates", "install-update.ps1");
    // The paths are written into the script as literals, so no command line has to quote them.
    // UTF-8 with BOM: Windows PowerShell reads a script without BOM as ANSI, which breaks
    // paths with accented letters.
    const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
    await writeFile(script, `﻿$Current = ${literal(this.executable)}
$Replacement = ${literal(this.stagedPath)}
$OldPid = ${process.pid}
$ErrorActionPreference = 'Stop'
$deadline = (Get-Date).AddMinutes(2)
while ((Get-Process -Id $OldPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
if (Get-Process -Id $OldPid -ErrorAction SilentlyContinue) { exit 1 }
$backup = "$Current.previous"
try {
  if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
  Move-Item -LiteralPath $Current -Destination $backup -Force
  try { Copy-Item -LiteralPath $Replacement -Destination $Current -Force }
  catch { Move-Item -LiteralPath $backup -Destination $Current -Force; throw }
  Start-Process -FilePath $Current
} catch { $_ | Out-File -LiteralPath "$Current.update-error.txt" }
`, "utf8");
    // Processes started by Bun on Windows belong to a job that is killed when the editor exits,
    // and the editor has to exit before its executable can be replaced. "start" launches the
    // installer outside that job, so it survives the editor closing.
    const child = Bun.spawn(["cmd", "/d", "/c", "start", "", "/b", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    await child.exited;
    return { restarting: true };
  }
}
