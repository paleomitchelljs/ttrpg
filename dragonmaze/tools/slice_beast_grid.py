#!/usr/bin/env python3
"""Slice the reptile-beasts pose sheet into monster idle/attack strips.

Unlike slice_grid.py (one grid ROW = one animation), this sheet lays out one
CREATURE per row with four poses left-to-right: two calm poses then two
aggressive ones. So each row yields TWO 2-frame strips — `<name>-idle` from the
first pair, `<name>-attack` from the second — matching the `f2` combat sprite
the game expects.

Cell detection reuses slice_grid's approach: find the non-background row/column
bands on the magenta chroma, then take the largest connected blob in each cell.

    python3 tools/slice_beast_grid.py            # slice the whole sheet
    python3 tools/slice_beast_grid.py --preview /tmp/beasts.png
"""
import argparse
from pathlib import Path
from collections import deque
from PIL import Image

from spritelib import write_manifest

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "art" / "reptile-beasts-sheet.png"
OUT = ROOT / "assets" / "sprites"
FRAME_H = 160  # downsample each frame to this height (sits with the party grain)

# row index (top→bottom) → creature prefix. Each row has 4 poses; poses 0,1 →
# idle strip, poses 2,3 → attack strip.
ROW_PREFIX = ["raptor", "snake", "spider", "basilisk"]
IDLE_POSES = (0, 1)
ATTACK_POSES = (2, 3)


def is_bg(px):
    r, g, b = px[0], px[1], px[2]
    if len(px) > 3 and px[3] < 20:
        return True
    if r > 180 and g < 95 and b > 180:
        return True  # flat magenta chroma + its close AA fringe
    # Blended fringe: magenta-dominant pixels (r AND b high, green far lower).
    # No body colour here is magenta — green snake/raptor keep g high, the
    # orange basilisk and brown spider keep b low — so this only bites the halo.
    return r > 120 and b > 120 and g < min(r, b) - 45


def bands(is_empty, n, min_run=12):
    spans, i = [], 0
    while i < n:
        if not is_empty(i):
            s = i
            while i < n and not is_empty(i):
                i += 1
            if i - s >= min_run:
                spans.append((s, i))
        else:
            i += 1
    return spans


def largest_component_bbox(px, x0, y0, x1, y1):
    seen = set()
    best, best_n = None, 0
    for sy in range(y0, y1):
        for sx in range(x0, x1):
            if (sx, sy) in seen or is_bg(px[sx, sy]):
                continue
            q = deque([(sx, sy)])
            seen.add((sx, sy))
            minx = maxx = sx
            miny = maxy = sy
            n = 0
            while q:
                x, y = q.popleft()
                n += 1
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if x0 <= nx < x1 and y0 <= ny < y1 and (nx, ny) not in seen and not is_bg(px[nx, ny]):
                        seen.add((nx, ny))
                        q.append((nx, ny))
            if n > best_n:
                best_n, best = n, (minx, miny, maxx + 1, maxy + 1)
    return best


def dekey_cell(im, box):
    cell = im.crop(box).convert("RGBA")
    px = cell.load()
    w, h = cell.size
    for y in range(h):
        for x in range(w):
            if is_bg(px[x, y]):
                px[x, y] = (0, 0, 0, 0)
    return cell


def build_strip(frames):
    side = max(max(f.size) for f in frames)
    strip = Image.new("RGBA", (side * len(frames), side), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.paste(f, (i * side + (side - f.size[0]) // 2, side - f.size[1]), f)
    if side != FRAME_H:
        strip = strip.resize((FRAME_H * len(frames), FRAME_H), Image.LANCZOS)
    return strip


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    args = ap.parse_args()

    im = Image.open(SHEET).convert("RGBA")
    px = im.load()
    W, H = im.size

    def row_empty(y):
        return sum(0 if is_bg(px[x, y]) else 1 for x in range(0, W, 2)) < 4
    row_bands = bands(row_empty, H)
    if len(row_bands) != len(ROW_PREFIX):
        print(f"warning: found {len(row_bands)} rows, expected {len(ROW_PREFIX)}")

    made = []
    for ri, (ry0, ry1) in enumerate(row_bands):
        if ri >= len(ROW_PREFIX):
            break
        prefix = ROW_PREFIX[ri]

        def col_empty(x, ry0=ry0, ry1=ry1):
            return sum(0 if is_bg(px[x, y]) else 1 for y in range(ry0, ry1, 2)) < 4
        col_bands = bands(col_empty, W)
        cells = []
        for (cx0, cx1) in col_bands:
            bb = largest_component_bbox(px, cx0, ry0, cx1, ry1)
            if bb:
                cells.append(dekey_cell(im, bb))
        if len(cells) < 4:
            print(f"warning: {prefix} row found {len(cells)} poses, expected 4")

        for anim, poses in (("idle", IDLE_POSES), ("attack", ATTACK_POSES)):
            frames = [cells[p] for p in poses if p < len(cells)]
            if not frames:
                continue
            strip = build_strip(frames)
            out = OUT / f"{prefix}-{anim}.png"
            strip.save(out)
            made.append((f"{prefix}-{anim}", strip))
            print(f"{out.name}: {len(frames)} frames, {strip.height}px each")

    manifest, n = write_manifest(ROOT)
    print(f"manifest: {manifest.relative_to(ROOT)} ({n} strips)")

    if args.preview:
        pad, cellpx = 12, 150
        board = Image.new("RGBA", (2 * cellpx + 3 * pad, len(made) * (cellpx + pad) + pad), (60, 52, 70, 255))
        for r, (name, strip) in enumerate(made):
            fw = strip.height
            for f in range(2):
                fr = strip.crop((f * fw, 0, (f + 1) * fw, fw)).resize((cellpx, cellpx), Image.NEAREST)
                bgc = Image.new("RGBA", (cellpx, cellpx), (76, 66, 88, 255))
                bgc.alpha_composite(fr)
                board.alpha_composite(bgc, (pad + f * (cellpx + pad), pad + r * (cellpx + pad)))
        board.save(args.preview)
        print("preview:", args.preview)


if __name__ == "__main__":
    main()
