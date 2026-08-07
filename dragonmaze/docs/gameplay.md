# Dragon Maze — gameplay reference (as implemented)

Dry, Claude-facing map of the **game mechanics** — the rules, rolls, combat,
magic, items, progression, and world model — and where each lives in code. This
documents **what the code does now**, not history or goals. Update it when a
mechanic changes. UI/DOM/CSS is documented separately in
[`ui-reference.md`](ui-reference.md); this file stays out of presentation.

Stack: vanilla ES modules, no framework, no runtime deps. `data/*.js` is
hand-editable content; `src/engine/*` is pure rules (no DOM); `src/world/*`
builds dungeons; `src/state/gameState.js` is the single source of truth and every
transition; `src/render/*` presents it. Two RNG regimes: **world generation is
seeded/deterministic** (`makeSeededRNG`), **combat and moment-to-moment rolls are
live** (`liveRNG` / `Math.random`). Both from `src/engine/rng.js`.

---

## 1. Architecture & data flow

```
data/*.js  (content: monsters, spells, party, zones, items, …)
   │
src/world/*  maze.js (procedural) · zones.js (hand-authored) → a `dungeon` object
   │            encounters.js (which monsters) · loot.js (treasure)
src/engine/* dice.js → rules.js (every tunable constant + resolver) → combat.js
   │            entities.js (makeCombatant factory)
src/state/gameState.js   the `state` object; all mutations; emits events
   │            save.js (localStorage) · importHero.js (portal → companion)
src/render/*   subscribe to state, replay events  (see ui-reference.md)
```

Views never mutate state. `gameState.subscribe(fn)` registers a listener;
mutations call `emit(events)` with an array of `{type, …}` event objects. The
combat engine is **pure**: every function returns an event array; the caller
(gameState) applies them and re-emits. `src/main.js` wires DOM intents →
`game.*` and event batches → the renderers.

---

## 2. State shape & lifecycle (`src/state/gameState.js`)

`state = { screen, meta, run, hasSave }`.

- **`state.meta`** — persistent across delves (see `freshMeta()`): `hoardGold`,
  `tier` (dragon age), `runsCompleted` (= next procedural depth − 1), `party`
  (companion ids), `mode` (`'dragon'` | `'party'`), `heroGrowth` (per-hero
  `{xp, level, choices[]}`), `heroTomes` (per-hero learned spell ids),
  `reputation` (faction → −10..+10), `zone` (`{zoneId, subIndex}` or `null` for
  procedural), `inventory` (owned item ids), `consumables` (pouch, id list, dupes
  allowed), `equipment` (charKey → `{weapon,armor,trinket}`), `customCharacters`
  (imported heroes), `defeatedBosses` (stable boss keys — stay dead), `flags`
  (world-state booleans for quests).
- **`state.run`** — the active delve, `null` between runs. Holds `dragon`
  (`{tier, hp}` or `null` in party mode), `party` (`[{id, hp}]`), `unbankedGold`,
  `dungeon`, `playerPos`, `explored`/`dimSeen` (fog maps keyed `"x,y"`), `phase`
  (`'explore'|'parley'|'combat'|'won'|'defeat'`), `combat`, `burnedSpells`
  (casterKey → fizzled spell ids, until camp), `luck` (heroId → tokens),
  `quest`, `pendingEncounter`/`pendingParley`.

**Persistence** (`save.js`): localStorage key `red-dragon-labyrinth`,
`SAVE_VERSION = 2`, run through `migrate()`. The **run is only serialized while
`phase === 'explore'`** — quitting or reloading mid-combat resumes from *before*
the fight (`combat` is nulled). `exportSave()`/`importSave()` move the whole save
as a JSON string. `normalizeMeta()` backfills fields for old saves and strips
legacy ones (e.g. `familiarsOwned`).

Lifecycle entry points: `init()` (boot, load save), `newGame(seed?)`,
`continueGame()`, `enterLabyrinth(seed)`, `nextLabyrinth()`, `quitToTitle()`.

---

## 3. Party, modes & companions (`data/party.js`)

- **Mode** (`setMode`): `'dragon'` = the Red Dragon delves alongside the party;
  `'party'` = the party goes alone (no dragon combatant). Toggled by the dragon
  card in the party panel.
- **`PARTY_CAP = 4`** companions per delve (`toggleCompanion`, `setParty`).
- **Companions** are combatant templates (same schema as monsters). Built-ins:
  `spawnee` (vampire-spawn warrior, `relentless`, `darkvision`, casts
  drain-life/dominate-undead on CHA), `dragonkin-swashbuckler` (pure DEX duelist,
  no magic), `dragonkin-spellblade` (INT arcanist, tier-1 offensive book),
  `beren` (warrior, `beast-dread`+`animal-friend` traits), `turquoise` (Yuan-Ti
  barbarian, `relentless`, `darkvision`), `gowra` (Yuan-Ti WIS priest,
  heal/smite). Key fields: `hitDie` (HP/level), `abilities` (modifiers),
  `attacks` (`{name, toHit, damage, range}`), `castStat`, `spells`, `traits`,
  `ability` (engine keyword), `darkvision`.
- **Imported heroes** (`src/state/importHero.js`): the Shadowdark portal's
  exported JSON → companions. Scores → modifiers `floor((s−10)/2)`; weapon die
  guessed from gear names (`WEAPON_DICE`); sprite strip by class; portal spells
  mapped to nearest in-game spell by keyword. Stored in `meta.customCharacters`.

`heroWithGrowth(id)` is the canonical "resolved hero": folds level-up choices
(ability increases, talents, learned spells, familiar) and found tomes onto the
base template. Always build combatants from this, never the raw template.

---

## 4. The world & exploration

### Dungeon generation

Two builders, both producing the same `dungeon` shape (`{width, height, tiles,
start, exit, encounters, loot, doors?, edges?, portals?, theme?, zone?, depth}`).
`tiles[y][x]` is `0`=wall / `1`=floor.

- **Procedural** (`src/world/maze.js`, `generateDungeon(seed, depth, partySize)`):
  a `MAP.cellsWide × cellsHigh` (7×5) cell grid, recursive-backtracker perfect
  maze, then **braided** — `MAP.braidChance` (0.45) of dead ends get a wall
  knocked out to form loops. Cells project to a `(2w+1)×(2h+1)` tile grid (rooms
  on odd/odd, passages between). Exit = cell farthest from start (BFS). Loot in
  surviving dead ends (`MAP.lootMax` 4); `MAP.encounterMin..Max` (3–5) encounters
  on cells ≥ `minEncounterDistance` (2) from start. Fully seeded from
  `dungeon:{seed}:{depth}`.
- **Hand-authored zones** (`src/world/zones.js`, `buildZoneDungeon`): parses a
  subregion's ASCII `map` (`data/zones.js`) into the same shape. Geometry legend:
  `#` wall, `.` floor, `S` start, `E` surface door (banks & ends the delve),
  `1`–`9` region doors (`sub.doors` maps digit → destination subregion),
  `~` walkable water, `%` **invisible wall** (renders floor, blocks movement —
  goes in `dungeon.blocked`). **Where** monsters/loot/bosses/decor sit is NOT in
  zones.js — it's hand-placed in `data/placements.js`, keyed by subregion id.
  Encounter composition and loot values still roll on the seeded RNG unless a
  placement **pins** an id/item, so revisits differ but geography is fixed.

### Movement (`move(dx,dy)`, `moveTo`)

One orthogonal step per call. Order of checks: off-map edge → `dungeon.edges`
travel (`travelEdge`); door tile → travel to another subregion (`travelThrough`)
or surface/bank; portal tile (e.g. the well) → confirm prompt then `usePortal`;
wall/`blocked` → no-op; **monster tile → `engage`** (bump-to-fight — you occupy
the tile only after winning); else step, `reveal`, pick up loot, then
`tickEnemies` (patrollers/thief take their step). Zone travel carries gold, HP,
and spent spells over; you arrive at the paired return door's inner tile.

### Fog & light (`reveal`, `hasLight`)

Permanent `explored` map. Default sight is the 5-tile plus (self + 4 orthogonal).
**Light** — a party member with `darkvision`, or the `lantern-beetle` familiar —
fills a 3×3 lit and glimpses (`dimSeen`) the ring two tiles out. No light *spell*
exists yet; add one in `hasLight`.

### Loot pickup (`move`)

Walking onto a loot cell (`dungeon.loot`) resolves by type: `tome` → a random
caster with an unknown tome spell **within their tier** learns it (else +25 gold); `item` → a pinned
magic item into `inventory` (else +20 gold if owned); `consumable` → into the
pouch; else gold (× `lootScale(depth)`, +25% with the `pack-rat` familiar). Loot
tables: `data/treasure.js` (d6 gold table), rolled in `src/world/loot.js` with
`TOME_CHANCE` 0.06 and `POTION_CHANCE` 0.10. **Magic items never come from loot
piles** — only from named bosses (and quests).

### Rest (`rest()`)

Between fights. Heals ~half missing HP + 10% max for the dragon and every hero;
**restores all burned spells** and **refreshes each hero's luck token**. Risky
(Shadowdark): `maybeThiefHeist` first (a camp thief may steal a gold cut — see
below), then a wandering-monster ambush with risk `min(0.55, 0.15 + depth·0.06)`,
composition from `rollAmbushIds` (zone table or `rollEncounter`).

### Enemy AI on the map (`tickEnemies` + helpers)

Monsters flagged `patrol` (the golems) pace a short beat (`PATROL_LEASH` 3) around
`home` and give chase within `DETECT_RADIUS` (3) with clear line of sight
(`lineOfSight`, Bresenham). A caught party (patroller reaches the player's tile,
or the player steps onto it) triggers combat. The **camp thief** (`maybeThiefHeist`)
spawns when carrying ≥20 gold: spotted (best party WIS + d20 ≥ 12) he flees toward
a door and you must corner him (`flee`/`target`/`steal` fields on the encounter);
unspotted he lifts a 20% cut silently. Reaching his door escapes with the cut.

---

## 5. Dice & core resolution

### Primitives (`src/engine/dice.js`)

- `roll("2d6+1", rng)` → `{rolls, total, …}`. Parses `\d*d\d+([+-]\d+)?`.
- `d20({advantage, disadvantage, rng})` → rolls twice on adv/dis, keeps
  best/worst; `advantage===disadvantage` cancels to a straight roll.
- `save(dc, bonus, opts)` → `{success, total, …}`.

### Rule constants & resolvers (`src/engine/rules.js`)

The single home for every game number — nothing elsewhere hard-codes a rule.

- **`resolveAttack(attacker, attack, target, rng, opts)`** — `d20 + attack.toHit`
  vs `target.ac (+ opts.acBonus)`. Natural 20 auto-hits **and doubles damage**;
  natural 1 auto-misses. Damage = `roll(attack.damage)` (die only, min 1);
  `opts.advantage`/`disadvantage` fold in, as do `opts.toHitBonus` and
  `opts.damageBonus` (a blessed weapon — the damage bonus goes through
  `bumpDamage` so a crit doubles it). Returns everything a view narrates.
- **`rollInitiative`** — `d20 + DEX + initBonus`, once per combat.
- **Breath**: `resolveBreathOn(target, dc, dmgTotal, rng)` — DEX save vs `dc`,
  half on save (min 1). `rollBreathRecharge` — d6, ready again on 5+.
- **`resolveSpellCast(caster, spell, rng, opts)`** — `d20 + castStat mod +
  spellPower` vs DC (`10 + spell.tier`, `opts.dcMod` shifts it). Nat 20 always
  succeeds **and crits** (doubles the effect); nat 1 always fizzles. Advantage
  from `spell.castAdvantage` (Magic Missile), Spell Focus (`focus-<school>`
  talent), or `opts.advantage` (familiar knacks) — in that precedence, reported
  as `advSource: 'spell'|'focus'|'familiar'`. Returns `dieRolls`/`mode` alongside
  the kept `natural`, so a cast's advantage draws both dice in the cinematic the
  way an attack's does (`spellPayload`/`castAdvWhy` in combatView.js name the
  source on the ▲ banner and in the log).
- **Spell tiers**: `maxSpellTier(level)` — a caster reaches a new tier every
  other level (tier 1 at 1st, 2 at 3rd, 3 at 5th, 4 at 7th, 5 at 9th, capped by
  `MAX_SPELL_TIER` = 5). `canLearnSpell(level, spell)` gates every path by which
  a caster *learns* a spell: the level-up pick (`chooseAdvance('spell')`, offered
  via `learnableSpells` in main.js), and found tomes (the loot branch in
  gameState.js). A character's **starting** list is authored data and may carry a
  signature power above tier (Spawnee's vampiric drain, which is hers alone).
- **Parley/renown**: `resolveParleyCheck` (CHA + `mod` vs DC, nat-20/nat-1 rule),
  `parleyDC` (11 willing / 13 wary), `dispositionLabel`, `FACTION_ENEMIES`,
  `clampRep` (band −10..+10).
- **Morale**: `moraleCheck(monster, rng, disadvantage)` — `d20 + monster.morale`
  vs `MORALE_DC` (12). `morale: null` = fearless (undead/constructs never check).
- **Leveling**: `LEVEL_XP` (cumulative, L1–L10), `levelForXp`, `hpPerLevel`
  (die-average + CON, min 1), `asiEarned` (ASI at 2/4/6/8/10), `talentEarned`
  (talent at 3/5/7/9), `ABILITY_CAP` (+5). Dragon: `endOfRunBonus`, `lootScale`,
  `victoryDropChance`, `HOARD_PILE_TIERS`, `tierAfterBanking`.
- `bumpDamage(expr, n)` — folds a flat bonus into a dice string's modifier
  (weapon damage stays die-based; equipment/legacy picks use this).

**Shadowdark alignment (do not regress):** weapon/spell damage is the **die
only** — ability modifiers sharpen the *to-hit*/*cast*, never pad damage. Spell
DC is always `10 + tier`. A fizzle is lost **until the party rests**, not just for
the current combat. Nat-20 doubles; nat-1 fumbles/mishaps. (See
`memory/project_dragonmaze_shadowdark_alignment.md`.)

---

## 6. Combat (`src/engine/combat.js`)

Pure turn-based engine. gameState's `beginCombat` builds combatant instances
(`makeCombatant` / `makeDragonCombatant` from `src/engine/entities.js`), calls
`createCombat`, then drives the loop: `runAiTurns` until a player-controlled
hero's turn, wait for a player action, repeat. **The dragon is the run**: if it
falls the fight is lost even with companions standing; a party delving alone loses
only when every hero is down (`checkDefeat`). Downed companions stay in the order
at 0 HP and can be revived by healing.

### Factions & the turn order

Each combatant has a `side`: `'foe'` (enemy), `'hero'` (player-controlled), or
`'ally'` (an AI-run minion on the hero side). Helpers: `isHero` gates the player's
turn and counts for defeat; `onHeroSide` = hero or minion (what foes target &
share victory); `aiRun` = foe or minion (takes an automatic turn).
`createCombat` rolls initiative for all, sorts descending (ties → heroes), snapshots
opening HP (for the pre-round render, see combatView). Foes/minions run via
`runAiTurns`; `advanceTurn` skips the dead and ticks conditions.

**Targeting:** foes strike the hero side but a minion "bodyguards" its owner
(`foeTargets` — while a minion is alive its controller can't be picked). Minions
(`takeMinionTurn`) swing at a random living foe, no morale/specials.

### Player actions (all return event arrays; gameState wraps each in `resolvePlayerAction`)

- **`playerAttack(combat, targetId)`** — `Strike`/`Bite`. `flurry` talent strikes
  twice; `bane: 'undead'` adds +2 vs undead; striking a `panicked` foe rolls with
  advantage. A missed final swing with luck left **defers** for a luck reroll.
- **`playerBreath(combat)`** — dragon only, one damage roll, every foe DEX-saves
  for half; spends the charge (recharges d6≥5 when the dragon's turn next comes).
- **`playerSweep(combat)`** — `cleave` talent: one attack roll vs every foe, each
  hit deals half weapon damage.
- **`playerSpell(combat, spellId, targetId)`** — see §7.
- **`playerUseItem(combat, item, targetId)`** — see §8.
- **`playerParley(combat, mode, dc)`** — first round only, once/combat: `threaten`
  (rout all), `persuade`/`barter`/`work` (end peacefully). (Pre-fight parley is
  the usual path; see §9.)
- **`playerIntimidate(combat, targetId)`** — CHA vs `12 + target.morale`; success
  panics it (flees on its turn). Fearless things can't be cowed. `silver-tongue`
  talent → advantage.
- **`flee()`** (gameState) — escape the fight but drop carried gold (same cost as
  being downed).

### Luck (deferred rerolls)

Each hero gets **1 luck token/day** (`run.luck`, refreshed on rest; not the
dragon). A failed attack or cast with a token left pauses the turn
(`combat.pendingLuck`, `luck-offer` event) — the turn does **not** pass and a
fizzle is **not** burned until the player calls `spendLuck` (reroll, keep the new
result) or `declineLuck` (let the failure stand). Only the one missed swing is
rerolled, not a whole flurry.

### Damage model (`applyDamage`)

Types `'physical' | 'fire' | 'drain'` (+ item types `poison`/`acid`). No monster
currently resists `'drain'`; one that should (something with no life to take)
just lists it in `resist`. `DTYPE_NOUN` in combatView.js names each in the log.
Order: `resist`
(half, min 1) / `vulnerable` (double) → **ward** (`tempHp` from Potion of Warding
soaks first) → `relentless` (first killing blow leaves 1 HP, once) → HP.
Monster abilities (`ability` keyword): `regenerate` (+2 HP at turn start),
`lifedrain` (heal half of damage dealt), `relentless`.

### Morale (`triggerMorale`)

Once per monster per fight: checked when it drops below half HP or an ally dies.
A `wild`-faction monster fighting a `beast-dread` hero (Beren) checks at
disadvantage. Fail → `panicked` → flees on its turn.

### Conditions (timed buffs/debuffs)

`{id, rounds, ac?, disadv?, dot?:{amount,dtype}, toHit?, damage?, disable?,
wakeOnDamage?, focusOf?}`, refreshed not stacked (`addCondition`; `dropCondition`
lifts one). Aged in `tickConditions` at end of the owner's turn (DoT applies, then
expiry) — except a `focusOf` condition, which has no clock and lasts exactly as
long as its caster's concentration. `condAc`/`condDisadv`/`condToHit`/`condDamage`
fold into `atkOpts`, as does `disabledBy(target)` (striking the helpless is at
advantage).

- **`disable`** — the owner loses their turns. `runAiTurns` skips a disabled
  monster with a `condition-skip` event; the condition still ages, so a
  1d4-round Sleep runs down while it lies there. *No spell disables a hero
  today; if one is ever added, the player's turn would need the same skip.*
- **`wakeOnDamage`** — dropped by the first damage that lands (`applyDamage`),
  which is how a hit shakes a sleeper awake.
- **`toHit`/`damage`** — sharpen the owner's swings (Holy Weapon). The damage
  bonus folds into the dice expression via `bumpDamage`, so a crit doubles it,
  exactly like an enchanted weapon's.

Sources: consumables (warded/greased/burning), monster `daze`, and spells
(`applySpellCond`). The view chips them onto the unit card (`condBadges`).

### Resolution & spoils

`checkVictory` (all foes dead/fled), `checkDefeat` (dragon down, or party wiped).
Only **slain** foes pay `goldValue`; fled ones keep theirs; **dominated** foes
still pay (`combat.bonusGold`). gameState's `finishCombat` banks the gold into
`unbankedGold`, adjusts renown, removes the encounter, resolves quest bounties,
and rolls boss item drops. `forcedRetreat` drops carried gold on defeat/flee
(banked hoard is safe).

### Monster casters (`takeMonsterCast`)

A monster with a `cast: {name, tier, kind, dice?, chance}` may cast instead of
swinging (`kind`: `bolt` sears a hero, `drain` sears + self-heals, `heal` mends
its most-wounded ally, `daze` applies disadvantage). Same `resolveSpellCast`; nat-1
mishaps (`applyCastMishap`: half a 1d4 backlash, half dazed).

---

## 7. Magic & spells (`data/spells.js`)

Spell schema: `{id, name, tier, castDC (=10+tier, mirror), target, dice?, school,
tome?, plus effect flags}`. `target`: `'enemy'` (one foe), `'ally'` (one hero —
works on the fallen), `'all-enemies'` (each DEX-saves vs `saveDC` for half),
`'self'` (conjuration). Effect flags: `drain` (deal `'drain'`-typed damage — its own type, so physical
resistance no longer halves it — then heal the caster the full damage dealt,
bounded by their missing HP, never an overheal),
`dominate` (convert a foe to a minion), `summon: '<monsterId>'` (conjure a minion),
`dtype` (damage type, default `'fire'`), `bossImmune` (a boss shrugs the effect off),
`save: '<ability>'` (the target rolls to resist outright, vs `10 + tier + caster's
cast mod`). `tome: false` = innate/class-only, never learnable from a found tome.

**Durations beyond instant** (`applySpellCond` in combat.js):
- **`cond: {...}`** — a fixed-duration condition on the target, `rounds` long
  (may be a dice string like `'1d4'`; a nat-20 cast doubles it). No
  concentration, so nothing can shake it loose early.
- **`focus: {dice?, cond}`** — Shadowdark's **Focus**. The caster carries
  `focus = {spellId, name, targetId, condId, dice, dtype}` and the target carries
  the condition tagged `focusOf: <casterId>`. Rules, per the system guide: one
  focus at a time (casting another calls `breakFocus` on the old one); a
  spellcasting check at the **start of each of the caster's turns** keeps it up
  (`beginTurn` → `checkFocus`, wired into `advanceTurn`, which now takes `rng`);
  **taking a hit forces an immediate check** (`afterDamage` → `checkFocus`); an
  ordinary failure just ends it, but a **natural 1 is a full critical failure**
  (burned until rest, plus `applyCastMishap`). Focus also ends if the caster
  falls or the target dies. A `focus.dice` spell deals that die to the target on
  every held check (`focus-tick`; a nat-20 on the check doubles it).
  `checkFocus` is re-entrancy guarded (`focusChecking`) so two casters focused on
  each other can't ping-pong.

**Casting** (`playerSpell` → `resolveSpellCast` → `applyCastSuccess`): a caster
knows a spell if it's in their resolved `spells` and not in `burned`. On success,
`applyCastSuccess` branches on `target`/flags; damage is the die (nat-20 doubles;
`fireBonus` +1 from the `ember-wisp` familiar). On **any failure the spell burns**
(lost until camp) unless `arcane-recovery` saves the first fizzle each fight; nat-1
also mishaps. Burned lists mirror to `run.burnedSpells` between fights
(`syncDragonHp`).

`tier` sets the DC **and** gates learning (`canLearnSpell`, §5) — tier 1 from
1st level, tier 2 from 3rd, tier 3 from 5th. The level-up dropdown labels each
offer with its tier.

Current spellbook, by tier —
**tier 1:** `ember-bolt` (fire 1d6), `magic-missile` (force 1d4, always cast with
advantage, `tome`), `burning-hands` (fire 1d6 all, `saveDC` 11, `tome`), `smite`
(radiant 1d6, `tome`), `healing-word`/Cure Wounds (holy 1d6 heal, revives),
`acid-arrow` (acid 1d6 on impact **+ 1d6 per focused turn**), `sleep`
(`disable` 1d4 rounds, wakes on damage, `bossImmune`), `holy-weapon` (ally buff,
+1 hit/+1 damage, 5 rounds).
**tier 2:** `drain-life` (1d8 + full lifesteal, `tome:false`), `dominate-undead`
(`dominate`, `tome:false`), `summon-ember` (`summon: 'ember-spirit'`, `tome`),
`hold-person` (`disable` while focused, WIS `save`, `bossImmune`).
**tier 3:** `flame-wave`/Fireball (fire 3d6 all, `saveDC` 13), `lightning-bolt`
(storm 3d6 all, `tome`).

Acid Arrow sits at tier 1 though Shadowdark books it at tier 2 — partly for its
*far* range, and this game has no range bands at all, so that half of the spell
doesn't exist. It keeps the book's 1d6 to pay for what the missing range took
away, and tier 1 is where a 1st-level caster can actually learn a focus spell.

Starting books stay inside tier 1 except for innate powers: the spellblade opens
with ember-bolt / magic-missile / burning-hands / cure wounds / acid-arrow / sleep
(Fireball and Lightning Bolt are hers to learn at 5th), Spawnee with her tier-2
vampire powers, Gowra with her tier-1 prayers (cure wounds, smite, holy weapon).
Hold Person is tier 2, so nobody starts with it — it's a 3rd-level pick. Imported portal casters map
by keyword (`mapSpell` in importHero.js) and land on tier-1 spells only.

**Minions** (`applyCastSuccess`, one per caster): `summon` inserts a temporary
ally right after the caster in the order; `dominate` flips a foe to `side:'ally'`
(bosses immune; undead can't resist; others get one WIS save vs `12 + castStat`).
Deploying any real minion **dismisses that hero's familiar** (`dismissFamiliar`).

**Familiars** (`data/familiars.js`) — a single hero's own creature, chosen as a
level-up feat (one per hero). It rides along as an inert sprite carrying **one
knack for its owner**: `ember-wisp` (+1 fire spell damage), `pack-rat` (+25% loot
gold, party-wide), `lantern-beetle` (wider light, party-wide), `fae-drake`
(spell DC −1), `dusk-bat` (advantage on Drain Life). Wired in combat.js via
`familiarActiveFor`/`fireBonus`/`familiarDcMod`/`familiarCastAdvantage`; the
out-of-combat two go through `partyHasFamiliar` in gameState.js (`hasLight` for
the beetle, the loot branch for the rat). When a knack actually changes a roll,
`familiarCredit` tags the event with `{name, effect}` and the combat log names
the familiar (`FAM_AID` in combatView.js) — otherwise a −1 DC or +1 damage is
invisible. The bat's advantage additionally shows as two dice on the cast
cinematic (see `resolveSpellCast` in §5). Note the bat's knack keys off
`spell.drain`, so it only ever fires for `drain-life` — i.e. only for Spawnee. A familiar with `anim` strips draws as a sprite on its card
(`fae-drake`, `dusk-bat`, and `ember-wisp` — which shares the summoned Ember
Spirit's art); the rest fall back to their emoji. `anim.beat` runs a two-frame
strip fast enough to read as a wingbeat (`.sprite.beat`, 0.34s vs the 0.9s idle).

**Spell Focus** talents are generated per school the caster knows
(`focusTalentsFor` in `data/talents.js`) and give advantage casting that school.

---

## 8. Consumables & equipment

**Consumables** (`data/consumables.js`) — one-shot combat items in a **shared
party pouch** (`meta.consumables`, dupes allowed). Using one costs the whole turn
(`playerUseItem`), and it's spent only when the turn is actually taken. Schema:
`{id, name, tile, use:{target, heal?, tempHp?, restoreSpells?, damage?, dtype?,
saveDC?, condition?}}`. Current set: Healing Potion (2d4+2, revives), Draught of
Recall (un-burn all spells), Potion of Warding (+2 AC 3 rounds), Vial of Venom
(2d6 poison, one foe), Caustic Flask (2d4 acid, all, save 12), Flask of Grease
(all disadvantage 2 rounds), Flaming Pitch (1d6 fire + burning DoT, all).

**Equipment** (`data/items.js`) — persistent magic items, one wearer each.
`SLOTS = ['weapon','armor','trinket']`. `{id, name, slot, zone, mods:{toHit?,
damage?, ac?, hpMax?, init?}, bane?}`. `bane: 'undead'` adds +2 damage vs undead.
Equipped via `equip(charKey, slot, itemId)`; folded into a combatant by
`applyEquipment` (to-hit/damage via `bumpDamage`, AC, `initBonus`, `bane`) and
into HP by `equipmentMod(charKey,'hpMax')` at delve start. **Items drop only from
named bosses** (preferred `bossDrops` first, then the zone's item pool) at
`victoryDropChance(true)` (0.5), and from pinned zone caches.

---

## 9. Encounters, parley & quests

**Bump-to-fight** (`engage`): if the lead monster will talk (`parleyOffer` —
undead never; `wild` only with an `animal-friend` party member; others need
`parley !== 'never'`), `phase` becomes `'parley'` and a `parley-offer` fires;
otherwise straight to `beginCombat`. The player answers via `resolveEncounter(mode)`:

- `fight` → combat.
- `talk` → opens the approach menu (`talk-open`).
- `persuade` → CHA check (`+faction` standing); success = pass in peace.
- `threaten` → CHA check (`−faction`, so a hated/feared party intimidates better);
  success = drive them off.
- `work` → success takes a bounty on the region's boss (`run.quest`; paid in
  `finishCombat` when that boss falls, +renown).

Standing (`meta.reputation[faction]`) rides on the **roll**, not the DC. Killing a
faction's own erodes standing; killing its `FACTION_ENEMIES` raises it
(`finishCombat`).

**Knowledge check** (`beginCombat`): one silent party INT roll per foe type sizes
it up (lore tier 0/1/2), gating how much the inspect popup and action labels
reveal. Never announced.

---

## 10. Progression & the hoard

- **Gold is XP** (Shadowdark). Banking (`bankAndWin`, `stashHoard`) adds carried
  gold to `meta.hoardGold` and grants that amount as XP to **every hero on the
  delve** (`grantBankingXp`). Crossing a `LEVEL_XP` threshold levels them:
  automatic HP (`hpPerLevel`) is added immediately; ability increases (2/4/6/8/10)
  and talents (3/5/7/9) become **pending advances** (`pendingAdvances`), spent on
  the character sheet via `chooseAdvance(charId, type, arg)` (`asi` | `talent` |
  `spell` | `familiar` — the last three share the talent slot).
- **Talents** (`data/talents.js`): `armor` (+1 AC, repeatable), `cleave`, `flurry`,
  `arcane-recovery` (caster), `silver-tongue`, plus generated `focus-<school>`.
- **Dragon tiers** (`data/dragonProgression.js`): wyrmling → young → adult →
  ancient, each with `hpMax`, `ac`, `abilities`, bite `attacks`, `breath`, and
  `hoardToNext`. Growth is **hoard-gated** (`tierAfterBanking` / `checkTierUp` at
  banking time) — the dragon grows by accumulated hoard, not XP. The dragon is a
  pure martial: bite + breath, no spells or familiar.
- **End of run**: procedural depths pay `endOfRunBonus(depth)` (`10 + 5·depth`)
  for reaching the exit and then `nextLabyrinth()` delves deeper; zones exit
  through their entrance gate (no exit bonus) and `stashHoard`/`surfaceExit` let
  you bank-and-continue or leave.

---

## 11. Content data files — where to add things

| Want to add… | Edit | Notes |
|---|---|---|
| A monster | `data/monsters.js` | `minDepth`/`maxDepth` + `weight` + `packMax` put it in the procedural pool automatically; `faction`, `parley`, `morale`, `ability`, `cast`, `resist`/`vulnerable`, `goldValue`, `patrol`. |
| A companion | `data/party.js` | Combatant template + `hitDie`, `castStat`, `spells`, `traits`. |
| A spell | `data/spells.js` | `tier` sets DC; `target` + effect flags; `tome:false` if not learnable. |
| A talent | `data/talents.js` | Read by `heroWithGrowth` (passive) or the engine (action). |
| A consumable | `data/consumables.js` | `use` object; `tile` art key. |
| A magic item | `data/items.js` | `slot` + `mods` + `zone`; drops from bosses only. |
| A familiar | `data/familiars.js` | Add the `effect` key + wire it in combat.js/gameState.js. |
| A dragon tier | `data/dragonProgression.js` | `hoardToNext` gates the climb. |
| A zone | `data/zones.js` (geometry + tables) **and** `data/placements.js` (where things sit) | ASCII map + `subregions`/`doors`/`boss`. Placements are hand-made with the tile editor — see [`editor-guide.md`](editor-guide.md). |
| Loot table odds | `data/treasure.js`, `src/world/loot.js` | d6 gold table + tome/potion chances. |

`data/maps.json`, `data/maps.txt`, `data/tile-tags.json` are editor artifacts
(the reference-map tracing pipeline); not read by the running game.

---

## 12. Quick index — which file owns a mechanic

- **Dice / d20 / adv-dis** → `src/engine/dice.js`
- **Every rule constant & resolver** (attack, cast, breath, morale, parley,
  leveling, tiers) → `src/engine/rules.js`
- **Combat turn loop, actions, minions, luck, conditions, damage** →
  `src/engine/combat.js`
- **Combatant construction** → `src/engine/entities.js`
- **All state + transitions** (movement, loot, rest, banking, XP, equip,
  reputation, parley flow, save) → `src/state/gameState.js`
- **Dungeon geometry** → `src/world/maze.js` (procedural), `src/world/zones.js`
  (authored), `src/world/encounters.js` (composition), `src/world/loot.js` (treasure)
- **Save / load / migrate** → `src/state/save.js`; **portal import** →
  `src/state/importHero.js`
- **Content** → `data/*.js` (see §11)
- **Presentation** (map, combat replay, dice cinematic, HUD, sheets) →
  `src/render/*` — documented in [`ui-reference.md`](ui-reference.md)
