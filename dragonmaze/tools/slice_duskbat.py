#!/usr/bin/env python3
"""Slice the Dusk Bat's two-pose sheet into its idle strip.

`art/dusk-bat-grid.png` is a flat-magenta sheet with two poses: wings raised
and wings spread. slice_grid.py can't cut this one well — it bboxes each pose
independently and centres it, and these two bboxes disagree wildly (469x506
against 579x305, because raised wings are tall and spread wings are wide). The
bat would jump half its body between frames.

So we register on the bat's **amber eye**, the way slice_faedrake.py does: find
the eye in each pose, then lay every pose on one canvas with the eyes on the
same pixel. The head holds still and the wings do the moving, which is the whole
point of a two-frame flap.

The source art faces left; the party's familiars are drawn unmirrored on the
hero side and face right toward the foes (see `faceHtml` in combatView.js), so
frames are flipped by default.

Usage:  python3 tools/slice_duskbat.py [--no-flip] [--frame-height 150]
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
SRC = ROOT / "art" / "dusk-bat-grid.png"

# Minimum blob size to count as a pose rather than a speck of dust.
MIN_BLOB = 2000


def is_bg(px):
    r, g, b = px[0], px[1], px[2]
    if len(px) > 3 and px[3] < 20:
        return True
    return r > 180 and g < 95 and b > 180  # magenta chroma + its AA fringe


def poses(im):
    """Bounding boxes of each pose on the sheet, left to right."""
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
    found.sort(key=lambda b: b[0])
    return found


def eye(im, box):
    """Centroid of the amber eye inside a pose — the registration anchor.

    The bat is grey and plum all over except its eye, so 'strong red, middling
    green, almost no blue' picks it out on its own with no hand-listed pixels.
    """
    px = im.load()
    x0, y0, x1, y1 = box
    xs, ys = [], []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y][:3]
            if r > 170 and 90 < g < 190 and b < 80:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise SystemExit(f"no eye found in pose {box} — the anchor colour moved")
    return round(sum(xs) / len(xs)), round(sum(ys) / len(ys))


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
    ap.add_argument("--no-flip", action="store_true",
                    help="keep the source's left-facing art (default mirrors it right)")
    ap.add_argument("--frame-height", type=int, default=150,
                    help="frame size of the finished strip (150 matches the fae drake)")
    args = ap.parse_args()

    im = Image.open(SRC).convert("RGBA")
    boxes = poses(im)
    if len(boxes) != 2:
        print(f"warning: found {len(boxes)} poses, expected 2")
    eyes = [eye(im, b) for b in boxes]

    # One canvas big enough for every pose once their eyes coincide: take the
    # furthest any pose reaches from its own eye, in each of the four directions.
    left = max(e[0] - b[0] for b, e in zip(boxes, eyes))
    right = max(b[2] - e[0] for b, e in zip(boxes, eyes))
    up = max(e[1] - b[1] for b, e in zip(boxes, eyes))
    down = max(b[3] - e[1] for b, e in zip(boxes, eyes))
    side = max(left + right, up + down)  # square, like every other strip
    ax, ay = left + (side - (left + right)) // 2, up + (side - (up + down)) // 2

    frames = []
    for box, (ex, ey) in zip(boxes, eyes):
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(dekey(im, box), (ax - (ex - box[0]), ay - (ey - box[1])))
        if not args.no_flip:
            canvas = canvas.transpose(Image.FLIP_LEFT_RIGHT)
        frames.append(canvas)

    n = args.frame_height
    strip = Image.new("RGBA", (n * len(frames), n), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.paste(f.resize((n, n), Image.LANCZOS), (i * n, 0))
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / "dusk-bat-idle.png"
    strip.save(dest)
    print(f"{dest.relative_to(ROOT)}  {strip.size[0]}x{strip.size[1]}  ({len(frames)} frames)")

    manifest, count = write_manifest(ROOT)
    print(f"{manifest.relative_to(ROOT)}: {count} assets")


if __name__ == "__main__":
    main()
