import type { SleeperRoster, CompetitiveTier } from '../types';
import type { ValuesResponse } from '../api/values';
import { getPlayerValue } from '../hooks/usePlayerValues';

export interface RosterRanking {
  rosterId: number;
  totalValue: number;
  starterValue: number;
  benchValue: number;
  qbValue: number;
  rbValue: number;
  wrValue: number;
  teValue: number;
  rank: number;
  avgStarterAge: number;
  tier: CompetitiveTier;
  tierScore: number;
}

// Which positions can fill each roster slot
const SLOT_ELIGIBLE: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
  DL: ['DL'],
  LB: ['LB'],
  DB: ['DB'],
};

// Compute optimal starting lineup by greedily filling the most restrictive slots first
function computeOptimalStarters(
  rosterPlayers: string[],
  rosterPositions: string[],
  players: Record<string, any>,
  values: ValuesResponse,
): Set<string> {
  // Only starter slots (exclude BN, IR, TAXI)
  const starterSlots = rosterPositions.filter(
    (s) => s !== 'BN' && s !== 'IR' && s !== 'TAXI',
  );

  // Build player list with position and value
  const available = rosterPlayers.map((id) => ({
    id,
    pos: (players[id]?.position as string) || '',
    val: getPlayerValue(values, id),
  }));

  // Sort slots by eligibility count (most restrictive first) for greedy optimality
  const slots = starterSlots
    .map((slot, idx) => ({ slot, idx, eligible: SLOT_ELIGIBLE[slot] || [] }))
    .sort((a, b) => a.eligible.length - b.eligible.length);

  const used = new Set<string>();
  const starters = new Set<string>();

  for (const { eligible } of slots) {
    // Find highest-value unused player eligible for this slot
    let bestId = '';
    let bestVal = -1;
    for (const p of available) {
      if (used.has(p.id)) continue;
      if (!eligible.includes(p.pos)) continue;
      if (p.val > bestVal) {
        bestVal = p.val;
        bestId = p.id;
      }
    }
    if (bestId) {
      used.add(bestId);
      starters.add(bestId);
    }
  }

  return starters;
}

export function computePowerRankings(
  rosters: SleeperRoster[],
  values: ValuesResponse | null,
  players: Record<string, any> | null,
  rosterPositions?: string[],
): RosterRanking[] {
  if (!values || !players) return [];

  const rankings: RosterRanking[] = rosters.map((roster) => {
    let totalValue = 0;
    let starterValue = 0;
    let benchValue = 0;
    let qbValue = 0;
    let rbValue = 0;
    let wrValue = 0;
    let teValue = 0;

    // Compute optimal starters if roster positions are available, otherwise fall back to current lineup
    const optimalStarters = rosterPositions && roster.players
      ? computeOptimalStarters(roster.players, rosterPositions, players, values)
      : new Set(roster.starters || []);

    for (const playerId of roster.players || []) {
      const val = getPlayerValue(values, playerId);
      totalValue += val;

      if (optimalStarters.has(playerId)) {
        starterValue += val;
      } else {
        benchValue += val;
      }

      const pos = players[playerId]?.position;
      if (pos === 'QB') qbValue += val;
      else if (pos === 'RB') rbValue += val;
      else if (pos === 'WR') wrValue += val;
      else if (pos === 'TE') teValue += val;
    }

    // Compute average starter age from optimal lineup
    const starterAges: number[] = [];
    for (const playerId of optimalStarters) {
      const age = players[playerId]?.age;
      if (typeof age === 'number' && age > 0) starterAges.push(age);
    }
    const avgStarterAge = starterAges.length > 0
      ? starterAges.reduce((a, b) => a + b, 0) / starterAges.length
      : 0;

    return {
      rosterId: roster.roster_id,
      totalValue: Math.round(totalValue),
      starterValue: Math.round(starterValue),
      benchValue: Math.round(benchValue),
      qbValue: Math.round(qbValue),
      rbValue: Math.round(rbValue),
      wrValue: Math.round(wrValue),
      teValue: Math.round(teValue),
      rank: 0,
      avgStarterAge: Math.round(avgStarterAge * 10) / 10,
      tier: 'Rebuilder', // assigned below
      tierScore: 0, // assigned below
    };
  });

  // Sort by total value descending and assign ranks
  rankings.sort((a, b) => b.totalValue - a.totalValue);
  rankings.forEach((r, i) => { r.rank = i + 1; });

  // Assign competitive tiers
  assignTiers(rankings, rosters);

  return rankings;
}

function assignTiers(rankings: RosterRanking[], rosters: SleeperRoster[]): void {
  const n = rankings.length;
  if (n === 0) return;

  // Build roster lookup for record data
  const rosterMap = new Map<number, SleeperRoster>();
  for (const r of rosters) rosterMap.set(r.roster_id, r);

  // Sort starter values to compute percentiles
  const starterValues = rankings.map((r) => r.starterValue).sort((a, b) => b - a);

  const scored: { ranking: RosterRanking; score: number }[] = [];

  for (const ranking of rankings) {
    const roster = rosterMap.get(ranking.rosterId);
    const wins = roster?.settings?.wins ?? 0;
    const losses = roster?.settings?.losses ?? 0;
    const winPct = wins + losses > 0 ? wins / (wins + losses) : 0.5;

    // Starter value percentile (0 = best, 1 = worst)
    const starterRank = starterValues.indexOf(ranking.starterValue);
    const starterPct = starterRank / n;

    // Bench depth ratio (bench value as % of total)
    const depthRatio = ranking.totalValue > 0 ? ranking.benchValue / ranking.totalValue : 0;

    // Scoring: higher = more competitive
    // Starter value is the primary signal (60%), age youth bonus (15%), record (15%), depth (10%)
    let score = 0;

    // Starter value: top percentile = high score
    score += (1 - starterPct) * 60;

    // Age: younger starters = higher score (scale: 24=max, 30+=0)
    const ageScore = ranking.avgStarterAge > 0
      ? Math.max(0, Math.min(1, (30 - ranking.avgStarterAge) / 6))
      : 0.5;
    score += ageScore * 15;

    // Record
    score += winPct * 15;

    // Bench depth (20-40% of value on bench is healthy)
    const depthScore = depthRatio >= 0.2 && depthRatio <= 0.45 ? 1 : depthRatio > 0.45 ? 0.6 : depthRatio / 0.2;
    score += depthScore * 10;

    scored.push({ ranking, score });
  }

  // Sort by score descending and assign tiers with max 4 per tier
  scored.sort((a, b) => b.score - a.score);
  const maxPerTier = Math.min(4, Math.ceil(n / 3));
  const tiers: CompetitiveTier[] = ['Strong Contender', 'Contender', 'Fringe Playoff', 'Rebuilder'];
  const thresholds = [79, 60, 50, -Infinity];
  const tierCounts: Record<CompetitiveTier, number> = {
    'Strong Contender': 0, 'Contender': 0, 'Fringe Playoff': 0, 'Rebuilder': 0,
  };

  for (const { ranking, score } of scored) {
    // Find the natural tier based on score
    let tierIdx = tiers.length - 1;
    for (let t = 0; t < thresholds.length; t++) {
      if (score >= thresholds[t]) { tierIdx = t; break; }
    }

    // If natural tier is full, bump down to the next available tier
    while (tierIdx < tiers.length - 1 && tierCounts[tiers[tierIdx]] >= maxPerTier) {
      tierIdx++;
    }

    ranking.tier = tiers[tierIdx];
    ranking.tierScore = Math.round(score);
    tierCounts[tiers[tierIdx]]++;
  }
}
