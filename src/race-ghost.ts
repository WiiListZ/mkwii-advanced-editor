// The ghost of the Time Trial just finished, read from the game's memory. The game writes a ghost to
// its save only when it keeps the run (a track's personal slot holds its best time), but it records
// every run's buttons as it goes and leaves them in memory until the next race. With the race's
// settings and times, also in memory, they make the same ghost file the game would have saved.
//
// Where each thing is was found on Mario Kart Wii PAL (RMCP01) and checked against a ghost the game
// saved: the file built here is that ghost, byte for byte. The other regions' addresses are the PAL
// ones carried over with MKW-SP's tables (port.py), which run that mod on all four; the game's own
// structures are the same in each. What is read is checked, so a wrong address gives no ghost rather
// than a wrong one.
// @ts-ignore Shared Wii format reader used by the frontend.
import { buildRKG, COUNTDOWN_FRAMES, FRAMES_PER_SECOND, inputFrames, parseInputs, RKG_HEADER_SIZE, RKG_INPUT_LIMIT } from "../web/js/formats/rkg.js";

export type Read = (address: number, size: number) => Uint8Array | null;

// Pointers to the game's input manager, race settings and race manager, per region.
const POINTERS: Record<string, { input: number; config: number; manager: number }> = {
  P: { input: 0x809BD70C, config: 0x809BD728, manager: 0x809BD730 },
  E: { input: 0x809B8F4C, config: 0x809B8F68, manager: 0x809B8F70 },
  J: { input: 0x809BC76C, config: 0x809BC788, manager: 0x809BC790 },
  K: { input: 0x809ABD4C, config: 0x809ABD68, manager: 0x809ABD70 },
};

// Race settings: the first player of the race, and the course, mode and laps.
const PLAYER = 0x28, VEHICLE = 0x08, CHARACTER = 0x0C, MII_NAME = 0x7C, MII_ID = 0xA8, CONTROLLER = 0xD0;
const SETTINGS = 0xB68, COURSE = 0x00, MODE = 0x08, LAPS = 0x25, TIME_TRIAL = 2;
// Race manager: its players, and for each its lap and finish timers.
const STAGE = 0x28, PLAYERS = 0x0C, LAP_TIMERS = 0x3C, FINISH_TIMER = 0x40, TIMER_SIZE = 0x0C;
// First local player of the input manager: automatic drift, and the recording of its buttons.
const AUTOMATIC = 0xC5, RECORDING = 0xDC, RECORDED_SIZE = 0xE4;
const MII_SIZE = 0x4A;

const valid = (address: number) => (address >= 0x80000000 && address < 0x81800000) || (address >= 0x90000000 && address < 0x94000000);

function reader(read: Read) {
  const bytes = (address: number, size: number) => {
    if (!valid(address)) throw new Error("not in memory");
    const out = read(address, size);
    if (!out) throw new Error("not readable");
    return out;
  };
  const view = (address: number, size: number) => new DataView(bytes(address, size).buffer);
  return {
    bytes,
    u8: (address: number) => bytes(address, 1)[0],
    u32: (address: number) => view(address, 4).getUint32(0),
    timer: (address: number) => {
      const d = view(address, TIMER_SIZE);
      return { minutes: d.getUint16(4), seconds: d.getUint8(6), milliseconds: d.getUint16(8), set: d.getUint8(10) === 1 };
    },
  };
}

const ms = (t: { minutes: number; seconds: number; milliseconds: number }) => (t.minutes * 60 + t.seconds) * 1000 + t.milliseconds;
const time = (total: number) => ({ minutes: Math.floor(total / 60000), seconds: Math.floor(total / 1000) % 60, milliseconds: total % 1000 });

// CRC-16 CCITT (XModem) of the Mii, kept in the ghost after it.
export function miiCrc(mii: Uint8Array) {
  let crc = 0;
  for (const byte of mii) {
    crc ^= byte << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}

// The Mii's whole data is in memory in several places, none with a pointer that stays put: found by
// its ID and name, as the race settings give them. A whole copy is followed by its CRC; other records
// of the same Mii, with the same ID and name, hold other things in between.
export function findMii(read: Read, id: Uint8Array, name: Uint8Array) {
  const chunk = 0x100000, stored = MII_SIZE + 2;
  for (let at = 0x90000000; at < 0x94000000; at += chunk) {
    const data = read(at, chunk + stored) || read(at, chunk);
    if (!data) continue;
    for (let i = 0; i + stored <= data.length; i += 2) {
      if (data[i + 0x18] !== id[0] || data[i + 0x19] !== id[1]) continue;
      if (!id.every((b, k) => data[i + 0x18 + k] === b) || !name.every((b, k) => data[i + 2 + k] === b)) continue;
      const mii = data.slice(i, i + MII_SIZE), crc = miiCrc(mii);
      if (data[i + MII_SIZE] === crc >> 8 && data[i + MII_SIZE + 1] === (crc & 255)) return mii;
    }
  }
  return null;
}

export type RaceGhost = { bytes: Uint8Array; automatic: boolean };

// The ghost of the race on screen once its first player has finished a Time Trial, or null when
// there is none to read (another mode, still racing, another game, or memory that does not fit).
export function readRaceGhost(game: string, read: Read, date = new Date()): RaceGhost | null {
  const where = game.startsWith("RMC") ? POINTERS[game[3]] : null;
  if (!where) return null;
  try {
    const m = reader(read);
    const config = m.u32(where.config), manager = m.u32(where.manager), input = m.u32(where.input);
    const settings = config + SETTINGS, player = config + PLAYER;
    if (m.u32(settings + MODE) !== TIME_TRIAL || m.u32(manager + STAGE) < 3) return null;

    const racer = m.u32(m.u32(manager + PLAYERS));
    const finish = m.timer(m.u32(racer + FINISH_TIMER));
    if (!finish.set) return null;
    const laps = m.u8(settings + LAPS);
    if (laps < 1 || laps > 9) return null;
    const lapTimers = m.u32(racer + LAP_TIMERS);
    // The timers hold the time at the end of each lap; a ghost keeps each lap's own time (5 at most).
    const splits: ReturnType<typeof time>[] = [];
    let before = 0;
    for (let lap = 0; lap < 5; lap++) {
      if (lap >= laps) { splits.push(time(0)); continue; }
      const end = ms(m.timer(lapTimers + lap * TIMER_SIZE));
      if (end < before) return null;
      splits.push(time(end - before));
      before = end;
    }
    if (before !== ms(finish)) return null;

    // The buttons, as the ghost file keeps them; they stop with the finish line.
    const size = m.u32(input + RECORDED_SIZE);
    if (size < 8 || size > RKG_INPUT_LIMIT) return null;
    const recorded = m.bytes(m.u32(input + RECORDING), size);
    const inputs = parseInputs(recorded);
    const frames = inputFrames(inputs.face);
    if (frames !== inputFrames(inputs.direction) || frames !== inputFrames(inputs.tricks)) return null;
    if (Math.abs(frames - COUNTDOWN_FRAMES - ms(finish) * FRAMES_PER_SECOND / 1000) > 3) return null;
    const automatic = m.u8(input + AUTOMATIC);
    if (automatic > 1) return null;

    const mii = findMii(read, m.bytes(player + MII_ID, 8), m.bytes(player + MII_NAME, 20));
    if (!mii) return null;
    const header = new Uint8Array(RKG_HEADER_SIZE);
    header.set([0x52, 0x4B, 0x47, 0x44]);
    header.set([0xFF, 0xFF, 0xFF, 0xFF], 0x34); // country, region and place: not set by the game either
    header.set(mii, 0x3C);
    const crc = miiCrc(mii);
    header[0x86] = crc >> 8; header[0x87] = crc & 255;
    const controller = m.u32(player + CONTROLLER);
    if (controller > 3) return null;
    const bytes = buildRKG({
      header, time: finish, track: m.u32(settings + COURSE), vehicle: m.u32(player + VEHICLE), character: m.u32(player + CHARACTER),
      year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), controller, ghostType: 1,
      automatic: automatic === 1, laps, splits, country: 0xFF, inputs,
    }, { compressed: true });
    return { bytes, automatic: automatic === 1 };
  } catch {
    return null;
  }
}
