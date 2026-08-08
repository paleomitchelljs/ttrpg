# Monster making — guide (Claude-facing)

How to add a monster to Dragon Maze without breaking Shadowdark's scale. The first
half is design philosophy, taken from a third-party Shadowdark monster-making zine
(pages supplied 2026-08-07). The second half is how that philosophy cashes out in
[`data/monsters.js`](../../data/monsters.js), which is the only file most new
monsters touch.

Read this before writing a stat block. For the underlying system math, read
`shadowdark-system-guide.md` §§14, 19, 20 (local only, gitignored).

**On the source.** Method and design intent are summarized here in our own words.
No stat blocks, no talent text, and no tables from the zine are reproduced. If you
need a specific talent's exact wording, the zine is the authority, not this file.

---

## The four rules

### Vibes over complexity

A 5e stat block carries sizes, creature types, damage types, resistances, condition
immunities, skills, senses, languages, and a CR. Shadowdark carries almost none of
that. Adapting a monster means boiling it down to what makes it *that* monster and
cutting the rest. The test: if a field would never change a decision at the table,
it does not belong on the block.

### Natural language does the categorizing

Shadowdark has no defined monster sizes, no creature types, no damage types. Those
ideas still exist, they just live in the flavor line and in the ability text, and
the GM reads them off. "A brutish, bat-eared goblinoid covered in brown fur" is the
size, the type, and the tactics, all at once. Trust prose to carry what a taxonomy
would carry.

### Monster magic is not PC magic

Player spells were developed and honed by wizards, so barring a mishap they do what
the caster expects. A monster's magic seeps up out of the Shadowdark itself and is
not knowable to PCs the same way. A monster may have something *resembling* a PC
spell, and it should rarely be the same spell. Some cast more than once per turn.
The unpredictability is the design, not sloppiness.

### The rules are guidelines

The zine is explicit that its own advice, and the core rules with it, are
suggestions. The monsters are yours. If something does not work at the table, change
a number and run it again.

---

## Three ways to build one

Pick the cheapest one that works. Most monsters never need the third.

### Option I — equivalents

If Shadowdark already has a stat block for the thing, use it unchanged. A knight is
a knight, a zombie is a zombie. This is a one-step conversion and it covers a
surprising fraction of cases.

### Option II — adaptation

If an equivalent exists but is not quite it, take the nearest block and push the
numbers. The zine's worked example turns a bandit into a bandit captain by adding
roughly +2 AC, +15 HP, +2 LV, a second attack, and a couple of points of stat mod.
The captain keeps the bandit's talent unchanged. That is the whole method.

### Option III — benchmark

The long way, for something with no Shadowdark cousin. Six steps, and only the last
one involves arithmetic.

1. **Set the level.** Level is the single threat number, so it goes first. Find 2–3
   similarly powerful monsters that exist in both systems, look at where their
   Shadowdark versions landed, and put yours in that band. If your candidates
   cluster at 4 and 7, pick the one your monster actually fights like. (The zine
   does this lookup with the community Unofficial Monster List, which cross-indexes
   5e CR against Shadowdark LV.)
2. **AC.** Read it off the same comparison set, adjusted for armor and hide. "Like
   a minotaur, plus leather armor, so 14."
3. **Six stat mods.** The dirty trick is that 5e's modifiers already use Shadowdark's
   −4..+4 shape, so you can port them straight across. Tune them down a touch at
   high level, because PC mods cap at +4 and monster mods do not have to.
4. **Attacks, talents, spells.** Usually straight off the source block: number of
   attacks, one small die each. Match weapons to their Shadowdark equivalents
   rather than converting damage by hand. For the to-hit bonus, see the next
   section.
5. **Movement and alignment.** 30 ft is "near." Neutral is neutral. Round freely.
6. **HP.** `LV × 4.5 + CON mod`. Shadowdark does not print hit dice for monsters,
   but the hidden die is a d8, and 4.5 is its average roll.

A calibration check before you commit: a level-appropriate monster should hit AC
13–16 about half the time, and should threaten to drop a low-HP PC in 1–3 hits. If
neither is true, the level is wrong.

---

## Attack bonus

Shadowdark never prints the equation, but its own stat blocks fit one. Under 10 HD:

```
toHit = ceil(0.75 × HD)
```

Round every decimal up, always. HD is the monster's level, so LV 1 is +1, LV 2 is
+2, LV 4 is +3, LV 6 is +5, LV 9 is +7.

Real blocks then run about −2 to +2 off that number, and there is no clean rule for
which gets what. The usable anchor is the human. A combat-trained human enemy
(knight, assassin, soldier) sits *exactly* on the equation, at +0 deviation. So the
question to ask about any new monster is whether it is better at clobbering things
than a trained human of the same HD. Better, push up. An untrained beast or a
shambling corpse, push down.

The equation also stays within 1 of the OSE attack tables anywhere under 10 HD, so
a flat +1 per HD works too. Players will not notice a 5% swing on a d20. Two ways
to do this, then:

- **Easy.** OSE tables, or +1 per HD. It does not matter.
- **Less easy, more accurate.** `ceil(0.75 × HD)`, then shift −2 to +2 against the
  trained-human benchmark.

### Where this roster actually sits

There is no `level` field, so recover it as `(hpMax − CON) / 4.5`, rounded. Audited
against the equation on 2026-08-08, 34 of 36 monsters land inside the ±2 band. The
distribution is one-sided, though: mean deviation is **+1.5**, and not one monster
sits *below* the baseline. Two break the band on the high side, the cerenasp and
the lizardman-crusader, both at +6 where the equation wants +3. So the roster hits
harder than a trained human at every level.

Whether that is a deliberate thumb on the scale or drift across 36 additions is not
recoverable from the data. Either way, a new monster built straight off the
equation will be noticeably less accurate than its neighbors. Match the neighbors,
or re-baseline the whole roster in one commit. Do not split the difference quietly.

---

## Level as the budget

Level does two separate jobs, and it is the only balance number in the system.

It sets the monster's own numbers. HP is about 4.5 per level (a d8 per level, plus
CON). To-hit comes off the 0.75 equation above. The six stat mods scale with level
too, rather than being rolled independently. Set the level and most of the block
follows.

It also prices the monster in a fight. Two rules:

- **1:1.** A monster of level N is a fair fight for one PC of level N. A level-1 orc
  against a 1st-level PC is a real fight that either side can lose.
- **Group.** Sum the levels on both sides and match them. Four 3rd-level PCs are 12
  points, so 12 points of monsters is a standard challenge: three level-4 monsters,
  or a level-8 boss with two level-2 minions, or a pile of level-1 and level-2
  chaff. The shape is yours. The sum is the budget.

The known weakness of the sum rule is action economy. Twelve level-1 monsters and
three level-4 monsters both cost 12, but the twelve get twelve attacks a round
against a party that gets four. The sum is a starting point for the encounter, not
a promise about it. Lean the budget down when you spend it on bodies.

### What that means here

Nothing in the engine computes this. `rollEncounter` picks one monster type by
weight from the depth band, rolls a count up to `packMax`, and adds a little for
party size (`encounters.js:24`). Zone tables do the same (`zones.js:161`). No level
arithmetic exists anywhere in that path. The budget is therefore enforced entirely
by two numbers you choose when you add a monster: its depth band, and its
`packMax`. If a level-2 monster ships with `packMax: 5`, you have authorized a
10-point encounter at depth 2, and nothing downstream will argue.

Pricing the PC side needs one conversion first. Heroes carry a real level
(`heroGrowth.level`, starting at 1) and the party is usually two or three of them,
but in dragon mode the dragon fights alongside them with a *tier* instead of a
level. By HP, the tiers price out at roughly:

| Tier | HP | Level-equivalent | To-hit vs equation |
|---|---|---|---|
| wyrmling | 18 | ~4 | +4 (equation wants +3) |
| young | 30 | ~6 | +6 (wants +5) |
| adult | 52 | ~11 | +9 (wants +9) |
| ancient | 90 | ~19 | +13 (wants +15) |

So a wyrmling plus two 1st-level heroes is about a 6-point party, and the dragon is
most of it. Worth knowing before hand-tuning any depth-1 encounter.

That table also sharpens the roster finding above. The dragon's own to-hit tracks
the equation within +1 and drifts *low* at ancient, while the monsters average +1.5
high. The hot to-hit is not a global scale shift applied to everything. It is on
the monster side only.

---

## The talent bank

The zine's back half is a bank of talent names with one-line effects, sorted by type
(innate, then attack, defensive, magical, and so on). Treat it as vocabulary rather
than as a menu. Three things it teaches:

One name covers many entries. The bank holds four separate "Corrosive" talents and
five separate "Golem" talents, differing only in what dissolves or in what heals the
monster. The name is a theme. Each entry is one setting of that theme.

Every number in a talent is a dial. Damage dice (count *and* size), DC, damage type,
and the stat being checked all move freely. Poison is the zine's own example: the
same talent runs from a low DC and 1d4 damage up to a high DC and a death timer
measured in hours. Changing the dials is not house-ruling, it is the intended use.

Reskin before you invent. Pull the closest existing talent, turn the dials, rewrite
the flavor. A brand-new mechanic is the last resort. Here it is also the expensive
one, because a new mechanic means engine work.

---

## What this means in `data/monsters.js`

The roster is 36 entries of pure data, banded by depth, with no logic in the file.
Adding one entry is enough to put a monster into the encounter pool.

Engine-backed fields, and what actually reads them:

| Field | Engine behavior |
|---|---|
| `ac`, `hpMax`, `abilities`, `attacks` | The core block. `attacks` is a list of `{ name, toHit, damage, range }`; damage is the die *only*, no ability bonus added. |
| `ability` | Exactly three keywords are implemented: `regenerate` (+2 HP at the start of its turn), `relentless` (the first killing blow leaves it at 1 HP), `lifedrain` (heals half the damage its attacks deal). See `combat.js:382`, `:512`, `:535`. |
| `cast` | `{ name, tier, kind, dice, chance }`. `kind` is `bolt`, `heal`, `daze`, or `drain`. `chance` is the per-turn probability it casts instead of attacking. DC is 10 + tier (`rules.js:217`). `castStat` picks the powering ability. |
| `resist` / `vulnerable` | Half or double damage. Live damage types are `physical`, `fire`, `drain`, `poison`, `acid`. Anything else is inert. |
| `morale` | Bonus on a d20 against `MORALE_DC` 12. `null` means it never checks: undead, constructs, oozes. |
| `packMax` | Shadowdark's "number appearing" ceiling. Swarms 4–5, mid creatures 2–3, brutes and bosses 1. |
| `weight`, `minDepth`, `maxDepth` | Random-encounter roll. `weight: 0` keeps a finished monster out of every roll until a zone table or a boss pack names it. |
| `faction`, `parley` | Reputation bucket, and whether Talk is possible at all (`willing` / `wary` / `never`). |
| `harvest` | What a beast may leave behind. Beasts carry no purse, so this is what killing one is worth. |
| `goldValue` | Loot on the corpse. Zero for animals. |
| `undead`, `regen`, `isBoss` | Undead flag for turn/drain interactions, flat HP knitted back each turn, and boss-pack members that domination cannot touch. |

**There is no `level` field.** Depth stands in for it, and the mapping is roughly
depth ≈ level: depth 1 monsters sit near 5 HP, depth 3 near 14, depth 5 near 24,
depth 8 near 40. Run step 6 of the benchmark anyway, then write the intended level
into a comment next to `hpMax`. Otherwise the next session has to reverse-engineer
it from the HP.

---

## Porting a zine talent into this engine

Work down this list and stop at the first move that works.

1. **Map it to an existing keyword.** Regenerate, Relentless, and Life Drain already
   exist, and a lot of bank talents are those three wearing a different name.
2. **Express it as numbers.** "Fearless" and "Undead" are `morale: null`. "Immune to
   fire" is `resist: ['fire']`. A gaze that stuns is a `cast` of kind `daze`. Most of
   the bank reduces to a field, not to code.
3. **Cut it.** "Cannot be surprised" needs a surprise system, and there isn't one.
   Dead flavor on a stat block is worse than no flavor, because the next session
   will assume it works.
4. **Build it.** Only if the talent is the reason the monster exists. That is engine
   work in `combat.js` plus a keyword, and it belongs in its own commit, separate
   from the monster.

The failure mode to watch for is tags that read plausibly and do nothing.
`resist: ['cold']` is inert, because nothing in the game deals cold damage. Check
the live type list above before inventing a tag.

---

## Checklist for a new monster

- Which of the three build options is this? Use the cheapest one that fits.
- Intended level chosen first, and written into a comment.
- `hpMax` = LV × 4.5 + CON mod.
- `toHit` = `ceil(0.75 × LV)`, shifted −2 to +2 against a trained human of that LV.
  Check it against the depth-band neighbors before committing (this roster runs
  about +1.5 hot).
- 1–3 attacks, small dice, no flat ability bonus on damage.
- Every talent either maps to an implemented keyword, reduces to a field, or is cut.
- `resist` / `vulnerable` use only live damage types.
- `morale: null` if it is undead, a construct, or an ooze.
- `packMax` matches how the thing actually shows up, and `packMax × LV` is an
  encounter budget you are comfortable handing to a party at that depth.
- `weight: 0` if the art or the placement isn't ready. It will sit quietly.
- `faction` and `parley` set, so Talk knows what to do with it.
- A one-line flavor comment saying what it *is*. That line is the monster's type,
  size, and tactics, and it is the only place they exist.

Whenever the numbers and the vibe disagree, change the numbers. That is the one
piece of advice the zine repeats, and it is the right default here too.
