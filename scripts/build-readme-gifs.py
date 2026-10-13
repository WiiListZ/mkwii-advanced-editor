"""Turn frames from capture-readme.ts into compact GIFs for the README.

Usage: python scripts/build-readme-gifs.py <capture-dir> <destination-dir>
Requires Pillow.
"""

from pathlib import Path
from sys import argv

from PIL import Image, ImageChops, ImageStat


source = Path(argv[1])
destination = Path(argv[2])
destination.mkdir(parents=True, exist_ok=True)


def make_gif(pattern: str, name: str, *, crop=None, width=640, duration=110):
    paths = sorted((source / "frames").glob(pattern))
    if len(paths) < 2:
        raise RuntimeError(f"Expected animation frames for {pattern}")
    frames = []
    differences = []
    previous = None
    for path in paths:
        image = Image.open(path).convert("RGB")
        if crop:
            image = image.crop(crop)
        image = image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)
        if previous is not None:
            differences.append(sum(ImageStat.Stat(ImageChops.difference(previous, image)).mean) / 3)
        previous = image
        frames.append(image.quantize(colors=96, method=Image.Quantize.MEDIANCUT))
    if max(differences) < 1:
        raise RuntimeError(f"Frames for {name} barely change")
    target = destination / name
    frames[0].save(target, save_all=True, append_images=frames[1:], loop=0, duration=duration, optimize=True, disposal=2)
    print(f"{target}: {len(frames)} frames, {target.stat().st_size:,} bytes, mean change {sum(differences)/len(differences):.1f}")


make_gif("intro-*.png", "intro-animation.gif", width=640, duration=120)
make_gif("object-*.png", "item-box-animation.gif", crop=(610, 265, 900, 555), width=560, duration=130)
