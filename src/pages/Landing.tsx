import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchUserByUsername, fetchLeaguesByUserId, fetchLeague } from '../api/sleeper';
import { usePlayerValues, getPlayerValue } from '../hooks/usePlayerValues';
import { usePlayers, getPlayerInfo } from '../hooks/usePlayers';
import ThemeToggle from '../components/ThemeToggle';
import type { SleeperLeague, LeagueType } from '../types';

type Status = 'idle' | 'loading' | 'select-league' | 'error';
type PosFilter = 'All' | 'QB' | 'RB' | 'WR' | 'TE';

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  RB: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  WR: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  TE: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
};

function formatValue(val: number): string {
  return Math.round(val).toLocaleString();
}

export default function Landing() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [displayName, setDisplayName] = useState('');
  const navigate = useNavigate();

  // Rankings state
  const [leagueType, setLeagueType] = useState<LeagueType>('superflex');
  const [posFilter, setPosFilter] = useState<PosFilter>('All');
  const [searchText, setSearchText] = useState('');
  const { values, status: valuesStatus } = usePlayerValues(leagueType);
  const { players, status: playersStatus } = usePlayers();

  // Build ranked player list
  const rankedPlayers = useMemo(() => {
    if (!values || !players) return [];

    // Collect all player IDs that have a value in any source
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
      list.push({
        id,
        name: info.name,
        position: info.position,
        team: info.team,
        age: info.age,
        value,
      });
    }

    list.sort((a, b) => b.value - a.value);
    return list;
  }, [values, players]);

  const filteredPlayers = useMemo(() => {
    let list = rankedPlayers;
    if (posFilter !== 'All') list = list.filter(p => p.position === posFilter);
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [rankedPlayers, posFilter, searchText]);

  const displayPlayers = filteredPlayers.slice(0, 100);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    setStatus('loading');
    setError('');

    if (/^\d{10,}$/.test(trimmed)) {
      try {
        const league = await fetchLeague(trimmed);
        if (league && league.league_id) {
          navigate(`/league/${league.league_id}`);
          return;
        }
      } catch {
        // Not a valid league ID — fall through
      }
    }

    try {
      const user = await fetchUserByUsername(trimmed);
      if (!user || !user.user_id) {
        setStatus('error');
        setError('User not found. Check the username and try again.');
        return;
      }

      setDisplayName(user.display_name || user.username);

      // Fetch both current and previous season leagues in parallel
      // (some leagues may not have rolled over to the new season yet)
      const [currentLeagues, prevLeagues] = await Promise.all([
        fetchLeaguesByUserId(user.user_id),
        fetchLeaguesByUserId(user.user_id, 'nfl', '2025'),
      ]);

      // Merge: prefer current season, add previous season leagues not already present
      const leagueMap = new Map<string, SleeperLeague>();
      for (const l of currentLeagues) {
        leagueMap.set(l.league_id, l);
      }
      for (const l of prevLeagues) {
        // If a league rolled over, Sleeper changes the league_id.
        // Use previous_league_id on current-season leagues to detect duplicates.
        const alreadyRolledOver = currentLeagues.some(
          (cl) => cl.previous_league_id === l.league_id,
        );
        if (!alreadyRolledOver && !leagueMap.has(l.league_id)) {
          leagueMap.set(l.league_id, l);
        }
      }

      const dynastyLeagues = Array.from(leagueMap.values()).filter(
        (l) => l.settings && l.settings.type === 2,
      );

      if (dynastyLeagues.length === 0) {
        setStatus('error');
        setError('No dynasty leagues found for this user.');
        return;
      }

      if (dynastyLeagues.length === 1) {
        navigate(`/league/${dynastyLeagues[0].league_id}`);
        return;
      }

      setLeagues(dynastyLeagues);
      setStatus('select-league');
    } catch {
      setStatus('error');
      setError('Could not find that username or league ID. Please try again.');
    }
  }

  const dataReady = valuesStatus === 'ready' && playersStatus === 'ready';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Hero / Search */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-12 text-center relative">
          <div className="absolute top-4 right-4">
            <ThemeToggle />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">Dynasty AI</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Dynasty fantasy football analytics. Enter your Sleeper username or league ID.
          </p>

          <form onSubmit={handleSubmit} className="flex gap-2 max-w-md mx-auto">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Username or League ID"
              disabled={status === 'loading'}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-gray-900 dark:text-gray-100 dark:bg-gray-800 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {status === 'loading' ? 'Loading...' : 'Go'}
            </button>
          </form>

          {status === 'error' && (
            <p className="mt-4 text-red-600 dark:text-red-400 text-sm">{error}</p>
          )}

          {status === 'select-league' && (
            <div className="mt-6 text-left max-w-md mx-auto">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                {displayName} has {leagues.length} dynasty leagues. Pick one:
              </p>
              <div className="space-y-2">
                {leagues.map((league) => (
                  <button
                    key={league.league_id}
                    onClick={() => navigate(`/league/${league.league_id}`)}
                    className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">{league.name}</span>
                    <span className="ml-2 text-sm text-gray-400 dark:text-gray-500">
                      {league.season} &middot; {league.total_rosters} teams
                      {league.roster_positions?.includes('SUPER_FLEX') ? ' · SF' : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Player Rankings */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Dynasty Player Rankings</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setLeagueType('1qb')}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                leagueType === '1qb'
                  ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              1QB
            </button>
            <button
              onClick={() => setLeagueType('superflex')}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                leagueType === 'superflex'
                  ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              Superflex
            </button>
          </div>
        </div>

        {/* Position filter */}
        <div className="flex gap-1 mb-4">
          {(['All', 'QB', 'RB', 'WR', 'TE'] as PosFilter[]).map((pos) => (
            <button
              key={pos}
              onClick={() => setPosFilter(pos)}
              className={`text-xs px-3 py-1 rounded border transition-colors ${
                posFilter === pos
                  ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 border-gray-800 dark:border-gray-200'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              {pos}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search player name..."
          className="w-full sm:w-64 text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 mb-4"
        />

        {!dataReady && (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading player rankings...</p>
        )}

        {dataReady && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3 font-medium w-12">#</th>
                  <th className="px-4 py-3 font-medium w-12">Pos</th>
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 font-medium">Team</th>
                  <th className="px-4 py-3 font-medium text-right">Age</th>
                  <th className="px-4 py-3 font-medium text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {displayPlayers.map((p, i) => {
                  const posColor = POS_COLORS[p.position] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
                  return (
                    <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-2.5 text-gray-400 dark:text-gray-500">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block w-8 text-center text-xs font-semibold rounded px-1 py-0.5 ${posColor}`}>
                          {p.position}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{p.name}</td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{p.team || 'FA'}</td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-right">{p.age ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300">{formatValue(p.value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredPlayers.length > 100 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 px-4 py-3 border-t border-gray-100 dark:border-gray-700">
                Showing top 100 of {filteredPlayers.length} players
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          Values normalised across KeepTradeCut, FantasyCalc, and DynastyProcess. Scale: 0–10,000.
        </p>
      </div>
    </div>
  );
}
