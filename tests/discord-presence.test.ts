import { expect, test } from "bun:test";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DiscordPresence } from "../src/discord-presence.ts";

const waitFor = async (test: () => boolean) => {
  for (let i = 0; i < 200; i++) { if (test()) return; await Bun.sleep(10); }
  throw new Error("Discord IPC test timed out");
};
const frame = (opcode: number, data: any) => {
  const body = Buffer.from(JSON.stringify(data)), result = Buffer.alloc(8 + body.length);
  result.writeUInt32LE(opcode); result.writeUInt32LE(body.length, 4); body.copy(result, 8);
  return result;
};
async function discordServer(handshake = true) {
  const id = `mkwii-discord-test-${crypto.randomUUID()}`;
  const path = process.platform === "win32" ? `\\\\.\\pipe\\${id}` : join(tmpdir(), id);
  const sockets = new Set<Socket>(), messages: any[] = [], pong: any[] = [];
  let connections = 0;
  const server = createServer((socket) => {
    connections++; sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= 8 && pending.length >= pending.readUInt32LE(4) + 8) {
        const opcode = pending.readUInt32LE(), size = pending.readUInt32LE(4);
        const message = JSON.parse(pending.toString("utf8", 8, 8 + size)); pending = pending.subarray(8 + size);
        if (opcode === 0) {
          messages.push({ handshake: message });
          if (handshake) {
            // Real pipes can split a header and coalesce the following frames.
            const response = frame(1, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } });
            socket.write(response.subarray(0, 3));
            setTimeout(() => { if (!socket.destroyed) socket.write(Buffer.concat([response.subarray(3), frame(3, { heartbeat: 123 })])); }, 5);
          }
        } else if (opcode === 4) pong.push(message);
        else if (opcode === 1) {
          messages.push(message);
          socket.write(frame(1, { cmd: message.cmd, nonce: message.nonce, data: message.args.activity }));
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
  return { path, sockets, messages, pong, get connections() { return connections; }, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } };
}

test("Discord IPC publishes the active editor, handles fragmented frames and clears activity when disabled", async () => {
  const server = await discordServer();
  const presence = new DiscordPresence({ clientId: "1566538603386110184", paths: [server.path + "-missing", server.path], updateMs: 10, retryMs: 30 });
  try {
    presence.update({ id: "home", mode: "home" });
    presence.setEnabled(true);
    await waitFor(() => presence.status.status === "connected" && server.pong.length > 0);
    expect(server.messages[0].handshake).toEqual({ v: 1, client_id: "1566538603386110184" });
    expect(server.pong[0]).toEqual({ heartbeat: 123 });
    const activities = () => server.messages.filter((m) => m.cmd === "SET_ACTIVITY");
    expect(activities()[0].args.pid).toBe(process.pid);
    expect(activities()[0].args.activity.details).toBe("On the home screen");
    expect(activities()[0].args.activity.timestamps.start).toBeGreaterThan(0);
    presence.update({ id: "one", mode: "editing", file: "C:\\Users\\Private\\Luigi Circuit.szs", focused: true });
    await waitFor(() => activities().at(-1)?.args.activity?.state === "Luigi Circuit.szs");
    presence.update({ id: "two", mode: "editing", file: "Moo Moo Meadows.szs", detail: "Editing collision", focused: true });
    presence.update({ id: "home", mode: "home", focused: false });
    await waitFor(() => activities().at(-1)?.args.activity?.state === "Moo Moo Meadows.szs");
    expect(activities().at(-1).args.activity.details).toBe("Editing collision");
    presence.remove("two");
    await waitFor(() => activities().at(-1)?.args.activity?.state === "Luigi Circuit.szs");
    presence.setEnabled(false);
    await waitFor(() => activities().at(-1)?.args.activity === null);
    const connections = server.connections;
    await Bun.sleep(80);
    expect(server.connections).toBe(connections); expect(presence.status).toEqual({ enabled: false, status: "disabled" });
    presence.setEnabled(true);
    await waitFor(() => presence.status.status === "connected" && server.connections > connections);
    expect(activities().at(-1).args.activity.state).toBe("Luigi Circuit.szs");
  } finally { presence.dispose(); await server.close(); }
});

test("Discord reconnects after a restart and expires vanished windows", async () => {
  const server = await discordServer();
  const presence = new DiscordPresence({ paths: [server.path], updateMs: 1, retryMs: 20, leaseMs: 150 });
  try {
    presence.setEnabled(true); presence.update({ id: "track", mode: "editing", file: "test.szs", focused: true });
    await waitFor(() => presence.status.status === "connected");
    for (const socket of server.sockets) socket.destroy();
    await waitFor(() => server.connections >= 2 && presence.status.status === "connected");
    expect(server.messages.filter((m) => m.cmd === "SET_ACTIVITY").at(-1).args.activity.state).toBe("test.szs");
    await Bun.sleep(170);
    presence.update({ id: "home", mode: "home", focused: false });
    await waitFor(() => server.messages.filter((m) => m.cmd === "SET_ACTIVITY").at(-1)?.args.activity?.details === "On the home screen");
  } finally { presence.dispose(); await server.close(); }
});

test("a missing or unresponsive Discord never blocks startup and can be disabled during connection", async () => {
  const server = await discordServer(false);
  const presence = new DiscordPresence({ paths: [server.path], retryMs: 20, timeoutMs: 30 });
  try {
    presence.setEnabled(true);
    await waitFor(() => server.connections >= 2);
    presence.setEnabled(false);
    const count = server.connections;
    await Bun.sleep(100);
    expect(server.connections).toBe(count); expect(presence.status.status).toBe("disabled");
  } finally { presence.dispose(); await server.close(); }
});
