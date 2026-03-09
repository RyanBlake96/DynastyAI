import type { SleeperRoster, SleeperUser, CompetitiveTier } from '../types';
import type { ValuesResponse } from '../api/values';
import { getPlayerValue } from '../hooks/usePlayerValues';
import type { PickOwnership } from './draftPicks';

// --- Types ---

export interface TradeAsset {
  type: 'player' | 'pick';
  playerId?: string;
  pick?: PickOwnership;
}

export interface TradeSide {
  rosterId: number;
  teamName: string;
  tier: CompetitiveTier | null;
  assets: TradeAsset[];
  totalValue: number;
  playerValues: { id: string; name: string; position: string; value: number }[];
  pickValues: { label: string; value: number }[];
}

export type FairnessGrade = 'Even' | 'Slight Edge' | 'Uneven' | 'Lopsided';

export interface TradeEvaluation {
  sides: [TradeSide, TradeSide];
  difference: number; // absolute value difference
  differencePct: number; // difference as % of larger side
  fairnessGrade: FairnessGrade;
  winner: number | null; // rosterId of winner, null if even
  explanation: string[];
}

// --- Fairness Grading ---

function gradeFairness(differencePct: number): FairnessGrade {
  if (differencePct <= 10) return 'Even';
  if (differencePct <= 20) return 'Slight Edge';
  if (differencePct <= 35) return 'Uneven';
  return 'Lopsided';
}

// --- Trade Evaluation ---

export function evaluateTrade(
  sideAPlayerIds: string[],
  sideAPicks: PickOwnership[],
  sideBPlayerIds: string[],
  sideBPicks: PickOwnership[],
  sideARosterId: number,
  sideBRosterId: number,
  values: ValuesResponse,
  players: Record<string, any>,
  rosters: SleeperRoster[],
  users: SleeperUser[],
  tiers: Map<number, CompetitiveTier> | null,
  _totalTeams: number,
): TradeEvaluation {
  function buildSide(
    playerIds: string[],
    picks: PickOwnership[],
    rosterId: number,
  ): TradeSide {
    const roster = rosters.find(r => r.roster_id === rosterId);
    const user = roster ? users.find(u => u.user_id === roster.owner_id) : null;
    const teamName = user?.display_name || user?.username || `Team ${rosterId}`;

    const playerValues = playerIds.map(id => {
      const info = players[id];
      return {
        id,
        name: info?.full_name || info?.first_name + ' ' + info?.last_name || `Player ${id}`,
        position: info?.position || '?',
        value: getPlayerValue(values, id),
      };
    });

    const pickValues = picks.map(pick => ({
      label: `${pick.season} Pick ${pick.pickLabel}`,
      value: pick.estimatedValue,
    }));

    const totalValue = playerValues.reduce((s, p) => s + p.value, 0)
      + pickValues.reduce((s, p) => s + p.value, 0);

    return {
      rosterId,
      teamName,
      tier: tiers?.get(rosterId) ?? null,
      assets: [
        ...playerIds.map(id => ({ type: 'player' as const, playerId: id })),
        ...picks.map(p => ({ type: 'pick' as const, pick: p })),
      ],
      totalValue: Math.round(totalValue),
      playerValues,
      pickValues,
    };
  }

  const sideA = buildSide(sideAPlayerIds, sideAPicks, sideARosterId);
  const sideB = buildSide(sideBPlayerIds, sideBPicks, sideBRosterId);

  const difference = Math.abs(sideA.totalValue - sideB.totalValue);
  const maxValue = Math.max(sideA.totalValue, sideB.totalValue, 1);
  const differencePct = (difference / maxValue) * 100;
  const fairnessGrade = gradeFairness(differencePct);

  let winner: number | null = null;
  if (differencePct > 10) {
    winner = sideA.totalValue > sideB.totalValue ? sideA.rosterId : sideB.rosterId;
  }

  // Build explanation
  const explanation: string[] = [];

  if (fairnessGrade === 'Even') {
    explanation.push('This trade is well-balanced — both sides receive comparable value.');
  } else {
    const winnerSide = sideA.totalValue >= sideB.totalValue ? sideA : sideB;
    explanation.push(
      `${winnerSide.teamName} receives ${Math.round(difference).toLocaleString()} more value (${Math.round(differencePct)}% edge).`
    );
  }

  // Note tier-relevant context
  if (sideA.tier && sideB.tier) {
    if (sideA.tier === 'Rebuilder' || sideB.tier === 'Rebuilder') {
      const rebuilder = sideA.tier === 'Rebuilder' ? sideA : sideB;
      const contender = sideA.tier === 'Rebuilder' ? sideB : sideA;
      if (contender.tier === 'Contender' || contender.tier === 'Strong Contender') {
        explanation.push(
          `Classic contender-rebuilder deal — ${rebuilder.teamName} (rebuilding) trades with ${contender.teamName} (contending).`
        );
      }
    }
  }

  // Age analysis per side
  for (const side of [sideA, sideB]) {
    const ages = side.playerValues
      .map(p => players[p.id]?.age)
      .filter((a): a is number => typeof a === 'number' && a > 0);
    if (ages.length > 0) {
      const avgAge = ages.reduce((s, a) => s + a, 0) / ages.length;
      if (avgAge <= 24) {
        explanation.push(`${side.teamName} receives young assets (avg age ${avgAge.toFixed(1)}) — good for long-term value.`);
      } else if (avgAge >= 29) {
        explanation.push(`${side.teamName} receives veteran assets (avg age ${avgAge.toFixed(1)}) — win-now move.`);
      }
    }
  }

  return {
    sides: [sideA, sideB],
    difference: Math.round(difference),
    differencePct: Math.round(differencePct),
    fairnessGrade,
    winner,
    explanation,
  };
}
