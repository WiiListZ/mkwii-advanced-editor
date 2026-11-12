// Watches a running Dolphin from outside, reading its emulated memory on Windows the way memory
// tools do: MEM1 is a 32 MB mapped region that starts with the game's ID, MEM2 one of 64 MB.
// Nothing is ever written.
import { readRaceGhost, type RaceGhost } from "./race-ghost.ts";
import { readKartSample, readRacedGhost, type KartSample } from "./race-path.ts";

type Native = ReturnType<typeof open>;
let native: Native | null | undefined;

function open() {
  const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
  return dlopen("kernel32.dll", {
    CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.u64 },
    Process32FirstW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    Process32NextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
    VirtualQueryEx: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64], returns: FFIType.u64 },
    ReadProcessMemory: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  }).symbols;
}
function kernel() {
  if (native === undefined) {
    try { native = process.platform === "win32" ? open() : null; } catch { native = null; }
  }
  return native;
}

const PROCESS_QUERY_INFORMATION = 0x400, PROCESS_VM_READ = 0x10, SNAPSHOT_PROCESS = 2;
const MEM_COMMIT = 0x1000, MEM_MAPPED = 0x40000, MEM1_SIZE = 0x2000000, MEM2_SIZE = 0x4000000;
const INVALID = 0xFFFFFFFFFFFFFFFFn;

// Process IDs by executable name (compared without case).
export function findProcesses(match: (name: string) => boolean) {
  const k = kernel();
  if (!k) return [];
  const { ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const snapshot = BigInt(k.CreateToolhelp32Snapshot(SNAPSHOT_PROCESS, 0));
  if (snapshot === INVALID || !snapshot) return [];
  // PROCESSENTRY32W on 64 bits: dwSize at 0, th32ProcessID at 8, szExeFile at 44.
  const entry = new Uint8Array(568), view = new DataView(entry.buffer);
  view.setUint32(0, entry.length, true);
  const found: number[] = [];
  try {
    for (let more = k.Process32FirstW(snapshot, ptr(entry)); more; more = k.Process32NextW(snapshot, ptr(entry))) {
      let name = "";
      for (let at = 44; at < entry.length; at += 2) {
        const code = view.getUint16(at, true);
        if (!code) break;
        name += String.fromCharCode(code);
      }
      if (match(name.toLowerCase())) found.push(view.getUint32(8, true));
    }
  } finally { k.CloseHandle(snapshot); }
  return found;
}

// `size` bytes at `address` of another process, or null where it cannot be read.
export function readMemory(handle: bigint, address: bigint, size: number) {
  const k = kernel();
  if (!k) return null;
  const { ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const out = new Uint8Array(size), got = new BigUint64Array(1);
  return k.ReadProcessMemory(handle, address, ptr(out), BigInt(size), ptr(got)) && got[0] === BigInt(size) ? out : null;
}

export function openForReading(pid: number) {
  const k = kernel();
  if (!k) return 0n;
  return BigInt(k.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid));
}

const closeHandle = (handle: bigint) => { if (handle) kernel()?.CloseHandle(handle); };

// Finds emulated MEM1: a committed mapped region of 32 MB starting with a game ID.
export function findMem1(handle: bigint) {
  const k = kernel();
  if (!k) return null;
  const { ptr } = require("bun:ffi") as typeof import("bun:ffi");
  // MEMORY_BASIC_INFORMATION: BaseAddress 0, RegionSize 24, State 32, Type 40.
  const info = new Uint8Array(48), view = new DataView(info.buffer);
  let address = 0n;
  for (let guard = 0; guard < 200000; guard++) {
    if (!k.VirtualQueryEx(handle, address, ptr(info), 48n)) break;
    const base = view.getBigUint64(0, true), size = view.getBigUint64(24, true);
    if (Number(size) === MEM1_SIZE && view.getUint32(32, true) === MEM_COMMIT && view.getUint32(40, true) === MEM_MAPPED) {
      const id = readMemory(handle, base, 6);
      if (id && id.every((c) => c >= 0x30 && c <= 0x5A)) return { base, game: String.fromCharCode(...id) };
    }
    if (!size) break;
    address = base + size;
  }
  return null;
}

// Emulated MEM2: a committed mapped region of 64 MB. Dolphin maps it more than once, all views of the
// same memory; the one right after MEM1 is taken when there is one.
export function findMem2(handle: bigint, mem1: bigint) {
  const k = kernel();
  if (!k) return null;
  const { ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const info = new Uint8Array(48), view = new DataView(info.buffer);
  let address = 0n, first: bigint | null = null;
  for (let guard = 0; guard < 200000; guard++) {
    if (!k.VirtualQueryEx(handle, address, ptr(info), 48n)) break;
    const base = view.getBigUint64(0, true), size = view.getBigUint64(24, true);
    if (Number(size) === MEM2_SIZE && view.getUint32(32, true) === MEM_COMMIT && view.getUint32(40, true) === MEM_MAPPED) {
      if (base === mem1 + BigInt(MEM1_SIZE)) return base;
      first ??= base;
    }
    if (!size) break;
    address = base + size;
  }
  return first;
}

// Where the game keeps its race manager, per region; its race stage is at +0x28. Found on Mario Kart
// Wii PAL (RMCP01), carried over to the other regions with MKW-SP's tables (port.py); a value that
// makes no sense reads as unknown rather than as a stage.
const RACE_MANAGER: Record<string, number> = { P: 0x809BD730, E: 0x809B8F70, J: 0x809BC790, K: 0x809ABD70 };
const STAGE_OFFSET = 0x28;

const inMem1 = (value: number) => value >= 0x80000000 && value < 0x81800000;

export function readRaceStage(game: string, read: (emulated: number, size: number) => Uint8Array | null) {
  const pointerAt = game.startsWith("RMC") ? RACE_MANAGER[game[3]] : 0;
  if (!pointerAt) return null;
  const pointer = read(pointerAt, 4);
  if (!pointer) return null;
  const manager = new DataView(pointer.buffer).getUint32(0);
  if (!manager) return -1; // the pointer exists only during a race
  if (!inMem1(manager)) return null;
  const bytes = read(manager + STAGE_OFFSET, 4);
  if (!bytes) return null;
  const stage = new DataView(bytes.buffer).getUint32(0);
  return stage <= 4 ? stage : null;
}

export type GameState = { dolphin: boolean; game: string | null; stage: number | null };

let cached: { pid: number; handle: bigint; base: bigint; game: string; mem2?: bigint | null } | null = null;
function forget() {
  if (cached) closeHandle(cached.handle);
  cached = null;
}

// What Dolphin is doing now. stage: null unknown, -1 not in a race, otherwise the game's own value.
export function readGameState(): GameState {
  const pids = findProcesses((name) => /^dolphin.*\.exe$/.test(name));
  if (!pids.length) { forget(); return { dolphin: false, game: null, stage: null }; }
  if (cached && !pids.includes(cached.pid)) forget();
  if (cached && !readMemory(cached.handle, cached.base, 6)?.every((c, i) => c === cached!.game.charCodeAt(i))) forget();
  if (!cached) {
    for (const pid of pids) {
      const handle = openForReading(pid);
      if (!handle) continue;
      const found = findMem1(handle);
      if (found) { cached = { pid, handle, ...found }; break; }
      closeHandle(handle);
    }
  }
  if (!cached) return { dolphin: true, game: null, stage: null };
  const { handle, base, game } = cached;
  const stage = readRaceStage(game, (emulated, size) => {
    const offset = emulated - 0x80000000;
    return offset >= 0 && offset + size <= MEM1_SIZE ? readMemory(handle, base + BigInt(offset), size) : null;
  });
  return { dolphin: true, game, stage };
}

// Reads emulated addresses of the game found by readGameState, in MEM1 (0x80...) and MEM2 (0x90...).
function readEmulated(emulated: number, size: number) {
  if (!cached) return null;
  if (emulated >= 0x80000000 && emulated + size <= 0x80000000 + MEM1_SIZE) return readMemory(cached.handle, cached.base + BigInt(emulated - 0x80000000), size);
  if (emulated >= 0x90000000 && emulated + size <= 0x90000000 + MEM2_SIZE) {
    if (cached.mem2 === undefined) cached.mem2 = findMem2(cached.handle, cached.base);
    return cached.mem2 ? readMemory(cached.handle, cached.mem2 + BigInt(emulated - 0x90000000), size) : null;
  }
  return null;
}

// The ghost of the Time Trial on screen, once finished, from the game's memory (see race-ghost.ts).
export function readCurrentRaceGhost(): RaceGhost | null {
  const state = readGameState();
  return state.game && state.stage !== null && state.stage >= 3 ? readRaceGhost(state.game, readEmulated) : null;
}

// The first kart now, read many times a second while a race is recorded: Dolphin and the game are
// looked for again only every so often, as that takes much longer than the read.
let lastLook = 0;
export function readCurrentRacedGhost(): Uint8Array | null {
  if (!cached || Date.now() - lastLook > 2000) { lastLook = Date.now(); readGameState(); }
  return cached ? readRacedGhost(cached.game, readEmulated) : null;
}

export function readCurrentKart(kart = 0): KartSample | null {
  if (!cached || Date.now() - lastLook > 2000) { lastLook = Date.now(); readGameState(); }
  return cached ? readKartSample(cached.game, readEmulated, kart) : null;
}
