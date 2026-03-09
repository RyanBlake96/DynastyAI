import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLeagueLayout } from '../components/LeagueLayout';
import { usePlayers } from '../hooks/usePlayers';
import { usePlayerValues } from '../hooks/usePlayerValues';
import { computePowerRankings } from '../utils/powerRankings';
import { fetchTradedPicks, fetchDrafts, fetchDraftPicks } from '../api/sleeper';
import { buildDraftOrder, getDraftSlotOrder, buildPickOwnership, buildRookiePickValueMap, applyRookieValues } from '../utils/draftPicks';
import type { PickOwnership } from '../utils/draftPicks';
import type { SleeperTradedPick, SleeperDraft, SleeperDraftPick, SleeperRoster, SleeperUser, CompetitiveTier } from '../types';
import type { RookieRanking, TeamDraftStrategy } from '../utils/rookieDraft';
import { buildRookieRankings, buildTeamStrategies } from '../utils/rookieDraft';

type TabView = 'strategy' | 'rankings' | 'picks';

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-100 text-red-700',
  RB: 'bg-blue-100 text-blue-700',
  WR: 'bg-green-100 text-green-700',
  TE: 'bg-orange-100 text-orange-700',
};

const TIER_COLORS: Record<CompetitiveTier, string> = {
  'Strong Contender': 'bg-green-100 text-green-700 border-green-200',
  'Contender': 'bg-blue-100 text-blue-700 border-blue-200',
  'Fringe Playoff': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'Rebuilder': 'bg-red-100 text-red-700 border-red-200',
};

function getUserName(rosterId: number, rosters: SleeperRoster[], users: SleeperUser[]): string {
  const roster = rosters.find(r => r.roster_id === rosterId);
  if (!roster) return `Team ${rosterId}`;
  const user = users.find(u => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${rosterId}`;
}

export default function RookieDraft() {
  const { data, leagueId } = useLeagueLayout();
  const { players, status: playersStatus } = usePlayers();
  const { values, status: valuesStatus } = usePlayerValues(data.leagueType);
  const [tradedPicks, setTradedPicks] = useState<SleeperTradedPick[]>([]);
  const [completedDraftPicks, setCompletedDraftPicks] = useState<Map<string, SleeperDraftPick[]>>(new Map());
  const [rawDrafts, setRawDrafts] = useState<SleeperDraft[]>([]);
  const [picksStatus, setPicksStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tab, setTab] = useState<TabView>('strategy');
  const [posFilter, setPosFilter] = useState<string>('All');
  const [selectedTeam, setSelectedTeam] = useState<number | 'all'>('all');

  const { league, rosters, users } = data;

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;

    async function loadPicks() {
      setPicksStatus('loading');
      try {
        const [traded, drafts] = await Promise.all([
          fetchTradedPicks(leagueId!),
          fetchDrafts(leagueId!),
        ]);
        if (cancelled) return;

        const completedDrafts = drafts.filter((d: SleeperDraft) => d.status === 'complete');
        const draftPicksBySeason = new Map<string, SleeperDraftPick[]>();

        if (completedDrafts.length > 0) {
          const pickResults = await Promise.all(
            completedDrafts.map((d: SleeperDraft) =>
              fetchDraftPicks(leagueId!, d.draft_id).catch(() => [] as SleeperDraftPick[]),
            ),
          );
          if (cancelled) return;
          completedDrafts.forEach((d: SleeperDraft, i: number) => {
            if (pickResults[i].length > 0) draftPicksBySeason.set(d.season, pickResults[i]);
          });
        }

        setTradedPicks(traded);
        setCompletedDraftPicks(draftPicksBySeason);
        setRawDrafts(drafts);
        setPicksStatus('ready');
      } catch {
        if (!cancelled) setPicksStatus('error');
      }
    }

    loadPicks();
    return () => { cancelled = true; };
  }, [leagueId]);

  // Build rookie rankings
  const rookieRankings = useMemo(() => {
    if (!players || !values) return [];
    return buildRookieRankings(players, values);
  }, [players, values]);

  // Build pick ownership using shared logic (same as DraftPicks page)
  const maxRounds = league.settings?.draft_rounds ?? 4;
  const currentSeason = league.season;
  const currentSeasonNum = parseInt(currentSeason, 10);
  const seasons = [String(currentSeasonNum), String(currentSeasonNum + 1), String(currentSeasonNum + 2)];

  const draftOrder = useMemo(() => buildDraftOrder(rosters), [rosters]);

  const preDraftOrders = useMemo(() => {
    const orders = new Map<string, Map<number, number>>();
    for (const d of rawDrafts) {
      if (d.status === 'pre_draft' && (d.slot_to_roster_id || d.draft_order)) {
        const rosterOrder = getDraftSlotOrder(d, rosters);
        if (rosterOrder.size > 0) orders.set(d.season, rosterOrder);
      }
    }
    return orders;
  }, [rawDrafts, rosters]);

  const rookiePickValueMap = useMemo(() => buildRookiePickValueMap(rookieRankings), [rookieRankings]);

  const allPicks = useMemo(() => {
    if (picksStatus !== 'ready') return [];
    const raw = buildPickOwnership(rosters, tradedPicks, seasons, maxRounds, currentSeason, draftOrder, completedDraftPicks, preDraftOrders, league.total_rosters);
    return rookiePickValueMap.size > 0
      ? applyRookieValues(raw, currentSeason, league.total_rosters, rookiePickValueMap)
      : raw;
  }, [rosters, tradedPicks, seasons, maxRounds, currentSeason, draftOrder, completedDraftPicks, preDraftOrders, league.total_rosters, picksStatus, rookiePickValueMap]);

  // Build team strategies
  const teamStrategies = useMemo(() => {
    if (!players || !values || allPicks.length === 0) return [];
    const rankings = computePowerRankings(rosters, values, players, league.roster_positions);
    return buildTeamStrategies(rosters, users, rankings, values, players, league.roster_positions, rookieRankings, allPicks, currentSeason);
  }, [rosters, users, values, players, league.roster_positions, rookieRankings, allPicks, currentSeason]);

  const sortedRosters = useMemo(() =>
    [...rosters].sort((a, b) => {
      const aName = getUserName(a.roster_id, rosters, users);
      const bName = getUserName(b.roster_id, rosters, users);
      return aName.localeCompare(bName);
    }),
  [rosters, users]);

  const loading = playersStatus === 'loading' || valuesStatus === 'loading' || picksStatus === 'loading';

  const filteredRookies = useMemo(() => {
    if (posFilter === 'All') return rookieRankings;
    return rookieRankings.filter(r => r.position === posFilter);
  }, [rookieRankings, posFilter]);

  const filteredStrategies = useMemo(() => {
    if (selectedTeam === 'all') return teamStrategies;
    return teamStrategies.filter(s => s.rosterId === selectedTeam);
  }, [teamStrategies, selectedTeam]);

  if (loading) {
    return (
      <main className="max-w-6xl mx-auto px-8 py-6">
        <p className="text-gray-500 dark:text-gray-400 text-sm">Loading rookie draft data...</p>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-8 py-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Rookie Draft</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {currentSeason} &middot; {maxRounds} rounds &middot; {rookieRankings.length} ranked rookies
        </p>
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex gap-2">
          {([['strategy', 'Draft Strategy'], ['rankings', 'Rookie Rankings'], ['picks', 'Draft Picks']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                if (value === 'picks') {
                  // Navigate to sub-route — handled by changing tab state
                  // Actually just switch tab to show inline
                }
                setTab(value);
              }}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                tab === value
                  ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'rankings' && (
        <RookieRankingsView
          rookies={filteredRookies}
          posFilter={posFilter}
          setPosFilter={setPosFilter}
          leagueId={leagueId!}
          rosters={rosters}
        />
      )}

      {tab === 'strategy' && (
        <DraftStrategyView
          strategies={filteredStrategies}
          selectedTeam={selectedTeam}
          setSelectedTeam={setSelectedTeam}
          sortedRosters={sortedRosters}
          users={users}
          rosters={rosters}
          leagueId={leagueId!}
        />
      )}

      {tab === 'picks' && (
        <DraftPicksView
          allPicks={allPicks}
          rosters={rosters}
          users={users}
          seasons={seasons}
          maxRounds={maxRounds}
          leagueId={leagueId!}
          tradedPickCount={tradedPicks.length}
        />
      )}
    </main>
  );
}

// --- Draft Picks Tab (inline view) ---

function DraftPicksView({
  allPicks,
  rosters,
  users,
  seasons,
  maxRounds,
  leagueId,
  tradedPickCount,
}: {
  allPicks: PickOwnership[];
  rosters: SleeperRoster[];
  users: SleeperUser[];
  seasons: string[];
  maxRounds: number;
  leagueId: string;
  tradedPickCount: number;
}) {
  const [viewMode, setViewMode] = useState<'by-team' | 'by-round'>('by-team');

  const sortedRosters = useMemo(() =>
    [...rosters].sort((a, b) => {
      const wDiff = (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0);
      if (wDiff !== 0) return wDiff;
      return (b.settings?.fpts ?? 0) - (a.settings?.fpts ?? 0);
    }),
  [rosters]);

  return (
    <>
      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-2">
          {([['by-team', 'By Team'], ['by-round', 'By Round']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setViewMode(value)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                viewMode === value
                  ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {seasons[0]}–{seasons[2]} &middot; {maxRounds} rounds/yr
          {tradedPickCount > 0 ? ` · ${tradedPickCount} traded` : ''}
          {' · '}~ = projected
        </span>
      </div>

      {viewMode === 'by-team' && (
        <div className="space-y-4">
          {sortedRosters.map((roster) => {
            const teamPicks = allPicks.filter(p => p.currentOwner === roster.roster_id);
            const teamName = getUserName(roster.roster_id, rosters, users);
            return (
              <div key={roster.roster_id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <Link to={`/league/${leagueId}/team/${roster.roster_id}`} className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">{teamName}</Link>
                <span className="text-sm text-gray-400 dark:text-gray-500 ml-2">{teamPicks.length} picks</span>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {seasons.map(season => {
                    const seasonPicks = teamPicks.filter(p => p.season === season).sort((a, b) => a.round - b.round || a.pickInRound - b.pickInRound);
                    return (
                      <div key={season}>
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{season}</h4>
                        {seasonPicks.length === 0 ? (
                          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No picks</p>
                        ) : (
                          <div className="space-y-0.5">
                            {seasonPicks.map((pick, i) => {
                              const isOwn = pick.originalOwner === roster.roster_id;
                              const fromName = !isOwn ? getUserName(pick.originalOwner, rosters, users) : null;
                              return (
                                <div key={i} className={`text-sm px-2 py-1 rounded flex items-center gap-2 ${isOwn ? 'text-gray-700 dark:text-gray-300' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                                  <span className="font-mono font-medium w-16">{pick.pickLabel}</span>
                                  {fromName && <span className="text-xs text-blue-500 dark:text-blue-400">via {fromName}</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'by-round' && (
        <div className="space-y-6">
          {seasons.map(season => (
            <div key={season}>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{season} Draft</h3>
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-300">
                      <th className="px-4 py-2 font-medium w-20">Pick</th>
                      <th className="px-4 py-2 font-medium">Original Team</th>
                      <th className="px-4 py-2 font-medium">Current Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: maxRounds }, (_, r) => r + 1).map(round => {
                      const roundPicks = allPicks.filter(p => p.season === season && p.round === round).sort((a, b) => a.pickInRound - b.pickInRound);
                      return roundPicks.map(pick => {
                        const originalName = getUserName(pick.originalOwner, rosters, users);
                        const currentName = getUserName(pick.currentOwner, rosters, users);
                        const traded = pick.originalOwner !== pick.currentOwner;
                        return (
                          <tr key={`${round}-${pick.originalOwner}`} className={`border-b border-gray-100 dark:border-gray-700 ${traded ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                            <td className="px-4 py-2 font-mono font-medium text-gray-700 dark:text-gray-300">{pick.pickLabel}</td>
                            <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                              <Link to={`/league/${leagueId}/team/${pick.originalOwner}`} className="hover:text-blue-600 dark:hover:text-blue-400">{originalName}</Link>
                            </td>
                            <td className="px-4 py-2">
                              <Link to={`/league/${leagueId}/team/${pick.currentOwner}`} className={`hover:text-blue-600 dark:hover:text-blue-400 ${traded ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300'}`}>{currentName}</Link>
                              {traded && <span className="text-xs text-blue-500 dark:text-blue-400 ml-1">traded</span>}
                            </td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// --- Rookie Rankings Tab ---

function RookieRankingsView({
  rookies, posFilter, setPosFilter, leagueId, rosters,
}: {
  rookies: RookieRanking[]; posFilter: string; setPosFilter: (p: string) => void; leagueId: string; rosters: SleeperRoster[];
}) {
  const ownerMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const roster of rosters) {
      for (const pid of roster.players || []) map.set(pid, roster.roster_id);
    }
    return map;
  }, [rosters]);

  return (
    <>
      <div className="flex gap-2 mb-4">
        {['All', 'QB', 'RB', 'WR', 'TE'].map(pos => (
          <button key={pos} onClick={() => setPosFilter(pos)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${posFilter === pos ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'}`}>{pos}</button>
        ))}
      </div>
      {rookies.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">No rookie rankings available yet.</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Rookie values appear in trade value sources as the draft class becomes known (typically January–April).</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-300">
                <th className="px-4 py-2 font-medium w-12">#</th>
                <th className="px-4 py-2 font-medium">Player</th>
                <th className="px-4 py-2 font-medium w-16">Pos</th>
                <th className="px-4 py-2 font-medium w-20">Team</th>
                <th className="px-4 py-2 font-medium w-20 text-right">Value</th>
                <th className="px-4 py-2 font-medium w-28">Owner</th>
              </tr>
            </thead>
            <tbody>
              {rookies.map(rookie => {
                const owner = ownerMap.get(rookie.playerId);
                return (
                  <tr key={rookie.playerId} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-2 text-gray-400 dark:text-gray-500 font-mono">{rookie.rank}</td>
                    <td className="px-4 py-2">
                      <Link to={`/league/${leagueId}/player/${rookie.playerId}`} className="text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 font-medium">{rookie.name}</Link>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${POS_COLORS[rookie.position] || 'bg-gray-100 text-gray-600'}`}>{rookie.position}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{rookie.team || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-700 dark:text-gray-300">{rookie.value.toLocaleString()}</td>
                    <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {owner ? <Link to={`/league/${leagueId}/team/${owner}`} className="hover:text-blue-600 dark:hover:text-blue-400">Rostered</Link> : <span className="text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// --- Draft Strategy Tab ---

function DraftStrategyView({
  strategies, selectedTeam, setSelectedTeam, sortedRosters, users, rosters, leagueId,
}: {
  strategies: TeamDraftStrategy[]; selectedTeam: number | 'all'; setSelectedTeam: (t: number | 'all') => void;
  sortedRosters: SleeperRoster[]; users: SleeperUser[]; rosters: SleeperRoster[]; leagueId: string;
}) {
  return (
    <>
      <div className="mb-4">
        <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100">
          <option value="all">All Teams</option>
          {sortedRosters.map(r => (
            <option key={r.roster_id} value={r.roster_id}>{getUserName(r.roster_id, rosters, users)}</option>
          ))}
        </select>
      </div>
      {strategies.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">No draft strategy data available.</p>
      ) : (
        <div className="space-y-6">
          {strategies.map(strategy => (
            <TeamStrategyCard key={strategy.rosterId} strategy={strategy} leagueId={leagueId} rosters={rosters} users={users} />
          ))}
        </div>
      )}
    </>
  );
}

function TeamStrategyCard({ strategy, leagueId, rosters, users }: {
  strategy: TeamDraftStrategy; leagueId: string; rosters: SleeperRoster[]; users: SleeperUser[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <Link to={`/league/${leagueId}/team/${strategy.rosterId}`} className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400" onClick={e => e.stopPropagation()}>{strategy.teamName}</Link>
          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${TIER_COLORS[strategy.tier]}`}>{strategy.tier}</span>
          <span className="text-sm text-gray-400 dark:text-gray-500">{strategy.picks.length} pick{strategy.picks.length !== 1 ? 's' : ''}</span>
        </div>
        <span className="text-gray-400 dark:text-gray-500 text-sm">{expanded ? '▾' : '▸'}</span>
      </div>

      <div className="px-4 pb-3 text-sm text-gray-600 dark:text-gray-300">{strategy.summary}</div>

      {strategy.needs.length > 0 && (
        <div className="px-4 pb-3 flex gap-2 flex-wrap">
          {strategy.needs.map(need => (
            <span key={need.position} className={`text-xs px-2 py-0.5 rounded border ${need.grade === 'Weak' ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700' : 'bg-yellow-50 text-yellow-600 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700'}`}>
              {need.position}: {need.grade}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {strategy.picks.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 italic">No picks owned this season.</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {strategy.picks.map((pickTarget, i) => (
                <PickTargetRow key={i} pickTarget={pickTarget} leagueId={leagueId} rosters={rosters} users={users} />
              ))}
            </div>
          )}

          {strategy.pickTradeSuggestions.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Pick Trade Ideas</h4>
              <div className="space-y-2">
                {strategy.pickTradeSuggestions.map((suggestion, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${
                      suggestion.type === 'trade-up' ? 'bg-green-100 text-green-700'
                        : suggestion.type === 'trade-down' ? 'bg-blue-100 text-blue-700'
                          : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {suggestion.type === 'trade-up' ? 'Trade Up' : suggestion.type === 'trade-down' ? 'Trade Down' : 'Sell Pick'}
                    </span>
                    <span className="text-gray-600 dark:text-gray-300">{suggestion.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PickTargetRow({ pickTarget, leagueId, rosters, users }: {
  pickTarget: import('../utils/rookieDraft').PickTarget; leagueId: string; rosters: SleeperRoster[]; users: SleeperUser[];
}) {
  const { pick, recommendedPlayers, positionalFit } = pickTarget;
  const isAcquired = pick.originalOwner !== pick.currentOwner;
  const originalName = isAcquired ? getUserName(pick.originalOwner, rosters, users) : null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3 mb-2">
        <span className="font-mono font-medium text-gray-700 dark:text-gray-300 w-14">{pick.pickLabel}</span>
        {isAcquired && <span className="text-xs text-blue-500 dark:text-blue-400">via {originalName}</span>}
        <span className="text-xs text-gray-400 dark:text-gray-500">~{pick.estimatedValue.toLocaleString()} value</span>
        {positionalFit && (
          <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-600 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">{positionalFit}</span>
        )}
      </div>
      {recommendedPlayers.length > 0 ? (
        <div className="ml-14 space-y-1">
          {recommendedPlayers.map((rookie, i) => (
            <div key={rookie.playerId} className="flex items-center gap-2 text-sm">
              <span className="text-gray-400 dark:text-gray-500 w-4">{i + 1}.</span>
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${POS_COLORS[rookie.position] || 'bg-gray-100 text-gray-600'}`}>{rookie.position}</span>
              <Link to={`/league/${leagueId}/player/${rookie.playerId}`} className="text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">{rookie.name}</Link>
              <span className="text-xs text-gray-400 dark:text-gray-500">{rookie.team || ''}</span>
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400 ml-auto">{rookie.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="ml-14 text-sm text-gray-400 dark:text-gray-500 italic">No ranked rookies projected in this range</div>
      )}
    </div>
  );
}
