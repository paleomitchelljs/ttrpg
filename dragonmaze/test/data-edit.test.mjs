// Round-trip tests for the surgical data-file serializers (data-edit.mjs), run
// against the REAL data files as strings (never writing them). Each edit is
// re-imported as a data: module to prove it parses and the value survived, and
// unrelated bytes are asserted byte-identical.
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  upsertEntry, rewriteZonesField, matchBracket, MONSTER_ORDER, ITEM_ORDER,
} from '../data-edit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFile(join(root, 'data', f), 'utf8');
const parse = (src) => import('data:text/javascript,' + encodeURIComponent(src));

// [start,end) of the object literal for `id` in an ARRAY-style source.
function entrySpan(src, id) {
  const i = new RegExp(`id:\\s*'${id}'`).exec(src).index;
  const s = src.lastIndexOf('{', i);
  return [s, matchBracket(src, s) + 1];
}
// assert only the region [a,b) of `before` changed in `after` (head+tail equal)
function onlyChanged(before, after, [a, b]) {
  assert.equal(before.slice(0, a), after.slice(0, a), 'head before the edit must be untouched');
  assert.equal(before.slice(b), after.slice(after.length - (before.length - b)), 'tail after the edit must be untouched');
}

let n = 0;
const ok = (m) => { console.log('  ok —', m); n++; };

// ---- monsters.js: edit in place -------------------------------------------
{
  const src = await read('monsters.js');
  const { MONSTERS } = await parse(src);
  const rat = structuredClone(MONSTERS.find((m) => m.id === 'giant-rat'));
  const span = entrySpan(src, 'giant-rat');
  rat.hpMax = 99; rat.name = "Rat o' the Deep"; // apostrophe must round-trip
  const next = upsertEntry(src, 'MONSTERS', rat, MONSTER_ORDER);
  const { MONSTERS: after } = await parse(next);
  const rat2 = after.find((m) => m.id === 'giant-rat');
  assert.equal(rat2.hpMax, 99);
  assert.equal(rat2.name, "Rat o' the Deep");
  assert.deepEqual(rat2.abilities, rat.abilities);
  assert.deepEqual(rat2.attacks, rat.attacks);
  assert.equal(after.length, MONSTERS.length, 'no entry added/lost on an edit');
  onlyChanged(src, next, span);
  ok('monster edit: fields round-trip, apostrophe survives, only the entry changed');
}

// ---- monsters.js: append a new enemy --------------------------------------
{
  const src = await read('monsters.js');
  const { MONSTERS } = await parse(src);
  const nu = {
    id: 'test-wight', name: 'Test Wight', kind: 'monster', ac: 13, hpMax: 22,
    abilities: { str: 2, dex: 0, con: 2, int: 0, wis: 0, cha: -1 },
    attacks: [{ name: 'chill touch', toHit: 4, damage: '1d8', range: 'melee' }],
    emoji: '👻', faction: 'undead', parley: 'never', minDepth: 3, packMax: 2, weight: 1, morale: null,
  };
  const next = upsertEntry(src, 'MONSTERS', nu, MONSTER_ORDER);
  const { MONSTERS: after } = await parse(next);
  assert.equal(after.length, MONSTERS.length + 1);
  assert.deepEqual(after.find((m) => m.id === 'test-wight'), nu);
  // the first monster's slice must be untouched by an append
  assert.ok(next.includes(src.slice(...entrySpan(src, 'giant-rat'))), 'existing entries untouched by append');
  ok('monster append: new entry parses back equal, existing entries intact');
}

// ---- items.js: edit (matchBracket must skip the apostrophe comment) --------
{
  const src = await read('items.js');
  const { ITEMS } = await parse(src);
  const it = structuredClone(ITEMS.find((i) => i.slot === 'weapon'));
  const span = entrySpan(src, it.id);
  it.mods = { ...it.mods, damage: 5 };
  const next = upsertEntry(src, 'ITEMS', it, ITEM_ORDER);
  const { ITEMS: after } = await parse(next);
  assert.equal(after.find((i) => i.id === it.id).mods.damage, 5);
  onlyChanged(src, next, span);
  ok('item edit: mods round-trip, comment apostrophe did not miscount');
}

// ---- zones.js: table, boss, miniboss ---------------------------------------
{
  const src = await read('zones.js');
  const { ZONES } = await parse(src);
  const subOf = (id) => ZONES.flatMap((z) => z.subregions).find((s) => s.id === id);

  // table: drop the crusader from archon-pyramid
  const newTable = subOf('archon-pyramid').table.filter((t) => t.id !== 'lizardman-crusader');
  let next = rewriteZonesField(src, 'archon-pyramid', 'table', newTable);
  let sub = (await parse(next)).ZONES.flatMap((z) => z.subregions).find((s) => s.id === 'archon-pyramid');
  assert.deepEqual(sub.table, newTable);
  assert.deepEqual(sub.boss, subOf('archon-pyramid').boss, 'boss untouched by a table edit');
  assert.deepEqual(sub.miniboss, subOf('archon-pyramid').miniboss, 'miniboss untouched by a table edit');

  // boss: rename + retarget
  const newBoss = { name: 'The Archon Reborn', monsterIds: ['lizardman-archon'], drops: ['rubicite-breastplate'] };
  next = rewriteZonesField(src, 'archon-pyramid', 'boss', newBoss);
  sub = (await parse(next)).ZONES.flatMap((z) => z.subregions).find((s) => s.id === 'archon-pyramid');
  assert.deepEqual(sub.boss, newBoss);
  assert.deepEqual(sub.table, subOf('archon-pyramid').table, 'table untouched by a boss edit');

  // miniboss: editing boss must not touch the miniboss and vice-versa
  const newMini = { name: 'The Lone Crusader', monsterIds: ['lizardman-crusader'] };
  next = rewriteZonesField(src, 'archon-pyramid', 'miniboss', newMini);
  sub = (await parse(next)).ZONES.flatMap((z) => z.subregions).find((s) => s.id === 'archon-pyramid');
  assert.deepEqual(sub.miniboss, newMini);
  assert.deepEqual(sub.boss, subOf('archon-pyramid').boss, 'boss untouched by a miniboss edit');
  ok('zone table/boss/miniboss: each edits independently and round-trips');

  // a sub in a different zone must be byte-identical after any of the above
  assert.ok(next.includes(src.slice(...(() => { const i = src.indexOf("id: 'courtyard-nw'"); const s = src.lastIndexOf('{', i); return [s, matchBracket(src, s) + 1]; })())), 'other subregions untouched');
  ok('zone edit leaves unrelated subregions byte-identical');
}

console.log(`\n${n} data-edit checks passed.`);
