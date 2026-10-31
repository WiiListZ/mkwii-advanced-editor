// Drawing and re-encoding THP movies in the page: frames are decoded with the browser's JPEG
// decoder, changed parts are drawn over them (a picture, a video file or a part of another THP),
// and every frame is encoded again as JPEG and turned back into a THP frame.

import { buildTHP, jpegToTHPFrame, parseTHP, thpFrameToJPEG, thpVideoData } from "../../js/formats/thp.js";

export type Rect = { x: number; y: number; width: number; height: number };
export type THP = ReturnType<typeof parseTHP>;
export type MovieSource =
  | { kind: "image"; name: string; bitmap: ImageBitmap }
  | { kind: "video"; name: string; video: HTMLVideoElement }
  | { kind: "thp"; name: string; thp: THP; rect: Rect };
// One change: `rect` of the movie shows `source`, filled (cropped to keep its proportions) or stretched.
export type MovieEdit = { rect: Rect; source: MovieSource; fit: "fill" | "stretch" };

export async function decodeFrame(thp: THP, index: number): Promise<ImageBitmap> {
  const jpeg = thpFrameToJPEG(thpVideoData(thp, index % thp.frames.length));
  return createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
}

export async function loadVideo(file: Blob, name: string): Promise<MovieSource> {
  const video = document.createElement("video");
  video.muted = true; video.preload = "auto"; video.src = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error(`${name} cannot be played by this computer (use MP4 with H.264, or WebM)`));
  });
  return { kind: "video", name, video };
}

async function seek(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return;
  await new Promise<void>((resolve) => { video.onseeked = () => resolve(); video.currentTime = time; });
}

// The picture a source shows on frame `index` of a movie playing at `fps`, and the part of it to use.
async function sourceImage(source: MovieSource, index: number, fps: number): Promise<{ image: CanvasImageSource; rect: Rect; close?: () => void }> {
  if (source.kind === "image") return { image: source.bitmap, rect: { x: 0, y: 0, width: source.bitmap.width, height: source.bitmap.height } };
  if (source.kind === "video") {
    const v = source.video;
    await seek(v, (index / fps) % Math.max(0.001, v.duration || 0.001));
    return { image: v, rect: { x: 0, y: 0, width: v.videoWidth, height: v.videoHeight } };
  }
  const bitmap = await decodeFrame(source.thp, index);
  return { image: bitmap, rect: source.rect, close: () => bitmap.close() };
}

export async function drawEdit(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, edit: MovieEdit, index: number, fps: number) {
  const { image, rect: from, close } = await sourceImage(edit.source, index, fps);
  let { x: sx, y: sy, width: sw, height: sh } = from;
  if (edit.fit === "fill") {
    // Crop the source to the proportions of the target, keeping its centre.
    const target = edit.rect.width / edit.rect.height, own = sw / sh;
    if (own > target) { const w = sh * target; sx += (sw - w) / 2; sw = w; }
    else { const h = sw / target; sy += (sh - h) / 2; sh = h; }
  }
  ctx.drawImage(image, sx, sy, sw, sh, edit.rect.x, edit.rect.y, edit.rect.width, edit.rect.height);
  close?.();
}

// Frame `index` with the changes drawn over it.
export async function composeFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, thp: THP, index: number, edits: MovieEdit[]) {
  const base = await decodeFrame(thp, index);
  ctx.drawImage(base, 0, 0);
  base.close();
  for (const edit of edits) await drawEdit(ctx, edit, index, thp.header.fps);
}

// Encodes the canvas as a THP frame no bigger than `budget` bytes: the quality goes down until it
// fits, because the game reserves memory for the largest frame of the original movie.
async function encodeFrame(canvas: OffscreenCanvas, width: number, height: number, budget: number, start: number) {
  let quality = start;
  for (;;) {
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    const frame = jpegToTHPFrame(new Uint8Array(await blob.arrayBuffer()), width, height);
    if (frame.length <= budget || quality <= 0.3) return { frame, quality };
    quality = Math.max(0.3, quality - 0.06);
  }
}

// The movie with the changes in every frame. `progress(done, total)` is called as frames are encoded.
export async function renderMovie(thp: THP, edits: MovieEdit[], progress?: (done: number, total: number) => void) {
  const { width, height } = thp.video;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const videoIndex = thp.types.indexOf(0);
  const frames: Uint8Array[] = [];
  let quality = 0.9;
  for (let i = 0; i < thp.frames.length; i++) {
    await composeFrame(ctx, thp, i, edits);
    // Room for the video data: the original largest frame minus this frame's header and audio.
    const other = thp.frames[i].parts.reduce((n: number, [, size]: number[], k: number) => (k === videoIndex ? n : n + size), 0);
    const budget = thp.header.maxBufferSize - 8 - thp.frames[i].parts.length * 4 - other - 31;
    const encoded = await encodeFrame(canvas, width, height, budget, Math.min(0.9, quality + 0.02));
    quality = encoded.quality;
    frames.push(encoded.frame);
    if (i % 10 === 0 || i === thp.frames.length - 1) progress?.(i + 1, thp.frames.length);
  }
  return buildTHP(thp, frames);
}
