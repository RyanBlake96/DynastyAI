import type { LeagueType } from '../types';

export interface ValuesResponse {
  leagueType: string;
  lastRefresh: string | null;
  sources: {
    ktc: Record<string, number> | null;
    fantasycalc: Record<string, number> | null;
    dynastyprocess: Record<string, number> | null;
  };
}

export async function fetchPlayerValues(leagueType: LeagueType): Promise<ValuesResponse> {
  const apiType = leagueType === 'superflex' ? 'sf' : '1qb';
  const res = await fetch(`/api/values?type=${apiType}`);
  if (!res.ok) throw new Error('Failed to fetch player values');
  return res.json();
}
