#!/usr/bin/env python3
"""Cut the palace theme out of `art/palace-hall-sheet.png`.

Replaces the older `slice_palace_room.py` cut. That sheet's internal walls were
hand-drawn at wildly different widths and had to be warped onto a common band;
worse, a run filled **84%** of its tile, so a partition read as a slab with a
sliver of floor rather than something you walk beside. This sheet is drawn on a
regular grid, so no warping is needed, and the geometry gives what the palace
was always meant to have: narrow, dense hallways.

The whole cut hangs off one number. A **224px source cell** holds the sheet's
90px brick run in the middle with ~67px of floor either side — the wall lands at
**40% of the finished 160px tile**. Everything (ring, doors, runs, elbows,
floor) is cut on that same cell, so a wall's baked floor-facing edge always
matches the floor beside it.

`palace-o-*` is the outer ring, `palace-r-*` the interior. Pieces the sheet
doesn't draw are mirrored from the ones it does — exact, since the room is drawn
symmetrically. Piece names follow `wallKey` in src/render/autotile.js:
`thinH/thinV` run east-west/north-south; `el*` are thin elbows named for the two
directions the wall CONTINUES; `end*` are termini named the same way.

    python3 tools/slice_palace_hall.py [--contact]
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from spritelib import write_manifest  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "palace-hall-sheet.png"
TILES = ROOT / "assets" / "tiles"
TAGS = ROOT / "data" / "tile-tags.json"

CELL = 224   # source pixels per map cell: 7 floor pattern periods (32px each)
T = 160      # output tile edge, matching every other geometry tile

def centred(cx, cy):
    """The CELL-sized source box centred on a point."""
    return (cx - CELL // 2, cy - CELL // 2, cx + CELL // 2, cy + CELL // 2)

# --- interior pieces, by the point the piece centres on ----------------------
# Read off the 224px grid (tools note: render the sheet with a ruler to re-check).
INNER = {
    # a straight run: floor on both opposite sides
    "palace-r-run-h": centred(672, 456),   # upper horizontal run, clean middle
    "palace-r-run-v": centred(360, 292),   # upper vertical run, clean middle
    # thin elbows, named for the two ways the wall continues
    "palace-r-el-ne": centred(360, 440),   # upper bend: arms north + east
    "palace-r-el-nw": centred(805, 435),   # upper east end: arms north + west
    "palace-r-el-sw": centred(960, 800),   # lower east bend: arms west + south
    # termini, named for the way the wall continues
    "palace-r-end-n": centred(960, 1030),  # lower run's south cap; wall runs north
}
# What the sheet doesn't draw, mirrored from what it does.
INNER_MIRROR = {
    "palace-r-el-se": ("palace-r-el-sw", Image.FLIP_LEFT_RIGHT),  # W+S -> E+S
    "palace-r-end-s": ("palace-r-end-n", Image.FLIP_TOP_BOTTOM),
    "palace-r-end-e": ("palace-r-end-n", "rot90"),
    "palace-r-end-w": ("palace-r-end-n", "rot270"),
}
# Thick-partition corners: the autotiler falls back to these when a bend is more
# than one cell thick. The sheet has no thick internal mass, so they reuse the
# elbows — visually right, since a thick corner presents the same brick face.
INNER_ALIAS = {
    "palace-r-ci-nw": "palace-r-el-nw", "palace-r-ci-ne": "palace-r-el-ne",
    "palace-r-ci-sw": "palace-r-el-sw", "palace-r-ci-se": "palace-r-el-se",
}

# --- the outer ring ----------------------------------------------------------
# Cut from the sheet's edge inward, skipping the ~8px white margin, so the tile
# is solid wall at its outer edge and floor at its inner one.
M = 20  # the sheet's white margin, trimmed off the ring's outer face
OUTER = {
    # East of the door (x~545-690) and west of the NE corner: the only stretch of
    # north wall with no door and no internal run hanging off it.
    "palace-o-top": (850, M, 850 + CELL, M + CELL),
    "palace-o-left": (M, 448, M + CELL, 448 + CELL),
    "palace-o-nw": (M, M, M + CELL, M + CELL),
}
OUTER_MIRROR = {
    "palace-o-bottom": ("palace-o-top", Image.FLIP_TOP_BOTTOM),
    "palace-o-right": ("palace-o-left", Image.FLIP_LEFT_RIGHT),
    "palace-o-ne": ("palace-o-nw", Image.FLIP_LEFT_RIGHT),
    "palace-o-sw": ("palace-o-nw", Image.FLIP_TOP_BOTTOM),
    "palace-o-se": ("palace-o-nw", "rot180"),
}
DOORS = {"palace-o-door-n": centred(620, M + CELL // 2)}
DOOR_MIRROR = {"palace-o-door-s": ("palace-o-door-n", Image.FLIP_TOP_BOTTOM)}

# --- floor -------------------------------------------------------------------
# Clean ground only: south of the upper structures (which end at y=527) and west
# of the lower ones (which start at x=400). Offsets are multiples of the floor's
# 32px pattern period, so every variant shares a phase and they tile.
FLOOR_ORIGIN = (140, 570)
FLOOR_OFFSETS = [(0, i * 32) for i in range(9)]


def transform(img, how):
    if how == "rot90":
        return img.transpose(Image.ROTATE_90)
    if how == "rot270":
        return img.transpose(Image.ROTATE_270)
    if how == "rot180":
        return img.transpose(Image.ROTATE_180)
    return img.transpose(how)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", action="store_true", help="also write a contact sheet to review")
    args = ap.parse_args()

    im = Image.open(SRC).convert("RGB")
    TILES.mkdir(parents=True, exist_ok=True)
    tags = json.loads(TAGS.read_text()) if TAGS.exists() else {}
    cut = {}

    def take(name, box, role, tag):
        img = im.crop(box).resize((T, T), Image.LANCZOS)
        cut[name] = img
        img.save(TILES / f"{name}.png")
        tags[name] = {"tags": [tag], "sheet": SRC.name, "box": [box[0], box[1], box[2] - box[0], box[3] - box[1]], "role": role}

    for name, box in {**OUTER, **DOORS}.items():
        take(name, box, "wall", "door" if "door" in name else "wall")
    for name, box in INNER.items():
        take(name, box, "wall", "wall")
    for i, (dx, dy) in enumerate(FLOOR_OFFSETS):
        x, y = FLOOR_ORIGIN[0] + dx, FLOOR_ORIGIN[1] + dy
        take(f"palace-r-floor-{chr(ord('a') + i)}", (x, y, x + CELL, y + CELL), "floor", "floor")

    for name, (src, how) in {**OUTER_MIRROR, **DOOR_MIRROR, **INNER_MIRROR}.items():
        img = transform(cut[src], how)
        cut[name] = img
        img.save(TILES / f"{name}.png")
        tags[name] = {"tags": ["door" if "door" in name else "wall"], "sheet": SRC.name,
                      "from": src, "role": "wall"}
    for name, src in INNER_ALIAS.items():
        cut[name] = cut[src]
        cut[src].save(TILES / f"{name}.png")
        tags[name] = {"tags": ["wall"], "sheet": SRC.name, "from": src, "role": "wall"}

    # A solid interior: the middle of a run, with no floor showing.
    solid = im.crop((610, 420, 610 + 90, 420 + 90)).resize((T, T), Image.LANCZOS)
    cut["palace-r-fill"] = solid
    solid.save(TILES / "palace-r-fill.png")
    tags["palace-r-fill"] = {"tags": ["wall"], "sheet": SRC.name, "role": "wall"}

    TAGS.write_text(json.dumps(tags, indent=2, sort_keys=True) + "\n")
    print(f"{len(cut)} tiles from {SRC.name} (cell {CELL}px -> {T}px, wall ~{round(90 * T / CELL)}px = 40%)")

    if args.contact:
        names = sorted(cut)
        cols = 6
        rows = (len(names) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (T + 6), rows * (T + 20)), (22, 18, 28))
        from PIL import ImageDraw
        d = ImageDraw.Draw(sheet)
        for i, name in enumerate(names):
            x, y = (i % cols) * (T + 6), (i // cols) * (T + 20)
            sheet.paste(cut[name], (x + 3, y + 16))
            d.text((x + 4, y + 3), name.replace("palace-", ""), fill=(220, 214, 230))
        out = ROOT / "docs" / "palace-hall-tiles.png"
        sheet.save(out)
        print(f"contact sheet -> {out.relative_to(ROOT)}")

    manifest, count = write_manifest(ROOT)
    print(f"{manifest.relative_to(ROOT)}: {count} assets")


if __name__ == "__main__":
    main()
