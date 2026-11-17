// Menu videos in Pulsar packs. Pulsar's engine (Binaries/Code.pul: four Kamek binaries, one per
// region, each preceded by its size in the file's header) turns off the videos of the cup and
// course selection: ExpCupSelect overrides Menu::OnMoviesActivate with an empty function
// (ExpCupSelect.cpp, "Disable movies") and a Kamek write puts a nop over the course selection's call
// to Menu::LoadMovies (kmWrite32(0x808404f8, 0x60000000) on PAL).
//
// The engine could simply leave them on, but then every cup shows another cup's video: the course
// selection loads LoadMovies(&table[cup]) from the game's table of cup videos (in the game's order:
// Mushroom, Flower, Star, Special, Shell, Banana, Leaf, Lightning), while Pulsar numbers its cups
// by column (Mushroom, Shell, Flower, Banana, Star, Leaf, Special, Lightning). So, in the PAL engine:
//   - the relocation that fills ExpCupSelect's vtable slot 0x94 with the empty function gets the
//     game's own Menu::OnMoviesActivate instead (an absolute target);
//   - the write of the nop is moved onto an address the engine already writes the same nop to, so
//     the game's call to LoadMovies stays;
//   - six writes put the table in Pulsar's order, pointing at the game's own file names (StaticR,
//     PAL: table at 0x808d9430, names from 0x808ad228). No video file is copied;
//   - the cup selection shows one part of thp/course/cup_select.thp per cup (two columns of four:
//     column = cup / 4, row = cup % 4, in the game's order). Its two functions (the cup buttons,
//     0x807e5b9c and 0x807e5cb8) get row = (cup / 2) % 4 and column = cup % 2, Pulsar's order;
//   - custom cups (Pulsar's cup numbers from 0x40) have no video: the cup selection shows the
//     video's black bottom edge (row and column 7, past its end: the texture is clamped), and the
//     course selection loads no video (LoadMovies with a count of 0) instead of reading past the
//     table;
//   - Pulsar replaces the cup buttons' InitSelf (ExtCupSelectCupInitSelf, written over the game's at
//     0x808d324c) with one that never sets that picture: the page first opened with the whole video
//     (all 8 cups). Its call to PushButton::SelectInitial goes to a small function added after the
//     engine's code, which calls SelectInitial and then the game's handler for a selected cup button
//     (0x807e5c58: the picture, the track names);
//   - the same for the course selection's four track buttons: Pulsar's InitSelf
//     (ExtCourseSelectCourseInitSelf, over the game's at 0x808d30d8) never sets each button's part
//     of the cup's video, so on the first opening every button showed a part of the first track's.
//     Its call to CourseSelect::SelectButton (a virtual call, bctrl) becomes a call to a second
//     added function, which makes the same call and then the game's handler for a selected track
//     button (0x807e548c: every button's part);
//   - custom cups can have a video of their own on the course selection (up to CUSTOM_VIDEOS of
//     them, files thp/course/pulsar_<slot>.thp of the pack): the course selection's call to
//     LoadMovies gets its arguments from a third added function (a Kamek branch-link over
//     0x808404e0), which takes the game's table for the original cups and, for a custom cup, looks it
//     up in a table of [custom cup, file] added with it (no video when it is not there). The cup
//     selection still shows black for custom cups: its one video holds the 8 original cups.
//   Kamek puts the engine's bss right after its code and reaches it only through relocations, so
//   those move along by the size added.
//   - the single-player menu's buttons play their videos (button/single_top.thp) again: Pulsar's
//     LoadCorrectBRCTR (a branch-link from 0x8084f084, which loads each button) set the page's count
//     of videos to 0 after each one (stw r0,784(r31), now a nop), and its branch-link goes through a
//     fourth added function, which calls it and then gives Pulsar's extra Time Trial buttons (4 to
//     6) the part of the video of the Time Trial button (1): the game takes the part from the
//     button's number (r28, not used after that).
// The other regions keep Pulsar's setting (no videos): their table and names were not checked.
//
// Kamek command format (Kamek's loader): a u32 header, type << 24 | address (24 bits, relative to
// the code; 0xFFFFFE: an absolute address follows), then the arguments. Relocation targets with the
// high bit set are absolute, otherwise relative to the code.

const MAGIC = [0x4b, 0x61, 0x6d, 0x65, 0x6b, 0, 0, 3]; // "Kamek\0\0\3"
// Per region, from ExpCupSelect's vtable (+0x34 keeps the game's CupSelect::OnDeactivate).
const REGIONS = {
  0x80841ff8: 'PAL', 0x80827598: 'NTSC-U', 0x80841664: 'NTSC-J', 0x808303b8: 'NTSC-K',
};
const PAL = {
  onMoviesActivate: 0x808387f8, // Menu::OnMoviesActivate (Pulsar GameSource, Menu.hpp, slot 0x94)
  // Instructions written over the game's [address, new instruction]:
  code: [
    // Cup buttons, on selection (r6 = cup; r5 = row, r6 = column; r0 is free):
    // subfic r0,r6,7; srawi r0,r0,31 (-1 for a custom cup); rlwinm r5,r6,31,30,31 (cup / 2 % 4);
    // rlwinm r6,r6,0,31,31 (cup % 2); rlwinm r0,r0,0,29,31; or r5,r5,r0; or r6,r6,r0 (7 if custom)
    [0x807e5b9c, 0x20060007], [0x807e5ba0, 0x7c00fe70], [0x807e5ba4, 0x54c5ffbe], [0x807e5ba8, 0x54c607fe],
    [0x807e5bac, 0x5400077e], [0x807e5bb0, 0x7ca50378], [0x807e5bb4, 0x7cc60378],
    // The same when the page opens (r4 = cup; r3 = row, r4 = column), around the lis r8 at 0x807e5ccc.
    [0x807e5cb8, 0x20040007], [0x807e5cbc, 0x7c00fe70], [0x807e5cc0, 0x5483ffbe], [0x807e5cc4, 0x548407fe],
    [0x807e5cc8, 0x5400077e], [0x807e5cd0, 0x7c630378], [0x807e5cd4, 0x7c840378],
  ],
  // Course selection, before its call to LoadMovies at 0x808404f8: a branch-link to the third added
  // function at 0x808404e0 (a command), then nothing until the call.
  course: [[0x808404e4, 0x60000000], [0x808404e8, 0x60000000], [0x808404ec, 0x60000000], [0x808404f0, 0x60000000], [0x808404f4, 0x60000000]],
  courseCall: 0x808404e0,
  // What earlier versions wrote there instead (r0 = cup): rlwinm r4,r0,2,0,29; addi r5,r4,-32;
  // rlwinm r5,r5,1,31,31 (count: 1 for cups 0-7, else 0); addis r4,r4,0x808e; addi r4,r4,-0x6bd0
  // (&table[cup]); mr r3,r31.
  courseEarlier: [[0x808404e0, 0x5404103a], [0x808404e4, 0x38a4ffe0], [0x808404e8, 0x54a50ffe], [0x808404ec, 0x3c84808e],
    [0x808404f0, 0x38849430], [0x808404f4, 0x7fe3fb78]],
  // table[k] gets the video of Pulsar's cup k: [table entry, the game's "thp/course/<cup>.thp"]
  table: [
    [0x808d9434, 0x808ad284], // 1 Shell     koura.thp
    [0x808d9438, 0x808ad240], // 2 Flower    flower.thp
    [0x808d943c, 0x808ad29c], // 3 Banana    banana.thp
    [0x808d9440, 0x808ad258], // 4 Star      star.thp
    [0x808d9444, 0x808ad2b4], // 5 Leaf      konoha.thp
    [0x808d9448, 0x808ad26c], // 6 Special   special.thp
  ],
};
// Pulsar's InitSelf of the cup buttons: written over the game's at this vtable entry; it starts by
// keeping its argument (mr r25,r3) and ends with PushButton::SelectInitial.
const INIT_SELF = 0x808d324c, SELECT_INITIAL = 0x805bdaf0, CUP_SELECTED = 0x807e5c58, MR_R25_R3 = 0x7c791b78;
// The first function added after the code (r3 = the button, r4 = 0; r25 = the cup buttons, kept by
// the caller): SelectInitial(button, 0), then the handler (cups, button, 0). The calls are relocations.
const CUP_FN = [
  0x9421fff0, // stwu r1,-16(r1)
  0x7c0802a6, // mflr r0
  0x90010014, // stw r0,20(r1)
  0x93e1000c, // stw r31,12(r1)
  0x7c7f1b78, // mr r31,r3
  0x48000001, // bl PushButton::SelectInitial
  0x7fe4fb78, // mr r4,r31
  0x7f23cb78, // mr r3,r25
  0x38a00000, // li r5,0
  0x48000001, // bl the game's handler of a selected cup button
  0x83e1000c, // lwz r31,12(r1)
  0x80010014, // lwz r0,20(r1)
  0x7c0803a6, // mtlr r0
  0x38210010, // addi r1,r1,16
  0x4e800020, // blr
];
// Pulsar's InitSelf of the track buttons (over the game's at this vtable entry). It keeps
// &courseButtons[0] (addi r31,r3,396) and walks the four buttons (addi r29,r29,620; 620 bytes each)
// to pick the one to select, then calls the page's SelectButton(button): mr r4,r31; mtctr r12;
// bctrl, at these offsets from its start.
const COURSE_INIT_SELF = 0x808d30d8, COURSE_SELECTED = 0x807e548c, BCTRL = 0x4e800421;
const COURSE_SHAPE = [[0x18, 0x3be3018c], [0xa4, 0x3bbd026c], [0xb8, 0x7fe4fb78], [0xc0, 0x7d8903a6]];
const COURSE_CALL = 0xc4;
// The second added function, called in place of that bctrl (r3 = the page, r4 = the button, the
// count register holding SelectButton; r29 = &courseButtons[4], kept by the caller): the same call,
// then the handler (the track buttons, button, 0).
const COURSE_FN = [
  0x9421fff0, // stwu r1,-16(r1)
  0x7c0802a6, // mflr r0
  0x90010014, // stw r0,20(r1)
  0x93e1000c, // stw r31,12(r1)
  0x7c9f2378, // mr r31,r4
  0x4e800421, // bctrl (SelectButton)
  0x7fe4fb78, // mr r4,r31
  0x387df4c4, // addi r3,r29,-2876 (the track buttons control: &courseButtons[4] - 396 - 4 * 620)
  0x38a00000, // li r5,0
  0x48000001, // bl the game's handler of a selected track button
  0x83e1000c, // lwz r31,12(r1)
  0x80010014, // lwz r0,20(r1)
  0x7c0803a6, // mtlr r0
  0x38210010, // addi r1,r1,16
  0x4e800020, // blr
];
const COURSE_AT = CUP_FN.length * 4;
// The third added function, branch-linked from 0x808404e0 (r0 = the cup, Pulsar's number; r31 = the
// page): the arguments of LoadMovies, r3 = the page, r4 = where the name of the video is, r5 = how
// many (1, or 0 for no video). Original cups (below 8) take the game's table; a custom cup (0x40 +
// its index) the added table, entries [custom cup index, name], ended by -1 (an empty entry holds
// -2, which no cup matches).
export const CUSTOM_VIDEOS = 32;
const MOVIE_FN = [
  0x28000008, //  0 cmplwi r0,8
  0x40800018, //  1 bge 7 (a custom cup)
  0x5404103a, //  2 rlwinm r4,r0,2,0,29
  0x3c84808e, //  3 addis r4,r4,0x808e
  0x38849430, //  4 addi r4,r4,-0x6bd0 (&table[cup], 0x808d9430)
  0x38a00001, //  5 li r5,1
  0x48000048, //  6 b 24
  0x3cc00000, //  7 lis r6,table@ha (a relocation)
  0x38c60000, //  8 addi r6,r6,table@l (a relocation)
  0x7c070378, //  9 mr r7,r0
  0x38e7ffc0, // 10 addi r7,r7,-64 (the custom cup's index)
  0x81060000, // 11 lwz r8,0(r6)
  0x2c08ffff, // 12 cmpwi r8,-1
  0x41820020, // 13 beq 21 (not in the table)
  0x7c083800, // 14 cmpw r8,r7
  0x4182000c, // 15 beq 18
  0x38c60008, // 16 addi r6,r6,8
  0x4bffffe8, // 17 b 11
  0x38860004, // 18 addi r4,r6,4 (its name)
  0x38a00001, // 19 li r5,1
  0x48000010, // 20 b 24
  0x3c80808e, // 21 lis r4,0x808e
  0x38849430, // 22 addi r4,r4,-0x6bd0 (a valid name, not loaded)
  0x38a00000, // 23 li r5,0
  0x7fe3fb78, // 24 mr r3,r31
  0x4e800020, // 25 blr
];
const MOVIE_AT = COURSE_AT + COURSE_FN.length * 4;
// Pulsar's LoadCorrectBRCTR: reached by its branch-link from this address; it ends with
// PushButton::Load, then li r0,0; stw r0,784(r31) (the page's count of videos) at these offsets.
const SINGLE_CALL = 0x8084f084, SINGLE_SHAPE = [[0xdc, 0x38000000]], SINGLE_STORE = 0xe0, SINGLE_STW = 0x901f0310;
// The fourth added function, branch-linked from 0x8084f084 in its place (the button's arguments in
// r3-r9; r28 = the button's number, the caller's): LoadCorrectBRCTR, then r28 = 1 above 3.
const SINGLE_FN = [
  0x9421fff0, // stwu r1,-16(r1)
  0x7c0802a6, // mflr r0
  0x90010014, // stw r0,20(r1)
  0x48000001, // bl LoadCorrectBRCTR (a relocation)
  0x2c1c0003, // cmpwi r28,3
  0x40810008, // ble +8
  0x3b800001, // li r28,1 (Pulsar's Time Trial buttons: the Time Trial part of the video)
  0x80010014, // lwz r0,20(r1)
  0x7c0803a6, // mtlr r0
  0x38210010, // addi r1,r1,16
  0x4e800020, // blr
];
const TABLE_AT = MOVIE_AT + MOVIE_FN.length * 4; // CUSTOM_VIDEOS entries of 8 bytes, then -1
const NAMES_AT = TABLE_AT + CUSTOM_VIDEOS * 8 + 4;
const NAME_SIZE = 28;
const SINGLE_AT = NAMES_AT + CUSTOM_VIDEOS * NAME_SIZE;
const EMPTY = 0xfffffffe;
// The video file of a slot of the table, as the game loads it, and as the pack holds it
// (Assets/thp/course/…, the pack's Assets folder being the disc's root).
export const customVideoName = (slot) => `thp/course/pulsar_${String(slot).padStart(2, '0')}.thp`;
// The block added after the code, a multiple of 32 bytes (the bss keeps its alignment), and its calls.
const block = (course, movie, single) => {
  const words = course ? [...CUP_FN, ...COURSE_FN] : [...CUP_FN];
  if (movie) {
    words.push(...MOVIE_FN);
    for (let i = 0; i < CUSTOM_VIDEOS; i++) words.push(EMPTY, 0);
    words.push(0xffffffff);
    for (let i = 0; i < CUSTOM_VIDEOS; i++) {
      const name = new TextEncoder().encode(customVideoName(i)), bytes = new Uint8Array(NAME_SIZE);
      bytes.set(name);
      const v = new DataView(bytes.buffer);
      for (let k = 0; k < NAME_SIZE; k += 4) words.push(v.getUint32(k));
    }
    if (single) words.push(...SINGLE_FN);
  }
  while (words.length % 8) words.push(0);
  return words;
};
// The relocations of the block: [type, offset in the block, target in the block or absolute].
const blockRelocations = (course, movie, single) => [
  [10, 0x14, SELECT_INITIAL], [10, 0x24, CUP_SELECTED],
  ...(course ? [[10, COURSE_AT + 0x24, COURSE_SELECTED]] : []),
  ...(movie ? [
    [6, MOVIE_AT + 7 * 4 + 2, { block: TABLE_AT }], [4, MOVIE_AT + 8 * 4 + 2, { block: TABLE_AT }],
    ...Array.from({ length: CUSTOM_VIDEOS }, (_, i) => [1, TABLE_AT + i * 8 + 4, { block: NAMES_AT + i * NAME_SIZE }]),
  ] : []),
  ...(movie && single ? [[10, SINGLE_AT + 0xc, { code: single.fn }]] : []),
];
// Commands whose argument is a target (relative to the code unless its high bit is set).
const TARGETS = new Set([1, 2, 3, 4, 5, 6, 10, 35, 64, 65]);

// The game's Menu::OnMoviesActivate per region. An earlier version of this editor turned the videos
// on in every region without the table: each cup then showed another cup's video ("legacy").
const LEGACY = { PAL: 0x808387f8, 'NTSC-U': 0x80820900, 'NTSC-J': 0x80837e64, 'NTSC-K': 0x80826bb8 };
// The course selection's call to LoadMovies sits 0x1b00 bytes before CupSelect::OnDeactivate.
const LOAD_MOVIES_CALL = -0x1b00;
const SLOT = 0x94, ON_DEACTIVATE = 0x34;
const NOP = 0x60000000, BLR = 0x4e800020, WRITE32 = 32, ABSOLUTE = 0xfffffe;

// Argument bytes after the header (and its absolute address), per command type.
const ARGS = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 10: 4, 32: 4, 33: 4, 34: 4, 35: 8, 36: 8, 37: 8, 38: 8, 64: 4, 65: 4 };

// The Kamek binaries: [offset, size], from the sizes at the start of the file.
function binaries(code, v) {
  const out = [];
  // The header holds one size per binary; the binaries follow it back to back.
  let count = 1;
  while (count <= 16 && !MAGIC.every((b, i) => code[count * 4 + i] === b)) count++;
  if (count > 16) throw new Error('Not a Pulsar engine');
  let at = count * 4;
  for (let i = 0; i < count; i++) {
    const size = v.getUint32(i * 4);
    if (!MAGIC.every((b, k) => code[at + k] === b) || v.getUint32(at + 0x18) !== size) throw new Error('Unexpected Pulsar engine layout');
    out.push([at, size]);
    at += size;
  }
  if (at !== code.length || !out.length) throw new Error('Unexpected Pulsar engine layout');
  return out;
}

function commands(v, start, end) {
  const list = [];
  for (let p = start; p + 4 <= end;) {
    const header = v.getUint32(p), type = header >>> 24, rel = header & 0xffffff;
    if (!(type in ARGS)) {
      if (header === 0) break; // padding at the end
      throw new Error(`Unknown Kamek command ${type} at 0x${p.toString(16)}`);
    }
    const absolute = rel === ABSOLUTE;
    const argAt = p + 4 + (absolute ? 4 : 0);
    list.push({ at: p, type, absolute, address: absolute ? v.getUint32(p + 4) : rel, argAt, value: v.getUint32(argAt) });
    p = argAt + ARGS[type];
  }
  return list;
}

// What one Kamek binary holds: its region, and the commands to change (or the sign they changed).
// Pulsar's InitSelf call to SelectInitial: the relocation, and whether it goes to the added function.
function initCall(v, codeStart, codeSize, list) {
  const pointer = list.find((c) => c.type === 1 && c.absolute && c.address === INIT_SELF);
  if (!pointer || pointer.value & 0x80000000 || pointer.value + 0x18 > codeSize || v.getUint32(codeStart + pointer.value + 0x14) !== MR_R25_R3) return null;
  const fn = pointer.value;
  const isAdded = (at) => !(at & 0x80000000) && at + CUP_FN.length * 4 <= codeSize && CUP_FN.every((w, i) => v.getUint32(codeStart + at + i * 4) === w);
  const call = list.find((c) => c.type === 10 && !c.absolute && c.address > fn && c.address < fn + 0x100 && (c.value === SELECT_INITIAL || isAdded(c.value)));
  return call ? { call, added: call.value !== SELECT_INITIAL } : null;
}

// Pulsar's InitSelf call to the track page's SelectButton: where it is, and whether it calls the
// second added function.
function courseCall(v, codeStart, codeSize, list) {
  const pointer = list.find((c) => c.type === 1 && c.absolute && c.address === COURSE_INIT_SELF);
  if (!pointer || pointer.value & 0x80000000 || pointer.value + COURSE_CALL + 4 > codeSize) return null;
  const fn = pointer.value, word = (o) => v.getUint32(codeStart + fn + o);
  if (!COURSE_SHAPE.every(([o, w]) => word(o) === w)) return null;
  const at = fn + COURSE_CALL, call = word(COURSE_CALL);
  if (call === BCTRL) return { at, added: false };
  if (call >>> 26 !== 18 || (call & 3) !== 1) return null;
  let offset = call & 0x03fffffc; if (offset & 0x02000000) offset -= 0x04000000;
  const target = at + offset;
  const added = target >= 0 && target + COURSE_FN.length * 4 <= codeSize && COURSE_FN.every((w, i) => v.getUint32(codeStart + target + i * 4) === w);
  return added ? { at, added: true } : null;
}

// The course selection's branch-link to the third added function: where the function and its table are.
function movieCall(v, codeStart, codeSize, list) {
  const link = list.find((c) => c.type === 65 && c.absolute && c.address === PAL.courseCall);
  if (!link || link.value & 0x80000000) return null;
  const at = link.value;
  if (at + MOVIE_FN.length * 4 + CUSTOM_VIDEOS * 8 + 4 > codeSize || !MOVIE_FN.every((w, i) => [7, 8].includes(i) || v.getUint32(codeStart + at + i * 4) === w)) return null;
  return { at, table: at - MOVIE_AT + TABLE_AT };
}

// Pulsar's branch-link to LoadCorrectBRCTR: its function (Pulsar's, or the fourth added one in
// front of it) and whether the count of videos is kept.
function singleCall(v, codeStart, codeSize, list) {
  const link = list.find((c) => c.type === 65 && c.absolute && c.address === SINGLE_CALL);
  if (!link || link.value & 0x80000000 || link.value + SINGLE_FN.length * 4 > codeSize) return null;
  const word = (o) => v.getUint32(codeStart + o);
  const isShape = (fn) => fn + SINGLE_STORE + 4 <= codeSize && SINGLE_SHAPE.every(([o, w]) => word(fn + o) === w);
  if (isShape(link.value) && word(link.value + SINGLE_STORE) === SINGLE_STW) return { link, fn: link.value, added: false };
  if (!SINGLE_FN.every((w, i) => i === 3 || word(link.value + i * 4) === w)) return null;
  const call = list.find((c) => c.type === 10 && !c.absolute && c.address === link.value + 0xc);
  if (!call || call.value & 0x80000000 || !isShape(call.value) || word(call.value + SINGLE_STORE) !== NOP) return null;
  return { link, fn: call.value, added: true };
}

function inspect(v, k, size) {
  const codeStart = k + 0x20, codeSize = v.getUint32(k + 0x0c), end = k + size;
  if (codeStart + codeSize > end) throw new Error('Unexpected Kamek layout');
  const list = commands(v, codeStart + codeSize, end);
  const init = initCall(v, codeStart, codeSize, list);
  const course = courseCall(v, codeStart, codeSize, list);
  const movie = movieCall(v, codeStart, codeSize, list);
  const single = singleCall(v, codeStart, codeSize, list);
  for (const c of list) {
    // A relocation filling a vtable slot 0x94 whose vtable keeps CupSelect::OnDeactivate at 0x34.
    if (c.type !== 1 || c.absolute) continue;
    const vtable = codeStart + c.address - SLOT;
    if (vtable < codeStart || vtable + SLOT + 4 > codeStart + codeSize) continue;
    const onDeactivate = v.getUint32(vtable + ON_DEACTIVATE), region = REGIONS[onDeactivate];
    if (!region) continue;
    const nops = list.filter((w) => w.type === WRITE32 && w.absolute && w.value === NOP);
    const write = nops.find((w) => w.address === onDeactivate + LOAD_MOVIES_CALL);
    // This editor's writes found in the engine (the table, then the instructions).
    const ours = [...PAL.table, ...PAL.code, ...PAL.course];
    const has = ([at, value]) => list.some((w) => w.type === WRITE32 && w.absolute && w.address === at && w.value === value);
    const tableWrites = ours.filter(has).length + PAL.courseEarlier.filter(has).length;
    const emptyFn = !(c.value & 0x80000000) && v.getUint32(codeStart + c.value) === BLR;
    if (emptyFn && write && !tableWrites && !init?.added && !course?.added && !movie && !single?.added) {
      // Another nop the engine writes, before it: the moved write does nothing new there.
      const harmless = nops.filter((w) => w !== write && w.at < write.at).pop();
      if (!harmless) return { error: 'No other nop write to move it onto' };
      return { state: 'off', region, reloc: c, write, harmless: harmless.address, end, codeStart, codeSize, list, init, course, single };
    }
    // On: every write, both InitSelf calls when the engine has Pulsar's InitSelfs, and the function
    // of the course selection's videos.
    if (region === 'PAL' && c.value === PAL.onMoviesActivate && !write && tableWrites === ours.length && ours.every(has) && (!init || init.added) && (!course || course.added) && movie && (!single || single.added)) return { state: 'on', region, codeStart, movie };
    // Turned on by an earlier version: without the table (every cup with another cup's video), with
    // the table but not the instructions (the cup selection with other cups' pictures), without the
    // cup buttons' call (the cup selection first opened with the whole video) or without the track
    // buttons' (the track buttons first opened with parts of the first track's video).
    // (Every earlier version lacks the function of the course selection's videos, or the
    // single-player menu's videos.)
    if (c.value === LEGACY[region] && !write && (!movie || (single && !single.added))) return { state: 'legacy', region, codeStart, movie };
    return { error: 'The engine\'s movie commands are not the expected ones' };
  }
  return { error: 'ExpCupSelect\'s movie commands were not found' };
}

function read(code) {
  const v = new DataView(code.buffer, code.byteOffset, code.byteLength);
  return { v, found: binaries(code, v).map(([k, size]) => ({ k, size, ...inspect(v, k, size) })) };
}

// 'off' (Pulsar's own setting: no menu videos), 'on' (turned on in the PAL engine by this editor),
// 'legacy' (turned on by an earlier version, with videos of other cups: to be redone from the
// original engine) or null when the engine is not the one this was made for.
/** @returns {'on' | 'off' | 'legacy' | null} */
export function pulsarMenuVideos(code) {
  try {
    const { found } = read(code);
    if (found.some((s) => s.error) || !found.some((s) => s.region === 'PAL')) return null;
    if (found.every((s) => s.state === 'legacy')) return 'legacy';
    const pal = found.find((s) => s.region === 'PAL');
    if (found.some((s) => s !== pal && s.state !== 'off')) return null;
    return pal.state;
  } catch {
    return null;
  }
}

// The engine with the cup and course selection videos turned on (PAL), each cup with its own video.
// Only from Pulsar's own setting, and only when every region matches what is expected.
export function enablePulsarMenuVideos(code) {
  const state = pulsarMenuVideos(code);
  if (state === 'on') return code.slice();
  const result = withVideos(code, [...PAL.table, ...PAL.code, ...PAL.course], { cup: true, course: true, movie: true, single: true });
  if (pulsarMenuVideos(result) !== 'on') throw new Error('The engine could not be changed');
  return result;
}

// What earlier versions of this editor made of the engine (the table alone; the table and the
// instructions; those and the cup buttons' call): to recognise a pack's engine made from Pulsar's
// own and give it back.
export function earlierPulsarMenuVideos(code) {
  const all = [...PAL.table, ...PAL.code, ...PAL.courseEarlier];
  return [withVideos(code, PAL.table, {}), withVideos(code, all, {}), withVideos(code, all, { cup: true }), withVideos(code, all, { cup: true, course: true }),
    withVideos(code, [...PAL.table, ...PAL.code, ...PAL.course], { cup: true, course: true, movie: true })];
}

// The custom cups with a video in an engine turned on by this editor: Map<custom cup index, slot>
// (the slot names its file, customVideoName), or null when the engine has no such table.
export function pulsarCustomVideos(code) {
  try {
    const { v, found } = read(code);
    const pal = found.find((s) => s.region === 'PAL');
    if (!pal?.movie) return null;
    const out = new Map();
    for (let i = 0; i < CUSTOM_VIDEOS; i++) {
      const cup = v.getUint32(pal.codeStart + pal.movie.table + i * 8);
      if (cup !== EMPTY) out.set(cup, i);
    }
    return out;
  } catch {
    return null;
  }
}

// The engine without its custom cups' videos (an earlier version's too): to compare engines.
export function withoutCustomVideos(code) {
  try {
    const { found } = read(code);
    const pal = found.find((s) => s.region === 'PAL');
    if (!pal?.movie) return code;
    const out = code.slice(), ov = new DataView(out.buffer, out.byteOffset, out.byteLength);
    for (let i = 0; i < CUSTOM_VIDEOS; i++) ov.setUint32(pal.codeStart + pal.movie.table + i * 8, EMPTY);
    return out;
  } catch {
    return code;
  }
}

// The engine with these custom cups' videos (Map<custom cup index, slot>, at most CUSTOM_VIDEOS):
// only the table's cup numbers change.
export function setPulsarCustomVideos(code, videos) {
  if (videos.size > CUSTOM_VIDEOS) throw new Error(`At most ${CUSTOM_VIDEOS} custom cups can have a video`);
  const { found } = read(code);
  const pal = found.find((s) => s.region === 'PAL');
  if (pal?.state !== 'on') throw new Error('The engine has no table of custom videos: turn the menu videos on first');
  const out = code.slice(), ov = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const cups = new Array(CUSTOM_VIDEOS).fill(EMPTY);
  for (const [cup, slot] of videos) {
    if (!(slot >= 0 && slot < CUSTOM_VIDEOS) || cups[slot] !== EMPTY) throw new Error('Invalid video slot');
    cups[slot] = cup;
  }
  cups.forEach((cup, i) => ov.setUint32(pal.codeStart + pal.movie.table + i * 8, cup));
  return out;
}

function withVideos(code, ours, hooks) {
  if (pulsarMenuVideos(code) !== 'off') throw new Error('This Pulsar engine cannot be changed: it is not the expected version');
  const { found } = read(code);
  const pal = found.find((s) => s.region === 'PAL');
  // The two changed commands, in place.
  const out = code.slice(), ov = new DataView(out.buffer, out.byteOffset, out.byteLength);
  ov.setUint32(pal.reloc.argAt, PAL.onMoviesActivate);
  ov.setUint32(pal.write.at + 4, pal.harmless);
  // The functions added after the code: the bss after them moves along, so do its relocations.
  const init = hooks.cup ? pal.init : null, course = init && hooks.course ? pal.course : null, movie = !!(init && hooks.movie);
  const single = movie && hooks.single ? pal.single : null;
  const words = init ? block(!!course, movie, !!single) : [];
  const added = words.length * 4, at = pal.codeSize;
  if (init) {
    for (const c of pal.list) {
      if (!c.absolute && c.address >= at) throw new Error('Unexpected Kamek command in the bss');
      if (TARGETS.has(c.type) && !(c.value & 0x80000000) && c.value >= at) ov.setUint32(c.argAt, c.value + added);
    }
    ov.setUint32(init.call.argAt, at); // the cup buttons' InitSelf calls the first added function
  }
  if (single) {
    // The single-player menu: the count of videos is kept, and the branch-link goes to the fourth function.
    ov.setUint32(pal.codeStart + single.fn + SINGLE_STORE, NOP);
    ov.setUint32(single.link.argAt, at + SINGLE_AT);
  }
  if (course) {
    // The track buttons' InitSelf: bl to the second added function in place of its bctrl.
    const delta = at + COURSE_AT - course.at;
    ov.setUint32(pal.codeStart + course.at, (0x48000001 | (delta & 0x03fffffc)) >>> 0);
  }
  // The new commands at the end of the PAL binary's commands: the writes, and the added functions'
  // calls. Its size grows in the file's header and in its own header; the binaries after it move along.
  const relocations = init ? blockRelocations(!!course, movie, single) : [];
  const extra = new Uint8Array(ours.length * 12 + relocations.length * 8 + (movie ? 12 : 0)), ev = new DataView(extra.buffer);
  ours.forEach(([address, value], i) => { ev.setUint32(i * 12, (WRITE32 << 24) | ABSOLUTE); ev.setUint32(i * 12 + 4, address); ev.setUint32(i * 12 + 8, value); });
  relocations.forEach(([type, offset, target], i) => {
    const p = ours.length * 12 + i * 8;
    ev.setUint32(p, ((type << 24) | (at + offset)) >>> 0);
    ev.setUint32(p + 4, typeof target === 'number' ? target : target.code !== undefined ? target.code : at + target.block);
  });
  // The branch-link of the course selection to the third added function.
  if (movie) { const p = ours.length * 12 + relocations.length * 8; ev.setUint32(p, ((65 << 24) | ABSOLUTE) >>> 0); ev.setUint32(p + 4, PAL.courseCall); ev.setUint32(p + 8, at + MOVIE_AT); }
  const fn = new Uint8Array(added), fv = new DataView(fn.buffer);
  words.forEach((w, i) => fv.setUint32(i * 4, w));
  const index = found.indexOf(pal), codeEnd = pal.codeStart + at;
  const grow = added + extra.length;
  const result = new Uint8Array(out.length + grow);
  result.set(out.subarray(0, codeEnd));
  result.set(fn, codeEnd);
  result.set(out.subarray(codeEnd, pal.end), codeEnd + added);
  result.set(extra, pal.end + added);
  result.set(out.subarray(pal.end), pal.end + grow);
  const rv = new DataView(result.buffer);
  rv.setUint32(index * 4, pal.size + grow);
  rv.setUint32(pal.k + 0x18, pal.size + grow);
  rv.setUint32(pal.k + 0x0c, at + added);
  return result;
}
