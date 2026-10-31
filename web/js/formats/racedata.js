// Three race data files of Race/Common.szs (big endian), after the Custom Mario Kart wiki
// (mkwiiki.org: KMG, KRT, KRM):
// - minigame.kmg (RKMG): Battle settings: time limits, coins and points, per arena and player count;
// - ranktimeGP.krt (RKGT): the Grand Prix time limits per track and engine class, used for the
//   hidden score behind the GP rank;
// - vibration.krm (RKRM): the Wii Remote rumble patterns. The wiki documents only its header; the
//   entries are read from the file itself: three 16-bit values (the third is the length of the
//   data), the data, and a closing 0. Rumble patterns are text: "*" rumbles, "-" pauses.
// KMG and KRT keep their size, so they are edited in place like the other game data; a KRM is
// rebuilt when a pattern changes length.

const view = (d) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const hex = (n, pad = 2) => `0x${n.toString(16).toUpperCase().padStart(pad, '0')}`;
const magic = (data) => (data.length >= 4 ? String.fromCharCode(data[0], data[1], data[2], data[3]) : '');
const F = (at, label, help = '', type = 'u16') => ({ at, offset: at, label, help, type });

export const isKmg = (name, data) => /\.kmg$/i.test(name) && data.length >= 0x718 && magic(data) === 'RKMG';
export const isKrt = (name, data) => /\.krt$/i.test(name) && data.length >= 0x0c && magic(data) === 'RKGT';
export const isKrm = (name, data) => /\.krm$/i.test(name) && data.length >= 0x0c && magic(data) === 'RKRM';

// ---- KMG ----

export const BATTLE_STAGES = ['Delfino Pier', 'Block Plaza', 'Chain Chomp Wheel', 'Funky Stadium', 'Thwomp Desert',
  'GCN Cookie Land', 'DS Twilight House', 'SNES Battle Course 4', 'GBA Battle Course 3', 'N64 Skyscraper'];
const PLAYERS = Array.from({ length: 11 }, (_, i) => i + 2);
const KMG_TABLES = [
  [0x010, 'Balloon Battle', 'Time limit', 'Seconds of a Balloon Battle round. The original value is 180 (3 minutes).'],
  [0x0ec, 'Balloon Battle', 'Unknown table 0x0EC', 'Not documented.'],
  [0x1dc, 'Coin Runners', 'Time limit', 'Seconds of a Coin Runners round. The original value is 180 (3 minutes).'],
  [0x2b8, 'Coin Runners', 'Unknown table 0x2B8', 'Not documented.'],
  [0x394, 'Coin Runners', 'Coins at the start', 'Coins on the stage when the round starts.'],
  [0x470, 'Coin Runners', 'Most coins on the stage', 'Coins on the stage at most.'],
  [0x54c, 'Coin Runners', 'Unknown table 0x54C', 'Not documented.'],
  [0x628, 'Coin Runners', 'Unknown table 0x628', 'Not documented.'],
];

export function kmgTable(data) {
  const rows = [];
  rows.push({ label: 'Balloon Battle · points', sub: 'offset 0x01C8', fields: [
    F(0x1c8, 'Points for hitting a player', '', 's16'), F(0x1ca, 'Extra points for defeating a player', 'Unused in the original game (0).', 's16'),
    F(0x1cc, 'Points for losing all balloons', 'Negative: points taken away.', 's16'), F(0x1ce, 'Points when hit by a player', 'Unused in the original game.', 's16'),
    F(0x1d0, 'Points for hitting a teammate', 'Unused in the original game.', 's16'), F(0x1d2, 'Points lost when hit by a teammate', 'Unused in the original game.', 's16'),
    F(0x1d4, 'Unknown 0x0C', 'Not documented; the game multiplies it by 60, so it may be seconds.'), F(0x1d6, 'Unknown 0x0E', 'Not documented; multiplied by 60.'),
    F(0x1d8, 'Unknown 0x10', 'Not documented; multiplied by 60.'), F(0x1da, 'Unknown 0x12', 'Not documented.'),
  ] });
  rows.push({ label: 'Coin Runners · coins', sub: 'offset 0x0704', fields: [
    ...Array.from({ length: 7 }, (_, i) => F(0x704 + i * 2, `Unknown ${hex(i * 2)}`, 'Not documented.')),
    F(0x712, 'Fewest coins lost when falling off', 'Coins lost at least when falling out of bounds.'),
    F(0x714, 'Fewest coins lost when hit', 'Coins lost at least when hit by a player.'),
    F(0x716, 'Share of coins lost (%)', 'Percentage of the coins lost when hit, from 0 to 100.'),
  ] });
  for (const [start, mode, title, help] of KMG_TABLES) {
    BATTLE_STAGES.forEach((stage, s) => {
      const base = start + s * 0x16;
      rows.push({ label: `${mode} · ${title} · ${stage}`, sub: `offset ${hex(base, 4)}`,
        fields: PLAYERS.map((p, k) => F(base + k * 2, `${p} players`, help)) });
    });
  }
  return { kind: 'schema', title: 'Battle settings', rowsLabel: 'settings',
    help: 'Battle mode settings of minigame.kmg: the points of Balloon Battle, the coins of Coin Runners, and for every arena and number of players the time limit and coin counts. Search the list for an arena or a table.',
    rows };
}

// ---- KRT ----

// Track names by course ID (the order of the entries).
const KRT_TRACKS = ['Mario Circuit', 'Moo Moo Meadows', 'Mushroom Gorge', 'Grumble Volcano', "Toad's Factory", 'Coconut Mall', "DK Summit", "Wario's Gold Mine",
  'Luigi Circuit', 'Daisy Circuit', 'Moonview Highway', 'Maple Treeway', "Bowser's Castle", 'Rainbow Road', 'Dry Dry Ruins', 'Koopa Cape',
  'GCN Peach Beach', 'GCN Mario Circuit', 'GCN Waluigi Stadium', 'GCN DK Mountain', "DS Yoshi Falls", 'DS Desert Hills', 'DS Peach Gardens', 'DS Delfino Square',
  'SNES Mario Circuit 3', 'SNES Ghost Valley 2', 'N64 Mario Raceway', 'N64 Sherbet Land', "N64 Bowser's Castle", "N64 DK's Jungle Parkway", 'GBA Bowser Castle 3', 'GBA Shy Guy Beach'];
export const framesText = (frames) => {
  const s = frames / 60;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};

export function krtTable(data) {
  const v = view(data), count = v.getUint16(8), header = v.getUint16(10) || 0x0c;
  const rows = [{ label: 'File settings', sub: 'offset 0x0000', fields: [F(0x04, 'Rank time factor', 'Ignored: the game uses a fixed value instead (1000 in the original file).', 'u32')] }];
  for (let i = 0; i < count && header + (i + 1) * 8 <= data.length; i++) {
    const base = header + i * 8;
    const field = (at, cc) => F(base + at, `${cc} time limit (frames)`, `Frames from the countdown to the finish line; 60 frames are one second. Now ${framesText(v.getUint16(base + at))}.`);
    rows.push({ label: KRT_TRACKS[i] || `Track ${i + 1}`, sub: `course ${hex(i)} · offset ${hex(base, 4)}`,
      fields: [field(0, '50cc'), field(2, '100cc'), field(4, '150cc and Mirror')] });
  }
  return { kind: 'schema', title: 'Grand Prix time limits', rowsLabel: 'tracks',
    help: 'The time limit of each track and engine class used for the hidden score of every Grand Prix race (from −50 to 250; the four races make the GP rank): finishing faster than the limit and staying in first place score more. Score = 1000 × (limit − time) / limit + frames in first place × 150 / limit.',
    rows };
}

// ---- KRM ----

// { unknown, entries: [{ a, b, data: Uint8Array, tail: Uint8Array }] }
export function parseKRM(data) {
  const v = view(data), count = v.getUint16(8), header = v.getUint16(10);
  if (header !== 0x0c + count * 4) throw new Error('Unexpected KRM header');
  const offsets = Array.from({ length: count }, (_, i) => v.getUint32(0x0c + i * 4));
  const entries = offsets.map((offset, i) => {
    const start = header + offset, end = i + 1 < count ? header + offsets[i + 1] : data.length;
    if (end < start + 6 || end > data.length) throw new Error(`KRM entry ${i + 1} is outside the file`);
    const n = v.getUint16(start + 4);
    const dataEnd = Math.min(end, start + 6 + n);
    return { a: v.getUint16(start), b: v.getUint16(start + 2), data: data.slice(start + 6, dataEnd), tail: data.slice(dataEnd, end) };
  });
  return { unknown: v.getUint32(4), entries };
}

export function buildKRM({ unknown, entries }) {
  const header = 0x0c + entries.length * 4;
  const sizes = entries.map((e) => 6 + e.data.length + e.tail.length);
  const out = new Uint8Array(header + sizes.reduce((s, n) => s + n, 0)), v = view(out);
  out.set([0x52, 0x4b, 0x52, 0x4d]);
  v.setUint32(4, unknown);
  v.setUint16(8, entries.length);
  v.setUint16(10, header);
  let at = 0;
  entries.forEach((e, i) => {
    v.setUint32(0x0c + i * 4, at);
    const base = header + at;
    v.setUint16(base, e.a); v.setUint16(base + 2, e.b); v.setUint16(base + 4, e.data.length);
    out.set(e.data, base + 6);
    out.set(e.tail, base + 6 + e.data.length);
    at += sizes[i];
  });
  return out;
}

// The rumble pattern of an entry ("*" rumbles, "-" pauses; other marks are kept as they are), or null
// when its data is not a pattern. The data starts with a 0 and may end with 0s.
export function krmPattern(entry) {
  const d = entry.data;
  if (d.length < 2 || d[0] !== 0) return null;
  let end = d.length;
  while (end > 1 && d[end - 1] === 0) end--;
  const text = String.fromCharCode(...d.subarray(1, end));
  return /^[\x21-\x7e]*$/.test(text) && /[*-]/.test(text) ? text : null;
}

export function setKrmPattern(krm, index, text) {
  if (!/^[\x21-\x7e]{1,1000}$/.test(text)) throw new Error('Use 1 to 1000 visible characters: * rumbles, - pauses');
  const entries = krm.entries.map((e, i) => (i === index ? { ...e, data: Uint8Array.from([0, ...[...text].map((c) => c.charCodeAt(0))]), tail: new Uint8Array([0]) } : e));
  return { ...krm, entries };
}

export function setKrmValue(krm, index, key, value) {
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Whole numbers from 0 to 65535');
  return { ...krm, entries: krm.entries.map((e, i) => (i === index ? { ...e, [key]: value } : e)) };
}

export const raceDataDescription = (name, data) => isKmg(name, data) ? 'Battle settings' : isKrt(name, data) ? 'Grand Prix time limits' : isKrm(name, data) ? 'Rumble patterns' : null;

// The list of a KRM for the game data editor: the file settings, then every entry.
export function krmTable(data) {
  const krm = parseKRM(data);
  return { kind: 'krm', title: 'Rumble patterns', rowsLabel: 'entries', krm,
    help: 'How the Wii Remote rumbles: each pattern is a line of marks, "*" rumbles and "-" pauses, one mark after the other. Which pattern the game uses for what is not documented, nor are the two values of each entry and the other marks (such as 0, 1 and /); they are kept as they are.',
    rows: [{ label: 'File settings', sub: 'header', entry: -1 },
      ...krm.entries.map((e, i) => {
        const pattern = krmPattern(e);
        return { label: `${pattern ? 'Pattern' : 'Entry'} ${i + 1}`, sub: pattern ? pattern.slice(0, 28) : `values ${e.a}, ${e.b}`, entry: i };
      })] };
}
