import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLeagueLayout } from '../components/LeagueLayout';
import { usePlayers } from '../hooks/usePlayers';
import { usePlayerValues } from '../hooks/usePlayerValues';
import { computePowerRankings } from '../utils/powerRankings';
import { countQbStarterSlots } from '../utils/rosterConstruction';
import { getPlayerValue } from '../hooks/usePlayerValues';
import type { ValuesResponse } from '../api/values';
import { getFormatNotes } from '../utils/formatNotes';
import { fetchTradedPicks, fetchDrafts, fetchDraftPicks } from '../api/sleeper';
import { buildDraftOrder, getDraftSlotOrder, buildPickOwnership, computePicksValue, buildRookiePickValueMap, applyRookieValues } from '../utils/draftPicks';
import { buildRookieRankings } from '../utils/rookieDraft';
import type { PickOwnership } from '../utils/draftPicks';
import type { RosterRanking } from '../utils/powerRankings';
import type { SleeperRoster, SleeperUser, SleeperDraft, SleeperDraftPick, CompetitiveTier } from '../types';
import { useTheme } from '../hooks/useTheme';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend } from 'recharts';

function getUserName(roster: SleeperRoster, users: SleeperUser[]): string {
  const user = users.find((u) => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${roster.roster_id}`;
}


function formatValue(val: number): string {
  return Math.round(val).toLocaleString();
}

const tierColors: Record<CompetitiveTier, string> = {
  'Strong Contender': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  'Contender': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  'Fringe Playoff': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  'Rebuilder': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

type ViewMode = 'standings' | 'power' | 'positional';

export default function Dashboard() {
  const { data, leagueId } = useLeagueLayout();
  const { players, status: playersStatus } = usePlayers();
  const { values, status: valuesStatus } = usePlayerValues(data.leagueType);
  const [view, setView] = useState<ViewMode>('power');
  const [allPicks, setAllPicks] = useState<PickOwnership[]>([]);

  const { league, rosters, users } = data;
  const playersReady = playersStatus === 'ready';
  const valuesReady = valuesStatus === 'ready';

  // Fetch draft pick data for pick value computation
  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;

    async function loadPicks() {
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

        const preDraftOrders = new Map<string, Map<number, number>>();
        for (const d of drafts) {
          if (d.status === 'pre_draft' && (d.slot_to_roster_id || d.draft_order)) {
            const rosterOrder = getDraftSlotOrder(d, rosters);
            if (rosterOrder.size > 0) preDraftOrders.set(d.season, rosterOrder);
          }
        }

        const currentSeason = league.season;
        const currentSeasonNum = parseInt(currentSeason, 10);
        const seasons = [String(currentSeasonNum), String(currentSeasonNum + 1), String(currentSeasonNum + 2)];
        const maxRounds = league.settings?.draft_rounds ?? 4;
        const draftOrder = buildDraftOrder(rosters);

        const picks = buildPickOwnership(rosters, traded, seasons, maxRounds, currentSeason, draftOrder, draftPicksBySeason, preDraftOrders, league.total_rosters);
        if (!cancelled) setAllPicks(picks);
      } catch {
        // Non-critical — picks just won't show values
      }
    }

    loadPicks();
    return () => { cancelled = true; };
  }, [leagueId, rosters, league]);

  const rankings = valuesReady
    ? computePowerRankings(rosters, values, players, league.roster_positions)
    : [];

  const formatNotes = getFormatNotes(league);

  // Apply rookie values to current-season picks
  const enrichedPicks = useMemo(() => {
    if (allPicks.length === 0 || !players || !values) return allPicks;
    const rookieMap = buildRookiePickValueMap(buildRookieRankings(players, values));
    if (rookieMap.size === 0) return allPicks;
    return applyRookieValues(allPicks, league.season, league.total_rosters, rookieMap);
  }, [allPicks, players, values, league.season, league.total_rosters]);

  // Map rosterId -> ranking for quick lookup
  const rankingMap = new Map<number, RosterRanking>();
  for (const r of rankings) rankingMap.set(r.rosterId, r);

  // Map rosterId -> pick capital value
  const pickValueMap = useMemo(() => {
    const map = new Map<number, number>();
    if (enrichedPicks.length === 0) return map;
    for (const roster of rosters) {
      map.set(roster.roster_id, computePicksValue(enrichedPicks, roster.roster_id));
    }
    return map;
  }, [enrichedPicks, rosters]);

  // Max total value for bar widths (include pick value)
  const maxValue = rankings.length > 0 ? Math.max(...rankings.map((r) => r.totalValue + (pickValueMap.get(r.rosterId) ?? 0))) : 1;

  // Sort rosters by wins descending, then points
  const sortedByStandings = [...rosters].sort((a, b) => {
    const wDiff = (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0);
    if (wDiff !== 0) return wDiff;
    return (b.settings?.fpts ?? 0) - (a.settings?.fpts ?? 0);
  });

  // Sort rosters by power ranking
  const sortedByPower = rankings.length > 0
    ? [...rosters].sort((a, b) => {
        const aRank = rankingMap.get(a.roster_id)?.rank ?? 999;
        const bRank = rankingMap.get(b.roster_id)?.rank ?? 999;
        return aRank - bRank;
      })
    : sortedByStandings;

  const displayRosters = view === 'power' && rankings.length > 0 ? sortedByPower : sortedByStandings;

  return (
    <main className="max-w-6xl mx-auto px-8 py-6">
        {/* View toggle */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setView('power')}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                view === 'power'
                  ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'
              }`}
            >
              Power Rankings
            </button>
            <button
              onClick={() => setView('positional')}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                view === 'positional'
                  ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'
              }`}
            >
              Positional Rankings
            </button>
            <button
              onClick={() => setView('standings')}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                view === 'standings'
                  ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'
              }`}
            >
              Standings
            </button>
          </div>
          {valuesReady && values?.lastRefresh && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              Values updated {new Date(values.lastRefresh).toLocaleDateString()}
            </span>
          )}
        </div>

        {view === 'power' && rankings.length > 0 ? (
          <PowerRankingsView
            rosters={displayRosters}
            users={users}
            rankingMap={rankingMap}
            pickValueMap={pickValueMap}
            maxValue={maxValue}
            leagueId={leagueId!}
          />
        ) : view === 'positional' && valuesReady && playersReady ? (
          <PositionalRankingsView
            rosters={rosters}
            users={users}
            players={players!}
            values={values!}
            rosterPositions={league.roster_positions || []}
            rankingMap={rankingMap}
            leagueId={leagueId!}
          />
        ) : (
          <StandingsView
            rosters={displayRosters}
            users={users}
            players={players}
            playersReady={playersReady}
            rankingMap={rankingMap}
            valuesReady={valuesReady}
            leagueId={leagueId!}
          />
        )}

        {valuesStatus === 'loading' && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">Loading player values...</p>
        )}
        {valuesStatus === 'error' && (
          <p className="text-xs text-red-400 dark:text-red-400 mt-4">Failed to load player values. Showing standings only.</p>
        )}

        {/* Charts Row */}
        {rankings.length > 0 && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <TierDistributionChart rankings={rankings} />
            <LeagueRadarChart rankings={rankings} rosters={rosters} users={users} pickValueMap={pickValueMap} />
          </div>
        )}

        {/* League Format Notes */}
        {formatNotes.length > 0 && (
          <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">League Format Notes</h3>
            <div className="space-y-3">
              {formatNotes.map((note, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded px-2 py-0.5 shrink-0 mt-0.5">
                    {note.label}
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{note.note}</p>
                </div>
              ))}
            </div>
          </div>
        )}
    </main>
  );
}

function PowerRankingsView({
  rosters,
  users,
  rankingMap,
  pickValueMap,
  maxValue,
  leagueId,
}: {
  rosters: SleeperRoster[];
  users: SleeperUser[];
  rankingMap: Map<number, RosterRanking>;
  pickValueMap: Map<number, number>;
  maxValue: number;
  leagueId: string;
}) {
  return (
    <div className="space-y-3">
      {rosters.map((roster) => {
        const ranking = rankingMap.get(roster.roster_id);
        if (!ranking) return null;
        const pickValue = pickValueMap.get(roster.roster_id) ?? 0;
        const combinedValue = ranking.totalValue + pickValue;
        const barWidth = maxValue > 0 ? (combinedValue / maxValue) * 100 : 0;

        return (
          <div
            key={roster.roster_id}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-gray-300 dark:text-gray-600 w-8">
                  {ranking.rank}
                </span>
                <Link
                  to={`/league/${leagueId}/team/${roster.roster_id}`}
                  className="font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {getUserName(roster, users)}
                </Link>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tierColors[ranking.tier]}`}>
                  {ranking.tier} ({ranking.tierScore})
                </span>
              </div>
              <div className="flex items-center gap-3">
                {ranking.avgStarterAge > 0 && (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    Avg age {ranking.avgStarterAge}
                  </span>
                )}
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {formatValue(combinedValue)}
                </span>
              </div>
            </div>

            {/* Value bar */}
            <div className="h-5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
              <div className="h-full rounded-full flex" style={{ width: `${barWidth}%` }}>
                <div
                  className="bg-red-400 h-full"
                  style={{ width: combinedValue > 0 ? `${(ranking.qbValue / combinedValue) * 100}%` : '0%' }}
                  title={`QB: ${formatValue(ranking.qbValue)}`}
                />
                <div
                  className="bg-blue-400 h-full"
                  style={{ width: combinedValue > 0 ? `${(ranking.rbValue / combinedValue) * 100}%` : '0%' }}
                  title={`RB: ${formatValue(ranking.rbValue)}`}
                />
                <div
                  className="bg-green-400 h-full"
                  style={{ width: combinedValue > 0 ? `${(ranking.wrValue / combinedValue) * 100}%` : '0%' }}
                  title={`WR: ${formatValue(ranking.wrValue)}`}
                />
                <div
                  className="bg-orange-400 h-full"
                  style={{ width: combinedValue > 0 ? `${(ranking.teValue / combinedValue) * 100}%` : '0%' }}
                  title={`TE: ${formatValue(ranking.teValue)}`}
                />
                {pickValue > 0 && (
                  <div
                    className="bg-purple-400 h-full"
                    style={{ width: `${(pickValue / combinedValue) * 100}%` }}
                    title={`Picks: ${formatValue(pickValue)}`}
                  />
                )}
              </div>
            </div>

            {/* Positional breakdown */}
            <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
              <span><span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1" />QB {formatValue(ranking.qbValue)}</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1" />RB {formatValue(ranking.rbValue)}</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1" />WR {formatValue(ranking.wrValue)}</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-1" />TE {formatValue(ranking.teValue)}</span>
              {pickValue > 0 && (
                <span><span className="inline-block w-2 h-2 rounded-full bg-purple-400 mr-1" />Picks {formatValue(pickValue)}</span>
              )}
              <span className="ml-auto text-gray-400 dark:text-gray-500">
                Starters: {formatValue(ranking.starterValue)} · Bench: {formatValue(ranking.benchValue)}
              </span>
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        Values averaged across KeepTradeCut, FantasyCalc, and DynastyProcess. Pick values are estimated.
      </p>
    </div>
  );
}

// --- Positional Rankings View ---

type PositionalTab = 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX';

const POS_TAB_COLORS: Record<PositionalTab, { active: string; dot: string }> = {
  QB: { active: 'bg-red-500 text-white border-red-500', dot: 'bg-red-400' },
  RB: { active: 'bg-blue-500 text-white border-blue-500', dot: 'bg-blue-400' },
  WR: { active: 'bg-green-500 text-white border-green-500', dot: 'bg-green-400' },
  TE: { active: 'bg-orange-500 text-white border-orange-500', dot: 'bg-orange-400' },
  FLEX: { active: 'bg-purple-500 text-white border-purple-500', dot: 'bg-purple-400' },
};

const GRADE_BG: Record<string, string> = {
  Strong: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  Adequate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
  Weak: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
};

interface TeamPositionalData {
  rosterId: number;
  teamName: string;
  starters: { id: string; name: string; team: string; age: number; value: number }[];
  bench: { id: string; name: string; team: string; age: number; value: number }[];
  starterValue: number;
  benchValue: number;
  totalValue: number;
  starterGrade: 'Strong' | 'Adequate' | 'Weak';
}

function PositionalRankingsView({
  rosters,
  users,
  players,
  values,
  rosterPositions,
  rankingMap,
  leagueId,
}: {
  rosters: SleeperRoster[];
  users: SleeperUser[];
  players: Record<string, any>;
  values: ValuesResponse;
  rosterPositions: string[];
  rankingMap: Map<number, RosterRanking>;
  leagueId: string;
}) {
  const [activePos, setActivePos] = useState<PositionalTab>('QB');

  // Flex slot types and their eligible positions
  const FLEX_SLOT_TYPES = ['FLEX', 'SUPER_FLEX', 'REC_FLEX', 'WRRB_FLEX'];
  const FLEX_ELIGIBLE: Record<string, string[]> = {
    FLEX: ['RB', 'WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
    REC_FLEX: ['WR', 'TE'],
    WRRB_FLEX: ['RB', 'WR'],
  };

  const teamData = useMemo(() => {
    const allTabs: PositionalTab[] = ['QB', 'RB', 'WR', 'TE', 'FLEX'];
    const qbSlots = countQbStarterSlots(rosterPositions);
    const rbSlotCount = rosterPositions.filter(s => s === 'RB').length;
    const wrSlotCount = rosterPositions.filter(s => s === 'WR').length;
    const teSlotCount = 1;
    const flexSlots = rosterPositions.filter(s => FLEX_SLOT_TYPES.includes(s));

    const result: Record<PositionalTab, TeamPositionalData[]> = { QB: [], RB: [], WR: [], TE: [], FLEX: [] };

    for (const roster of rosters) {
      const rosterPlayers = roster.players || [];

      // Build player data grouped by position, sorted by value desc
      const playersByPos: Record<string, { id: string; name: string; team: string; age: number; value: number }[]> = {};
      for (const pos of ['QB', 'RB', 'WR', 'TE']) playersByPos[pos] = [];

      for (const pid of rosterPlayers) {
        const pos = players[pid]?.position as string;
        if (!pos || !playersByPos[pos]) continue;
        playersByPos[pos].push({
          id: pid,
          name: players[pid]?.full_name || players[pid]?.first_name + ' ' + players[pid]?.last_name || pid,
          team: players[pid]?.team || '',
          age: players[pid]?.age || 0,
          value: getPlayerValue(values, pid),
        });
      }
      for (const pos of ['QB', 'RB', 'WR', 'TE']) {
        playersByPos[pos].sort((a, b) => b.value - a.value);
      }

      // Assign dedicated starters by position
      const qbStarters = playersByPos['QB'].slice(0, qbSlots);
      const rbStarters = playersByPos['RB'].slice(0, rbSlotCount);
      const wrStarters = playersByPos['WR'].slice(0, wrSlotCount);
      const teStarters = playersByPos['TE'].slice(0, teSlotCount);

      // Compute flex starters: fill flex slots greedily from remaining eligible players
      const dedicatedIds = new Set([
        ...playersByPos['QB'].slice(0, rosterPositions.filter(s => s === 'QB').length).map(p => p.id),
        ...rbStarters.map(p => p.id),
        ...wrStarters.map(p => p.id),
        ...teStarters.map(p => p.id),
      ]);

      // All remaining players eligible for flex, sorted by value
      const allRemainingPlayers = ['QB', 'RB', 'WR', 'TE']
        .flatMap(pos => playersByPos[pos].filter(p => !dedicatedIds.has(p.id)))
        .sort((a, b) => b.value - a.value);

      // Sort flex slots by restrictiveness (fewest eligible positions first)
      const sortedFlexSlots = [...flexSlots].sort(
        (a, b) => (FLEX_ELIGIBLE[a]?.length || 99) - (FLEX_ELIGIBLE[b]?.length || 99)
      );

      const flexStarters: { id: string; name: string; team: string; age: number; value: number }[] = [];
      const usedInFlex = new Set<string>();

      for (const slotType of sortedFlexSlots) {
        const eligible = FLEX_ELIGIBLE[slotType] || [];
        let best: typeof allRemainingPlayers[0] | null = null;
        for (const p of allRemainingPlayers) {
          if (usedInFlex.has(p.id)) continue;
          const pos = players[p.id]?.position as string;
          if (eligible.includes(pos)) {
            best = p;
            break;
          }
        }
        if (best) {
          usedInFlex.add(best.id);
          flexStarters.push(best);
        }
      }

      const teamName = getUserName(roster, users);
      const rosterId = roster.roster_id;

      // Build data for each position tab
      // QB: top qbSlots QBs (includes SF QB)
      const qbBench = playersByPos['QB'].slice(qbSlots);
      const qbStarterValue = qbStarters.reduce((s, p) => s + p.value, 0);
      result['QB'].push({
        rosterId, teamName,
        starters: qbStarters, bench: qbBench,
        starterValue: qbStarterValue,
        benchValue: qbBench.reduce((s, p) => s + p.value, 0),
        totalValue: playersByPos['QB'].reduce((s, p) => s + p.value, 0),
        starterGrade: 'Adequate',
      });

      // RB: dedicated RB slot starters only
      const rbBench = playersByPos['RB'].slice(rbSlotCount);
      const rbStarterValue = rbStarters.reduce((s, p) => s + p.value, 0);
      result['RB'].push({
        rosterId, teamName,
        starters: rbStarters, bench: rbBench,
        starterValue: rbStarterValue,
        benchValue: rbBench.reduce((s, p) => s + p.value, 0),
        totalValue: playersByPos['RB'].reduce((s, p) => s + p.value, 0),
        starterGrade: 'Adequate',
      });

      // WR: dedicated WR slot starters only
      const wrBench = playersByPos['WR'].slice(wrSlotCount);
      const wrStarterValue = wrStarters.reduce((s, p) => s + p.value, 0);
      result['WR'].push({
        rosterId, teamName,
        starters: wrStarters, bench: wrBench,
        starterValue: wrStarterValue,
        benchValue: wrBench.reduce((s, p) => s + p.value, 0),
        totalValue: playersByPos['WR'].reduce((s, p) => s + p.value, 0),
        starterGrade: 'Adequate',
      });

      // TE: top 1 TE starter
      const teBench = playersByPos['TE'].slice(teSlotCount);
      const teStarterValue = teStarters.reduce((s, p) => s + p.value, 0);
      result['TE'].push({
        rosterId, teamName,
        starters: teStarters, bench: teBench,
        starterValue: teStarterValue,
        benchValue: teBench.reduce((s, p) => s + p.value, 0),
        totalValue: playersByPos['TE'].reduce((s, p) => s + p.value, 0),
        starterGrade: 'Adequate',
      });

      // FLEX: players filling flex slots
      const flexBench = allRemainingPlayers.filter(p => !usedInFlex.has(p.id));
      const flexStarterValue = flexStarters.reduce((s, p) => s + p.value, 0);
      result['FLEX'].push({
        rosterId, teamName,
        starters: flexStarters, bench: flexBench,
        starterValue: flexStarterValue,
        benchValue: flexBench.reduce((s, p) => s + p.value, 0),
        totalValue: flexStarterValue + flexBench.reduce((s, p) => s + p.value, 0),
        starterGrade: 'Adequate',
      });
    }

    // Compute grades and sort for each tab
    for (const tab of allTabs) {
      const teamsAtPos = result[tab];
      const starterValues = teamsAtPos.map(t => t.starterValue).sort((a, b) => b - a);
      const n = starterValues.length;
      const topThreshold = Math.ceil(n / 3);
      const midThreshold = Math.ceil((n * 2) / 3);

      for (const team of teamsAtPos) {
        let rank = starterValues.findIndex(v => team.starterValue >= v);
        if (rank === -1) rank = n;
        if (rank < topThreshold) team.starterGrade = 'Strong';
        else if (rank < midThreshold) team.starterGrade = 'Adequate';
        else team.starterGrade = 'Weak';
      }

      teamsAtPos.sort((a, b) => b.starterValue - a.starterValue);
    }

    return result;
  }, [rosters, users, players, values, rosterPositions]);

  const teamsForPos = teamData[activePos];
  const maxStarterValue = teamsForPos.length > 0 ? teamsForPos[0].starterValue : 1;

  return (
    <div>
      {/* Position tabs */}
      <div className="flex gap-2 mb-4">
        {(['QB', 'RB', 'WR', 'TE', 'FLEX'] as PositionalTab[]).map(pos => (
          <button
            key={pos}
            onClick={() => setActivePos(pos)}
            className={`text-sm px-4 py-1.5 rounded-full border transition-colors font-medium ${
              activePos === pos
                ? POS_TAB_COLORS[pos].active
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'
            }`}
          >
            {pos}
          </button>
        ))}
      </div>

      {/* Team cards */}
      <div className="space-y-3">
        {teamsForPos.map((team, idx) => {
          const ranking = rankingMap.get(team.rosterId);
          const barWidth = maxStarterValue > 0 ? (team.starterValue / maxStarterValue) * 100 : 0;

          return (
            <div
              key={team.rosterId}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-gray-300 dark:text-gray-600 w-8">
                    {idx + 1}
                  </span>
                  <Link
                    to={`/league/${leagueId}/team/${team.rosterId}`}
                    className="font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    {team.teamName}
                  </Link>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${GRADE_BG[team.starterGrade]}`}>
                    {team.starterGrade}
                  </span>
                  {ranking && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tierColors[ranking.tier]}`}>
                      {ranking.tier}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-700 dark:text-gray-300 font-semibold">{formatValue(team.starterValue)}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-xs">Bench: {formatValue(team.benchValue)}</span>
                </div>
              </div>

              {/* Starter value bar */}
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full ${POS_TAB_COLORS[activePos].dot}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>

              {/* Starters */}
              <div className="mb-2">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                  {activePos === 'FLEX' ? 'Flex Starters' : 'Starters'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {team.starters.map(p => {
                    const playerPos = players[p.id]?.position as string;
                    return (
                      <Link
                        key={p.id}
                        to={`/league/${leagueId}/player/${p.id}`}
                        className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700 rounded-lg px-2.5 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                      >
                        {activePos === 'FLEX' && playerPos && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            playerPos === 'QB' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' :
                            playerPos === 'RB' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' :
                            playerPos === 'WR' ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' :
                            'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
                          }`}>{playerPos}</span>
                        )}
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
                        {p.team && <span className="text-xs text-gray-400 dark:text-gray-500">{p.team}</span>}
                        {p.age > 0 && <span className="text-xs text-gray-400 dark:text-gray-500">({p.age})</span>}
                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{formatValue(p.value)}</span>
                      </Link>
                    );
                  })}
                  {team.starters.length === 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 italic">No starters</span>
                  )}
                </div>
              </div>

              {/* Bench */}
              {team.bench.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Bench</p>
                  <div className="flex flex-wrap gap-1.5">
                    {team.bench.map(p => {
                      const playerPos = players[p.id]?.position as string;
                      return (
                        <Link
                          key={p.id}
                          to={`/league/${leagueId}/player/${p.id}`}
                          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 bg-gray-50/50 dark:bg-gray-700/50 rounded px-2 py-1"
                        >
                          {activePos === 'FLEX' && playerPos && (
                            <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500">{playerPos}</span>
                          )}
                          <span>{p.name}</span>
                          <span className="text-gray-400 dark:text-gray-500">{formatValue(p.value)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        Teams ranked by total starter value at {activePos}. {activePos === 'FLEX' ? 'Flex includes FLEX, SUPER_FLEX, REC_FLEX, and WRRB_FLEX slots. ' : ''}Grades based on league-wide percentile (top 33% = Strong, middle = Adequate, bottom = Weak).
      </p>
    </div>
  );
}

type SortKey = 'wins' | 'pf' | 'pa' | 'maxpf' | 'value' | 'tier';
type SortDir = 'asc' | 'desc';

function StandingsView({
  rosters,
  users,
  rankingMap,
  valuesReady,
  leagueId,
}: {
  rosters: SleeperRoster[];
  users: SleeperUser[];
  players: Record<string, any> | null;
  playersReady: boolean;
  rankingMap: Map<number, RosterRanking>;
  valuesReady: boolean;
  leagueId: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('wins');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return '';
    return sortDir === 'desc' ? ' ▾' : ' ▴';
  }

  const sorted = [...rosters].sort((a, b) => {
    const dir = sortDir === 'desc' ? -1 : 1;
    switch (sortKey) {
      case 'wins': {
        const wDiff = (a.settings?.wins ?? 0) - (b.settings?.wins ?? 0);
        if (wDiff !== 0) return wDiff * dir;
        return ((a.settings?.fpts ?? 0) - (b.settings?.fpts ?? 0)) * dir;
      }
      case 'pf':
        return ((a.settings?.fpts ?? 0) + (a.settings?.fpts_decimal ?? 0) / 100
          - (b.settings?.fpts ?? 0) - (b.settings?.fpts_decimal ?? 0) / 100) * dir;
      case 'pa':
        return ((a.settings?.fpts_against ?? 0) + (a.settings?.fpts_against_decimal ?? 0) / 100
          - (b.settings?.fpts_against ?? 0) - (b.settings?.fpts_against_decimal ?? 0) / 100) * dir;
      case 'maxpf':
        return ((a.settings?.ppts ?? 0) + (a.settings?.ppts_decimal ?? 0) / 100
          - (b.settings?.ppts ?? 0) - (b.settings?.ppts_decimal ?? 0) / 100) * dir;
      case 'value': {
        const aVal = rankingMap.get(a.roster_id)?.totalValue ?? 0;
        const bVal = rankingMap.get(b.roster_id)?.totalValue ?? 0;
        return (aVal - bVal) * dir;
      }
      case 'tier': {
        const aScore = rankingMap.get(a.roster_id)?.tierScore ?? 0;
        const bScore = rankingMap.get(b.roster_id)?.tierScore ?? 0;
        return (aScore - bScore) * dir;
      }
      default:
        return 0;
    }
  });

  const thClass = 'px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-900 dark:hover:text-gray-100 transition-colors';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-300">
            <th className="px-4 py-3 font-medium w-10">#</th>
            <th className="px-4 py-3 font-medium">Team</th>
            <th className={`${thClass} text-center`} onClick={() => handleSort('wins')}>
              Record{sortIndicator('wins')}
            </th>
            <th className={`${thClass} text-right`} onClick={() => handleSort('pf')}>
              PF{sortIndicator('pf')}
            </th>
            <th className={`${thClass} text-right`} onClick={() => handleSort('pa')}>
              PA{sortIndicator('pa')}
            </th>
            <th className={`${thClass} text-right`} onClick={() => handleSort('maxpf')}>
              Max PF{sortIndicator('maxpf')}
            </th>
            {valuesReady && (
              <th className={`${thClass} text-right`} onClick={() => handleSort('value')}>
                Value{sortIndicator('value')}
              </th>
            )}
            {valuesReady && (
              <th className={`${thClass} text-right`} onClick={() => handleSort('tier')}>
                Tier{sortIndicator('tier')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((roster, i) => {
            const wins = roster.settings?.wins ?? 0;
            const losses = roster.settings?.losses ?? 0;
            const ties = roster.settings?.ties ?? 0;
            const fpts = roster.settings?.fpts ?? 0;
            const fptsDecimal = roster.settings?.fpts_decimal ?? 0;
            const pa = roster.settings?.fpts_against ?? 0;
            const paDecimal = roster.settings?.fpts_against_decimal ?? 0;
            const ppts = roster.settings?.ppts ?? 0;
            const pptsDecimal = roster.settings?.ppts_decimal ?? 0;
            const record = `${wins}-${losses}${ties > 0 ? `-${ties}` : ''}`;
            const ranking = rankingMap.get(roster.roster_id);

            return (
              <tr
                key={roster.roster_id}
                className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500">{i + 1}</td>
                <td className="px-4 py-3">
                  <Link
                    to={`/league/${leagueId}/team/${roster.roster_id}`}
                    className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    {getUserName(roster, users)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-center dark:text-gray-300">{record}</td>
                <td className="px-4 py-3 text-right dark:text-gray-300">
                  {fpts}.{String(fptsDecimal).padStart(2, '0')}
                </td>
                <td className="px-4 py-3 text-right dark:text-gray-300">
                  {pa}.{String(paDecimal).padStart(2, '0')}
                </td>
                <td className="px-4 py-3 text-right dark:text-gray-300">
                  {ppts}.{String(pptsDecimal).padStart(2, '0')}
                </td>
                {valuesReady && (
                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                    {ranking ? formatValue(ranking.totalValue) : '—'}
                  </td>
                )}
                {valuesReady && (
                  <td className="px-4 py-3 text-right">
                    {ranking && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tierColors[ranking.tier]}`}>
                        {ranking.tier}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const TIER_CHART_COLORS: Record<CompetitiveTier, string> = {
  'Strong Contender': '#22c55e',
  'Contender': '#3b82f6',
  'Fringe Playoff': '#eab308',
  'Rebuilder': '#ef4444',
};

function TierDistributionChart({ rankings }: { rankings: RosterRanking[] }) {
  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rankings) {
      counts[r.tier] = (counts[r.tier] || 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [rankings]);

  const { theme } = useTheme();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Tier Distribution</h3>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={tierCounts}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            label={({ name, value }) => `${name}: ${value}`}
          >
            {tierCounts.map((entry) => (
              <Cell key={entry.name} fill={TIER_CHART_COLORS[entry.name as CompetitiveTier] || '#6b7280'} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: theme === 'dark' ? '#1f2937' : '#fff',
              border: `1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'}`,
              borderRadius: '8px',
              color: theme === 'dark' ? '#f3f4f6' : '#111827',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function LeagueRadarChart({
  rankings,
  rosters,
  users,
  pickValueMap,
}: {
  rankings: RosterRanking[];
  rosters: SleeperRoster[];
  users: SleeperUser[];
  pickValueMap: Map<number, number>;
}) {
  const { theme } = useTheme();

  // Show top 3 teams by total value on the radar
  const top3 = useMemo(() => {
    return [...rankings]
      .sort((a, b) => (b.totalValue + (pickValueMap.get(b.rosterId) ?? 0)) - (a.totalValue + (pickValueMap.get(a.rosterId) ?? 0)))
      .slice(0, 3);
  }, [rankings, pickValueMap]);

  const radarData = useMemo(() => {
    const maxPerPos = { QB: 1, RB: 1, WR: 1, TE: 1, Picks: 1 };
    for (const r of rankings) {
      if (r.qbValue > maxPerPos.QB) maxPerPos.QB = r.qbValue;
      if (r.rbValue > maxPerPos.RB) maxPerPos.RB = r.rbValue;
      if (r.wrValue > maxPerPos.WR) maxPerPos.WR = r.wrValue;
      if (r.teValue > maxPerPos.TE) maxPerPos.TE = r.teValue;
      const pv = pickValueMap.get(r.rosterId) ?? 0;
      if (pv > maxPerPos.Picks) maxPerPos.Picks = pv;
    }
    const positions = ['QB', 'RB', 'WR', 'TE', 'Picks'] as const;
    return positions.map(pos => {
      const entry: Record<string, string | number> = { position: pos };
      for (const team of top3) {
        const name = getUserName(
          rosters.find(r => r.roster_id === team.rosterId)!,
          users,
        );
        let val = 0;
        if (pos === 'QB') val = team.qbValue;
        else if (pos === 'RB') val = team.rbValue;
        else if (pos === 'WR') val = team.wrValue;
        else if (pos === 'TE') val = team.teValue;
        else val = pickValueMap.get(team.rosterId) ?? 0;
        const maxVal = maxPerPos[pos];
        entry[name] = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
      }
      return entry;
    });
  }, [top3, rankings, rosters, users, pickValueMap]);

  const COLORS = ['#3b82f6', '#22c55e', '#f59e0b'];

  if (top3.length === 0) return null;

  const teamNames = top3.map(t =>
    getUserName(rosters.find(r => r.roster_id === t.rosterId)!, users),
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Top 3 Teams Comparison</h3>
      <ResponsiveContainer width="100%" height={200}>
        <RadarChart data={radarData}>
          <PolarGrid stroke={theme === 'dark' ? '#374151' : '#e5e7eb'} />
          <PolarAngleAxis dataKey="position" tick={{ fill: theme === 'dark' ? '#9ca3af' : '#6b7280', fontSize: 12 }} />
          {teamNames.map((name, i) => (
            <Radar key={name} name={name} dataKey={name} stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.15} />
          ))}
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          <Tooltip
            contentStyle={{
              backgroundColor: theme === 'dark' ? '#1f2937' : '#fff',
              border: `1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'}`,
              borderRadius: '8px',
              color: theme === 'dark' ? '#f3f4f6' : '#111827',
            }}
            formatter={(value) => `${value}%`}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
