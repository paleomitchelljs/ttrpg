# Dragon Maze — UI reference (as implemented)

Dry, Claude-facing description of the current UI so future changes (new art,
new labels, new screens, restyle) are easy to locate. This documents **what
exists**, not goals. Update it when the UI structure changes.

Stack: self-contained vanilla HTML/CSS/ES-modules. No framework, no build-time
templating, no runtime deps. One HTML file, one stylesheet, a handful of render
modules driven by a state subscription. `build.mjs` inlines everything into
`dist/dragon.html` (also synced to `../public/dragon.html`); the dev server is
`node serve.mjs` (:8060, `Cache-Control: no-store`).

---

## 1. File map (UI-relevant)

| File | Role |
|---|---|
| `index.html` | The entire DOM: two screens + all overlays. Static skeleton; JS fills it. |
| `styles.css` | ~1400 lines. Design tokens + every component style. Shared with `editor.html`. |
| `src/main.js` | Wiring layer. Subscribes to `gameState`, maps game events → DOM, binds all input/buttons, owns the responsive breakpoint. |
| `src/render/ui.js` | Dumb DOM helpers: screens, overlays, HUD text, title, party panel, character sheet, result modal, explore log. |
| `src/render/mapView.js` | The dungeon grid: tiles, fog, autotiled walls/floors, decor props, the player token, tile sizing (`fitTile`). |
| `src/render/combatView.js` | Combat presentation: the dramatic event-replay queue, battle stage, action bar + submenus, dice cinematic, roll toast. |
| `src/render/hoardView.js` | Canvas draw of the hoard pile (side panel). |
| `src/render/autotile.js` | Pure geometry → tile-key picker; shared with the editor so both render identically. |
| `src/assets-manifest.js` | GENERATED. `SPRITES` and `TILES` maps: art key → `./assets/...png` path. |

Data files that feed the UI (read-only from the UI's view): `data/party.js`
(companions), `data/spells.js`, `data/items.js`, `data/consumables.js`,
`data/monsters.js`, `data/dragonProgression.js` (dragon tiers), `data/zones.js`
(`zone.name`/`zone.sub` shown in the breadcrumb), `data/familiars.js`,
`data/talents.js`.

---

## 2. Render loop (`src/main.js`)

`game.subscribe((state, events) => …)` is the single render entry point. Each
emit:

1. `ui.showScreen(state.screen)` toggles `#screen-title` / `#screen-game`.
2. On the title screen: `ui.updateTitle(state)` and return.
3. Otherwise it walks `events` and maps explore-time events to log lines /
   result modals (loot, tome, level-up, rested, robbed, surface-prompt,
   parley-offer, talk-open, portal-prompt, banked, retreat, …).
4. `combatBatch = run.phase === 'combat' || events include a combat event`.
   - Not combat → `refreshWorld(state)` (HUD, map, roster, hoard) and return.
   - Combat → `presentCombat(combatEls, state, events, handlers)`; the world/HUD
     refresh and any end-of-combat modal are deferred to `handlers.onBatchDone`
     (after the dice finish).

`refreshWorld` = `ui.updateHud` + `renderMap` + hoard canvas (hidden when
`hoardGold <= 0`) + `renderRoster`.

`combatEls` (built once at module load) points at the combat DOM by id:
`combat-enemies`, `combat-player`, `combat-target-info`, `combat-actions`,
`combat-log`, `combat-overlay`.

**Load-bearing invariant:** `main.js` binds handlers by element **id**. Any HTML
restructure must keep the ids (see §11). Buttons can move anywhere in the DOM as
long as the id survives.

---

## 3. DOM structure (`index.html`)

```
#app
├─ #screen-title .screen.title-screen
│  ├─ .title-logo (assets/bear-wren.png)  h1  .tagline
│  ├─ #title-menu → #btn-new, #btn-continue, #title-hoard, #btn-savedata
│  └─ #new-setup (hidden until "New")
│     ├─ .party-select → #btn-party, #party-summary
│     ├─ .zone-select → #zone-buttons(.zone-btn[data-zone]), #zone-sub, #zone-blurb
│     └─ .setup-actions → #btn-begin ("Descend"), #btn-setup-back
│
└─ #screen-game (hidden until a run starts)
   ├─ header#hud
   │  ├─ #hud-hp .hud-hp  (heart svg · .hp-track>.hp-track-fill · .chip-text)
   │  ├─ .hud-econ → #hud-carried .hud-chip.carried, #hud-hoard .hud-chip.hoard
   │  └─ #hud-menu → #hud-menu-btn (☰) + #hud-menu-pop[role=menu]
   │        .menu-item#btn-rest, #btn-savedata-ingame, #btn-quit(.danger)
   ├─ #hud-crumb  → #hud-tier(.crumb-btn, dragon sprite), #hud-loc, #hud-depth
   ├─ #playfield
   │  ├─ #map-frame → #map [ #map-grid, #map-props, #player-token ]
   │  └─ aside#side → #party-roster, #explore-log.log, .hoard-box[#hoard-canvas,#hoard-label], .help-note
   ├─ #combat-overlay .overlay → .combat-box
   │     .battle-stage[#combat-enemies.battle-enemies, #combat-player.battle-heroes]
   │     #combat-log.log.combat-log, #combat-target-info.target-info, #combat-actions.combat-actions
   ├─ #dpad → .dpad-btn.up/.left/.right/.down [data-dx,data-dy]
   └─ #result-overlay .overlay → .result-box[#result-title,#result-growth,#result-body,#result-actions]

Body-level overlays (siblings of #app, so they float above everything and are
reached by html.compact but NOT by #app-scoped rules):
  #sheet-overlay   .overlay → .result-box.sheet-box   [#sheet-body, #sheet-close]
  #party-overlay   .overlay → .result-box.party-box   [#party-count, #party-list, #btn-import/#import-file, #party-close]
  #savedata-overlay .overlay → .result-box.savedata-box [#export-box, #import-box, copy/download/upload buttons, #savedata-status, #savedata-close]
  #dice-cinematic  .dice-overlay  (filled by combatView.playCinematic)
  #roll-toast      .roll-toast    (filled by combatView.playToast)
```

Global rule: `[hidden] { display:none !important }` — because several elements
use author `display:flex`, which would otherwise beat the UA `[hidden]` style.
Keep it. Screens/overlays are shown/hidden by toggling the `hidden` attribute
(`ui.showScreen`, `ui.showOverlay`).

---

## 4. Design system (`styles.css`)

Section order in the file: tokens → base/type → buttons → title → HUD → map/tiles
→ sprites → props → side/roster/log → overlays/modal shell → battle stage/units →
sheets → party panel → save-data → combat action bar → zone/setup → d-pad →
compact layout → dice cinematic → roll toast.

### Tokens (`:root`)
- Surfaces: `--bg #100d15`, `--surface`, `--surface-2`, `--surface-3`, `--line`.
  Legacy aliases `--panel`→`--surface`, `--panel-2`→`--surface-2` (kept so the
  map/combat/dice rules that still say `var(--panel)` didn't need touching).
- Ink: `--ink`, `--ink-dim`, `--ink-faint`.
- Accents: `--gold` / `--gold-deep`, `--ember` / `--ember-deep`.
- Semantics: `--good` (heal/positive), `--hp`, `--mana` (spell purple),
  `--threat` (intimidate).
- Map terrain: `--wall`, `--floor`, `--floor-lit`, `--fog`.
- Type: `--font-display` (Iowan/Palatino/Georgia serif — headings + narrative),
  `--font-ui` (system-ui sans — HUD, buttons, stats, labels).
- Scale: `--space-1..6`, `--r-sm/md/lg/pill`, `--e-1`/`--e-2` (elevation),
  `--tap` (44px touch target).
- `--tile`: base cell size (also overwritten inline by `fitTile`).

`body` is `--font-ui`; `h1,h2,h3` are `--font-display`.

### Buttons
- `.btn` = **primary** (ember gradient, white). Used for every main CTA in the
  markup and by JS-built buttons (`ui.showResult` action buttons). Don't
  repurpose it as neutral.
- `.btn-big` (larger primary), `.btn-small` (neutral small: surface bg, `--line`
  border), `.zone-btn` (neutral pill — the other secondary style, also reused by
  Sheet / Import / equipment / advance buttons).
- `:focus-visible` → gold outline. `:disabled` → dim, no transform.

### Modal shell
`.overlay` = full-screen fixed backdrop (`rgba(6,4,10,.72)` + blur, `overlay-in`
fade). `.combat-box, .result-box` = the shared card (surface gradient, `--line`
border, `--e-2` shadow, `modal-pop` entrance). Every modal carries one of those
two classes; `.sheet-box`/`.party-box`/`.savedata-box` add `.result-box` and
just tweak width/alignment. Modal headings (`h2`) are `--gold`.

---

## 5. HUD (`index.html` + `ui.updateHud` + `main.js`)

`ui.updateHud(state)` fills, via the `chip(id,text)` helper (writes `.chip-text`)
and direct `textContent`:
- `#hud-hp`: `.hp-track-fill` width % + `.low` class + `.chip-text` = `cur/max`;
  toggles `.danger` on the pill when `cur ≤ ceil(max/3)`. Leader = dragon HP, or
  `party[0]` HP in party-only mode.
- `#hud-carried` (ember), `#hud-hoard` (gold) — economy chips.
- `#hud-crumb`: `#hud-tier` (tier label; also `#hud-loc` = `zone.name · zone.sub`
  or "The Labyrinth"; `#hud-depth` = `Depth N`).
- `#hoard-label` in the side panel.

**☰ menu** (`main.js`): `#hud-menu-btn` toggles `#hud-menu-pop` (sets
`aria-expanded`); any click inside the pop, an outside click, or Escape closes
it. The three items keep their original ids so their handlers are the existing
ones: `#btn-rest` → `game.rest()`, `#btn-quit` → `game.quitToTitle()`,
`#btn-savedata-ingame` → `openSavedata()` (shared with the title's `#btn-savedata`).

`#hud-tier` also opens the dragon sheet (`openSheet('dragon')`, bound in main.js).

---

## 6. Explore screen

### Map (`src/render/mapView.js`)
- `renderMap(container=#map, state)` rebuilds `#map-grid` every move: one `.tile`
  div per dungeon cell (`data-x/data-y`). Classes: `.fog` (unexplored — dim
  gridded), `.fog-dim` (glimpsed ring), `.wall`, `.floor`, `.door-tile`
  (`.door-leaf`), `.steppable` (adjacent walkable), `.edge-exit`/`.edge-e/w/n/s`
  (walk-off passage cue). **No scroll camera — the whole grid renders at once**;
  fog cells fill the unexplored area.
- Theming: `container.dataset.theme = d.theme`; CSS `#map[data-theme='…']` swaps
  floor/wall background images. Autotiled themes (`AUTOTILE[theme]` in
  `autotile.js`) instead paint per-cell wall/floor keys via `paintWall`/
  `paintFloor` (bitmask neighbour tests, N=1 E=2 S=4 W=8).
- Any cell can be **pinned** to a specific tile: `d.baseTiles["x,y"]` (authored in
  the editor, stored per subregion in `placements.js`) short-circuits
  `autotileKeyAt`, so the pickers are bypassed for that cell alone. Both
  `paintWall` and `paintFloor` go through `autotileKeyAt` for this reason.
- A theme may carry **two wall sets**: `wall` for the map's outer shell and
  `wallInner` for free-standing partitions, chosen per cell by `outerWalls(d)`
  (flood fill from the border through wall; a subregion's `wallStyle` overrules
  it). `floorEdge` gives floor that abuts an outer wall its own variant. All
  three are optional — a theme declaring only `wall` renders as it always has.
- `fitTile(container,d)` sets `--tile` (px) on `#map` so the grid fits: bounded
  by base clamp (`0.06·vmin`, 16–60), available **height**, AND available
  **width** (`#map-frame` clientWidth) — the width bound keeps a wide map from
  overflowing a phone. Token/props use `--tile`, so they scale with it.
- Contents (`fillTile`): an encounter cell shows the monster's idle strip (or
  emoji); a loot cell shows a coin glyph (or the courtyard gold-pile tile).
- `#player-token`: persistent absolutely-positioned sprite; `moveToken` glides it
  by `translate(x·100%, y·100%)`; `setFacing`/`facingFor` pick the walk strip and
  flip. z-index per row so tall props occlude it.
- `#map-props`: decor images (huts/statues/braziers) absolutely placed at
  `calc(--tile · x)`, sized in tiles, revealed with their anchor cell.
- **Do not add padding to `#map`** — props and the token are positioned from its
  top-left corner; padding would desync them from the grid.
- `bindMapClicks(#map, onTileClick)` → `game.moveTo(x,y)` on any `.tile` click.

### Side rail (`aside#side`)
- `#party-roster` built by `main.renderRoster(state)`: one `.roster-row` button
  per member (dragon + companions), each = sprite + `cur/max` + `.hp-bar` +
  optional "level up!" flag. Tap → `openSheet`. Face + HP only (name is on the
  sheet) to stay compact.
- `#explore-log.log`: narrative log. `ui.logExplore(text, cls?)` appends a `<p>`
  (classes: `log-hit`, `log-hurt`, `log-miss`, `log-dim`, `log-start`), trims to
  40 lines, autoscrolls. `.log` uses the serif font.
- `.hoard-box`: `#hoard-canvas` drawn by `hoardView.drawHoard(canvas, gold,
  tierIndex)` — seeded triangular coin mound, size steps at
  `HOARD_PILE_TIERS`, dragon perched on top (`assets/dragon-side.png`), sparkle
  on big piles. Canvas is `hidden` when `hoardGold <= 0`. `#hoard-label` below.

---

## 7. Overlays (`src/render/ui.js` + `main.js`)

All use the shared modal shell (§4). Opened/closed with `ui.showOverlay(id,bool)`.

- **Result** (`ui.showResult({title, body, growth?, actions})`): the generic
  prompt/outcome modal (`#result-overlay`). `actions` = `[{label,onClick}]` →
  `.btn` buttons. Optional `growth` block (image + gold text) for tier-up/robbed.
  Driven from `main.js` for banked/retreat/parley/talk/portal/surface/robbed.
- **Character sheet** (`ui.showCharacterSheet(subject)` → `#sheet-body`): head
  (sprite + name + blurb), `.sheet-vitals` (AC/HP + ability chips), Attacks,
  Fire Breath, Spells, Familiar, Renown, Traits, level-up **growth** block, and
  the **equipment** grid. `subject` is assembled by `main.sheetSubject(id)`
  (dragon vs `heroWithGrowth`). Growth/equipment interactions are delegated
  click/change handlers on `#sheet-body` in main.js (ability buttons
  `.advance-btn`, the grouped `.advance-select` + `.advance-confirm`, and
  `.equip-chip` click-to-equip).
- **Party panel** (`ui.renderPartyPanel(state)` → `#party-list`): the dragon
  card (togglable → `game.setMode`) + a `.party-card` per companion (checkbox,
  sprite, role/stats, spells, a `.party-card-sheet` "Sheet" button). Card click
  toggles membership; wiring in `main.js` (`#party-overlay` delegate).
- **Save data** (`#savedata-overlay`, wired entirely in main.js): export textarea
  + copy/download, import textarea + paste/file, `#savedata-status`.

---

## 8. Combat (`src/render/combatView.js`)

Combat logic resolves instantly in the engine; this module **replays** it.

- **Queue:** `presentCombat(els,state,events,handlers)` pushes a batch;
  `processBatches` drains sequentially. While replaying, actions are locked
  (`lockActions` shows a "The monsters act…" note). After a batch: if combat is
  still live, `renderCombat`; then `handlers.onBatchDone(events)`.
- **Beats:** `presentEvent` is a `switch(ev.type)` over ~50 event types. Each
  mutates the stage: adds transient classes (`lunging`, `hit-flash`,
  `heal-flash`, `dying`, `down`, `fleeing`, `breathing`, `scorched`) and updates
  a card's HP (`updateCardHp`). Dice-worthy events branch:
  - hero d20 → `playCinematic(payload)` (full-screen `#dice-cinematic`).
  - monster attack → `playToast(ev)` (corner `#roll-toast`).
- **Stage render:** `renderRoster` (instant, no handlers, used at combat-start)
  and `renderCombat` (interactive). `unitEl(c, side, activeId, hpAt?)` builds a
  `.unit` card: classes `unit / enemy|hero / dragon / inert familiar /
  dead|down / fled / active`; contents = `.hp-num`, optional luck badge,
  `faceHtml` (sprite or emoji `.enemy-face`), `.hp-bar>.hp-fill`, panic/flee
  badges, then `condBadges`. Enemy art mirrors via CSS (`.unit.enemy
  .combat-sprite`) unless `facesLeft` (`.no-mirror`); hero art is `.flip`ped to
  face right.
- **Condition chips** (`condBadges` → `.badge-conds > .badge-cond`): one chip per
  active condition, labelled and coloured by `COND_BADGE`
  (`.bad` red / `.good` green / `.held` violet / `.focus` gold), with the rounds
  left appended unless the condition is focus-held (those have no clock). A
  caster concentrating also gets a gold `focus` chip titled with the spell. Chips
  wrap under the HP bar rather than widening the card, and shrink in
  `html.compact`. Without these, a sleeping foe or a blessed weapon is invisible
  between log lines.
- **Targeting:** module-level `targetId` (enemy, `.targeted` ◆) and
  `heroTargetId` (ally heals, `.ally-targeted` ✚). Tap a unit to retarget →
  re-render. `#combat-target-info` shows a knowledge-gated one-liner
  (`targetInfoHtml`: "Unknown creature" → name+AC → +weaknesses at lore tier 2).
- **Action bar** (`renderActions` → `#combat-actions`): off-turn shows a
  `.turn-note`. On-turn builds an `.action-row` of `.btn.act-btn` variants:
  Strike/Bite, `.sweep-btn` (cleave talent), `.breath-btn` (dragon),
  `.spell-btn` (opens `SPELL_MENU` submenu), `.intimidate-btn`, an Item button
  (opens `ITEM_MENU`), and a `.flee-btn` below. A pending luck reroll swaps the
  row for Reroll/Keep (`.luck-btn`). `.act-btn.has-edge` = gold-glow "advantage".
  Action-verb colours come from `--mana` / `--threat` / martial-green / breath
  amber gradients. Submenus (`.spell-menu`) are a Back button + one small button
  per spell/item.
- Handlers passed from `main.js`: `onAttack`, `onBreath`, `onSweep`, `onCast`,
  `onUseItem`, `onIntimidate`, `onLuck`, `onDeclineLuck`, `onFlee` (window
  `confirm`), `onSheet`, `onBatchDone`.

### Dice cinematic (`playCinematic`, `#dice-cinematic`)
Builds `.dice-stage`: `.dice-title`, `.dice-target`, `.dice-tray` of `.dice-die`
(hex clip-path), advantage/disadvantage note, `.dice-parts` (modifier chips),
`.dice-total`, `.dice-verdict`. Timeline: spin → `settled` (shows roll, marks
`dropped`/`nat20`/`nat1`) → `.shown` on parts+total → verdict + `p.vclass` on
root. Tap (`root.onclick`) fast-forwards. Returns a Promise the queue awaits.

### Roll toast (`playToast`, `#roll-toast`)
Compact corner card for monster rolls: one small die + `.roll-toast-math`
(total, vs AC, verdict). ~1.5s, then hides.

---

## 9. Responsive / phone (`src/main.js` + `styles.css`)

- **`html.compact` is the single source of truth.** `main.js` `applyBreakpoint()`
  toggles it on `<html>` when `window.innerWidth <= 640` (or `?mobile`), on load
  and on `resize`. It lives on `<html>` **deliberately** so it also styles the
  body-level overlays (sheet/party/save-data), which are outside `#app`.
- **Compact CSS block** (`styles.css`, "compact layout" section): tighter HUD,
  `#playfield` becomes a vertical stack (map on top, full-width rail below, big
  `padding-bottom` for the d-pad), roster scrolls sideways, combat modal fills
  width, `.act-btn` gets `--tap` min-height, `.btn-big` goes full-width.
- **`?mobile` preview:** `main.js` adds `html.force-mobile`; CSS frames `<body>`
  to a 412px centred column with a `transform` (which makes body the containing
  block for the fixed overlays/d-pad, so modals sit inside the frame) and a huge
  box-shadow gutter. Purpose: preview the phone layout on desktop, because the
  browser-automation screenshot renders at a fixed ~1400px width regardless of
  window size. Inert without the `?mobile` param.
- **D-pad** (`#dpad`, `.dpad-btn`): shown when `html.compact`, on coarse-pointer
  devices (`@media (hover:none) and (pointer:coarse)`), or `body.show-dpad` (set
  in main.js when `'ontouchstart' in window`). Fixed bottom-right. Pointer
  handlers in main.js: tap to step, hold to repeat (220ms interval).
- Touch devices also get `min-height:var(--tap)` on `.btn/.zone-btn/.menu-item/
  .hud-menu-btn`.

---

## 10. Sprites & assets (`src/assets-manifest.js`)

- `SPRITES[key]` → `./assets/sprites/<key>.png`; `TILES[key]` →
  `./assets/tiles/…`. GENERATED by `tools/` — do not hand-edit. Character/monster
  art keys follow `<name>-idle` / `-attack` / `-walk` (+ `-down`/`-up`).
- Animation pattern: a `.sprite` clipping wrapper + inner `<img>` (N frames wide)
  stepped by CSS: `.sprite.f2` (`steps(2)`), `.sprite.f4` (`steps(4)`),
  `.sprite.static` (none). `.sprite.flip` = `scaleX(-1)`. Images are
  `image-rendering: pixelated`.
- `build.mjs` inlines only referenced assets as data URIs — an art key must be
  in the manifest AND referenced in code/data to ship.

---

## 11. IDs the JS binds (keep these on any restructure)

HUD/menu: `hud-hp` (+ `.hp-track-fill`, `.chip-text`), `hud-carried`,
`hud-hoard`, `hud-tier`, `hud-loc`, `hud-depth`, `hud-menu`, `hud-menu-btn`,
`hud-menu-pop`, `btn-rest`, `btn-quit`, `btn-savedata-ingame`.
Title/setup: `btn-new`, `btn-continue`, `btn-savedata`, `title-hoard`,
`title-menu`, `new-setup`, `btn-party`, `party-summary`, `zone-buttons`
(+`.zone-btn[data-zone]`), `zone-sub`, `zone-blurb`, `btn-begin`,
`btn-setup-back`.
Explore: `map`, `map-grid`, `map-props`, `player-token`, `party-roster`,
`explore-log`, `hoard-canvas`, `hoard-label`.
Combat: `combat-overlay`, `combat-enemies`, `combat-player`, `combat-log`,
`combat-target-info`, `combat-actions`.
Overlays: `result-overlay` (+`result-title/growth/body/actions`),
`sheet-overlay`/`sheet-body`/`sheet-close`, `party-overlay`/`party-list`/
`party-count`/`party-close`/`btn-import`/`import-file`,
`savedata-overlay` (+ export/import/copy/download/upload ids, `savedata-status`,
`savedata-close`), `dice-cinematic`, `roll-toast`.
Input: `dpad` (+`.dpad-btn[data-dx][data-dy]`).

---

## 12. Gotchas

- `[hidden]{display:none!important}` guard is required (author `display:flex`
  would otherwise win). Keep it.
- Element **ids are the contract** with `main.js`/`combatView.js`; move markup
  freely but preserve ids. Buttons relocated into the ☰ menu kept their old ids
  for exactly this reason.
- `--panel`/`--panel-2` are aliases of `--surface`/`--surface-2` — many
  map/combat/dice rules still reference them; changing the alias recolours those.
- The map is seamless (gap 0, no per-tile borders by design). Fog cells carry a
  faint inset grid line so unexplored area reads as dungeon, not a black box.
- No padding on `#map` (breaks token/prop alignment — see §6).
- `editor.html` shares `styles.css` — spot-check the editor after large CSS
  changes.
- `presentCombat` is fire-and-forget async; the world/HUD refresh waits for
  `onBatchDone` so HP numbers don't jump ahead of the dice.
