import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLeagueLayout } from '../components/LeagueLayout';
import { usePlayers, getPlayerName } from '../hooks/usePlayers';
import { fetchTransactions } from '../api/sleeper';
import type { SleeperTransaction, SleeperRoster, SleeperUser } from '../types';

function getUserName(rosterId: number, rosters: SleeperRoster[], users: SleeperUser[]): string {
  const roster = rosters.find((r) => r.roster_id === rosterId);
  if (!roster) return `Team ${rosterId}`;
  const user = users.find((u) => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${rosterId}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const TYPE_LABELS: Record<string, string> = {
  trade: 'Trade',
  free_agent: 'Free Agent',
  waiver: 'Waiver',
};

const TYPE_COLORS: Record<string, string> = {
  trade: 'bg-purple-100 text-purple-700',
  free_agent: 'bg-green-100 text-green-700',
  waiver: 'bg-blue-100 text-blue-700',
};

interface TransactionCardProps {
  tx: SleeperTransaction;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  players: Record<string, any> | null;
  leagueId: string;
}

function TransactionCard({ tx, rosters, users, players, leagueId }: TransactionCardProps) {
  const typeLabel = TYPE_LABELS[tx.type] || tx.type;
  const typeColor = TYPE_COLORS[tx.type] || 'bg-gray-100 text-gray-600';

  if (tx.type === 'trade') {
    return <TradeCard tx={tx} rosters={rosters} users={users} players={players} leagueId={leagueId} typeLabel={typeLabel} typeColor={typeColor} />;
  }

  // Free agent / waiver
  const rosterId = tx.roster_ids[0];
  const teamName = getUserName(rosterId, rosters, users);
  const adds = tx.adds ? Object.keys(tx.adds) : [];
  const drops = tx.drops ? Object.keys(tx.drops) : [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold rounded px-2 py-0.5 ${typeColor}`}>
            {typeLabel}
          </span>
          <Link
            to={`/league/${leagueId}/team/${rosterId}`}
            className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 text-sm"
          >
            {teamName}
          </Link>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(tx.created)}</span>
      </div>
      <div className="flex gap-6 text-sm">
        {adds.length > 0 && (
          <div>
            <span className="text-green-600 dark:text-green-400 font-medium text-xs uppercase tracking-wide">Added</span>
            <ul className="mt-1 space-y-0.5">
              {adds.map((id) => (
                <li key={id}>
                  <Link to={`/league/${leagueId}/player/${id}`} className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400">
                    {getPlayerName(players, id)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {drops.length > 0 && (
          <div>
            <span className="text-red-600 dark:text-red-400 font-medium text-xs uppercase tracking-wide">Dropped</span>
            <ul className="mt-1 space-y-0.5">
              {drops.map((id) => (
                <li key={id}>
                  <Link to={`/league/${leagueId}/player/${id}`} className="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400">
                    {getPlayerName(players, id)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function TradeCard({
  tx,
  rosters,
  users,
  players,
  leagueId,
  typeLabel,
  typeColor,
}: TransactionCardProps & { typeLabel: string; typeColor: string }) {
  // Group adds/drops/picks by roster_id
  const sides = new Map<number, { adds: string[]; drops: string[]; picksReceived: typeof tx.draft_picks }>();

  for (const rid of tx.roster_ids) {
    sides.set(rid, { adds: [], drops: [], picksReceived: [] });
  }

  if (tx.adds) {
    for (const [playerId, rosterId] of Object.entries(tx.adds)) {
      sides.get(rosterId)?.adds.push(playerId);
    }
  }
  if (tx.drops) {
    for (const [playerId, rosterId] of Object.entries(tx.drops)) {
      sides.get(rosterId)?.drops.push(playerId);
    }
  }
  if (tx.draft_picks) {
    for (const pick of tx.draft_picks) {
      sides.get(pick.owner_id)?.picksReceived.push(pick);
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-semibold rounded px-2 py-0.5 ${typeColor}`}>
          {typeLabel}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(tx.created)}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tx.roster_ids.map((rid) => {
          const side = sides.get(rid);
          if (!side) return null;
          const teamName = getUserName(rid, rosters, users);
          return (
            <div key={rid} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
              <Link
                to={`/league/${leagueId}/team/${rid}`}
                className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 text-sm block mb-2"
              >
                {teamName} receives:
              </Link>
              <div className="text-sm space-y-1">
                {side.adds.map((id) => (
                  <div key={id} className="flex items-center gap-1">
                    <span className="text-green-500 text-xs">+</span>
                    <Link to={`/league/${leagueId}/player/${id}`} className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400">
                      {getPlayerName(players, id)}
                    </Link>
                  </div>
                ))}
                {side.picksReceived.map((pick, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <span className="text-green-500 text-xs">+</span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {pick.season} Round {pick.round}
                    </span>
                  </div>
                ))}
                {side.adds.length === 0 && side.picksReceived.length === 0 && (
                  <span className="text-gray-400 dark:text-gray-500 text-xs italic">Nothing</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type TxFilter = 'all' | 'trade' | 'waiver' | 'free_agent';

export default function Transactions() {
  const { data, leagueId } = useLeagueLayout();
  const { players } = usePlayers();
  const [transactions, setTransactions] = useState<SleeperTransaction[]>([]);
  const [txStatus, setTxStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState<TxFilter>('all');

  useEffect(() => {
    if (!leagueId) return;

    let cancelled = false;

    async function loadTransactions() {
      setTxStatus('loading');
      try {
        const rounds = Array.from({ length: 18 }, (_, i) => i + 1);
        const results = await Promise.all(
          rounds.map((r) => fetchTransactions(leagueId!, r).catch(() => [] as SleeperTransaction[])),
        );
        if (cancelled) return;

        const all = results
          .flat()
          .filter((tx) => tx.status === 'complete')
          .sort((a, b) => b.created - a.created);

        setTransactions(all);
        setTxStatus('ready');
      } catch {
        if (!cancelled) setTxStatus('error');
      }
    }

    loadTransactions();
    return () => { cancelled = true; };
  }, [leagueId]);

  const { rosters, users } = data;

  const filtered = filter === 'all'
    ? transactions
    : transactions.filter((tx) => tx.type === filter);

  const trades = transactions.filter((t) => t.type === 'trade').length;
  const waivers = transactions.filter((t) => t.type === 'waiver').length;
  const freeAgents = transactions.filter((t) => t.type === 'free_agent').length;

  return (
    <main className="max-w-4xl mx-auto px-8 py-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Transactions</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {transactions.length} transactions this season
          {trades > 0 ? ` · ${trades} trades` : ''}
          {waivers > 0 ? ` · ${waivers} waivers` : ''}
          {freeAgents > 0 ? ` · ${freeAgents} free agents` : ''}
        </p>
      </div>
        {/* Filter buttons */}
        <div className="flex gap-2 mb-6">
          {([['all', 'All'], ['trade', 'Trades'], ['waiver', 'Waivers'], ['free_agent', 'Free Agents']] as const).map(
            ([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                  filter === value
                    ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'
                }`}
              >
                {label}
              </button>
            ),
          )}
        </div>

        {txStatus === 'loading' && (
          <p className="text-gray-500 dark:text-gray-400 text-sm">Loading transactions...</p>
        )}

        {txStatus === 'error' && (
          <p className="text-red-600 dark:text-red-400 text-sm">Failed to load transactions.</p>
        )}

        {txStatus === 'ready' && filtered.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No transactions found.</p>
        )}

        {txStatus === 'ready' && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((tx) => (
              <TransactionCard
                key={tx.transaction_id}
                tx={tx}
                rosters={rosters}
                users={users}
                players={players}
                leagueId={leagueId!}
              />
            ))}
          </div>
        )}
    </main>
  );
}
