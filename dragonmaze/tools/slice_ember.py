#!/usr/bin/env python3
"""Slice the Ember Spirit's 2x2 pose sheet into its idle and attack strips.

`art/ember-spirit-grid.png` is four poses on flat magenta: two standing (the
idle pair) on top, two breathing fire (the attack pair) below. The second idle
pose is drawn facing left while the other three face right, so it is mirrored
back into line — everything in this game is drawn facing right (an enemy card
mirrors it, an ally's does not; see `faceHtml` in combatView.js).

Why not slice_grid.py: it bboxes each pose on its own and centres it. Here the
breath is part of the bounding box and it grows from a puff to a long jet, so
centring would drag the salamander leftwards as it exhales — the body would
slide backwards every time it breathed.

So poses register on **the nose and the ground**: the tip of the snout sets x,
the lowest foot sets y. The snout can't be found by colour (the whole animal is
fire-coloured) nor by silhouette height (the flame plume is as tall as the
body), so the two breathing poses carry a hand-measured NOSE_X, the way
slice_faedrake.py hand-lists its eye coordinates. The idle poses need no such
help: with no breath in the way, the nose *is* the bounding box's leading edge.

All four land on one shared canvas, so the creature keeps its size and footing
when the card swaps idle for attack mid-swing.

Usage:  python3 tools/slice_ember.py [--frame-height 150]
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
SRC = ROOT / "art" / "ember-spirit-grid.png"

MIN_BLOB = 1500  # a pose; anything smaller is a stray spark

# Poses in sheet order (top-left, top-right, bottom-left, bottom-right).
#   strip     — which animation this frame belongs to
#   faces     — 'right' as drawn, or 'left' (mirrored to match the others)
#   nose_x    — hand-measured snout tip in SOURCE pixels, for poses whose
#               breath extends past the head. None = take it from the bbox.
POSES = [
    {"strip": "idle",   "faces": "right", "nose_x": None},
    {"strip": "idle",   "faces": "left",  "nose_x": None},
    {"strip": "attack", "faces": "right", "nose_x": 395},  # small puff
    {"strip": "attack", "faces": "right", "nose_x": 823},  # full jet
]


def is_bg(px):
    r, g, b = px[0], px[1], px[2]
    if len(px) > 3 and px[3] < 20:
        return True
    return r > 180 and g < 95 and b > 180  # magenta chroma + its AA fringe


def poses(im):
    """Bounding boxes of each pose, in reading order (top row, then bottom)."""
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
    # reading order: group into rows by vertical midpoint, then left to right
    found.sort(key=lambda b: ((b[1] + b[3]) // 2 // 200, b[0]))
    return found


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
    ap.add_argument("--frame-height", type=int, default=150,
                    help="frame size of the finished strips (150 matches the party)")
    args = ap.parse_args()

    im = Image.open(SRC).convert("RGBA")
    boxes = poses(im)
    if len(boxes) != len(POSES):
        raise SystemExit(f"found {len(boxes)} poses, expected {len(POSES)}")

    # Cut each pose out, mirror the odd one, and record where its nose and its
    # ground line sit inside the cut.
    cells = []
    for box, spec in zip(boxes, POSES):
        cell = dekey(im, box)
        w = cell.size[0]
        nose = spec["nose_x"] - box[0] if spec["nose_x"] is not None else (
            0 if spec["faces"] == "left" else w - 1
        )
        if spec["faces"] == "left":
            cell = cell.transpose(Image.FLIP_LEFT_RIGHT)
            nose = w - 1 - nose
        # the ground is the bottom of the cut: every pose's lowest pixel is a foot
        cells.append({"img": cell, "nose": nose, "base": cell.size[1] - 1, "strip": spec["strip"]})

    # One canvas for every pose, so idle and attack share a scale and a footing.
    left = max(c["nose"] for c in cells)
    right = max(c["img"].size[0] - 1 - c["nose"] for c in cells)
    up = max(c["base"] for c in cells)
    side = max(left + right + 1, up + 1)
    ax = left + (side - (left + right + 1)) // 2
    ay = up + (side - (up + 1)) // 2

    n = args.frame_height
    made = []
    for name in ("idle", "attack"):
        frames = [c for c in cells if c["strip"] == name]
        strip = Image.new("RGBA", (n * len(frames), n), (0, 0, 0, 0))
        for i, c in enumerate(frames):
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            canvas.paste(c["img"], (ax - c["nose"], ay - c["base"]))
            strip.paste(canvas.resize((n, n), Image.LANCZOS), (i * n, 0))
        OUT.mkdir(parents=True, exist_ok=True)
        dest = OUT / f"ember-spirit-{name}.png"
        strip.save(dest)
        made.append(f"{dest.name} {strip.size[0]}x{strip.size[1]} ({len(frames)} frames)")

    print(f"canvas {side}x{side} (creature {up + 1}px tall, {left + right + 1}px wide)")
    for m in made:
        print("  " + m)
    manifest, count = write_manifest(ROOT)
    print(f"{manifest.relative_to(ROOT)}: {count} assets")


if __name__ == "__main__":
    main()
