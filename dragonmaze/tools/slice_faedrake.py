"""Slice the fae drake pose sheet into familiar sprite strips.

`art/unprocessed/faedrake.png` is a 6-pose collage on a *gradient* plum-magenta
background (corner ~#852b6b at the top, ~#c34e9c at the bottom) -- NOT the flat
`is_bg` magenta the other tools assume, and close enough to the drake's own
purple body that a colour-distance key eats it. So this one keys with a
**gradient-following flood fill**: a pixel joins the background when it is
within `TOL` of an already-background *neighbour*, which crawls a smooth ramp
end to end but stops dead at the art's heavy black outlines.

Every pose faces RIGHT except the two on the left column; the strips are
normalised to face right (the hero-side convention `faceHtml` flips).

    python3 tools/slice_faedrake.py [--contact]
"""
import argparse
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from spritelib import write_manifest  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "unprocessed" / "faedrake.png"
POSES = ROOT / "art" / "faedrake-poses"
OUT = ROOT / "assets" / "sprites"
TOL = 26  # per-channel-ish distance a neighbour may drift and still be background
RIM_PASSES = 2  # anti-aliased plum rim left by the fill
RIM_TOL = 60
FRAME = 150  # square frame edge, matching the other 2-frame strips

# Where each pose's eye sits, so the frames of a strip animate around a fixed
# head instead of around their bounding boxes (the wings swing so wildly that a
# bbox-centred flap makes the drake jump). Detected, then eyeballed.
EYE = {1: (205, 42), 3: (240, 126), 4: (255, 177), 5: (250, 157), 6: (271, 39)}

# pose 5 = wings raised, pose 3 = wings spread and body rearing: the two ends of
# a wingbeat. Attack swoops: 4 = jaws open and claws forward, 6 = the dive.
STRIPS = {"fae-drake-idle": (5, 3), "fae-drake-attack": (4, 6)}
VEILED = (6,)  # poses carrying the source art's grey smear (see unveil)


def key_background(im):
    """Flood-fill the plum gradient to transparent, then eat the rim.

    The fill is seeded from every border pixel and compares each candidate to
    the *neighbour that reached it*, so it crawls a smooth ramp end to end but
    stops dead at the art's heavy black outlines.

    That leaves a 1-2px anti-aliased plum rim, which a plain colour key can't
    take off: the rim (25-55 from the background) overlaps the drake's own
    brightest purple highlights (~44 from it). What separates them is contact --
    a rim pixel touches the keyed background, a body highlight is fenced off by
    the black outline. So the rim passes only judge pixels adjacent to already-
    keyed ones, comparing them to the mean ORIGINAL colour of those neighbours
    (which also keeps the gradient honest). Each pass exposes more art-like
    pixels, so it converges on its own.
    """
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    orig = [px[x, y][:3] for y in range(h) for x in range(w)]
    bg = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not bg[y * w + x]:
                bg[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not bg[y * w + x]:
                bg[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        r0, g0, b0 = orig[y * w + x]
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < w and 0 <= ny < h) or bg[ny * w + nx]:
                continue
            r, g, b = orig[ny * w + nx]
            if abs(r - r0) + abs(g - g0) + abs(b - b0) <= TOL:
                bg[ny * w + nx] = 1
                q.append((nx, ny))

    for _ in range(RIM_PASSES):
        doomed = []
        for y in range(h):
            for x in range(w):
                i = y * w + x
                if bg[i]:
                    continue
                near = [
                    orig[(y + dy) * w + (x + dx)]
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                    if 0 <= x + dx < w and 0 <= y + dy < h and bg[(y + dy) * w + (x + dx)]
                ]
                if not near:
                    continue
                br = sum(c[0] for c in near) / len(near)
                bgn = sum(c[1] for c in near) / len(near)
                bb = sum(c[2] for c in near) / len(near)
                r, g, b = orig[i]
                if abs(r - br) + abs(g - bgn) + abs(b - bb) <= RIM_TOL:
                    doomed.append(i)
        if not doomed:
            break
        for i in doomed:
            bg[i] = 1

    for y in range(h):
        row = y * w
        for x in range(w):
            if bg[row + x]:
                px[x, y] = (0, 0, 0, 0)
    return im


def blobs(im, min_area=1500, scale=4):
    """Bounding boxes of the opaque islands, found on a downscaled mask so a
    hairline of anti-aliasing doesn't weld two poses together."""
    w, h = im.size
    sw, sh = w // scale, h // scale
    small = im.resize((sw, sh), Image.NEAREST)
    a = small.split()[3].load()
    seen = bytearray(sw * sh)
    out = []
    for sy in range(sh):
        for sx in range(sw):
            if seen[sy * sw + sx] or a[sx, sy] < 40:
                continue
            q = deque([(sx, sy)])
            seen[sy * sw + sx] = 1
            x0 = x1 = sx
            y0 = y1 = sy
            n = 0
            while q:
                cx, cy = q.popleft()
                n += 1
                x0, x1 = min(x0, cx), max(x1, cx)
                y0, y1 = min(y0, cy), max(y1, cy)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < sw and 0 <= ny < sh and not seen[ny * sw + nx] and a[nx, ny] >= 40:
                            seen[ny * sw + nx] = 1
                            q.append((nx, ny))
            if n * scale * scale >= min_area:
                out.append((x0 * scale, y0 * scale, (x1 + 1) * scale, (y1 + 1) * scale))
    out.sort(key=lambda b: (b[1] // 100, b[0]))
    return out


def trim(im):
    box = im.getbbox()
    return im.crop(box) if box else im


def unveil(im, strength=0.35, value=235):
    """Lift the grey wedge the source art paints over pose 6's lower wing.

    It behaves like a flat light veil composited over the wing, so it comes off
    by inverting that composite: `orig = (seen - t*value) / (1 - t)`. The region
    finds itself -- the drake is saturated everywhere (rainbow wings, purple
    hide, near-black outlines), so the one large mid-bright DESATURATED island
    is the blemish. Closing the island fills the parts of the veil that sit over
    colour (still saturated, so undetected), and a blur feathers its edge.
    """
    w, h = im.size
    px = im.load()
    flat = Image.new("L", (w, h), 0)
    fp = flat.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a >= 128 and max(r, g, b) - min(r, g, b) < 28 and 45 < (r + g + b) / 3 < 200:
                fp[x, y] = 255
    seen = bytearray(w * h)
    best = []
    for y in range(h):
        for x in range(w):
            if seen[y * w + x] or not fp[x, y]:
                continue
            q = deque([(x, y)])
            seen[y * w + x] = 1
            pts = []
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and fp[nx, ny]:
                            seen[ny * w + nx] = 1
                            q.append((nx, ny))
            if len(pts) > len(best):
                best = pts
    if len(best) < 200:
        return im
    veil = Image.new("L", (w, h), 0)
    vp = veil.load()
    for pt in best:
        vp[pt] = 255
    veil = (
        veil.filter(ImageFilter.MaxFilter(9))
        .filter(ImageFilter.MaxFilter(9))
        .filter(ImageFilter.MinFilter(9))
        .filter(ImageFilter.GaussianBlur(2))
    )
    vp = veil.load()
    for y in range(h):
        for x in range(w):
            t = strength * vp[x, y] / 255
            if t <= 0.01:
                continue
            r, g, b, a = px[x, y]
            px[x, y] = tuple(max(0, min(255, int((c - t * value) / (1 - t)))) for c in (r, g, b)) + (a,)
    return im


def build_strip(name, poses):
    """Lay poses out as equal SQUARE frames, registered on their eyes.

    Square because `.sprite` is `aspect-ratio: 1` -- a wide frame would show a
    slice of its neighbour. The canvas is grown until every pose fits around
    the shared eye point, so the head holds still and the wings do the moving.
    """
    left = max(EYE[n][0] for n in poses)
    right = max(poses[n].width - EYE[n][0] for n in poses)
    up = max(EYE[n][1] for n in poses)
    down = max(poses[n].height - EYE[n][1] for n in poses)
    side = max(left + right, up + down)
    ax = left + (side - left - right) // 2
    ay = up + (side - up - down) // 2
    strip = Image.new("RGBA", (side * len(poses), side), (0, 0, 0, 0))
    for i, n in enumerate(poses):
        ex, ey = EYE[n]
        strip.alpha_composite(poses[n], (i * side + ax - ex, ay - ey))
    strip = strip.resize((FRAME * len(poses), FRAME), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    strip.save(OUT / f"{name}.png")
    print(f"  {name}.png  {strip.size}  frames={list(poses)}  (source frame {side}px)")
    return strip


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", action="store_true", help="write docs/faedrake-poses.png")
    args = ap.parse_args()

    keyed = key_background(Image.open(SRC))
    boxes = blobs(keyed)
    print(f"{len(boxes)} poses found")
    POSES.mkdir(parents=True, exist_ok=True)
    poses = {}
    for i, box in enumerate(boxes, 1):
        p = trim(keyed.crop(box))
        if i in VEILED:
            p = unveil(p)
        poses[i] = p
        p.save(POSES / f"pose-{i:02d}.png")
        print(f"  pose-{i:02d}  box={box}  size={p.size}")

    for name, frames in STRIPS.items():
        build_strip(name, {n: poses[n] for n in frames})
    manifest, count = write_manifest(ROOT)
    print(f"manifest -> {manifest} ({count} assets)")

    if args.contact:
        poses = list(poses.values())
        pad = 12
        cw = max(p.width for p in poses) + pad
        ch = max(p.height for p in poses) + pad
        cols = 3
        rows = (len(poses) + cols - 1) // cols
        sheet = Image.new("RGBA", (cw * cols, ch * rows), (30, 30, 40, 255))
        for i, p in enumerate(poses):
            cx = (i % cols) * cw + (cw - p.width) // 2
            cy = (i // cols) * ch + (ch - p.height) // 2
            sheet.alpha_composite(p, (cx, cy))
        out = ROOT / "docs" / "faedrake-poses.png"
        sheet.save(out)
        print(f"contact sheet -> {out}")


if __name__ == "__main__":
    main()
