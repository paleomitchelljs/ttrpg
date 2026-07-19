// Two PRNG channels, never shared (see plan §0):
//  - makeSeededRNG(seed): deterministic stream for ALL world generation
//    (maze layout, encounter placement, loot rolls)
//  - liveRNG: non-deterministic, for combat dice only

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic [0,1) stream from any seed string. */
export function makeSeededRNG(seedString) {
  return mulberry32(xmur3(String(seedString))());
}

/** Live randomness for combat dice. */
export const liveRNG = () => Math.random();

/** Pick a random integer in [0, n). */
export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

/** In-place Fisher–Yates shuffle. */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
