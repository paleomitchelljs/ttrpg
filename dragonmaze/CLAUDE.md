# Dragon Maze (Red Dragon Labyrinth)

Self-contained vanilla HTML/CSS/ES-module dungeon crawler under `dragonmaze/` —
no framework, no runtime deps. `node serve.mjs` runs the dev server (:8060,
no-store). `node build.mjs` inlines everything into `dist/dragon.html` and syncs
`../public/dragon.html` (the committed, deployed bundle — **rebuild before
committing UI changes or Pages ships stale**). `npm test` = dice/combat/data-edit.

## Docs

- **Gameplay:** [`docs/gameplay.md`](docs/gameplay.md) — dry, current-state map of
  the game **mechanics** (state model, exploration, dice, combat, magic, items,
  progression, factions) and which file owns each. **Read this before changing
  anything rules-facing** — it's the fast way to load the engine/state/data
  layout without re-reading the source.
- **UI:** [`docs/ui-reference.md`](docs/ui-reference.md) — dry, current-state map
  of the whole UI (DOM in `index.html`, the `styles.css` design system, the
  `src/render/*` modules, HUD/menu, explore/combat/overlays, the `html.compact`
  responsive system + `?mobile` preview, sprites, and the element ids `main.js`
  binds to). **Read this before changing anything UI-facing.**
- **Monsters:** [`docs/monster-making.md`](docs/monster-making.md) — the design
  philosophy behind a Shadowdark monster and the procedure for adding one to
  `data/monsters.js`. **Read this before writing a new stat block.**
- Art pipeline: [`docs/art-pipeline.md`](docs/art-pipeline.md).
- Zone editor: [`docs/editor-guide.md`](docs/editor-guide.md).

**Keep these current.** When a change touches game mechanics, update
`docs/gameplay.md`; when it touches UI structure/DOM/CSS, update
`docs/ui-reference.md`. Both are strictly current-state descriptions — no history,
no goals, no changelog. Describe how the game works *now* and where each mechanic
lives (file, and the function/section within it). Update the affected sentences in
place rather than appending notes.
