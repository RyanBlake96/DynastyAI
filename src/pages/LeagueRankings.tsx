import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLeagueLayout } from '../components/LeagueLayout';
import { usePlayerValues, getPlayerValue } from '../hooks/usePlayerValues';
import { usePlayers, getPlayerInfo } from '../hooks/usePlayers';
import type { SleeperRoster, SleeperUser } from '../types';

type PosFilter = 'All' | 'QB' | 'RB' | 'WR' | 'TE';
type OwnerFilter = 'all' | 'rostered' | 'free-agent';

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-100 text-red-700',
  RB: 'bg-blue-100 text-blue-700',
  WR: 'bg-green-100 text-green-700',
  TE: 'bg-orange-100 text-orange-700',
};

function formatValue(val: number): string {
  return Math.round(val).toLocaleString();
}

function getUserName(roster: SleeperRoster, users: SleeperUser[]): string {
  const user = users.find((u) => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${roster.roster_id}`;
}

export default function LeagueRankings() {
  const { data, leagueId } = useLeagueLayout();
  const { players, status: playersStatus } = usePlayers();
  const { values, status: valuesStatus } = usePlayerValues(data.leagueType);
  const [posFilter, setPosFilter] = useState<PosFilter>('All');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');

  const { rosters, users } = data;

  // Build owner lookup: playerId -> { rosterId, teamName }
  const ownerMap = useMemo(() => {
    const map = new Map<string, { rosterId: number; teamName: string }>();
    for (const roster of rosters) {
      const teamName = getUserName(roster, users);
      for (const pid of roster.players || []) {
        map.set(pid, { rosterId: roster.roster_id, teamName });
      }
    }
    return map;
  }, [rosters, users]);

  // Build ranked player list from all sources
  const rankedPlayers = useMemo(() => {
    if (!values || !players) return [];

    const playerIds = new Set<string>();
    if (values.sources.ktc) for (const id of Object.keys(values.sources.ktc)) playerIds.add(id);
    if (values.sources.fantasycalc) for (const id of Object.keys(values.sources.fantasycalc)) playerIds.add(id);
    if (values.sources.dynastyprocess) for (const id of Object.keys(values.sources.dynastyprocess)) playerIds.add(id);

    const list: { id: string; name: string; position: string; team: string | null; age: number | null; value: number }[] = [];

    for (const id of playerIds) {
      const info = getPlayerInfo(players, id);
      if (!['QB', 'RB', 'WR', 'TE'].includes(info.position)) continue;
      const value = getPlayerValue(values, id);
      if (value <= 0) continue;
      list.push({ id, name: info.name, position: info.position, team: info.team, age: info.age, value });
    }

    list.sort((a, b) => b.value - a.value);
    return list;
  }, [values, players]);

  // Track positional rank
  const posRankMap = useMemo(() => {
    const counters: Record<string, number> = {};
    const map = new Map<string, number>();
    for (const p of rankedPlayers) {
      counters[p.position] = (counters[p.position] || 0) + 1;
      map.set(p.id, counters[p.position]);
    }
    return map;
  }, [rankedPlayers]);

  const filteredPlayers = useMemo(() => {
    let list = rankedPlayers;
    if (posFilter !== 'All') {
      list = list.filter(p => p.position === posFilter);
    }
    if (ownerFilter === 'rostered') {
      list = list.filter(p => ownerMap.has(p.id));
    } else if (ownerFilter === 'free-agent') {
      list = list.filter(p => !ownerMap.has(p.id));
    }
    return list;
  }, [rankedPlayers, posFilter, ownerFilter, ownerMap]);

  const dataReady = valuesStatus === 'ready' && playersStatus === 'ready' && values && players;
  const displayPlayers = filteredPlayers.slice(0, 200);

  return (
    <main className="max-w-6xl mx-auto px-8 py-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Player Rankings</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {data.leagueType === 'superflex' ? 'Superflex' : '1QB'} values &middot; {data.league.total_rosters} teams
        </p>
      </div>
        {/* Filters */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex gap-1">
            {(['All', 'QB', 'RB', 'WR', 'TE'] as PosFilter[]).map((pos) => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                className={`text-xs px-3 py-1 rounded border transition-colors ${
                  posFilter === pos
                    ? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:border-gray-400'
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <div className="flex gap-1">
            {([['all', 'All Players'], ['rostered', 'Rostered'], ['free-agent', 'Free Agents']] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setOwnerFilter(value)}
                className={`text-xs px-3 py-1 rounded border transition-colors ${
                  ownerFilter === value
                    ? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:border-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!dataReady && (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading player values...</p>
        )}

        {dataReady && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-300">
                  <th className="px-4 py-3 font-medium w-12">#</th>
                  <th className="px-4 py-3 font-medium w-12">Pos</th>
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 font-medium">Team</th>
                  <th className="px-4 py-3 font-medium text-right">Age</th>
                  <th className="px-4 py-3 font-medium text-right">Value</th>
                  <th className="px-4 py-3 font-medium text-right">Rank</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                </tr>
              </thead>
              <tbody>
                {displayPlayers.map((p, i) => {
                  const posColor = POS_COLORS[p.position] || 'bg-gray-100 text-gray-600';
                  const owner = ownerMap.get(p.id);
                  const posRank = posRankMap.get(p.id);
                  return (
                    <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2.5 text-gray-400 dark:text-gray-500">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block w-8 text-center text-xs font-semibold rounded px-1 py-0.5 ${posColor}`}>
                          {p.position}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/league/${leagueId}/player/${p.id}`}
                          className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{p.team || 'FA'}</td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-right">{p.age ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300">{formatValue(p.value)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500 dark:text-gray-400">
                        {posRank ? `${p.position}${posRank}` : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {owner ? (
                          <Link
                            to={`/league/${leagueId}/team/${owner.rosterId}`}
                            className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 text-sm"
                          >
                            {owner.teamName}
                          </Link>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500 text-sm">Free Agent</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredPlayers.length > 200 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 px-4 py-3 border-t border-gray-100 dark:border-gray-700">
                Showing top 200 of {filteredPlayers.length} players
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          Values normalised across KeepTradeCut, FantasyCalc, and DynastyProcess. Scale: 0–10,000.
        </p>
    </main>
  );
}
