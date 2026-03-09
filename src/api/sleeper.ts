import type { SleeperUser, SleeperLeague, SleeperRoster, SleeperDraft, SleeperDraftPick, SleeperTransaction, SleeperTradedPick } from '../types';

const BASE_URL = '/api/sleeper';

export async function fetchUserByUsername(username: string): Promise<SleeperUser> {
  const res = await fetch(`${BASE_URL}/user?id=${encodeURIComponent(username)}`);
  if (!res.ok) throw new Error('User not found');
  return res.json();
}

export async function fetchNflState(): Promise<{ season: string; league_season: string }> {
  const res = await fetch(`${BASE_URL}/state?sport=nfl`);
  if (!res.ok) throw new Error('Failed to fetch NFL state');
  return res.json();
}

export async function fetchLeaguesByUserId(
  userId: string,
  sport: string = 'nfl',
  season?: string,
): Promise<SleeperLeague[]> {
  const s = season || (await fetchNflState()).league_season;
  const res = await fetch(
    `${BASE_URL}/user?id=${userId}&resource=leagues&sport=${sport}&season=${s}`,
  );
  if (!res.ok) throw new Error('Failed to fetch leagues');
  return res.json();
}

export async function fetchLeague(leagueId: string, cacheBust: string = ''): Promise<SleeperLeague> {
  const res = await fetch(`${BASE_URL}/league?id=${leagueId}${cacheBust}`);
  if (!res.ok) throw new Error('League not found');
  return res.json();
}

export async function fetchRosters(leagueId: string, cacheBust: string = ''): Promise<SleeperRoster[]> {
  const res = await fetch(`${BASE_URL}/league?id=${leagueId}&resource=rosters${cacheBust}`);
  if (!res.ok) throw new Error('Failed to fetch rosters');
  return res.json();
}

export async function fetchLeagueUsers(leagueId: string, cacheBust: string = ''): Promise<SleeperUser[]> {
  const res = await fetch(`${BASE_URL}/league?id=${leagueId}&resource=users${cacheBust}`);
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

export async function fetchDrafts(leagueId: string): Promise<SleeperDraft[]> {
  const res = await fetch(`${BASE_URL}/league?id=${leagueId}&resource=drafts`);
  if (!res.ok) throw new Error('Failed to fetch drafts');
  return res.json();
}

export async function fetchDraftPicks(leagueId: string, draftId: string): Promise<SleeperDraftPick[]> {
  const res = await fetch(`${BASE_URL}/league?id=${leagueId}&resource=draft_picks&draft_id=${draftId}`);
  if (!res.ok) throw new Error('Failed to fetch draft picks');
  return res.json();
}

export async function fetchTransactions(leagueId: string, round: number = 1): Promise<SleeperTransaction[]> {
  const res = await fetch(`${BASE_URL}/league?id=${leagueId}&resource=transactions&round=${round}`);
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json();
}

export async function fetchMatchups(leagueId: string, week: number) {
  const res = await fetch(`${BASE_URL}/league?id=${leagueId}&resource=matchups&week=${week}`);
  if (!res.ok) throw new Error('Failed to fetch matchups');
  return res.json();
}

export async function fetchTradedPicks(leagueId: string): Promise<SleeperTradedPick[]> {
  const res = await fetch(`${BASE_URL}/league?id=${leagueId}&resource=traded_picks`);
  if (!res.ok) throw new Error('Failed to fetch traded picks');
  return res.json();
}

export async function fetchPlayers() {
  const res = await fetch(`${BASE_URL}/players`);
  if (!res.ok) throw new Error('Failed to fetch players');
  return res.json();
}
