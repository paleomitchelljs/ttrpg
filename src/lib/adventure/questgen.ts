// Random quest generator: stitches a fresh, one-session quest out of rooms
// sampled from across every authored adventure. Built for VERBAL play — the
// output is a GM storyboard (read-aloud prose + Brick Quest monster stats),
// not an engine module. The phone supplies dice; the Legos supply everything
// else.

import { ADVENTURES } from './data';
import type { AdvRoom } from './types';
import { getMonster, monstersByTier, type Monster } from '../shadowdark/monsters';
import { filterByActivePool } from '../shadowdark/activePool';
import { rollTreasure, type Treasure } from '../shadowdark/treasure';
import { rollTrap, type Trap } from '../shadowdark/traps';

export type QuestLength = 'short' | 'long';

/** A monster pre-converted to Brick Quest terms (see rules/brick-quest.yaml). */
export interface QuestMonster {
  name: string;
  icon?: string;
  count: number;
  /** Hearts per monster: small 1, medium 2, big 3, boss 5. */
  hearts: number;
  /** Beat this on 1d20 + Sword/Spark to hit it. */
  beat: number;
  /** Magic monsters attack Warding (10 + Ward) instead of Block. */
  magic: boolean;
  boss: boolean;
}

export interface QuestRoom {
  title: string;
  /** Read-aloud prose, lifted from the source adventure. */
  prose: string;
  /** Which adventure the room was sampled from (GM-facing credit). */
  from: string;
  monsters: QuestMonster[];
  trap?: Trap;
  treasure?: Treasure;
  finale: boolean;
}

export interface RandomQuest {
  goal: string;
  /** A GM-only secret that rewards Wisdom/Charisma over swords. */
  twist: string;
  rooms: QuestRoom[];
}

const GOALS = [
  'Rescue the baker’s kid, who followed a glowing moth inside and never came out.',
  'Steal back the village’s harvest gold before the new moon.',
  'Find the lost wizard — her tower is empty and her cat led you here.',
  'Break the curse that is turning the river black.',
  'Bring back the Sunstone, so the village lanterns will light again.',
  'Drive out the monster lord who has been scaring everyone’s sheep.',
  'Deliver a peace letter to the boss of this place — unopened.',
  'Find out what is making the terrible noise under the town every night.',
];

const TWISTS = [
  'One of the monsters in here hates its boss and will switch sides if someone speaks trickily to it (Charisma, beat 10).',
  'The boss does not want treasure — it wants an apology. The right words (Charisma, beat 13) end the quest without a fight.',
  'One room’s "monster" is actually guarding something it loves. Anyone who notices (Wisdom, beat 10) can win it over by helping.',
  'There is a hidden shortcut to the boss. The first hero to look carefully (Wisdom, beat 13) finds it and the party may skip one room.',
  'The treasure is cursed-but-curable: whoever carries it hears whispers until the party figures out it just wants to be returned somewhere.',
  'A small, harmless creature follows the party around. Being kind to it pays off in the boss room — it knows the boss’s weakness.',
  'The boss’s guards are only pretending to be loyal. A bribe or a joke (Charisma, beat 10) and they look the other way.',
  'Halfway through, a rival adventurer shows up wanting the same thing. They can become a friend (Charisma) or a nuisance — never a corpse.',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ───────── Brick Quest conversion ─────────

function monsterTier(m: Monster): 1 | 2 | 3 {
  if (m.tags.includes('tier-3')) return 3;
  if (m.tags.includes('tier-2')) return 2;
  if (m.tags.includes('tier-1')) return 1;
  return m.level <= 2 ? 1 : m.level <= 5 ? 2 : 3;
}

function toQuestMonster(m: Monster, count: number): QuestMonster {
  const boss = m.tags.includes('boss');
  const tier = monsterTier(m);
  return {
    name: m.name,
    icon: m.icon,
    count,
    hearts: boss ? 5 : tier === 3 ? 3 : tier,
    beat: boss ? 13 : tier === 3 ? 12 : tier === 2 ? 10 : 8,
    magic: m.tags.includes('caster'),
    boss,
  };
}

/** A room's own encounter, converted; same monster repeated becomes a count. */
function roomMonsters(room: AdvRoom): QuestMonster[] {
  if (!room.encounter) return [];
  const counts = new Map<string, number>();
  for (const id of room.encounter.monsters) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const out: QuestMonster[] = [];
  for (const [id, count] of counts) {
    const m = getMonster(id);
    if (m) out.push(toQuestMonster(m, count));
  }
  return out;
}

function randomMonsterOfTier(tier: 1 | 2 | 3): Monster | undefined {
  const list = monstersByTier(tier);
  const scoped = filterByActivePool(list);
  const pool = scoped.length > 0 ? scoped : list;
  return pool.length > 0 ? pick(pool) : undefined;
}

// ───────── Room sampling ─────────

/** Rooms worth sampling: real prose, no authored win/lose strings attached. */
function candidateRooms(): { room: AdvRoom; from: string }[] {
  const out: { room: AdvRoom; from: string }[] = [];
  for (const adv of ADVENTURES) {
    for (const room of adv.rooms) {
      if (!room.description || room.objective) continue;
      out.push({ room, from: adv.title });
    }
  }
  return out;
}

/** Round-robin across adventures so one dungeon never dominates a quest. */
function sampleRooms(count: number): { room: AdvRoom; from: string }[] {
  const byAdventure = new Map<string, { room: AdvRoom; from: string }[]>();
  for (const c of shuffle(candidateRooms())) {
    if (!byAdventure.has(c.from)) byAdventure.set(c.from, []);
    byAdventure.get(c.from)!.push(c);
  }
  const buckets = shuffle([...byAdventure.values()]);
  const picked: { room: AdvRoom; from: string }[] = [];
  let i = 0;
  while (picked.length < count && buckets.some((b) => b.length > 0)) {
    const bucket = buckets[i % buckets.length];
    const next = bucket.pop();
    if (next) picked.push(next);
    i++;
  }
  return picked;
}

// ───────── The generator ─────────

export function generateQuest(length: QuestLength = 'short'): RandomQuest {
  const roomCount = length === 'short' ? 4 : 7;
  const sampled = sampleRooms(roomCount);

  const rooms: QuestRoom[] = sampled.map(({ room, from }, idx) => {
    const finale = idx === sampled.length - 1;
    let monsters = roomMonsters(room);

    if (finale) {
      // The last room needs a boss. Keep the room's own if it has one;
      // otherwise invite one in from the bestiary.
      if (!monsters.some((m) => m.boss)) {
        const boss = randomMonsterOfTier(3);
        if (boss) monsters = [toQuestMonster({ ...boss, tags: [...boss.tags, 'boss'] }, 1), ...monsters];
      }
      // Boss leads; a boss plus a whole entourage is too much for kids.
      monsters.sort((a, b) => Number(b.boss) - Number(a.boss));
      monsters = monsters.slice(0, 2);
    } else if (monsters.length === 0 && Math.random() < 0.4) {
      // Empty room: sometimes wandering trouble finds the party anyway.
      const tier = (Math.random() < 0.7 ? 1 : 2) as 1 | 2;
      const m = randomMonsterOfTier(tier);
      if (m) monsters = [toQuestMonster(m, Math.random() < 0.5 ? 2 : 1)];
    } else {
      // Only the finale gets a boss: anything boss-grade sampled into the
      // middle of the quest is demoted to a big monster so it doesn't steal
      // the ending (or flatten the party in room two).
      monsters = monsters
        .map((m) => (m.boss ? { ...m, boss: false, hearts: 3, beat: 12 } : m))
        .slice(0, 3);
    }

    const trap = !finale && Math.random() < 0.3 ? rollTrap() : undefined;
    const treasure = finale
      ? rollTreasure(Math.random() < 0.3 ? 4 : 3)
      : Math.random() < 0.45
        ? rollTreasure(Math.random() < 0.7 ? 1 : 2)
        : undefined;

    return {
      title: room.name,
      prose: room.description,
      from,
      monsters,
      trap,
      treasure,
      finale,
    };
  });

  return { goal: pick(GOALS), twist: pick(TWISTS), rooms };
}

// ───────── Persistence (survives a locked phone mid-session) ─────────

const STORAGE_KEY = 'rpg-portal-random-quest';

export function saveQuest(quest: RandomQuest | null): void {
  try {
    if (quest) localStorage.setItem(STORAGE_KEY, JSON.stringify(quest));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage full or unavailable — the quest just won't survive a reload.
  }
}

export function loadQuest(): RandomQuest | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const q = JSON.parse(raw) as RandomQuest;
    return Array.isArray(q.rooms) && q.rooms.length > 0 ? q : null;
  } catch {
    return null;
  }
}
