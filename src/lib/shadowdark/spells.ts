import type { Spell } from './types';

// Tier 1 spells from the Shadowdark Quickstart.
export const SPELLS: Spell[] = [
  // Priest tier 1
  {
    name: 'Cure Wounds',
    tier: 1,
    type: 'Priest',
    duration: 'Instant',
    range: 'Close',
    text: 'Touched ally regains 1d6 HP per priest level, up to maximum.',
  },
  {
    name: 'Holy Weapon',
    tier: 1,
    type: 'Priest',
    duration: '5 rounds',
    range: 'Close',
    text: 'A weapon you touch gains +1 to attack and damage rolls. Only one Holy Weapon at a time.',
  },
  {
    name: 'Light',
    tier: 1,
    type: 'Priest',
    duration: '1 hour real time',
    range: 'Close',
    text: 'An object you touch glows with bright light, illuminating close range. Casting again ends prior Light.',
  },
  {
    name: 'Protection From Evil',
    tier: 1,
    type: 'Priest',
    duration: 'Focus',
    range: 'Close',
    text: 'A willing creature you touch has disadvantage on attacks against, and advantage on saves against, aberrations, demons, fiends, and undead.',
  },
  {
    name: 'Shield of Faith',
    tier: 1,
    type: 'Priest',
    duration: 'Focus',
    range: 'Self',
    text: 'A shimmering force grants you +2 AC.',
  },
  {
    name: 'Turn Undead',
    tier: 1,
    type: 'Priest',
    duration: 'Instant',
    range: 'Near',
    text: 'Each undead in near rebuked, fleeing for 5 rounds or until attacked. Mightier undead may resist.',
  },
  // Wizard tier 1
  {
    name: 'Alarm',
    tier: 1,
    type: 'Wizard',
    duration: '1 day real time',
    range: 'Close',
    text: 'You set a magical alarm on an object or area. It alerts you mentally when triggered.',
  },
  {
    name: 'Burning Hands',
    tier: 1,
    type: 'Wizard',
    duration: 'Instant',
    range: 'Close',
    text: 'A cone of flame erupts from your hands. Creatures in close take 1d6 damage. Flammable objects ignite.',
  },
  {
    name: 'Charm Person',
    tier: 1,
    type: 'Wizard',
    duration: '1d8 days real time',
    range: 'Close',
    text: 'A humanoid you target becomes friendly. They obey reasonable requests that don\'t endanger them.',
  },
  {
    name: 'Detect Magic',
    tier: 1,
    type: 'Wizard',
    duration: 'Focus',
    range: 'Near',
    text: 'You can sense the presence of magic within near range.',
  },
  {
    name: 'Floating Disk',
    tier: 1,
    type: 'Wizard',
    duration: '5 rounds',
    range: 'Close',
    text: 'A disk of magical force floats beside you, carrying up to 20 gear slots.',
  },
  {
    name: 'Hold Portal',
    tier: 1,
    type: 'Wizard',
    duration: '5 rounds',
    range: 'Close',
    text: 'You magically hold shut a door, gate, or other portal.',
  },
  {
    name: 'Light',
    tier: 1,
    type: 'Wizard',
    duration: '1 hour real time',
    range: 'Close',
    text: 'An object you touch glows with bright light, illuminating close range.',
  },
  {
    name: 'Magic Missile',
    tier: 1,
    type: 'Wizard',
    duration: 'Instant',
    range: 'Far',
    text: 'You launch a bolt of magical force. The target takes 1d4+1 damage.',
  },
  {
    name: 'Protection From Evil',
    tier: 1,
    type: 'Wizard',
    duration: 'Focus',
    range: 'Close',
    text: 'A willing creature you touch has disadvantage on attacks against, and advantage on saves against, aberrations, demons, fiends, and undead.',
  },
  {
    name: 'Sleep',
    tier: 1,
    type: 'Wizard',
    duration: 'Instant',
    range: 'Near',
    text: 'A group of nearby creatures fall into a deep sleep. Closes 2d8 HD worth, starting with lowest.',
  },
];

export function spellsForClass(classId: string): Spell[] {
  if (classId === 'wizard') return SPELLS.filter((s) => s.type === 'Wizard');
  if (classId === 'priest') return SPELLS.filter((s) => s.type === 'Priest');
  return [];
}

export function getSpell(name: string): Spell | undefined {
  return SPELLS.find((s) => s.name === name);
}
