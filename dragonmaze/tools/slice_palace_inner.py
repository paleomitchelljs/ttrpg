"""Slice the palace INTERNAL wall + floor sheet into 160px autotiler tiles.

`art/palace-inner-sheet.png` draws one big `+` of raised wall on a field of grey
cobble. Two things make it awkward, and this tool handles both:

1. **The magenta grid lines run straight through the art** (5px, opaque), so any
   cut leaves a pink stripe. `heal()` removes the outer frame and inpaints the
   interior lines in two passes: along x first, which fixes every vertical line
   because each row has good pixels either side; then along y, which fixes the
   horizontal lines *and* the crossings (already repaired by pass one). A single
   averaged pass does NOT work — a line's own row/column is entirely masked, so
   it has nothing to interpolate from on that axis. The healed sheet is written
   to `art/palace-inner-clean.png` and is what the boxes below index into.

2. **The art does not sit on the magenta grid.** The wall band is 126px wide but
   straddles the column-4/5 line, and the E-W wall spans three rows. So the cut
   grid is anchored on the FEATURES instead: the N-S band centres on x=618 and
   the E-W wall's plan view (north cap, top surface, south cap) on y=508, giving
   a 160px lattice at x = 538 + 160k, y = 428 + 160m.

The sheet is a pure `+` — it contains no L anywhere — so the four corners are
cut on a lattice offset by half a tile, which lands each cut on one quadrant of
the crossing. The two southern corners need a further drop (y=668, not 508)
because the wall's south side is its tall brick FACE in this 3/4 view; the floor
only reappears below it. That offset-lattice trick is the whole reason the set
comes out of one sheet.

    python3 tools/slice_palace_inner.py [--contact]
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
SRC = ROOT / "art" / "palace-inner-sheet.png"
CORNERS = ROOT / "art" / "palace-inner-corners-sheet.png"
CLEAN = ROOT / "art" / "palace-inner-clean.png"
TILES = ROOT / "assets" / "tiles"
TAGS = ROOT / "data" / "tile-tags.json"

FRAME = (66, 64, 1163, 1168)  # the interior, inside the sheet's thick magenta border
T = 160  # tile edge, matching the existing palace-* geometry tiles

# name -> (x, y) top-left in the healed sheet. Boxes are all T x T.
#
# Wall pieces are named for where the wall BODY sits, matching wallKey: `iSE`
# is a cell with floor to its N and W. Straight runs are `thinH`/`thinV` (a
# one-cell-thick wall, floor on both opposite sides); the edge pieces are a wall
# with floor on one side only.
BOXES = {
    # --- straight one-cell runs, on the feature lattice ---
    "palace-in-run-v": (538, 268),   # N-S wall, floor E and W
    "palace-in-run-h": (378, 428),   # E-W wall, floor N and S
    # --- edges: wall with floor on ONE side. The box is pulled in tight so the
    # cell is mostly wall with a ~25px verge of floor: an edge cell belongs to a
    # thick wall mass, and an earlier cut that gave away half the tile to floor
    # made every mass look eroded.
    "palace-in-bottom": (378, 403),  # floor to the N
    "palace-in-top": (378, 578),     # floor to the S
    "palace-in-left": (531, 268),    # floor to the W
    "palace-in-right": (546, 268),   # floor to the E
    # --- junction + terminus ---
    "palace-in-cross": (538, 428),
    "palace-in-end-e": (58, 428),    # the E-W arm's western terminus: wall runs EAST
    # --- floor: the clean cobble cells, well clear of every arm ---
    "palace-in-floor-a": (58, 108),
    "palace-in-floor-b": (218, 108),
    "palace-in-floor-c": (378, 108),
    "palace-in-floor-d": (698, 108),
    "palace-in-floor-e": (858, 108),
    "palace-in-floor-f": (58, 268),
    "palace-in-floor-g": (218, 268),
    "palace-in-floor-h": (698, 908),
    "palace-in-floor-i": (858, 908),
}
WALL_ROLE = {k for k in BOXES if not k.startswith("palace-in-floor")}

# An enclosed partition cell shows nothing but wall top-surface, and the sheet
# has no 160px patch of it free of a lit cap — the widest clean run is the 90x55
# inside the crossing. So `fill` is mirror-tiled up to size: reflecting instead
# of repeating keeps the seams from reading as a grid.
FILL_PATCH = (575, 470, 665, 525)

# The `+` sheet has no L in it anywhere, so an earlier pass cut the corners off a
# half-offset lattice — which lands each cut on a QUADRANT of the crossing and
# leaves the arms half-width and hard against a tile edge (64px, vs 130px centred
# on the runs). Every corner-to-run join stepped. `palace-inner-corners-sheet.png`
# draws the corners properly, so they come from there instead: cell -> the corner
# it is, named for where the wall BODY sits.
CORNER_CELLS = {
    "palace-in-ci-ne": (1, 1),   # r2c2: solid NE, floor S and W
    "palace-in-ci-nw": (1, 2),   # r2c3: solid NW, floor S and E
    "palace-in-ci-se": (2, 1),   # r3c2: solid SE, floor N and W
}
# The fourth corner is not drawn. Mirroring the SE one left-to-right keeps the
# light where it is (top-lit) — a rotation would move it.
CORNER_MIRROR = ("palace-in-ci-sw", "palace-in-ci-se")
CORNER_ROWS = [(5, 276), (284, 553), (561, 835)]
CORNER_COLS = [(4, 280), (288, 568), (576, 847)]
INSET = 4  # step in off each cell edge, clear of the magenta rules


def mirror_tile(patch, size):
    pw, ph = patch.size
    out = Image.new("RGB", (size, size))
    for i in range(0, size, pw):
        for j in range(0, size, ph):
            p = patch
            if (i // pw) % 2:
                p = p.transpose(Image.FLIP_LEFT_RIGHT)
            if (j // ph) % 2:
                p = p.transpose(Image.FLIP_TOP_BOTTOM)
            out.paste(p, (i, j))
    return out


def compose_elbow(fill, run_v, run_h, sides, cap=34):
    """Build a one-cell-thick corner by lifting the runs' own cap strips.

    The drawn corners are quadrants of a THICK wall mass, so using one where a
    single-cell wall turns gives a blob visibly fatter than the run either side.
    An elbow cell is entirely wall — what makes it read as a corner is a lit cap
    along the two edges that face floor. Taking those strips off `run_v` (which
    carries caps on its E and W edges) and `run_h` (N and S) makes them line up
    with the runs by construction: they are the same pixels.

    `sides` is the pair of edges facing floor, e.g. ('S','W') for a wall that
    continues north and east.
    """
    out = fill.copy()
    w, h = out.size
    for side in sides:
        if side == "W":
            out.paste(run_v.crop((0, 0, cap, h)), (0, 0))
        elif side == "E":
            out.paste(run_v.crop((w - cap, 0, w, h)), (w - cap, 0))
        elif side == "N":
            out.paste(run_h.crop((0, 0, w, cap)), (0, 0))
        elif side == "S":
            out.paste(run_h.crop((0, h - cap, w, h)), (0, h - cap))
    return out


def heal(im):
    """Drop the magenta frame, then inpaint the interior grid lines (see above)."""
    im = im.convert("RGB").crop(FRAME)
    a = np.asarray(im).astype(float)
    pink = (a[:, :, 0] > 185) & (a[:, :, 2] > 185) & (a[:, :, 1] < 135)
    mask = pink.copy()
    mask[:, 1:] |= pink[:, :-1]
    mask[:, :-1] |= pink[:, 1:]
    mask[1:, :] |= pink[:-1, :]
    mask[:-1, :] |= pink[1:, :]

    def sweep(arr, m, axis):
        out = arr.copy()
        idx = np.arange(arr.shape[axis])
        for i in range(arr.shape[1 - axis]):
            line = m[i, :] if axis == 1 else m[:, i]
            if not line.any() or line.all():
                continue  # nothing to do, or nothing to interpolate FROM
            good = ~line
            for c in range(3):
                vals = arr[i, :, c] if axis == 1 else arr[:, i, c]
                filled = np.interp(idx, idx[good], vals[good])
                if axis == 1:
                    out[i, :, c] = np.where(line, filled, vals)
                else:
                    out[:, i, c] = np.where(line, filled, vals)
            if axis == 1:
                m[i, :] = False
            else:
                m[:, i] = False
        return out

    work = mask.copy()
    a = sweep(a, work, 1)
    a = sweep(a, work, 0)
    if work.sum():
        print(f"  warning: {int(work.sum())} px left unhealed")
    return Image.fromarray(a.clip(0, 255).astype("uint8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", action="store_true", help="write docs/palace-inner-tiles.png")
    args = ap.parse_args()

    clean = heal(Image.open(SRC))
    clean.save(CLEAN)
    print(f"healed sheet -> {CLEAN} {clean.size}")

    TILES.mkdir(parents=True, exist_ok=True)
    tags = json.loads(TAGS.read_text()) if TAGS.exists() else {}
    for name, (x, y) in BOXES.items():
        clean.crop((x, y, x + T, y + T)).save(TILES / f"{name}.png")
        tags[name] = {
            "tags": [],
            "sheet": CLEAN.name,
            "box": [x, y, T, T],
            "role": "wall" if name in WALL_ROLE else "floor",
        }
    # The sheet terminates only one arm, so the other three ends are that tile
    # rotated -- the same trick the original palace edges/corners used.
    end = Image.open(TILES / "palace-in-end-e.png")
    for name, turn in (("palace-in-end-s", Image.ROTATE_270), ("palace-in-end-w", Image.ROTATE_180),
                       ("palace-in-end-n", Image.ROTATE_90)):
        end.transpose(turn).save(TILES / f"{name}.png")
        tags[name] = {"tags": [], "sheet": CLEAN.name, "box": list(BOXES["palace-in-end-e"]) + [T, T],
                      "role": "wall", "from": "palace-in-end-e"}

    corners = Image.open(CORNERS).convert("RGB")
    for name, (r, c) in CORNER_CELLS.items():
        y0, y1 = CORNER_ROWS[r]
        x0, x1 = CORNER_COLS[c]
        box = (x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET)
        corners.crop(box).resize((T, T), Image.LANCZOS).save(TILES / f"{name}.png")
        tags[name] = {"tags": [], "sheet": CORNERS.name, "box": list(box), "role": "wall"}
    want, src = CORNER_MIRROR
    Image.open(TILES / f"{src}.png").transpose(Image.FLIP_LEFT_RIGHT).save(TILES / f"{want}.png")
    tags[want] = {**tags[src], "from": src, "mirror": "x"}

    # Thin elbows, welded from the runs (see compose_elbow). Named for where the
    # wall body sits, so `iNE` continues N and E.
    rv = Image.open(TILES / "palace-in-run-v.png")
    rh = Image.open(TILES / "palace-in-run-h.png")
    body = mirror_tile(clean.crop(FILL_PATCH), T)
    for name, sides in (("palace-in-el-ne", ("S", "W")), ("palace-in-el-nw", ("S", "E")),
                        ("palace-in-el-se", ("N", "W")), ("palace-in-el-sw", ("N", "E"))):
        compose_elbow(body, rv, rh, sides).save(TILES / f"{name}.png")
        tags[name] = {"tags": [], "sheet": CLEAN.name, "role": "wall",
                      "from": "composed from palace-in-run-v + palace-in-run-h"}

    fill = mirror_tile(clean.crop(FILL_PATCH), T)
    fill.save(TILES / "palace-in-fill.png")
    tags["palace-in-fill"] = {
        "tags": [], "sheet": CLEAN.name, "box": list(FILL_PATCH), "role": "wall",
    }
    TAGS.write_text(json.dumps(tags, indent=2) + "\n")
    print(f"{len(BOXES) + 1} tiles -> {TILES}")

    manifest, count = write_manifest(ROOT)
    print(f"manifest -> {manifest} ({count} assets)")

    if args.contact:
        cols = 6
        rows = (len(BOXES) + cols - 1) // cols
        pad, lab = 12, 16
        sheet = Image.new("RGB", (cols * (T + pad) + pad, rows * (T + pad + lab) + pad), (18, 18, 24))
        from PIL import ImageDraw

        d = ImageDraw.Draw(sheet)
        for i, name in enumerate(BOXES):
            px = pad + (i % cols) * (T + pad)
            py = pad + (i // cols) * (T + pad + lab) + lab
            sheet.paste(Image.open(TILES / f"{name}.png"), (px, py))
            d.rectangle([px, py, px + T - 1, py + T - 1], outline=(255, 200, 0))
            d.text((px, py - 12), name.replace("palace-in-", ""), fill=(255, 200, 0))
        out = ROOT / "docs" / "palace-inner-tiles.png"
        sheet.save(out)
        print(f"contact sheet -> {out}")


if __name__ == "__main__":
    main()
