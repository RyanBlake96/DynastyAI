import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLeagueLayout } from '../components/LeagueLayout';
import { usePlayers, getPlayerInfo } from '../hooks/usePlayers';
import { usePlayerValues, getPlayerValue, getPlayerValueBreakdown } from '../hooks/usePlayerValues';
import { analyseRoster } from '../utils/rosterConstruction';
import { computePowerRankings } from '../utils/powerRankings';
import { computeRecommendation } from '../utils/recommendations';
import { findTradeTargets } from '../utils/tradeTargets';
import type { TradeRecommendation } from '../utils/tradeTargets';
import { fetchTradedPicks, fetchDrafts, fetchDraftPicks } from '../api/sleeper';
import { buildDraftOrder, getDraftSlotOrder, buildPickOwnership, buildRookiePickValueMap, applyRookieValues } from '../utils/draftPicks';
import type { PickOwnership } from '../utils/draftPicks';
import { buildRookieRankings } from '../utils/rookieDraft';
import type { DepthGrade } from '../utils/rosterConstruction';
import type { RosterRanking } from '../utils/powerRankings';
import type { Recommendation } from '../utils/recommendations';
import type { SleeperRoster, SleeperUser, SleeperDraft, SleeperDraftPick, CompetitiveTier } from '../types';

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-100 text-red-700',
  RB: 'bg-blue-100 text-blue-700',
  WR: 'bg-green-100 text-green-700',
  TE: 'bg-orange-100 text-orange-700',
  K: 'bg-purple-100 text-purple-700',
  DEF: 'bg-gray-200 text-gray-700',
};

function PositionBadge({ position }: { position: string }) {
  const colors = POS_COLORS[position] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block w-8 text-center text-xs font-semibold rounded px-1 py-0.5 ${colors}`}>
      {position}
    </span>
  );
}

interface PlayerRowProps {
  playerId: string;
  players: Record<string, any> | null;
  leagueId: string;
  value?: number;
  posRank?: number;
}

function PlayerRow({ playerId, players, leagueId, value, posRank }: PlayerRowProps) {
  const info = getPlayerInfo(players, playerId);
  return (
    <tr className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
      <td className="px-4 py-2">
        <PositionBadge position={info.position} />
      </td>
      <td className="px-4 py-2">
        <Link
          to={`/league/${leagueId}/player/${playerId}`}
          className="text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
        >
          {info.name}
        </Link>
      </td>
      <td className="px-4 py-2 text-gray-500 dark:text-gray-400 text-sm">{info.team || 'FA'}</td>
      <td className="px-4 py-2 text-gray-500 dark:text-gray-400 text-sm text-right">
        {info.age ?? '—'}
      </td>
      <td className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
        {value !== undefined && value > 0 ? formatVal(value) : '—'}
      </td>
      <td className="px-4 py-2 text-right text-sm text-gray-500 dark:text-gray-400">
        {posRank !== undefined && posRank > 0 ? `${info.position}${posRank}` : '—'}
      </td>
    </tr>
  );
}

function getUserName(roster: SleeperRoster, users: SleeperUser[]): string {
  const user = users.find((u) => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${roster.roster_id}`;
}

function getUserNameById(rosterId: number, rosters: SleeperRoster[], users: SleeperUser[]): string {
  const roster = rosters.find(r => r.roster_id === rosterId);
  if (!roster) return `Team ${rosterId}`;
  const user = users.find(u => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${rosterId}`;
}

export default function TeamDetail() {
  const { rosterId } = useParams<{ rosterId: string }>();
  const { data, leagueId } = useLeagueLayout();
  const { players, status: playersStatus } = usePlayers();
  const { values, status: valuesStatus } = usePlayerValues(data.leagueType);
  const [teamPicks, setTeamPicks] = useState<PickOwnership[]>([]);

  const { league, rosters, users } = data;

  // Fetch draft pick data
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

        const allPicks = buildPickOwnership(rosters, traded, seasons, maxRounds, currentSeason, draftOrder, draftPicksBySeason, preDraftOrders, league.total_rosters);
        if (!cancelled) setTeamPicks(allPicks);
      } catch {
        // Non-critical
      }
    }

    loadPicks();
    return () => { cancelled = true; };
  }, [leagueId, rosters, league]);

  // Apply rookie values to current-season picks
  const enrichedPicks = useMemo(() => {
    if (teamPicks.length === 0 || !players || !values) return teamPicks;
    const rookieMap = buildRookiePickValueMap(buildRookieRankings(players, values));
    if (rookieMap.size === 0) return teamPicks;
    return applyRookieValues(teamPicks, league.season, league.total_rosters, rookieMap);
  }, [teamPicks, players, values, league.season, league.total_rosters]);

  if (playersStatus === 'loading') {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-gray-500 dark:text-gray-400">Loading team data...</p>
      </div>
    );
  }

  const roster = rosters.find((r) => String(r.roster_id) === rosterId);

  if (!roster) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <p className="text-red-600 dark:text-red-400">Roster not found</p>
        <Link to={`/league/${leagueId}`} className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
          Back to league
        </Link>
      </div>
    );
  }

  const teamName = getUserName(roster, users);
  const starters = roster.starters || [];
  const allPlayers = roster.players || [];
  const reserve = roster.reserve || [];
  const taxi = roster.taxi || [];

  // Bench = all players minus starters, reserve, taxi
  const starterSet = new Set(starters);
  const reserveSet = new Set(reserve);
  const taxiSet = new Set(taxi);
  const bench = allPlayers.filter(
    (id) => !starterSet.has(id) && !reserveSet.has(id) && !taxiSet.has(id),
  );

  const wins = roster.settings?.wins ?? 0;
  const losses = roster.settings?.losses ?? 0;
  const ties = roster.settings?.ties ?? 0;
  const fpts = roster.settings?.fpts ?? 0;
  const fptsDecimal = roster.settings?.fpts_decimal ?? 0;

  // Sort players by position priority within each section
  const posOrder = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  function sortByPosition(ids: string[]) {
    return [...ids].sort((a, b) => {
      const posA = getPlayerInfo(players, a).position;
      const posB = getPlayerInfo(players, b).position;
      return (posOrder.indexOf(posA) === -1 ? 99 : posOrder.indexOf(posA)) -
        (posOrder.indexOf(posB) === -1 ? 99 : posOrder.indexOf(posB));
    });
  }

  // Compute league-wide positional rankings for value & rank columns
  const playerValueMap = new Map<string, number>();
  const playerPosRankMap = new Map<string, number>();

  if (valuesStatus === 'ready' && values && players) {
    // Build league-wide positional lists
    const leaguePosList: Record<string, { id: string; value: number }[]> = {};
    for (const r of rosters) {
      for (const pid of r.players || []) {
        const pos = players[pid]?.position as string;
        if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
        const val = getPlayerValue(values, pid);
        if (!leaguePosList[pos]) leaguePosList[pos] = [];
        leaguePosList[pos].push({ id: pid, value: val });
      }
    }
    for (const pos of Object.keys(leaguePosList)) {
      leaguePosList[pos].sort((a, b) => b.value - a.value);
      leaguePosList[pos].forEach((p, idx) => {
        playerPosRankMap.set(p.id, idx + 1);
      });
    }
    // Also set values for all players on this roster (including K, DEF)
    for (const pid of allPlayers) {
      playerValueMap.set(pid, getPlayerValue(values, pid));
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-8 py-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{teamName}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {wins}-{losses}{ties > 0 ? `-${ties}` : ''} &middot;{' '}
          {fpts}.{String(fptsDecimal).padStart(2, '0')} PF &middot;{' '}
          {allPlayers.length} players
        </p>
      </div>
        {/* Roster Analysis */}
        {valuesStatus === 'ready' && values && players && roster && (
          <RosterAnalysisCard
            roster={roster}
            allRosters={rosters}
            users={users}
            values={values}
            players={players}
            rosterPositions={league.roster_positions}
            leagueId={leagueId!}
          />
        )}

        {/* Starters */}
        <RosterSection
          title="Starters"
          playerIds={starters}
          players={players}
          leagueId={leagueId!}
          valueMap={playerValueMap}
          posRankMap={playerPosRankMap}
        />

        {/* Bench */}
        {bench.length > 0 && (
          <RosterSection
            title="Bench"
            playerIds={sortByPosition(bench)}
            players={players}
            leagueId={leagueId!}
            valueMap={playerValueMap}
            posRankMap={playerPosRankMap}
          />
        )}

        {/* Taxi */}
        {taxi.length > 0 && (
          <RosterSection
            title="Taxi Squad"
            playerIds={sortByPosition(taxi)}
            players={players}
            leagueId={leagueId!}
            valueMap={playerValueMap}
            posRankMap={playerPosRankMap}
          />
        )}

        {/* IR */}
        {reserve.length > 0 && (
          <RosterSection
            title="IR"
            playerIds={sortByPosition(reserve)}
            players={players}
            leagueId={leagueId!}
            valueMap={playerValueMap}
            posRankMap={playerPosRankMap}
          />
        )}

        {/* Draft Picks */}
        {enrichedPicks.length > 0 && (
          <DraftPicksSection
            picks={enrichedPicks.filter(p => p.currentOwner === roster.roster_id)}
            rosters={rosters}
            users={users}
          />
        )}
    </main>
  );
}

const GRADE_COLORS: Record<DepthGrade, string> = {
  Strong: 'bg-green-100 text-green-700',
  Adequate: 'bg-blue-100 text-blue-700',
  Weak: 'bg-red-100 text-red-700',
};

const POS_BAR_COLORS: Record<string, string> = {
  QB: 'bg-red-400',
  RB: 'bg-blue-400',
  WR: 'bg-green-400',
  TE: 'bg-orange-400',
};

function formatVal(val: number): string {
  return Math.round(val).toLocaleString();
}

const TIER_COLORS: Record<CompetitiveTier, string> = {
  'Strong Contender': 'bg-green-100 text-green-700',
  'Contender': 'bg-blue-100 text-blue-700',
  'Fringe Playoff': 'bg-yellow-100 text-yellow-700',
  'Rebuilder': 'bg-red-100 text-red-700',
};

const REC_COLORS: Record<Recommendation, string> = {
  'Strong Hold': 'text-green-700 dark:text-green-400',
  'Hold': 'text-blue-700 dark:text-blue-400',
  'Trade': 'text-yellow-700 dark:text-yellow-400',
  'Sell': 'text-red-700 dark:text-red-400',
};

function RosterAnalysisCard({
  roster,
  allRosters,
  users,
  values,
  players,
  rosterPositions,
  leagueId,
}: {
  roster: SleeperRoster;
  allRosters: SleeperRoster[];
  users: SleeperUser[];
  values: import('../api/values').ValuesResponse;
  players: Record<string, any>;
  rosterPositions: string[];
  leagueId: string;
}) {
  const analysis = analyseRoster(roster, allRosters, values, players, rosterPositions);

  // Compute tier for this roster
  const rankings = computePowerRankings(allRosters, values, players, rosterPositions);
  const thisRanking: RosterRanking | undefined = rankings.find(r => r.rosterId === roster.roster_id);
  const tier = thisRanking?.tier;

  // Tier-aware insights
  const tierInsights = buildTierInsights(tier, analysis, roster, allRosters, values, players, rosterPositions, leagueId);

  // Trade targets
  const tradeTargetResult = useMemo(() => {
    if (rankings.length === 0) return null;
    return findTradeTargets(roster.roster_id, allRosters, users, rankings, values, players, rosterPositions);
  }, [roster.roster_id, allRosters, users, rankings, values, players, rosterPositions]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Roster Construction</h2>
          {tier && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_COLORS[tier]}`}>
              {tier}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${GRADE_COLORS[analysis.overallStarterGrade]}`}>
            Starters: {analysis.overallStarterGrade}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium opacity-70 ${GRADE_COLORS[analysis.overallGrade]}`}>
            Depth: {analysis.overallGrade}
          </span>
        </div>
      </div>

      {/* Starter / Bench split */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <div>
          <span className="text-gray-400 dark:text-gray-500 text-xs">Starters</span>
          <p className="font-semibold text-gray-900 dark:text-gray-100">{formatVal(analysis.starterValue)}</p>
        </div>
        <div>
          <span className="text-gray-400 dark:text-gray-500 text-xs">Bench</span>
          <p className="font-semibold text-gray-900 dark:text-gray-100">{formatVal(analysis.benchValue)}</p>
        </div>
        <div>
          <span className="text-gray-400 dark:text-gray-500 text-xs">Bench %</span>
          <p className="font-semibold text-gray-900 dark:text-gray-100">{analysis.benchPct}%</p>
        </div>
      </div>

      {/* Positional grades: starter + depth */}
      <div className="space-y-3 mb-4">
        {analysis.positionalGrades.map((pg) => {
          const maxVal = Math.max(...analysis.positionalGrades.map(g => Math.max(g.totalValue, g.starterValue)), 1);
          const starterPct = (pg.starterValue / maxVal) * 100;
          const totalPct = (pg.totalValue / maxVal) * 100;
          return (
            <div key={pg.position} className="space-y-0.5">
              {/* Starter grade row — prominent */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 w-6">{pg.position}</span>
                <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${POS_BAR_COLORS[pg.position] || 'bg-gray-400 dark:bg-gray-500'}`}
                    style={{ width: `${Math.max(starterPct, 4)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 w-12 text-right">{formatVal(pg.starterValue)}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${GRADE_COLORS[pg.starterGrade]}`}>
                  {pg.starterGrade}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 w-10 text-right">Start</span>
              </div>
              {/* Depth grade row — subdued */}
              <div className="flex items-center gap-3">
                <span className="w-6" />
                <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full opacity-40 ${POS_BAR_COLORS[pg.position] || 'bg-gray-400 dark:bg-gray-500'}`}
                    style={{ width: `${Math.max(totalPct, 4)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500 w-12 text-right">{formatVal(pg.totalValue)}</span>
                <span className={`text-xs px-1 py-0.5 rounded font-medium opacity-60 ${GRADE_COLORS[pg.depthGrade]}`}>
                  {pg.depthGrade}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 w-10 text-right">Depth</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tier-aware insights */}
      {tierInsights.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3 mb-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wide font-medium">
            {tier === 'Rebuilder' ? 'Sell Targets' : tier === 'Strong Contender' || tier === 'Contender' ? 'Contender Needs' : 'Key Insights'}
          </p>
          <div className="space-y-2">
            {tierInsights.map((insight, i) => (
              <div key={i} className="text-sm">
                {insight.type === 'need' && (
                  <div className="flex items-start gap-2 text-gray-600 dark:text-gray-300">
                    <span className="text-blue-500 dark:text-blue-400 mt-0.5">◆</span>
                    <span>{insight.message}</span>
                  </div>
                )}
                {insight.type === 'sell-target' && (
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${REC_COLORS[insight.recommendation!]}`}>
                      {insight.recommendation}
                    </span>
                    <Link
                      to={`/league/${leagueId}/player/${insight.playerId}`}
                      className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      {insight.playerName}
                    </Link>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{insight.position}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{formatVal(insight.value!)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trade Targets */}
      {tradeTargetResult && tradeTargetResult.recommendations.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium">
              Trade Targets
            </p>
            <Link to={`/league/${leagueId}/trades?tab=targets&team=${roster.roster_id}`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              View all in Trade Tools →
            </Link>
          </div>
          <div className="space-y-2">
            {tradeTargetResult.recommendations.slice(0, 3).map((rec, i) => (
              <CompactTradeTargetCard key={i} rec={rec} leagueId={leagueId} />
            ))}
          </div>
        </div>
      )}

      {/* Rebuilder Pick Suggestions */}
      {tradeTargetResult && tradeTargetResult.rebuilderPickSuggestions.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3 mb-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium mb-2">
            Sell for Picks
          </p>
          <div className="space-y-1">
            {tradeTargetResult.rebuilderPickSuggestions.slice(0, 3).map((s, i) => (
              <div key={i} className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-2">
                <span className="text-purple-500 mt-0.5">◆</span>
                <span>
                  <Link to={`/league/${leagueId}/player/${s.sellPlayer.id}`} className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">
                    {s.sellPlayer.name}
                  </Link>
                  {' '}→ {s.targetPickDescription} (est. {formatVal(s.estimatedPickValue)})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Efficiency flags */}
      {analysis.efficiencyFlags.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wide font-medium">Insights</p>
          <ul className="space-y-1">
            {analysis.efficiencyFlags.map((flag, i) => (
              <li key={i} className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-2">
                <span className="text-yellow-500 mt-0.5">▸</span>
                <span>{flag}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CompactTradeTargetCard({ rec, leagueId }: { rec: TradeRecommendation; leagueId: string }) {
  const [expanded, setExpanded] = useState(false);
  const targetPosGradeBefore = rec.beforeGrades.find(g => g.position === rec.targetPlayer.position);
  const targetPosGradeAfter = rec.afterGrades.find(g => g.position === rec.targetPlayer.position);

  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 ${POS_COLORS[rec.targetPlayer.position] || 'bg-gray-100'}`}>
          {rec.targetPlayer.position}
        </span>
        <Link to={`/league/${leagueId}/player/${rec.targetPlayer.id}`} className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">
          {rec.targetPlayer.name}
        </Link>
        <span className="text-xs text-gray-400 dark:text-gray-500">{formatVal(rec.targetPlayer.value)}</span>
        <span className={`text-xs rounded px-1.5 py-0.5 ml-auto ${
          rec.acceptabilityScore > 500 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
          rec.acceptabilityScore > 0 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' :
          'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
        }`}>
          {rec.acceptabilityScore > 500 ? 'Likely' : rec.acceptabilityScore > 0 ? 'Possible' : 'Unlikely'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
        <span>Give: {rec.giveAssets.map(a => a.name).join(' + ')} ({formatVal(rec.giveTotal)})</span>
      </div>
      {targetPosGradeBefore && targetPosGradeAfter && (
        <div className="flex items-center gap-1 text-xs mb-1">
          <span className="text-gray-500 dark:text-gray-400">{rec.targetPlayer.position} starters:</span>
          <span className={`rounded px-1 py-0.5 ${GRADE_COLORS[targetPosGradeBefore.starterGrade]}`}>{targetPosGradeBefore.starterGrade}</span>
          {targetPosGradeBefore.starterGrade !== targetPosGradeAfter.starterGrade && (
            <>
              <span className="text-gray-400">→</span>
              <span className={`rounded px-1 py-0.5 ${GRADE_COLORS[targetPosGradeAfter.starterGrade]}`}>{targetPosGradeAfter.starterGrade}</span>
            </>
          )}
          <span className="text-gray-400 dark:text-gray-500">
            ({formatVal(targetPosGradeBefore.starterValue)} → {formatVal(targetPosGradeAfter.starterValue)})
          </span>
        </div>
      )}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
      >
        {expanded ? 'Hide details' : 'Show details'}
      </button>
      {expanded && (
        <div className="mt-2 bg-gray-50 dark:bg-gray-900 rounded p-2">
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">{rec.explanation}</p>
          {rec.acceptabilityReasons.length > 0 && (
            <div className={`text-xs rounded px-2 py-1.5 mb-2 space-y-0.5 ${
              rec.acceptabilityScore > 500 ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
              rec.acceptabilityScore > 0 ? 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
              'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400'
            }`}>
              {rec.acceptabilityReasons.slice(0, 3).map((reason, i) => (
                <p key={i}>• {reason}</p>
              ))}
            </div>
          )}
          <div className="grid grid-cols-4 gap-1 text-center">
            {rec.beforeGrades.map((bg, idx) => {
              const ag = rec.afterGrades[idx];
              const starterChanged = bg.starterGrade !== ag.starterGrade;
              const depthChanged = bg.depthGrade !== ag.depthGrade;
              return (
                <div key={bg.position} className={`rounded p-1 ${bg.position === rec.targetPlayer.position ? 'ring-1 ring-blue-400' : ''}`}>
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">{bg.position}</p>
                  <div className="flex items-center justify-center gap-0.5">
                    <span className={`text-xs rounded px-1 py-0.5 ${GRADE_COLORS[bg.starterGrade]}`}>{bg.starterGrade[0]}</span>
                    {starterChanged && (
                      <>
                        <span className="text-xs text-gray-400">→</span>
                        <span className={`text-xs rounded px-1 py-0.5 ${GRADE_COLORS[ag.starterGrade]}`}>{ag.starterGrade[0]}</span>
                      </>
                    )}
                  </div>
                  {depthChanged && depthChanged !== starterChanged && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{bg.depthGrade[0]}→{ag.depthGrade[0]}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface TierInsight {
  type: 'need' | 'sell-target';
  message: string;
  playerId?: string;
  playerName?: string;
  position?: string;
  value?: number;
  recommendation?: Recommendation;
}

function buildTierInsights(
  tier: CompetitiveTier | undefined,
  analysis: import('../utils/rosterConstruction').RosterAnalysis,
  roster: SleeperRoster,
  allRosters: SleeperRoster[],
  values: import('../api/values').ValuesResponse,
  players: Record<string, any>,
  _rosterPositions: string[],
  _leagueId: string,
): TierInsight[] {
  if (!tier) return [];
  const insights: TierInsight[] = [];

  if (tier === 'Strong Contender' || tier === 'Contender') {
    // Identify weakest starting lineup positions
    const weakPositions = analysis.positionalGrades
      .filter(g => g.starterGrade === 'Weak')
      .sort((a, b) => a.starterValue - b.starterValue);

    if (weakPositions.length > 0) {
      for (const wp of weakPositions) {
        insights.push({
          type: 'need',
          message: `${wp.position} starters are your weakest position (${formatVal(wp.starterValue)}, graded Weak) — prioritise acquiring a ${wp.position} to strengthen your contending roster.`,
        });
      }
    } else {
      // Even if no "Weak" starter grades, highlight the lowest-graded position
      const sorted = [...analysis.positionalGrades].sort((a, b) => a.starterValue - b.starterValue);
      if (sorted.length > 0 && sorted[0].starterGrade === 'Adequate') {
        insights.push({
          type: 'need',
          message: `${sorted[0].position} starters are your thinnest position (${formatVal(sorted[0].starterValue)}) — an upgrade here could put you over the top.`,
        });
      }
    }
  } else if (tier === 'Rebuilder') {
    // Find highest-value players with Trade or Sell recommendations
    const rosterPlayers = roster.players || [];
    const sellTargets: TierInsight[] = [];

    // Get all players in the roster sorted by value
    const positionGroups: Record<string, { id: string; value: number }[]> = {};
    for (const pid of rosterPlayers) {
      const info = getPlayerInfo(players, pid);
      if (!['QB', 'RB', 'WR', 'TE'].includes(info.position)) continue;
      if (!positionGroups[info.position]) positionGroups[info.position] = [];
      positionGroups[info.position].push({ id: pid, value: getPlayerValue(values, pid) });
    }
    for (const pos of Object.keys(positionGroups)) {
      positionGroups[pos].sort((a, b) => b.value - a.value);
    }

    // Compute league-wide positional rankings
    const leaguePosPlayers: Record<string, { id: string; value: number }[]> = {};
    for (const r of allRosters) {
      for (const pid of r.players || []) {
        const pos = players[pid]?.position;
        if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
        if (!leaguePosPlayers[pos]) leaguePosPlayers[pos] = [];
        leaguePosPlayers[pos].push({ id: pid, value: getPlayerValue(values, pid) });
      }
    }
    for (const pos of Object.keys(leaguePosPlayers)) {
      leaguePosPlayers[pos].sort((a, b) => b.value - a.value);
    }

    for (const pid of rosterPlayers) {
      const info = getPlayerInfo(players, pid);
      if (!['QB', 'RB', 'WR', 'TE'].includes(info.position)) continue;
      const val = getPlayerValue(values, pid);
      if (val < 500) continue; // skip low-value players

      const breakdown = getPlayerValueBreakdown(values, pid);
      const posGroup = positionGroups[info.position] || [];
      const posRank = posGroup.findIndex(p => p.id === pid) + 1;
      const leaguePosRank = leaguePosPlayers[info.position]?.findIndex(p => p.id === pid) + 1 || null;

      // Determine roster slot
      const starterSet = new Set(roster.starters || []);
      const taxiSet = new Set(roster.taxi || []);
      const reserveSet = new Set(roster.reserve || []);
      const rosterSlot = starterSet.has(pid) ? 'Starter' as const
        : taxiSet.has(pid) ? 'Taxi' as const
        : reserveSet.has(pid) ? 'IR' as const
        : 'Bench' as const;

      const rec = computeRecommendation({
        position: info.position,
        age: info.age,
        yearsExp: players[pid]?.years_exp,
        teamTier: tier,
        rosterSlot,
        avgValue: breakdown.average,
        ktcValue: breakdown.ktc,
        fantasycalcValue: breakdown.fantasycalc,
        dynastyprocessValue: breakdown.dynastyprocess,
        posDepthRank: posRank,
        posDepthCount: posGroup.length,
        leaguePosRank,
        leagueTeamCount: allRosters.length,
      });

      if (rec.action === 'Trade' || rec.action === 'Sell') {
        sellTargets.push({
          type: 'sell-target',
          message: '',
          playerId: pid,
          playerName: info.name,
          position: info.position,
          value: Math.round(val),
          recommendation: rec.action,
        });
      }
    }

    // Sort by value descending, show top 5
    sellTargets.sort((a, b) => (b.value || 0) - (a.value || 0));
    insights.push(...sellTargets.slice(0, 5));

    if (sellTargets.length === 0) {
      insights.push({
        type: 'need',
        message: 'No immediate sell targets identified — focus on accumulating draft picks and young players.',
      });
    }
  } else if (tier === 'Fringe Playoff') {
    // For fringe teams, highlight weakest starting position
    const weakest = [...analysis.positionalGrades].sort((a, b) => a.starterValue - b.starterValue)[0];
    if (weakest) {
      insights.push({
        type: 'need',
        message: `${weakest.position} starters are your weakest group (${formatVal(weakest.starterValue)}) — strengthening here could push you into contention.`,
      });
    }
  }

  return insights;
}

function RosterSection({
  title,
  playerIds,
  players,
  leagueId,
  valueMap,
  posRankMap,
}: {
  title: string;
  playerIds: string[];
  players: Record<string, any> | null;
  leagueId: string;
  valueMap: Map<string, number>;
  posRankMap: Map<string, number>;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
        {title} ({playerIds.length})
      </h2>
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-300">
              <th className="px-4 py-2 font-medium w-12">Pos</th>
              <th className="px-4 py-2 font-medium">Player</th>
              <th className="px-4 py-2 font-medium">Team</th>
              <th className="px-4 py-2 font-medium text-right">Age</th>
              <th className="px-4 py-2 font-medium text-right">Value</th>
              <th className="px-4 py-2 font-medium text-right">Rank</th>
            </tr>
          </thead>
          <tbody>
            {playerIds.map((id) => (
              <PlayerRow
                key={id}
                playerId={id}
                players={players}
                leagueId={leagueId}
                value={valueMap.get(id)}
                posRank={posRankMap.get(id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DraftPicksSection({
  picks,
  rosters,
  users,
}: {
  picks: PickOwnership[];
  rosters: SleeperRoster[];
  users: SleeperUser[];
}) {
  const totalValue = picks.reduce((s, p) => s + p.estimatedValue, 0);

  // Group by season
  const seasons = [...new Set(picks.map(p => p.season))].sort();

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
        Draft Picks ({picks.length})
        <span className="ml-2 text-gray-400 dark:text-gray-500 font-normal normal-case">
          Total value: {formatVal(totalValue)}
        </span>
      </h2>
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {seasons.map(season => {
            const seasonPicks = picks
              .filter(p => p.season === season)
              .sort((a, b) => a.round - b.round || a.pickInRound - b.pickInRound);
            return (
              <div key={season}>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{season}</h4>
                {seasonPicks.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">No picks</p>
                ) : (
                  <div className="space-y-1">
                    {seasonPicks.map((pick, i) => {
                      const isAcquired = pick.originalOwner !== pick.currentOwner;
                      const fromName = isAcquired ? getUserNameById(pick.originalOwner, rosters, users) : null;
                      return (
                        <div key={i} className={`text-sm px-2 py-1.5 rounded flex items-center gap-2 ${isAcquired ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                          <span className="font-mono font-medium w-16">{pick.pickLabel}</span>
                          {fromName && <span className="text-xs text-blue-500 dark:text-blue-400">via {fromName}</span>}
                          <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{formatVal(pick.estimatedValue)}</span>
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
    </div>
  );
}
