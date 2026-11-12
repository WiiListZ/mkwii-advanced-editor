import { toast } from "sonner";
import { api } from "../../js/api.js";
import { generateTrack, generatedTrackIssues } from "../../js/editor/trackgen.js";
import { buildKCL } from "../../js/formats/kcl.js";
import { buildKMP } from "../../js/formats/kmp.js";
import { buildU8, findFile, newSzsTree, parseU8, setFile } from "../../js/formats/u8.js";

// Build a complete track without replacing any open document. The cup creator uses the same
// archive as the 3D editor, including real models, sky, minimap, collision and race data.
// The models of the scenery are copied from the game's tracks. Without them the scenery is left out:
// an object whose model is missing would not show, and could stop the track from loading.
async function addSceneryFiles(out: any, tree: any, coursesFolder: string, progress?: (text: string) => void) {
  if (!out.sceneryFiles?.length) return;
  progress?.("Copying the scenery from the game's tracks…");
  const sources = new Map<string, any>();
  const missing = new Set<number>();
  for (const { file, track, id } of out.sceneryFiles) {
    try {
      if (!coursesFolder) throw new Error("no game folder");
      const path = `${coursesFolder}\\${track}`;
      if (!sources.has(track)) sources.set(track, parseU8(await api.decodeArchiveBytes((await api.readPath(path)).data, path)));
      const node = findFile(sources.get(track), `${file}.brres`);
      if (!node) throw new Error(`${file} not in ${track}`);
      setFile(tree, `${file}.brres`, node.data);
    } catch { missing.add(id); }
  }
  if (!missing.size) return;
  out.kmp.GOBJ = out.kmp.GOBJ.filter((object: any) => !missing.has(object.objectId));
  toast.warning("Some scenery was left out", { description: "Its models come from the game's tracks: choose the game folder in the settings to have them." });
}

export async function generateTrackArchive(points: any, params: any, base: any = null, progress?: (text: string) => void, coursesFolder = "") {
  const out = generateTrack(points, params);
  const issues = generatedTrackIssues(out);
  if (issues.length) throw new Error(issues.map((i: any) => i.message).join("\n"));
  const kclBytes = buildKCL(out.verts, out.flags);
  const tree = base ? parseU8(buildU8(base)) : newSzsTree();
  const missing = ["course_model.brres", "vrcorn_model.brres", "map_model.brres"].filter((name) => !findFile(tree, name));
  if (missing.length) {
    progress?.("Building the track model, sky and minimap…");
    const models = parseU8(await api.generatedTrackModels(out.model));
    for (const name of missing) {
      const file = findFile(models, name);
      if (!file) throw new Error(`The generated track is missing ${name}`);
      setFile(tree, name, file.data);
    }
  }
  await addSceneryFiles(out, tree, coursesFolder, progress);
  setFile(tree, "course.kmp", buildKMP(out.kmp));
  setFile(tree, "course.kcl", kclBytes);
  return { out, tree, kclBytes };
}
