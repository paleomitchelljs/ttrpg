#!/usr/bin/env python3
"""Generate per-character reference sheets for the overworld 4-direction effort.

Each sheet shows a character's EXISTING side-view walk frames next to empty,
clearly-marked slots for the DOWN- and UP-facing frames that still need to be
drawn. Output: docs/4dir-sheets/<name>-4dir.png (+ an overview.png).

The game already flips the side strip left/right; only down (toward camera) and
up (away) art is missing. Draw those to match the side frames, on magenta, then
slice with:  python3 tools/slice_grid.py art/<name>-4dir.png <name>-walk \
             --rows down up   (one grid row -> one strip: <name>-walk-down/-up)
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SPR = ROOT / "assets" / "sprites"
OUT = ROOT / "docs" / "4dir-sheets"
OUT.mkdir(parents=True, exist_ok=True)

# character -> (existing side strip, frame count, display name)
CHARS = [
    ("dragon-fly", 4, "Red Dragon"),
    ("spawnee-walk", 2, "Spawnee"),
    ("swash-walk", 2, "Dragonkin Swashbuckler"),
    ("spellblade-walk", 2, "Dragonkin Spellblade"),
    ("beren-walk", 2, "Beren"),
    ("turquoise-walk", 2, "Turquoise"),
]

BG = (26, 23, 34)
PANEL = (46, 43, 56)
INK = (222, 217, 233)
DIM = (150, 143, 170)
GREEN = (110, 200, 130)
MAG = (230, 70, 230)
DISP = 150      # display cell size
GUT = 14
LABELW = 150
PAD = 22
HEADER = 100
COLHEAD = 28


def font(sz, bold=False):
    for p in [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


F_TITLE, F_SUB, F_LBL, F_SM = font(26, True), font(14), font(15, True), font(12)


def frames_of(strip_key, n):
    im = Image.open(SPR / f"{strip_key}.png").convert("RGBA")
    fw = im.width // n
    return [im.crop((i * fw, 0, (i + 1) * fw, im.height)) for i in range(n)], (fw, im.height)


def fit(img, box):
    """Scale an RGBA frame to fit box×box, centered, preserving aspect."""
    s = min(box / img.width, box / img.height)
    w, h = max(1, round(img.width * s)), max(1, round(img.height * s))
    r = img.resize((w, h), Image.LANCZOS)
    cell = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    cell.alpha_composite(r, ((box - w) // 2, (box - h) // 2))
    return cell


def dashed_rect(d, xy, color, dash=8, gap=6, width=2):
    x0, y0, x1, y1 = xy
    def line(a, b, horiz):
        p = a
        while p < b:
            q = min(p + dash, b)
            if horiz:
                d.line([(p, a if False else y0), (q, y0)], fill=color, width=width)
            p = q + gap
    # top/bottom
    for yy in (y0, y1):
        p = x0
        while p < x1:
            q = min(p + dash, x1)
            d.line([(p, yy), (q, yy)], fill=color, width=width)
            p = q + gap
    for xx in (x0, x1):
        p = y0
        while p < y1:
            q = min(p + dash, y1)
            d.line([(xx, p), (xx, q)], fill=color, width=width)
            p = q + gap


def rows_for(name):
    # (label, sublabel, "have"|"need", the frames or None)
    frames, size = frames_of(name, dict(CHARS).get(name) if False else next(n for k, n, _ in CHARS if k == name))
    return frames, size


def sheet(strip_key, n, title):
    frames, (fw, fh) = frames_of(strip_key, n)
    cols = n
    sub1 = f"Overworld 4-direction walk  ·  {n} frames  ·  {fw}×{fh}px each  ·  magenta background"
    sub2 = "LEFT/RIGHT reuse the side strip (auto-flipped). Draw DOWN & UP to match."
    # Wide enough for both the frame grid and the header text.
    tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    hdrw = max(tmp.textlength(title, font=F_TITLE), tmp.textlength(sub1, font=F_SUB), tmp.textlength(sub2, font=F_SUB))
    W = max(PAD + LABELW + cols * (DISP + GUT) + PAD, PAD + int(hdrw) + PAD)
    H = PAD + HEADER + COLHEAD + 3 * (DISP + GUT) + PAD
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)

    d.text((PAD, PAD), title, INK, font=F_TITLE)
    d.text((PAD, PAD + 36), sub1, DIM, font=F_SUB)
    d.text((PAD, PAD + 56), sub2, DIM, font=F_SUB)

    gx = PAD + LABELW
    gy = PAD + HEADER
    for c in range(cols):
        cx = gx + c * (DISP + GUT)
        d.text((cx + DISP // 2 - 24, gy - 22), f"frame {c + 1}", DIM, font=F_SM)

    rows = [
        ("SIDE", "have · faces left", "have", frames),
        ("DOWN", "needed · toward camera", "need", None),
        ("UP", "needed · facing away", "need", None),
    ]
    for r, (lab, sub, kind, fr) in enumerate(rows):
        ry = gy + COLHEAD + r * (DISP + GUT)
        badge = GREEN if kind == "have" else MAG
        d.text((PAD, ry + DISP // 2 - 20), lab, badge, font=F_LBL)
        d.text((PAD, ry + DISP // 2 + 2), sub, DIM, font=F_SM)
        for c in range(cols):
            cx = gx + c * (DISP + GUT)
            if kind == "have":
                im.paste(PANEL, (cx, ry, cx + DISP, ry + DISP))
                d.rectangle([cx, ry, cx + DISP, ry + DISP], outline=(70, 66, 84))
                cell = fit(fr[c], DISP)
                im.paste(cell, (cx, ry), cell)
            else:
                # magenta-tinted "paint here" slot with a dashed border + label
                slot = Image.new("RGB", (DISP, DISP), (48, 30, 48))
                im.paste(slot, (cx, ry))
                dashed_rect(d, (cx + 1, ry + 1, cx + DISP - 1, ry + DISP - 1), MAG)
                d.text((cx + DISP // 2 - 30, ry + DISP // 2 - 8), "NEEDED", MAG, font=F_LBL)

    im.save(OUT / f"{strip_key.replace('-walk', '').replace('-fly', '')}-4dir.png")
    return im


def overview(sheets):
    # stack all sheets vertically, scaled to a common width
    w = max(s.width for s in sheets)
    scaled = [s.resize((w, round(s.height * w / s.width)), Image.LANCZOS) for s in sheets]
    H = sum(s.height for s in scaled) + 20 * (len(scaled) + 1)
    im = Image.new("RGB", (w + 40, H), (16, 14, 20))
    y = 20
    for s in scaled:
        im.paste(s, (20, y))
        y += s.height + 20
    im.save(OUT / "overview.png")


sheets = [sheet(k, n, t) for k, n, t in CHARS]
overview(sheets)
print(f"wrote {len(sheets)} character sheets + overview.png to {OUT.relative_to(ROOT)}")
