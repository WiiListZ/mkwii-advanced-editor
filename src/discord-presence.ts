// Discord Rich Presence uses its desktop client's local IPC pipe, never a bot
// token or account credentials. Connection/retry work must not delay the editor.
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";

export const DISCORD_APPLICATION_ID = "1566538603386110184";
export type PresenceStatus = "disabled" | "unconfigured" | "connecting" | "waiting" | "connected" | "error";
export type EditorActivity = { id: string; mode: "home" | "editing"; file?: string; detail?: string; focused?: boolean };
type WindowActivity = EditorActivity & { seen: number; focusOrder: number };

const text = (value: string, limit = 128) => {
  let result = "";
  for (const c of String(value).replace(/[\x00-\x1f\x7f]/g, "").trim()) {
    if (Buffer.byteLength(result + c) > limit) break;
    result += c;
  }
  return result;
};
export function discordFrame(opcode: number, payload: unknown) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8); header.writeUInt32LE(opcode); header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
export function discordIPCPaths() {
  if (process.platform === "win32") return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const roots = [...new Set([process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, "/tmp"].filter(Boolean))] as string[];
  return roots.flatMap((root) => Array.from({ length: 10 }, (_, i) => join(root, `discord-ipc-${i}`)));
}

export class DiscordPresence {
  private socket: Socket | null = null;
  private ready = false;
  private connecting = false;
  private generation = 0;
  private enabled = false;
  private disposed = false;
  private state: PresenceStatus = "disabled";
  private windows = new Map<string, WindowActivity>();
  private focusOrder = 0;
  private started = Math.floor(Date.now() / 1000);
  private retry: ReturnType<typeof setTimeout> | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private sweep: ReturnType<typeof setInterval>;
  private lastSent = 0;
  private lastActivity = "";
  private pendingNonce = "";
  private clientId: string;
  constructor(private options: { clientId?: string; paths?: string[]; retryMs?: number; timeoutMs?: number; updateMs?: number; leaseMs?: number } = {}) {
    this.clientId = options.clientId ?? process.env.MKWII_DISCORD_APPLICATION_ID ?? DISCORD_APPLICATION_ID;
    this.sweep = setInterval(() => this.publish(), 10000); this.sweep.unref();
  }
  get status() { return { enabled: this.enabled, status: this.state }; }
  setEnabled(enabled: boolean) {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) { this.started = Math.floor(Date.now() / 1000); void this.connect(); }
    else { this.state = "disabled"; this.disconnect(true); }
  }
  update(activity: EditorActivity) {
    const previous = this.windows.get(activity.id);
    this.windows.set(activity.id, { ...activity, file: text(String(activity.file || "").split(/[\\/]/).pop() || ""), detail: text(activity.detail || ""),
      seen: Date.now(), focusOrder: activity.focused ? ++this.focusOrder : previous?.focusOrder || 0 });
    this.publish();
  }
  remove(id: string) { this.windows.delete(id); this.publish(); }
  private activity() {
    const now = Date.now();
    for (const [id, window] of this.windows) if (now - window.seen > (this.options.leaseMs ?? 45000)) this.windows.delete(id);
    const current = [...this.windows.values()].sort((a, b) => b.focusOrder - a.focusOrder || b.seen - a.seen)[0];
    return { type: 0, details: current?.mode === "editing" ? (current.detail && current.detail.length >= 2 ? current.detail : "Editing a track") : "On the home screen",
      state: current?.mode === "editing" && current.file ? (current.file.length >= 2 ? current.file : `Track: ${current.file}`) : "Mario Kart Wii track editor", timestamps: { start: this.started } };
  }
  private publish() {
    if (!this.enabled || !this.ready || !this.socket || this.publishTimer) return;
    const activity = this.activity(), serialized = JSON.stringify(activity);
    if (serialized === this.lastActivity) return;
    const delay = Math.max(0, (this.options.updateMs ?? 5000) - (Date.now() - this.lastSent));
    if (delay) {
      this.publishTimer = setTimeout(() => { this.publishTimer = null; this.publish(); }, delay); this.publishTimer.unref();
      return;
    }
    this.lastActivity = serialized; this.lastSent = Date.now(); this.pendingNonce = crypto.randomUUID();
    this.write(1, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity }, nonce: this.pendingNonce });
  }
  private write(opcode: number, payload: unknown) {
    try { if (this.socket && !this.socket.destroyed) this.socket.write(discordFrame(opcode, payload)); }
    catch { this.socket?.destroy(); }
  }
  private disconnect(clear: boolean) {
    this.generation++;
    if (this.retry) clearTimeout(this.retry); this.retry = null;
    if (this.publishTimer) clearTimeout(this.publishTimer); this.publishTimer = null;
    const socket = this.socket;
    this.socket = null; this.ready = false; this.connecting = false; this.lastActivity = ""; this.lastSent = 0;
    if (socket) {
      if (clear && !socket.destroyed) {
        try { socket.end(discordFrame(1, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: null }, nonce: crypto.randomUUID() })); }
        catch { socket.destroy(); }
        const timer = setTimeout(() => socket.destroy(), 300); timer.unref();
      } else socket.destroy();
    }
  }
  private scheduleRetry() {
    if (!this.enabled || this.disposed || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; void this.connect(); }, this.options.retryMs ?? 15000); this.retry.unref();
  }
  private async connect() {
    if (!this.enabled || this.disposed || this.connecting || this.socket) return;
    if (!/^\d{17,20}$/.test(this.clientId)) { this.state = "unconfigured"; return; }
    this.connecting = true; this.state = "connecting";
    const generation = this.generation;
    for (const path of this.options.paths ?? discordIPCPaths()) {
      if (!this.enabled || this.disposed || generation !== this.generation) return;
      const socket = await this.open(path, generation);
      if (socket) { this.connecting = false; return; }
    }
    if (generation !== this.generation) return;
    this.connecting = false; this.state = "waiting"; this.scheduleRetry();
  }
  private open(path: string, generation: number) {
    return new Promise<Socket | null>((resolve) => {
      const socket = createConnection(path); socket.unref();
      let buffer = Buffer.alloc(0), settled = false, active = false;
      const timer = setTimeout(() => socket.destroy(), this.options.timeoutMs ?? 2000); timer.unref();
      const finish = (value: Socket | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
      socket.on("connect", () => {
        if (!this.enabled || this.disposed || generation !== this.generation) { socket.destroy(); return; }
        this.socket = socket;
        socket.write(discordFrame(0, { v: 1, client_id: this.clientId }));
      });
      socket.on("data", (data) => {
        if (generation !== this.generation || !this.enabled || this.disposed) { socket.destroy(); return; }
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 8) {
          const opcode = buffer.readUInt32LE(0), size = buffer.readUInt32LE(4);
          if (size > 1024 * 1024) { socket.destroy(); return; }
          if (buffer.length < 8 + size) return;
          const body = buffer.subarray(8, 8 + size); buffer = buffer.subarray(8 + size);
          if (opcode === 3) { socket.write(discordFrame(4, body)); continue; }
          if (opcode === 2) { socket.destroy(); return; }
          if (opcode !== 1) continue;
          let message: any;
          try { message = JSON.parse(body.toString("utf8")); } catch { socket.destroy(); return; }
          if (message.cmd === "DISPATCH" && message.evt === "READY") {
            active = true; this.ready = true; this.lastActivity = ""; this.lastSent = 0;
            finish(socket); this.publish();
          } else if (message.evt === "ERROR") {
            this.state = "error";
            if (!active) socket.destroy();
          } else if (message.cmd === "SET_ACTIVITY" && message.nonce === this.pendingNonce) this.state = "connected";
        }
      });
      socket.on("error", () => {});
      socket.on("close", () => {
        finish(null);
        if (this.socket === socket) { this.socket = null; this.ready = false; this.lastActivity = ""; }
        if (active && generation === this.generation && this.enabled && !this.disposed) {
          this.state = "waiting"; this.scheduleRetry();
        }
      });
    });
  }
  dispose() { this.enabled = false; this.disposed = true; clearInterval(this.sweep); this.windows.clear(); this.disconnect(true); this.state = "disabled"; }
}
