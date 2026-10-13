import { useSyncExternalStore } from "react";
import { editor, type Channel } from "./editor";

// Re-renders the component when one of the given editor channels changes.
export function useEditor(...channels: Channel[]) {
  useSyncExternalStore(editor.subscribe, () => editor.version(channels));
  return editor;
}
