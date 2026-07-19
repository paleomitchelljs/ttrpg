# Red Dragon Labyrinth

A top-down, single-player browser dungeon crawler. You are a red dragon raiding
procedurally generated labyrinths: explore under fog of war, fight monsters in
turn-based d20 combat, carry loot to the exit, and bank it into a persistent
hoard that visibly grows. No frameworks, no runtime dependencies — vanilla
HTML/CSS/JS ES modules.

Current status: **Phase 1 — growth & depth** (see `docs/implementation-plan.md`):
hoard-gated tier-ups (wyrmling→young→adult→ancient), fire breath with a d6
recharge (area save-for-half), advantage vs panicked prey, a 13-monster roster,
depth-scaled encounters and loot, and monster morale (failed courage checks
mean fleeing monsters — and fled monsters keep their gold).

## Run it

```sh
npm run dev        # serves at http://localhost:8060 (ES modules need http, not file://)
npm test           # dice + determinism tests
npm run build      # bundles everything into dist/dragon.html (double-clickable, offline)
```

The dev server (`serve.mjs`) sends `Cache-Control: no-store` — browsers
otherwise heuristically cache ES modules and can run a mix of stale and fresh
files after an edit.

`build.mjs` resolves `esbuild` from the parent repo's `node_modules`; no install
needed inside this folder.

Append `?seed=anything` to the URL to force a specific labyrinth seed.

## Layout

- `index.html`, `styles.css` — shell and theme
- `src/engine/` — dice, RNG (seeded world-gen + live combat), rules, entities, combat
- `src/world/` — braided maze generation, encounters, loot
- `src/state/` — game state transitions, localStorage save/migrate
- `src/render/` — map grid, hoard canvas, combat overlay, HUD/screens
- `data/` — monsters, treasure table, dragon progression (data only, no logic)
- `assets/` — runtime sprites cropped from `art/` (the build inlines them as
  data URIs); `tools/dekey.py` strips the baked-in transparency checkerboard
  from new crops (`sips --cropOffset Y X -c H W sheet.png --out crop.png`,
  then `python3 tools/dekey.py crop.png`)
- `docs/implementation-plan.md` — full phased plan (Phase 0 scope, later phases)
- `art/` — generated sprite sheets (red dragon player, froglok + lizardfolk
  warriors, dragonkin knight, blue kobold animation sheet); not yet wired into
  the game (Phase 0 is emoji-placeholder art by design)
- `art/reference/` — pixel-art style reference (TESIV Oblivion monster sheet)
- `dungeons/` — two 5e dungeons (Lost Temple of Cazic-Thule, Ruins of Guk) kept
  as candidates for hand-authored map conversion in a later phase
