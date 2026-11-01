import { api } from "../../js/api.js";
import { MenuAssets } from "../../js/editor/menu-screens.js";

const assetsByFolder = new Map<string, any>();
export function gameTextAssetsFor(folder: string) {
  let assets = assetsByFolder.get(folder);
  if (!assets) {
    assets = new MenuAssets(async (name: string) => {
      const path = `${folder.replace(/[\\/]+$/, "")}\\${name}`;
      return api.decodeArchiveBytes((await api.readPath(path)).data, path);
    });
    assetsByFolder.set(folder, assets);
  }
  return assets;
}
