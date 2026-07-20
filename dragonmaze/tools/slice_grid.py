#!/usr/bin/env python3
"""Slice a Nano-Banana pose grid into animation strips.

The model lays poses out on a flat chroma background (magenta by default)
with wide empty gutters between them. We don't trust exact placement --
we find the all-background rows and columns and cut on those, so the grid
can drift and still slice. Each row of the grid becomes one 2-frame strip.

Usage:
  python3 tools/slice_grid.py art/swashbuckler-grid.png swash \
      --rows idle attack walk
"""
import argparse
from pathlib import Path
from PIL import Image

from spritelib import write_manifest

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "sprites"


def is_bg(px):
    r, g, b = px[0], px[1], px[2]
    if len(px) > 3 and px[3] < 20:
        return True
    return r > 180 and g < 95 and b > 180  # magenta chroma + its AA fringe


def bg_mask(im):
    w, h = im.size
    px = im.load()
    return px, w, h


def bands(is_empty, n, min_run=12):
    """Return (start, end) spans of consecutive non-empty indices."""
    spans = []
    i = 0
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
    """Tight bbox of the biggest connected fg blob, dropping stray specks
    (e.g. a corner sparkle) that aren't touching the figure."""
    from collections import deque
    seen = set()
    best = None
    best_n = 0
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
                best_n = n
                best = (minx, miny, maxx + 1, maxy + 1)
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("grid")
    ap.add_argument("prefix")
    ap.add_argument("--rows", nargs="+", required=True,
                    help="animation name per grid row, top to bottom")
    ap.add_argument("--preview", default=None)
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--flip", action="store_true",
                    help="mirror each frame (model draws right-facing; party art faces left)")
    ap.add_argument("--frame-height", type=int, default=None,
                    help="downsample each strip to this frame height, to match the "
                         "existing sprites' pixel grain (~150 sits with the party)")
    args = ap.parse_args()

    global OUT
    if args.outdir:
        OUT = Path(args.outdir)
        OUT.mkdir(parents=True, exist_ok=True)

    im = Image.open(args.grid).convert("RGBA")
    px, W, H = bg_mask(im)

    def row_empty(y):
        return sum(0 if is_bg(px[x, y]) else 1 for x in range(0, W, 2)) < 4
    row_bands = bands(row_empty, H)
    if len(row_bands) != len(args.rows):
        print(f"warning: found {len(row_bands)} row bands, expected {len(args.rows)}")

    made = []
    for ri, (ry0, ry1) in enumerate(row_bands):
        def col_empty(x, ry0=ry0, ry1=ry1):
            return sum(0 if is_bg(px[x, y]) else 1 for y in range(ry0, ry1, 2)) < 4
        col_bands = bands(col_empty, W)
        frames = []
        for (cx0, cx1) in col_bands:
            bb = largest_component_bbox(px, cx0, ry0, cx1, ry1)
            if bb:
                cell = dekey_cell(im, bb)
                if args.flip:
                    cell = cell.transpose(Image.FLIP_LEFT_RIGHT)
                frames.append(cell)
        name = args.rows[ri] if ri < len(args.rows) else f"row{ri}"
        side = max(max(f.size) for f in frames)
        strip = Image.new("RGBA", (side * len(frames), side), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            strip.paste(f, (i * side + (side - f.size[0]) // 2, side - f.size[1]), f)
        if args.frame_height and side != args.frame_height:
            t = args.frame_height
            strip = strip.resize((t * len(frames), t), Image.LANCZOS)
        out = OUT / f"{args.prefix}-{name}.png"
        strip.save(out)
        made.append((name, len(frames), strip))
        fh = strip.height
        print(f"{out.name}: {len(frames)} frames, {fh}x{fh} each (from {side}px cells)")

    if not args.outdir:  # wrote into the real sprites dir; refresh the manifest
        manifest, n = write_manifest(ROOT)
        print(f"manifest: {manifest.relative_to(ROOT)} ({n} strips)")

    if args.preview:
        pad = 12
        cellpx = 150
        board = Image.new("RGBA", (2 * cellpx + 3 * pad, len(made) * (cellpx + pad) + pad), (60, 52, 70, 255))
        for r, (name, nf, strip) in enumerate(made):
            fw = strip.height
            for f in range(min(nf, 2)):
                fr = strip.crop((f * fw, 0, (f + 1) * fw, fw)).resize((cellpx, cellpx), Image.NEAREST)
                bgc = Image.new("RGBA", (cellpx, cellpx), (76, 66, 88, 255))
                bgc.alpha_composite(fr)
                board.alpha_composite(bgc, (pad + f * (cellpx + pad), pad + r * (cellpx + pad)))
        board.save(args.preview)
        print("preview:", args.preview)


if __name__ == "__main__":
    main()
