import type { SleeperLeague, LeagueType } from '../types';

export function detectLeagueType(league: SleeperLeague): LeagueType {
  const positions = league.roster_positions || [];
  if (positions.includes('SUPER_FLEX')) {
    return 'superflex';
  }
  return '1qb';
}
