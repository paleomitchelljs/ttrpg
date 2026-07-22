# Editor → in-game → live: the update loop

The one-page routine for changing a map and getting it onto the site. The trap:
**saving in the editor is not the same as deploying.** The editor writes data
files; the live site serves a *pre-built* `public/dragon.html`. Miss the build
step and your edits are on disk but invisible in production.

```
 edit in editor  →  Save  →  npm run build  →  git commit + push  →  live
 (place/paint)      (data      (rebuilds        (main → Pages       (jonsmitchell.com
                    files)     public/dragon.html) deploy)            /ttrpg/)
```

## 1. Start the editor

```
cd dragonmaze
npm run editor            # opens http://localhost:8060/editor.html
```

## 2. Edit a region

Pick **Zone** + **Region** up top, then:

- **Paint base tile** — Floor / Wall / Start / Exit / Door. Click or drag. (Edits the map layout.)
- **Add to map** — Monster / Treasure / Boss / Mini. Click the brush, click the map.
- **Decor** — filter by tag, click a swatch, click to place. Drag to move; the
  right-hand **inspector** rotates/scales, swaps the tile, or pins a monster/item. `Del` deletes.
- **Fill many at once** — **Shift-click** or shift-drag to select tiles, then click
  any brush to stamp it into all of them. `Esc` clears.

## 3. Save — the step people forget

Click **Save**. The status line should read `Saved N region(s) ✓` (or `+ M map(s)`
if you painted layout). This writes:

- `data/placements.js` — where everything sits
- `data/maps.txt` / `data/maps.json` — readable dumps (auto)
- `data/zones.js` — **only if you painted** Floor/Wall/Start/Exit/Door

**If you reload or close the tab before Save, those edits are gone.** The editor
does not autosave.

## 4. Preview in the real game (dev)

The same server serves the game. Open **http://localhost:8060/** in another tab,
and **reload after each Save** (the dev server sends no-cache, so a plain reload
shows the new art). Pick the zone from the title screen and walk in.

## 5. Build the deployable game

```
cd dragonmaze
npm run build             # writes dist/dragon.html AND syncs ../public/dragon.html
```

This inlines the current data + assets into one file. `public/dragon.html` is the
file the live site actually serves — **if you skip this, the deploy ships the old
map.** (`npm run editor`/`dev` don't need it; only deploying does.)

## 6. Commit & push

```
# from the repo root
git add dragonmaze/data/placements.js dragonmaze/data/maps.txt dragonmaze/data/maps.json public/dragon.html
git add dragonmaze/data/zones.js          # only if you painted layout
git commit -m "Courtyard decor pass"
git push
```

Pushing to **main** triggers `.github/workflows/deploy.yml` (GitHub Pages) → the
site rebuilds and copies `public/dragon.html` out. Give it a couple of minutes.

## Checklist / gotchas

- **Save before you reload**, always.
- **Rebuild `public/dragon.html`** (step 5) or the live game won't change — this is
  the step that bites.
- **Every region needs ≥3 monsters and ≥1 treasure**, and the layout must stay
  connected (all floor reachable from `S`). If you painted layout, run `npm test`
  before pushing — it flood-fills every map and checks those counts. (Heads-up:
  `courtyard-sw` currently has no Treasure — drop one in with the Treasure brush.)
- **Repo is in Dropbox** — if `git` hangs, look for a stale `.git/index.lock` and
  keep `git add` scoped to the specific files above.
- Full editor reference (data model, endpoints, internals): [`editor-guide.md`](editor-guide.md).
