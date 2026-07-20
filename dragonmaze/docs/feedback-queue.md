# Feedback queue

All items from the 2026-07-19 playtest feedback are **done** (commit 3fc10e3):

1. ✅ Bespoke zones no longer offer "delve deeper" — the win screen shows
   "Return to the surface"; the regions ARE the depth, linked by doors.
   Renamed `cazic-thule` → `lost-temple` everywhere.
2. ✅ Doors are real doorways embedded (offset) in the border walls, not floor
   tiles. You walk *into* a door to travel and arrive at the paired return
   door's inner tile on the far region's matching edge (go east → enter from
   the west). One-way drops (pyramid → sewers) land at the region start.
3. ✅ Each region has a boss: Overgrown Courtyard = Stone Golem, Maze = Clay
   Golem, Sewers = Iron Golem, Temple Depths = the rift-guardians, Archon
   Pyramid = Lizardman Archon (boss) + Tae Ew Crusader (mini-boss, on a `b`
   tile), Temple-Palace = the Tae Ew Templar, Summoning Chamber = the Avatar
   of Fear.
4. ✅ Fixed the stale enemy cards flashing at the start of a new combat.
5. ✅ Rest mechanic — "Make camp" heals ~half the party's wounds and risks a
   wandering ambush (chance scales with region difficulty).
6. ✅ Out-of-combat party management — an explore-screen party roster; tap any
   member to open their sheet and change equipment or spend level-ups. (Party
   healing between fights is covered by Rest; if you want per-hero out-of-
   combat *spell* casting from the sheet, that's a small follow-up.)
7. ✅ New art wired: playable Beren (human warrior) and Turquoise (Yuan-Ti
   barbarian) with walk cycles; monsters clay/iron golem, gargoyle, giant
   snake, fungus man, and the Avatar of Fear.

## Possible follow-ups (not requested, noted for later)

- Explicit out-of-combat spell casting from a hero's sheet (e.g. Healing Word
  targeting a specific ally), beyond the blanket Rest heal.
- The Lizardman Archon / Crusader / Templar reuse the lizardfolk sprite; a
  dedicated Garillon/Archon sheet could differentiate them.
- Portal character-generator import listing (still in
  docs/character-link-plan.md).
