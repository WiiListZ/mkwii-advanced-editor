// Small GitHub-flavoured Markdown renderer for release notes. It builds React elements
// (never HTML strings), so the text of a release cannot inject markup or scripts.
import * as React from "react";
import { toast } from "sonner";
import { api } from "../../js/api.js";

const REPO = "https://github.com/WiiListZ/mkwii-advanced-editor";
const LIST = /^( *)([-*+]|\d{1,9}[.)])(?: +(.*)|$)/;
const FENCE = /^ *(```+|~~~+)/;
const HEADING = /^ {0,3}(#{1,6})(?: +(.*?))?(?: +#+)? *$/;
const RULE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const QUOTE = /^ {0,3}> ?/;
const TABLE_RULE = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; text: string }
  | { type: "rule" }
  | { type: "quote"; blocks: Block[] }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "table"; head: string[]; rows: string[][] };

const indentOf = (line: string) => line.length - line.trimStart().length;
const startsBlock = (lines: string[], i: number) => {
  const line = lines[i];
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST.test(line)
    || (line.includes("|") && TABLE_RULE.test(lines[i + 1] || ""));
};
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim());

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").replace(/\t/g, "    ").split("\n");
  return parseBlocks(lines);
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      i++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ type: "heading", level: heading[1].length, text: heading[2] || "" }); i++; continue; }
    if (RULE.test(line)) { blocks.push({ type: "rule" }); i++; continue; }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || quoted.length)) quoted.push(lines[i++].replace(QUOTE, ""));
      blocks.push({ type: "quote", blocks: parseBlocks(quoted) });
      continue;
    }
    if (LIST.test(line)) { i = parseList(lines, i, blocks); continue; }
    if (line.includes("|") && TABLE_RULE.test(lines[i + 1] || "")) {
      const head = cells(line), rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(cells(lines[i]));
      blocks.push({ type: "table", head, rows });
      continue;
    }
    const paragraph = [line.trim()];
    for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines, i); i++) paragraph.push(lines[i].trim());
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

// Items of one list (same indent and kind); deeper lines belong to the current item and are parsed
// as its own blocks, so nested lists work.
function parseList(lines: string[], i: number, blocks: Block[]) {
  const first = LIST.exec(lines[i])!;
  const base = first[1].length, ordered = /\d/.test(first[2]);
  const items: string[][] = [];
  let contentIndent = 0, blank = false;
  while (i < lines.length) {
    const line = lines[i], item = LIST.exec(line);
    if (item && item[1].length < base + 2 && item[1].length >= base) {
      if (/\d/.test(item[2]) !== ordered) break;
      items.push([item[3] || ""]);
      contentIndent = item[1].length + item[2].length + 1;
      blank = false;
      i++;
      continue;
    }
    if (!line.trim()) {
      const next = lines.slice(i + 1).find((l) => l.trim());
      const nextItem = next && LIST.exec(next);
      if (!next || (indentOf(next) <= base && !(nextItem && nextItem[1].length >= base))) break;
      items[items.length - 1].push("");
      blank = true;
      i++;
      continue;
    }
    if (indentOf(line) > base) { items[items.length - 1].push(line.slice(Math.min(indentOf(line), contentIndent))); i++; continue; }
    // A wrapped line without indent still continues the item's text.
    if (!blank && !startsBlock(lines, i)) { items[items.length - 1].push(line.trim()); i++; continue; }
    break;
  }
  blocks.push({ type: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items: items.map((item) => parseBlocks(item)) });
  return i;
}

// ---- Inline ------------------------------------------------------------------------------------

const INLINE = new RegExp([
  String.raw`\\(?<esc>[!-/:-@[-\x60{-~])`,
  String.raw`(?<ticks>\x60+)(?<code>[\s\S]*?[^\x60])\k<ticks>(?!\x60)`,
  String.raw`!\[(?<imgAlt>[^\]]*)\]\((?<imgUrl>[^)\s]+)(?: +"[^"]*")?\)`,
  String.raw`\[(?<linkText>(?:\[[^\]]*\]|[^\]])*)\]\((?<linkUrl>[^)\s]+)(?: +"[^"]*")?\)`,
  String.raw`<(?<auto>https?://[^>\s]+)>`,
  String.raw`(?<bare>https?://[^\s<]*[^\s<.,:;"')\]!?*_])`,
  String.raw`(?<sd>\*\*|__)(?=\S)(?<strong>[\s\S]*?\S)\k<sd>`,
  String.raw`~~(?=\S)(?<strike>[\s\S]*?\S)~~`,
  String.raw`(?<ed>[*_])(?=\S)(?<em>[\s\S]*?\S)\k<ed>`,
  String.raw`#(?<issue>\d+)\b`,
].join("|"), "g");

const isWord = (char: string | undefined) => !!char && /[\p{L}\p{N}_]/u.test(char);

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pushText = (value: string) => value.split("\n").forEach((part, n) => {
    if (n) out.push(<br key={`${key}-br${out.length}`} />);
    if (part) out.push(part);
  });
  let pos = 0;
  while (pos < text.length) {
    INLINE.lastIndex = pos;
    const match = INLINE.exec(text);
    if (!match) break;
    const g = match.groups!, k = `${key}-${match.index}`, before = text[match.index - 1], after = text[match.index + match[0].length];
    // "snake_case", "file_name_" and "abc#1" stay literal text.
    if ((g.ed === "_" || g.sd === "__") && (isWord(before) || isWord(after)) || (g.issue && isWord(before))) {
      pushText(text.slice(pos, match.index + 1));
      pos = match.index + 1;
      continue;
    }
    pushText(text.slice(pos, match.index));
    pos = match.index + match[0].length;
    if (g.esc) out.push(g.esc);
    else if (g.code !== undefined) out.push(<code key={k} className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">{g.code.replace(/^ (.*) $/, "$1")}</code>);
    else if (g.imgUrl) out.push(<Link key={k} url={g.imgUrl}>{g.imgAlt || "image"}</Link>);
    else if (g.linkUrl) out.push(<Link key={k} url={g.linkUrl}>{inline(g.linkText, k)}</Link>);
    else if (g.auto || g.bare) out.push(<Link key={k} url={g.auto || g.bare}>{g.auto || g.bare}</Link>);
    else if (g.strong) out.push(<strong key={k} className="font-semibold text-foreground">{inline(g.strong, k)}</strong>);
    else if (g.strike) out.push(<s key={k}>{inline(g.strike, k)}</s>);
    else if (g.em) out.push(<em key={k}>{inline(g.em, k)}</em>);
    else if (g.issue) out.push(<Link key={k} url={`${REPO}/issues/${g.issue}`}>#{g.issue}</Link>);
  }
  pushText(text.slice(pos));
  return out;
}

// Links open in the browser through the backend, which only opens the project's GitHub pages:
// other addresses are copied so they can be pasted in a browser.
function Link({ url, children }: { url: string; children: React.ReactNode }) {
  const absolute = url.startsWith("/") ? `https://github.com${url}` : url;
  // Only web addresses become links (no javascript:, file: …).
  if (!/^https?:\/\//i.test(absolute)) return <>{children}</>;
  const open = async (event: React.MouseEvent) => {
    event.preventDefault();
    try { await api.openUrl(absolute); }
    catch {
      await navigator.clipboard?.writeText(absolute).catch(() => {});
      toast.info("Link copied", { description: absolute });
    }
  };
  return <a href={absolute} title={absolute} onClick={open} className="cursor-pointer text-primary underline underline-offset-2">{children}</a>;
}

// ---- Blocks ------------------------------------------------------------------------------------

const HEADING_CLASS = ["", "text-base", "text-[15px]", "text-sm", "text-[13px]", "text-[13px]", "text-[13px]"];

function renderBlocks(blocks: Block[], key: string, tight = false): React.ReactNode[] {
  return blocks.map((block, n) => {
    const k = `${key}.${n}`;
    switch (block.type) {
      case "heading": {
        const Tag = `h${block.level}` as "h1";
        return <Tag key={k} className={`mb-1.5 mt-4 font-semibold text-foreground first:mt-0 ${HEADING_CLASS[block.level]}`}>{inline(block.text, k)}</Tag>;
      }
      case "paragraph": return <p key={k} className={tight ? "m-0" : "my-2 first:mt-0 last:mb-0"}>{inline(block.text, k)}</p>;
      case "code": return <pre key={k} className="my-2 overflow-auto rounded-md bg-muted p-2 font-mono text-xs"><code>{block.text}</code></pre>;
      case "rule": return <hr key={k} className="my-3 border-border" />;
      case "quote": return <blockquote key={k} className="my-2 border-l-2 pl-3 text-muted-foreground">{renderBlocks(block.blocks, k)}</blockquote>;
      case "list": {
        const items = block.items.map((item, m) => <li key={`${k}-${m}`} className="mt-1 first:mt-0">{renderBlocks(item, `${k}-${m}`, true)}</li>);
        return block.ordered
          ? <ol key={k} start={block.start} className="my-2 list-decimal space-y-0 pl-5 first:mt-0 last:mb-0 [&_ol]:my-1 [&_ul]:my-1">{items}</ol>
          : <ul key={k} className="my-2 list-disc pl-5 first:mt-0 last:mb-0 [&_ol]:my-1 [&_ul]:my-1 [&_ul]:list-[circle]">{items}</ul>;
      }
      case "table": return <div key={k} className="my-2 overflow-auto"><table className="border-collapse text-xs">
        <thead><tr>{block.head.map((cell, m) => <th key={m} className="border px-2 py-1 text-left font-semibold">{inline(cell, `${k}h${m}`)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, m) => <td key={m} className="border px-2 py-1">{inline(cell, `${k}r${r}c${m}`)}</td>)}</tr>)}</tbody>
      </table></div>;
    }
  });
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => parseMarkdown(text), [text]);
  return <div className={`text-[13px] leading-relaxed text-muted-foreground ${className}`}>{renderBlocks(blocks, "md")}</div>;
}

// The notes as one line of plain text, for previews that have no room for formatting.
export function markdownSummary(text: string) {
  return parseMarkdown(text).flatMap(function plain(block: Block): string[] {
    switch (block.type) {
      case "heading": case "paragraph": return [block.text];
      case "quote": return block.blocks.flatMap(plain);
      case "list": return block.items.flatMap((item) => item.flatMap(plain));
      default: return [];
    }
  }).join(" · ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|\x60)/g, "")
    .replace(/(^|\s)[*_](\S)/g, "$1$2").replace(/(\S)[*_](?=\s|$)/g, "$1")
    .replace(/\s*\n\s*/g, " ");
}
