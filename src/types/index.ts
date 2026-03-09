// Sleeper API types

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  status: string;
  sport: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number>;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[];
  starters: string[];
  reserve: string[] | null;
  taxi: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal: number;
    fpts_against: number;
    fpts_against_decimal: number;
    ppts: number;
    ppts_decimal: number;
  };
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  position: string;
  team: string | null;
  age: number | null;
  years_exp: number;
  status: string;
  injury_status: string | null;
  injury_body_part: string | null;
  injury_start_date: string | null;
  practice_participation: string | null;
  news_updated: number | null;
}

// Draft types

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  type: string; // 'snake' | 'linear' | 'auction'
  status: string; // 'pre_draft' | 'drafting' | 'complete'
  season: string;
  settings: {
    rounds: number;
    teams: number;
    pick_timer: number;
    [key: string]: number;
  };
  metadata: {
    scoring_type?: string;
    name?: string;
    description?: string;
  } | null;
  start_time: number | null;
  draft_order: Record<string, number> | null; // user_id -> slot
  slot_to_roster_id: Record<string, number> | null; // slot -> roster_id
}

export interface SleeperDraftPick {
  player_id: string;
  picked_by: string;
  roster_id: number;
  round: number;
  draft_slot: number;
  pick_no: number;
  draft_id: string;
  is_keeper: boolean | null;
  metadata: {
    first_name: string;
    last_name: string;
    position: string;
    team: string;
    [key: string]: string;
  } | null;
}

// Transaction types

export interface SleeperTransaction {
  transaction_id: string;
  type: 'trade' | 'free_agent' | 'waiver';
  status: string;
  status_updated: number;
  created: number;
  creator: string;
  roster_ids: number[];
  adds: Record<string, number> | null; // player_id -> roster_id
  drops: Record<string, number> | null; // player_id -> roster_id
  draft_picks: SleeperTradedPick[];
  consenter_ids: number[] | null;
  leg: number;
  settings: Record<string, number> | null;
  waiver_budget: { sender: number; receiver: number; amount: number }[] | null;
  metadata: Record<string, string> | null;
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

// Player value types

export interface PlayerValue {
  player_id: string;
  name: string;
  position: string;
  team: string | null;
  ktc: number | null;
  fantasycalc: number | null;
  dynastyprocess: number | null;
  average: number | null;
}

// App types

export type LeagueType = '1qb' | 'superflex';

export interface LeagueContext {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  leagueType: LeagueType;
}

export type CompetitiveTier =
  | 'Strong Contender'
  | 'Contender'
  | 'Fringe Playoff'
  | 'Rebuilder';

// News types

export interface NewsItem {
  headline: string;
  description: string;
  published: string;
  source: string;
  url: string;
}
