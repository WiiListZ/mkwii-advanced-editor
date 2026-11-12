// JSON text in pieces, to colour each by what it is: a key, a string, a number, true/false/null,
// punctuation, or anything else (spaces, and what is not JSON). The pieces together are the text
// exactly, also while it is being typed and is not valid yet.

const TOKEN = /("(?:[^"\\\n]|\\.)*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

export function jsonTokens(text) {
  const out = [];
  let at = 0;
  const plain = (end) => { if (end > at) out.push({ type: 'plain', text: text.slice(at, end) }); };
  for (const match of text.matchAll(TOKEN)) {
    plain(match.index);
    const [whole, string, colon, number, literal, punctuation] = match;
    if (string !== undefined) {
      out.push({ type: colon ? 'key' : 'string', text: string });
      if (colon) out.push({ type: 'punctuation', text: colon });
    } else if (number !== undefined) out.push({ type: 'number', text: number });
    else if (literal !== undefined) out.push({ type: 'literal', text: literal });
    else out.push({ type: 'punctuation', text: punctuation });
    at = match.index + whole.length;
  }
  plain(text.length);
  return out;
}

// Where JSON text first stops being JSON, as an offset, or -1 when it is valid. Browsers' own
// JSON.parse messages do not all say where.
export function jsonErrorAt(text) {
  let i = 0;
  const space = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const fail = () => { throw i; };
  const expect = (word) => { if (text.startsWith(word, i)) i += word.length; else fail(); };
  const string = () => {
    if (text[i] !== '"') fail();
    for (i++; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { i++; return; }
      if (c === '\n' || c < ' ') fail();
      if (c === '\\') {
        i++;
        if (text[i] === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail(); i += 4; }
        else if (!'"\\/bfnrt'.includes(text[i] ?? 'x')) fail();
      }
    }
    fail();
  };
  const value = () => {
    space();
    const c = text[i];
    if (c === '{') {
      i++; space();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        space(); string(); space(); expect(':'); value(); space();
        if (text[i] === ',') { i++; continue; }
        expect('}'); return;
      }
    }
    if (c === '[') {
      i++; space();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        value(); space();
        if (text[i] === ',') { i++; continue; }
        expect(']'); return;
      }
    }
    if (c === '"') return string();
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (number) { i += number[0].length; return; }
    for (const word of ['true', 'false', 'null']) if (text.startsWith(word, i)) { i += word.length; return; }
    fail();
  };
  try {
    value(); space();
    return i < text.length ? i : -1;
  } catch (at) {
    return Math.min(at, text.length);
  }
}
