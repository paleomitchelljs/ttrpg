#!/usr/bin/env python3
"""Remove a baked-in transparency checkerboard from sprite crops.

Flood-fills from the border: any connected run of light, low-saturation
pixels (the white/gray checker squares) becomes transparent. Interior light
pixels not connected to the border survive.
"""
import sys
from collections import deque
from PIL import Image


def is_bg(px):
    r, g, b = px[0], px[1], px[2]
    return max(r, g, b) - min(r, g, b) < 30 and (r + g + b) / 3 > 140


def dekey(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    pix = im.load()
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
    cleared = 0
    while q:
        x, y = q.popleft()
        r, g, b, _ = pix[x, y]
        pix[x, y] = (r, g, b, 0)
        cleared += 1
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_bg(pix[nx, ny]):
                seen[ny][nx] = True
                q.append((nx, ny))
    im.save(path)
    print(f"{path}: cleared {cleared}/{w*h} px")


for p in sys.argv[1:]:
    dekey(p)
