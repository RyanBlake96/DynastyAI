import { useParams, Link } from 'react-router-dom';
import { useLeagueLayout } from '../components/LeagueLayout';
import { usePlayers, getPlayerInfo } from '../hooks/usePlayers';
import { usePlayerValues, getPlayerValue, getPlayerValueBreakdown } from '../hooks/usePlayerValues';
import { computePowerRankings } from '../utils/powerRankings';
import { computeRecommendation } from '../utils/recommendations';
import { getFormatNotes } from '../utils/formatNotes';
import { usePlayerNews } from '../hooks/usePlayerNews';
import { useTheme } from '../hooks/useTheme';
import type { Recommendation } from '../utils/recommendations';
import type { SleeperRoster, SleeperUser } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-100 text-red-700',
  RB: 'bg-blue-100 text-blue-700',
  WR: 'bg-green-100 text-green-700',
  TE: 'bg-orange-100 text-orange-700',
  K: 'bg-purple-100 text-purple-700',
  DEF: 'bg-gray-200 text-gray-700',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  Active: { label: 'Active', color: 'text-green-600 dark:text-green-400' },
  Inactive: { label: 'Inactive', color: 'text-yellow-600 dark:text-yellow-400' },
  Injured_Reserve: { label: 'IR', color: 'text-red-600 dark:text-red-400' },
  Practice_Squad: { label: 'Practice Squad', color: 'text-gray-500 dark:text-gray-400' },
  Physically_Unable_to_Perform: { label: 'PUP', color: 'text-red-500 dark:text-red-400' },
};

function getUserName(roster: SleeperRoster, users: SleeperUser[]): string {
  const user = users.find((u) => u.user_id === roster.owner_id);
  return user?.display_name || user?.username || `Team ${roster.roster_id}`;
}

function formatValue(val: number): string {
  return Math.round(val).toLocaleString();
}

export default function PlayerDetail() {
  const { playerId } = useParams<{ playerId: string }>();
  const { data, leagueId } = useLeagueLayout();
  const { players, status: playersStatus } = usePlayers();
  const { values, status: valuesStatus } = usePlayerValues(data.leagueType);

  if (playersStatus === 'loading') {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-gray-500 dark:text-gray-400">Loading player data...</p>
      </div>
    );
  }

  const { league, rosters, users } = data;
  const info = getPlayerInfo(players, playerId!);
  const playerData = players?.[playerId!];
  const valuesReady = valuesStatus === 'ready';

  // Value breakdown
  const breakdown = getPlayerValueBreakdown(values, playerId!);


  // League context: find which roster owns this player
  const ownerRoster = rosters.find((r) => r.players?.includes(playerId!));
  const ownerName = ownerRoster ? getUserName(ownerRoster, users) : null;

  // Determine roster slot
  let rosterSlot: 'Starter' | 'Bench' | 'Taxi' | 'IR' | null = null;
  if (ownerRoster) {
    if (ownerRoster.starters?.includes(playerId!)) rosterSlot = 'Starter';
    else if (ownerRoster.reserve?.includes(playerId!)) rosterSlot = 'IR';
    else if (ownerRoster.taxi?.includes(playerId!)) rosterSlot = 'Taxi';
    else rosterSlot = 'Bench';
  }

  // Compute team tier if values are available
  const rankings = valuesReady
    ? computePowerRankings(rosters, values, players, league.roster_positions)
    : [];
  const ownerRanking = ownerRoster
    ? rankings.find((r) => r.rosterId === ownerRoster.roster_id)
    : null;

  // Positional depth: count how many players at this position are on the owner's roster
  const positionGroup: { id: string; name: string; value: number }[] = [];
  if (ownerRoster && players) {
    for (const pid of ownerRoster.players || []) {
      const pInfo = getPlayerInfo(players, pid);
      if (pInfo.position === info.position) {
        positionGroup.push({
          id: pid,
          name: pInfo.name,
          value: getPlayerValue(values, pid),
        });
      }
    }
    positionGroup.sort((a, b) => b.value - a.value);
  }

  // Player rank among all rostered players at same position (league-wide)
  let posRankLeague: number | null = null;
  if (valuesReady && players) {
    const allAtPos: { id: string; value: number }[] = [];
    for (const roster of rosters) {
      for (const pid of roster.players || []) {
        if (getPlayerInfo(players, pid).position === info.position) {
          allAtPos.push({ id: pid, value: getPlayerValue(values, pid) });
        }
      }
    }
    allAtPos.sort((a, b) => b.value - a.value);
    const idx = allAtPos.findIndex((p) => p.id === playerId);
    if (idx !== -1) posRankLeague = idx + 1;
  }

  // Compute hold/trade/sell recommendation
  const recommendation = valuesReady && ownerRoster ? computeRecommendation({
    position: info.position,
    age: info.age,
    yearsExp: playerData?.years_exp,
    teamTier: ownerRanking?.tier ?? null,
    rosterSlot,
    avgValue: breakdown.average,
    ktcValue: breakdown.ktc,
    fantasycalcValue: breakdown.fantasycalc,
    dynastyprocessValue: breakdown.dynastyprocess,
    posDepthRank: positionGroup.findIndex((p) => p.id === playerId) + 1,
    posDepthCount: positionGroup.length,
    leaguePosRank: posRankLeague,
    leagueTeamCount: rosters.length,
  }) : null;

  const recColors: Record<Recommendation, string> = {
    'Strong Hold': 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700',
    'Hold': 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
    'Trade': 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700',
    'Sell': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
  };

  const recIcons: Record<Recommendation, string> = {
    'Strong Hold': '💎',
    'Hold': '✊',
    'Trade': '🔄',
    'Sell': '📉',
  };

  const tierColors: Record<string, string> = {
    'Strong Contender': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    'Contender': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    'Fringe Playoff': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    'Rebuilder': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };

  const playerStatus = playerData?.status as string | undefined;
  const statusInfo = (playerStatus && STATUS_LABELS[playerStatus]) || { label: playerStatus || 'Unknown', color: 'text-gray-500 dark:text-gray-400' };
  const posColors = POS_COLORS[info.position] || 'bg-gray-100 text-gray-600';

  // Player news
  const playerName = info.name !== 'Unknown' ? info.name : null;
  const { news, status: newsStatus } = usePlayerNews(playerName);
  const { theme } = useTheme();

  // Injury details from Sleeper data
  const injuryStatus = playerData?.injury_status as string | null;
  const injuryBodyPart = playerData?.injury_body_part as string | null;
  const practiceParticipation = playerData?.practice_participation as string | null;

  // Recharts data for value comparison
  const valueChartData = [
    { name: 'KTC', value: breakdown.ktc, raw: breakdown.rawKtc, fill: '#3b82f6' },
    { name: 'FantasyCalc', value: breakdown.fantasycalc, raw: breakdown.rawFantasycalc, fill: '#22c55e' },
    { name: 'DynastyProcess', value: breakdown.dynastyprocess, raw: breakdown.rawDynastyprocess, fill: '#a855f7' },
  ];

  return (
    <main className="max-w-4xl mx-auto px-8 py-6 space-y-6">
        {/* Bio Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-lg flex items-center justify-center text-lg font-bold ${posColors}`}>
              {info.position}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{info.name}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-gray-500 dark:text-gray-400">
                {info.team && <span className="font-medium text-gray-700 dark:text-gray-300">{info.team}</span>}
                {info.age && <span>Age {info.age}</span>}
                {playerData?.years_exp !== undefined && (
                  <span>{playerData.years_exp === 0 ? 'Rookie' : `${playerData.years_exp} yr${playerData.years_exp > 1 ? 's' : ''} exp`}</span>
                )}
                <span className={statusInfo.color}>{statusInfo.label}</span>
              </div>
              {injuryStatus && (
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    injuryStatus === 'Questionable' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' :
                    injuryStatus === 'Doubtful' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' :
                    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                  }`}>
                    {injuryStatus}
                  </span>
                  {injuryBodyPart && <span className="text-xs text-gray-500 dark:text-gray-400">{injuryBodyPart}</span>}
                  {practiceParticipation && (
                    <span className={`text-xs ${
                      practiceParticipation === 'Full' ? 'text-green-600 dark:text-green-400' :
                      practiceParticipation === 'Limited' ? 'text-yellow-600 dark:text-yellow-400' :
                      'text-red-600 dark:text-red-400'
                    }`}>
                      Practice: {practiceParticipation}
                    </span>
                  )}
                </div>
              )}
            </div>
            {valuesReady && breakdown.average > 0 && (
              <div className="text-right">
                <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{Math.round(breakdown.average)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Avg Value</p>
              </div>
            )}
          </div>
        </div>

        {/* Trade Values Section */}
        {valuesReady && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">Dynasty Trade Values</h2>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={valueChartData} layout="vertical" margin={{ left: 10, right: 40, top: 5, bottom: 5 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: theme === 'dark' ? '#9ca3af' : '#4b5563', fontSize: 13 }} />
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
                  {valueChartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Dynasty AI Value <span className="text-xs text-gray-400 dark:text-gray-500">(normalised average)</span></span>
              <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{Math.round(breakdown.average)}</span>
            </div>
            {posRankLeague && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Ranked #{posRankLeague} {info.position} in this league by trade value
              </p>
            )}
          </div>
        )}

        {/* Sell Window Alert */}
        {recommendation?.sellWindow.active && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-4 flex items-start gap-3">
            <span className="text-xl mt-0.5">⚠️</span>
            <div>
              <h2 className="text-sm font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide">Sell Window</h2>
              <ul className="mt-1 space-y-1">
                {recommendation.sellWindow.reasons.map((reason, i) => (
                  <li key={i} className="text-sm text-amber-700 dark:text-amber-300">{reason}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Recommendation Section */}
        {recommendation && (
          <div className={`rounded-lg border p-6 ${recColors[recommendation.action]}`}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">{recIcons[recommendation.action]}</span>
              <div>
                <h2 className="text-lg font-bold">{recommendation.action}</h2>
                <p className="text-xs opacity-70">Dynasty recommendation</p>
              </div>
            </div>
            <ul className="space-y-1.5">
              {recommendation.reasons.map((reason, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="opacity-50 mt-0.5">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* League Context Section */}
        {ownerRoster && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">League Context</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500">Rostered by</p>
                <Link
                  to={`/league/${leagueId}/team/${ownerRoster.roster_id}`}
                  className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {ownerName}
                </Link>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500">Roster Slot</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{rosterSlot}</p>
              </div>
              {ownerRanking && (
                <>
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Team Tier</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tierColors[ownerRanking.tier]}`}>
                      {ownerRanking.tier}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Power Rank</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">#{ownerRanking.rank} of {rosters.length}</p>
                  </div>
                </>
              )}
            </div>

            {/* Positional depth on owner's team */}
            {positionGroup.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                  {info.position} depth on {ownerName}'s roster ({positionGroup.length} total)
                </p>
                <div className="space-y-1">
                  {positionGroup.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      {p.id === playerId ? (
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{p.name}</span>
                      ) : (
                        <Link
                          to={`/league/${leagueId}/player/${p.id}`}
                          className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          {p.name}
                        </Link>
                      )}
                      {valuesReady && p.value > 0 && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">{formatValue(p.value)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Free Agent notice */}
        {!ownerRoster && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">League Context</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">This player is not on any roster in this league.</p>
          </div>
        )}

        {/* Format sensitivity notes relevant to this player */}
        {(() => {
          const allNotes = getFormatNotes(league);
          // Filter to notes relevant to this player's position
          const relevant = allNotes.filter(n => {
            if (info.position === 'TE' && n.label.includes('TE Premium')) return true;
            if (info.position === 'QB' && n.label.includes('Superflex')) return true;
            if (n.label.includes('PPR') || n.label.includes('Standard')) return true;
            if (n.label.includes('rosters') || n.label.includes('flex')) return true;
            return false;
          });
          if (relevant.length === 0) return null;
          return (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium mb-2">Format Notes</p>
              <div className="space-y-2">
                {relevant.map((note, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded px-1.5 py-0.5 shrink-0 mt-0.5">{note.label}</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{note.note}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Recent News */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">Recent News</h2>
          {newsStatus === 'loading' && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Loading news...</p>
          )}
          {newsStatus === 'ready' && news.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">No recent news for this player.</p>
          )}
          {newsStatus === 'ready' && news.length > 0 && (
            <div className="space-y-4">
              {news.map((item, i) => (
                <div key={i} className="border-b border-gray-100 dark:border-gray-700 pb-3 last:border-0 last:pb-0">
                  <a
                    href={item.url || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    {item.headline}
                  </a>
                  {item.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400 dark:text-gray-500">{item.source}</span>
                    {item.published && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(item.published).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {newsStatus === 'error' && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Could not load news.</p>
          )}
        </div>

        {valuesStatus === 'loading' && (
          <p className="text-xs text-gray-400 dark:text-gray-500">Loading player values...</p>
        )}
    </main>
  );
}
