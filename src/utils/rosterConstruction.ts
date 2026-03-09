import type { SleeperRoster } from '../types';
import type { ValuesResponse } from '../api/values';
import { getPlayerValue } from '../hooks/usePlayerValues';

export type DepthGrade = 'Strong' | 'Adequate' | 'Weak';

export interface PositionalGrade {
  position: string;
  count: number;
  starterCount: number;
  totalValue: number;
  starterValue: number;
  benchValue: number;
  grade: DepthGrade;
}

export interface RosterAnalysis {
  positionalGrades: PositionalGrade[];
  starterValue: number;
  benchValue: number;
  benchPct: number;
  efficiencyFlags: string[];
  overallGrade: DepthGrade;
}

// How many starters a league typically needs per position
// This is approximate — exact count depends on roster_positions
function countStarterSlots(rosterPositions: string[]): Record<string, number> {
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const slot of rosterPositions) {
    if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') continue;
    if (slot === 'QB') counts.QB++;
    else if (slot === 'RB') counts.RB++;
    else if (slot === 'WR') counts.WR++;
    else if (slot === 'TE') counts.TE++;
    else if (slot === 'FLEX') { counts.RB += 0.33; counts.WR += 0.34; counts.TE += 0.33; }
    else if (slot === 'SUPER_FLEX') { counts.QB += 0.5; counts.RB += 0.17; counts.WR += 0.17; counts.TE += 0.16; }
    else if (slot === 'REC_FLEX') { counts.WR += 0.5; counts.TE += 0.5; }
    else if (slot === 'WRRB_FLEX') { counts.RB += 0.5; counts.WR += 0.5; }
  }
  return counts;
}

export function analyseRoster(
  roster: SleeperRoster,
  allRosters: SleeperRoster[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosterPositions: string[],
): RosterAnalysis {
  const positions = ['QB', 'RB', 'WR', 'TE'] as const;
  const starterSlotCounts = countStarterSlots(rosterPositions);

  // Gather all players by position with values
  const byPos: Record<string, { id: string; value: number }[]> = {};
  for (const pos of positions) byPos[pos] = [];

  for (const pid of roster.players || []) {
    const pos = players[pid]?.position as string;
    if (byPos[pos]) {
      byPos[pos].push({ id: pid, value: getPlayerValue(values, pid) });
    }
  }
  for (const pos of positions) {
    byPos[pos].sort((a, b) => b.value - a.value);
  }

  // Compute league-wide averages per position for grading
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

  // Build positional grades
  const positionalGrades: PositionalGrade[] = [];
  let totalStarterValue = 0;
  let totalBenchValue = 0;
  const efficiencyFlags: string[] = [];

  for (const pos of positions) {
    const group = byPos[pos];
    const neededStarters = Math.ceil(starterSlotCounts[pos] || 0);
    const starterGroup = group.slice(0, Math.max(neededStarters, 1));
    const benchGroup = group.slice(Math.max(neededStarters, 1));

    const starterVal = starterGroup.reduce((s, p) => s + p.value, 0);
    const benchVal = benchGroup.reduce((s, p) => s + p.value, 0);
    const totalVal = starterVal + benchVal;

    totalStarterValue += starterVal;
    totalBenchValue += benchVal;

    // Grade based on league average comparison
    let grade: DepthGrade;
    if (totalVal >= leaguePosAvg[pos] * 1.2) {
      grade = 'Strong';
    } else if (totalVal >= leaguePosAvg[pos] * 0.8) {
      grade = 'Adequate';
    } else {
      grade = 'Weak';
    }

    // Efficiency flags
    if (grade === 'Strong' && benchGroup.length >= 3 && benchVal > starterVal * 0.5) {
      efficiencyFlags.push(`${pos} surplus — significant bench value (${Math.round(benchVal)}) could be traded for needs`);
    }

    positionalGrades.push({
      position: pos,
      count: group.length,
      starterCount: starterGroup.length,
      totalValue: Math.round(totalVal),
      starterValue: Math.round(starterVal),
      benchValue: Math.round(benchVal),
      grade,
    });
  }

  // Weak positions with strong surplus elsewhere
  const weakPositions = positionalGrades.filter(g => g.grade === 'Weak');
  const strongPositions = positionalGrades.filter(g => g.grade === 'Strong');
  if (weakPositions.length > 0 && strongPositions.length > 0) {
    efficiencyFlags.push(
      `Trade opportunity: ${strongPositions.map(p => p.position).join('/')} depth could address ${weakPositions.map(p => p.position).join('/')} weakness`
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

  // Overall grade
  const strongCount = positionalGrades.filter(g => g.grade === 'Strong').length;
  const weakCount = positionalGrades.filter(g => g.grade === 'Weak').length;
  let overallGrade: DepthGrade;
  if (weakCount === 0 && strongCount >= 2) {
    overallGrade = 'Strong';
  } else if (weakCount >= 2) {
    overallGrade = 'Weak';
  } else {
    overallGrade = 'Adequate';
  }

  return {
    positionalGrades,
    starterValue: Math.round(totalStarterValue),
    benchValue: Math.round(totalBenchValue),
    benchPct: Math.round(benchPct * 100),
    efficiencyFlags,
    overallGrade,
  };
}
