#!/usr/bin/env python3
"""Per-character sprite reference sheets (docs/4dir-sheets/<name>-4dir.png).

Each sheet lays out ALL of a character's animation strips — idle, attack, and
the four-direction walk (side / down / up) — auto-detecting which exist. Frames
that are drawn show as green HAVE cells; the ones still to draw (usually the
overworld down/up poses) show as magenta NEEDED slots at the right size.

The game flips the side strip for left/right, and picks up '<key>-down' /
'<key>-up' when they exist. To add a direction: draw the poses on a magenta grid
(one row per direction) and slice with e.g.
    python3 tools/slice_grid.py art/beren-updown-grid.png beren-walk \
        --rows down up --frame-height 150
then rerun this script to refresh the sheet.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SPR = ROOT / "assets" / "sprites"
OUT = ROOT / "docs" / "4dir-sheets"
OUT.mkdir(parents=True, exist_ok=True)

# (title, slug, [(row label, strip key), ...])  — the strip that is the "side"
# walk is the 3rd row; down/up hang off it.
CHARS = [
    ("Red Dragon", "dragon", [
        ("Idle", "dragon-idle"), ("Attack", "dragon-attack"),
        ("Fly — side (L/R)", "dragon-fly"), ("Fly — down", "dragon-fly-down"), ("Fly — up", "dragon-fly-up")]),
    ("Spawnee", "spawnee", [
        ("Idle", "spawnee-idle"), ("Attack", "spawnee-attack"),
        ("Walk — side (L/R)", "spawnee-walk"), ("Walk — down", "spawnee-walk-down"), ("Walk — up", "spawnee-walk-up")]),
    ("Dragonkin Swashbuckler", "swash", [
        ("Idle", "swash-idle"), ("Attack", "swash-attack"),
        ("Walk — side (L/R)", "swash-walk"), ("Walk — down", "swash-walk-down"), ("Walk — up", "swash-walk-up")]),
    ("Dragonkin Spellblade", "spellblade", [
        ("Idle", "spellblade-idle"), ("Attack", "spellblade-attack"),
        ("Walk — side (L/R)", "spellblade-walk"), ("Walk — down", "spellblade-walk-down"), ("Walk — up", "spellblade-walk-up")]),
    ("Beren", "beren", [
        ("Idle", "beren-idle"), ("Attack", "beren-attack"),
        ("Walk — side (L/R)", "beren-walk"), ("Walk — down", "beren-walk-down"), ("Walk — up", "beren-walk-up")]),
    ("Turquoise", "turquoise", [
        ("Idle", "turquoise-idle"), ("Attack", "turquoise-attack"),
        ("Walk — side (L/R)", "turquoise-walk"), ("Walk — down", "turquoise-walk-down"), ("Walk — up", "turquoise-walk-up")]),
    ("Gowra", "gowra", [
        ("Idle", "gowra-idle"), ("Attack", "gowra-attack"),
        ("Walk — side (L/R)", "gowra-walk"), ("Walk — down", "gowra-walk-down"), ("Walk — up", "gowra-walk-up")]),
]

BG, PANEL, INK, DIM = (26, 23, 34), (46, 43, 56), (222, 217, 233), (150, 143, 170)
GREEN, MAG = (110, 200, 130), (230, 70, 230)
DISP, GUT, LABELW, PAD, HEADER, COLHEAD = 150, 14, 180, 22, 100, 28


def font(sz, bold=False):
    for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/System/Library/Fonts/Helvetica.ttc"]:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


F_TITLE, F_SUB, F_LBL, F_SM = font(26, True), font(14), font(15, True), font(12)


def strip_frames(key):
    """(frames, (fw, fh)) for an existing strip, or None if it isn't drawn yet."""
    p = SPR / f"{key}.png"
    if not p.exists():
        return None
    im = Image.open(p).convert("RGBA")
    n = max(1, round(im.width / im.height))
    fw = im.width // n
    return [im.crop((i * fw, 0, (i + 1) * fw, im.height)) for i in range(n)], (fw, im.height)


def fit(img, box):
    s = min(box / img.width, box / img.height)
    w, h = max(1, round(img.width * s)), max(1, round(img.height * s))
    r = img.resize((w, h), Image.LANCZOS)
    cell = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    cell.alpha_composite(r, ((box - w) // 2, (box - h) // 2))
    return cell


def dashed_rect(d, x0, y0, x1, y1, color, dash=8, gap=6, w=2):
    for yy in (y0, y1):
        p = x0
        while p < x1:
            d.line([(p, yy), (min(p + dash, x1), yy)], fill=color, width=w); p += dash + gap
    for xx in (x0, x1):
        p = y0
        while p < y1:
            d.line([(xx, p), (xx, min(p + dash, y1))], fill=color, width=w); p += dash + gap


def sheet(title, slug, rowdefs):
    got = [(lab, strip_frames(key)) for lab, key in rowdefs]
    # frame count for the "needed" rows = the side strip's (row index 2)
    side = got[2][1]
    side_n = len(side[0]) if side else 2
    cols = max((len(fr[0]) if fr else side_n) for _, fr in got)
    have = sum(1 for _, fr in got if fr)

    sub1 = f"All sprites  ·  {have}/{len(got)} animations drawn  ·  magenta = still to draw"
    tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    hdrw = max(tmp.textlength(title, font=F_TITLE), tmp.textlength(sub1, font=F_SUB))
    W = max(PAD + LABELW + cols * (DISP + GUT) + PAD, PAD + int(hdrw) + PAD)
    H = PAD + HEADER + COLHEAD + len(got) * (DISP + GUT) + PAD
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((PAD, PAD), title, INK, font=F_TITLE)
    d.text((PAD, PAD + 40), sub1, DIM, font=F_SUB)

    gx, gy = PAD + LABELW, PAD + HEADER
    for c in range(cols):
        d.text((gx + c * (DISP + GUT) + DISP // 2 - 24, gy - 22), f"frame {c + 1}", DIM, font=F_SM)

    for r, (lab, fr) in enumerate(got):
        ry = gy + COLHEAD + r * (DISP + GUT)
        d.text((PAD, ry + DISP // 2 - 18), lab, GREEN if fr else MAG, font=F_LBL)
        d.text((PAD, ry + DISP // 2 + 4), "have" if fr else "needed", DIM, font=F_SM)
        n = len(fr[0]) if fr else side_n
        for c in range(cols):
            cx = gx + c * (DISP + GUT)
            if c >= n:
                continue  # this animation has fewer frames — leave the cell blank
            if fr:
                im.paste(PANEL, (cx, ry, cx + DISP, ry + DISP))
                d.rectangle([cx, ry, cx + DISP, ry + DISP], outline=(70, 66, 84))
                cell = fit(fr[0][c], DISP)
                im.paste(cell, (cx, ry), cell)
            else:
                im.paste((48, 30, 48), (cx, ry, cx + DISP, ry + DISP))
                dashed_rect(d, cx + 1, ry + 1, cx + DISP - 1, ry + DISP - 1, MAG)
                d.text((cx + DISP // 2 - 30, ry + DISP // 2 - 8), "NEEDED", MAG, font=F_LBL)

    im.save(OUT / f"{slug}-4dir.png")
    return im


def overview(sheets):
    w = max(s.width for s in sheets)
    scaled = [s.resize((w, round(s.height * w / s.width)), Image.LANCZOS) for s in sheets]
    H = sum(s.height for s in scaled) + 20 * (len(scaled) + 1)
    im = Image.new("RGB", (w + 40, H), (16, 14, 20))
    y = 20
    for s in scaled:
        im.paste(s, (20, y)); y += s.height + 20
    im.save(OUT / "overview.png")


sheets = [sheet(t, slug, rows) for t, slug, rows in CHARS]
overview(sheets)
print(f"wrote {len(sheets)} sheets + overview.png to {OUT.relative_to(ROOT)}")
