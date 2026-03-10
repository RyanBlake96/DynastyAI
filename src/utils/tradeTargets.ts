import type { SleeperRoster, SleeperUser, CompetitiveTier } from '../types';
import type { ValuesResponse } from '../api/values';
import type { RosterRanking } from './powerRankings';
import type { DepthGrade, RosterAnalysis } from './rosterConstruction';
import { analyseRoster } from './rosterConstruction';
import { getPlayerValue } from '../hooks/usePlayerValues';
import { computeRecommendation } from './recommendations';

// --- Types ---

export interface PositionalGradeSnapshot {
  position: string;
  totalValue: number;
  grade: DepthGrade;
}

export interface TradeTargetAsset {
  type: 'player' | 'pick';
  id: string;
  name: string;
  position: string;
  value: number;
  age?: number | null;
}

export interface TradeRecommendation {
  targetPlayer: {
    id: string;
    name: string;
    position: string;
    team: string | null;
    age: number | null;
    value: number;
  };
  targetTeam: { rosterId: number; teamName: string; tier: CompetitiveTier };
  giveAssets: TradeTargetAsset[];
  receiveAssets: TradeTargetAsset[];
  giveTotal: number;
  receiveTotal: number;
  differencePct: number;
  fairnessGrade: string;
  beforeGrades: PositionalGradeSnapshot[];
  afterGrades: PositionalGradeSnapshot[];
  improvementScore: number;
  explanation: string;
}

export interface RebuilderPickSuggestion {
  sellPlayer: { id: string; name: string; position: string; value: number; age: number | null };
  targetPickDescription: string;
  estimatedPickValue: number;
  explanation: string;
}

export interface TradeTargetResult {
  rosterId: number;
  teamName: string;
  tier: CompetitiveTier;
  needs: { position: string; grade: DepthGrade }[];
  recommendations: TradeRecommendation[];
  rebuilderPickSuggestions: RebuilderPickSuggestion[];
}

// --- Age thresholds (same as recommendations.ts) ---

const POS_PEAK_AGE: Record<string, [number, number]> = {
  QB: [26, 32],
  RB: [23, 26],
  WR: [24, 28],
  TE: [25, 28],
};

const POS_DECLINE_AGE: Record<string, number> = {
  QB: 33,
  RB: 27,
  WR: 29,
  TE: 29,
};

// --- Helpers ---

function getUserName(roster: SleeperRoster, users: SleeperUser[]): string {
  const user = users.find(u => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${roster.roster_id}`;
}

function snapshotGrades(analysis: RosterAnalysis): PositionalGradeSnapshot[] {
  return analysis.positionalGrades.map(g => ({
    position: g.position,
    totalValue: g.totalValue,
    grade: g.grade,
  }));
}

function gradeName(grade: DepthGrade): number {
  if (grade === 'Strong') return 3;
  if (grade === 'Adequate') return 2;
  return 1;
}

function fairnessLabel(pct: number): string {
  if (pct <= 10) return 'Even';
  if (pct <= 20) return 'Slight Edge';
  if (pct <= 35) return 'Uneven';
  return 'Lopsided';
}

function isAgeAppropriate(
  age: number | null,
  position: string,
  tier: CompetitiveTier,
): boolean {
  if (age === null) return true; // unknown age — allow
  const peak = POS_PEAK_AGE[position] ?? [25, 29];
  const decline = POS_DECLINE_AGE[position] ?? 30;

  if (tier === 'Strong Contender' || tier === 'Contender') {
    // Contenders want peak or pre-peak players
    return age <= decline;
  }
  // Rebuilders and fringe want pre-peak or early peak only
  return age <= peak[0] + 1;
}

function simulateRoster(
  roster: SleeperRoster,
  removeIds: string[],
  addIds: string[],
): SleeperRoster {
  const removeSet = new Set(removeIds);
  const newPlayers = (roster.players || []).filter(id => !removeSet.has(id)).concat(addIds);
  return { ...roster, players: newPlayers };
}

function estimatePickReturn(playerValue: number): { description: string; value: number } {
  // Map player value to approximate pick round
  if (playerValue >= 5500) return { description: '1st round pick', value: 5500 };
  if (playerValue >= 3200) return { description: '2nd round pick', value: 3200 };
  if (playerValue >= 2000) return { description: '3rd round pick', value: 2000 };
  if (playerValue >= 1200) return { description: '4th round pick', value: 1200 };
  return { description: 'late-round pick', value: 350 };
}

// --- Core Algorithm ---

interface PlayerInfo {
  id: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  value: number;
  isStarter: boolean;
}

interface TeamProfile {
  rosterId: number;
  teamName: string;
  tier: CompetitiveTier;
  roster: SleeperRoster;
  playersByPos: Record<string, PlayerInfo[]>;
  positionalValues: Record<string, number>;
}

function buildTeamProfiles(
  rosters: SleeperRoster[],
  users: SleeperUser[],
  rankings: RosterRanking[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosterPositions: string[],
): TeamProfile[] {
  const positions = ['QB', 'RB', 'WR', 'TE'] as const;
  const rankingMap = new Map(rankings.map(r => [r.rosterId, r]));

  // Count starter slots (simplified)
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

    const playersByPos: Record<string, PlayerInfo[]> = {};
    const positionalValues: Record<string, number> = {};
    for (const pos of positions) {
      playersByPos[pos] = [];
      positionalValues[pos] = 0;
    }

    for (const pid of roster.players || []) {
      const p = players[pid];
      if (!p) continue;
      const pos = p.position as string;
      if (!playersByPos[pos]) continue;
      const val = getPlayerValue(values, pid);
      const name = p.full_name || `${p.first_name} ${p.last_name}`;
      playersByPos[pos].push({
        id: pid,
        name,
        position: pos,
        team: p.team || null,
        age: p.age ?? null,
        value: val,
        isStarter: false,
      });
      positionalValues[pos] += val;
    }

    for (const pos of positions) {
      playersByPos[pos].sort((a, b) => b.value - a.value);
      const starterSlots = Math.ceil(starterCounts[pos] || 1);
      for (let i = 0; i < Math.min(starterSlots, playersByPos[pos].length); i++) {
        playersByPos[pos][i].isStarter = true;
      }
    }

    return { rosterId: roster.roster_id, teamName, tier, roster, playersByPos, positionalValues };
  });
}

export function findTradeTargets(
  targetRosterId: number,
  rosters: SleeperRoster[],
  users: SleeperUser[],
  rankings: RosterRanking[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosterPositions: string[],
): TradeTargetResult {
  const profiles = buildTeamProfiles(rosters, users, rankings, values, players, rosterPositions);
  const myProfile = profiles.find(p => p.rosterId === targetRosterId);

  if (!myProfile) {
    return { rosterId: targetRosterId, teamName: '', tier: 'Rebuilder', needs: [], recommendations: [], rebuilderPickSuggestions: [] };
  }

  // Get current roster analysis
  const beforeAnalysis = analyseRoster(myProfile.roster, rosters, values, players, rosterPositions);
  const beforeGrades = snapshotGrades(beforeAnalysis);

  // Identify needs: Weak positions first, then weakest Adequate
  const needs: { position: string; grade: DepthGrade }[] = [];
  const weakPositions = beforeAnalysis.positionalGrades.filter(g => g.grade === 'Weak');
  const adequatePositions = beforeAnalysis.positionalGrades
    .filter(g => g.grade === 'Adequate')
    .sort((a, b) => a.totalValue - b.totalValue);

  for (const g of weakPositions) needs.push({ position: g.position, grade: g.grade });
  // Add the weakest Adequate position as a secondary need (if there are weak ones too, or if no weak ones)
  if (adequatePositions.length > 0 && (weakPositions.length === 0 || adequatePositions[0].totalValue < beforeAnalysis.positionalGrades.reduce((s, g) => s + g.totalValue, 0) / 4 * 0.9)) {
    needs.push({ position: adequatePositions[0].position, grade: adequatePositions[0].grade });
  }

  // Find surplus positions for trade packages
  const surplusPositions = beforeAnalysis.positionalGrades.filter(g => g.grade === 'Strong');
  const surplusBenchPlayers: PlayerInfo[] = [];
  for (const sp of surplusPositions) {
    const bench = myProfile.playersByPos[sp.position]?.filter(p => !p.isStarter && p.value > 0) || [];
    surplusBenchPlayers.push(...bench);
  }
  surplusBenchPlayers.sort((a, b) => b.value - a.value);

  // Rebuilder pick suggestions
  const rebuilderPickSuggestions: RebuilderPickSuggestion[] = [];
  if (myProfile.tier === 'Rebuilder') {
    rebuilderPickSuggestions.push(...buildRebuilderPickSuggestions(myProfile, values, players, rosters.length));
  }

  // Find trade recommendations
  const recommendations: TradeRecommendation[] = [];

  for (const need of needs) {
    const targetCandidates = findTargetPlayers(
      need.position,
      myProfile,
      profiles,
      players,
      values,
    );

    for (const target of targetCandidates) {
      const tradePackage = buildTradePackage(
        target,
        myProfile,
        surplusBenchPlayers,
        recommendations, // pass existing to exclude already-used players
      );

      if (!tradePackage) continue;

      // Simulate after-trade roster
      const giveIds = tradePackage.map(a => a.id);
      const receiveIds = [target.id];
      const simRoster = simulateRoster(myProfile.roster, giveIds, receiveIds);
      const afterAnalysis = analyseRoster(simRoster, rosters, values, players, rosterPositions);
      const afterGrades = snapshotGrades(afterAnalysis);

      // Validate: contenders/fringe shouldn't drop a non-target position from Adequate to Weak
      if (myProfile.tier !== 'Rebuilder') {
        const hasDroppedPosition = afterGrades.some((ag, idx) => {
          const bg = beforeGrades[idx];
          return ag.position !== need.position &&
            bg.grade !== 'Weak' && ag.grade === 'Weak';
        });
        if (hasDroppedPosition) continue;
      }

      // Score the trade
      const beforeGrade = beforeGrades.find(g => g.position === need.position)!;
      const afterGrade = afterGrades.find(g => g.position === need.position)!;
      const gradeImprovement = gradeName(afterGrade.grade) - gradeName(beforeGrade.grade);
      const valueGain = afterGrade.totalValue - beforeGrade.totalValue;

      // Penalty for any grade drops elsewhere
      let penalty = 0;
      for (let i = 0; i < afterGrades.length; i++) {
        if (afterGrades[i].position === need.position) continue;
        const drop = gradeName(beforeGrades[i].grade) - gradeName(afterGrades[i].grade);
        if (drop > 0) penalty += drop;
      }

      const improvementScore = gradeImprovement * 1000 + valueGain / 10 - penalty * 500;

      const giveTotal = tradePackage.reduce((s, a) => s + a.value, 0);
      const receiveTotal = target.value;
      const diff = Math.abs(giveTotal - receiveTotal);
      const maxVal = Math.max(giveTotal, receiveTotal, 1);
      const differencePct = Math.round((diff / maxVal) * 100);

      // Build explanation
      const targetTeamProfile = profiles.find(p => p.rosterId === target.teamRosterId);
      const surplusNames = [...new Set(tradePackage.map(a => a.position))].join('/');
      const gradeChangeText = beforeGrade.grade === afterGrade.grade
        ? `maintaining ${afterGrade.grade} grade but adding ${Math.round(valueGain).toLocaleString()} value`
        : `upgrading ${need.position} from ${beforeGrade.grade} to ${afterGrade.grade}`;

      const explanation = `Your ${surplusNames} depth lets you target ${target.name} — ${gradeChangeText}. ` +
        `Trading ${tradePackage.map(a => a.name).join(' + ')} for ${target.name} (${fairnessLabel(differencePct)} trade).`;

      recommendations.push({
        targetPlayer: {
          id: target.id,
          name: target.name,
          position: target.position,
          team: target.team,
          age: target.age,
          value: Math.round(target.value),
        },
        targetTeam: {
          rosterId: target.teamRosterId,
          teamName: targetTeamProfile?.teamName ?? `Team ${target.teamRosterId}`,
          tier: targetTeamProfile?.tier ?? 'Rebuilder',
        },
        giveAssets: tradePackage.map(a => ({
          type: 'player' as const,
          id: a.id,
          name: a.name,
          position: a.position,
          value: Math.round(a.value),
          age: a.age,
        })),
        receiveAssets: [{
          type: 'player' as const,
          id: target.id,
          name: target.name,
          position: target.position,
          value: Math.round(target.value),
          age: target.age,
        }],
        giveTotal: Math.round(giveTotal),
        receiveTotal: Math.round(receiveTotal),
        differencePct,
        fairnessGrade: fairnessLabel(differencePct),
        beforeGrades,
        afterGrades,
        improvementScore,
        explanation,
      });
    }
  }

  // Sort by improvement score and limit
  recommendations.sort((a, b) => b.improvementScore - a.improvementScore);

  // Keep top 3 per need position, max 10 total
  const kept: TradeRecommendation[] = [];
  const countByPos: Record<string, number> = {};
  for (const rec of recommendations) {
    const pos = rec.targetPlayer.position;
    countByPos[pos] = (countByPos[pos] || 0);
    if (countByPos[pos] < 3 && kept.length < 10) {
      kept.push(rec);
      countByPos[pos]++;
    }
  }

  return {
    rosterId: targetRosterId,
    teamName: myProfile.teamName,
    tier: myProfile.tier,
    needs,
    recommendations: kept,
    rebuilderPickSuggestions,
  };
}

// --- Target Player Discovery ---

interface TargetCandidate {
  id: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  value: number;
  teamRosterId: number;
}

function findTargetPlayers(
  needPosition: string,
  myProfile: TeamProfile,
  allProfiles: TeamProfile[],
  _players: Record<string, any>,
  _values: ValuesResponse,
): TargetCandidate[] {
  const candidates: TargetCandidate[] = [];

  for (const profile of allProfiles) {
    if (profile.rosterId === myProfile.rosterId) continue;

    const playersAtPos = profile.playersByPos[needPosition] || [];
    for (const p of playersAtPos) {
      if (p.value < 500) continue; // skip low-value players
      if (!isAgeAppropriate(p.age, needPosition, myProfile.tier)) continue;

      candidates.push({
        id: p.id,
        name: p.name,
        position: needPosition,
        team: p.team,
        age: p.age,
        value: p.value,
        teamRosterId: profile.rosterId,
      });
    }
  }

  // Sort by value descending, take top candidates per position
  candidates.sort((a, b) => b.value - a.value);
  return candidates.slice(0, 8); // evaluate top 8 targets
}

// --- Trade Package Construction ---

function buildTradePackage(
  target: TargetCandidate,
  myProfile: TeamProfile,
  surplusBench: PlayerInfo[],
  existingRecs: TradeRecommendation[],
): PlayerInfo[] | null {
  const targetValue = target.value;
  const MAX_DIFF_PCT = 30;

  // Collect already-committed player IDs from previous recommendations
  const committedIds = new Set<string>();
  for (const rec of existingRecs) {
    for (const a of rec.giveAssets) committedIds.add(a.id);
  }

  // Available bench players from surplus (not already committed, not at the need position)
  const available = surplusBench.filter(
    p => !committedIds.has(p.id) && p.value > 0,
  );

  if (available.length === 0) return null;

  // Strategy 1: Find a single player close to target value
  const singleMatch = available.find(p => {
    const diff = Math.abs(p.value - targetValue);
    const pct = diff / Math.max(p.value, targetValue, 1) * 100;
    return pct <= MAX_DIFF_PCT;
  });

  if (singleMatch) return [singleMatch];

  // Strategy 2: Find a primary + secondary player combo
  for (const primary of available) {
    if (primary.value > targetValue * 1.3) continue; // don't overpay with one player
    if (primary.value < targetValue * 0.3) continue; // too small as the primary piece

    const remaining = available.filter(p => p.id !== primary.id);

    // Find the secondary player that best fills the gap
    let bestSecondary: PlayerInfo | null = null;
    let bestDiff = Infinity;

    for (const sec of remaining) {
      const total = primary.value + sec.value;
      const diff = Math.abs(total - targetValue);
      const pct = diff / Math.max(total, targetValue, 1) * 100;

      if (pct <= MAX_DIFF_PCT && diff < bestDiff) {
        bestDiff = diff;
        bestSecondary = sec;
      }
    }

    if (bestSecondary) return [primary, bestSecondary];
  }

  // Strategy 3: If we have any non-surplus bench player that's expendable (not a starter)
  // at ANY position, try pairing with a surplus player
  const allBench: PlayerInfo[] = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    for (const p of myProfile.playersByPos[pos] || []) {
      if (!p.isStarter && p.value > 0 && !committedIds.has(p.id) && !available.some(a => a.id === p.id)) {
        allBench.push(p);
      }
    }
  }

  for (const primary of available) {
    if (primary.value > targetValue * 1.3) continue;
    if (primary.value < targetValue * 0.3) continue;

    for (const sec of allBench) {
      const total = primary.value + sec.value;
      const diff = Math.abs(total - targetValue);
      const pct = diff / Math.max(total, targetValue, 1) * 100;

      if (pct <= MAX_DIFF_PCT) {
        return [primary, sec];
      }
    }
  }

  return null;
}

// --- Rebuilder Pick Suggestions ---

function buildRebuilderPickSuggestions(
  profile: TeamProfile,
  values: ValuesResponse,
  players: Record<string, any>,
  leagueSize: number,
): RebuilderPickSuggestion[] {
  const suggestions: RebuilderPickSuggestion[] = [];
  const positions = ['QB', 'RB', 'WR', 'TE'] as const;

  // Find players with Trade/Sell recommendations
  for (const pos of positions) {
    const posPlayers = profile.playersByPos[pos] || [];
    for (const p of posPlayers) {
      if (p.value < 1000) continue;

      const rec = computeRecommendation({
        position: p.position,
        age: p.age,
        yearsExp: players[p.id]?.years_exp,
        teamTier: profile.tier,
        rosterSlot: p.isStarter ? 'Starter' : 'Bench',
        avgValue: p.value,
        ktcValue: values.sources.ktc?.[p.id] ?? 0,
        fantasycalcValue: values.sources.fantasycalc?.[p.id] ?? 0,
        dynastyprocessValue: values.sources.dynastyprocess?.[p.id] ?? 0,
        posDepthRank: posPlayers.indexOf(p) + 1,
        posDepthCount: posPlayers.length,
        leaguePosRank: null,
        leagueTeamCount: leagueSize,
      });

      if (rec.action === 'Trade' || rec.action === 'Sell') {
        const pickReturn = estimatePickReturn(p.value);
        const decline = POS_DECLINE_AGE[p.position] ?? 30;
        const ageNote = p.age !== null && p.age >= decline
          ? ` at age ${p.age} (past ${p.position} prime)`
          : p.age !== null ? ` (age ${p.age})` : '';

        suggestions.push({
          sellPlayer: {
            id: p.id,
            name: p.name,
            position: p.position,
            value: Math.round(p.value),
            age: p.age,
          },
          targetPickDescription: pickReturn.description,
          estimatedPickValue: pickReturn.value,
          explanation: `${rec.action} ${p.name}${ageNote} for a ${pickReturn.description} (est. ${pickReturn.value.toLocaleString()} value). ${rec.reasons[0] || ''}`,
        });
      }
    }
  }

  // Sort by player value descending (highest value sells first)
  suggestions.sort((a, b) => b.sellPlayer.value - a.sellPlayer.value);
  return suggestions.slice(0, 5);
}

