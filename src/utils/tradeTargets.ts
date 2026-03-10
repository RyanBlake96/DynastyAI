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

export interface TradeTargetNeed {
  position: string;
  grade: DepthGrade;
  kind: 'need' | 'upgrade';
}

export interface TradeTargetResult {
  rosterId: number;
  teamName: string;
  tier: CompetitiveTier;
  needs: TradeTargetNeed[];
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

function gradeNumeric(grade: DepthGrade): number {
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
  if (age === null) return true;
  const peak = POS_PEAK_AGE[position] ?? [25, 29];
  const decline = POS_DECLINE_AGE[position] ?? 30;

  if (tier === 'Strong Contender' || tier === 'Contender') {
    return age <= decline;
  }
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
  if (playerValue >= 5500) return { description: '1st round pick', value: 5500 };
  if (playerValue >= 3200) return { description: '2nd round pick', value: 3200 };
  if (playerValue >= 2000) return { description: '3rd round pick', value: 2000 };
  if (playerValue >= 1200) return { description: '4th round pick', value: 1200 };
  return { description: 'late-round pick', value: 350 };
}

function computeDiffPct(giveTotal: number, receiveTotal: number): number {
  const diff = Math.abs(giveTotal - receiveTotal);
  const maxVal = Math.max(giveTotal, receiveTotal, 1);
  return Math.round((diff / maxVal) * 100);
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
  starterCounts: Record<string, number>;
}

function countStarterSlots(rosterPositions: string[]): Record<string, number> {
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const slot of rosterPositions) {
    if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') continue;
    if (slot === 'QB') counts.QB++;
    else if (slot === 'RB') counts.RB++;
    else if (slot === 'WR') counts.WR++;
    else if (slot === 'TE') counts.TE++;
    else if (slot === 'FLEX') { counts.RB += 0.5; counts.WR += 0.5; }
    else if (slot === 'SUPER_FLEX') { counts.QB += 0.5; }
    else if (slot === 'REC_FLEX') { counts.WR += 0.5; counts.TE += 0.5; }
    else if (slot === 'WRRB_FLEX') { counts.RB += 0.5; counts.WR += 0.5; }
  }
  return counts;
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
  const starterCounts = countStarterSlots(rosterPositions);

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

    return { rosterId: roster.roster_id, teamName, tier, roster, playersByPos, positionalValues, starterCounts };
  });
}

// --- Trade Package Construction ---

const MAX_DIFF_PCT = 15;

interface TradePackageResult {
  give: PlayerInfo[];
  receive: PlayerInfo[]; // additional players from the other team (beyond the main target)
}

function buildTradePackage(
  target: TargetCandidate,
  tradablePlayers: PlayerInfo[],
  targetTeamProfile: TeamProfile | undefined,
): TradePackageResult | null {
  const targetValue = target.value;

  const available = tradablePlayers.filter(p => p.value > 0);
  if (available.length === 0) return null;

  // Strategy 1: Single player close to target value
  for (const p of available) {
    const pct = computeDiffPct(p.value, targetValue);
    if (pct <= MAX_DIFF_PCT) {
      return { give: [p], receive: [] };
    }
  }

  // Strategy 2: Two-player combo
  const twoPlayerResult = findTwoPlayerCombo(available, targetValue);
  if (twoPlayerResult) return { give: twoPlayerResult, receive: [] };

  // Strategy 3: Three-player combo
  const threePlayerResult = findThreePlayerCombo(available, targetValue);
  if (threePlayerResult) return { give: threePlayerResult, receive: [] };

  // Strategy 4: Counter-balance from target team
  // My best player that overshoots + target team adds a bench player to even it out
  if (targetTeamProfile) {
    const counterResult = findCounterBalancedTrade(available, targetValue, target, targetTeamProfile);
    if (counterResult) return counterResult;
  }

  return null;
}

function findTwoPlayerCombo(available: PlayerInfo[], targetValue: number): PlayerInfo[] | null {
  let bestPair: PlayerInfo[] | null = null;
  let bestDiff = Infinity;

  for (let i = 0; i < available.length; i++) {
    const primary = available[i];
    if (primary.value > targetValue * 1.15) continue;
    if (primary.value < targetValue * 0.25) break; // sorted desc, rest are too small

    for (let j = i + 1; j < available.length; j++) {
      const sec = available[j];
      const total = primary.value + sec.value;
      const diff = Math.abs(total - targetValue);
      const pct = computeDiffPct(total, targetValue);

      if (pct <= MAX_DIFF_PCT && diff < bestDiff) {
        bestDiff = diff;
        bestPair = [primary, sec];
      }
    }
  }

  return bestPair;
}

function findThreePlayerCombo(available: PlayerInfo[], targetValue: number): PlayerInfo[] | null {
  // Only try if we have enough players; limit search space
  if (available.length < 3) return null;
  const limit = Math.min(available.length, 10); // cap to avoid O(n^3) blowup

  let bestTriple: PlayerInfo[] | null = null;
  let bestDiff = Infinity;

  for (let i = 0; i < limit; i++) {
    const a = available[i];
    if (a.value > targetValue * 0.8) continue; // first piece shouldn't be too big for a 3-player deal

    for (let j = i + 1; j < limit; j++) {
      const b = available[j];
      const twoTotal = a.value + b.value;
      if (twoTotal > targetValue * 1.15) continue;
      if (twoTotal < targetValue * 0.4) break; // rest are too small

      for (let k = j + 1; k < available.length; k++) {
        const c = available[k];
        const total = twoTotal + c.value;
        const diff = Math.abs(total - targetValue);
        const pct = computeDiffPct(total, targetValue);

        if (pct <= MAX_DIFF_PCT && diff < bestDiff) {
          bestDiff = diff;
          bestTriple = [a, b, c];
        }
        // If we've overshot, no point trying more (sorted desc)
        if (total > targetValue * 1.15) break;
      }
    }
  }

  return bestTriple;
}

function findCounterBalancedTrade(
  available: PlayerInfo[],
  targetValue: number,
  target: TargetCandidate,
  targetTeamProfile: TeamProfile,
): TradePackageResult | null {
  // Get bench players from the target team (not the target player themselves)
  const theirBench: PlayerInfo[] = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    for (const p of targetTeamProfile.playersByPos[pos] || []) {
      if (!p.isStarter && p.value > 0 && p.id !== target.id) {
        theirBench.push(p);
      }
    }
  }
  theirBench.sort((a, b) => b.value - a.value);

  // Case A: I give 1 player that's worth MORE than target; they add a bench player to balance
  for (const myPlayer of available) {
    if (myPlayer.value <= targetValue) continue; // only if I'm overpaying
    if (myPlayer.value > targetValue * 1.5) continue; // not absurdly more

    const gap = myPlayer.value - targetValue;
    // Find their bench player that closes the gap
    let bestAdd: PlayerInfo | null = null;
    let bestDiff = Infinity;

    for (const theirP of theirBench) {
      const receiveTotal = targetValue + theirP.value;
      const diff = Math.abs(myPlayer.value - receiveTotal);
      const pct = computeDiffPct(myPlayer.value, receiveTotal);
      if (pct <= MAX_DIFF_PCT && diff < bestDiff && theirP.value <= gap * 1.5) {
        bestDiff = diff;
        bestAdd = theirP;
      }
    }

    if (bestAdd) {
      return { give: [myPlayer], receive: [bestAdd] };
    }
  }

  // Case B: I give 2 players, they add a bench player to balance
  for (let i = 0; i < Math.min(available.length, 8); i++) {
    const primary = available[i];
    if (primary.value > targetValue) continue;
    if (primary.value < targetValue * 0.3) break;

    for (let j = i + 1; j < Math.min(available.length, 12); j++) {
      const sec = available[j];
      const myTotal = primary.value + sec.value;
      if (myTotal <= targetValue * 0.85) continue;
      if (myTotal > targetValue * 1.5) continue;

      const gap = myTotal - targetValue;
      if (gap <= 0) continue; // only if I'm overpaying

      for (const theirP of theirBench) {
        const receiveTotal = targetValue + theirP.value;
        const pct = computeDiffPct(myTotal, receiveTotal);
        if (pct <= MAX_DIFF_PCT && theirP.value <= gap * 1.5) {
          return { give: [primary, sec], receive: [theirP] };
        }
      }
    }
  }

  return null;
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
): TargetCandidate[] {
  const candidates: TargetCandidate[] = [];

  for (const profile of allProfiles) {
    if (profile.rosterId === myProfile.rosterId) continue;

    const playersAtPos = profile.playersByPos[needPosition] || [];
    for (const p of playersAtPos) {
      if (p.value < 500) continue;
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

  candidates.sort((a, b) => b.value - a.value);
  return candidates.slice(0, 15);
}

// --- Collect all tradable players for a team ---

function collectTradablePlayers(
  myProfile: TeamProfile,
  beforeAnalysis: RosterAnalysis,
): PlayerInfo[] {
  const tradable: PlayerInfo[] = [];
  const positions = ['QB', 'RB', 'WR', 'TE'];

  for (const pos of positions) {
    const posPlayers = myProfile.playersByPos[pos] || [];
    const posGrade = beforeAnalysis.positionalGrades.find(g => g.position === pos);
    const neededStarters = Math.ceil(myProfile.starterCounts[pos] || 1);

    for (let i = 0; i < posPlayers.length; i++) {
      const p = posPlayers[i];
      if (p.value <= 0) continue;

      if (!p.isStarter) {
        // All bench players are tradable
        tradable.push(p);
      } else if (posGrade?.grade === 'Strong' && i >= neededStarters) {
        // Expendable starters from deep surplus positions
        tradable.push(p);
      }
    }
  }

  tradable.sort((a, b) => b.value - a.value);
  return tradable;
}

// --- Build a single trade recommendation ---

function buildRecommendation(
  target: TargetCandidate,
  need: TradeTargetNeed,
  myProfile: TeamProfile,
  profiles: TeamProfile[],
  tradablePlayers: PlayerInfo[],
  beforeGrades: PositionalGradeSnapshot[],
  rosters: SleeperRoster[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosterPositions: string[],
): TradeRecommendation | null {
  const targetTeamProfile = profiles.find(p => p.rosterId === target.teamRosterId);

  const pkg = buildTradePackage(target, tradablePlayers, targetTeamProfile);
  if (!pkg) return null;

  // Simulate after-trade roster
  const giveIds = pkg.give.map(a => a.id);
  const receiveIds = [target.id, ...pkg.receive.map(a => a.id)];
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
    if (hasDroppedPosition) return null;
  }

  // Score the trade
  const beforeGrade = beforeGrades.find(g => g.position === need.position)!;
  const afterGrade = afterGrades.find(g => g.position === need.position)!;
  const gradeImprovement = gradeNumeric(afterGrade.grade) - gradeNumeric(beforeGrade.grade);
  const valueGain = afterGrade.totalValue - beforeGrade.totalValue;

  let penalty = 0;
  for (let i = 0; i < afterGrades.length; i++) {
    if (afterGrades[i].position === need.position) continue;
    const drop = gradeNumeric(beforeGrades[i].grade) - gradeNumeric(afterGrades[i].grade);
    if (drop > 0) penalty += drop;
  }

  const improvementScore = gradeImprovement * 1000 + valueGain / 10 - penalty * 500;

  const giveTotal = pkg.give.reduce((s, a) => s + a.value, 0);
  const receiveTotal = target.value + pkg.receive.reduce((s, a) => s + a.value, 0);
  const differencePct = computeDiffPct(giveTotal, receiveTotal);

  // Build explanation
  const surplusNames = [...new Set(pkg.give.map(a => a.position))].join('/');
  const gradeChangeText = beforeGrade.grade === afterGrade.grade
    ? `maintaining ${afterGrade.grade} grade but adding ${Math.round(valueGain).toLocaleString()} value`
    : `upgrading ${need.position} from ${beforeGrade.grade} to ${afterGrade.grade}`;

  const receiveNames = [target.name, ...pkg.receive.map(a => a.name)].join(' + ');
  const explanation = need.kind === 'upgrade'
    ? `Even with a strong ${need.position} room, ${receiveNames} is an upgrade — ${gradeChangeText}. ` +
      `Trading ${pkg.give.map(a => a.name).join(' + ')} keeps your roster balanced (${fairnessLabel(differencePct)} trade).`
    : `Your ${surplusNames} depth lets you target ${receiveNames} — ${gradeChangeText}. ` +
      `Trading ${pkg.give.map(a => a.name).join(' + ')} (${fairnessLabel(differencePct)} trade).`;

  const allReceiveAssets: TradeTargetAsset[] = [
    {
      type: 'player' as const,
      id: target.id,
      name: target.name,
      position: target.position,
      value: Math.round(target.value),
      age: target.age,
    },
    ...pkg.receive.map(a => ({
      type: 'player' as const,
      id: a.id,
      name: a.name,
      position: a.position,
      value: Math.round(a.value),
      age: a.age,
    })),
  ];

  return {
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
    giveAssets: pkg.give.map(a => ({
      type: 'player' as const,
      id: a.id,
      name: a.name,
      position: a.position,
      value: Math.round(a.value),
      age: a.age,
    })),
    receiveAssets: allReceiveAssets,
    giveTotal: Math.round(giveTotal),
    receiveTotal: Math.round(receiveTotal),
    differencePct,
    fairnessGrade: fairnessLabel(differencePct),
    beforeGrades,
    afterGrades,
    improvementScore,
    explanation,
  };
}

// --- Rebuilder Trade Recommendations ---

function buildRebuilderTradeRecommendations(
  myProfile: TeamProfile,
  profiles: TeamProfile[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosters: SleeperRoster[],
  rosterPositions: string[],
): TradeRecommendation[] {
  const recommendations: TradeRecommendation[] = [];
  const beforeAnalysis = analyseRoster(myProfile.roster, rosters, values, players, rosterPositions);
  const beforeGrades = snapshotGrades(beforeAnalysis);

  // Find sell candidates: players with Trade/Sell recommendations
  const sellCandidates: PlayerInfo[] = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const posPlayers = myProfile.playersByPos[pos] || [];
    for (const p of posPlayers) {
      if (p.value < 1000) continue;

      const rec = computeRecommendation({
        position: p.position,
        age: p.age,
        yearsExp: players[p.id]?.years_exp,
        teamTier: myProfile.tier,
        rosterSlot: p.isStarter ? 'Starter' : 'Bench',
        avgValue: p.value,
        ktcValue: values.sources.ktc?.[p.id] ?? 0,
        fantasycalcValue: values.sources.fantasycalc?.[p.id] ?? 0,
        dynastyprocessValue: values.sources.dynastyprocess?.[p.id] ?? 0,
        posDepthRank: posPlayers.indexOf(p) + 1,
        posDepthCount: posPlayers.length,
        leaguePosRank: null,
        leagueTeamCount: rosters.length,
      });

      if (rec.action === 'Trade' || rec.action === 'Sell') {
        sellCandidates.push(p);
      }
    }
  }
  sellCandidates.sort((a, b) => b.value - a.value);

  // For each sell candidate, find contender teams that need that position
  for (const sellPlayer of sellCandidates.slice(0, 8)) {
    for (const contenderProfile of profiles) {
      if (contenderProfile.rosterId === myProfile.rosterId) continue;
      if (contenderProfile.tier !== 'Strong Contender' && contenderProfile.tier !== 'Contender' && contenderProfile.tier !== 'Fringe Playoff') continue;

      // Check if contender needs this position
      const contenderAnalysis = analyseRoster(contenderProfile.roster, rosters, values, players, rosterPositions);
      const posGrade = contenderAnalysis.positionalGrades.find(g => g.position === sellPlayer.position);
      if (!posGrade || posGrade.grade === 'Strong') continue;

      // Find young bench players from contender's surplus positions
      const contenderGiveOptions: PlayerInfo[] = [];
      for (const pos of ['QB', 'RB', 'WR', 'TE']) {
        const contenderPosGrade = contenderAnalysis.positionalGrades.find(g => g.position === pos);
        if (!contenderPosGrade || contenderPosGrade.grade === 'Weak') continue;

        for (const cp of contenderProfile.playersByPos[pos] || []) {
          if (cp.isStarter) continue;
          if (cp.value <= 0) continue;
          // Rebuilders want young players (age 25 or under, or unknown age)
          if (cp.age === null || cp.age <= 25) {
            contenderGiveOptions.push(cp);
          }
        }
      }
      contenderGiveOptions.sort((a, b) => b.value - a.value);

      // Try to match value: contender gives young player(s) ≈ sell player value
      const targetValue = sellPlayer.value;

      // Single young player match
      for (const youngP of contenderGiveOptions) {
        const pct = computeDiffPct(targetValue, youngP.value);
        if (pct <= MAX_DIFF_PCT) {
          const simRoster = simulateRoster(myProfile.roster, [sellPlayer.id], [youngP.id]);
          const afterAnalysis = analyseRoster(simRoster, rosters, values, players, rosterPositions);
          const afterGrades = snapshotGrades(afterAnalysis);

          const decline = POS_DECLINE_AGE[sellPlayer.position] ?? 30;
          const ageNote = sellPlayer.age !== null && sellPlayer.age >= decline
            ? ` (past ${sellPlayer.position} prime at age ${sellPlayer.age})`
            : '';

          recommendations.push({
            targetPlayer: {
              id: youngP.id, name: youngP.name, position: youngP.position,
              team: youngP.team, age: youngP.age, value: Math.round(youngP.value),
            },
            targetTeam: {
              rosterId: contenderProfile.rosterId,
              teamName: contenderProfile.teamName,
              tier: contenderProfile.tier,
            },
            giveAssets: [{
              type: 'player', id: sellPlayer.id, name: sellPlayer.name,
              position: sellPlayer.position, value: Math.round(sellPlayer.value), age: sellPlayer.age,
            }],
            receiveAssets: [{
              type: 'player', id: youngP.id, name: youngP.name,
              position: youngP.position, value: Math.round(youngP.value), age: youngP.age,
            }],
            giveTotal: Math.round(targetValue),
            receiveTotal: Math.round(youngP.value),
            differencePct: pct,
            fairnessGrade: fairnessLabel(pct),
            beforeGrades,
            afterGrades,
            improvementScore: youngP.value / 10 + (youngP.age !== null && youngP.age <= 24 ? 500 : 0),
            explanation: `Sell high on ${sellPlayer.name}${ageNote} to ${contenderProfile.teamName} who needs ${sellPlayer.position} help. ` +
              `Receive ${youngP.name} (age ${youngP.age ?? '?'}) to build around (${fairnessLabel(pct)} trade).`,
          });
          break; // one trade per sell candidate per contender
        }
      }

      // Two young players combo
      if (!recommendations.some(r => r.giveAssets[0]?.id === sellPlayer.id && r.targetTeam.rosterId === contenderProfile.rosterId)) {
        for (let i = 0; i < Math.min(contenderGiveOptions.length, 8); i++) {
          const p1 = contenderGiveOptions[i];
          if (p1.value > targetValue) continue;
          let found = false;
          for (let j = i + 1; j < contenderGiveOptions.length; j++) {
            const p2 = contenderGiveOptions[j];
            const total = p1.value + p2.value;
            const pct = computeDiffPct(targetValue, total);
            if (pct <= MAX_DIFF_PCT) {
              const simRoster = simulateRoster(myProfile.roster, [sellPlayer.id], [p1.id, p2.id]);
              const afterAnalysis = analyseRoster(simRoster, rosters, values, players, rosterPositions);
              const afterGrades = snapshotGrades(afterAnalysis);

              const decline = POS_DECLINE_AGE[sellPlayer.position] ?? 30;
              const ageNote = sellPlayer.age !== null && sellPlayer.age >= decline
                ? ` (past ${sellPlayer.position} prime at age ${sellPlayer.age})`
                : '';

              recommendations.push({
                targetPlayer: {
                  id: p1.id, name: p1.name, position: p1.position,
                  team: p1.team, age: p1.age, value: Math.round(p1.value + p2.value),
                },
                targetTeam: {
                  rosterId: contenderProfile.rosterId,
                  teamName: contenderProfile.teamName,
                  tier: contenderProfile.tier,
                },
                giveAssets: [{
                  type: 'player', id: sellPlayer.id, name: sellPlayer.name,
                  position: sellPlayer.position, value: Math.round(sellPlayer.value), age: sellPlayer.age,
                }],
                receiveAssets: [
                  { type: 'player', id: p1.id, name: p1.name, position: p1.position, value: Math.round(p1.value), age: p1.age },
                  { type: 'player', id: p2.id, name: p2.name, position: p2.position, value: Math.round(p2.value), age: p2.age },
                ],
                giveTotal: Math.round(targetValue),
                receiveTotal: Math.round(total),
                differencePct: pct,
                fairnessGrade: fairnessLabel(pct),
                beforeGrades,
                afterGrades,
                improvementScore: total / 10 + (p1.age !== null && p1.age <= 24 ? 300 : 0) + (p2.age !== null && p2.age <= 24 ? 300 : 0),
                explanation: `Sell high on ${sellPlayer.name}${ageNote} to ${contenderProfile.teamName}. ` +
                  `Receive ${p1.name} + ${p2.name} — young pieces to build around (${fairnessLabel(pct)} trade).`,
              });
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }

      if (recommendations.length >= 8) break;
    }
    if (recommendations.length >= 8) break;
  }

  recommendations.sort((a, b) => b.improvementScore - a.improvementScore);
  return recommendations;
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

  suggestions.sort((a, b) => b.sellPlayer.value - a.sellPlayer.value);
  return suggestions.slice(0, 5);
}

// --- Main Entry Point ---

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

  // --- Identify needs ---
  const needs: TradeTargetNeed[] = [];
  const weakPositions = beforeAnalysis.positionalGrades.filter(g => g.grade === 'Weak');
  const adequatePositions = beforeAnalysis.positionalGrades
    .filter(g => g.grade === 'Adequate')
    .sort((a, b) => a.totalValue - b.totalValue);

  for (const g of weakPositions) {
    needs.push({ position: g.position, grade: g.grade, kind: 'need' });
  }

  // Add weakest Adequate position(s) as secondary needs
  if (adequatePositions.length > 0) {
    needs.push({ position: adequatePositions[0].position, grade: adequatePositions[0].grade, kind: 'need' });
    if (adequatePositions.length > 1 && weakPositions.length === 0) {
      needs.push({ position: adequatePositions[1].position, grade: adequatePositions[1].grade, kind: 'need' });
    }
  }

  // Fallback for all-Strong teams: use weakest Strong positions as upgrade targets
  if (needs.length === 0) {
    const strongPositions = beforeAnalysis.positionalGrades
      .filter(g => g.grade === 'Strong')
      .sort((a, b) => a.totalValue - b.totalValue);

    if (strongPositions.length > 0) {
      needs.push({ position: strongPositions[0].position, grade: strongPositions[0].grade, kind: 'upgrade' });
      if (strongPositions.length > 1) {
        needs.push({ position: strongPositions[1].position, grade: strongPositions[1].grade, kind: 'upgrade' });
      }
    }
  }

  // --- Collect tradable players ---
  const tradablePlayers = collectTradablePlayers(myProfile, beforeAnalysis);

  // --- Rebuilder pick suggestions (always computed for rebuilders) ---
  const rebuilderPickSuggestions: RebuilderPickSuggestion[] = [];
  if (myProfile.tier === 'Rebuilder') {
    rebuilderPickSuggestions.push(...buildRebuilderPickSuggestions(myProfile, values, players, rosters.length));
  }

  // --- Find trade recommendations ---
  const recommendations: TradeRecommendation[] = [];

  if (myProfile.tier === 'Rebuilder') {
    // Rebuilders: construct trades selling aging assets to contenders
    const rebuilderRecs = buildRebuilderTradeRecommendations(
      myProfile, profiles, values, players, rosters, rosterPositions,
    );
    recommendations.push(...rebuilderRecs);
  }

  // Standard need-based trade search (for all tiers)
  for (const need of needs) {
    const targetCandidates = findTargetPlayers(need.position, myProfile, profiles);

    for (const target of targetCandidates) {
      // Skip duplicates (same target player)
      if (recommendations.some(r => r.targetPlayer.id === target.id)) continue;

      const rec = buildRecommendation(
        target, need, myProfile, profiles, tradablePlayers,
        beforeGrades, rosters, values, players, rosterPositions,
      );

      if (rec) recommendations.push(rec);
    }
  }

  // --- Broadened search if under 3 recommendations ---
  if (recommendations.length < 3) {
    const existingNeedPositions = new Set(needs.map(n => n.position));
    const remainingPositions = beforeAnalysis.positionalGrades
      .filter(g => !existingNeedPositions.has(g.position))
      .sort((a, b) => a.totalValue - b.totalValue);

    for (const extra of remainingPositions) {
      if (recommendations.length >= 5) break;

      const extraNeed: TradeTargetNeed = {
        position: extra.position,
        grade: extra.grade,
        kind: extra.grade === 'Strong' ? 'upgrade' : 'need',
      };
      const targetCandidates = findTargetPlayers(extra.position, myProfile, profiles);

      for (const target of targetCandidates) {
        if (recommendations.some(r => r.targetPlayer.id === target.id)) continue;

        const rec = buildRecommendation(
          target, extraNeed, myProfile, profiles, tradablePlayers,
          beforeGrades, rosters, values, players, rosterPositions,
        );

        if (rec) {
          recommendations.push(rec);
          if (recommendations.length >= 5) break;
        }
      }
    }
  }

  // --- Sort and limit ---
  recommendations.sort((a, b) => b.improvementScore - a.improvementScore);

  // Keep top 4 per position, max 12 total
  const kept: TradeRecommendation[] = [];
  const countByPos: Record<string, number> = {};
  for (const rec of recommendations) {
    const pos = rec.targetPlayer.position;
    countByPos[pos] = (countByPos[pos] || 0);
    if (countByPos[pos] < 4 && kept.length < 12) {
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
