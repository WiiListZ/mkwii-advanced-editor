// Wiimm's BMG text format (what wbmgt decodes to and encodes from), as far as the Pulsar engine's own
// texts use it: "<hex id> = text" lines, "+ text" continuation lines, "#" comments, and the escapes
// \n \t \r \\, octal \040, \x{…} (raw characters), \u{…} (a name: 1A 0801), \c{colour} (1A 0800 0001)
// and \z{code,value} (any escape sequence). Escapes are turned into this editor's {1A:…} notation
// (bmg.js), so createBMG can write them. Rules from Wiimm's SZS Tools, dclib/lib-bmg.c.

import { createBMG } from './bmg.js';

// Colour names of \c{…}.
const COLOURS = {
  off: 0x00, none: 0x00, gray: 0x00, grey: 0x00, red4: 0x01, white: 0x02, transp: 0x08, transparent: 0x08, clear: 0x08,
  yor0: 0x10, yor1: 0x11, yor2: 0x12, yor3: 0x13, yor4: 0x14, yor5: 0x15, yor6: 0x16, yor7: 0x17,
  yr0: 0x10, yr1: 0x11, yr2: 0x12, yr3: 0x13, yr4: 0x14, yr5: 0x15, yr6: 0x16, yr7: 0x17,
  red2: 0x20, blue1: 0x21, blue: 0x21, yellow: 0x30, blue2: 0x31, red3: 0x32, green: 0x33, red1: 0x40, red: 0x40,
};
const hex = (n, digits) => n.toString(16).padStart(digits, '0');
const escape = (bytes) => `{1A:${bytes.map((b) => hex(b, 2)).join('')}}`;

function decodeText(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c !== '\\') { out += c; continue; }
    const k = src[++i];
    const braced = () => {
      if (src[i + 1] !== '{') throw new Error(`BMG text: \\${k} needs {…}`);
      const end = src.indexOf('}', i + 2);
      const body = src.slice(i + 2, end);
      i = end;
      return body;
    };
    if (k === 'n') out += '\n';
    else if (k === 't') out += '\t';
    else if (k === 'r') out += '\r';
    else if (k === '\\') out += '\\';
    else if (k >= '0' && k <= '7') {
      let digits = k;
      while (digits.length < 3 && src[i + 1] >= '0' && src[i + 1] <= '7') digits += src[++i];
      out += String.fromCharCode(parseInt(digits, 8));
    } else if (k === 'x') {
      for (const code of braced().split(',')) out += String.fromCharCode(parseInt(code, 16));
    } else if (k === 'u') {
      for (const code of braced().split(',').map((v) => parseInt(v, 16))) out += escape([0x08, 0x01, (code >>> 24) & 255, (code >>> 16) & 255, (code >>> 8) & 255, code & 255]);
    } else if (k === 'c') {
      const name = braced().trim().toLowerCase();
      const code = name in COLOURS ? COLOURS[name] : parseInt(name, 16);
      out += escape([0x08, 0x00, 0x00, 0x01, (code >> 8) & 255, code & 255]);
    } else if (k === 'z') {
      // \z{code,value…}: code's high byte is the escape's size in bytes (with the 1A character).
      const [first, ...values] = braced().split(',');
      const code = parseInt(first, 16);
      const words = (code + 0x100) >> 9;
      const bytes = [(code >> 8) & 255, code & 255];
      const rest = (words - 2) * 2;
      let data = values.length ? BigInt('0x' + values.join('')) : 0n;
      const tail = [];
      for (let b = 0; b < rest; b++) { tail.unshift(Number(data & 255n)); data >>= 8n; }
      out += escape([...bytes, ...tail]);
    } else throw new Error(`BMG text: unknown escape \\${k}`);
  }
  return out;
}

// Messages of a BMG text: [[id, text]], in file order. `vars` replaces {NAME} placeholders.
export function parseBMGText(source, vars = {}) {
  const messages = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const plus = /^\s*\+\s?(.*)$/.exec(line);
    if (plus) {
      if (!messages.length) throw new Error('BMG text: "+" line without a message');
      messages[messages.length - 1][1] += decodeText(fill(plus[1], vars));
      continue;
    }
    const m = /^\s*([0-9a-fA-F]+)\s*=\s?(.*)$/.exec(line);
    if (!m) throw new Error(`BMG text: cannot read "${line.trim()}"`);
    messages.push([parseInt(m[1], 16), decodeText(fill(m[2].replace(/^[ \t]+/, ''), vars))]);
  }
  return messages;
}

const fill = (text, vars) => text.replace(/\{([A-Za-z]+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all));

// A BMG file from a BMG text plus more messages ([[id, text]], already in {1A:…} notation).
export function bmgFromText(source, vars = {}, more = []) {
  const map = new Map(parseBMGText(source, vars));
  for (const [id, text] of more) map.set(id, text);
  return createBMG([...map.entries()].sort((a, b) => a[0] - b[0]));
}
