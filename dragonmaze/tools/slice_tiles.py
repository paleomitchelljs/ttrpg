#!/usr/bin/env python3
"""Slice decorative temple props off a chroma-key tile sheet.

These sheets are a palette of hand-placed objects (statues, braziers, huts,
wells, reliefs, arches) separated by magenta, not an autotile grid. So we
find objects as connected non-magenta blobs, then crop the ones we name.

  python3 tools/slice_tiles.py art/temple-exterior-sheet.png --detect
      -> prints every detected blob (index, box, size) + writes a numbered
         overview so you can see which index is which object.
  python3 tools/slice_tiles.py <sheet> --crop out=NAME box=X,Y,W,H [...]
      -> crops named props into assets/tiles/, magenta keyed out.
"""
import argparse
from collections import deque
from pathlib import Path
from PIL import Image, ImageDraw

from spritelib import write_manifest

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "tiles"


def is_bg(px):
    r, g, b = px[0], px[1], px[2]
    if len(px) > 3 and px[3] < 20:
        return True
    return r > 180 and g < 95 and b > 180  # magenta chroma + AA fringe


def detect(im, scale=4, min_area=24, bridge=2):
    """Connected non-bg blobs on a downscaled mask; boxes scaled back up."""
    small = im.resize((im.width // scale, im.height // scale), Image.NEAREST)
    W, H = small.size
    px = small.load()
    fg = [[not is_bg(px[x, y]) for x in range(W)] for y in range(H)]
    # dilate by `bridge` so a blob split by a 1px chroma seam stays one object
    if bridge:
        d = [[fg[y][x] for x in range(W)] for y in range(H)]
        for y in range(H):
            for x in range(W):
                if fg[y][x]:
                    for dy in range(-bridge, bridge + 1):
                        for dx in range(-bridge, bridge + 1):
                            ny, nx = y + dy, x + dx
                            if 0 <= ny < H and 0 <= nx < W:
                                d[ny][nx] = True
        fg = d
    seen = [[False] * W for _ in range(H)]
    boxes = []
    for sy in range(H):
        for sx in range(W):
            if not fg[sy][sx] or seen[sy][sx]:
                continue
            q = deque([(sx, sy)])
            seen[sy][sx] = True
            minx = maxx = sx
            miny = maxy = sy
            area = 0
            while q:
                x, y = q.popleft()
                area += 1
                minx, maxx = min(minx, x), max(maxx, x)
                miny, maxy = min(miny, y), max(maxy, y)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H and fg[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if area >= min_area:
                boxes.append((minx * scale, miny * scale,
                              (maxx - minx + 1) * scale, (maxy - miny + 1) * scale, area * scale * scale))
    boxes.sort(key=lambda b: (round(b[1] / 40), b[0]))  # reading order-ish
    return boxes


def dekey_crop(im, box):
    x, y, w, h = box
    cell = im.crop((x, y, x + w, y + h)).convert("RGBA")
    px = cell.load()
    for j in range(cell.height):
        for i in range(cell.width):
            if is_bg(px[i, j]):
                px[i, j] = (0, 0, 0, 0)
    return cell


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--detect", action="store_true")
    ap.add_argument("--overview", default=None)
    ap.add_argument("--crop", nargs="*", default=[])  # NAME=X,Y,W,H
    args = ap.parse_args()
    im = Image.open(args.sheet).convert("RGBA")

    if args.detect:
        boxes = detect(im)
        over = im.copy()
        d = ImageDraw.Draw(over)
        for i, (x, y, w, h, a) in enumerate(boxes):
            d.rectangle([x, y, x + w, y + h], outline=(0, 255, 255, 255), width=2)
            d.text((x + 2, y + 2), str(i), fill=(255, 255, 0, 255))
            print(f"[{i:2}] box=({x},{y},{w},{h}) area={a}")
        out = args.overview or "/tmp/tiles_overview.png"
        over.save(out)
        print(f"overview: {out}  ({len(boxes)} objects)")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    for spec in args.crop:
        name, box = spec.split("=")
        x, y, w, h = (int(n) for n in box.split(","))
        dekey_crop(im, (x, y, w, h)).save(OUT / f"{name}.png")
        print(f"{name}.png <- ({x},{y},{w},{h})")
    if args.crop:
        manifest, n = write_manifest(ROOT)
        print(f"manifest: {manifest.relative_to(ROOT)} ({n} entries)")


if __name__ == "__main__":
    main()
