import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { CupTrackDrafts } from "../src/cup-track-drafts.ts";
import { buildU8 } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";

test("a cup track has an automatic working file and links to its actual position only after Apply", async () => {
  const temp = mkdtempSync(join(tmpdir(), "mkwii-cup-draft-"));
  try {
    const drafts = new CupTrackDrafts(temp), destination = join(temp, "1.szs"), repeated = join(temp, "0.szs");
    const bytes = buildU8({ name: "root", children: [{ name: "course.kmp", data: new Uint8Array([1, 2, 3]) }] });
    const { path } = await drafts.create(bytes, "Cup 1 / Track 2", destination);
    expect(existsSync(destination)).toBe(false);
    expect(yaz0Decompress(new Uint8Array(readFileSync(path)))).toEqual(bytes);
    expect(await drafts.info(path)).toEqual({ label: "Cup 1 / Track 2", path, pending: true });
    // Apply may repeat the same source in earlier positions: keep the editor on the chosen one.
    await Bun.write(destination, readFileSync(path)); await Bun.write(repeated, readFileSync(path));
    await drafts.applied([{ source: path, path: repeated }, { source: path, path: destination }]);
    expect(await new CupTrackDrafts(temp).info(path)).toEqual({ label: "Cup 1 / Track 2", path: destination, pending: false });
    expect(await drafts.info(destination)).toBeNull();
    expect(await drafts.info(join(temp, "..", "unknown.szs"))).toBeNull();
    // A moved track follows the destination actually written, rather than its original position.
    const moved = join(temp, "2.szs"); await Bun.write(moved, readFileSync(path));
    await drafts.applied([{ source: path, path: moved }]);
    expect((await drafts.info(path))?.path).toBe(moved);
  } finally {
    if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test cleanup");
    rmSync(temp, { recursive: true, force: true });
  }
});
