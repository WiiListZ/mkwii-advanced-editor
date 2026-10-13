import { expect, test } from "bun:test";
import { findRiivolutionWorkspace, findWorkspaceRoot, resolveRiivolutionPath } from "../web/js/editor/workspace.js";
import { externalPath, parseRiivolution } from "../web/js/formats/riivolution.js";

const join = (...parts: string[]) => parts.join("/");
const setup = (files: string[]) => ({
  join,
  exists: async (path: string) => files.includes(path),
  listDir: async (path: string, extensions: string[]) => {
    const prefix = `${path}/`;
    return files.filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes("/") && extensions.some((ext) => file.toLowerCase().endsWith(`.${ext}`)));
  },
});

test("workspace accepts the files folder and common extracted-disc parents", async () => {
  for (const root of ["disc", "disc/files", "disc/DATA/files"]) {
    const files = [`${root}/sound/strm/n_Farm_n.brstm`];
    expect(await findWorkspaceRoot("disc", setup(files))).toBe(root);
  }
});

test("workspace rejects empty lookalike folders and accepts partial game data", async () => {
  expect(await findWorkspaceRoot("disc", setup(["disc/Race/readme.txt", "disc/sound/readme.txt"]))).toBeNull();
  expect(await findWorkspaceRoot("disc", setup(["disc/Scene/UI/MenuSingle.szs"]))).toBe("disc");
  expect(await findWorkspaceRoot("disc", setup(["disc/sound/revo_kart.brsar"]))).toBe("disc");
});

test("Riivolution XML resolves renamed mod files by disc path", async () => {
  const files = ["sd/CustomPack/courses/my_track.szs", "sd/CustomPack/audio/song.brstm"];
  const folders = ["sd/CustomPack/courses", "sd/CustomPack/audio"];
  const xml = `<wiidisc><patch id="mod" root="/CustomPack"><file disc="/Race/Course/beginner_course.szs" external="courses/my_track.szs"/><file disc="/sound/strm/n_Farm_n.brstm" external="audio/song.brstm"/></patch></wiidisc>`;
  const io = { join, exists: async (path: string) => [...files, ...folders].includes(path), listDir: setup(files).listDir, parse: parseRiivolution, externalPath };
  const workspace = await findRiivolutionWorkspace("sd/riivolution/mod.xml", xml, io);
  expect(workspace).not.toBeNull();
  expect(resolveRiivolutionPath(workspace, ["Race", "Course", "beginner_course.szs"], join)).toBe(files[0]);
  expect(resolveRiivolutionPath(workspace, ["sound", "strm"], join)).toBe("sd/CustomPack/audio");
  expect(resolveRiivolutionPath(workspace, ["Race", "Common.szs"], join)).toBe("");
});

test("Riivolution XML resolves a folder patch and rejects missing resources", async () => {
  const files = ["sd/pack/game/Race/Common.szs"];
  const io = { join, exists: async (path: string) => files.includes(path) || path === "sd/pack/game", listDir: setup(files).listDir, parse: parseRiivolution, externalPath };
  const xml = `<wiidisc><patch id="mod" root="/pack"><folder disc="/" external="game"/></patch></wiidisc>`;
  const workspace = await findRiivolutionWorkspace("sd/riivolution/mod.xml", xml, io);
  expect(resolveRiivolutionPath(workspace, ["Race", "Common.szs"], join)).toBe(files[0]);
  expect(await findRiivolutionWorkspace("sd/riivolution/mod.xml", xml, { ...io, exists: async () => false })).toBeNull();
});
