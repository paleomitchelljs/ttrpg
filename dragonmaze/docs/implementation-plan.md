# Implementation Plan — Red Dragon Labyrinth

A top-down, single-player browser dungeon-crawler. The player is a red dragon that raids procedurally generated labyrinths, fights monsters in turn-based combat, banks treasure into a persistent **hoard**, and advances through age tiers as the hoard grows. The emotional centerpiece (borrowed from the BBC "Big Al" growth mechanic) is a **visible hoard pile that grows** as the meter of progress.

This document is self-contained. You do not need any prior brief. Build **Phase 0 as a complete, playable vertical slice and stop for review** before starting Phase 1.

---

## 0. Hard constraints and guardrails

- **No runtime dependencies.** Vanilla HTML/CSS/JS only. No React, no game engine, no CDN scripts at runtime.
- **The only tooling allowed** is a dev build: `esbuild` for the single-file distributable, and a static server for local dev. Nothing else.
- **Two ship targets, one codebase:**
  - **Hosted** (primary): plain ES modules served over http(s), deployable to a static host (`jonsmitchell.com/dragon/`). This is how the kid actually plays; works on any device.
  - **Single-file** (secondary): `npm run build` bundles + inlines everything into one `dragon.html` that runs by double-click, offline. This exists because ES modules **do not load over `file://`** (browser CORS), so a raw multi-file build is not double-clickable.
- **Dev server:** `python3 -m http.server` or `npx serve`. Never assume `file://` works during development.
- **Determinism:** all world generation (maze, encounter placement, loot rolls) goes through a single **seeded** PRNG. Combat dice use a **separate, live** PRNG (fresh `Math.random`-backed). Never share the two.
- **Data-driven content:** monsters, loot, and dragon progression live in plain data objects/JSON, not in engine code. Adding a monster must not require touching combat logic.
- **Save safety:** every save carries a `version` field and passes through a `migrate()` function. Corrupt/unreadable saves must fall back to a fresh game inside a `try/catch`, never crash to a blank screen.
- **Placeholder-first art:** build with Unicode/emoji and colored CSS boxes so the game is fully playable before any art exists. Art swaps in later without code changes.

---

## 1. Resolved design decisions

These were open questions; they are now decided. Defaults chosen for a ~6–11-year-old player.

| Decision | Resolution |
|---|---|
| View | Top-down tile grid. |
| Map rendering (MVP) | **DOM CSS-grid of `<div>` tiles**, not canvas. Canvas is reserved for the hoard pile. |
| Maze type | **Braided** maze: recursive-backtracker, then remove ~40–50% of dead ends to add loops. Loot is seeded into surviving dead ends. |
| Death consequence | **Forced retreat** (default): at 0 HP the dragon flees, keeps all *banked* hoard, loses only *unbanked* loot from the current run. Persistent hoard never lost. `hardcore` toggle enables permadeath-of-run-loot. |
| Advancement | **Hoard-gated** tiers (gold thresholds). Defeated enemies drop gold that feeds the same meter; no separate XP system. |
| Combat depth (Phase 0) | To-hit (d20 + bonus vs AC), damage dice, HP only. No conditions, morale, spells, or breath in Phase 0. |
| Manual map input | Cut from Phase 0. Deferred to Phase 3. |
| Movement | One tile per input (arrow keys / WASD, plus click-adjacent-tile). Stepping onto a monster tile opens the combat overlay. |
| Fog of war | Reveal current tile + orthogonally adjacent tiles. Explored tiles stay dimly visible. |

---

## 2. Architecture

### 2.1 Source layout (development)
```
/src
  /engine
    dice.js          standalone dice primitive (no game deps)
    rng.js           seeded PRNG (world-gen) + live PRNG (combat)
    rules.js         all tunable constants + rule functions
    entities.js      combatant factory + schema
    combat.js        initiative, turn loop, resolveAttack, death/retreat
  /world
    maze.js          braided maze gen from seed; place start/encounters/exit
    encounters.js    roll room contents by depth/tier
    loot.js          roll treasure; guaranteed end-of-run hoard
  /render
    mapView.js       DOM grid, fog, player position
    hoardView.js     canvas hoard pile (the growth centerpiece)
    combatView.js    combat panel + log
    ui.js            menus, HUD, buttons
  /state
    gameState.js     single run-state object + transitions
    save.js          localStorage load/save, version, migrate, export/import
  main.js            wiring + game loop
/data
  monsters.js  treasure.js  dragonProgression.js
index.html
build.mjs            esbuild -> dist/dragon.html (inlined single file)
package.json
```
For the single-file target, `build.mjs` bundles `main.js` and inlines the result plus CSS into one HTML file.

### 2.2 Module responsibilities
- **dice.js** — `roll("2d6+1") -> {total, rolls, mod}`, `d20({advantage, disadvantage})`, `save(dc, bonus)`. **Zero game state, zero imports.** This module is designed to be lifted verbatim into a separate dice-roller tool, so keep its API clean and self-contained.
- **rng.js** — exports `makeSeededRNG(seedString)` (e.g. xmur3 hash → mulberry32) for world gen, and `liveRNG` for combat. `dice.js` takes an rng function as an optional argument, defaulting to `liveRNG`.
- **rules.js** — every tunable number and rule function in one place: attack resolution, tier thresholds, breath math (Phase 1), initiative rule, morale (Phase 1). Nothing elsewhere hard-codes a game constant.
- **entities.js** — one factory building any combatant (dragon, monster, ally) from a data object into the shared schema (§3.1).
- **combat.js** — initiative order, turn loop, `resolveAttack(attacker, target)`, HP/death, retreat. Pure logic; emits events the view renders. No DOM.
- **maze.js** — seeded braided maze; returns grid + start/exit/encounter/loot positions.
- **gameState.js** — the single source of truth (§3.3); exposes transitions (`enterLabyrinth`, `move`, `startCombat`, `resolveTurn`, `bankHoard`, `checkTierUp`).
- **save.js** — serialize/deserialize run + meta state; `version`, `migrate()`, `exportJSON()`, `importJSON()`, corrupt-save fallback.

Keep **logic modules DOM-free** and **view modules logic-free**; views read state and render, and raise intents back to `gameState`.

---

## 3. Data model

### 3.1 Combatant (shared schema)
```json
{
  "id": "trl-01",
  "name": "Cave Troll",
  "kind": "monster",
  "ac": 14,
  "hp": { "current": 22, "max": 22 },
  "abilities": { "str": 3, "dex": 0, "con": 2, "int": -2, "wis": 0, "cha": -1 },
  "attacks": [
    { "name": "Claw", "toHit": 5, "damage": "1d8+3", "range": "melee" }
  ],
  "special": [],
  "conditions": [],
  "sprite": "monster_troll",
  "goldValue": 40
}
```
`abilities` are modifiers in roughly −4..+4. `goldValue` is what the enemy contributes to the hoard when defeated.

### 3.2 Dragon progression tier
```json
{
  "tier": "young",
  "hoardToNext": 5000,
  "hpMax": 30,
  "ac": 15,
  "attacks": [ { "name": "Bite", "toHit": 6, "damage": "1d10+4", "range": "melee" } ],
  "breath": { "damage": "3d6", "dc": 13, "recharge": "d6>=5" },
  "sprite": "dragon_young"
}
```

### 3.3 Run + meta state
```json
{
  "version": 1,
  "meta": {
    "hoardGold": 1234,
    "tier": "young",
    "customCharacters": [],
    "settings": { "hardcore": false, "sound": false }
  },
  "run": {
    "dragon": { "tier": "young", "hp": { "current": 30, "max": 30 } },
    "party": [],
    "unbankedGold": 0,
    "dungeon": { "seed": 88421, "grid": [], "explored": [], "playerPos": {"x":1,"y":1}, "exitPos": {} },
    "phase": "explore",
    "log": []
  }
}
```
`meta` persists across runs; `run` is discarded/rebuilt each labyrinth. On forced retreat, `run.unbankedGold` is dropped (or kept, if `hardcore` is off and you decide retreat banks a fraction — default: drop unbanked, keep banked).

---

## 4. Phase 0 — the vertical slice (build this, then stop)

**Definition of done: a person can play a full loop and quit, and their hoard is still there next time.**

Scope:
1. Title screen → New Game / Continue (Continue only if a valid save exists).
2. One dragon at fixed **wyrmling** stats. No tier-up yet (stub the check).
3. Generate one braided maze from a seed. Place start, exit, 3–5 encounters, loot in dead ends.
4. Top-down DOM grid with fog (reveal current + adjacent, explored stays dim).
5. Move with arrows/WASD and click-adjacent. Bump a monster tile → combat overlay.
6. Turn-based combat vs **3 monster types**: initiative, to-hit vs AC, damage, HP, win/lose. Readable log ("Your claws rake the goblin for 7!").
7. Loot on victory adds to `unbankedGold`. Reaching the exit **banks** everything into `meta.hoardGold`, shows a win screen, offers next labyrinth.
8. 0 HP → forced-retreat screen (keep banked, drop unbanked), back to title.
9. Hoard shown as a number **and** a tiered pile image swapped at gold thresholds (canvas or a few placeholder images — 4 tiers is enough).
10. Save/load via localStorage with `version` + corrupt-save fallback.

**Phase 0 acceptance checklist:**
- [ ] Double-click `dist/dragon.html` runs offline with no console errors.
- [ ] Hosted build runs over `python3 -m http.server` with no console errors.
- [ ] Same seed produces the same maze every time; combat outcomes vary.
- [ ] A full loop (enter → fight → loot → exit → bank) completes; hoard number and pile both increase.
- [ ] Quitting and reloading restores `meta.hoardGold`.
- [ ] Deleting/corrupting the save key starts a fresh game instead of a blank/broken screen.
- [ ] Losing all HP returns to title with banked hoard intact and unbanked loot gone.
- [ ] `dice.js` has a tiny test that rolls each die type 10k times and asserts min/max/mean are in range.

---

## 5. Later phases (specified, gated)

- **Phase 1 — Growth & depth:** hoard-gated tier-ups (wyrmling→young→adult→ancient) with stat jumps and a growth animation on the hoard; breath weapon (area save-for-half, recharge); advantage/disadvantage; full 8–15 monster roster; encounter + loot tables scaling by depth/tier; monster morale.
- **Phase 2 — Characters & party:** custom-character entry (form + JSON import/export, reusing `save.js` serialization); party members under single control; hotseat turn-taking; procedural canvas hoard (sprite atlas of coins/gems/crown accumulating as gold rises).
- **Phase 3 — Polish:** art pass; audio (dice, hit/miss, roar, breath whoosh, coin clink, victory sting); labyrinth biomes; difficulty scaling; multiple save slots; manual-map input mode.

---

## 6. Starter content (author these so Phase 0 is playable, then tune)

All numbers are illustrative and tunable in `data/` + `rules.js`. These are original values in the spirit of a rules-light d20 system; do not copy any rulebook text.

**Dragon tiers**

| tier | hoardToNext | hpMax | ac | bite toHit | bite dmg | breath (Ph1) |
|---|---|---|---|---|---|---|
| wyrmling | 1000 | 18 | 13 | +4 | 1d8+2 | 2d6, dc11 |
| young | 5000 | 30 | 15 | +6 | 1d10+4 | 3d6, dc13 |
| adult | 20000 | 52 | 18 | +9 | 2d8+6 | 5d6, dc16 |
| ancient | — | 90 | 20 | +13 | 2d10+8 | 8d6, dc19 |

**Monster roster (start with 5; first 3 are the Phase-0 set)**

| name | ac | hp | attack | dmg | goldValue |
|---|---|---|---|---|---|
| Goblin | 12 | 6 | +3 | 1d6+1 | 8 |
| Giant Rat | 11 | 4 | +2 | 1d4+1 | 3 |
| Skeleton | 13 | 9 | +4 | 1d6+2 | 10 |
| Cave Troll | 14 | 22 | +5 | 1d8+3 | 40 |
| Orc Raider | 13 | 12 | +4 | 1d8+2 | 18 |

**Loot table (feeds unbankedGold)**

| roll d6 | reward |
|---|---|
| 1–2 | small coins (2d10 gold) |
| 3–4 | gems (3d10 gold) |
| 5 | fine item (5d10 gold) |
| 6 | treasure chest (10d10 gold) |

Guaranteed end-of-labyrinth hoard: `50 + depth * 25` gold on top of whatever was collected.

---

## 7. Rendering & UX notes

- **Map:** CSS grid, one `<div>` per tile, emoji/color placeholders — 🐉 dragon, 🧌/💀/🐀 monsters, 💰 loot, ⬛ wall, ⬜ floor, 🚪 exit, fog = dark tile. Keyboard + click movement.
- **Hoard (centerpiece):** canvas. Phase 0 can swap 4 tiered pile images at gold thresholds (empty floor → small pile → mound → dragon-on-a-mountain). Phase 2 upgrades to a procedural accumulating pile.
- **Combat panel:** turn order, both HP bars, big readable dice results, a scrolling narrated log in plain language.
- **Readability for a young player:** large font, high contrast, short sentences in the log, optional dyslexia-friendly font toggle. Sound off by default.

---

## 8. Licensing note (for publishing only)

Game *mechanics* (d20-vs-AC, damage dice, HP, initiative) are not copyrightable and are free to implement. Do **not** paste rulebook prose, and do not brand the product with the source system's name. For private play with family, none of this matters. If it's ever published, confirm the source system's third-party license terms first and paraphrase all flavor text.

---

## 9. Handoff instructions for the coding session

1. Scaffold the repo per §2.1 with placeholder art (§7) and the guardrails in §0.
2. Implement `dice.js` + `rng.js` first, with the dice test from §4.
3. Build the Phase-0 vertical slice (§4) end to end. Keep logic modules DOM-free.
4. Wire both build targets (`npm run dev` static server; `npm run build` → `dist/dragon.html`).
5. Verify every box in the §4 acceptance checklist.
6. **Stop and report** with the running slice and the seed used, before touching Phase 1.
