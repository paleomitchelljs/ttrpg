# Reusable sprite-sheet generation prompt

Paste the prompt below into an image-generation AI, attach 1–2 reference
images (an existing sheet from `art/` for style, plus any character
reference), and replace the `{{...}}` placeholders. It encodes everything
`tools/crop_frames.py` needs to slice the result mechanically, and every
pitfall we have already hit with generated sheets.

---

## The prompt

> Create a pixel-art character sprite sheet in the exact style of the attached
> reference sheet. Subject: **{{CHARACTER DESCRIPTION — species, build, gear,
> palette, mood}}**.
>
> **Canvas and grid (strict):** one image, 768×1392 pixels, divided into a
> uniform grid of 5 columns × 9 rows (each cell ~154×155 px, thin 1 px dark
> border lines between cells). Do not merge, span, resize, or offset any cell.
> The character must be the same size in every cell, standing on the same
> baseline (feet at the same height within each cell), and must fit inside its
> cell with a small margin — nothing may cross a cell border.
>
> **Frame layout, row by row:**
> - Row 1: SIDE VIEW — ATTACK, 5 frames (windup, swing, impact, follow-through, recover)
> - Row 2: SIDE VIEW — MOVE, 4 frames (walk cycle), then SIDE IDLE frame 1
> - Row 3: SIDE IDLE frame 2, remaining cells empty background
> - Row 4: BACK VIEW — ATTACK, 5 frames
> - Row 5: BACK VIEW — MOVE, 4 frames, then BACK IDLE frame 1
> - Row 6: BACK IDLE frame 2, remaining cells empty background
> - Row 7: FRONT VIEW — ATTACK, 5 frames
> - Row 8: FRONT VIEW — MOVE, 4 frames, then FRONT IDLE frame 1
> - Row 9: FRONT IDLE frame 2, remaining cells empty background
>
> **Side view faces LEFT.** Idle frames are a matched pair (same pose, small
> breathing/weapon-bob difference) so they loop cleanly.
>
> **Background (critical):** every cell's background is one solid, flat,
> untextured color: **light neutral gray, hex #ABABAB**. NO transparency
> checkerboard pattern, no gradients, no floor shadows, no scenery props, no
> vignettes. The character must not contain large areas of that same gray.
>
> **Style:** crisp 1-pixel dark outlines, flat cel shading with 2–3 tones per
> material, no anti-aliasing against the background, no motion blur (motion
> arcs drawn as pixel streaks are fine), consistent palette across all frames,
> matching the attached reference sheet's scale and rendering style.
>
> **Labels:** small plain text under each used cell naming the frame (e.g.
> "SIDE ATTACK A1"), kept inside a narrow band at the bottom of the cell,
> never overlapping the artwork. No title cards, logos, watermarks, or
> annotation arrows anywhere.

---

## Why these constraints (pitfalls we hit)

- **"No checkerboard"** — generators bake fake transparency checkerboards
  into the pixels; a flat color keys out cleanly with `tools/dekey.py` /
  `crop_frames.py` border flood-fill.
- **"Same size, same baseline, strict grid"** — earlier sheets drifted scale
  between cells (a fly-cycle frame 2× the others) and shifted rows, forcing
  per-cell crop boxes.
- **"Labels in a narrow band"** — label text bleeding into the art shows up
  as debris in crops; annotation arrows ("160px") ruined frames on one sheet.
- **"Character must not contain the background color"** — a gray mace on a
  gray background got keyed to nothing.

## Importing a new sheet

1. Save it as `art/<name>-sheet.png` (768×1392 preferred; anything else needs
   a `SHEET_CELLS` entry or `abs` boxes in `tools/crop_frames.py`).
2. Add strips to `STRIPS` in `tools/crop_frames.py` — usually `<name>-idle`
   (the two side-idle cells) and `<name>-attack` (two side-attack cells);
   monsters need side or front view, party heroes use the side view.
3. `python3 tools/crop_frames.py --contact /tmp/contact.png` and eyeball the
   contact sheet; nudge crop boxes if a label or border leaked in.
4. Reference the strips from `data/monsters.js` / `data/party.js` via
   `anim: { idle: '<name>-idle', attack: '<name>-attack' }` — the manifest and
   build inlining pick them up automatically.
5. `npm test && npm run build`.
