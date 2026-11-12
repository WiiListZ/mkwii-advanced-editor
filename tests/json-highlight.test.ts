import { expect, test } from "bun:test";
// @ts-ignore Shared editor code used by the frontend.
import { jsonErrorAt, jsonTokens } from "../web/js/editor/json-highlight.js";
// @ts-ignore Shared data used by the frontend.
import { DEFAULT_OBJECT_DOCUMENTATION_JSON } from "../web/js/data/object-documentation.js";

test("JSON text is cut into pieces by kind, which together are the text", () => {
  const text = '{\n  "a": "x \\"q\\"",\n  "n": -1.5e3, "b": [true, null, false],\n  "c": {}\n}';
  const tokens = jsonTokens(text);
  expect(tokens.map((t: any) => t.text).join("")).toBe(text);
  const kinds = (type: string) => tokens.filter((t: any) => t.type === type).map((t: any) => t.text);
  expect(kinds("key")).toEqual(['"a"', '"n"', '"b"', '"c"']);
  expect(kinds("string")).toEqual(['"x \\"q\\""']);
  expect(kinds("number")).toEqual(["-1.5e3"]);
  expect(kinds("literal")).toEqual(["true", "null", "false"]);
  // While typing: an unfinished string, and what is not JSON at all, are kept as they are.
  for (const typing of ['{ "a": "unfinished\n}', "{ oops: 1 }", "", "@@"]) expect(jsonTokens(typing).map((t: any) => t.text).join("")).toBe(typing);
  // The whole default documentation too.
  const doc = JSON.stringify(DEFAULT_OBJECT_DOCUMENTATION_JSON, null, 2);
  expect(jsonTokens(doc).map((t: any) => t.text).join("")).toBe(doc);
});

test("the place where JSON stops being JSON is found, as the browser does not always say", () => {
  const valid = ['{}', '[]', '{"a": [1, -2.5e-3, true, false, null, "\\u00e9\\n"]}', ' 3 ', '"x"'];
  for (const text of valid) expect(jsonErrorAt(text)).toBe(-1);
  expect(jsonErrorAt(JSON.stringify(DEFAULT_OBJECT_DOCUMENTATION_JSON, null, 2))).toBe(-1);
  const at = (text: string) => jsonErrorAt(text);
  expect(at('{"status": oops "documented"}')).toBe(11);
  expect(at('{"a": 1,}')).toBe(8);
  expect(at('{"a": 1 "b": 2}')).toBe(8);
  expect(at('{"a": "open\n"}')).toBe(11);
  expect(at('{"a": 1')).toBe(7);
  expect(at('[1, 2] x')).toBe(7);
  expect(at("{'a': 1}")).toBe(1);
  expect(at('{"a": 01}')).toBe(7);
  // Wherever JSON.parse fails, a place is found; where it does not, none is.
  for (const text of ['{"a":', '[,', '{"a" 1}', '"\\x"', 'tru', '{"a": [1, 2}']) {
    expect(() => JSON.parse(text)).toThrow();
    expect(at(text)).toBeGreaterThanOrEqual(0);
  }
});
