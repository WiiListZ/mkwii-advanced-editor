// Local HTTP server (runs in a worker): serves the UI and gives it access to files on disk.
// Listens on 127.0.0.1 only, and every API call must carry the token generated at startup.

import { appendFile, cp, mkdir, mkdtemp, copyFile, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename, resolve, sep } from "node:path";
import { assets } from "./embedded.gen.ts";
import { folderDialog, openDialog, saveDialog, revealInExplorer, openInBrowser, type FileFilter } from "./dialogs.ts";
import { convert3DToBRRES, deleteBRRESModel, duplicateBRRESModel, exportBRRESModel, import3DModel, importBRRESPart, listModelAnimations, parseTriangleRanges } from "./model-operations.ts";
import { importResourceAnimation } from "./asset-operations.ts";
import { buildGeneratedTrackModels } from "./generated-track-models.ts";
import { indexArchives, readArchiveFile } from "./archive-library.ts";
import { decodeWiimmArchive } from "./wiimm-archives.ts";
import { prepareBundledTools } from "./bundled-tools.ts";
import { removeCHR0 } from "./chr0-import.ts";
import { associationStatus, migrateLegacyAssociation, registerAssociations, unregisterAssociations } from "./file-assoc.ts";
import { tmpdir } from "node:os";
import packageJson from "../package.json" with { type: "json" };
import { ReleaseUpdater } from "./updater.ts";
import { EditorWindows } from "./editor-windows.ts";
import { CupTrackDrafts } from "./cup-track-drafts.ts";
import { createSnapshot, deleteSnapshot, listSnapshots, restoreSnapshot } from "./snapshots.ts";
// @ts-ignore - plain JS module shared with the UI
import { yaz0Compress } from "../web/js/formats/yaz0.js";

declare var self: Worker;

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  map: "application/json",
  json: "application/json",
  png: "image/png",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};

// Can be overridden by the "start" message (used by tests to keep the real settings untouched).
let settingsDir = join(process.env.APPDATA || process.env.HOME || ".", "MKWiiAdvancedEditor");
let settingsFile = join(settingsDir, "settings.json");
let updater: ReleaseUpdater;
let editorWindows = new EditorWindows();
let cupTracks = new CupTrackDrafts(settingsDir);
const windowDocuments = new Map<string, { name: string; data: Uint8Array }>();
let settingsWrite: Promise<unknown> = Promise.resolve();

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    return await Bun.file(settingsFile).json();
  } catch {
    return {};
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function start(token: string) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 512 * 1024 * 1024,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path.startsWith("/api/")) {
        if (req.headers.get("x-token") !== token) return json({ error: "Invalid token" }, 403);
        try {
          return await handleApi(req, url);
        } catch (err) {
          return json({ error: String((err as Error)?.message || err) }, 500);
        }
      }

      const name = path === "/" ? "index.html" : decodeURIComponent(path.slice(1));
      const file = assets[name];
      if (!file) return new Response("Not found", { status: 404 });
      const ext = name.split(".").pop() || "";
      return new Response(Bun.file(file), {
        headers: { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-cache" },
      });
    },
  });
  self.postMessage({ type: "ready", port: server.port });
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  const route = url.pathname.slice(5);
  const filePath = url.searchParams.get("path") || "";

  switch (route) {
    case "info":
      return json({ version: packageJson.version, bun: Bun.version, platform: process.platform, settingsDir });

    case "cup-track": {
      if (req.method === "GET") return json(await cupTracks.info(filePath));
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      return json(await cupTracks.create(new Uint8Array(await req.arrayBuffer()), url.searchParams.get("label") || "New track", url.searchParams.get("destination") || undefined));
    }

    case "cup-tracks-applied": {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      const body = await req.json() as { files: { source: string; path: string }[] };
      await cupTracks.applied(body.files || []);
      return json({ ok: true });
    }

    case "editor-window": {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      const target = new URL("/", url.origin);
      target.searchParams.set("t", req.headers.get("x-token")!);
      target.searchParams.set("editor", "1");
      let documentId: string | null = null;
      if (req.headers.get("content-type") === "application/octet-stream") {
        documentId = crypto.randomUUID();
        windowDocuments.set(documentId, { name: basename(url.searchParams.get("name") || "Custom Track.szs"), data: new Uint8Array(await req.arrayBuffer()) });
        const pendingId = documentId;
        setTimeout(() => windowDocuments.delete(pendingId), 300000).unref();
        target.searchParams.set("document", documentId);
      } else {
        const body = await req.json() as { path?: string; create?: string };
        if (body.path) {
          if (!existsSync(body.path) || !(await stat(body.path)).isFile()) return json({ error: "Track file not found" }, 404);
          target.searchParams.set("open", resolve(body.path));
        } else if (body.create === "generator" || body.create === "empty") target.searchParams.set("new", body.create);
        else return json({ error: "Choose a track or create a new one" }, 400);
      }
      try {
        return json(editorWindows.open(target.href, () => { if (documentId) windowDocuments.delete(documentId); }));
      } catch (error) { if (documentId) windowDocuments.delete(documentId); throw error; }
    }

    case "editor-document": {
      const id = url.searchParams.get("id") || "", doc = windowDocuments.get(id);
      if (!doc) return json({ error: "This track transfer is no longer available" }, 404);
      windowDocuments.delete(id);
      return new Response(doc.data, { headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(doc.name) } });
    }

    case "updates":
      if (req.method === "GET") return json(await updater.check());
      // The download runs in the background; the page follows it with update-progress.
      if (req.method === "POST") return json(updater.startDownload());
      return json({ error: "Unsupported method" }, 405);

    case "update-progress":
      return json(updater.progress());

    case "update-apply":
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      if (editorWindows.count) return json({ error: "Close the track editor windows, then install the update from Home." }, 409);
      return json(await updater.apply());

    // Notes of the version installed by the updater; POST marks them as read.
    case "release-notes":
      return json(req.method === "POST" ? await updater.markNotesShown() : await updater.installedNotes());

    // Notes of the running version (Help › Release notes).
    case "version-notes":
      return json(await updater.versionNotes());

    case "open-dialog": {
      const body = (await req.json()) as { filters?: FileFilter[]; title?: string };
      return json({ path: await openDialog(body.filters || [], body.title) });
    }

    case "save-dialog": {
      const body = (await req.json()) as { filters?: FileFilter[]; defaultName?: string; title?: string };
      return json({ path: await saveDialog(body.filters || [], body.defaultName, body.title) });
    }

    case "folder-dialog": {
      const body = (await req.json()) as { title?: string; initial?: string };
      return json({ path: await folderDialog(body.title, body.initial) });
    }

    case "modified-files": {
      // Backups from older saves and the edit log both count. The log also covers saves made
      // while the user has turned .bak creation off.
      if (!filePath || !existsSync(filePath)) return json({ error: "Folder not found: " + filePath }, 404);
      const entries = await readdir(filePath, { recursive: true, withFileTypes: true });
      const names = new Set(entries.filter((e) => e.isFile()).map((e) => join(e.parentPath ?? (e as any).path, e.name)));
      const logged = (await readFile(join(settingsDir, "edited-files.log"), "utf8").catch(() => ""))
        .split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as string]; } catch { return []; } });
      const root = resolve(filePath).replace(/[\\/]+$/, "") + sep;
      const edited = new Set([...names].filter((f) => !/\.bak$/i.test(f) && names.has(f + ".bak")));
      for (const path of logged) if (resolve(path).toLowerCase().startsWith(root.toLowerCase()) && existsSync(path)) edited.add(path);
      const files = [...edited].map((f) => resolve(f).slice(root.length).replace(/\\/g, "/")).sort();
      return json({ files });
    }

    case "copy": {
      // Copies a file or a whole folder (export of a Riivolution mod).
      const from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
      if (!from || !to || !existsSync(from)) return json({ error: "Nothing to copy: " + from }, 400);
      await mkdir(dirname(to), { recursive: true });
      await cp(from, to, { recursive: true, force: true });
      return json({ ok: true });
    }

    case "snapshots": {
      if (req.method === "POST") {
        const body = (await req.json()) as { label?: string; files?: string[]; details?: unknown };
        return json(await createSnapshot(settingsDir, String(body.label || "Backup"), (body.files || []).map(String), body.details ?? {}));
      }
      return json({ snapshots: await listSnapshots(settingsDir) });
    }

    // Removes one file (cups: an expert ghost of a track that is no longer there). Never a folder.
    case "delete": {
      if (req.method !== "POST" || !filePath) return json({ error: "POST with a path required" }, 400);
      if (!existsSync(filePath)) return json({ ok: true, removed: false });
      if (!(await stat(filePath)).isFile()) return json({ error: "Only files can be deleted" }, 400);
      await rm(filePath);
      return json({ ok: true, removed: true });
    }

    case "snapshot-restore":
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      return json(await restoreSnapshot(settingsDir, url.searchParams.get("id") || ""));

    case "snapshot-delete":
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      return json(await deleteSnapshot(settingsDir, url.searchParams.get("id") || ""));

    case "list-dir": {
      if (!filePath || !existsSync(filePath)) return json({ error: "Folder not found: " + filePath }, 404);
      const exts = (url.searchParams.get("ext") || "").split(",").filter(Boolean).map((e) => "." + e.toLowerCase());
      const entries = await readdir(filePath, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile() && (!exts.length || exts.some((x) => e.name.toLowerCase().endsWith(x))))
        .map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return json({ files });
    }

    case "archive-index": {
      if (!filePath || !existsSync(filePath)) return json({ error: "Folder not found: " + filePath }, 404);
      await mkdir(settingsDir, { recursive: true });
      const settings = await readSettings();
      return json(await indexArchives(filePath, join(settingsDir, "archive-index.json"), settingsDir,
        [String(settings.commonPath || ""), String(settings.workspace || ""), String(settings.partsFolder || "")]));
    }

    case "archive-file": {
      if (!filePath || !existsSync(filePath)) return json({ error: "File not found: " + filePath }, 404);
      const settings = await readSettings();
      const data = await readArchiveFile(filePath, url.searchParams.get("file") || "", settingsDir,
        [String(settings.commonPath || ""), String(settings.workspace || ""), String(settings.partsFolder || "")]);
      return new Response(data, { headers: { "content-type": "application/octet-stream" } });
    }

    case "decode-archive": {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      const settings = await readSettings();
      const sourcePaths = [url.searchParams.get("originals") || "", String(settings.commonPath || ""),
        String(settings.workspace || ""), String(settings.partsFolder || "")];
      const bytes = filePath ? null : new Uint8Array(await req.arrayBuffer());
      const data = await decodeWiimmArchive(filePath || null, bytes, settingsDir, sourcePaths);
      return new Response(data, { headers: { "content-type": "application/octet-stream" } });
    }

    case "read": {
      if (!filePath || !existsSync(filePath)) return json({ error: "File not found: " + filePath }, 404);
      return new Response(Bun.file(filePath), { headers: { "content-type": "application/octet-stream" } });
    }

    case "write": {
      if (!filePath) return json({ error: "Missing path" }, 400);
      let data = new Uint8Array(await req.arrayBuffer());
      // SZS saves send the raw U8 archive; compressing here keeps the UI responsive.
      if (url.searchParams.get("compress") === "yaz0") data = yaz0Compress(data);
      await mkdir(dirname(filePath), { recursive: true });
      let backup: string | null = null;
      // The first save over an existing file keeps a .bak copy of the original.
      if (url.searchParams.get("backup") === "1" && existsSync(filePath)) {
        backup = filePath + ".bak";
        if (!existsSync(backup)) await copyFile(filePath, backup);
        else backup = null;
      }
      await Bun.write(filePath, data);
      if (url.searchParams.get("edited") === "1") {
        await mkdir(settingsDir, { recursive: true });
        await appendFile(join(settingsDir, "edited-files.log"), JSON.stringify(resolve(filePath)) + "\n");
      }
      return json({ ok: true, size: data.length, backup });
    }

    case "duplicate-model": {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      const triple = (key: string) => (url.searchParams.get(key) || "").split(",").map(Number);
      const result = await duplicateBRRESModel(
        new Uint8Array(await req.arrayBuffer()),
        url.searchParams.get("model") || "",
        url.searchParams.get("part") || "",
        triple("center"), triple("delta"), parseTriangleRanges(url.searchParams.get("tris")),
      );
      return new Response(result, { headers: { "content-type": "application/octet-stream" } });
    }

    case "delete-animation": {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      const dir = await mkdtemp(join(tmpdir(), "mkwii-chr-remove-"));
      try {
        const result = await removeCHR0(new Uint8Array(await req.arrayBuffer()), url.searchParams.get("name") || "", dir);
        return new Response(result, { headers: { "content-type": "application/octet-stream" } });
      } finally { await rm(dir, { recursive: true, force: true }); }
    }

    case "import-resource-animation": {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      const body = new Uint8Array(await req.arrayBuffer());
      const split = Number(url.searchParams.get("donorLength"));
      if (!Number.isInteger(split) || split <= 0 || split >= body.length) return json({ error: "Invalid animation request" }, 400);
      const result = await importResourceAnimation(body.subarray(split), body.subarray(0, split), url.searchParams.get("name") || "");
      return new Response(result, { headers: { "content-type": "application/octet-stream" } });
    }

    case "stage-file": {
      // Dropped files are written to a per-drop temporary folder so tools can read them (and the
      // textures or .bin files dropped with them) from disk.
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      const session = url.searchParams.get("session") || "", name = basename(url.searchParams.get("name") || "");
      if (!/^[a-z0-9]{8,32}$/i.test(session) || !name || name.startsWith(".")) return json({ error: "Invalid file" }, 400);
      const dir = join(tmpdir(), `mkwii-drop-${session}`);
      await mkdir(dir, { recursive: true });
      const target = join(dir, name);
      await Bun.write(target, new Uint8Array(await req.arrayBuffer()));
      return json({ path: target });
    }

    case "export-model": {
      if (req.method !== "POST" || !filePath) return json({ error: "POST with a destination path required" }, 400);
      return json({ files: await exportBRRESModel(new Uint8Array(await req.arrayBuffer()), filePath) });
    }

    case "model-animations":
      if (!filePath || !existsSync(filePath)) return json({ error: "File not found: " + filePath }, 404);
      return json({ animations: await listModelAnimations(filePath) });

    case "import-model": {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      const target = (url.searchParams.get("target") || "").split(",").map(Number);
      const warnings: string[] = [];
      const result = await import3DModel(new Uint8Array(await req.arrayBuffer()), url.searchParams.get("path") || "", target, url.searchParams.get("animation") || "", warnings);
      return new Response(result, { headers: { "content-type": "application/octet-stream", "x-import-warnings": encodeURIComponent(JSON.stringify(warnings)) } });
    }

    case "convert-model-brres": {
      if (req.method !== "POST" || !filePath) return json({ error: "POST with a model path required" }, 400);
      const result = await convert3DToBRRES(filePath, url.searchParams.get("animation") || "", url.searchParams.get("name") || undefined);
      return new Response(result, { headers: { "content-type": "application/octet-stream" } });
    }

    case "generated-track-models": {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      return new Response(await buildGeneratedTrackModels(await req.json()), { headers: { "content-type": "application/octet-stream" } });
    }

    case "import-part": {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      // Body: source BRRES (sourceLength bytes) followed by the course_model.brres to patch.
      const body = new Uint8Array(await req.arrayBuffer());
      const split = Number(url.searchParams.get("sourceLength"));
      if (!Number.isInteger(split) || split <= 0 || split >= body.length) return json({ error: "Invalid part request" }, 400);
      const triple = (key: string) => {
        const raw = url.searchParams.get(key);
        return raw ? raw.split(",").map(Number) : null;
      };
      const result = await importBRRESPart(body.subarray(split), body.subarray(0, split), {
        model: url.searchParams.get("model") || "", part: url.searchParams.get("part") || "",
        pieceCenter: triple("piece"), target: triple("target"), tag: url.searchParams.get("tag") || undefined, triangles: parseTriangleRanges(url.searchParams.get("tris")),
      });
      return new Response(result.data, { headers: { "content-type": "application/octet-stream", "x-part-name": encodeURIComponent(result.name) } });
    }

    case "delete-model": {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      const center = (url.searchParams.get("center") || "").split(",").map(Number);
      const result = await deleteBRRESModel(new Uint8Array(await req.arrayBuffer()), url.searchParams.get("model") || "", url.searchParams.get("part") || "", center, parseTriangleRanges(url.searchParams.get("tris")));
      return new Response(result, { headers: { "content-type": "application/octet-stream" } });
    }

    case "exists":
      return json({ exists: existsSync(filePath), size: existsSync(filePath) ? (await stat(filePath)).size : 0 });

    case "reveal":
      revealInExplorer(filePath);
      return json({ ok: true });

    case "open-url":
      // Only the project's GitHub pages and Discord (see isAllowedUrl); anything else is refused.
      return openInBrowser(url.searchParams.get("url") || "") ? json({ ok: true }) : json({ error: "This address cannot be opened" }, 400);

    case "settings": {
      if (req.method === "GET") { await settingsWrite; return json(await readSettings()); }
      const patch = (await req.json()) as Record<string, unknown>;
      // Windows can change preferences at the same time: merge each patch after the preceding
      // write finishes, rather than reading the same old settings and overwriting one another.
      const write = settingsWrite.then(async () => {
        const next = { ...(await readSettings()), ...patch };
        await mkdir(settingsDir, { recursive: true });
        const temporary = `${settingsFile}.${crypto.randomUUID()}.tmp`;
        try {
          await Bun.write(temporary, JSON.stringify(next, null, 2));
          await rename(temporary, settingsFile);
        } catch (error) { await rm(temporary, { force: true }); throw error; }
        return next;
      });
      settingsWrite = write.catch(() => {});
      return json(await write);
    }

    case "file-association": {
      if (req.method === "GET") return json(associationStatus());
      const { register } = (await req.json()) as { register?: boolean };
      return json(register ? await registerAssociations() : await unregisterAssociations());
    }

    case "basename":
      return json({ name: basename(filePath) });
  }
  return json({ error: "Unknown API: " + route }, 404);
}

self.onmessage = async (e: MessageEvent) => {
  if (e.data?.type === "owner-closed") {
    await editorWindows.whenIdle();
    self.postMessage({ type: "windows-closed" });
    return;
  }
  if (e.data?.type === "start") {
    editorWindows = new EditorWindows(e.data.windowCommand || null);
    if (e.data.settingsDir) {
      settingsDir = e.data.settingsDir;
      settingsFile = join(settingsDir, "settings.json");
    }
    cupTracks = new CupTrackDrafts(settingsDir);
    updater = new ReleaseUpdater(packageJson.version, e.data.updateExecutable || null, settingsDir);
    void migrateLegacyAssociation();
    try {
      await prepareBundledTools(settingsDir);
      start(e.data.token);
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }
};
