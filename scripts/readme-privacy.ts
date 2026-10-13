// Preload for README screenshot runs: no picture may show a path of the computer it was taken on.
// Before every page or element screenshot, absolute paths on the page are shortened (a game folder
// becomes "Mario Kart Wii\files\…", any other folder its last name), then the screenshot is refused
// if the user name, the home folder or a drive path is still visible.
// Usage: bun run --preload ./scripts/readme-privacy.ts <capture script or smoke test> …
import puppeteer from "puppeteer-core";
import { homedir, tmpdir, userInfo } from "node:os";

const user = userInfo().username;
const forbidden = [user, homedir(), tmpdir(), "\\Users\\", "/Users/", "AppData"].filter((value) => value && value.length > 2);

function shorten(forbiddenValues: string[]) {
  // Drive paths (C:\…, C:/…) and the file:// form; a "files" folder keeps the game-relative part.
  const path = /(?:file:\/\/\/?)?\b[A-Za-z]:[\\/][^\s"'<>|*?\n]*/g;
  const short = (match: string) => {
    const sep = match.includes("\\") ? "\\" : "/";
    const parts = match.replace(/^file:\/\/\/?/, "").split(/[\\/]/).filter(Boolean);
    const files = parts.map((part) => part.toLowerCase()).lastIndexOf("files");
    if (files > 0) return ["Mario Kart Wii", ...parts.slice(files)].join(sep);
    return parts.length > 1 ? parts[parts.length - 1] : "";
  };
  const fix = (text: string) => text.replace(path, short);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = fix(node.nodeValue || "");
    if (next !== node.nodeValue) node.nodeValue = next;
  }
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
    const next = fix(field.value);
    if (next !== field.value) field.value = next;
    if (field.placeholder) field.placeholder = fix(field.placeholder);
  }
  // What is still visible after shortening.
  const visible = [document.body.innerText, ...[...document.querySelectorAll<HTMLInputElement>("input, textarea")].map((f) => `${f.value} ${f.placeholder || ""}`)].join("\n");
  const lower = visible.toLowerCase();
  const leak = forbiddenValues.find((value) => lower.includes(value.toLowerCase()));
  if (leak) return `"${leak}" near: ${visible.slice(Math.max(0, lower.indexOf(leak.toLowerCase()) - 80), lower.indexOf(leak.toLowerCase()) + 80)}`;
  const drive = visible.match(/\b[A-Za-z]:[\\/][^\s]*/);
  return drive ? `drive path ${drive[0]}` : "";
}

async function guard(page: any) {
  const leak = await page.evaluate(shorten, forbidden);
  if (leak) throw new Error(`Screenshot refused, a path of this computer is visible: ${leak}`);
}

const patched = new WeakSet<object>();
function patch(proto: any, pageOf: (self: any) => any) {
  if (!proto || patched.has(proto)) return;
  patched.add(proto);
  const original = proto.screenshot;
  proto.screenshot = async function (this: any, ...args: any[]) {
    await guard(pageOf(this));
    return original.apply(this, args);
  };
}

const launch = puppeteer.launch.bind(puppeteer);
(puppeteer as any).launch = async (...args: any[]) => {
  const browser = await launch(...args);
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await newPage();
    patch(Object.getPrototypeOf(page), (self) => self);
    const body = await page.$("html");
    // Element screenshots (a canvas, the viewport) check the whole page they belong to.
    if (body) patch(Object.getPrototypeOf(body), (self) => self.frame?.page?.() ?? page);
    await body?.dispose();
    return page;
  };
  return browser;
};
