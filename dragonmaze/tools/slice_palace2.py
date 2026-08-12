#!/usr/bin/env python3
"""Cut the palace theme out of `art/palace2.png` — the current palace cut.

Supersedes `slice_palace_hall.py` (and, before it, `slice_palace_room.py`). The
sheet is one finished room: an outer ring with carved corner caps, a cobbled
floor, and a free-standing square ring standing in the middle of it. That ring
is the whole reason to prefer this sheet — it draws every piece the thin-wall
vocabulary needs (two runs, four elbows) as real art rather than as a mirror of
something else.

Everything hangs off the floor's **59px pattern period** (measured, both axes: a
29.5px flagstone with a boss on every second joint). A map cell is **3 periods =
177px**, which puts the ring's wall band at ~38% of the finished 160px tile —
the same narrow-hall proportion the previous cut chose, and it keeps every floor
variant in phase so they tile without a seam.

**Nothing is mirrored.** The hall sheet was flat-lit and truncated, so its east
and south came from flipping its west and north. This sheet is lit from the
north and drawn in that shallow top-down box perspective where you see the
*inner* face of the north wall and the *outer* face of the south one. Flipping
either would put the light and the visible face on the wrong side, so all four
outer sides and all four ring corners are cut where they are drawn.

Two pieces the sheet has no art for are built:

- `palace-r-end-*` (termini) — the ring never ends, so each end is a ring corner
  with the arm it doesn't need painted out in floor. The kept arm is the same
  arm the matching run is cut from, so an end lines up with the run it caps.
- `palace-r-fill` (solid wall interior) — the ring is only ~40px thick, so
  there is no 177px square of pure brick. Built by stacking the outer wall's
  brick course, each course offset half a brick so it reads as bond, not stripes.

    python3 tools/slice_palace2.py [--contact] [--boxes]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from spritelib import write_manifest  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "palace2.png"
TILES = ROOT / "assets" / "tiles"
TAGS = ROOT / "data" / "tile-tags.json"

PERIOD = 59         # floor pattern period, measured by autocorrelation
CELL = 3 * PERIOD   # 177px source per map cell -> ring wall band is ~38% of it
T = 160             # output tile edge, matching every other geometry tile
H = CELL // 2

# The sheet's own frame. Every side ends in a dark rule — the wall's outer edge,
# plus a few pixels of letterboxing — and `palace-o-top` is not only the map's
# border: the autotiler hands it to any wall with floor below it, so that rule
# would draw a hairline across the top of every wall mass inside the room. Cut
# inside it, on the first row of brick.
EDGE = {"l": 7, "t": 8, "r": 1019, "b": 1018}

# --- where the art is, in source pixels ---------------------------------------
# Outer ring bands: north y 8-107, west x 5-85, south y 921-1017, east x 943-1020.
# The ring's arms, by the centre of each drawn band (top face + visible face):
RING_W, RING_E = 308, 717   # x centre of the west / east arm
RING_N, RING_S = 317, 730   # y centre of the north / south arm
CLEAR_X, CLEAR_Y = 500, 512  # a stretch of outer wall clear of the corner caps


def cell(cx, cy):
    """The CELL-sized source box centred on a point (CELL is odd; centre rounds)."""
    return (cx - H, cy - H, cx - H + CELL, cy - H + CELL)


def corner(x0, y0):
    """A CELL box anchored at a corner of the sheet (x0/y0 may be right/bottom)."""
    x = x0 if x0 < 500 else x0 - CELL
    y = y0 if y0 < 500 else y0 - CELL
    return (x, y, x + CELL, y + CELL)


# --- the outer ring -----------------------------------------------------------
# Anchored on the sheet's edge, so the tile is solid wall at its outer edge and
# floor at its inner one. Each side is cut where it is drawn (see the docstring).
OUTER = {
    "palace-o-top": (CLEAR_X - H, EDGE["t"], CLEAR_X + H, EDGE["t"] + CELL),
    "palace-o-bottom": (CLEAR_X - H, EDGE["b"] - CELL, CLEAR_X + H, EDGE["b"]),
    "palace-o-left": (EDGE["l"], CLEAR_Y - H, EDGE["l"] + CELL, CLEAR_Y + H),
    "palace-o-right": (EDGE["r"] - CELL, CLEAR_Y - H, EDGE["r"], CLEAR_Y + H),
    "palace-o-nw": corner(EDGE["l"], EDGE["t"]),
    "palace-o-ne": corner(EDGE["r"], EDGE["t"]),
    "palace-o-sw": corner(EDGE["l"], EDGE["b"]),
    "palace-o-se": corner(EDGE["r"], EDGE["b"]),
}

# --- the inner ring -----------------------------------------------------------
# Runs come from the middle of an arm; elbows from a corner, named for the two
# directions the wall CONTINUES (so the ring's NW corner, whose arms head east
# and south, is el-se).
INNER = {
    "palace-r-run-h": cell(CLEAR_X, RING_N),
    "palace-r-run-v": cell(RING_W, CLEAR_Y),
    "palace-r-el-se": cell(RING_W, RING_N),
    "palace-r-el-sw": cell(RING_E, RING_N),
    "palace-r-el-ne": cell(RING_W, RING_S),
    "palace-r-el-nw": cell(RING_E, RING_S),
}

# Thick-partition corners: the autotiler falls back to these when a bend is more
# than one cell thick. A thick corner presents the same brick face as a thin
# one, so they reuse the elbows.
INNER_ALIAS = {
    "palace-r-ci-nw": "palace-r-el-nw", "palace-r-ci-ne": "palace-r-el-ne",
    "palace-r-ci-sw": "palace-r-el-sw", "palace-r-ci-se": "palace-r-el-se",
}

# --- termini ------------------------------------------------------------------
# {name: (corner box, rects to paint out, where the floor comes from)}. The rects
# are source pixels and run past the arm to swallow its cast shadow. Two of them
# per end, because a corner is not a rectangle: the arm's brick TOP face and the
# darker face below it stop at different x (the face carries on behind the bend),
# so a single rect either bites a notch out of the corner or leaves a nub of the
# arm stuck to it. The pair traces the corner's own step.
#
# The floor painted in is the same sheet displaced by that vector, always a whole
# number of floor periods — so the flagstones land back on their own joints
# instead of showing a phase step around the patch.
ERASE = {
    # keep the north arm of the SW corner, lose the east arm
    "palace-r-end-n": (cell(RING_W, RING_S),
                       [(338, 630, 410, 692), (336, 692, 410, 830)], (-3 * PERIOD, 0)),
    # keep the south arm of the NW corner, lose the east arm
    "palace-r-end-s": (cell(RING_W, RING_N),
                       [(320, 220, 410, 330), (341, 220, 410, 415)], (-3 * PERIOD, 0)),
    # keep the east arm of the NW corner, lose the south arm
    "palace-r-end-e": (cell(RING_W, RING_N),
                       [(210, 330, 320, 415), (210, 352, 341, 415)], (3 * PERIOD, 4 * PERIOD)),
    # keep the west arm of the NE corner, lose the south arm
    "palace-r-end-w": (cell(RING_E, RING_N),
                       [(700, 330, 815, 415), (680, 352, 815, 415)], (-3 * PERIOD, 4 * PERIOD)),
}
FEATHER = 7

# The render left a pale diamond of a highlight sitting on the inside of the
# south-east corner. One speck on the source sheet, but `palace-o-se` is stamped
# at every south-east corner on the map, so it repeats. Same patch-and-feather
# treatment, taking the wall from one brick course higher up the same face.
REPAIR = {"palace-o-se": ([(946, 938, 976, 976)], (0, -64))}

# --- floor --------------------------------------------------------------------
# From inside the ring: the most evenly lit ground on the sheet, clear of the
# arms' shadows, and the only clean square of ground big enough to cut nine
# variants from. (The strips between ring and outer wall are wide enough for one
# column of crops only, and nine tiles cut from one column share their vertical
# structure — tiled, that reads as stripes down the map.)
#
# The floor inside the ring is drawn ~3% smaller than the ground outside it:
# a 28.7px flagstone against 29.5px. So the floor alone is cut on ITS period —
# six of its stones, 172px — and resampled to the tile like everything else.
# Cut on the theme's 177px cell instead, each tile would end a fifth of a stone
# short and the joints would step sideways at every tile edge. Origin and step
# both land on a joint, two stones apart, which keeps the bosses in phase.
FLOOR_CELL = 172
FLOOR_STEP = 57
FLOOR_ORIGIN = (382, 404)
FLOOR_OFFSETS = [(i * FLOOR_STEP, j * FLOOR_STEP) for j in range(3) for i in range(3)]

# --- solid fill ---------------------------------------------------------------
FILL_COURSE = (150, 10, 150 + CELL, 55)   # one brick course of the north wall


def paint_out(im, box, rects, shift):
    """A tile with one arm replaced by floor, feathered in over its shadow.

    The mask is drawn in tile space, blurred, and then the rects are stamped
    back in at full strength. So the patch is opaque everywhere the arm was —
    a plain blur leaves the arm's dark face showing through at half strength
    right along the joint, which reads as a smear — while still fading out into
    the ground beyond it. Where a rect runs off the tile it is drawn past the
    edge as well: PIL's blur replicates the border, so those sides stay opaque.
    """
    tile = im.crop(box).copy()
    ox, oy = box[0], box[1]
    over = 3 * FEATHER
    hard = Image.new("L", tile.size, 0)
    d = ImageDraw.Draw(hard)
    for rect in rects:
        x0, y0, x1, y1 = rect[0] - ox, rect[1] - oy, rect[2] - ox, rect[3] - oy
        d.rectangle([x0 if x0 > 0 else -over, y0 if y0 > 0 else -over,
                     x1 if x1 < CELL else CELL + over, y1 if y1 < CELL else CELL + over], fill=255)
    mask = ImageChops.lighter(hard, hard.filter(ImageFilter.GaussianBlur(FEATHER)))
    patch = im.crop((ox + shift[0], oy + shift[1], ox + shift[0] + CELL, oy + shift[1] + CELL))
    tile.paste(level(patch, tile), (0, 0), mask)
    return tile


def level(patch, tile):
    """Scale the patch's floor to the brightness of the floor it is landing in.

    The room is lit unevenly enough that ground borrowed from the far side of it
    arrives a few percent off, and a hard-edged mask turns that into a visible
    rectangle on the finished tile. Matching the two means makes the patch
    disappear into its surroundings. Only ground is compared — brick in either
    image would drag the gain — and the correction is capped, so a bad pairing
    can't blow the patch out.
    """
    def ground(img):
        a = np.asarray(img).astype(float)
        mx, mn = a.max(2), a.min(2)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
        keep = (sat < 0.6) & (mx > 60)          # brick sits well above 0.63
        return a[keep].mean(0) if keep.sum() > 500 else a.reshape(-1, 3).mean(0)

    gain = np.clip(ground(tile) / np.maximum(ground(patch), 1), 0.85, 1.18)
    out = np.clip(np.asarray(patch).astype(float) * gain, 0, 255).astype("uint8")
    return Image.fromarray(out)


def flatten(img, target):
    """Divide a floor crop by its own lighting, then set it to a common level.

    Cut as they are, the nine floor variants each keep the patch of room light
    they were lifted from — one corner a little warmer, one edge a little
    shaded. Tiled across a map that reads as a quilt of slightly different
    squares, which is far more obvious than the flagstones repeating. Fitting a
    quadratic surface to the crop's luminance and dividing it out removes the
    gradient and leaves the stonework; scaling to a shared target removes the
    step between tiles. (A blur can't do this job: near the border it has only
    the border to average, so it leaves a bright rim exactly where two tiles
    meet — the one place the eye is looking.)
    """
    a = np.asarray(img).astype(float)
    lum = a.mean(2)
    h, w = lum.shape
    yy, xx = np.mgrid[0:h, 0:w] / max(h - 1, 1)
    basis = np.stack([np.ones_like(xx), xx, yy, xx * xx, xx * yy, yy * yy], -1).reshape(-1, 6)
    coef, *_ = np.linalg.lstsq(basis, lum.reshape(-1), rcond=None)
    fit = (basis @ coef).reshape(h, w)
    a *= (fit.mean() / np.maximum(fit, 1))[..., None]
    a *= target / max(a.mean(), 1)
    return Image.fromarray(np.clip(a, 0, 255).astype("uint8"))


def solid_fill(im):
    """Stack one brick course into a full tile, offset half a brick per row."""
    course = im.crop(FILL_COURSE)
    cw, ch = course.size
    out = Image.new("RGB", (CELL, CELL))
    for i, y in enumerate(range(0, CELL, ch)):
        row = Image.new("RGB", (CELL, ch))
        dx = -(cw // 6) * (i % 2)          # half a 60px brick
        row.paste(course, (dx, 0))
        row.paste(course, (dx + cw, 0))
        out.paste(row, (0, y))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", action="store_true", help="write a contact sheet to review")
    ap.add_argument("--boxes", action="store_true", help="write the sheet with every box drawn on it")
    args = ap.parse_args()

    im = Image.open(SRC).convert("RGB")
    TILES.mkdir(parents=True, exist_ok=True)
    tags = json.loads(TAGS.read_text()) if TAGS.exists() else {}
    cut, boxes = {}, {}

    def keep(name, img, role, tag, **extra):
        img = img.resize((T, T), Image.LANCZOS)
        cut[name] = img
        img.save(TILES / f"{name}.png")
        tags[name] = {"tags": [tag], "sheet": SRC.name, "role": role, **extra}

    def take(name, box, role, tag):
        boxes[name] = box
        img = paint_out(im, box, *REPAIR[name]) if name in REPAIR else im.crop(box)
        keep(name, img, role, tag,
             box=[box[0], box[1], box[2] - box[0], box[3] - box[1]])

    for name, box in OUTER.items():
        take(name, box, "wall", "wall")
    for name, box in INNER.items():
        take(name, box, "wall", "wall")
    for name, (box, rects, shift) in ERASE.items():
        boxes[name] = box
        keep(name, paint_out(im, box, rects, shift), "wall", "wall",
             box=[box[0], box[1], box[2] - box[0], box[3] - box[1]],
             painted=[list(r) for r in rects])
    crops = [im.crop((FLOOR_ORIGIN[0] + dx, FLOOR_ORIGIN[1] + dy,
                      FLOOR_ORIGIN[0] + dx + FLOOR_CELL, FLOOR_ORIGIN[1] + dy + FLOOR_CELL))
             for dx, dy in FLOOR_OFFSETS]
    level_to = sum(np.asarray(c).mean() for c in crops) / len(crops)
    for i, ((dx, dy), crop) in enumerate(zip(FLOOR_OFFSETS, crops)):
        x, y = FLOOR_ORIGIN[0] + dx, FLOOR_ORIGIN[1] + dy
        name = f"palace-r-floor-{chr(ord('a') + i)}"
        boxes[name] = (x, y, x + FLOOR_CELL, y + FLOOR_CELL)
        keep(name, flatten(crop, level_to), "floor", "floor",
             box=[x, y, FLOOR_CELL, FLOOR_CELL], flattened=True)
    keep("palace-r-fill", solid_fill(im), "wall", "wall", built_from=list(FILL_COURSE))

    for name, src in INNER_ALIAS.items():
        cut[name] = cut[src]
        cut[src].save(TILES / f"{name}.png")
        tags[name] = {"tags": ["wall"], "sheet": SRC.name, "from": src, "role": "wall"}

    TAGS.write_text(json.dumps(tags, indent=2, sort_keys=True) + "\n")
    band = 71  # the ring's drawn wall band, north arm
    print(f"{len(cut)} tiles from {SRC.name} "
          f"(cell {CELL}px = 3x{PERIOD} floor period -> {T}px; wall band ~{round(band * T / CELL)}px = {round(100 * band / CELL)}%)")

    if args.boxes:
        over = im.copy()
        d = ImageDraw.Draw(over)
        for name, box in boxes.items():
            d.rectangle(box, outline=(255, 0, 255), width=3)
            d.text((box[0] + 6, box[1] + 6), name.replace("palace-", ""), fill=(255, 0, 255))
        out = ROOT / "docs" / "palace2-boxes.png"
        over.save(out)
        print(f"boxes -> {out.relative_to(ROOT)}")

    if args.contact:
        names = sorted(cut)
        cols, rows = 6, (len(cut) + 5) // 6
        sheet = Image.new("RGB", (cols * (T + 6), rows * (T + 20)), (22, 18, 28))
        d = ImageDraw.Draw(sheet)
        for i, name in enumerate(names):
            x, y = (i % cols) * (T + 6), (i // cols) * (T + 20)
            sheet.paste(cut[name], (x + 3, y + 16))
            d.text((x + 4, y + 3), name.replace("palace-", ""), fill=(220, 214, 230))
        out = ROOT / "docs" / "palace2-tiles.png"
        sheet.save(out)
        print(f"contact sheet -> {out.relative_to(ROOT)}")

    manifest, count = write_manifest(ROOT)
    print(f"{manifest.relative_to(ROOT)}: {count} assets")


if __name__ == "__main__":
    main()
