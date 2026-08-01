# Dragon Maze (Red Dragon Labyrinth)

Self-contained vanilla HTML/CSS/ES-module dungeon crawler under `dragonmaze/` —
no framework, no runtime deps. `node serve.mjs` runs the dev server (:8060,
no-store). `node build.mjs` inlines everything into `dist/dragon.html` and syncs
`../public/dragon.html` (the committed, deployed bundle — **rebuild before
committing UI changes or Pages ships stale**). `npm test` = dice/combat/data-edit.

## Docs

- **UI:** [`docs/ui-reference.md`](docs/ui-reference.md) — dry, current-state map
  of the whole UI (DOM in `index.html`, the `styles.css` design system, the
  `src/render/*` modules, HUD/menu, explore/combat/overlays, the `html.compact`
  responsive system + `?mobile` preview, sprites, and the element ids `main.js`
  binds to). **Read this before changing anything UI-facing**; update it when the
  UI structure changes.
- Art pipeline: [`docs/art-pipeline.md`](docs/art-pipeline.md).
- Zone editor: [`docs/editor-guide.md`](docs/editor-guide.md).
