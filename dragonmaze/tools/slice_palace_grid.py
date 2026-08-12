#!/usr/bin/env python3
"""Cut the palace theme out of `art/palace-grid.png` — the current palace cut.

Unlike every palace sheet before it, this one is not a room to be measured: it
is a **tile sheet**, drawn on a magenta grid where one cell is exactly one tile.
One cell holds one carved cap, or one brick block, or one flagstone-and-boss.
So there is no cell size to derive, no wall-band-as-a-fraction-of-a-tile to
choose, and nothing to mirror out of a symmetric room — the grid IS the answer,
and the only transform any piece needs is the odd horizontal flip.

Two things the sheet needs done to it:

**The rules are drawn over the art, not between it.** Insetting past them would
crop ~5% off each side of every tile, which the floor cannot survive — cut that
way, two floor tiles laid side by side lose a tenth of the pattern at the joint.
So the rules are inpainted first: one pass along x fills the vertical rules from
the pixels either side, then a pass along y does the horizontal ones. The order
matters and one averaged pass cannot work — a rule's own row is entirely masked,
so along that axis there is nothing to interpolate from.

**Its rows are not all the same height.** The bottom wall sits in an 80px row
against ~104 elsewhere. The blocks in it are whole, though — the row is drawn
short, not cropped — so every cell is cut at the bounds its own rules give it,
and each block fills its tile the same way. Forcing a uniform pitch instead
leaves the short rows wanting padding, and that padding then shows up as a black
band wherever the autotiler reuses `palace-o-bottom` for a wall INSIDE the room,
which it does constantly. `cut()` still pads with black for anything that falls
outside the sheet, so a future export cropped through the art degrades to a void
beyond the wall rather than to a stretched tile.

    python3 tools/slice_palace_grid.py [--contact] [--boxes]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from spritelib import write_manifest  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "palace-grid.png"
TILES = ROOT / "assets" / "tiles"
TAGS = ROOT / "data" / "tile-tags.json"

T = 160    # output tile edge, matching every other geometry tile
FRINGE = 2  # px of dark border + compression smear either side of a rule

# --- the map, in cells ---------------------------------------------------------
# (col, row) into the sheet's own grid, and how the piece is placed. `flip` is a
# horizontal mirror; `nudge` shifts the cut in source pixels, for the few blocks
# the composition left sitting off-centre in their cell.
#
# Elbows are named for the two directions the wall CONTINUES, so the ring's
# north-west corner — whose arms head east and south — is el-se.
CELLS = {
    # the outer ring: four runs and four carved corner caps
    "palace-o-top":    (5, 0),
    "palace-o-bottom": (5, 11),
    "palace-o-left":   (0, 5),
    "palace-o-right":  (16, 5),
    "palace-o-nw":     (0, 0),
    "palace-o-ne":     (16, 0),
    "palace-o-sw":     (0, 11),
    "palace-o-se":     (16, 11),
    # the free-standing ring inside the room: runs and the four corners it turns
    "palace-r-run-h":  (12, 7),
    "palace-r-run-v":  (10, 3),
    "palace-r-el-se":  (4, 3),
    "palace-r-el-sw":  (8, 3),
    "palace-r-el-ne":  (4, 8),
    "palace-r-el-nw":  (8, 8),
    # termini. The sheet draws three; the fourth is the east one mirrored, which
    # is exact — the cap is drawn symmetrically about its own axis.
    "palace-r-end-s":  (10, 1),
    "palace-r-end-n":  (10, 10),
    "palace-r-end-w":  (15, 7, {"nudge": (18, 0)}),
    "palace-r-end-e":  (15, 7, {"nudge": (18, 0), "flip": True}),
    # a T: wall running north, south and east, floor to the west. The autotiler
    # has no key for it (it asks for `left` — a partition with floor on that
    # side), so it is cut for the editor palette and for maps to place by hand.
    "palace-r-tee-w":  (10, 7),
    "palace-r-tee-e":  (10, 7, {"flip": True}),
}

# Thick-partition corners: the autotiler falls back to these when a bend is more
# than one cell thick. Nothing in a thin-wall theme draws a thick corner, and the
# elbow presents the same carved cap, so they reuse it.
ALIAS = {
    "palace-r-ci-nw": "palace-r-el-nw", "palace-r-ci-ne": "palace-r-el-ne",
    "palace-r-ci-sw": "palace-r-el-sw", "palace-r-ci-se": "palace-r-el-se",
}

# Floor, from nine cells spread across the room. The sheet draws one flagstone
# unit per cell, so these are near-identical by design; they are levelled to a
# common mean anyway, since a cell lifted from a darker corner of the render
# tiles into a visible patchwork.
FLOOR_CELLS = [(2, 5), (2, 4), (3, 5), (2, 7), (2, 6), (12, 5), (3, 6), (3, 4), (7, 6)]

# `palace-r-fill` — the inside of a wall mass, which a one-tile-thick sheet never
# draws. The side-wall block is the closest thing to solid masonry it has: a
# single stone filling its cell edge to edge, with mortar down both sides and no
# cast shadow to stack into stripes.
FILL_FROM = "palace-o-left"


def grid(mask):
    """The sheet's rule positions, from the magenta mask: (xs, ys, pitch_x, pitch_y)."""
    def lines(cover):
        out, run = [], None
        for i, v in enumerate(cover):
            if v >= 0.5 and run is None:
                run = i
            elif v < 0.5 and run is not None:
                out.append((run + i - 1) / 2)
                run = None
        if run is not None:
            out.append((run + len(cover) - 1) / 2)
        return [x for i, x in enumerate(out) if i == 0 or x - out[i - 1] > 30]
    xs, ys = lines(mask.mean(0)), lines(mask.mean(1))
    px = float(np.median(np.diff(xs)))
    py = float(np.median(np.diff(ys)))
    return xs, ys, px, py


def inpaint(img, mask):
    """Fill the masked rules from the art either side: along x, then along y.

    A vertical rule is a short run inside a row, so interpolating along x closes
    it. A horizontal rule masks its whole row — along x there is nothing left to
    interpolate from — so those rows are filled afterwards from the rows above
    and below, which the first pass has already repaired.
    """
    a = np.asarray(img).astype(float)
    h, w, _ = a.shape
    for y in range(h):
        m = mask[y]
        if not m.any() or m.all():
            continue
        idx = np.flatnonzero(~m)
        for ch in range(3):
            a[y, :, ch] = np.interp(np.arange(w), idx, a[y, idx, ch])
    rows = np.flatnonzero(~mask.all(1))
    if len(rows) < h:
        for x in range(w):
            for ch in range(3):
                a[:, x, ch] = np.interp(np.arange(h), rows, a[rows, x, ch])
    return Image.fromarray(np.clip(a, 0, 255).astype("uint8"))


def cut(img, box):
    """A cell at the sheet's pitch. What falls outside the sheet comes back black.

    The sheet is cropped tight to the room, so an edge cell asks for pixels past
    the border. Those lie *outside* the outer wall, so black is what belongs
    there — and the tile keeps its proportions instead of being stretched.
    """
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    tile = Image.new("RGB", (x1 - x0, y1 - y0), (0, 0, 0))
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(img.width, x1), min(img.height, y1)
    if sx1 > sx0 and sy1 > sy0:
        tile.paste(img.crop((sx0, sy0, sx1, sy1)), (sx0 - x0, sy0 - y0))
    return tile


def level(img, target):
    """Scale a floor cell to the theme's common brightness."""
    a = np.asarray(img).astype(float)
    return Image.fromarray(np.clip(a * (target / max(a.mean(), 1)), 0, 255).astype("uint8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", action="store_true", help="write a contact sheet to review")
    ap.add_argument("--boxes", action="store_true", help="write the sheet with every cut drawn on it")
    args = ap.parse_args()

    raw = Image.open(SRC).convert("RGB")
    a = np.asarray(raw).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # The grid is found on the rules' bright core, but they are drawn with a dark
    # border and JPEG smears both into the art either side, so what gets painted
    # out is any pixel tinted toward magenta at all, grown a little further.
    # Anything less leaves a purple hairline down the edge of half the tiles. The
    # loose test is safe here: every colour in this sheet is sandstone, where
    # blue sits BELOW green, so nothing but the rules reads as magenta.
    core = (r > 140) & (b > 140) & (r - g > 40) & (b - g > 40)
    xs, ys, px, py = grid(core)
    tinted = (r - g > 18) & (b - g > 18) & (r > 25)
    grown = tinted.copy()
    for s in range(1, FRINGE + 1):
        grown |= np.roll(tinted, s, 0) | np.roll(tinted, -s, 0)
        grown |= np.roll(tinted, s, 1) | np.roll(tinted, -s, 1)
    im = inpaint(raw, grown)

    TILES.mkdir(parents=True, exist_ok=True)
    tags = json.loads(TAGS.read_text()) if TAGS.exists() else {}
    cut_tiles, boxes = {}, {}

    def box_of(col, row, nudge=(0, 0)):
        """A cell, bounded by the rules the author drew around it.

        Not by a uniform pitch: the sheet's rows are not all the same height —
        the bottom wall is drawn in an 80px row against ~104 elsewhere — and the
        blocks inside them are complete, not cropped. Cutting each cell at its
        own bounds lets every block fill its tile the same way. Snapped to a
        uniform grid instead, the short rows come up short and want padding,
        which then shows as a black band wherever the autotiler reuses that
        piece for a wall INSIDE the room.
        """
        x1 = xs[col + 1] if col + 1 < len(xs) else xs[col] + px
        y1 = ys[row + 1] if row + 1 < len(ys) else ys[row] + py
        return (xs[col] + nudge[0], ys[row] + nudge[1], x1 + nudge[0], y1 + nudge[1])

    def keep(name, img, role, tag, **extra):
        img = img.resize((T, T), Image.LANCZOS)
        cut_tiles[name] = img
        img.save(TILES / f"{name}.png")
        tags[name] = {"tags": [tag], "sheet": SRC.name, "role": role, **extra}

    for name, spec in CELLS.items():
        col, row = spec[0], spec[1]
        opt = spec[2] if len(spec) > 2 else {}
        box = box_of(col, row, opt.get("nudge", (0, 0)))
        boxes[name] = box
        img = cut(im, box)
        if opt.get("flip"):
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        keep(name, img, "door" if "door" in name else "wall",
             "door" if "door" in name else "wall",
             cell=[col, row], **{k: v for k, v in opt.items() if k != "flip"},
             **({"flip": "h"} if opt.get("flip") else {}))

    crops = [cut(im, box_of(c, r)) for c, r in FLOOR_CELLS]
    target = sum(np.asarray(c).mean() for c in crops) / len(crops)
    for i, ((col, row), crop) in enumerate(zip(FLOOR_CELLS, crops)):
        name = f"palace-r-floor-{chr(ord('a') + i)}"
        boxes[name] = box_of(col, row)
        keep(name, level(crop, target), "floor", "floor", cell=[col, row], levelled=True)

    keep("palace-r-fill", cut(im, boxes[FILL_FROM]), "wall", "wall", built_from=FILL_FROM)

    for name, src in ALIAS.items():
        cut_tiles[name] = cut_tiles[src]
        cut_tiles[src].save(TILES / f"{name}.png")
        tags[name] = {"tags": ["wall"], "sheet": SRC.name, "from": src, "role": "wall"}

    TAGS.write_text(json.dumps(tags, indent=2, sort_keys=True) + "\n")
    print(f"{len(cut_tiles)} tiles from {SRC.name} "
          f"(grid {len(xs) - 1}x{len(ys) - 1} cells at {px:.0f}x{py:.0f}px -> {T}px)")

    if args.boxes:
        over = im.copy()
        d = ImageDraw.Draw(over)
        for name, box in boxes.items():
            d.rectangle([box[0], box[1], box[2] - 1, box[3] - 1], outline=(255, 0, 255), width=2)
            d.text((box[0] + 5, box[1] + 4), name.replace("palace-", ""), fill=(255, 0, 255))
        out = ROOT / "docs" / "palace-grid-boxes.png"
        over.save(out)
        print(f"boxes -> {out.relative_to(ROOT)}")

    if args.contact:
        names = sorted(cut_tiles)
        cols, rows = 6, (len(names) + 5) // 6
        sheet = Image.new("RGB", (cols * (T + 6), rows * (T + 20)), (22, 18, 28))
        d = ImageDraw.Draw(sheet)
        for i, name in enumerate(names):
            x, y = (i % cols) * (T + 6), (i // cols) * (T + 20)
            sheet.paste(cut_tiles[name], (x + 3, y + 16))
            d.text((x + 4, y + 3), name.replace("palace-", ""), fill=(220, 214, 230))
        out = ROOT / "docs" / "palace-grid-tiles.png"
        sheet.save(out)
        print(f"contact sheet -> {out.relative_to(ROOT)}")

    manifest, count = write_manifest(ROOT)
    print(f"{manifest.relative_to(ROOT)}: {count} assets")


if __name__ == "__main__":
    main()
