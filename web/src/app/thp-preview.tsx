// Moving track previews behind the rows of the Cups window: the part of a cup's THP movie that
// shows one track, played in a loop. Each movie is read and decoded once, whatever the number of
// rows that show a part of it, at half the movie's frame rate to keep the window light.

import * as React from "react";
import { api } from "../../js/api.js";
import { parseTHP } from "../../js/formats/thp.js";
import { decodeFrame, type Rect, type THP } from "./thp-render";
import { cn } from "@/lib/utils";

type Movie = { thp: THP; frame: number; last: number; bitmap: ImageBitmap | null; decoding: boolean; listeners: Set<(b: ImageBitmap) => void> };
const movies = new Map<string, Promise<Movie | null>>();
const live = new Set<Movie>();
let timer: ReturnType<typeof setInterval> | null = null;

function movie(path: string) {
  if (!movies.has(path)) {
    movies.set(path, api.readPath(path)
      .then((f: any) => ({ thp: parseTHP(f.data), frame: 0, last: 0, bitmap: null, decoding: false, listeners: new Set() }))
      .catch(() => null));
  }
  return movies.get(path)!;
}

// At most two movies are decoded per tick (the ones waiting longest); each skips the frames it
// missed, so every preview still plays at its real speed with many cups on screen.
let ticks = 0;
function tick() {
  ticks++;
  const due = [...live].filter((m) => !m.decoding && m.listeners.size).sort((a, b) => a.last - b.last).slice(0, 2);
  for (const m of due) {
    m.decoding = true;
    m.frame = (m.frame + 2 * Math.max(1, ticks - m.last)) % m.thp.frames.length;
    m.last = ticks;
    decodeFrame(m.thp, m.frame).then((bitmap) => {
      m.bitmap?.close();
      m.bitmap = bitmap;
      for (const fn of m.listeners) fn(bitmap);
    }).catch(() => {}).finally(() => { m.decoding = false; });
  }
}

function listen(m: Movie, fn: (b: ImageBitmap) => void) {
  m.listeners.add(fn);
  live.add(m);
  if (m.bitmap) fn(m.bitmap);
  timer ??= setInterval(tick, 1000 / 30);
  return () => {
    m.listeners.delete(fn);
    if (!m.listeners.size) live.delete(m);
    if (!live.size && timer) { clearInterval(timer); timer = null; }
  };
}

// Forgets the movies read so far (after their files changed).
export function forgetPreviews() { movies.clear(); }

// `rect` of the movie at `path`, filling the element (cropped to its shape). Renders nothing until
// the movie is read; a missing movie leaves the element empty.
export function ThpPart({ path, rect, className }: { path: string; rect: Rect; className?: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    void movie(path).then((m) => {
      if (!m || cancelled) return;
      stop = listen(m, (bitmap) => {
        const c = canvas.current;
        if (!c) return;
        const w = c.clientWidth, h = c.clientHeight;
        if (!w || !h) return;
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        // Crop the part to the element's proportions, keeping its centre.
        let { x, y, width, height } = rect;
        if (width / height > w / h) { const nw = height * (w / h); x += (width - nw) / 2; width = nw; }
        else { const nh = width / (w / h); y += (height - nh) / 2; height = nh; }
        c.getContext("2d")!.drawImage(bitmap, x, y, width, height, 0, 0, w, h);
      });
    });
    return () => { cancelled = true; stop(); };
  }, [path, rect.x, rect.y, rect.width, rect.height]);
  return <canvas ref={canvas} className={cn("pointer-events-none", className)} aria-hidden="true" />;
}
