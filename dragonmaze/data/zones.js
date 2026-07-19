// Hand-authored zones adapted from the 5e/EverQuest adventure writeups in
// dungeons/ (Ruins of Guk; The Lost Temple of Cazic-Thule). Pure data.
//
// Map legend: '#' wall · '.' floor · 'S' start · 'E' exit
//             'M' encounter · 'L' loot · 'B' boss encounter
// Every map must be rectangular; every floor tile reachable from S.
//
// table: weighted wandering-monster picks (ids from data/monsters.js).
// boss: the fixed pack waiting on the 'B' tile, with a name for the log.
// difficulty: plays the role of procedural depth for loot and exit bonus.

export const ZONES = [
  {
    id: 'upper-guk',
    name: 'Upper Guk',
    blurb: 'The drowned froglok city — flooded streets, mushroom farms, and crypts.',
    subregions: [
      {
        id: 'sunken-gate',
        name: 'The Sunken Gate & City Labyrinth',
        blurb: 'Flooded streets wind from the broken gate into the old township.',
        difficulty: 1,
        table: [
          { id: 'froglok-skirmisher', weight: 3, packMax: 2 },
          { id: 'giant-rat', weight: 2, packMax: 3 },
          { id: 'giant-spider', weight: 2, packMax: 2 },
        ],
        boss: { name: 'The gate-watch', monsterIds: ['froglok-skirmisher', 'froglok-skirmisher'] },
        map: [
          '###############',
          '#S....#...M..L#',
          '#.###.#.#####.#',
          '#.#...#.#...#.#',
          '#.#.###.#.M.#.#',
          '#.#..L#.#.#.#.#',
          '#.###.#.#.#.#.#',
          '#...#.M.#.#...#',
          '###.#####.##.##',
          '#L...B....#..E#',
          '###############',
        ],
      },
      {
        id: 'mushroom-crypts',
        name: 'The Mushroom Farm & Crypts',
        blurb: 'Fungus warrens feed the city; below them, the dead have not stayed put.',
        difficulty: 2,
        table: [
          { id: 'froglok-skirmisher', weight: 2, packMax: 2 },
          { id: 'zombie', weight: 3, packMax: 2 },
          { id: 'giant-spider', weight: 2, packMax: 2 },
        ],
        boss: { name: 'A troll raider of Innothule', monsterIds: ['cave-troll'] },
        map: [
          '###############',
          '#S..#....L#..M#',
          '#...#.....#...#',
          '#.M.#..M..##.##',
          '#...#.....#...#',
          '##.####.###.#.#',
          '#....L#...#.#.#',
          '#.###.#.#.#.#.#',
          '#.#.M...#...#.#',
          '#.#####B###..E#',
          '###############',
        ],
      },
    ],
  },
  {
    id: 'lower-guk',
    name: 'Lower Guk',
    blurb: 'The war that never ended: the froglok king holds one half, the ghoul kingdom the other.',
    subregions: [
      {
        id: 'kings-redoubt',
        name: 'The Living Side — King’s Redoubt',
        blurb: 'Royal guards and minotaur mercenaries of the Underhorn hold the last froglok halls.',
        difficulty: 3,
        table: [
          { id: 'froglok-skirmisher', weight: 3, packMax: 3 },
          { id: 'cave-troll', weight: 1, packMax: 1 },
          { id: 'lizardfolk-warrior', weight: 1, packMax: 2 },
        ],
        boss: { name: 'Warlord Kaltusk of the Underhorn', monsterIds: ['minotaur', 'froglok-skirmisher'] },
        map: [
          '###############',
          '#S....M....#.L#',
          '#.########.#.##',
          '#.#..L#..#.#..#',
          '#.#.#.#M.#.##.#',
          '#.#.#.#..#....#',
          '#.#.#.##.#.####',
          '#.M.#....#....#',
          '#.####.#.####.#',
          '#....L.#..B..E#',
          '###############',
        ],
      },
      {
        id: 'ghoul-kingdom',
        name: 'The Dead Side — Ghoul Kingdom',
        blurb: 'Frenzied ghouls patrol tomb-warrens under the silt; the Ghoul Lord holds court below.',
        difficulty: 4,
        table: [
          { id: 'zombie', weight: 3, packMax: 3 },
          { id: 'skeleton', weight: 3, packMax: 2 },
          { id: 'bone-wraith', weight: 2, packMax: 1 },
        ],
        boss: { name: 'The Ghoul Lord’s court', monsterIds: ['bone-wraith', 'zombie', 'zombie'] },
        map: [
          '###############',
          '#S...M.......L#',
          '#.###.###.###.#',
          '#.###.###.###.#',
          '#..L......M...#',
          '#.###.###.###.#',
          '#.###.###.###.#',
          '#....M....L...#',
          '#.###.###.###.#',
          '#....B.......E#',
          '###############',
        ],
      },
    ],
  },
  {
    id: 'cazic-thule',
    name: 'The Lost Temple of Cazic-Thule',
    blurb: 'The god-city of fear in the Feerrott, held by the lizardfolk congregation of the Tae Ew.',
    subregions: [
      {
        id: 'overgrown-courtyard',
        name: 'The Overgrown Courtyard',
        blurb: 'Vines strangle the avenue of the faceless; the stone golem room still keeps its vigil.',
        difficulty: 2,
        table: [
          { id: 'lizardfolk-warrior', weight: 3, packMax: 2 },
          { id: 'giant-spider', weight: 2, packMax: 2 },
          { id: 'giant-rat', weight: 1, packMax: 3 },
        ],
        boss: { name: 'The golem of the courtyard', monsterIds: ['stone-golem'] },
        map: [
          '###############',
          '#S...........L#',
          '#.##.#####.##.#',
          '#.#.........#.#',
          '#.#.#M#.#M#.#.#',
          '#...#.#.#.#...#',
          '#.#.#.#.#.#.#.#',
          '#.#..M....L.#.#',
          '#.##.##B##.##.#',
          '#L...#...#...E#',
          '###############',
        ],
      },
      {
        id: 'maze-of-doors',
        name: 'The Maze of Ten Thousand Doors',
        blurb: 'The Tae Ew broodmother nests at the heart of a warren built to swallow intruders.',
        difficulty: 3,
        table: [
          { id: 'lizardfolk-warrior', weight: 3, packMax: 3 },
          { id: 'zombie', weight: 2, packMax: 2 },
          { id: 'giant-spider', weight: 2, packMax: 2 },
        ],
        boss: { name: 'The broodmother’s guard', monsterIds: ['lizardfolk-warrior', 'lizardfolk-warrior', 'lizardfolk-warrior'] },
        map: [
          '###############',
          '#S.#...#..L#..#',
          '#..#.#.#.#.#.M#',
          '#.##.#.#.#.#.##',
          '#..M.#...#....#',
          '##.#.###.####.#',
          '#..#...#.#..M.#',
          '#.####.#.#.####',
          '#.#..L.#.#..B.#',
          '#...##...##..E#',
          '###############',
        ],
      },
      {
        id: 'avatar-pyramid',
        name: 'The Avatar Pyramid',
        blurb: 'Silvered ranks guard the drowned tier; in the Chamber of the Hands, fear takes shape.',
        difficulty: 4,
        table: [
          { id: 'lizardfolk-warrior', weight: 2, packMax: 2 },
          { id: 'bone-wraith', weight: 2, packMax: 1 },
          { id: 'stone-golem', weight: 1, packMax: 1 },
        ],
        boss: { name: 'The Avatar’s Hands', monsterIds: ['bone-wraith', 'bone-wraith', 'stone-golem'] },
        map: [
          '###############',
          '#S............#',
          '#############.#',
          '###..M......L.#',
          '###.###########',
          '###...L.....###',
          '###########.###',
          '#####...M...###',
          '#####.#########',
          '#####.B..L...E#',
          '###############',
        ],
      },
    ],
  },
];

export function zoneById(id) {
  return ZONES.find((z) => z.id === id);
}
