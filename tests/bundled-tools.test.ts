import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { extractBundledTools } from "../src/bundled-tools.ts";
// @ts-ignore - shared JavaScript BRRES reader.
import { parseBRRES } from "../web/js/formats/brres.js";

test("bundled command-line tools extract and convert OBJ to BRRES", async () => {
  if (process.platform !== "win32") return;
  const dir = await mkdtemp(join(tmpdir(), "mkwii-bundled-tools-"));
  try {
    const tools = await extractBundledTools(join(dir, "cache"));
    expect((await extractBundledTools(join(dir, "cache"))).root).toBe(tools.root);
    expect(existsSync(join(tools.root, "abmatt", "source.tar.gz"))).toBe(true);
    expect(existsSync(join(tools.root, "wiimm", "source.tar.gz"))).toBe(true);
    await writeFile(join(dir, "triangle.obj"), "o Triangle\nv 0 0 0\nv 100 0 0\nv 0 100 0\nusemtl Default\nf 1 2 3\n");
    await writeFile(join(dir, "commands.txt"), "convert triangle.obj to triangle.brres\n");
    const env = { ...process.env, PATH: `${tools.wiimmBin};${process.env.PATH || ""}` };
    const abmatt = Bun.spawn([tools.abmatt, "-f", "commands.txt", "-o"],
      { cwd: dir, env, stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [code, out, err] = await Promise.all([abmatt.exited, new Response(abmatt.stdout).text(), new Response(abmatt.stderr).text()]);
    if (code) throw new Error(`Bundled ABMatt failed (${code}): ${out}\n${err}`);
    expect(code).toBe(0);
    const model = parseBRRES(new Uint8Array(await readFile(join(dir, "triangle.brres"))));
    expect(model.models[0]?.objects[0]?.triangles).toBe(1);
    const wiimm = Bun.spawn([tools.wszst, "VERSION"], { cwd: dir, env, stdout: "pipe", stderr: "pipe", windowsHide: true });
    expect(await wiimm.exited).toBe(0);
    expect(await new Response(wiimm.stdout).text()).toContain("v2.42a");
  } finally {
    const target = resolve(dir);
    if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary tool test path");
    await rm(target, { recursive: true, force: true });
  }
});
