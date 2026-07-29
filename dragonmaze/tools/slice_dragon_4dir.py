#!/usr/bin/env python3
"""One-off: slice the gray-background red-dragon pose sheet into 10 keyed poses.

The sheet (art/red-dragon-4dir-grid.png) is a 2-row x 5-col grid of red dragons
on a flat blue-gray background (~188,191,199) instead of the usual magenta. We
key it by flood-filling the background inward from the borders, so gray parts
INSIDE a dragon (horns, claws) survive. Then split on the empty gutters and crop
each pose's bounding box.

Writes numbered poses to art/dragon-poses/ and a labeled contact sheet
(docs/dragon-poses.png) so the pose->animation mapping can be confirmed before
anything in assets/ is replaced.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "art" / "red-dragon-4dir-grid.png"
POSES = ROOT / "art" / "dragon-poses"
POSES.mkdir(parents=True, exist_ok=True)

im = Image.open(SRC).convert("RGB")
w, h = im.size

# Kill the little decorative sparkle in the bottom-right so it doesn't read as an
# 11th blob / corrupt the gutter detection. It sits below the dragon rows.
px = im.load()
for yy in range(int(h * 0.80), h):
    for xx in range(int(w * 0.88), w):
        px[xx, yy] = (188, 191, 199)

# Flood-fill the background from every border seed toward the interior.
mark = im.copy()
seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
         (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
for s in seeds:
    ImageDraw.floodfill(mark, s, (255, 0, 255), thresh=48)
a = np.array(mark)
flood_bg = (a[:, :, 0] == 255) & (a[:, :, 1] == 0) & (a[:, :, 2] == 255)
# The border flood can't reach background trapped in a concavity (between a wing
# and the neck, say) — flat gray and its soft shadow, enclosed by the dragon,
# read as white holes. They're all NEUTRAL and BRIGHT; the dragon's own neutral
# bits (horns, claws) are neutral but DARK, and its body is saturated red. So key
# any pixel that's low-saturation and bright, whatever its exact gray.
orig = np.array(im).astype(int)
spread = orig.max(axis=2) - orig.min(axis=2)
bright = orig.mean(axis=2)
gray_bg = (spread < 24) & (bright > 118)
bg = flood_bg | gray_bg
fg = ~bg

rgba = np.dstack([np.array(im), np.where(bg, 0, 255).astype("uint8")])
keyed = Image.fromarray(rgba, "RGBA")


def bands(profile, occ=20, min_gut=14, min_band=25):
    """Split a 1-D occupancy profile into content bands.

    A column/row counts as occupied when its foreground pixel count exceeds
    `occ`. Occupied runs separated by a gap narrower than `min_gut` are merged
    (so a thin internal feature — a horizontal tail, a wingtip dip — doesn't
    fragment one dragon), while a real inter-pose gutter (wide low region, even
    if a few pixels bridge it) still splits. Bands narrower than `min_band` are
    dropped as noise.
    """
    occd = [v > occ for v in profile]
    runs, s = [], None
    for i, v in enumerate(occd):
        if v and s is None:
            s = i
        elif not v and s is not None:
            runs.append([s, i]); s = None
    if s is not None:
        runs.append([s, len(occd)])
    if not runs:
        return []
    merged = [runs[0]]
    for r in runs[1:]:
        if r[0] - merged[-1][1] < min_gut:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [tuple(r) for r in merged if r[1] - r[0] >= min_band]


def zones(spans, length):
    """Turn occupied spans into a full partition, cutting at each gutter's
    CENTER. Each zone then contains one dragon plus the empty half-gutter on
    either side — so thin extremities (a head, a wingtip) that reach into the
    gutter are kept, not trimmed off with the occupied core."""
    cuts = [0]
    for a, b in zip(spans, spans[1:]):
        cuts.append((a[1] + b[0]) // 2)
    cuts.append(length)
    return list(zip(cuts, cuts[1:]))


col_spans = bands(fg.sum(axis=0))
row_spans = bands(fg.sum(axis=1))  # global rows, so a chopped head can't hide
print("col spans:", col_spans, " row spans:", row_spans)
col_zones = zones(col_spans, w)
row_zones = zones(row_spans, h)

def drop_specks(mask, min_area=40):
    """Zero out tiny connected components (a neighbour's wingtip that crossed a
    narrow gutter), keeping every substantial part — so a wing that keying left
    slightly disconnected is NOT dropped, only true specks are."""
    from collections import deque
    H, W = mask.shape
    seen = np.zeros_like(mask, bool)
    out = mask.copy()
    for sy in range(H):
        for sx in range(W):
            if mask[sy, sx] and not seen[sy, sx]:
                q = deque([(sy, sx)]); seen[sy, sx] = True; comp = [(sy, sx)]
                while q:
                    y, x = q.popleft()
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx)); comp.append((ny, nx))
                if len(comp) < min_area:
                    for y, x in comp:
                        out[y, x] = False
    return out


# Each cell = one column zone x one row zone; crop the true alpha>0 bbox inside.
poses = []  # (col_index, row_index, PIL image)
for ci, (x0, x1) in enumerate(col_zones):
    for ri, (y0, y1) in enumerate(row_zones):
        cell = drop_specks(fg[y0:y1, x0:x1])
        ys, xs = np.where(cell)
        if len(xs) == 0:
            continue
        bx0, bx1 = x0 + xs.min(), x0 + xs.max() + 1
        by0, by1 = y0 + ys.min(), y0 + ys.max() + 1
        crop = keyed.crop((bx0, by0, bx1, by1))
        # also blank any speck pixels inside the crop box (in case a speck shared
        # the bbox but not the kept mask)
        cm = drop_specks(np.array(crop)[:, :, 3] > 0)
        arr = np.array(crop); arr[~cm, 3] = 0
        poses.append((ci, ri, Image.fromarray(arr, "RGBA")))

print(f"found {len(poses)} poses across {len(col_zones)} columns")

# number: col-major, row 1 then row 2 within each column (1..10)
poses.sort(key=lambda p: (p[0], p[1]))
labels = []
for n, (ci, ri, img) in enumerate(poses, 1):
    fn = POSES / f"pose-{n:02d}.png"
    img.save(fn)
    labels.append((n, ci, ri, img))
    print(f"pose {n:2d}  col{ci+1} row{ri+1}  {img.size}")

# ---- labeled contact sheet ------------------------------------------------
BG, PANEL, INK, DIM = (26, 23, 34), (46, 43, 56), (222, 217, 233), (150, 143, 170)


def font(sz, bold=False):
    for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
              else "/System/Library/Fonts/Supplemental/Arial.ttf"]:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


F_T, F_L, F_S = font(26, True), font(16, True), font(13)
CELL, GUT, PAD, HEAD = 200, 16, 26, 92
ncol = len(col_zones)
W = PAD * 2 + ncol * CELL + (ncol - 1) * GUT
H = PAD + HEAD + 2 * (CELL + 34) + GUT + PAD
sheet = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(sheet)
d.text((PAD, PAD), "Red Dragon — 10 poses (gray sheet, keyed)", INK, font=F_T)
d.text((PAD, PAD + 38),
       "col-major numbering · confirm which map to idle / attack / fly-side / fly-down / fly-up",
       DIM, font=F_S)


def fit(img, box):
    s = min(box / img.width, box / img.height, 1.0)
    r = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    c = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    c.alpha_composite(r, ((box - r.width) // 2, (box - r.height) // 2))
    return c


gy = PAD + HEAD
for n, ci, ri, img in labels:
    cx = PAD + ci * (CELL + GUT)
    cy = gy + ri * (CELL + 34)
    sheet.paste(PANEL, (cx, cy, cx + CELL, cy + CELL))
    d.rectangle([cx, cy, cx + CELL, cy + CELL], outline=(70, 66, 84))
    cell = fit(img, CELL)
    sheet.paste(cell, (cx, cy), cell)
    d.text((cx + 6, cy + CELL + 6), f"#{n}", INK, font=F_L)
    d.text((cx + 40, cy + CELL + 8), f"col{ci+1} · row{ri+1}", DIM, font=F_S)

out = ROOT / "docs" / "dragon-poses.png"
sheet.save(out)
print("wrote", out.relative_to(ROOT))
