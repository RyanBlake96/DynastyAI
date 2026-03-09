import type { SleeperRoster, SleeperUser, CompetitiveTier } from '../types';
import type { ValuesResponse } from '../api/values';
import type { RosterRanking } from './powerRankings';
import { getPlayerValue } from '../hooks/usePlayerValues';

// --- Types ---

export interface TeamNeed {
  position: string;
  grade: 'Weak' | 'Adequate';
  deficit: number; // how far below league average
}

export interface TeamSurplus {
  position: string;
  grade: 'Strong';
  excess: number; // how far above league average
  benchPlayers: { id: string; name: string; value: number }[];
}

export interface SuggestedTrade {
  teamA: { rosterId: number; teamName: string; tier: CompetitiveTier };
  teamB: { rosterId: number; teamName: string; tier: CompetitiveTier };
  teamAGives: { id: string; name: string; position: string; value: number }[];
  teamBGives: { id: string; name: string; position: string; value: number }[];
  teamAGetsValue: number;
  teamBGetsValue: number;
  difference: number;
  differencePct: number;
  explanation: string;
  teamABenefit: string;
  teamBBenefit: string;
}

// --- Helpers ---

function getUserName(roster: SleeperRoster, users: SleeperUser[]): string {
  const user = users.find(u => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${roster.roster_id}`;
}

interface RosterProfile {
  rosterId: number;
  teamName: string;
  tier: CompetitiveTier;
  positionalValues: Record<string, number>;
  playersByPos: Record<string, { id: string; name: string; value: number; isStarter: boolean }[]>;
  needs: TeamNeed[];
  surpluses: TeamSurplus[];
}

function buildRosterProfiles(
  rosters: SleeperRoster[],
  users: SleeperUser[],
  rankings: RosterRanking[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosterPositions: string[],
): RosterProfile[] {
  const positions = ['QB', 'RB', 'WR', 'TE'] as const;
  const rankingMap = new Map(rankings.map(r => [r.rosterId, r]));

  // Compute league-wide positional averages
  const leaguePosTotals: Record<string, number[]> = {};
  for (const pos of positions) leaguePosTotals[pos] = [];

  for (const roster of rosters) {
    const totals: Record<string, number> = {};
    for (const pos of positions) totals[pos] = 0;
    for (const pid of roster.players || []) {
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

  // Count starter slots per position (approximate)
  const starterCounts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const slot of rosterPositions) {
    if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') continue;
    if (slot === 'QB') starterCounts.QB++;
    else if (slot === 'RB') starterCounts.RB++;
    else if (slot === 'WR') starterCounts.WR++;
    else if (slot === 'TE') starterCounts.TE++;
    else if (slot === 'FLEX') { starterCounts.RB += 0.5; starterCounts.WR += 0.5; }
    else if (slot === 'SUPER_FLEX') { starterCounts.QB += 0.5; }
    else if (slot === 'REC_FLEX') { starterCounts.WR += 0.5; starterCounts.TE += 0.5; }
    else if (slot === 'WRRB_FLEX') { starterCounts.RB += 0.5; starterCounts.WR += 0.5; }
  }

  return rosters.map(roster => {
    const ranking = rankingMap.get(roster.roster_id);
    const teamName = getUserName(roster, users);
    const tier = ranking?.tier ?? 'Rebuilder';

    const positionalValues: Record<string, number> = {};
    const playersByPos: Record<string, { id: string; name: string; value: number; isStarter: boolean }[]> = {};
    for (const pos of positions) {
      positionalValues[pos] = 0;
      playersByPos[pos] = [];
    }

    for (const pid of roster.players || []) {
      const pos = players[pid]?.position as string;
      if (!positionalValues.hasOwnProperty(pos)) continue;
      const val = getPlayerValue(values, pid);
      positionalValues[pos] += val;
      const name = players[pid]?.full_name || `${players[pid]?.first_name} ${players[pid]?.last_name}`;
      playersByPos[pos].push({ id: pid, name, value: val, isStarter: false });
    }

    // Sort and mark approximate starters
    for (const pos of positions) {
      playersByPos[pos].sort((a, b) => b.value - a.value);
      const starterSlots = Math.ceil(starterCounts[pos] || 1);
      for (let i = 0; i < Math.min(starterSlots, playersByPos[pos].length); i++) {
        playersByPos[pos][i].isStarter = true;
      }
    }

    // Identify needs and surpluses
    const needs: TeamNeed[] = [];
    const surpluses: TeamSurplus[] = [];

    for (const pos of positions) {
      const avg = leaguePosAvg[pos];
      const val = positionalValues[pos];
      const ratio = avg > 0 ? val / avg : 1;

      if (ratio < 0.8) {
        needs.push({ position: pos, grade: 'Weak', deficit: Math.round(avg - val) });
      } else if (ratio < 1.0) {
        needs.push({ position: pos, grade: 'Adequate', deficit: Math.round(avg - val) });
      }

      if (ratio >= 1.2) {
        const benchPlayers = playersByPos[pos]
          .filter(p => !p.isStarter && p.value > 0)
          .map(p => ({ id: p.id, name: p.name, value: Math.round(p.value) }));
        if (benchPlayers.length > 0) {
          surpluses.push({
            position: pos,
            grade: 'Strong',
            excess: Math.round(val - avg),
            benchPlayers,
          });
        }
      }
    }

    return {
      rosterId: roster.roster_id,
      teamName,
      tier,
      positionalValues,
      playersByPos,
      needs,
      surpluses,
    };
  });
}

// --- Trade Finding ---

export function findTrades(
  rosters: SleeperRoster[],
  users: SleeperUser[],
  rankings: RosterRanking[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosterPositions: string[],
): SuggestedTrade[] {
  const profiles = buildRosterProfiles(rosters, users, rankings, values, players, rosterPositions);
  const trades: SuggestedTrade[] = [];

  // Try all team pairs
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const teamA = profiles[i];
      const teamB = profiles[j];

      // Find matching surplus-need pairs in both directions
      const aToB = findMatches(teamA, teamB);
      const bToA = findMatches(teamB, teamA);

      if (aToB.length === 0 || bToA.length === 0) continue;

      // Try to construct a balanced trade
      const trade = constructTrade(teamA, teamB, aToB, bToA);
      if (trade) trades.push(trade);
    }
  }

  // Sort by lowest difference percentage (most balanced first)
  trades.sort((a, b) => a.differencePct - b.differencePct);

  return trades;
}

interface SurplusMatch {
  surplusTeam: RosterProfile;
  needTeam: RosterProfile;
  position: string;
  availablePlayers: { id: string; name: string; value: number }[];
}

function findMatches(surplusTeam: RosterProfile, needTeam: RosterProfile): SurplusMatch[] {
  const matches: SurplusMatch[] = [];

  for (const surplus of surplusTeam.surpluses) {
    const matchingNeed = needTeam.needs.find(n => n.position === surplus.position);
    if (!matchingNeed) continue;

    matches.push({
      surplusTeam,
      needTeam,
      position: surplus.position,
      availablePlayers: surplus.benchPlayers,
    });
  }

  return matches;
}

function constructTrade(
  teamA: RosterProfile,
  teamB: RosterProfile,
  aToB: SurplusMatch[], // A has surplus that B needs
  bToA: SurplusMatch[], // B has surplus that A needs
): SuggestedTrade | null {
  // Pick the best surplus-need pair in each direction
  // Prefer "Weak" needs over "Adequate" needs
  const bestAtoB = aToB.sort((a, b) => {
    const aNeed = teamB.needs.find(n => n.position === a.position);
    const bNeed = teamB.needs.find(n => n.position === b.position);
    return (bNeed?.deficit ?? 0) - (aNeed?.deficit ?? 0);
  })[0];

  const bestBtoA = bToA.sort((a, b) => {
    const aNeed = teamA.needs.find(n => n.position === a.position);
    const bNeed = teamA.needs.find(n => n.position === b.position);
    return (bNeed?.deficit ?? 0) - (aNeed?.deficit ?? 0);
  })[0];

  if (!bestAtoB || !bestBtoA) return null;

  // Select players to trade — start with the best bench player from each surplus
  const aGivesPool = bestAtoB.availablePlayers;
  const bGivesPool = bestBtoA.availablePlayers;

  if (aGivesPool.length === 0 || bGivesPool.length === 0) return null;

  // Try to balance the trade by selecting players close in value
  const aGives: { id: string; name: string; position: string; value: number }[] = [];
  const bGives: { id: string; name: string; position: string; value: number }[] = [];

  // Start with the top bench player from each side
  const aPlayer = aGivesPool[0];
  const bPlayer = bGivesPool[0];

  aGives.push({
    id: aPlayer.id,
    name: aPlayer.name,
    position: bestAtoB.position,
    value: aPlayer.value,
  });

  bGives.push({
    id: bPlayer.id,
    name: bPlayer.name,
    position: bestBtoA.position,
    value: bPlayer.value,
  });

  let aGivesTotal = aPlayer.value;
  let bGivesTotal = bPlayer.value;

  // Try to balance by adding a second player from the side giving less value
  const imbalance = aGivesTotal - bGivesTotal;
  const MAX_DIFF_PCT = 30;

  if (Math.abs(imbalance) > Math.max(aGivesTotal, bGivesTotal) * (MAX_DIFF_PCT / 100)) {
    if (imbalance > 0) {
      // A is giving more — try adding a secondary B player to balance
      const secondaryB = findBalancingPlayer(teamB, bGivesPool, aGivesTotal, bGivesTotal, new Set(bGives.map(p => p.id)));
      if (secondaryB) {
        bGives.push(secondaryB);
        bGivesTotal += secondaryB.value;
      }
    } else {
      // B is giving more — try adding a secondary A player to balance
      const secondaryA = findBalancingPlayer(teamA, aGivesPool, bGivesTotal, aGivesTotal, new Set(aGives.map(p => p.id)));
      if (secondaryA) {
        aGives.push(secondaryA);
        aGivesTotal += secondaryA.value;
      }
    }
  }

  // Check final balance
  const diff = Math.abs(aGivesTotal - bGivesTotal);
  const maxVal = Math.max(aGivesTotal, bGivesTotal, 1);
  const diffPct = (diff / maxVal) * 100;

  // Only suggest trades within 30% value balance
  if (diffPct > MAX_DIFF_PCT) return null;

  // Don't suggest trivially small trades
  if (aGivesTotal < 500 && bGivesTotal < 500) return null;

  // Build explanation
  const aNeedPos = bestBtoA.position;
  const bNeedPos = bestAtoB.position;

  const explanation = `${teamA.teamName} has ${bestAtoB.position} depth and needs ${aNeedPos} help. ${teamB.teamName} has ${bestBtoA.position} depth and needs ${bNeedPos} help.`;

  const teamABenefit = `Upgrades ${aNeedPos} by adding ${bGives.map(p => p.name).join(', ')}`;
  const teamBBenefit = `Upgrades ${bNeedPos} by adding ${aGives.map(p => p.name).join(', ')}`;

  return {
    teamA: { rosterId: teamA.rosterId, teamName: teamA.teamName, tier: teamA.tier },
    teamB: { rosterId: teamB.rosterId, teamName: teamB.teamName, tier: teamB.tier },
    teamAGives: aGives,
    teamBGives: bGives,
    teamAGetsValue: Math.round(bGivesTotal),
    teamBGetsValue: Math.round(aGivesTotal),
    difference: Math.round(diff),
    differencePct: Math.round(diffPct),
    explanation,
    teamABenefit,
    teamBBenefit,
  };
}

function findBalancingPlayer(
  team: RosterProfile,
  _pool: { id: string }[],
  targetTotal: number,
  currentTotal: number,
  excludeIds: Set<string>,
): { id: string; name: string; position: string; value: number } | null {
  const gap = targetTotal - currentTotal;
  if (gap <= 0) return null;

  // Search all positions for a bench player that helps close the gap
  const candidates: { id: string; name: string; position: string; value: number; closeness: number }[] = [];

  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    for (const p of team.playersByPos[pos] || []) {
      if (p.isStarter) continue;
      if (excludeIds.has(p.id)) continue;
      if (p.value <= 0) continue;

      // How close does adding this player get us to the target?
      const newTotal = currentTotal + p.value;
      const newDiff = Math.abs(targetTotal - newTotal);
      const oldDiff = Math.abs(gap);

      // Only add if it improves balance
      if (newDiff < oldDiff) {
        candidates.push({
          id: p.id,
          name: p.name,
          position: pos,
          value: Math.round(p.value),
          closeness: newDiff,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick the player that gets closest to balance
  candidates.sort((a, b) => a.closeness - b.closeness);
  return candidates[0];
}
