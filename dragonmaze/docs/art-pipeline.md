# Art pipeline — sprites & tiles

How hand-drawn art becomes animated characters and map tiles in Dragon Maze.
Read this before touching `art/`, `assets/`, `tools/`, or the editor.

There are **two pipelines**. Both take a source PNG in `art/`, cut pieces out,
key out a flat background, write PNGs under `assets/`, and regenerate one
generated file (`src/assets-manifest.js`). The game references the results by
string key.

```
                         art/*.png  (source sheets — hand-drawn, chroma background)
                             │
        ┌────────────────────┴────────────────────┐
   SPRITES (animated)                         TILES (map / decor)
        │                                          │
  crop_frames.py / slice_grid.py            slice_tiles.py  (+ the in-editor Slice mode)
        │                                          │
  assets/sprites/<name>-<anim>.png          assets/tiles/<name>.png
   (horizontal frame strips)                 (+ data/tile-tags.json: {sheet, box, tags})
        │                                          │
        └───────────────► src/assets-manifest.js ◄─┘   (GENERATED — never hand-edit)
              export const SPRITES = { key: path }
              export const TILES   = { key: path }
                             │
                    build.mjs inlines the referenced ones as data: URIs
                             │
        game refers to art by key:  SPRITES['spawnee-idle'],  TILES['courtyard-well']
```

## The magenta convention

Source sheets lay art on a **flat magenta chroma** (`rgb ≈ 255,0,255`) — between
poses on a sprite grid, or as the grid/gutters between tiles. Every tool treats
magenta (and its anti-aliased fringe) as background and keys it to transparent.
The single source of truth is `is_bg()` (duplicated, identically, in each tool):

```python
r > 180 and g < 95 and b > 180        # magenta + AA fringe
# ...plus alpha < 20 counts as background too
```

Some older sprite sheets use a **checkerboard** transparency backing instead of
magenta — `tools/dekey.py` flood-fills that out from the border.

---

## Sprites (animated characters)

A character has one **frame strip per animation** (`idle`, `attack`, `walk`,
`fly`, …): a horizontal PNG of N equal frames that the CSS animates with
`steps()`. Frame count shows up in markup as the class `f2` / `f4`.

- **`tools/crop_frames.py`** — for the fixed **768×1392, 5×9-cell** model sheets.
  Crops every cell with the same box so frames stay aligned, keys the
  background, assembles strips. `python3 tools/crop_frames.py [--contact out.png]`.
- **`tools/slice_grid.py`** — for **loose pose grids** (poses on magenta with wide
  gutters, placement not exact). Finds the all-background rows/columns and cuts
  on them, so the grid can drift and still slice. One grid **row → one strip**:
  `python3 tools/slice_grid.py art/foo-grid.png foo --rows idle attack walk [--flip] [--frame-height 150]`.
  `--flip` mirrors (model art faces right; the party faces left).

- **`tools/slice_faedrake.py`** — a one-off for `art/unprocessed/faedrake.png`,
  kept because its two tricks generalise to any sheet that isn't flat magenta.
  (1) The background is a *gradient* plum, and close enough to the drake's own
  purple that a colour key eats the art — so it flood-fills from the border
  comparing each pixel to **the neighbour that reached it**, then takes the
  leftover anti-aliased rim off with passes that only judge pixels *touching*
  the keyed background. (2) Frames are registered on a hand-listed **eye
  coordinate** rather than their bounding boxes, so the head holds still and the
  wings do the moving. It also carries `unveil()`, which lifts a grey smear the
  source art painted over one wing by inverting the composite.

Output lands in `assets/sprites/<prefix>-<anim>.png` and the manifest is
rewritten. The game then references e.g. `SPRITES['foo-idle']`. Wire a new
character by giving it `anim: { idle, attack }` (and `walk`) keys in its data
(`data/party.js`, `data/monsters.js`, or `data/familiars.js`) that match the
strip names.

Superseded art goes to `art/defunct/` (keep it out of the pipeline, keep history).

### 4-direction overworld walk

The overworld token faces its heading: the **side** strip (`<name>-walk`, or
`dragon-fly`) is used for left AND right (auto-flipped for right), and the
renderer (`facingFor` in `mapView.js`) looks for dedicated **`<key>-down`** and
**`<key>-up`** strips for those headings — falling back to the side strip when
they don't exist yet. So the game is already wired; it just needs the art.

- **What's missing:** `python3 tools/make_4dir_sheets.py` writes a reference
  sheet per character to `docs/4dir-sheets/` — existing side frames next to the
  empty DOWN (toward camera) and UP (facing away) slots that still need drawing.
  No character has down/up art today; all are side-view only.
- **To add it:** draw the down/up poses to match the side frames on a magenta
  grid (one row per direction), then slice with e.g.
  `python3 tools/slice_grid.py art/spawnee-4dir.png spawnee-walk --rows down up`
  → `spawnee-walk-down` / `spawnee-walk-up` (dragon: base `dragon-fly`). Rebuild
  and the token uses them automatically — no code change.

---

## Tiles (map walls, floors, decor, props)

A tile is a single cropped image plus a row in `data/tile-tags.json`:

```json
"courtyard-well": { "tags": ["structure"], "sheet": "courtyard-sheet.png", "box": [804, 505, 65, 63] }
```

`box` is `[x, y, w, h]` **into the source sheet** — the tile is the provenance,
so it can be re-cut later. `tools/slice_tiles.py` does the cutting:

- **Detect** (irregular prop sheets — statues, huts, wells scattered on magenta):
  `python3 tools/slice_tiles.py art/temple-exterior-sheet.png --detect` finds
  connected non-magenta blobs and writes a numbered overview (`--json` prints
  boxes). Then cut named ones: `--crop well=1224,724,244,268 …`.
- **Single tagged slice** (what the editor calls): `--name NAME --box X,Y,W,H
  --tags a,b` crops, keys magenta, writes `assets/tiles/NAME.png`, records the
  row in `tile-tags.json`, and refreshes the manifest.

Placed decor lives in `data/placements.js` as `{ key, x, y, w, h, rot }`; the map
renderer draws it with `TILES[p.key]` (`src/render/mapView.js`). So the loop is:
**slice → `TILES['name']` exists → editor places it → `placements.js` → rendered.**

Tags (`wall`, `floor`, `grass`, `prop`, `door`, `plant`, `treasure`,
`structure`, `statue`, `building`, `corner`, `light`, …) drive the editor
palette's filter — they're how a cut tile is findable next session. Keep names
descriptive and prefixed by sheet/area (e.g. `courtyard-wall-top`).

### Regular-grid sheets

Some sheets (like `courtyard-sheet.png`) are a **uniform tile grid** drawn with a
magenta grid overlay, one tile per cell. To integrate one:

1. Find the grid: scan for columns/rows that are mostly magenta — those are the
   grid lines; cells sit between them (courtyard = 14×8 of ~72px).
2. For each useful cell, take the **interior box** (inset ~4px past the magenta
   lines) so the tile is solid edge-to-edge with no seam. Slice + tag it.
3. **Gotcha:** a feature spanning **multiple cells** has a magenta grid line
   running through it; keying leaves a transparent stripe. Cut those by hand (or
   skip) — don't auto-slice across a grid line.

These are *scene* tiles: props carry their grass/wall background baked in (a
"chest" tile is a chest on grass), unlike the detect-style props which are
isolated on magenta and drop onto any floor.

### Outer vs internal wall sets

A theme can draw its perimeter differently from the partitions inside a room.
`src/render/autotile.js` decides which a cell is **from the geometry** (see
`outerWalls`): a wall reachable from the map border through other wall is
**outer**; a free-standing wall island is **internal**. No map is re-authored.
A subregion can overrule it with `wallStyle: 'inner' | 'outer'`.

The palace has the keys reserved and commented out in `AUTOTILE.palace` — the
pickers already route to them, so each one goes live the moment its tile exists:

| key | what it draws |
|-----|---------------|
| `wallInner.top/bottom/left/right` | partition with floor on that side |
| `wallInner.thinH` / `thinV` | a **one-cell-thick** run — floor on both opposite sides. New; the old edge pieces can't express it and drew a one-sided edge |
| `wallInner.iNW/iNE/iSW/iSE` | partition corner, named for where the wall body sits |
| `fallbackInner` | enclosed partition interior |
| `floorEdge.n/e/s/w` | floor that abuts an **outer** wall, named for the side the wall is on. Never used beside an internal wall — the outer sheet bakes the shell's shadow into this stone |

### Slicing a whole theme off one sheet

`tools/slice_palace_room.py` cuts the entire palace out of
`art/palace-room-sheet.png`, a finished 8×8 room: outer ring, two doors, cobble
floor, and internal wall runs. Taking every piece from one sheet is the point —
a wall tile bakes the floor into its floor-facing edge, so a floor cut from
anywhere else seams against it at every wall. The theme used to be stitched from
three sheets and did exactly that.

Two problems are worth knowing because they recur on any hand-drawn sheet.

**Arms that don't agree.** Hand-drawn wall runs vary: on this sheet anywhere
from 39% to 67% of a cell wide, with the centre wandering ±20px. Cut as drawn,
every corner-to-run join steps sideways and changes width. `normalise()` warps
each piece so its arms land on one shared band — a piecewise-linear resample
pinning `[0, lo, hi, N-1]` to `[0, TLO, THI, N-1]`, which moves the arm without
distorting the tile's border. The band is measured from the edges the wall
actually leaves through, so a corner gets corrected on both axes at once. Any
set where the pieces are drawn independently needs this.

**A truncated sheet.** This one's last column is 83px and last row 119px against
~145 elsewhere, so the ring's east and south are cut off. They come from
mirroring the west and north — exact for a symmetric ring, and better than
stretching a partial cell.

Where a sheet's *background* fights back rather than its geometry, see
`tools/slice_faedrake.py`: it flood-fills a gradient background by comparing
each pixel to the neighbour that reached it, and lifts a painted-on veil by
inverting the composite. A related trick, for grid rules drawn *through* the
art: inpaint them in two sequential passes, along x then along y. One averaged
pass cannot work — a rule's own row is entirely masked, so on that axis there is
nothing to interpolate from.

**Still unsliced:** nothing for the palace. The sewer theme is still the older
`sewer2-*` rotation set.

---

## The editor

`npm run editor` (or double-click `launch-editor.command`) starts `serve.mjs`
and opens `editor.html`. The server shells out to the Python tools and exposes:

| route | does |
|-------|------|
| `GET /sheets` | list `art/*.png` for the sheet picker |
| `GET /tiles` | list `assets/tiles/*` for the palette (joined with `tile-tags.json`) |
| `POST /detect` | run `slice_tiles.py --detect --json` on a sheet |
| `POST /slice` | run `slice_tiles.py --name/--box/--tags` — one tagged tile |
| `POST /save-placements` | write hand-placed decor back to `data/placements.js` |

**Slice mode workflow:** pick a sheet → Detect (outlines every blob) → click a
box or drag your own → name + tag it → Slice. The tile drops into the palette
immediately, categorised by its tags, no reload.

---

## Files & rules of the road

- `art/` — source sheets (magenta chroma). `art/defunct/` — superseded, ignored.
- `tools/` — `crop_frames.py`, `slice_grid.py` (sprites), `slice_tiles.py`
  (tiles), `dekey.py` (checkerboard), `spritelib.py` (shared: `is_bg`,
  `write_manifest`).
- `assets/sprites/`, `assets/tiles/` — generated PNGs.
- `data/tile-tags.json` — tile provenance + tags. `data/placements.js` — where
  decor sits on each map.
- `src/assets-manifest.js` — **GENERATED** (`SPRITES` + `TILES` maps). Never
  hand-edit; any tool run rewrites it via `spritelib.write_manifest`.
- `build.mjs` inlines only the *referenced* assets as data URIs into the
  single-file `public/dragon.html`, so unused strips cost nothing.

**Golden rule:** put art in `art/`, run a tool (or the editor), reference the
result by its string key. Don't hand-edit `assets-manifest.js`, and don't slice
a tile across a magenta line.
