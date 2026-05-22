import type { CharacterClass } from './types';

export const CLASSES: CharacterClass[] = [
  {
    id: 'fighter',
    name: 'Fighter',
    hitDie: 8,
    weapons: 'All weapons',
    armor: 'All armor and shields',
    description: 'Hardened warriors, masters of arms and armor.',
    features: [
      {
        name: 'Hauler',
        text: 'Add your Constitution modifier, if positive, to your gear slots.',
      },
      {
        name: 'Weapon Mastery',
        text: 'Choose one weapon. You gain +1 to attack and damage rolls with it. Your damage die is one step higher (d4→d6→d8→d10→d12).',
      },
      {
        name: 'Grit',
        text: 'Choose Strength or Dexterity. You have advantage on checks of that type to overcome an opposing force.',
      },
    ],
  },
  {
    id: 'priest',
    name: 'Priest',
    hitDie: 6,
    weapons: 'Club, crossbow, dagger, mace, longsword, staff, warhammer',
    armor: 'All armor and shields',
    description: 'Faithful servants of the gods, channelers of divine power.',
    features: [
      {
        name: 'Languages',
        text: 'You know Celestial OR Diabolic, in addition to your ancestry languages.',
      },
      {
        name: 'Turn Undead',
        text: 'You know the turn undead spell. It does not count against your number of known spells.',
      },
      {
        name: 'Deity',
        text: 'Choose a deity to serve. Your alignment must match your deity\'s.',
      },
    ],
    spellStat: 'WIS',
    startingSpellCount: 2,
  },
  {
    id: 'thief',
    name: 'Thief',
    hitDie: 4,
    weapons: 'Club, crossbow, dagger, shortbow, shortsword',
    armor: 'Leather armor, mithral chainmail',
    description: 'Stealthy rogues, masters of larceny and shadow.',
    features: [
      {
        name: 'Backstab',
        text: 'If you attack an unaware opponent with advantage, you deal an extra weapon die of damage. Add an extra weapon die at 3rd, 5th, 7th, and 9th level.',
      },
      {
        name: 'Thievery',
        text: 'You are trained in: climbing, sneaking and hiding, applying disguises, finding and disabling traps, delicate tasks (picking pockets, picking locks).',
      },
    ],
  },
  {
    id: 'wizard',
    name: 'Wizard',
    hitDie: 4,
    weapons: 'Dagger, staff',
    armor: 'None',
    description: 'Scholars of the arcane, wielders of spellcraft.',
    features: [
      {
        name: 'Languages',
        text: 'You know two additional common and two rare languages.',
      },
      {
        name: 'Learning Spells',
        text: 'You can permanently learn a new wizard spell of any tier you can cast from a scroll or spellbook by studying it for a week and succeeding on a DC 15 INT check.',
      },
    ],
    spellStat: 'INT',
    startingSpellCount: 3,
  },
];

export function getClass(id: string): CharacterClass | undefined {
  return CLASSES.find((c) => c.id === id);
}
