#!/usr/bin/env python3
"""Blank DOWN/UP drawing templates (art/<slug>-updown-grid.png).

The overworld token faces its heading: the renderer (facingFor in mapView.js)
uses '<key>-down' / '<key>-up' strips when they exist, falling back to the
(auto-flipped) side strip. Most party members are side-view only. This tool
emits a magenta-chroma template per character so the missing down/up walk poses
can be drawn (by hand or a pose model) at the right scale, then sliced back with
slice_grid.py.

Layout (magenta = keyed-out background; see is_bg in the tools):
    row 0  SIDE (reference)  — the character's EXISTING side-walk frames, so the
                               new poses match its scale, palette, and grain.
    row 1  DOWN (draw here)  — blank slots: walking TOWARD the camera (front).
    row 2  UP   (draw here)  — blank slots: walking AWAY   (back).
Every label/guide is drawn in a *keyed* magenta shade so slice_grid ignores it —
only real drawn art forms row/column bands.

After drawing the DOWN and UP rows, slice with:
    python3 tools/slice_grid.py art/<slug>-updown-grid.png <slug>-walk \
        --rows side down up --frame-height 150
Keep <slug>-walk-down / <slug>-walk-up (the redundant 'side' strip re-derives the
existing one — discard it). Rebuild and the token uses them automatically.

Usage:
    python3 tools/make_updown_template.py                  # spawnee, swash, spellblade
    python3 tools/make_updown_template.py turquoise gowra  # any slugs with a -walk strip
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SPR = ROOT / "assets" / "sprites"
ART = ROOT / "art"

# The side-only party members that still need down/up poses. Titles match the
# character sheets; the slug is the sprite-key prefix.
DEFAULT = [
    ("spawnee", "Spawnee"),
    ("swash", "Dragonkin Swashbuckler"),
    ("spellblade", "Dragonkin Spellblade"),
]

# Pure magenta background; a slightly duller — but still keyed (is_bg: r>180,
# g<95, b>180) — magenta for every annotation, so the slicer drops it and only
# the drawn figures become content.
BG = (255, 0, 255)
MARK = (190, 20, 190)     # labels + guide ticks (keyed-out, visibly duller)
GUIDE = (215, 0, 215)     # faint cell outline (keyed-out)

CELL = 220        # slot size in px (bigger than the 150 target; slice downsamples)
GUT = 40          # gutter between slots — wide, all-magenta, so bands cut cleanly
MARGIN = 40
TOPBAND = 96      # title strip above the grid
LABELW = 176      # left column for row labels

ROWS = [
    ("side", "SIDE — reference", "the frames you already have (do not redraw)"),
    ("down", "DOWN — draw here", "walking TOWARD the camera (we see the front)"),
    ("up", "UP — draw here", "walking AWAY from the camera (we see the back)"),
]


def font(sz, bold=False):
    for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
              else "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/System/Library/Fonts/Helvetica.ttc"]:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


F_TITLE, F_SUB, F_ROW, F_HINT, F_SLOT = (
    font(30, True), font(15), font(19, True), font(13), font(15, True))


def side_frames(slug):
    """Existing side-walk frames as square cells, or None if the strip is absent."""
    p = SPR / f"{slug}-walk.png"
    if not p.exists():
        return None
    im = Image.open(p).convert("RGBA")
    n = max(1, round(im.width / im.height))
    fw = im.width // n
    return [im.crop((i * fw, 0, (i + 1) * fw, im.height)) for i in range(n)]


def dashed_rect(d, box, color, dash=10, gap=8, w=2):
    x0, y0, x1, y1 = box
    for yy in (y0, y1):
        p = x0
        while p < x1:
            d.line([(p, yy), (min(p + dash, x1), yy)], fill=color, width=w)
            p += dash + gap
    for xx in (x0, x1):
        p = y0
        while p < y1:
            d.line([(xx, p), (xx, min(p + dash, y1))], fill=color, width=w)
            p += dash + gap


def build(slug, title):
    frames = side_frames(slug)
    if not frames:
        print(f"skip {slug}: no assets/sprites/{slug}-walk.png")
        return
    cols = max(2, len(frames))  # at least two frames per animation

    W = MARGIN + LABELW + cols * CELL + (cols - 1) * GUT + MARGIN
    H = MARGIN + TOPBAND + len(ROWS) * CELL + (len(ROWS) - 1) * GUT + MARGIN
    im = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(im)

    # Title band (keyed magenta — informational only). Auto-shrink so long
    # names (e.g. "Dragonkin Swashbuckler") never run off the sheet.
    avail = W - 2 * MARGIN
    title_txt = f"{title} — overworld DOWN / UP template"
    tf = F_TITLE
    for sz in range(30, 17, -1):
        tf = font(sz, True)
        if d.textlength(title_txt, font=tf) <= avail:
            break
    d.text((MARGIN, MARGIN), title_txt, MARK, font=tf)
    d.text((MARGIN, MARGIN + 44),
           "Draw the DOWN and UP walk poses to match the SIDE reference row.", MARK, font=F_SUB)
    d.text((MARGIN, MARGIN + 64),
           f"Then slice:  slice_grid.py  {slug}-updown-grid.png  {slug}-walk  "
           "--rows side down up  --frame-height 150", MARK, font=F_HINT)

    gx = MARGIN + LABELW
    gy = MARGIN + TOPBAND
    for c in range(cols):
        cx = gx + c * (CELL + GUT)
        d.text((cx + 6, gy - 24), f"frame {c + 1}", MARK, font=F_HINT)

    for r, (key, label, hint) in enumerate(ROWS):
        ry = gy + r * (CELL + GUT)
        d.text((MARGIN, ry + 4), label, MARK, font=F_ROW)
        # wrap the hint under the label
        words, line, yy = hint.split(), "", ry + 30
        for wd in words:
            test = (line + " " + wd).strip()
            if d.textlength(test, font=F_HINT) > LABELW - 12 and line:
                d.text((MARGIN, yy), line, MARK, font=F_HINT); yy += 17; line = wd
            else:
                line = test
        if line:
            d.text((MARGIN, yy), line, MARK, font=F_HINT)

        for c in range(cols):
            cx = gx + c * (CELL + GUT)
            box = (cx, ry, cx + CELL, ry + CELL)
            if key == "side" and c < len(frames):
                # paste the real frame, centred (already square, ~150 in a 220 cell)
                f = frames[c]
                im.alpha_composite(f, (cx + (CELL - f.width) // 2, ry + (CELL - f.height) // 2))
            else:
                dashed_rect(d, box, GUIDE)
                d.text((cx + CELL // 2 - 26, ry + CELL // 2 - 8),
                       f"{key.upper()} {c + 1}", MARK, font=F_SLOT)

    out = ART / f"{slug}-updown-grid.png"
    im.convert("RGB").save(out)  # flat RGB on magenta — the chroma the slicer expects
    print(f"wrote {out.relative_to(ROOT)}  ({W}x{H}, {len(ROWS)} rows x {cols} cols)")


def main():
    args = sys.argv[1:]
    targets = [(s, s.title()) for s in args] if args else DEFAULT
    for slug, title in targets:
        build(slug, title)


if __name__ == "__main__":
    main()
