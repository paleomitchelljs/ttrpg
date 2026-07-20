# Feedback queue — to incorporate next

Captured 2026-07-19 from playtest feedback. Ordered roughly by dependency.
New art already saved to `art/` (see bottom); nothing below is wired in yet.

## 1. Zone progression & the "delve deeper" door

- Bespoke zones (The Lost Temple, Upper/Lower Guk) should **not** offer
  "Delve deeper" (which starts a fresh *procedural* labyrinth) on the win
  screen. In a zone, the *regions* are the depth. Reaching a surface exit in a
  zone should bank and return to the title (or offer "return to this zone"),
  not spawn a random maze.
- Give the set dungeons **clear level progression** across their regions
  (difficulty already climbs; make it legible — e.g. show region tier).
- **Rename `cazic-thule` → "The Lost Temple"** everywhere: the zone `name` is
  already "The Lost Temple" but the zone **id** is still `cazic-thule`, the
  title-screen button still reads "Cazic-Thule" (`index.html` zone-buttons),
  and item `zone: 'cazic-thule'` tags reference it. Migrate the id (or add an
  alias) and update the button label. Watch `data/items.js`, `data/zones.js`,
  `src/render/ui.js`, and any test referencing the id.

## 2. Doors (the region connectors)

- Should look like **actual doors**, and sit **offset into the walls**, not as
  floor tiles you stand on. (Today they're floor tiles marked `1`-`9` rendered
  with a ◆/⌂ glyph.)
- **Persistent placement logic**: walking *right* into a door should deposit
  you at the *matching* door on the *left* edge of the next region (entering
  from the correct side), not at that region's `S`. Give each door a paired
  entry point in its destination; arrive there facing onward. This means
  door records need a `side`/`entry` and destinations need a labeled arrival
  tile, not a single `start`.

## 3. Region bosses (each region gets one)

Current bosses vs. requested:

| Region                     | Boss                    | Mini-boss |
|----------------------------|-------------------------|-----------|
| Overgrown Courtyard        | Stone Golem (already ✓) | —         |
| Maze of Ten Thousand Doors | **Clay Golem**          | —         |
| Sewers & Green Gumdrop     | **Iron Golem**          | —         |
| Archon Pyramid             | **Lizardman Archon**    | **Crusader** |
| Temple-Palace              | **Templar**             | —         |
| Summoning Chamber          | **Avatar of Fear** (zone boss) | — |

- Need new monsters: Clay Golem, Iron Golem, Lizardman Archon, Crusader
  (mini-boss), Templar, Avatar of Fear. Golems/beasts come from
  `monsters-golems-beasts-sheet.png`; the Avatar has its own sheet.
- "Mini-boss" is a new concept — a second named fight in a region before the
  boss. Model as an extra boss-type encounter with its own `bossName` (no
  drops, or lesser drops) placed earlier on the map.

## 4. Bug: stale enemies at combat start

When a new combat begins, the previous (defeated) fight's enemy cards flash
before the new batch renders. Clear `#combat-enemies` / the battle stage at
`beginCombat` (or on the `combat-start` event, before the first replay frame)
so no stale cards show.

## 5. Rest / out-of-combat healing

Add a way to heal between fights. Options: a "Rest" action that restores some
HP at a cost (a chance of a wandering encounter, or consumes a turn/round of
torch/time), or camp tiles. Keep it Shadowdark-flavored (resting is risky).

## 6. Out-of-combat party management

- Currently only the **dragon's** equipment is adjustable outside combat (the
  character sheets open from the title/HUD, but party members' sheets aren't
  reachable mid-run except in combat).
- Make **every** party member's sheet reachable out of combat (a party roster
  panel on the explore screen), so you can **change their equipment** and
  **cast out-of-combat spells** (notably Healing Word) between fights.

## 7. New playable characters & monster art (saved, not yet wired)

- `art/beren-warrior-sheet.png` — **Beren**, human warrior (blonde, red/grey
  armor, blue sword & shield). Playable companion. Labeled 5x-frame sheet
  (side attack/move/idle, back, front).
- `art/turquoise-barbarian-sheet.png` — **Turquoise**, Yuan-Ti barbarian
  (green, snake-tailed, black hair, dual axes + shield). Playable companion.
- `art/avatar-of-fear-sheet.png` — the **Avatar of Fear** boss (spiked brown
  behemoth), labeled Side/Back/Front × Attack/Move/Idle.
- `art/monsters-golems-beasts-sheet.png` — pack sheet: **clay golem** (brown),
  **iron golem** (blue), **stone golem** (grey), **gargoyles** (for Guk),
  **alligators**, **snakes**, **garillon** (Lost Temple pyramid), **fungus
  men** (for Guk). Crop via `tools/crop_frames.py` (irregular grid — measure
  borders first, like the skeleton/menagerie sheets).

Wiring notes: companions need `walk` strips (overworld) like the others;
monsters need idle+attack strips and `faction`/`parley` tags. Gargoyles &
fungus men join Guk encounter tables; garillon joins the pyramid; snakes &
alligators fit the Lost Temple/sewers.
