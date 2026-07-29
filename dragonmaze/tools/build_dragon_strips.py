#!/usr/bin/env python3
"""Assemble the 10 sliced dragon poses (art/dragon-poses/) into the 5 animation
strips the game uses, per the column mapping:

    col1  #1,#2  -> dragon-idle       (combat, faces the enemy)
    col2  #3,#4  -> dragon-fly        (overworld side / lateral move)
    col3  #5,#6  -> dragon-fly-down   (overworld toward camera)
    col4  #7,#8  -> dragon-fly-up     (overworld away from camera)
    col5  #9,#10 -> dragon-attack     (combat lunge)

Every strip is 2 equal SQUARE frames laid side by side (so the square sprite box
shows exactly one frame — a wide pose would otherwise be clipped). One global
frame size keeps the dragon's on-screen scale consistent across animations.

The side/idle/attack poses are drawn facing RIGHT; the pipeline authors side art
LEFT-facing (the overworld flips it for rightward moves; combat flips the dragon
to face the enemy column), so those get mirrored. The front (down) and back (up)
poses are symmetric and kept as-is.
"""
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import spritelib  # noqa: E402

POSES = ROOT / "art" / "dragon-poses"
SPR = ROOT / "assets" / "sprites"

# key -> (pose numbers, mirror-to-left?)
ANIMS = {
    "dragon-idle": ([1, 2], True),
    "dragon-fly": ([3, 4], True),
    "dragon-fly-down": ([5, 6], False),
    "dragon-fly-up": ([7, 8], False),
    "dragon-attack": ([9, 10], True),
}


def load(n):
    return Image.open(POSES / f"pose-{n:02d}.png").convert("RGBA")


poses = {n: load(n) for n in range(1, 11)}
S = max(max(p.size) for p in poses.values()) + 12  # one global square frame
print(f"frame size {S}x{S}")

for key, (nums, mirror) in ANIMS.items():
    strip = Image.new("RGBA", (S * len(nums), S), (0, 0, 0, 0))
    for i, n in enumerate(nums):
        p = poses[n]
        if mirror:
            p = p.transpose(Image.FLIP_LEFT_RIGHT)
        x = i * S + (S - p.width) // 2
        y = (S - p.height) // 2
        strip.alpha_composite(p, (x, y))
    strip.save(SPR / f"{key}.png")
    print(f"wrote {key}.png  {strip.size}  poses {nums}  mirror={mirror}")

spritelib.write_manifest(ROOT)
print("manifest refreshed")
