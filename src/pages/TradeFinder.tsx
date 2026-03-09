import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLeagueLayout } from '../components/LeagueLayout';
import { usePlayers } from '../hooks/usePlayers';
import { usePlayerValues } from '../hooks/usePlayerValues';
import { computePowerRankings } from '../utils/powerRankings';
import { findTrades } from '../utils/tradeFinder';
import { gradeTrades } from '../utils/tradeHistory';
import { fetchTransactions } from '../api/sleeper';
import type { SuggestedTrade } from '../utils/tradeFinder';
import type { GradedTrade, TradeGrade } from '../utils/tradeHistory';
import type { SleeperTransaction, SleeperRoster, SleeperUser, CompetitiveTier } from '../types';

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-100 text-red-700',
  RB: 'bg-blue-100 text-blue-700',
  WR: 'bg-green-100 text-green-700',
  TE: 'bg-orange-100 text-orange-700',
};

const TIER_COLORS: Record<CompetitiveTier, string> = {
  'Strong Contender': 'bg-green-100 text-green-800',
  'Contender': 'bg-blue-100 text-blue-800',
  'Fringe Playoff': 'bg-yellow-100 text-yellow-800',
  'Rebuilder': 'bg-red-100 text-red-800',
};

const GRADE_COLORS: Record<TradeGrade, string> = {
  'Won Big': 'bg-green-100 text-green-700',
  'Won': 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400',
  'Fair': 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  'Lost': 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  'Lost Big': 'bg-red-100 text-red-700',
};

function formatValue(val: number): string {
  return Math.round(val).toLocaleString();
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type TabView = 'finder' | 'evaluator' | 'history';

export default function TradeFinder() {
  const { data, leagueId } = useLeagueLayout();
  const { players, status: playersStatus } = usePlayers();
  const { values, status: valuesStatus } = usePlayerValues(data.leagueType);
  const [view, setView] = useState<TabView>('finder');
  const [teamFilter, setTeamFilter] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<SleeperTransaction[]>([]);
  const [txStatus, setTxStatus] = useState<'loading' | 'ready' | 'error'>('idle' as any);

  const { league, rosters, users } = data;
  const dataReady = valuesStatus === 'ready' && playersStatus === 'ready' && values && players;

  const rankings = useMemo(() => {
    if (!dataReady) return [];
    return computePowerRankings(rosters, values, players, league.roster_positions);
  }, [dataReady, rosters, values, players, league.roster_positions]);

  // Suggested trades
  const suggestedTrades = useMemo(() => {
    if (!dataReady || rankings.length === 0) return [];
    return findTrades(rosters, users, rankings, values, players, league.roster_positions);
  }, [dataReady, rankings, rosters, users, values, players, league.roster_positions]);

  const filteredTrades = useMemo(() => {
    if (teamFilter === null) return suggestedTrades;
    return suggestedTrades.filter(t => t.teamA.rosterId === teamFilter || t.teamB.rosterId === teamFilter);
  }, [suggestedTrades, teamFilter]);

  // Load transactions for history tab
  useEffect(() => {
    if (view !== 'history' || !leagueId) return;
    if (transactions.length > 0) return; // already loaded

    let cancelled = false;
    setTxStatus('loading');

    async function load() {
      try {
        const rounds = Array.from({ length: 18 }, (_, i) => i + 1);
        const results = await Promise.all(
          rounds.map(r => fetchTransactions(leagueId!, r).catch(() => [] as SleeperTransaction[])),
        );
        if (cancelled) return;
        const all = results.flat().filter(tx => tx.status === 'complete' && tx.type === 'trade').sort((a, b) => b.created - a.created);
        setTransactions(all);
        setTxStatus('ready');
      } catch {
        if (!cancelled) setTxStatus('error');
      }
    }
    load();
    return () => { cancelled = true; };
  }, [view, leagueId, transactions.length]);

  // Graded trades
  const gradedTrades = useMemo(() => {
    if (!dataReady || transactions.length === 0) return [];
    return gradeTrades(transactions, values, players, rosters, users, league.total_rosters);
  }, [dataReady, transactions, values, players, rosters, users, league.total_rosters]);

  // Sorted team list for filter dropdown
  const sortedRosters = useMemo(() => {
    return [...rosters].sort((a, b) => {
      const nameA = getUserName(a, users);
      const nameB = getUserName(b, users);
      return nameA.localeCompare(nameB);
    });
  }, [rosters, users]);

  return (
    <main className="max-w-5xl mx-auto px-8 py-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Trade Tools</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Find trades, evaluate deals, and review trade history.
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2 mb-6">
        {([['finder', 'Trade Finder'], ['evaluator', 'Trade Evaluator'], ['history', 'Trade History']] as const).map(([value, label]) => (
          <Link
            key={value}
            to={value === 'evaluator' ? `/league/${leagueId}/trade-eval` : `/league/${leagueId}/trades`}
            onClick={e => {
              if (value !== 'evaluator') {
                e.preventDefault();
                setView(value);
              }
            }}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
              view === value
                ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {!dataReady && (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading player values...</p>
      )}

      {dataReady && view === 'finder' && (
        <TradeFinderView
          trades={filteredTrades}
          totalTrades={suggestedTrades.length}
          teamFilter={teamFilter}
          setTeamFilter={setTeamFilter}
          sortedRosters={sortedRosters}
          users={users}
          leagueId={leagueId}
        />
      )}

      {dataReady && view === 'history' && (
        <TradeHistoryView
          gradedTrades={gradedTrades}
          txStatus={txStatus}
          leagueId={leagueId}
        />
      )}
    </main>
  );
}

function getUserName(roster: SleeperRoster, users: SleeperUser[]): string {
  const user = users.find(u => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${roster.roster_id}`;
}

// --- Trade Finder View ---

function TradeFinderView({
  trades, totalTrades, teamFilter, setTeamFilter, sortedRosters, users, leagueId,
}: {
  trades: SuggestedTrade[];
  totalTrades: number;
  teamFilter: number | null;
  setTeamFilter: (v: number | null) => void;
  sortedRosters: SleeperRoster[];
  users: SleeperUser[];
  leagueId: string;
}) {
  return (
    <div className="space-y-4">
      {/* Team filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600 dark:text-gray-300">Filter by team:</label>
        <select
          value={teamFilter ?? ''}
          onChange={e => setTeamFilter(e.target.value ? Number(e.target.value) : null)}
          className="text-sm border border-gray-200 dark:border-gray-600 rounded px-3 py-1.5 bg-white dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">All teams</option>
          {sortedRosters.map(r => (
            <option key={r.roster_id} value={r.roster_id}>
              {getUserName(r, users)}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
          {trades.length} trade{trades.length !== 1 ? 's' : ''} found
          {teamFilter !== null && ` (${totalTrades} total)`}
        </span>
      </div>

      {trades.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
          No mutually beneficial trades found{teamFilter !== null ? ' for this team' : ''}.
        </p>
      )}

      {trades.map((trade, idx) => (
        <SuggestedTradeCard key={idx} trade={trade} leagueId={leagueId} />
      ))}
    </div>
  );
}

function SuggestedTradeCard({ trade, leagueId }: { trade: SuggestedTrade; leagueId: string }) {
  const tierA = TIER_COLORS[trade.teamA.tier];
  const tierB = TIER_COLORS[trade.teamB.tier];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      {/* Explanation */}
      <p className="text-sm text-gray-600 dark:text-gray-300">{trade.explanation}</p>

      {/* Trade sides */}
      <div className="grid grid-cols-2 gap-4">
        {/* Team A gives */}
        <div className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Link to={`/league/${leagueId}/team/${trade.teamA.rosterId}`} className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">
              {trade.teamA.teamName}
            </Link>
            <span className={`text-xs rounded px-1.5 py-0.5 ${tierA}`}>{trade.teamA.tier}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">Gives ({formatValue(trade.teamBGetsValue)}):</p>
          {trade.teamAGives.map(p => (
            <div key={p.id} className="flex items-center gap-2 text-sm py-0.5">
              <span className={`inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 ${POS_COLORS[p.position] || 'bg-gray-100'}`}>
                {p.position}
              </span>
              <Link to={`/league/${leagueId}/player/${p.id}`} className="text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400">
                {p.name}
              </Link>
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{formatValue(p.value)}</span>
            </div>
          ))}
          <p className="text-xs text-green-600 dark:text-green-400 mt-2">{trade.teamABenefit}</p>
        </div>

        {/* Team B gives */}
        <div className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Link to={`/league/${leagueId}/team/${trade.teamB.rosterId}`} className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">
              {trade.teamB.teamName}
            </Link>
            <span className={`text-xs rounded px-1.5 py-0.5 ${tierB}`}>{trade.teamB.tier}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">Gives ({formatValue(trade.teamAGetsValue)}):</p>
          {trade.teamBGives.map(p => (
            <div key={p.id} className="flex items-center gap-2 text-sm py-0.5">
              <span className={`inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 ${POS_COLORS[p.position] || 'bg-gray-100'}`}>
                {p.position}
              </span>
              <Link to={`/league/${leagueId}/player/${p.id}`} className="text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400">
                {p.name}
              </Link>
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{formatValue(p.value)}</span>
            </div>
          ))}
          <p className="text-xs text-green-600 dark:text-green-400 mt-2">{trade.teamBBenefit}</p>
        </div>
      </div>

      {/* Value balance */}
      <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-2">
        <span>Value difference: {formatValue(trade.difference)} ({trade.differencePct}%)</span>
        <span className={trade.differencePct <= 10 ? 'text-green-600 dark:text-green-400 font-medium' : trade.differencePct <= 20 ? 'text-yellow-600 dark:text-yellow-400' : 'text-orange-600 dark:text-orange-400'}>
          {trade.differencePct <= 10 ? 'Well balanced' : trade.differencePct <= 20 ? 'Slight edge' : 'Uneven'}
        </span>
      </div>
    </div>
  );
}

// --- Trade History View ---

function TradeHistoryView({
  gradedTrades, txStatus, leagueId,
}: {
  gradedTrades: GradedTrade[];
  txStatus: string;
  leagueId: string;
}) {
  if (txStatus === 'loading') {
    return <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading trade history...</p>;
  }

  if (txStatus === 'error') {
    return <p className="text-sm text-red-600 dark:text-red-400 py-8 text-center">Failed to load trade history.</p>;
  }

  if (gradedTrades.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">No trades found this season.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {gradedTrades.length} trade{gradedTrades.length !== 1 ? 's' : ''} graded by current player values.
      </p>
      {gradedTrades.map(trade => (
        <GradedTradeCard key={trade.transactionId} trade={trade} leagueId={leagueId} />
      ))}
    </div>
  );
}

function GradedTradeCard({
  trade, leagueId,
}: {
  trade: GradedTrade;
  leagueId: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(trade.timestamp)}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Value difference: {formatValue(trade.valueDifference)} ({trade.differencePct}%)
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {trade.sides.map(side => {
          const gradeColor = GRADE_COLORS[side.grade];
          return (
            <div key={side.rosterId} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <Link
                  to={`/league/${leagueId}/team/${side.rosterId}`}
                  className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {side.teamName}
                </Link>
                <span className={`text-xs font-semibold rounded px-2 py-0.5 ${gradeColor}`}>
                  {side.grade}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
                Received ({formatValue(side.totalCurrentValue)} current value):
              </p>
              {side.playersReceived.map(p => {
                const posColor = POS_COLORS[p.position] || 'bg-gray-100 text-gray-600';
                return (
                  <div key={p.id} className="flex items-center gap-2 text-sm py-0.5">
                    <span className={`inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 ${posColor}`}>
                      {p.position}
                    </span>
                    <Link to={`/league/${leagueId}/player/${p.id}`} className="text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400">
                      {p.name}
                    </Link>
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{formatValue(p.currentValue)}</span>
                  </div>
                );
              })}
              {side.picksReceived.map((pick, i) => (
                <div key={i} className="flex items-center gap-2 text-sm py-0.5">
                  <span className="inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 bg-purple-100 text-purple-700">
                    PK
                  </span>
                  <span className="text-gray-700 dark:text-gray-300">{pick.label}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{formatValue(pick.value)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
