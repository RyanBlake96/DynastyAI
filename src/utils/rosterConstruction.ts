import type { SleeperRoster } from '../types';
import type { ValuesResponse } from '../api/values';
import { getPlayerValue } from '../hooks/usePlayerValues';
import { computeOptimalStarters } from './powerRankings';

export type DepthGrade = 'Strong' | 'Adequate' | 'Weak';

export interface PositionalGrade {
  position: string;
  count: number;
  starterCount: number;
  totalValue: number;
  starterValue: number;
  benchValue: number;
  starterGrade: DepthGrade;  // percentile-based: how starters rank vs other teams' starters
  depthGrade: DepthGrade;    // total-value-based: total positional value vs league average
  grade: DepthGrade;         // backward compat alias for depthGrade
}

export interface RosterAnalysis {
  positionalGrades: PositionalGrade[];
  starterValue: number;
  benchValue: number;
  benchPct: number;
  efficiencyFlags: string[];
  overallGrade: DepthGrade;         // based on depth grades
  overallStarterGrade: DepthGrade;  // based on starter grades
}

// Count how many QBs a team should start: 1 for 1QB leagues, 2 for SF
export function countQbStarterSlots(rosterPositions: string[]): number {
  let count = 0;
  for (const slot of rosterPositions) {
    if (slot === 'QB') count++;
    else if (slot === 'SUPER_FLEX') count++;
  }
  return Math.max(count, 1);
}

// Compute league-wide starter values per position (one entry per team).
// Call once and pass to analyseRoster() to avoid redundant computation.
export function computeLeagueStarterValues(
  allRosters: SleeperRoster[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosterPositions: string[],
): Record<string, number[]> {
  const positions = ['QB', 'RB', 'WR', 'TE'] as const;
  const qbSlots = countQbStarterSlots(rosterPositions);
  const result: Record<string, number[]> = {};
  for (const pos of positions) result[pos] = [];

  for (const roster of allRosters) {
    const starters = computeOptimalStarters(roster.players || [], rosterPositions, players, values);
    const posTotals: Record<string, number> = {};
    for (const pos of positions) posTotals[pos] = 0;

    for (const pid of starters) {
      const pos = players[pid]?.position as string;
      if (posTotals[pos] !== undefined) {
        posTotals[pos] += getPlayerValue(values, pid);
      }
    }

    // QB: override with sum of top N QBs by value (N = QB + SF slots)
    const allQbs = (roster.players || [])
      .filter(pid => players[pid]?.position === 'QB')
      .map(pid => getPlayerValue(values, pid))
      .sort((a, b) => b - a);
    posTotals.QB = allQbs.slice(0, qbSlots).reduce((s, v) => s + v, 0);

    for (const pos of positions) result[pos].push(posTotals[pos]);
  }

  return result;
}

// Grade by percentile rank: top 33% = Strong, middle 33% = Adequate, bottom 33% = Weak
function gradeByPercentile(value: number, allValues: number[]): DepthGrade {
  const sorted = [...allValues].sort((a, b) => b - a); // descending
  const n = sorted.length;
  if (n === 0) return 'Adequate';

  // Find rank (0-indexed, lower = better)
  let rank = sorted.findIndex(v => value >= v);
  if (rank === -1) rank = n; // worst

  const topThreshold = Math.ceil(n / 3);
  const midThreshold = Math.ceil((n * 2) / 3);

  if (rank < topThreshold) return 'Strong';
  if (rank < midThreshold) return 'Adequate';
  return 'Weak';
}

function computeOverallGrade(grades: DepthGrade[]): DepthGrade {
  const strongCount = grades.filter(g => g === 'Strong').length;
  const weakCount = grades.filter(g => g === 'Weak').length;
  if (weakCount === 0 && strongCount >= 2) return 'Strong';
  if (weakCount >= 2) return 'Weak';
  return 'Adequate';
}

export function analyseRoster(
  roster: SleeperRoster,
  allRosters: SleeperRoster[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosterPositions: string[],
  leagueStarterValuesByPos?: Record<string, number[]>,
): RosterAnalysis {
  const positions = ['QB', 'RB', 'WR', 'TE'] as const;
  const qbSlots = countQbStarterSlots(rosterPositions);

  // Use computeOptimalStarters for definitive starter identification
  const optimalStarters = roster.players
    ? computeOptimalStarters(roster.players, rosterPositions, players, values)
    : new Set<string>();

  // Gather all players by position with values, split by starter status
  const byPos: Record<string, { id: string; value: number; isStarter: boolean }[]> = {};
  for (const pos of positions) byPos[pos] = [];

  for (const pid of roster.players || []) {
    const pos = players[pid]?.position as string;
    if (byPos[pos]) {
      byPos[pos].push({ id: pid, value: getPlayerValue(values, pid), isStarter: optimalStarters.has(pid) });
    }
  }
  for (const pos of positions) {
    byPos[pos].sort((a, b) => b.value - a.value);
  }

  // QB starters: simply use top N QBs by value (N = QB + SF slots)
  for (let i = 0; i < byPos.QB.length; i++) {
    byPos.QB[i].isStarter = i < qbSlots;
  }

  // Compute league-wide totals per position for depth grading (existing logic)
  const leaguePosTotals: Record<string, number[]> = {};
  for (const pos of positions) leaguePosTotals[pos] = [];

  for (const r of allRosters) {
    const totals: Record<string, number> = {};
    for (const pos of positions) totals[pos] = 0;
    for (const pid of r.players || []) {
      const pos = players[pid]?.position as string;
      if (totals[pos] !== undefined) {
        totals[pos] += getPlayerValue(values, pid);
      }
    }
    for (const pos of positions) leaguePosTotals[pos].push(totals[pos]);
  }
  const leaguePosAvg: Record<string, number> = {};
  for (const pos of positions) {
    const vals = leaguePosTotals[pos];
    leaguePosAvg[pos] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  // Compute league-wide starter values for percentile grading
  const leagueStarters = leagueStarterValuesByPos ?? computeLeagueStarterValues(allRosters, values, players, rosterPositions);

  // Build positional grades
  const positionalGrades: PositionalGrade[] = [];
  let totalStarterValue = 0;
  let totalBenchValue = 0;
  const efficiencyFlags: string[] = [];

  for (const pos of positions) {
    const group = byPos[pos];
    const starterGroup = group.filter(p => p.isStarter);
    const benchGroup = group.filter(p => !p.isStarter);

    const starterVal = starterGroup.reduce((s, p) => s + p.value, 0);
    const benchVal = benchGroup.reduce((s, p) => s + p.value, 0);
    const totalVal = starterVal + benchVal;

    totalStarterValue += starterVal;
    totalBenchValue += benchVal;

    // Depth grade: total value vs league average (existing logic)
    let depthGrade: DepthGrade;
    if (totalVal >= leaguePosAvg[pos] * 1.2) {
      depthGrade = 'Strong';
    } else if (totalVal >= leaguePosAvg[pos] * 0.8) {
      depthGrade = 'Adequate';
    } else {
      depthGrade = 'Weak';
    }

    // Starter grade: percentile rank vs other teams' starters at this position
    const starterGrade = gradeByPercentile(starterVal, leagueStarters[pos] || []);

    // Efficiency flags (use depth grade for surplus detection)
    if (depthGrade === 'Strong' && benchGroup.length >= 3 && benchVal > starterVal * 0.5) {
      efficiencyFlags.push(`${pos} surplus — significant bench value (${Math.round(benchVal)}) could be traded for needs`);
    }

    positionalGrades.push({
      position: pos,
      count: group.length,
      starterCount: starterGroup.length,
      totalValue: Math.round(totalVal),
      starterValue: Math.round(starterVal),
      benchValue: Math.round(benchVal),
      starterGrade,
      depthGrade,
      grade: depthGrade, // backward compat
    });
  }

  // Efficiency: weak starter positions with strong depth elsewhere
  const weakStarterPositions = positionalGrades.filter(g => g.starterGrade === 'Weak');
  const strongDepthPositions = positionalGrades.filter(g => g.depthGrade === 'Strong');
  if (weakStarterPositions.length > 0 && strongDepthPositions.length > 0) {
    efficiencyFlags.push(
      `Trade opportunity: ${strongDepthPositions.map(p => p.position).join('/')} depth could address ${weakStarterPositions.map(p => p.position).join('/')} starter weakness`
    );
  }

  const totalValue = totalStarterValue + totalBenchValue;
  const benchPct = totalValue > 0 ? totalBenchValue / totalValue : 0;

  // Bench ratio flags
  if (benchPct > 0.5) {
    efficiencyFlags.push('Heavy bench investment — consider consolidating depth into starter upgrades');
  } else if (benchPct < 0.15 && totalValue > 0) {
    efficiencyFlags.push('Thin bench — vulnerable to injuries; consider adding depth');
  }

  // Overall grades
  const overallGrade = computeOverallGrade(positionalGrades.map(g => g.depthGrade));
  const overallStarterGrade = computeOverallGrade(positionalGrades.map(g => g.starterGrade));

  return {
    positionalGrades,
    starterValue: Math.round(totalStarterValue),
    benchValue: Math.round(totalBenchValue),
    benchPct: Math.round(benchPct * 100),
    efficiencyFlags,
    overallGrade,
    overallStarterGrade,
  };
}
