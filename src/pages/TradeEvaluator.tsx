import { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLeagueLayout } from '../components/LeagueLayout';
import { usePlayers, getPlayerInfo } from '../hooks/usePlayers';
import { usePlayerValues, getPlayerValue } from '../hooks/usePlayerValues';
import { computePowerRankings } from '../utils/powerRankings';
import { evaluateTrade } from '../utils/tradeEvaluator';
import { fetchTradedPicks, fetchDrafts, fetchDraftPicks } from '../api/sleeper';
import { buildDraftOrder, getDraftSlotOrder, buildPickOwnership, buildRookiePickValueMap, applyRookieValues } from '../utils/draftPicks';
import type { PickOwnership } from '../utils/draftPicks';
import { buildRookieRankings } from '../utils/rookieDraft';
import type { TradeEvaluation, FairnessGrade } from '../utils/tradeEvaluator';
import type { SleeperRoster, SleeperUser, SleeperDraft, SleeperDraftPick, CompetitiveTier } from '../types';
import { useTheme } from '../hooks/useTheme';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-100 text-red-700',
  RB: 'bg-blue-100 text-blue-700',
  WR: 'bg-green-100 text-green-700',
  TE: 'bg-orange-100 text-orange-700',
};

const FAIRNESS_COLORS: Record<FairnessGrade, string> = {
  'Even': 'bg-green-100 text-green-700',
  'Slight Edge': 'bg-yellow-100 text-yellow-700',
  'Uneven': 'bg-orange-100 text-orange-700',
  'Lopsided': 'bg-red-100 text-red-700',
};

function formatValue(val: number): string {
  return Math.round(val).toLocaleString();
}

function getUserName(roster: SleeperRoster, users: SleeperUser[]): string {
  const user = users.find(u => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${roster.roster_id}`;
}

// --- Player Search Component (shows full roster on focus, filters on type) ---

interface PlayerSearchProps {
  rosterPlayerIds: string[];
  players: Record<string, any>;
  values: any;
  excludeIds: Set<string>;
  onSelect: (playerId: string) => void;
}

function PlayerSearch({ rosterPlayerIds, players, values, excludeIds, onSelect }: PlayerSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    const matches: { id: string; name: string; position: string; team: string | null; value: number }[] = [];

    for (const id of rosterPlayerIds) {
      if (excludeIds.has(id)) continue;
      const p = players[id];
      if (!p) continue;
      const pos = p.position as string;
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      const name = p.full_name || `${p.first_name} ${p.last_name}`;
      if (q.length > 0 && !name.toLowerCase().includes(q)) continue;
      const val = getPlayerValue(values, id);
      matches.push({ id, name, position: pos, team: p.team, value: val });
    }

    matches.sort((a, b) => b.value - a.value);
    return matches;
  }, [rosterPlayerIds, players, values, query, excludeIds]);

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        placeholder="Search or browse roster..."
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 dark:text-gray-100"
      />
      {open && results.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.id}
              onClick={() => { onSelect(p.id); setQuery(''); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 text-sm"
            >
              <span className={`inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 ${POS_COLORS[p.position] || 'bg-gray-100 text-gray-600'}`}>
                {p.position}
              </span>
              <span className="text-gray-900 dark:text-gray-100">{p.name}</span>
              <span className="text-gray-400 dark:text-gray-500 text-xs">{p.team || 'FA'}</span>
              <span className="ml-auto text-gray-500 dark:text-gray-400 text-xs font-medium">{formatValue(p.value)}</span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">No matching players</p>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

export default function TradeEvaluator() {
  const { data, leagueId } = useLeagueLayout();
  const { players, status: playersStatus } = usePlayers();
  const { values, status: valuesStatus } = usePlayerValues(data.leagueType);

  const [sideATeam, setSideATeam] = useState<number | null>(null);
  const [sideBTeam, setSideBTeam] = useState<number | null>(null);
  const [sideAPlayers, setSideAPlayers] = useState<string[]>([]);
  const [sideBPlayers, setSideBPlayers] = useState<string[]>([]);
  const [sideAPicks, setSideAPicks] = useState<PickOwnership[]>([]);
  const [sideBPicks, setSideBPicks] = useState<PickOwnership[]>([]);
  const [allPicks, setAllPicks] = useState<PickOwnership[]>([]);

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

        const picks = buildPickOwnership(rosters, traded, seasons, maxRounds, currentSeason, draftOrder, draftPicksBySeason, preDraftOrders, league.total_rosters);
        if (!cancelled) setAllPicks(picks);
      } catch {
        // Non-critical
      }
    }

    loadPicks();
    return () => { cancelled = true; };
  }, [leagueId, rosters, league]);

  // Apply rookie values to current-season picks
  const enrichedPicks = useMemo(() => {
    if (allPicks.length === 0 || !players || !values) return allPicks;
    const rookieMap = buildRookiePickValueMap(buildRookieRankings(players, values));
    if (rookieMap.size === 0) return allPicks;
    return applyRookieValues(allPicks, league.season, league.total_rosters, rookieMap);
  }, [allPicks, players, values, league.season, league.total_rosters]);

  const rankings = useMemo(() => {
    if (valuesStatus !== 'ready' || !values || !players) return [];
    return computePowerRankings(rosters, values, players, league.roster_positions);
  }, [rosters, values, players, league.roster_positions, valuesStatus]);

  const tierMap = useMemo(() => {
    const m = new Map<number, CompetitiveTier>();
    for (const r of rankings) m.set(r.rosterId, r.tier);
    return m;
  }, [rankings]);

  const allSelectedIds = useMemo(() => new Set([...sideAPlayers, ...sideBPlayers]), [sideAPlayers, sideBPlayers]);

  // Build a unique key for selected picks to track which are used
  const selectedPickKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const p of sideAPicks) keys.add(`${p.season}-${p.round}-${p.originalOwner}`);
    for (const p of sideBPicks) keys.add(`${p.season}-${p.round}-${p.originalOwner}`);
    return keys;
  }, [sideAPicks, sideBPicks]);

  const evaluation: TradeEvaluation | null = useMemo(() => {
    if (!values || !players) return null;
    if (sideATeam === null || sideBTeam === null) return null;
    if (sideAPlayers.length === 0 && sideBPlayers.length === 0 && sideAPicks.length === 0 && sideBPicks.length === 0) return null;

    // sideAPlayers/sideAPicks = what Team A gives = what Team B receives
    return evaluateTrade(
      sideBPlayers, sideBPicks,
      sideAPlayers, sideAPicks,
      sideATeam, sideBTeam,
      values, players, rosters, users,
      tierMap, league.total_rosters,
    );
  }, [sideAPlayers, sideBPlayers, sideAPicks, sideBPicks, sideATeam, sideBTeam, values, players, rosters, users, tierMap, league.total_rosters]);

  // Compute balance suggestions: players or picks the winning side could add to make it fairer
  type BalanceSuggestion = {
    type: 'player';
    id: string;
    name: string;
    position: string;
    value: number;
    closeness: number;
  } | {
    type: 'pick';
    pick: PickOwnership;
    name: string;
    value: number;
    closeness: number;
  };

  const balanceSuggestions = useMemo((): BalanceSuggestion[] => {
    if (!evaluation || !values || !players) return [];
    if (evaluation.winner === null) return []; // already even

    const winnerSide = evaluation.sides.find(s => s.rosterId === evaluation.winner)!;
    const loserSide = evaluation.sides.find(s => s.rosterId !== evaluation.winner)!;
    const gap = winnerSide.totalValue - loserSide.totalValue;

    // The winner receives more value — to balance, the winner's team should give more.
    const winnerRosterId = winnerSide.rosterId;
    const winnerRoster = rosters.find(r => r.roster_id === winnerRosterId);
    if (!winnerRoster) return [];

    const candidates: BalanceSuggestion[] = [];
    const excludeSet = new Set([...sideAPlayers, ...sideBPlayers]);

    // Player candidates
    for (const pid of winnerRoster.players || []) {
      if (excludeSet.has(pid)) continue;
      const p = players[pid];
      if (!p) continue;
      const pos = p.position as string;
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      const val = getPlayerValue(values, pid);
      if (val <= 0) continue;
      const newGap = Math.abs(gap - val);
      if (newGap < gap) {
        candidates.push({
          type: 'player',
          id: pid,
          name: p.full_name || `${p.first_name} ${p.last_name}`,
          position: pos,
          value: Math.round(val),
          closeness: newGap,
        });
      }
    }

    // Pick candidates — picks owned by the winner that aren't already in the trade
    const winnerPicks = enrichedPicks.filter(p => p.currentOwner === winnerRosterId);
    for (const pick of winnerPicks) {
      const key = `${pick.season}-${pick.round}-${pick.originalOwner}`;
      if (selectedPickKeys.has(key)) continue;
      const val = pick.estimatedValue;
      if (val <= 0) continue;
      const newGap = Math.abs(gap - val);
      if (newGap < gap) {
        candidates.push({
          type: 'pick',
          pick,
          name: `${pick.season} ${pick.pickLabel}`,
          value: Math.round(val),
          closeness: newGap,
        });
      }
    }

    candidates.sort((a, b) => a.closeness - b.closeness);
    return candidates.slice(0, 5);
  }, [evaluation, values, players, rosters, sideAPlayers, sideBPlayers, enrichedPicks, selectedPickKeys]);

  const dataReady = valuesStatus === 'ready' && playersStatus === 'ready' && values && players;

  const sortedRosters = useMemo(() => {
    return [...rosters].sort((a, b) => {
      const nameA = getUserName(a, users);
      const nameB = getUserName(b, users);
      return nameA.localeCompare(nameB);
    });
  }, [rosters, users]);

  function handleClear() {
    setSideAPlayers([]);
    setSideBPlayers([]);
    setSideAPicks([]);
    setSideBPicks([]);
  }

  function handleAddBalanceSuggestion(suggestion: typeof balanceSuggestions[number]) {
    if (!evaluation) return;
    const isWinnerSideA = sideATeam === evaluation.winner;
    if (suggestion.type === 'player') {
      if (isWinnerSideA) {
        setSideAPlayers(prev => [...prev, suggestion.id]);
      } else {
        setSideBPlayers(prev => [...prev, suggestion.id]);
      }
    } else {
      if (isWinnerSideA) {
        setSideAPicks(prev => [...prev, suggestion.pick]);
      } else {
        setSideBPicks(prev => [...prev, suggestion.pick]);
      }
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-8 py-6">
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Trade Evaluator</h2>
          <Link
            to={`/league/${leagueId}/trades`}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            &larr; Back to Trade Tools
          </Link>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Build a trade and see how it grades across all value sources.
        </p>
      </div>

      {!dataReady && (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading player values...</p>
      )}

      {dataReady && (
        <div className="space-y-6">
          {/* Team Selectors */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Team A</label>
              <select
                value={sideATeam ?? ''}
                onChange={e => { setSideATeam(e.target.value ? Number(e.target.value) : null); setSideAPlayers([]); setSideAPicks([]); }}
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">Select team...</option>
                {sortedRosters.map(r => (
                  <option key={r.roster_id} value={r.roster_id} disabled={r.roster_id === sideBTeam}>
                    {getUserName(r, users)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Team B</label>
              <select
                value={sideBTeam ?? ''}
                onChange={e => { setSideBTeam(e.target.value ? Number(e.target.value) : null); setSideBPlayers([]); setSideBPicks([]); }}
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">Select team...</option>
                {sortedRosters.map(r => (
                  <option key={r.roster_id} value={r.roster_id} disabled={r.roster_id === sideATeam}>
                    {getUserName(r, users)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Trade Builder */}
          {sideATeam !== null && sideBTeam !== null && (
            <div className="grid grid-cols-2 gap-6">
              <TradeSideBuilder
                label={`${getUserName(rosters.find(r => r.roster_id === sideATeam)!, users)} gives`}
                rosterPlayerIds={rosters.find(r => r.roster_id === sideATeam)?.players || []}
                selectedPlayers={sideAPlayers}
                onAdd={id => setSideAPlayers(prev => [...prev, id])}
                onRemove={id => setSideAPlayers(prev => prev.filter(p => p !== id))}
                allSelectedIds={allSelectedIds}
                players={players}
                values={values}
                leagueId={leagueId}
                teamPicks={enrichedPicks.filter(p => p.currentOwner === sideATeam)}
                selectedPicks={sideAPicks}
                onAddPick={p => setSideAPicks(prev => [...prev, p])}
                onRemovePick={p => setSideAPicks(prev => prev.filter(x => !(x.season === p.season && x.round === p.round && x.originalOwner === p.originalOwner)))}
                selectedPickKeys={selectedPickKeys}
              />
              <TradeSideBuilder
                label={`${getUserName(rosters.find(r => r.roster_id === sideBTeam)!, users)} gives`}
                rosterPlayerIds={rosters.find(r => r.roster_id === sideBTeam)?.players || []}
                selectedPlayers={sideBPlayers}
                onAdd={id => setSideBPlayers(prev => [...prev, id])}
                onRemove={id => setSideBPlayers(prev => prev.filter(p => p !== id))}
                allSelectedIds={allSelectedIds}
                players={players}
                values={values}
                leagueId={leagueId}
                teamPicks={enrichedPicks.filter(p => p.currentOwner === sideBTeam)}
                selectedPicks={sideBPicks}
                onAddPick={p => setSideBPicks(prev => [...prev, p])}
                onRemovePick={p => setSideBPicks(prev => prev.filter(x => !(x.season === p.season && x.round === p.round && x.originalOwner === p.originalOwner)))}
                selectedPickKeys={selectedPickKeys}
              />
            </div>
          )}

          {/* Clear button */}
          {(sideAPlayers.length > 0 || sideBPlayers.length > 0 || sideAPicks.length > 0 || sideBPicks.length > 0) && (
            <div className="flex justify-center">
              <button
                onClick={handleClear}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                Clear trade
              </button>
            </div>
          )}

          {/* Evaluation Results */}
          {evaluation && <TradeResult evaluation={evaluation} leagueId={leagueId} />}

          {/* Balance Suggestions */}
          {evaluation && balanceSuggestions.length > 0 && (
            <BalanceSuggestions
              suggestions={balanceSuggestions}
              winnerTeamName={evaluation.sides.find(s => s.rosterId === evaluation.winner)?.teamName || ''}
              gap={evaluation.difference}
              onAdd={handleAddBalanceSuggestion}
              leagueId={leagueId}
            />
          )}
        </div>
      )}
    </main>
  );
}

// --- Trade Side Builder ---

interface TradeSideBuilderProps {
  label: string;
  rosterPlayerIds: string[];
  selectedPlayers: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  allSelectedIds: Set<string>;
  players: Record<string, any>;
  values: any;
  leagueId: string;
  teamPicks: PickOwnership[];
  selectedPicks: PickOwnership[];
  onAddPick: (pick: PickOwnership) => void;
  onRemovePick: (pick: PickOwnership) => void;
  selectedPickKeys: Set<string>;
}

function TradeSideBuilder({
  label, rosterPlayerIds, selectedPlayers, onAdd, onRemove,
  allSelectedIds, players, values, leagueId,
  teamPicks, selectedPicks, onAddPick, onRemovePick, selectedPickKeys,
}: TradeSideBuilderProps) {
  const playerTotal = selectedPlayers.reduce((s, id) => s + getPlayerValue(values, id), 0);
  const pickTotal = selectedPicks.reduce((s, p) => s + p.estimatedValue, 0);
  const totalValue = playerTotal + pickTotal;

  const [showPicks, setShowPicks] = useState(false);
  const pickRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) setShowPicks(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const availablePicks = teamPicks.filter(p => {
    const key = `${p.season}-${p.round}-${p.originalOwner}`;
    return !selectedPickKeys.has(key);
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{label}</h3>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{formatValue(totalValue)}</span>
      </div>

      {/* Selected players */}
      <div className="space-y-1 mb-3">
        {selectedPlayers.map(id => {
          const info = getPlayerInfo(players, id);
          const val = getPlayerValue(values, id);
          const posColor = POS_COLORS[info.position] || 'bg-gray-100 text-gray-600';
          return (
            <div key={id} className="flex items-center gap-2 py-1">
              <span className={`inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 ${posColor}`}>
                {info.position}
              </span>
              <Link
                to={`/league/${leagueId}/player/${id}`}
                className="text-sm text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 flex-1"
              >
                {info.name}
              </Link>
              <span className="text-xs text-gray-500 dark:text-gray-400">{formatValue(val)}</span>
              <button
                onClick={() => onRemove(id)}
                className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 text-xs ml-1"
                title="Remove"
              >
                &times;
              </button>
            </div>
          );
        })}

        {/* Selected picks */}
        {selectedPicks.map(pick => {
          const key = `${pick.season}-${pick.round}-${pick.originalOwner}`;
          return (
            <div key={key} className="flex items-center gap-2 py-1">
              <span className="inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 bg-purple-100 text-purple-700">
                PK
              </span>
              <span className="text-sm text-gray-900 dark:text-gray-100 flex-1">
                {pick.season} {pick.pickLabel}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{formatValue(pick.estimatedValue)}</span>
              <button
                onClick={() => onRemovePick(pick)}
                className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 text-xs ml-1"
                title="Remove"
              >
                &times;
              </button>
            </div>
          );
        })}

        {selectedPlayers.length === 0 && selectedPicks.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 py-2">No assets added yet</p>
        )}
      </div>

      {/* Search / browse roster */}
      <PlayerSearch
        rosterPlayerIds={rosterPlayerIds}
        players={players}
        values={values}
        excludeIds={allSelectedIds}
        onSelect={onAdd}
      />

      {/* Add draft pick */}
      {availablePicks.length > 0 && (
        <div ref={pickRef} className="relative mt-2">
          <button
            onClick={() => setShowPicks(!showPicks)}
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded px-3 py-2 text-left text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-400 transition-colors bg-white dark:bg-gray-800"
          >
            + Add draft pick...
          </button>
          {showPicks && (
            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {availablePicks.map(pick => {
                const key = `${pick.season}-${pick.round}-${pick.originalOwner}`;
                return (
                  <button
                    key={key}
                    onClick={() => { onAddPick(pick); setShowPicks(false); }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 text-sm"
                  >
                    <span className="inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 bg-purple-100 text-purple-700">
                      PK
                    </span>
                    <span className="text-gray-900 dark:text-gray-100">{pick.season} {pick.pickLabel}</span>
                    <span className="ml-auto text-gray-500 dark:text-gray-400 text-xs font-medium">{formatValue(pick.estimatedValue)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Balance Suggestions ---

type BalanceSuggestionItem = {
  type: 'player';
  id: string;
  name: string;
  position: string;
  value: number;
  closeness: number;
} | {
  type: 'pick';
  pick: PickOwnership;
  name: string;
  value: number;
  closeness: number;
};

function BalanceSuggestions({
  suggestions, winnerTeamName, gap, onAdd, leagueId,
}: {
  suggestions: BalanceSuggestionItem[];
  winnerTeamName: string;
  gap: number;
  onAdd: (suggestion: BalanceSuggestionItem) => void;
  leagueId: string;
}) {
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700 p-4">
      <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">Balance this trade</h4>
      <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
        {winnerTeamName} has a {formatValue(gap)} value edge. Add one of their assets to make it fairer:
      </p>
      <div className="space-y-1">
        {suggestions.map((s) => {
          const newGapLabel = s.closeness <= gap * 0.1
            ? 'Even'
            : `${formatValue(s.closeness)} gap remaining`;
          const key = s.type === 'player' ? s.id : `pick-${s.pick.season}-${s.pick.round}-${s.pick.originalOwner}`;

          if (s.type === 'player') {
            const posColor = POS_COLORS[s.position] || 'bg-gray-100 text-gray-600';
            return (
              <div key={key} className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => onAdd(s)}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs font-medium shrink-0"
                >
                  + Add
                </button>
                <span className={`inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 ${posColor}`}>
                  {s.position}
                </span>
                <Link
                  to={`/league/${leagueId}/player/${s.id}`}
                  className="text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {s.name}
                </Link>
                <span className="text-xs text-gray-500 dark:text-gray-400">{formatValue(s.value)}</span>
                <span className="text-xs text-amber-600 dark:text-amber-400 ml-auto">{newGapLabel}</span>
              </div>
            );
          }

          return (
            <div key={key} className="flex items-center gap-2 text-sm">
              <button
                onClick={() => onAdd(s)}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs font-medium shrink-0"
              >
                + Add
              </button>
              <span className="inline-block w-7 text-center text-xs font-semibold rounded px-1 py-0.5 bg-purple-100 text-purple-700">
                PK
              </span>
              <span className="text-gray-900 dark:text-gray-100">{s.name}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{formatValue(s.value)}</span>
              <span className="text-xs text-amber-600 dark:text-amber-400 ml-auto">{newGapLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Trade Result Display ---

function TradeResult({ evaluation, leagueId }: { evaluation: TradeEvaluation; leagueId: string }) {
  const { sides, difference, fairnessGrade, winner, explanation } = evaluation;
  const fairnessColor = FAIRNESS_COLORS[fairnessGrade];
  const { theme } = useTheme();

  const chartData = sides.map(side => ({
    name: side.teamName,
    value: side.totalValue,
    fill: winner === side.rosterId ? '#22c55e' : winner === null ? '#3b82f6' : '#9ca3af',
  }));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 space-y-4">
      {/* Fairness badge */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Trade Analysis</h3>
        <span className={`text-sm font-semibold rounded-full px-3 py-1 ${fairnessColor}`}>
          {fairnessGrade}
        </span>
      </div>

      {/* Value comparison chart */}
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={120} tick={{ fill: theme === 'dark' ? '#d1d5db' : '#374151', fontSize: 13 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: theme === 'dark' ? '#1f2937' : '#fff',
              border: `1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'}`,
              borderRadius: '8px',
              color: theme === 'dark' ? '#f3f4f6' : '#111827',
            }}
            formatter={(value) => [Math.round(Number(value)).toLocaleString(), 'Value']}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24} label={{ position: 'right', fill: theme === 'dark' ? '#9ca3af' : '#6b7280', fontSize: 12, formatter: (v: unknown) => Math.round(Number(v)).toLocaleString() }}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Asset details per side */}
      <div className="space-y-3">
        {sides.map(side => {
          const isWinner = winner === side.rosterId;
          return (
            <div key={side.rosterId}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {side.teamName} receives
                  {isWinner && <span className="text-green-600 dark:text-green-400 ml-1 text-xs">(+{formatValue(difference)})</span>}
                </span>
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatValue(side.totalValue)}</span>
              </div>
              <div className="mt-1 space-y-0.5">
                {side.playerValues.map(p => (
                  <div key={p.id} className="flex items-center gap-2 text-xs">
                    <span className={`inline-block w-6 text-center font-semibold rounded px-0.5 ${POS_COLORS[p.position] || 'bg-gray-100 text-gray-600'}`}>
                      {p.position}
                    </span>
                    <Link to={`/league/${leagueId}/player/${p.id}`} className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400">
                      {p.name}
                    </Link>
                    <span className="text-gray-400 dark:text-gray-500 ml-auto">{formatValue(p.value)}</span>
                  </div>
                ))}
                {side.pickValues.map((pick, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="inline-block w-6 text-center font-semibold rounded px-0.5 bg-purple-100 text-purple-700">
                      PK
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">{pick.label}</span>
                    <span className="text-gray-400 dark:text-gray-500 ml-auto">{formatValue(pick.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Explanation */}
      {explanation.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
          <ul className="space-y-1">
            {explanation.map((line, i) => (
              <li key={i} className="text-sm text-gray-600 dark:text-gray-300">{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
