// Dice sanity (plan §4 checklist) + determinism checks.
// Run with: npm test  (plain node, no framework)

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { roll, d20, save } from '../src/engine/dice.js';
import { makeSeededRNG } from '../src/engine/rng.js';
import { generateDungeon } from '../src/world/maze.js';
import {
  tierAfterBanking,
  resolveBreathOn,
  rollBreathRecharge,
  moraleCheck,
  lootScale,
  resolveAttack,
} from '../src/engine/rules.js';
import { MONSTERS, monsterById } from '../data/monsters.js';
import { SPRITES, TILES } from '../src/assets-manifest.js';
import { SPELLS, spellById } from '../data/spells.js';
import { ZONES } from '../data/zones.js';
import { buildZoneDungeon } from '../src/world/zones.js';
import { FAMILIARS } from '../data/familiars.js';
import { ITEMS } from '../data/items.js';
import { bumpDamage, victoryDropChance, levelForXp, LEVEL_XP } from '../src/engine/rules.js';
import * as gameState from '../src/state/gameState.js';
import { portalToCompanion } from '../src/state/importHero.js';
import { COMPANIONS, companionById } from '../data/party.js';
import { resolveSpellCast } from '../src/engine/rules.js';
import { makeCombatant, makeDragonCombatant } from '../src/engine/entities.js';
import { tierByName } from '../data/dragonProgression.js';
import {
  createCombat,
  runMonsterTurns,
  playerSpell,
  isPlayerTurn,
  livingMonsters,
} from '../src/engine/combat.js';

const N = 10_000;
let passed = 0;

function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok — ${name}`);
}

// ---- each die type: min/max/mean in range over 10k rolls
for (const sides of [4, 6, 8, 10, 12, 20]) {
  check(`1d${sides} x ${N}`, () => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const r = roll(`1d${sides}`);
      assert.equal(r.rolls.length, 1);
      min = Math.min(min, r.total);
      max = Math.max(max, r.total);
      sum += r.total;
    }
    assert.equal(min, 1, `d${sides} should reach 1`);
    assert.equal(max, sides, `d${sides} should reach ${sides}`);
    const mean = sum / N;
    const expected = (sides + 1) / 2;
    const tolerance = sides * 0.035 + 0.05; // ~10σ for 10k rolls
    assert.ok(
      Math.abs(mean - expected) < tolerance,
      `d${sides} mean ${mean.toFixed(3)} not within ${tolerance} of ${expected}`
    );
  });
}

// ---- compound expressions
check('2d6+1 bounds and mean', () => {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const r = roll('2d6+1');
    min = Math.min(min, r.total);
    max = Math.max(max, r.total);
    sum += r.total;
  }
  assert.ok(min >= 3 && max <= 13, `bounds ${min}..${max} outside 3..13`);
  assert.ok(Math.abs(sum / N - 8) < 0.25, `mean ${sum / N} not near 8`);
});

check('3d6-2 never below 1 total bound', () => {
  for (let i = 0; i < 2000; i++) {
    const r = roll('3d6-2');
    assert.ok(r.total >= 1 && r.total <= 16);
  }
});

check('bad expressions throw', () => {
  for (const bad of ['', '2x6', 'd', '0d6', '2d1', 'banana']) {
    assert.throws(() => roll(bad), undefined, `should throw: ${bad}`);
  }
});

// ---- d20 advantage/disadvantage
check('advantage beats disadvantage on average', () => {
  let adv = 0;
  let dis = 0;
  for (let i = 0; i < N; i++) {
    adv += d20({ advantage: true }).total;
    dis += d20({ disadvantage: true }).total;
  }
  assert.ok(adv / N > 12.5 && adv / N < 15.2, `advantage mean ${adv / N}`);
  assert.ok(dis / N > 5.8 && dis / N < 8.5, `disadvantage mean ${dis / N}`);
});

check('save() compares vs DC', () => {
  const s = save(10, 100);
  assert.equal(s.success, true);
  const f = save(30, -100);
  assert.equal(f.success, false);
});

// ---- seeded RNG determinism
check('same seed, same stream', () => {
  const a = makeSeededRNG('lost-temple');
  const b = makeSeededRNG('lost-temple');
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

check('different seeds diverge', () => {
  const a = makeSeededRNG('guk-alpha');
  const b = makeSeededRNG('guk-beta');
  const same = Array.from({ length: 20 }, () => a() === b()).filter(Boolean).length;
  assert.ok(same < 20, 'streams should not be identical');
});

// ---- maze determinism (plan checklist: same seed → same maze)
check('same seed produces the identical dungeon', () => {
  const a = generateDungeon('dragon-seed-1', 1);
  const b = generateDungeon('dragon-seed-1', 1);
  assert.deepEqual(a, b);
});

check('different seed produces a different dungeon', () => {
  const a = generateDungeon('dragon-seed-1', 1);
  const b = generateDungeon('dragon-seed-2', 1);
  assert.notDeepEqual(a.tiles, b.tiles);
});

check('dungeon is well-formed and connected', () => {
  for (const seed of ['a', 'b', 'c', 'xyzzy', '12345']) {
    const d = generateDungeon(seed, 1);
    assert.equal(d.tiles.length, d.height);
    assert.equal(d.tiles[0].length, d.width);
    assert.equal(d.tiles[d.start.y][d.start.x], 1, 'start is floor');
    assert.equal(d.tiles[d.exit.y][d.exit.x], 1, 'exit is floor');
    assert.ok(d.encounters.length >= 3 && d.encounters.length <= 5);
    assert.ok(d.loot.length <= 4);
    for (const l of d.loot) {
      assert.ok(l.gold >= 1 || l.tome || l.den || l.cache, 'loot has gold or is a special find');
    }
    // flood-fill: every floor tile reachable from start
    const seen = new Set([`${d.start.x},${d.start.y}`]);
    const queue = [[d.start.x, d.start.y]];
    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (
          nx >= 0 && nx < d.width && ny >= 0 && ny < d.height &&
          d.tiles[ny][nx] === 1 && !seen.has(`${nx},${ny}`)
        ) {
          seen.add(`${nx},${ny}`);
          queue.push([nx, ny]);
        }
      }
    }
    let floors = 0;
    for (const row of d.tiles) for (const t of row) if (t === 1) floors++;
    assert.equal(seen.size, floors, `all floor tiles reachable (seed ${seed})`);
  }
});

// ---- Phase 1 rules
check('tier-ups are hoard-gated (Shadowdark scale: 300 gold is a fortune)', () => {
  assert.deepEqual(tierAfterBanking('wyrmling', 299), []);
  assert.deepEqual(tierAfterBanking('wyrmling', 300).map((t) => t.tier), ['young']);
  assert.deepEqual(tierAfterBanking('wyrmling', 1500).map((t) => t.tier), ['young', 'adult']);
  assert.deepEqual(tierAfterBanking('young', 1199), []);
  assert.deepEqual(tierAfterBanking('ancient', 999999), []);
});

check('breath save halves damage', () => {
  const alwaysHigh = () => 0.99; // d20 = 20
  const alwaysLow = () => 0; // d20 = 1
  const nimble = { abilities: { dex: 2 } };
  const saved = resolveBreathOn(nimble, 13, 11, alwaysHigh);
  assert.equal(saved.saved, true);
  assert.equal(saved.damage, 5); // floor(11/2)
  const caught = resolveBreathOn(nimble, 13, 11, alwaysLow);
  assert.equal(caught.saved, false);
  assert.equal(caught.damage, 11);
  assert.equal(resolveBreathOn(nimble, 13, 1, alwaysHigh).damage, 1, 'half damage never below 1');
});

check('breath recharge on 5+', () => {
  for (let i = 0; i < 2000; i++) {
    const r = rollBreathRecharge();
    assert.ok(r.roll >= 1 && r.roll <= 6);
    assert.equal(r.ready, r.roll >= 5);
  }
});

check('morale: fearless never breaks, cowards can', () => {
  const skeleton = monsterById('skeleton');
  assert.equal(skeleton.morale, null);
  assert.equal(moraleCheck(skeleton).pass, true);
  const rat = { morale: -2 };
  assert.equal(moraleCheck(rat, () => 0).pass, false); // d20=1, total -1 vs 12
  assert.equal(moraleCheck(rat, () => 0.99).pass, true); // d20=20, total 18 vs 12
});

check('advantage rolls twice and keeps best', () => {
  const seq = [0.1, 0.9, 0.5]; // d20: 3, then 19; damage d6: 4
  let i = 0;
  const rng = () => seq[i++];
  const attacker = { abilities: {} };
  const res = resolveAttack(attacker, { name: 'bite', toHit: 4, damage: '1d6' }, { ac: 15 }, rng, { advantage: true });
  assert.equal(res.mode, 'advantage');
  assert.deepEqual(res.dieRolls, [3, 19]);
  assert.equal(res.natural, 19);
  assert.equal(res.hit, true);
});

check('loot scales with depth', () => {
  assert.equal(lootScale(1), 1);
  assert.ok(lootScale(4) > lootScale(2));
});

check('encounters respect min/max depth', () => {
  for (const depth of [1, 2, 5]) {
    const d = generateDungeon(`depth-check-${depth}`, depth);
    for (const enc of d.encounters) {
      for (const id of enc.monsterIds) {
        const m = monsterById(id);
        assert.ok((m.minDepth ?? 1) <= depth, `${id} too deep for its minDepth at depth ${depth}`);
        assert.ok(depth <= (m.maxDepth ?? Infinity), `${id} should have retired by depth ${depth}`);
      }
    }
  }
});

check('sprite manifest is complete and every strip exists', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const [key, rel] of Object.entries(SPRITES)) {
    assert.ok(existsSync(join(root, rel)), `manifest entry ${key} missing on disk`);
  }
  for (const key of ['dragon-fly', 'dragon-up', 'dragon-down']) {
    assert.ok(SPRITES[key], `player strip ${key} not in manifest`);
  }
  for (const m of MONSTERS.filter((m) => m.anim)) {
    assert.ok(SPRITES[m.anim.idle], `${m.id} idle strip not in manifest`);
    assert.ok(SPRITES[m.anim.attack], `${m.id} attack strip not in manifest`);
  }
});

check('roster has sane stats', () => {
  assert.ok(MONSTERS.length >= 8, `roster size ${MONSTERS.length}`);
  for (const m of MONSTERS) {
    assert.ok(m.ac >= 8 && m.ac <= 20, `${m.id} ac`);
    assert.ok(m.hpMax >= 1, `${m.id} hp`);
    assert.ok(m.attacks.length >= 1, `${m.id} attacks`);
    assert.ok(m.goldValue > 0, `${m.id} gold`);
    roll(m.attacks[0].damage); // throws if the dice expression is malformed
  }
});

// ---- zones
check('every zone subregion is well-formed, connected, and deterministic', () => {
  for (const zone of ZONES) {
    for (let i = 0; i < zone.subregions.length; i++) {
      const sub = zone.subregions[i];
      const w = sub.map[0].length;
      for (const row of sub.map) assert.equal(row.length, w, `${zone.id}/${sub.id} rectangular`);
      for (const t of sub.table) assert.ok(monsterById(t.id), `${zone.id}/${sub.id} table id ${t.id}`);
      for (const id of sub.boss?.monsterIds ?? []) assert.ok(monsterById(id), `${zone.id}/${sub.id} boss id ${id}`);
      const a = buildZoneDungeon(zone.id, i, 'zone-seed');
      const b = buildZoneDungeon(zone.id, i, 'zone-seed');
      assert.deepEqual(a, b, `${zone.id}/${sub.id} deterministic`);
      assert.ok(a.start, `${zone.id}/${sub.id} has S`);
      assert.ok((a.exit && a.exit.x >= 0) || a.doors.length || a.edges || a.portals.length, `${zone.id}/${sub.id} has a way out`);
      // flood fill: every floor tile reachable from start
      const seen = new Set([`${a.start.x},${a.start.y}`]);
      const queue = [[a.start.x, a.start.y]];
      while (queue.length) {
        const [x, y] = queue.pop();
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx >= 0 && nx < a.width && ny >= 0 && ny < a.height &&
            a.tiles[ny][nx] === 1 && !seen.has(`${nx},${ny}`)
          ) {
            seen.add(`${nx},${ny}`);
            queue.push([nx, ny]);
          }
        }
      }
      let floors = 0;
      for (const row of a.tiles) for (const t of row) if (t === 1) floors++;
      assert.equal(seen.size, floors, `${zone.id}/${sub.id}: all floors reachable`);
      assert.ok(a.encounters.length >= 3, `${zone.id}/${sub.id} has encounters`);
      assert.ok(a.loot.length >= 1, `${zone.id}/${sub.id} has loot`);
      for (const p of sub.props ?? []) {
        assert.ok(TILES[p.key], `${zone.id}/${sub.id} prop key ${p.key}`);
        assert.ok(p.x >= 0 && p.x + p.w <= w && p.y >= 0 && p.y + p.h <= sub.map.length,
          `${zone.id}/${sub.id} prop ${p.key} in bounds`);
      }
    }
  }
});

// ---- spells & party
check('spellbook is well-formed and companion spells exist', () => {
  for (const s of SPELLS) {
    if (s.dice) roll(s.dice); // throws on a malformed expression
    assert.ok(['enemy', 'ally', 'all-enemies'].includes(s.target), `${s.id} target`);
    assert.ok(s.castDC >= 10 && s.castDC <= 15, `${s.id} castDC`);
  }
  for (const c of COMPANIONS) {
    for (const id of c.spells) assert.ok(spellById(id), `${c.id} knows unknown spell ${id}`);
    assert.ok(SPRITES[c.anim.idle] && SPRITES[c.anim.attack], `${c.id} strips in manifest`);
  }
});

check('spell casting: nat 20 works, nat 1 fizzles', () => {
  const caster = { abilities: { cha: 2 } };
  const spell = spellById('ember-bolt');
  assert.equal(resolveSpellCast(caster, spell, () => 0.99).success, true);
  assert.equal(resolveSpellCast(caster, spell, () => 0).success, false);
});

check('Beren cows beasts: wild monsters check morale at disadvantage', () => {
  const snake = makeCombatant(monsterById('giant-snake')); // faction 'wild'
  assert.equal(snake.faction, 'wild');
  assert.ok(companionById('beren').traits.includes('beast-dread'), 'Beren has beast-dread');
  assert.ok(moraleCheck(snake, () => 0.95, false).pass, 'a nat-20 holds without disadvantage');
  let i = 0;
  const rolls = [0.95, 0.05]; // disadvantage keeps the worse of the two (nat 2)
  const res = moraleCheck(snake, () => rolls[i++], true);
  assert.ok(!res.pass && res.disadvantage, 'disadvantage takes the worse roll and routs');
});

check('drain life steals at most half the damage', () => {
  const spawnee = makeCombatant(companionById('spawnee'));
  spawnee.hp.current = 1;
  const rat = makeCombatant(monsterById('giant-rat'));
  rat.hp.current = rat.hp.max = 100;
  const { combat } = createCombat([spawnee], [rat], () => 0.5);
  while (combat.order[combat.turnIndex].id !== spawnee.id)
    combat.turnIndex = (combat.turnIndex + 1) % combat.order.length;
  const evs = playerSpell(combat, 'drain-life', rat.id, () => 0.99); // 1d8 -> 8 damage
  const hit = evs.find((e) => e.type === 'spell-hit');
  assert.equal(hit.damage, 8);
  assert.equal(hit.drained, 4, 'lifesteal capped at half of 8');
});

check('resistances, abilities, familiars, and tomes hold together', () => {
  // typed damage via a real fight: a skeleton resists physical bites
  const dragon = makeDragonCombatant(tierByName('wyrmling'));
  const skeleton = makeCombatant(monsterById('skeleton'));
  assert.deepEqual(skeleton.resist, ['physical']);
  assert.deepEqual(skeleton.vulnerable, ['fire']);
  const zombie = makeCombatant(monsterById('zombie'));
  assert.equal(zombie.ability, 'relentless');
  const troll = makeCombatant(monsterById('cave-troll'));
  assert.equal(troll.ability, 'regenerate');
  const templar = makeCombatant(monsterById('tae-ew-templar'));
  assert.equal(templar.ability, 'lifedrain');
  assert.ok(SPRITES[templar.anim.idle] && SPRITES[templar.anim.attack], 'tae ew templar strips');
  // dragon with tome spells and a familiar
  const mage = makeDragonCombatant(tierByName('wyrmling'), null, {
    spells: ['ember-bolt'],
    familiar: 'ember-wisp',
  });
  assert.deepEqual(mage.spells, ['ember-bolt']);
  assert.equal(mage.familiar, 'ember-wisp');
});

check('spellblade companion and familiars are well-formed', () => {
  assert.equal(FAMILIARS.length, 3);
  for (const f of FAMILIARS) assert.ok(f.id && f.name && f.blurb);
  const sb = companionById('dragonkin-spellblade');
  assert.ok(sb, 'spellblade exists');
  for (const id of sb.spells) assert.ok(spellById(id));
  assert.ok(SPRITES[sb.anim.idle] && SPRITES[sb.anim.attack], 'spellblade strips');
});

check('bumpDamage folds flat bonuses into dice expressions', () => {
  assert.equal(bumpDamage('1d8+2', 1), '1d8+3');
  assert.equal(bumpDamage('2d6', 2), '2d6+2');
  assert.equal(bumpDamage('1d6+2', -2), '1d6');
  assert.equal(bumpDamage('1d8+2', 0), '1d8+2');
  roll(bumpDamage('1d8+2', 3)); // stays parseable
});

check('victory drops favor bosses', () => {
  assert.equal(victoryDropChance(true), 0.5);
  assert.equal(victoryDropChance(false), 0.08);
  assert.ok(victoryDropChance(true) > victoryDropChance(false));
});

check('items are well-formed', () => {
  for (const item of ITEMS) {
    assert.ok(['weapon', 'armor', 'trinket'].includes(item.slot), `${item.id} slot`);
    assert.ok(Object.keys(item.mods).every((k) => ['toHit', 'damage', 'ac', 'hpMax', 'init'].includes(k)), `${item.id} mods`);
    assert.ok(item.blurb, `${item.id} blurb`);
  }
});

check('portal characters convert into sane companions', () => {
  const hero = portalToCompanion({
    id: 'abc123',
    name: 'Testa the Bold',
    classId: 'fighter',
    level: 3,
    stats: { STR: 16, DEX: 12, CON: 14, INT: 8, WIS: 10, CHA: 13 },
    hp: { max: 22, current: 22 },
    ac: 15,
    gear: [{ name: 'Longsword' }, { name: 'Shield' }],
    spells: [],
  });
  assert.ok(hero, 'converted');
  assert.equal(hero.abilities.str, 3);
  assert.equal(hero.abilities.int, -1);
  assert.equal(hero.ac, 15);
  assert.equal(hero.hpMax, 22);
  assert.equal(hero.attacks[0].toHit, 4); // str 3 + level/2
  assert.equal(hero.attacks[0].damage, '1d8+3');
  assert.ok(SPRITES[hero.anim.idle], 'anim strip exists');
  const caster = portalToCompanion({
    name: 'Wizzy', classId: 'wizard', level: 1,
    stats: { STR: 8, DEX: 12, CON: 10, INT: 16, WIS: 10, CHA: 12 },
    hp: { max: 6 }, ac: 11, gear: [{ name: 'Staff' }],
    spells: ['Burning Hands', 'Cure Wounds'],
  });
  assert.deepEqual(caster.spells.sort(), ['ember-bolt', 'healing-word']);
  assert.equal(portalToCompanion({ nonsense: true }), null);
  assert.equal(portalToCompanion(null), null);
});

check('Spawnee is the blue-skinned vampire spawn, with her powers', () => {
  const sp = companionById('spawnee');
  assert.ok(sp, 'spawnee exists');
  assert.equal(companionById('bard'), undefined);
  assert.equal(companionById('dragonkin-knight'), undefined);
  assert.ok(sp.undead && sp.ability === 'relentless' && sp.abilityLabel.includes('slowfall'));
  assert.deepEqual(sp.spells.sort(), ['dominate-undead', 'drain-life']);
  assert.ok(SPRITES['spawnee-idle'] && SPRITES['shadow-knight-idle']);
  assert.ok(!monsterById('lizardman-crusader').facesLeft, 'red dragonkin art faces right');
  for (const sid of sp.spells) assert.equal(spellById(sid).tome, false, `${sid} never in dragon tomes`);
});

check('drain and dominate behave', () => {
  const dragon = makeDragonCombatant(tierByName('wyrmling'));
  const spawnee = makeCombatant(companionById('spawnee'));
  spawnee.hp.current = 5;
  const skeleton = makeCombatant(monsterById('skeleton'));
  const troll = makeCombatant(monsterById('cave-troll'));
  const seq = [0.5, 0.6, 0.4, 0.3];
  let i = 0;
  const rng = () => (i < seq.length ? seq[i++] : 0.99);
  const { combat } = createCombat([dragon, spawnee], [skeleton, troll], rng);
  while (combat.order[combat.turnIndex].id !== spawnee.id) combat.turnIndex++;
  const evs = playerSpell(combat, 'drain-life', troll.id, () => 0.99);
  const hit = evs.find((e) => e.type === 'spell-hit');
  assert.ok(hit.drained > 0, 'drain heals the caster');
  assert.ok(spawnee.hp.current > 5, 'spawnee healed');
  while (combat.order[combat.turnIndex].id !== spawnee.id) {
    combat.turnIndex = (combat.turnIndex + 1) % combat.order.length;
  }
  const evs2 = playerSpell(combat, 'dominate-undead', skeleton.id, () => 0.99);
  assert.ok(evs2.some((e) => e.type === 'dominated'), 'skeleton dominated');
  assert.ok(skeleton.panicked, 'dominated undead will flee');
});

check('zone doors and boss drops reference real places and items', () => {
  const itemById = (id) => ITEMS.find((i) => i.id === id);
  for (const zone of ZONES) {
    const ids = new Set(zone.subregions.map((sr) => sr.id));
    for (const sub of zone.subregions) {
      for (const dest of Object.values(sub.doors ?? {})) {
        assert.ok(dest === 'surface' || ids.has(dest), `${zone.id}/${sub.id} door to ${dest}`);
      }
      for (const dest of Object.values(sub.edges ?? {})) {
        assert.ok(ids.has(dest), `${zone.id}/${sub.id} edge to ${dest}`);
      }
      for (const p of sub.portals ?? []) {
        assert.ok(ids.has(p.to), `${zone.id}/${sub.id} portal to ${p.to}`);
      }
      for (const itemId of sub.boss?.drops ?? []) {
        assert.ok(itemById(itemId), `${zone.id}/${sub.id} boss drop ${itemId}`);
      }
      assert.ok(sub.theme, `${zone.id}/${sub.id} theme`);
    }
  }
  for (const item of ITEMS) {
    assert.ok(['upper-guk', 'lower-guk', 'lost-temple'].includes(item.zone), `${item.id} zone`);
  }
});

check('edge-linked sub-areas connect back reciprocally', () => {
  const opp = { n: 's', s: 'n', e: 'w', w: 'e' };
  for (const zone of ZONES) {
    const byId = new Map(zone.subregions.map((s) => [s.id, s]));
    for (const sub of zone.subregions) {
      for (const [dir, dest] of Object.entries(sub.edges ?? {})) {
        const nb = byId.get(dest);
        assert.ok(nb, `${sub.id} edge ${dir} -> unknown ${dest}`);
        assert.equal(nb.edges?.[opp[dir]], sub.id, `${dest} should link ${opp[dir]} back to ${sub.id}`);
      }
    }
  }
  // the courtyard is the four-quadrant proof of the mechanic
  const temple = ZONES.find((z) => z.id === 'lost-temple');
  const quads = ['courtyard-nw', 'courtyard-ne', 'courtyard-sw', 'courtyard-se'];
  for (const q of quads) assert.ok(temple.subregions.find((s) => s.id === q), `courtyard has ${q}`);
  assert.equal(temple.subregions[0].id, 'courtyard-nw', 'zone entry is the courtyard gate');
});

check('wall-doors have interior entries, directions, and valid bosses', () => {
  for (const zone of ZONES) {
    for (let i = 0; i < zone.subregions.length; i++) {
      const sub = zone.subregions[i];
      const d = buildZoneDungeon(zone.id, i, 'doortest');
      for (const door of d.doors) {
        assert.ok(d.tiles[door.y][door.x] === 0, `${zone.id}/${sub.id} door ${door.ch} is on a wall`);
        assert.ok(d.tiles[door.entry.y][door.entry.x] === 1, `${zone.id}/${sub.id} door ${door.ch} entry is floor`);
        assert.ok(Math.abs(door.dir.dx) + Math.abs(door.dir.dy) === 1, `${zone.id}/${sub.id} door ${door.ch} dir`);
      }
      // every referenced boss/miniboss monster exists
      for (const id of sub.boss?.monsterIds ?? []) assert.ok(monsterById(id), `${zone.id}/${sub.id} boss id ${id}`);
      for (const id of sub.miniboss?.monsterIds ?? []) assert.ok(monsterById(id), `${zone.id}/${sub.id} miniboss id ${id}`);
    }
  }
  // the pyramid carries a mini-boss
  const pyramid = ZONES.find((z) => z.id === 'lost-temple').subregions.find((s) => s.id === 'archon-pyramid');
  assert.ok(pyramid.miniboss, 'pyramid has a mini-boss');
});

check('new companions and monster art are wired', () => {
  for (const id of ['beren', 'turquoise']) {
    const c = companionById(id);
    assert.ok(c, `${id} exists`);
    assert.ok(SPRITES[c.anim.idle] && SPRITES[c.anim.attack] && SPRITES[c.walk], `${id} strips`);
    assert.ok(c.blurb, `${id} blurb`);
  }
  for (const id of ['clay-golem', 'iron-golem', 'avatar-of-fear', 'gargoyle', 'giant-snake', 'fungus-man']) {
    const m = monsterById(id);
    assert.ok(m, `${id} exists`);
    assert.ok(SPRITES[m.anim.idle] && SPRITES[m.anim.attack], `${id} strips`);
  }
});

check('casting keys off the class stat, and the swashbuckler is spell-free', () => {
  // spellblade casts on INT (+3), not CHA (+1)
  const sb = makeCombatant(companionById('dragonkin-spellblade'));
  assert.equal(sb.castStat, 'int');
  const cast = resolveSpellCast(sb, spellById('ember-bolt'), () => 0.5); // d20 = 11
  assert.equal(cast.stat, 'int');
  assert.equal(cast.bonus, sb.abilities.int);
  // spawnee casts on CHA
  assert.equal(makeCombatant(companionById('spawnee')).castStat, 'cha');
  // the swashbuckler no longer casts anything
  assert.deepEqual(companionById('dragonkin-swashbuckler').spells, []);
  // imported casters pick up the right stat by class
  const wiz = portalToCompanion({
    name: 'Wiz', classId: 'wizard', level: 1,
    stats: { STR: 8, DEX: 12, CON: 10, INT: 16, WIS: 10, CHA: 12 },
    hp: { max: 6 }, ac: 11, gear: [{ name: 'Dagger' }], spells: ['Magic Missile'],
  });
  assert.equal(wiz.castStat, 'int');
  const priest = portalToCompanion({
    name: 'Cler', classId: 'priest', level: 1,
    stats: { STR: 12, DEX: 10, CON: 12, INT: 8, WIS: 16, CHA: 10 },
    hp: { max: 8 }, ac: 13, gear: [{ name: 'Mace' }], spells: ['Cure Wounds'],
  });
  assert.equal(priest.castStat, 'wis');
});

check('party combat: monsters fight heroes, heals can revive', () => {
  const dragon = makeDragonCombatant(tierByName('wyrmling'));
  const downed = makeCombatant(companionById('spawnee'));
  const healer = makeCombatant(companionById('dragonkin-spellblade')); // the arcane healer
  assert.ok(healer.spells.includes('healing-word'), 'spellblade knows Healing Word');
  const troll = makeCombatant(monsterById('cave-troll'));
  const seq = [0.5, 0.6, 0.4, 0.3]; // initiative rolls, then combat dice
  let i = 0;
  const rng = () => (i < seq.length ? seq[i++] : 0.99);
  const { combat } = createCombat([dragon, downed, healer], [troll], rng);
  assert.equal(combat.order.length, 4);
  runMonsterTurns(combat, rng);
  assert.ok(isPlayerTurn(combat), 'a hero should be up after monster turns');

  // knock a companion down, then Healing Word them back up mid-fight
  downed.hp.current = 0;
  healer.burned = [];
  while (combat.order[combat.turnIndex].id !== healer.id) combat.turnIndex++;
  const events = playerSpell(combat, 'healing-word', downed.id, () => 0.99);
  const heal = events.find((e) => e.type === 'spell-heal');
  assert.ok(heal, 'heal event emitted');
  assert.equal(heal.revived, true);
  assert.ok(downed.hp.current > 0, 'companion revived');
  assert.equal(livingMonsters(combat).length, 1);
});

// ---- leveling & party-only mode
check('gold-as-XP levels follow the thresholds', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(49), 1);
  assert.equal(levelForXp(50), 2);
  assert.equal(levelForXp(120), 3);
  assert.equal(levelForXp(999999), LEVEL_XP.length);
});

check('growth choices fold into the hero template', () => {
  const game = gameState;
  game.state.meta.heroGrowth = {
    spawnee: { xp: 200, level: 3, pending: 0, choices: [{ type: 'hp' }, { type: 'hp' }, { type: 'ac' }, { type: 'attack' }, { type: 'spell', spellId: 'ember-bolt' }] },
  };
  const grown = game.heroWithGrowth('spawnee');
  const base = companionById('spawnee');
  assert.equal(grown.hpMax, base.hpMax + 4);
  assert.equal(grown.ac, base.ac + 1);
  assert.equal(grown.attacks[0].toHit, base.attacks[0].toHit + 1);
  assert.ok(grown.spells.includes('ember-bolt'));
  assert.ok(grown.spells.includes('drain-life'), 'base spells kept');

  // chooseAdvance guards: no pending -> no change; vampire spells unlearnable
  game.chooseAdvance('spawnee', 'hp');
  assert.equal(game.state.meta.heroGrowth.spawnee.choices.length, 5);
  game.state.meta.heroGrowth.spawnee.pending = 1;
  game.chooseAdvance('spawnee', 'spell', 'dominate-undead');
  assert.equal(game.state.meta.heroGrowth.spawnee.pending, 1, 'vampire powers cannot be chosen');
  game.chooseAdvance('spawnee', 'spell', 'healing-word');
  assert.equal(game.state.meta.heroGrowth.spawnee.pending, 0);
});

check('a party without the dragon loses only when everyone is down', () => {
  const spawnee = makeCombatant(companionById('spawnee'));
  const swash = makeCombatant(companionById('dragonkin-swashbuckler'));
  const troll = makeCombatant(monsterById('cave-troll'));
  const { combat } = createCombat([spawnee, swash], [troll], () => 0.5);
  assert.equal(combat.order.length, 3);
  // one hero down and one standing: the troll's blow must not end it yet
  swash.hp.current = 0;
  spawnee.hp.current = 30; // sturdy for a moment
  combat.turnIndex = combat.order.findIndex((c) => c.id === troll.id);
  runMonsterTurns(combat, () => 0.7);
  assert.ok(!combat.over, 'fight continues while a hero stands');
  // last hero at 1 HP with slowfall spent: the next hit is defeat
  spawnee.relentlessUsed = true;
  spawnee.hp.current = 1;
  combat.turnIndex = combat.order.findIndex((c) => c.id === troll.id);
  runMonsterTurns(combat, () => 0.7);
  assert.equal(combat.winner, 'monsters', 'party wiped without a dragon');
});

check('companion walk strips exist for overworld duty', () => {
  for (const c of COMPANIONS) {
    assert.ok(c.walk && SPRITES[c.walk], `${c.id} walk strip`);
  }
});

console.log(`\n${passed} checks passed.`);
