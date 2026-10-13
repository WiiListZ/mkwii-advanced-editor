import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeWiimmArchive } from "../src/wiimm-archives.ts";

// These small archives were generated from synthetic files with Wiimm's SZS Tool.
// The test itself uses only the editor's built-in decoder.
const fixture = join(import.meta.dir, "fixtures", "wiimm-native");

test("Wiimm archive variants open without an installed decoder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-native-test-"));
  try {
    const courses = join(dir, "Race", "Course");
    await mkdir(courses, { recursive: true });
    const original = await readFile(join(fixture, "original.u8"));
    await writeFile(join(courses, "beginner_course.szs"), original);
    await writeFile(join(courses, "rainbow_course.szs"), original);
    const expected = await readFile(join(fixture, "track.u8"));
    for (const extension of ["wu8", "wbz", "wlz", "ybz"]) {
      const bytes = await readFile(join(fixture, `track.${extension}`));
      const actual = await decodeWiimmArchive(null, bytes, dir, [courses]);
      expect(Buffer.from(actual).equals(expected)).toBe(true);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
