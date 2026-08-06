"""Cut the whole palace theme out of one room sheet.

`art/palace-room-sheet.png` is a finished 8x8 room: an outer wall ring with two
doors, a cobble floor, and internal wall runs threading through it. Taking every
piece from a single sheet is the point — the theme used to be stitched from
three, and the floor a wall tile bakes into its edges then never matched the
floor beside it.

Two things need handling.

**The arms don't agree.** The internal walls are hand-drawn, so a run is
anywhere from 39% to 67% of a cell wide and its centre wanders +-20px. Cut as
drawn, every corner-to-run join steps. `normalise` fixes each piece by warping
it so its arms land on one shared band: a piecewise-linear resample that pins
[0, lo, hi, N-1] to [0, TLO, THI, N-1], which moves the arm without squashing
the tile's border. The band a piece is warped by is measured from the edges the
wall actually leaves through, so a corner is corrected on both axes at once.

**The sheet is truncated.** Its last column is 83px and last row 119px against
~145 elsewhere, so the east and south of the ring are incomplete. Those come
from mirroring the west and north, which is exact for a ring drawn symmetrically.

    python3 tools/slice_palace_room.py [--contact]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from spritelib import write_manifest  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "palace-room-sheet.png"
TILES = ROOT / "assets" / "tiles"
TAGS = ROOT / "data" / "tile-tags.json"

T = 160  # output tile edge, matching every other geometry tile
# The 8x8 grid, measured off the magenta rules. Last column/row are short --
# the sheet is cut off there, which is why the ring's E and S are mirrored.
COLS = [(0, 141), (145, 286), (290, 429), (433, 576), (580, 722), (726, 868), (872, 1017), (1021, 1103)]
ROWS = [(0, 141), (145, 288), (292, 432), (436, 580), (584, 730), (734, 873), (877, 1021), (1025, 1143)]
WALL_CUT = 75  # R-B above this is wall: the gold brick runs ~85, the cobble ~60

# Where the arms should end up, in output pixels. 60% of the tile, centred.
TLO, THI = 32, 128

# --- what to take, as (row, col) 0-indexed, and how ---------------------------
# Outer ring. `top` means floor lies to the SOUTH of the wall, matching wallKey.
OUTER = {
    "palace-o-top": (0, 2),      # the north run
    "palace-o-left": (1, 0),     # the west run
    "palace-o-nw": (0, 0),
}
OUTER_MIRROR = {                 # name -> (source, how)
    "palace-o-bottom": ("palace-o-top", "y"),
    "palace-o-right": ("palace-o-left", "x"),
    "palace-o-ne": ("palace-o-nw", "x"),
    "palace-o-sw": ("palace-o-nw", "y"),
    "palace-o-se": ("palace-o-nw", "xy"),
}
DOORS = {"palace-o-door-n": (0, 3), "palace-o-door-s": (7, 3)}

# Internal walls. Named for where the wall BODY sits, i.e. the directions it
# continues in — `ci-se` continues south and east, so floor lies N and W.
INNER = {
    "palace-r-ci-se": (1, 2),
    "palace-r-ci-ne": (2, 2),
    "palace-r-ci-sw": (2, 4),
    "palace-r-ci-nw": (4, 4),
    "palace-r-run-v": (3, 4),
    "palace-r-run-h": (5, 2),
    "palace-r-end-w": (1, 3),
    "palace-r-end-n": (5, 3),
}
FLOORS = [(1, 1), (1, 4), (1, 5), (2, 1), (2, 5), (3, 1), (3, 2), (6, 2), (6, 4)]


def cell(im, r, c):
    x0, x1 = COLS[c]
    y0, y1 = ROWS[r]
    return im.crop((x0, y0, x1 + 1, y1 + 1)).resize((T, T), Image.LANCZOS)


def wall_mask(tile):
    a = np.asarray(tile.convert("RGB")).astype(int)
    return (a[:, :, 0] - a[:, :, 2]) > WALL_CUT


def arm_band(mask, edge):
    """Where the wall crosses one edge, or None if it doesn't really leave."""
    line = {"N": mask[0, :], "S": mask[-1, :], "W": mask[:, 0], "E": mask[:, -1]}[edge]
    idx = np.flatnonzero(line)
    if idx.size < line.size * 0.15:
        return None
    return int(idx[0]), int(idx[-1])


def _remap(n, lo, hi):
    """Source coordinates that put [lo,hi] onto [TLO,THI], border pinned."""
    out = np.arange(n, dtype=float)
    src = np.empty(n)
    head = out <= TLO
    mid = (out > TLO) & (out < THI)
    tail = out >= THI
    src[head] = out[head] * (lo / TLO) if TLO else out[head]
    src[mid] = lo + (out[mid] - TLO) * ((hi - lo) / (THI - TLO))
    span = (n - 1) - THI
    src[tail] = hi + (out[tail] - THI) * (((n - 1) - hi) / span if span else 1)
    return np.clip(src, 0, n - 1)


def warp(tile, axis, lo, hi):
    a = np.asarray(tile.convert("RGB")).astype(float)
    if axis == 0:
        a = a.transpose(1, 0, 2)
    n = a.shape[1]
    src = _remap(n, lo, hi)
    s0 = np.floor(src).astype(int)
    s1 = np.minimum(s0 + 1, n - 1)
    t = (src - s0)[None, :, None]
    a = a[:, s0, :] * (1 - t) + a[:, s1, :] * t
    if axis == 0:
        a = a.transpose(1, 0, 2)
    return Image.fromarray(a.clip(0, 255).astype("uint8"))


def normalise(tile):
    """Pull a piece's arms onto the shared band, on whichever axes it exits."""
    m = wall_mask(tile)
    # the x-band comes from a north or south exit, the y-band from east or west
    xb = arm_band(m, "N") or arm_band(m, "S")
    yb = arm_band(m, "E") or arm_band(m, "W")
    if xb and xb[1] > xb[0]:
        tile = warp(tile, 1, *xb)
    if yb and yb[1] > yb[0]:
        tile = warp(tile, 0, *yb)
    return tile


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", action="store_true")
    args = ap.parse_args()
    im = Image.open(SRC).convert("RGB")
    TILES.mkdir(parents=True, exist_ok=True)
    tags = json.loads(TAGS.read_text()) if TAGS.exists() else {}

    def record(name, rc, role, **extra):
        tags[name] = {"tags": [], "sheet": SRC.name, "role": role,
                      "box": [COLS[rc[1]][0], ROWS[rc[0]][0],
                              COLS[rc[1]][1] - COLS[rc[1]][0] + 1,
                              ROWS[rc[0]][1] - ROWS[rc[0]][0] + 1], **extra}

    for name, rc in {**OUTER, **DOORS}.items():
        cell(im, *rc).save(TILES / f"{name}.png")
        record(name, rc, "wall")
    for name, (src, how) in OUTER_MIRROR.items():
        t = Image.open(TILES / f"{src}.png")
        if "x" in how:
            t = t.transpose(Image.FLIP_LEFT_RIGHT)
        if "y" in how:
            t = t.transpose(Image.FLIP_TOP_BOTTOM)
        t.save(TILES / f"{name}.png")
        tags[name] = {**tags[src], "from": src, "mirror": how}
    for name, rc in INNER.items():
        normalise(cell(im, *rc)).save(TILES / f"{name}.png")
        record(name, rc, "wall", normalised=True)
    for i, rc in enumerate(FLOORS):
        name = f"palace-r-floor-{chr(ord('a') + i)}"
        cell(im, *rc).save(TILES / f"{name}.png")
        record(name, rc, "floor")

    # The remaining ends and elbows are the drawn ones turned. Rotating a
    # top-lit tile moves its light, so ends (which are symmetric about their
    # own axis) rotate, while the corners are already drawn in all four.
    for name, src, turn in (
        ("palace-r-end-e", "palace-r-end-w", Image.FLIP_LEFT_RIGHT),
        ("palace-r-end-s", "palace-r-end-n", Image.FLIP_TOP_BOTTOM),
    ):
        Image.open(TILES / f"{src}.png").transpose(turn).save(TILES / f"{name}.png")
        tags[name] = {**tags[src], "from": src}

    # An enclosed wall cell: solid brick, taken from the ring's thickest run.
    solid = cell(im, 0, 6).crop((0, 0, T, T // 2)).resize((T, T), Image.LANCZOS)
    solid.save(TILES / "palace-r-fill.png")
    tags["palace-r-fill"] = {"tags": [], "sheet": SRC.name, "role": "wall",
                             "box": [COLS[6][0], ROWS[0][0], 140, 70]}

    TAGS.write_text(json.dumps(tags, indent=2) + "\n")
    manifest, count = write_manifest(ROOT)
    print(f"{len(OUTER)+len(OUTER_MIRROR)+len(DOORS)+len(INNER)+len(FLOORS)+3} tiles; manifest {count} assets")

    if args.contact:
        from PIL import ImageDraw
        names = ([*OUTER, *OUTER_MIRROR, *DOORS, *INNER, "palace-r-end-e", "palace-r-end-s",
                  "palace-r-fill"] + [f"palace-r-floor-{chr(ord('a')+i)}" for i in range(len(FLOORS))])
        cols = 6
        rows = (len(names) + cols - 1) // cols
        pad, lab = 12, 16
        sheet = Image.new("RGB", (cols * (T + pad) + pad, rows * (T + pad + lab) + pad), (18, 18, 24))
        d = ImageDraw.Draw(sheet)
        for i, n in enumerate(names):
            px = pad + (i % cols) * (T + pad)
            py = pad + (i // cols) * (T + pad + lab) + lab
            sheet.paste(Image.open(TILES / f"{n}.png").convert("RGB"), (px, py))
            d.rectangle([px, py, px + T - 1, py + T - 1], outline=(255, 200, 0))
            d.text((px, py - 12), n.replace("palace-", ""), fill=(255, 200, 0))
        out = ROOT / "docs" / "palace-room-tiles.png"
        sheet.save(out)
        print(f"contact sheet -> {out}")


if __name__ == "__main__":
    main()
