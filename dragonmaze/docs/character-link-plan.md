# Plan: linking portal Heroes to Dragon Maze parties

Goal: characters built in the RPG Portal's character generator (the Heroes
tab) become recruitable Dragon Maze companions, alongside or instead of the
built-in dragonkin.

## What exists on each side

**Portal** (`src/lib/shadowdark/types.ts` → `Character`): id, name,
ancestryId, classId, level, `stats` (raw STR/DEX/CON/INT/WIS/CHA scores),
`hp {max, current}`, `ac`, `gear[]`, `equipment`, `spells: string[]` (spell
ids from the Shadowdark spell data), portraitArtId. Stored in IndexedDB
(`shadowdark-portal` DB, `characters` store) with JSON export/import already
in the Heroes tab.

**Dragon Maze** (`data/party.js` → combatant schema): ac, hpMax, `abilities`
as *modifiers*, `attacks [{name, toHit, damage}]`, `spells` (Dragon Maze
spell ids), `anim` strips. `meta.customCharacters` already exists in the
save schema as a placeholder.

## The bridge (three pieces)

1. **Adapter** — `src/state/importHero.js`, a pure function
   `portalCharacterToCompanion(char)`:
   - abilities: Shadowdark modifier table `floor((score − 10) / 2)`.
   - ac/hpMax: copy directly.
   - attack: derive from equipped weapon in `gear`/`equipment` (name +
     damage die from a small weapon table), `toHit` = STR or DEX modifier
     (+ level/2 rounded down as a simple proxy for class attack bonus).
   - spells: map portal spell ids → nearest Dragon Maze spell (start with a
     small translation table: any damage spell → `ember-bolt`, any heal →
     `healing-word`, any area spell → `flame-wave`; unmapped spells drop).
     Wizard/priest classes with no mapped spells still get `ember-bolt` so
     casters feel like casters.
   - anim: pick by classId (knight strips for fighters, swashbuckler strips
     for thief/ranger/wizard) until per-character sheets exist; the
     spritesheet prompt doc covers generating a personal sheet, and a
     `heroSheet` field can point at a custom strip pair.

2. **Transport** — two options, both cheap because the portal serves
   `dragon.html` from the *same origin* (jonsmitchell.com):
   - **Primary: read the portal's IndexedDB directly.** `dragon.html` opens
     the `shadowdark-portal` DB read-only and lists `characters`. Zero user
     friction: the title screen's party picker grows a "Your Heroes" section
     listing portal characters next to the built-in dragonkin. Guard for the
     DB not existing (file:// single-file play, fresh browsers).
   - **Fallback: JSON import.** An "Import heroes" button on the title
     screen accepts the Heroes tab's exported JSON (covers file:// play and
     other devices). Parsed characters land in `meta.customCharacters`.

3. **Party integration** — `meta.party` entries become
   `{source: 'builtin'|'imported', id}`; `companionById` consults
   COMPANIONS then `meta.customCharacters`. Cap the active party at 2–3
   companions for stage space. Imported heroes keep per-run HP exactly like
   built-ins; portal HP is never written back (the delve is a side story).

## Sequencing

1. Adapter + JSON import button + party-picker listing (no portal changes).
2. Same-origin IndexedDB read with graceful fallback.
3. Portrait/sprite upgrade path: per-hero sheets via the spritesheet prompt,
   stored as extra strips; portraits from the portal's `art` store could
   also render on the battle plate as a face chip.
4. (Optional, later) write completed-delve gold back to the portal character
   as a quest reward — needs a portal-side inbox, not a direct DB write.
