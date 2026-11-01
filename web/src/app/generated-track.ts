import { api } from "../../js/api.js";
import { generateTrack } from "../../js/editor/trackgen.js";
import { buildKCL } from "../../js/formats/kcl.js";
import { buildKMP } from "../../js/formats/kmp.js";
import { buildU8, findFile, newSzsTree, parseU8, setFile } from "../../js/formats/u8.js";

// Build a complete track without replacing any open document. The cup creator uses the same
// archive as the 3D editor, including real models, sky, minimap, collision and race data.
export async function generateTrackArchive(points: any, params: any, base: any = null, progress?: (text: string) => void) {
  const out = generateTrack(points, params);
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
  setFile(tree, "course.kmp", buildKMP(out.kmp));
  setFile(tree, "course.kcl", kclBytes);
  return { out, tree, kclBytes };
}
