import type { SleeperTransaction, SleeperRoster, SleeperUser, SleeperTradedPick } from '../types';
import type { ValuesResponse } from '../api/values';
import { getPlayerValue } from '../hooks/usePlayerValues';
import { estimateTradedPickValue, formatTradedPickLabel } from './draftPicks';

// --- Types ---

export type TradeGrade = 'Won Big' | 'Won' | 'Fair' | 'Lost' | 'Lost Big';

export interface TradeSideAnalysis {
  rosterId: number;
  teamName: string;
  playersReceived: { id: string; name: string; position: string; currentValue: number }[];
  picksReceived: { label: string; value: number }[];
  totalCurrentValue: number;
  grade: TradeGrade;
}

export interface GradedTrade {
  transactionId: string;
  timestamp: number;
  sides: TradeSideAnalysis[];
  valueDifference: number;
  differencePct: number;
}

// --- Helpers ---

function getUserName(rosterId: number, rosters: SleeperRoster[], users: SleeperUser[]): string {
  const roster = rosters.find(r => r.roster_id === rosterId);
  if (!roster) return `Team ${rosterId}`;
  const user = users.find(u => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${rosterId}`;
}

function gradeFromDiffPct(diffPct: number, isWinner: boolean): TradeGrade {
  if (diffPct <= 10) return 'Fair';
  if (diffPct <= 25) return isWinner ? 'Won' : 'Lost';
  return isWinner ? 'Won Big' : 'Lost Big';
}

// --- Grade Trades ---

export function gradeTrades(
  transactions: SleeperTransaction[],
  values: ValuesResponse,
  players: Record<string, any>,
  rosters: SleeperRoster[],
  users: SleeperUser[],
  _totalTeams: number,
): GradedTrade[] {
  const trades = transactions.filter(tx => tx.type === 'trade' && tx.status === 'complete');
  const graded: GradedTrade[] = [];

  for (const tx of trades) {
    // Build each side's assets
    const sideMap = new Map<number, { adds: string[]; picksReceived: SleeperTradedPick[] }>();

    for (const rid of tx.roster_ids) {
      sideMap.set(rid, { adds: [], picksReceived: [] });
    }

    if (tx.adds) {
      for (const [playerId, rosterId] of Object.entries(tx.adds)) {
        sideMap.get(rosterId)?.adds.push(playerId);
      }
    }

    if (tx.draft_picks) {
      for (const pick of tx.draft_picks) {
        sideMap.get(pick.owner_id)?.picksReceived.push(pick);
      }
    }

    // Compute current value of what each side received
    const sides: TradeSideAnalysis[] = [];

    for (const rid of tx.roster_ids) {
      const side = sideMap.get(rid);
      if (!side) continue;

      const teamName = getUserName(rid, rosters, users);

      const playersReceived = side.adds.map(id => {
        const info = players[id];
        return {
          id,
          name: info?.full_name || `${info?.first_name || ''} ${info?.last_name || ''}`.trim() || `Player ${id}`,
          position: info?.position || '?',
          currentValue: getPlayerValue(values, id),
        };
      });

      const picksReceived = side.picksReceived.map(pick => ({
        label: formatTradedPickLabel(pick, rosters, users),
        value: estimateTradedPickValue(pick),
      }));

      const totalCurrentValue = playersReceived.reduce((s, p) => s + p.currentValue, 0)
        + picksReceived.reduce((s, p) => s + p.value, 0);

      sides.push({
        rosterId: rid,
        teamName,
        playersReceived,
        picksReceived,
        totalCurrentValue: Math.round(totalCurrentValue),
        grade: 'Fair', // assigned below
      });
    }

    if (sides.length < 2) continue;

    // Grade based on value difference
    const values1 = sides[0].totalCurrentValue;
    const values2 = sides[1].totalCurrentValue;
    const diff = Math.abs(values1 - values2);
    const maxVal = Math.max(values1, values2, 1);
    const diffPct = (diff / maxVal) * 100;

    const winnerIdx = values1 >= values2 ? 0 : 1;
    sides[0].grade = gradeFromDiffPct(diffPct, winnerIdx === 0);
    sides[1].grade = gradeFromDiffPct(diffPct, winnerIdx === 1);

    graded.push({
      transactionId: tx.transaction_id,
      timestamp: tx.created,
      sides,
      valueDifference: Math.round(diff),
      differencePct: Math.round(diffPct),
    });
  }

  // Sort by most recent first
  graded.sort((a, b) => b.timestamp - a.timestamp);
  return graded;
}
