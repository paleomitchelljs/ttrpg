#!/usr/bin/env python3
"""Slice a grid of standing-creature poses into strips, registered on the feet.

For sheets where a character stands on the ground in every pose and the poses
differ mostly above the waist — a lich reaching out to cast, a warrior winding
up. `slice_grid.py` cuts the same sheets, but it bounding-boxes each pose on its
own and centres it, so a pose with an outflung arm gets shoved sideways: the
figure appears to slide across the ground as it animates.

Here the anchor is **where it stands**: the horizontal centre of its feet, and
the ground line under them. Feet are found in a band at the bottom of each pose,
which is below anything an arm or a cloak is doing, so a reaching arm widens the
frame without moving the body. Every pose lands on one shared canvas, so all the
strips keep a common scale and footing and a card can swap idle for attack
mid-swing without a hop.

One grid row becomes one strip, named by --rows in order, top to bottom.

Usage:
  python3 tools/slice_biped.py art/lich-grid.png lich --rows idle walk attack
  python3 tools/slice_biped.py art/foo.png foo --rows idle attack --flip
"""
import argparse
import sys
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from spritelib import write_manifest  # noqa: E402

OUT = ROOT / "assets" / "sprites"
MIN_BLOB = 1500  # a pose; anything smaller is a stray speck or a sparkle


def is_bg(px):
    r, g, b = px[0], px[1], px[2]
    if len(px) > 3 and px[3] < 20:
        return True
    return r > 180 and g < 95 and b > 180  # magenta chroma + its AA fringe


def poses(im):
    """Bounding boxes of every pose, grouped into rows, in reading order."""
    px = im.load()
    w, h = im.size
    seen = set()
    found = []
    for sy in range(0, h, 2):
        for sx in range(0, w, 2):
            if (sx, sy) in seen or is_bg(px[sx, sy]):
                continue
            q = deque([(sx, sy)])
            seen.add((sx, sy))
            x0 = x1 = sx
            y0 = y1 = sy
            n = 0
            while q:
                x, y = q.popleft()
                n += 1
                x0 = min(x0, x); x1 = max(x1, x)
                y0 = min(y0, y); y1 = max(y1, y)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and not is_bg(px[nx, ny]):
                        seen.add((nx, ny))
                        q.append((nx, ny))
            if n >= MIN_BLOB:
                found.append((x0, y0, x1 + 1, y1 + 1))
    # Group by vertical overlap into rows, then order each row left to right.
    found.sort(key=lambda b: b[1])
    rows = []
    for box in found:
        placed = False
        for row in rows:
            # same row if this pose's vertical span overlaps the row's first
            if box[1] < row[0][3] and box[3] > row[0][1]:
                row.append(box)
                placed = True
                break
        if not placed:
            rows.append([box])
    for row in rows:
        row.sort(key=lambda b: b[0])
    return rows


def footing(im, box, band):
    """(x of the feet's centre, y of the ground) for one pose."""
    px = im.load()
    x0, y0, x1, y1 = box
    lo = max(y0, y1 - band)
    xs = [x for y in range(lo, y1) for x in range(x0, x1) if not is_bg(px[x, y])]
    if not xs:
        return (x0 + x1) // 2, y1 - 1
    return (min(xs) + max(xs)) // 2, y1 - 1


def dekey(im, box):
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
    ap.add_argument("--rows", nargs="+", required=True, help="animation name per grid row, top to bottom")
    ap.add_argument("--flip", action="store_true", help="mirror every frame (art must end up facing right)")
    ap.add_argument("--frame-height", type=int, default=150, help="frame size of the finished strips")
    ap.add_argument("--foot-band", type=int, default=40,
                    help="how many pixels up from the ground count as feet")
    args = ap.parse_args()

    im = Image.open(args.grid).convert("RGBA")
    rows = poses(im)
    if len(rows) != len(args.rows):
        print(f"warning: found {len(rows)} rows, expected {len(args.rows)}")

    # Cut every pose and note where it stands, so one canvas can hold them all.
    cells = []
    for name, row in zip(args.rows, rows):
        for box in row:
            fx, fy = footing(im, box, args.foot_band)
            cell = dekey(im, box)
            ax = fx - box[0]
            if args.flip:
                cell = cell.transpose(Image.FLIP_LEFT_RIGHT)
                ax = cell.size[0] - 1 - ax
            cells.append({"img": cell, "ax": ax, "ay": fy - box[1], "strip": name})

    left = max(c["ax"] for c in cells)
    right = max(c["img"].size[0] - 1 - c["ax"] for c in cells)
    up = max(c["ay"] for c in cells)
    down = max(c["img"].size[1] - 1 - c["ay"] for c in cells)
    side = max(left + right + 1, up + down + 1)
    ox = left + (side - (left + right + 1)) // 2
    oy = up + (side - (up + down + 1)) // 2

    n = args.frame_height
    OUT.mkdir(parents=True, exist_ok=True)
    for name in args.rows:
        frames = [c for c in cells if c["strip"] == name]
        if not frames:
            continue
        strip = Image.new("RGBA", (n * len(frames), n), (0, 0, 0, 0))
        for i, c in enumerate(frames):
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            canvas.paste(c["img"], (ox - c["ax"], oy - c["ay"]))
            strip.paste(canvas.resize((n, n), Image.LANCZOS), (i * n, 0))
        dest = OUT / f"{args.prefix}-{name}.png"
        strip.save(dest)
        print(f"  {dest.name}  {strip.size[0]}x{strip.size[1]}  ({len(frames)} frames)")

    print(f"canvas {side}x{side} (figure {up + down + 1}px tall)")
    manifest, count = write_manifest(ROOT)
    print(f"{manifest.relative_to(ROOT)}: {count} assets")


if __name__ == "__main__":
    main()
