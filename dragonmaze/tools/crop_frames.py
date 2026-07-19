#!/usr/bin/env python3
"""Crop animation frames from the 768x1392 art sheets (5x9 cells of
~153.6x154.7), key out the flat/checkered background, and assemble
horizontal strip PNGs under assets/sprites/.

Every strip frame is cropped with the same box within its sheet so frames
stay aligned; strips animate via CSS steps(). Also writes a contact sheet
to /tmp-style scratch for quick visual review (pass --contact PATH).

Run from dragonmaze/: python3 tools/crop_frames.py [--contact out.png]
"""
import sys
from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "art"
OUT = ROOT / "assets" / "sprites"

CELL_W = 768 / 5
CELL_H = 1392 / 9

# Sheets that deviate from the standard 768x1392 grid: sheet -> (cell_w, cell_h)
SHEET_CELLS = {
    "skeleton-warrior-sheet.png": (113, 1024 / 9),
    "dragonkin-spellblade-sheet.png": (113, 1024 / 9),
    "monsters-menagerie-sheet.png": (565 / 7, 1024 / 13),
}

# Background keying tolerance per sheet: how close to a corner color a pixel
# must be to count as background. Keep tight where the figure shares hues
# with the backdrop (gray maces on gray, pale undead flesh on lavender).
SHEET_TOLERANCE = {
    "goblin-fire-sheet.png": 35,
    "froglok-undead-sheet.png": 28,
}
DEFAULT_TOLERANCE = 60

# strip name -> {sheet, cells: [(col, row), ...], box: (dx, dy, w, h) in-cell}
# Cells are 1-indexed; the same box applies to every frame so they align.
STRIPS = {
    # wing-flap cycle: mid, up, mid, back
    "dragon-fly": {
        "sheet": "red-dragon-sheet.png",
        "cells": [(3, 1), (4, 1), (3, 1), (1, 2)],
        "box": (4, 4, 146, 146),
    },
    # facing the camera (moving down): wide-wing flap pair
    "dragon-down": {
        "sheet": "red-dragon-sheet.png",
        "cells": [(1, 5), (2, 5)],
        "box": (4, 4, 146, 146),
    },
    # flying away (moving up): folded vertical silhouette pair
    "dragon-up": {
        "sheet": "red-dragon-sheet.png",
        "cells": [(1, 1), (2, 1)],
        "box": (4, 4, 146, 146),
    },
    # the red dragonkin is the Shadow Knight (a monster; art faces right)
    "shadow-knight-idle": {
        "sheet": "dragonkin-knight-sheet.png",
        "cells": [(1, 2), (2, 2)],
        "box": (4, 4, 146, 146),
    },
    "shadow-knight-attack": {
        "sheet": "dragonkin-knight-sheet.png",
        "cells": [(3, 3), (4, 3)],
        "box": (4, 4, 146, 146),
    },
    "swash-idle": {
        "sheet": "dragonkin-swashbuckler-sheet.png",
        "cells": [(1, 3), (2, 3)],
        "box": (14, 52, 124, 94),
    },
    "swash-attack": {
        "sheet": "dragonkin-swashbuckler-sheet.png",
        "cells": [(2, 1), (3, 1)],
        "box": (14, 52, 124, 94),
    },
    "spellblade-idle": {
        "sheet": "dragonkin-spellblade-sheet.png",
        "cells": [(1, 5), (2, 5)],
        "box": (3, 3, 107, 107),
    },
    "spellblade-attack": {
        "sheet": "dragonkin-spellblade-sheet.png",
        "cells": [(1, 6), (2, 6)],
        "box": (3, 3, 107, 107),
    },
    # broad-use menagerie: minotaur, bat, rat, evil eye, ogre, slime
    "minotaur-idle": {
        "sheet": "monsters-menagerie-sheet.png",
        "cells": [(1, 1), (2, 1)],
        "box": (2, 2, 77, 75),
    },
    "minotaur-attack": {
        "sheet": "monsters-menagerie-sheet.png",
        "cells": [(3, 3), (4, 3)],
        "box": (2, 2, 77, 75),
    },
    "rat-idle": {
        "sheet": "monsters-menagerie-sheet.png",
        "cells": [(1, 6), (2, 6)],
        "box": (2, 2, 77, 75),
    },
    "rat-attack": {
        "sheet": "monsters-menagerie-sheet.png",
        "cells": [(4, 6), (5, 6)],
        "box": (2, 2, 77, 75),
    },
    "evil-eye-idle": {
        "sheet": "monsters-menagerie-sheet.png",
        "cells": [(1, 8), (2, 8)],
        "box": (2, 2, 77, 75),
    },
    "evil-eye-attack": {
        "sheet": "monsters-menagerie-sheet.png",
        "cells": [(3, 8), (5, 8)],
        "box": (2, 2, 77, 75),
    },
    "ogre-idle": {
        "sheet": "monsters-menagerie-sheet.png",
        "cells": [(1, 11), (2, 11)],
        "box": (2, 2, 77, 75),
    },
    "ogre-attack": {
        "sheet": "monsters-menagerie-sheet.png",
        "cells": [(3, 12), (4, 12)],
        "box": (2, 2, 77, 75),
    },
    "slime-idle": {
        "sheet": "monsters-menagerie-sheet.png",
        "cells": [(1, 13), (2, 13)],
        "box": (2, 2, 77, 75),
    },
    "slime-attack": {
        "sheet": "monsters-menagerie-sheet.png",
        "cells": [(4, 13), (6, 13)],
        "box": (2, 2, 77, 75),
    },
    # labeled panel sheet, irregular layout: absolute boxes
    "bard-idle": {
        "sheet": "bard-sheet.png",
        "abs": [(51, 51, 137, 155), (204, 51, 135, 155)],
    },
    "bard-attack": {
        "sheet": "bard-sheet.png",
        "abs": [(204, 253, 135, 154), (350, 253, 133, 154)],
    },
    # this sheet's grid is irregular; use absolute (x, y, w, h) frame boxes
    "skeleton-idle": {
        "sheet": "skeleton-warrior-sheet.png",
        "abs": [(438, 151, 100, 100), (28, 267, 100, 100)],
    },
    "skeleton-attack": {
        "sheet": "skeleton-warrior-sheet.png",
        "abs": [(28, 36, 100, 99), (233, 36, 100, 99)],
    },
    "goblin-idle": {
        "sheet": "goblin-fire-sheet.png",
        "cells": [(1, 7), (2, 7)],
        "box": (4, 24, 146, 126),
    },
    "goblin-attack": {
        "sheet": "goblin-fire-sheet.png",
        "cells": [(2, 9), (4, 8)],
        "box": (4, 24, 146, 126),
    },
    "sarnak-idle": {
        "sheet": "sarnak-vampire-sheet.png",
        "cells": [(1, 1), (2, 1)],
        "box": (4, 4, 146, 118),
    },
    "sarnak-attack": {
        "sheet": "sarnak-vampire-sheet.png",
        "cells": [(3, 2), (4, 2)],
        "box": (4, 4, 146, 118),
    },
    "froglok-zombie-idle": {
        "sheet": "froglok-undead-sheet.png",
        "cells": [(1, 1), (2, 1)],
        "box": (6, 40, 140, 106),
    },
    "froglok-zombie-attack": {
        "sheet": "froglok-undead-sheet.png",
        "cells": [(3, 1), (4, 1)],
        "box": (6, 40, 140, 106),
    },
    "froglok-idle": {
        "sheet": "froglok-warriors-sheet.png",
        "cells": [(1, 2), (2, 2)],
        "box": (4, 6, 146, 132),
    },
    "froglok-attack": {
        "sheet": "froglok-warriors-sheet.png",
        "cells": [(2, 7), (3, 7)],
        "box": (4, 6, 146, 132),
    },
    "lizardfolk-idle": {
        "sheet": "lizardfolk-warriors-sheet.png",
        "cells": [(1, 3), (2, 3)],
        "box": (10, 4, 134, 138),
    },
    "lizardfolk-attack": {
        "sheet": "lizardfolk-warriors-sheet.png",
        "cells": [(2, 1), (3, 1)],
        "box": (10, 4, 134, 138),
    },
}


def is_bg_factory(im, tolerance):
    """Background = anything close to a border-corner color, or checker gray."""
    w, h = im.size
    corners = [im.getpixel(p)[:3] for p in [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)]]

    def is_bg(px):
        r, g, b = px[0], px[1], px[2]
        if max(r, g, b) - min(r, g, b) < 26 and (r + g + b) / 3 > 175:
            return True  # white/gray checker squares
        return any(abs(r - cr) + abs(g - cg) + abs(b - cb) < tolerance for cr, cg, cb in corners)

    return is_bg


def dekey(im, tolerance):
    """Flood-fill transparent from the borders through background-ish pixels."""
    im = im.convert("RGBA")
    w, h = im.size
    pix = im.load()
    is_bg = is_bg_factory(im, tolerance)
    seen = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg(pix[x, y]) and not seen[y][x]:
                seen[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg(pix[x, y]) and not seen[y][x]:
                seen[y][x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        r, g, b, _ = pix[x, y]
        pix[x, y] = (r, g, b, 0)
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_bg(pix[nx, ny]):
                seen[ny][nx] = True
                q.append((nx, ny))
    return im


def cell_box(box, col, row, sheet):
    cw, ch = SHEET_CELLS.get(sheet, (CELL_W, CELL_H))
    dx, dy, w, h = box
    x = round((col - 1) * cw) + dx
    y = round((row - 1) * ch) + dy
    return (x, y, x + w, y + h)


def main():
    contact = None
    if "--contact" in sys.argv:
        contact = Path(sys.argv[sys.argv.index("--contact") + 1])
    OUT.mkdir(parents=True, exist_ok=True)
    sheets = {}
    made = []
    for name, spec in STRIPS.items():
        sheet = spec["sheet"]
        if sheet not in sheets:
            sheets[sheet] = Image.open(ART / sheet).convert("RGBA")
        tol = SHEET_TOLERANCE.get(sheet, DEFAULT_TOLERANCE)
        if "abs" in spec:
            boxes = [(x, y, x + bw, y + bh) for x, y, bw, bh in spec["abs"]]
        else:
            boxes = [cell_box(spec["box"], c, r, sheet) for c, r in spec["cells"]]
        frames = [dekey(sheets[sheet].crop(b), tol) for b in boxes]
        # square frames, feet anchored at the bottom, so CSS strips are uniform
        side = max(max(f.size) for f in frames)
        strip = Image.new("RGBA", (side * len(frames), side), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            strip.paste(f, (i * side + (side - f.size[0]) // 2, side - f.size[1]), f)
        fw = fh = side
        strip.save(OUT / f"{name}.png")
        made.append((name, strip))
        print(f"{name}.png: {len(frames)} frames of {fw}x{fh}")
    # Emit a manifest module with FULL literal paths for every strip.
    # Runtime code must use these (not string-build paths) so build.mjs can
    # rewrite each literal into an inlined data URI for the single-file build.
    manifest = ROOT / "src" / "assets-manifest.js"
    lines = "\n".join(f"  '{name}': './assets/sprites/{name}.png'," for name in STRIPS)
    manifest.write_text(
        "// GENERATED by tools/crop_frames.py — do not edit by hand.\n"
        "// Literal paths let build.mjs inline every strip as a data URI.\n"
        f"export const SPRITES = {{\n{lines}\n}};\n"
    )
    print(f"manifest: {manifest.relative_to(ROOT)}")

    if contact:
        pad = 8
        width = max(s.size[0] for _, s in made) + pad * 2
        height = sum(s.size[1] + pad for _, s in made) + pad
        board = Image.new("RGBA", (width, height), (40, 30, 50, 255))
        y = pad
        for name, s in made:
            board.paste(s, (pad, y), s)
            y += s.size[1] + pad
        board.save(contact)
        print(f"contact sheet: {contact}")


main()
