import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLeagueLayout } from '../components/LeagueLayout';
import { fetchTradedPicks, fetchDrafts, fetchDraftPicks } from '../api/sleeper';
import type { SleeperTradedPick, SleeperDraft, SleeperDraftPick, SleeperRoster, SleeperUser } from '../types';
import { buildDraftOrder, getDraftSlotOrder, buildPickOwnership } from '../utils/draftPicks';
import type { PickOwnership } from '../utils/draftPicks';

function getUserName(rosterId: number, rosters: SleeperRoster[], users: SleeperUser[]): string {
  const roster = rosters.find((r) => r.roster_id === rosterId);
  if (!roster) return `Team ${rosterId}`;
  const user = users.find((u) => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${rosterId}`;
}

type ViewMode = 'by-team' | 'by-round';

export default function DraftPicks() {
  const { data, leagueId } = useLeagueLayout();
  const [tradedPicks, setTradedPicks] = useState<SleeperTradedPick[]>([]);
  const [completedDraftPicks, setCompletedDraftPicks] = useState<Map<string, SleeperDraftPick[]>>(new Map());
  const [rawDrafts, setRawDrafts] = useState<SleeperDraft[]>([]);
  const [pickStatus, setPickStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [viewMode, setViewMode] = useState<ViewMode>('by-team');

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;

    async function loadPicks() {
      setPickStatus('loading');
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
            if (pickResults[i].length > 0) {
              draftPicksBySeason.set(d.season, pickResults[i]);
            }
          });
        }

        setTradedPicks(traded);
        setCompletedDraftPicks(draftPicksBySeason);
        setRawDrafts(drafts);
        setPickStatus('ready');
      } catch {
        if (!cancelled) setPickStatus('error');
      }
    }

    loadPicks();
    return () => { cancelled = true; };
  }, [leagueId]);

  const { league, rosters, users } = data;
  const currentSeason = league.season;
  const currentSeasonNum = parseInt(currentSeason, 10);
  const seasons = [
    String(currentSeasonNum),
    String(currentSeasonNum + 1),
    String(currentSeasonNum + 2),
  ];

  const maxRounds = league.settings?.draft_rounds ?? 4;
  const draftOrder = buildDraftOrder(rosters);

  const preDraftOrders = new Map<string, Map<number, number>>();
  for (const d of rawDrafts) {
    if (d.status === 'pre_draft' && (d.slot_to_roster_id || d.draft_order)) {
      const rosterOrder = getDraftSlotOrder(d, rosters);
      if (rosterOrder.size > 0) {
        preDraftOrders.set(d.season, rosterOrder);
      }
    }
  }

  const allPicks = pickStatus === 'ready'
    ? buildPickOwnership(rosters, tradedPicks, seasons, maxRounds, currentSeason, draftOrder, completedDraftPicks, preDraftOrders, league.total_rosters)
    : [];

  const sortedRosters = [...rosters].sort((a, b) => {
    const wDiff = (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0);
    if (wDiff !== 0) return wDiff;
    return (b.settings?.fpts ?? 0) - (a.settings?.fpts ?? 0);
  });

  return (
    <main className="max-w-6xl mx-auto px-8 py-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Draft Picks</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {seasons[0]}–{seasons[2]} &middot; {maxRounds} rounds per year
          {tradedPicks.length > 0 ? ` · ${tradedPicks.length} picks traded` : ''}
        </p>
      </div>
        {/* View toggle */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex gap-2">
            {([['by-team', 'By Team'], ['by-round', 'By Round']] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setViewMode(value)}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
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
            ~ = projected from standings
          </span>
        </div>

        {pickStatus === 'loading' && (
          <p className="text-gray-500 dark:text-gray-400 text-sm">Loading draft picks...</p>
        )}

        {pickStatus === 'error' && (
          <p className="text-red-600 dark:text-red-400 text-sm">Failed to load traded picks.</p>
        )}

        {pickStatus === 'ready' && viewMode === 'by-team' && (
          <ByTeamView rosters={sortedRosters} users={users} picks={allPicks} seasons={seasons} leagueId={leagueId!} />
        )}

        {pickStatus === 'ready' && viewMode === 'by-round' && (
          <ByRoundView rosters={sortedRosters} users={users} picks={allPicks} seasons={seasons} maxRounds={maxRounds} leagueId={leagueId!} />
        )}
    </main>
  );
}

function ByTeamView({ rosters, users, picks, seasons, leagueId }: {
  rosters: SleeperRoster[]; users: SleeperUser[]; picks: PickOwnership[]; seasons: string[]; leagueId: string;
}) {
  return (
    <div className="space-y-4">
      {rosters.map((roster) => {
        const teamPicks = picks.filter((p) => p.currentOwner === roster.roster_id);
        const teamName = getUserName(roster.roster_id, rosters, users);
        return (
          <div key={roster.roster_id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <Link to={`/league/${leagueId}/team/${roster.roster_id}`} className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">{teamName}</Link>
            <span className="text-sm text-gray-400 dark:text-gray-500 ml-2">{teamPicks.length} picks</span>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {seasons.map((season) => {
                const seasonPicks = teamPicks.filter((p) => p.season === season).sort((a, b) => a.round - b.round || a.pickInRound - b.pickInRound);
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
  );
}

function ByRoundView({ rosters, users, picks, seasons, maxRounds, leagueId }: {
  rosters: SleeperRoster[]; users: SleeperUser[]; picks: PickOwnership[]; seasons: string[]; maxRounds: number; leagueId: string;
}) {
  return (
    <div className="space-y-6">
      {seasons.map((season) => (
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
                {Array.from({ length: maxRounds }, (_, r) => r + 1).map((round) => {
                  const roundPicks = picks.filter((p) => p.season === season && p.round === round).sort((a, b) => a.pickInRound - b.pickInRound);
                  return roundPicks.map((pick) => {
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
  );
}
