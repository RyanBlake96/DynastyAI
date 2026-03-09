import type { SleeperRoster, SleeperUser, CompetitiveTier } from '../types';
import type { ValuesResponse } from '../api/values';
import type { RosterRanking } from './powerRankings';
import { getPlayerValue } from '../hooks/usePlayerValues';
import type { DepthGrade } from './rosterConstruction';
import { analyseRoster } from './rosterConstruction';
import type { PickOwnership } from './draftPicks';

// --- Types ---

export interface RookieRanking {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  value: number;
  rank: number;
}

export interface PickTarget {
  pick: PickOwnership;
  recommendedPlayers: RookieRanking[];
  positionalFit: string | null;
}

export interface PickTradeSuggestion {
  type: 'trade-up' | 'trade-down' | 'sell';
  pickLabel: string;
  reason: string;
}

export interface TeamDraftStrategy {
  rosterId: number;
  teamName: string;
  tier: CompetitiveTier;
  needs: { position: string; grade: DepthGrade }[];
  picks: PickTarget[];
  pickTradeSuggestions: PickTradeSuggestion[];
  summary: string;
}

// --- Helpers ---

function getUserName(roster: SleeperRoster, users: SleeperUser[]): string {
  const user = users.find(u => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${roster.roster_id}`;
}

// --- Rookie Rankings ---

export function buildRookieRankings(
  players: Record<string, any>,
  values: ValuesResponse,
): RookieRanking[] {
  const rookies: RookieRanking[] = [];

  const allIds = new Set<string>();
  for (const source of [values.sources.ktc, values.sources.fantasycalc, values.sources.dynastyprocess]) {
    if (source) {
      for (const id of Object.keys(source)) allIds.add(id);
    }
  }

  for (const id of allIds) {
    const info = players[id];
    if (!info) continue;

    const pos = info.position as string;
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;

    const yearsExp = info.years_exp;
    if (typeof yearsExp !== 'number' || yearsExp !== 0) continue;

    const value = getPlayerValue(values, id);
    if (value <= 0) continue;

    const name = info.full_name || `${info.first_name} ${info.last_name}`;
    rookies.push({
      playerId: id,
      name,
      position: pos,
      team: info.team || null,
      age: info.age || null,
      value: Math.round(value),
      rank: 0,
    });
  }

  rookies.sort((a, b) => b.value - a.value);
  rookies.forEach((r, i) => { r.rank = i + 1; });

  return rookies;
}

// --- Draft Strategy per Team ---

export function buildTeamStrategies(
  rosters: SleeperRoster[],
  users: SleeperUser[],
  rankings: RosterRanking[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosterPositions: string[],
  rookieRankings: RookieRanking[],
  allPicks: PickOwnership[],
  currentSeason: string,
): TeamDraftStrategy[] {
  const rankingMap = new Map(rankings.map(r => [r.rosterId, r]));

  return rosters.map(roster => {
    const ranking = rankingMap.get(roster.roster_id);
    const teamName = getUserName(roster, users);
    const tier = ranking?.tier ?? 'Rebuilder';

    const analysis = analyseRoster(roster, rosters, values, players, rosterPositions);
    const needs = analysis.positionalGrades
      .filter(g => g.grade === 'Weak' || g.grade === 'Adequate')
      .map(g => ({ position: g.position, grade: g.grade }))
      .sort((a, b) => {
        if (a.grade === 'Weak' && b.grade !== 'Weak') return -1;
        if (a.grade !== 'Weak' && b.grade === 'Weak') return 1;
        return 0;
      });

    const needPositions = new Set(needs.filter(n => n.grade === 'Weak').map(n => n.position));
    const adequatePositions = new Set(needs.filter(n => n.grade === 'Adequate').map(n => n.position));

    // Get this team's current-season picks only
    const teamPicks = allPicks.filter(p => p.currentOwner === roster.roster_id && p.season === currentSeason);

    const pickTargets: PickTarget[] = [];

    for (const pick of teamPicks) {
      const overallPickNumber = (pick.round - 1) * rosters.length + pick.pickInRound;

      const windowStart = Math.max(0, overallPickNumber - 3);
      const windowEnd = Math.min(rookieRankings.length, overallPickNumber + 2);
      const availableRookies = rookieRankings.slice(windowStart, windowEnd);

      const scored = availableRookies.map(r => {
        let fitScore = 0;
        if (needPositions.has(r.position)) fitScore = 2;
        else if (adequatePositions.has(r.position)) fitScore = 1;
        return { rookie: r, fitScore };
      }).sort((a, b) => b.fitScore - a.fitScore || b.rookie.value - a.rookie.value);

      const recommended = scored.slice(0, 3).map(s => s.rookie);
      const topPick = scored[0];

      let positionalFit: string | null = null;
      if (topPick && needPositions.has(topPick.rookie.position)) {
        positionalFit = `Fills ${topPick.rookie.position} need`;
      } else if (topPick && adequatePositions.has(topPick.rookie.position)) {
        positionalFit = `Strengthens ${topPick.rookie.position}`;
      }

      pickTargets.push({ pick, recommendedPlayers: recommended, positionalFit });
    }

    // Pick trade suggestions — only when meaningful
    const pickTradeSuggestions: PickTradeSuggestion[] = [];

    if (tier === 'Strong Contender' || tier === 'Contender') {
      const latePicks = teamPicks.filter(p => p.round >= 3);
      if (latePicks.length > 0) {
        const pickLabels = latePicks.map(p => p.pickLabel).join(', ');
        pickTradeSuggestions.push({
          type: 'sell',
          pickLabel: pickLabels,
          reason: `Package late picks (${pickLabels}) for a proven win-now upgrade`,
        });
      }

      if (needPositions.size > 0) {
        const secondRoundPicks = teamPicks.filter(p => p.round === 2);
        if (secondRoundPicks.length > 0) {
          const needStr = [...needPositions].join('/');
          const pickLabel = secondRoundPicks[0].pickLabel;
          pickTradeSuggestions.push({
            type: 'trade-up',
            pickLabel,
            reason: `Package ${pickLabel} to trade up into the 1st round for a top ${needStr} rookie`,
          });
        }
      }
    } else if (tier === 'Rebuilder') {
      const hasFirstRound = teamPicks.some(p => p.round === 1);
      if (!hasFirstRound && teamPicks.length > 0) {
        pickTradeSuggestions.push({
          type: 'trade-up',
          pickLabel: teamPicks[0].pickLabel,
          reason: 'No first-round pick this season — consider trading veteran assets to acquire one',
        });
      }
    } else {
      const expectedPicks = Math.round(allPicks.filter(p => p.season === currentSeason).length / rosters.length);
      if (teamPicks.length > expectedPicks + 2) {
        const latePicks = teamPicks.filter(p => p.round >= 3);
        if (latePicks.length >= 2) {
          const pickLabels = latePicks.map(p => p.pickLabel).join(', ');
          pickTradeSuggestions.push({
            type: 'sell',
            pickLabel: pickLabels,
            reason: `Surplus draft capital (${pickLabels}) — consolidate for a higher pick or proven player`,
          });
        }
      }
    }

    const needStr = needs.filter(n => n.grade === 'Weak').map(n => n.position).join(', ');
    const pickCount = teamPicks.length;
    const firstRoundPicks = teamPicks.filter(p => p.round === 1).length;

    let summary = '';
    if (tier === 'Rebuilder') {
      summary = `Rebuilding team with ${pickCount} picks${firstRoundPicks > 0 ? ` (${firstRoundPicks} first-rounder${firstRoundPicks > 1 ? 's' : ''})` : ' (no first-rounder)'}.`;
      if (needStr) summary += ` Priority needs: ${needStr}.`;
      summary += ' Focus on best player available with a lean toward youth and upside.';
    } else if (tier === 'Strong Contender' || tier === 'Contender') {
      summary = `Contending team with ${pickCount} picks.`;
      if (needStr) summary += ` Biggest gap: ${needStr}.`;
      summary += ' Target immediate contributors or trade picks for proven players to push for a title.';
    } else {
      summary = `Fringe playoff team with ${pickCount} picks.`;
      if (needStr) summary += ` Needs at: ${needStr}.`;
      summary += ' Best player available approach — build for next year while staying competitive.';
    }

    return { rosterId: roster.roster_id, teamName, tier, needs, picks: pickTargets, pickTradeSuggestions, summary };
  });
}
