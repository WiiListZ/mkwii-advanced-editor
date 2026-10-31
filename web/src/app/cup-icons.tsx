// Cup icons as the game draws them (Scene/UI/MenuSingle.szs › button/timg/tt_cup_icon_*_00.tpl).
// The battle cups have no icon of their own in the game; they use the battle balloon. Read once
// per game folder; without the game files a trophy is drawn instead.

import * as React from "react";
import { Trophy } from "lucide-react";
import { api } from "../../js/api.js";
import { CUPS } from "../../js/data/cups.js";
import { parseTPL } from "../../js/formats/brlyt.js";
import { decodeTexture } from "../../js/formats/brres.js";
import { findFile, parseU8 } from "../../js/formats/u8.js";
import { editor } from "./editor";
import { cn } from "@/lib/utils";

type Icons = Record<number, string>; // cup index -> image URL
let cache: { root: string; icons: Promise<Icons> } | null = null;
const listeners = new Set<() => void>();

async function readIcons(): Promise<Icons> {
  const ui = editor.workspacePath("Scene", "UI");
  if (!ui) return {};
  for (const archive of ["MenuSingle.szs", "MenuMulti.szs", "Race.szs", "Award.szs"]) {
    try {
      const f = await api.readPath(`${ui}\\${archive}`);
      const tree = parseU8(await api.decodeArchiveBytes(f.data, f.path));
      const icons: Icons = {};
      CUPS.forEach((cup: any, i: number) => {
        const node = findFile(tree, cup.icon ? `tt_cup_icon_${cup.icon}_00.tpl` : "st_battle_icon_balloon.tpl");
        if (!node) return;
        const [{ image, palette }] = parseTPL(node.data);
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(decodeTexture(image, palette)), image.width, image.height), 0, 0);
        icons[i] = canvas.toDataURL("image/png");
      });
      if (Object.keys(icons).length) return icons;
    } catch { /* next archive */ }
  }
  return {};
}

export function useCupIcons(): Icons {
  const root = editor.workspace();
  const [icons, setIcons] = React.useState<Icons>({});
  React.useEffect(() => {
    if (!root) { setIcons({}); return; }
    if (cache?.root !== root) cache = { root, icons: readIcons().catch(() => ({})) };
    let live = true;
    void cache.icons.then((i) => { if (live) setIcons(i); });
    const update = () => void cache?.icons.then((i) => live && setIcons(i));
    listeners.add(update);
    return () => { live = false; listeners.delete(update); };
  }, [root]);
  return icons;
}

export function CupIcon({ cup, icons, className }: { cup: number; icons: Icons; className?: string }) {
  const url = icons[cup];
  return url
    ? <img src={url} alt="" draggable={false} className={cn("size-5 shrink-0 select-none object-contain", className)} />
    : <Trophy className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden="true" />;
}
