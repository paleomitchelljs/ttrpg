// The hoard pile — the growth centerpiece. Canvas-drawn procedural mound of
// coins and gems whose size jumps at the HOARD_PILE_TIERS thresholds and
// creeps up in between. Coin placement is seeded so the pile is stable
// between renders and only ever grows.

import { makeSeededRNG } from '../engine/rng.js';
import { HOARD_PILE_TIERS } from '../engine/rules.js';

export function drawHoard(canvas, gold, dragonTierIndex = 0) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // cave backdrop
  ctx.fillStyle = '#17111c';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#241a2b';
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.15, W * 0.7, H * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  // floor
  ctx.fillStyle = '#3a2d24';
  ctx.fillRect(0, H - 16, W, 16);

  const tier = HOARD_PILE_TIERS.filter((t) => gold >= t).length - 1; // 0..3
  const coins = Math.min(420, Math.floor(gold / 4) + (gold > 0 ? 6 : 0));
  if (coins <= 0) return;

  const rng = makeSeededRNG('hoard-pile');
  const cx = W / 2;
  const baseY = H - 18;
  const spread = W * (0.28 + tier * 0.09);
  const peak = H * (0.18 + tier * 0.16);

  for (let i = 0; i < coins; i++) {
    // triangular mound: pick x, pile height falls off toward the edges
    const u = rng() + rng() - 1; // -1..1, center-weighted
    const x = cx + u * spread;
    const maxH = peak * (1 - Math.abs(u));
    const y = baseY - rng() * maxH;
    const r = 2.2 + rng() * 1.8;
    const gem = i % 23 === 22;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = gem ? ['#d64545', '#4596d6', '#45d68a'][i % 3] : '#e8b93c';
    ctx.fill();
    ctx.strokeStyle = gem ? '#ffffff55' : '#a3781c';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // a little sparkle on bigger piles
  if (tier >= 2) {
    ctx.fillStyle = '#fff8d0';
    ctx.font = `${12 + tier * 2}px serif`;
    ctx.fillText('✨', cx + spread * 0.4, baseY - peak * 0.8);
  }

  // the dragon curls up on its hoard, drawn bigger at each age tier
  const dragonSize = 22 + dragonTierIndex * 12;
  ctx.font = `${dragonSize}px serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🐉', cx, baseY - peak - 6);
  ctx.textAlign = 'start';
}
