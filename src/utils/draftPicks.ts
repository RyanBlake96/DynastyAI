import type { SleeperRoster, SleeperTradedPick, SleeperDraft, SleeperDraftPick } from '../types';

// --- Types ---

export interface PickOwnership {
  season: string;
  round: number;
  pickInRound: number; // 1-based position within the round (e.g., 3 for x.03)
  originalOwner: number;
  currentOwner: number;
  pickLabel: string; // e.g., "1.03" or "~1.03" for projected, or "Round 1" for far future
  isProjected: boolean; // true if position is estimated from standings
  estimatedValue: number;
}

// --- Pick Value Estimation ---

// Static pick values on the 0-10,000 normalised scale
const PICK_VALUES: Record<number, { early: number; mid: number; late: number }> = {
  1: { early: 6500, mid: 5500, late: 4500 },
  2: { early: 3800, mid: 3200, late: 2700 },
  3: { early: 2200, mid: 2000, late: 1700 },
  4: { early: 1500, mid: 1200, late: 1000 },
  5: { early: 500, mid: 350, late: 200 },
};

// Discount factor per year out: 1 year out = full value, 2 years out = 85%
const FUTURE_DISCOUNT: Record<number, number> = {
  0: 1.0,   // current season
  1: 1.0,   // next season (e.g. 2027)
  2: 0.85,  // two seasons out (e.g. 2028)
};

export function estimatePickValue(round: number, pickInRound: number | null, totalTeams: number, yearsOut: number = 0): number {
  const roundVals = PICK_VALUES[round];
  if (!roundVals) return 100;

  let base: number;
  if (pickInRound === null || pickInRound <= 0) {
    base = roundVals.mid;
  } else {
    const thirdOfTeams = Math.ceil(totalTeams / 3);
    if (pickInRound <= thirdOfTeams) base = roundVals.early;
    else if (pickInRound <= thirdOfTeams * 2) base = roundVals.mid;
    else base = roundVals.late;
  }

  const discount = FUTURE_DISCOUNT[yearsOut] ?? 0.75;
  return Math.round(base * discount);
}

/**
 * Format a label for a SleeperTradedPick (used in trade history where PickOwnership isn't available).
 */
export function formatTradedPickLabel(
  pick: SleeperTradedPick,
  rosters: SleeperRoster[],
  users: { user_id: string; display_name?: string; username?: string }[],
): string {
  const originalRoster = rosters.find(r => r.roster_id === pick.roster_id);
  const originalUser = originalRoster
    ? users.find(u => u.user_id === originalRoster.owner_id)
    : null;
  const originalName = originalUser?.display_name || originalUser?.username || `Team ${pick.roster_id}`;
  const isOriginal = pick.roster_id === pick.owner_id;
  let label = `${pick.season} Round ${pick.round}`;
  if (!isOriginal) {
    label += ` (via ${originalName})`;
  }
  return label;
}

/**
 * Estimate value for a SleeperTradedPick (no pick position info — uses mid value).
 */
export function estimateTradedPickValue(pick: SleeperTradedPick): number {
  const roundVals = PICK_VALUES[pick.round];
  if (!roundVals) return 100;
  return roundVals.mid;
}

/**
 * Build a map of overall pick number -> rookie value from ranked rookies.
 * Rank 1 rookie = overall pick 1, rank 2 = overall pick 2, etc.
 */
export function buildRookiePickValueMap(
  rookieRankings: { rank: number; value: number }[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of rookieRankings) {
    map.set(r.rank, r.value);
  }
  return map;
}

// --- Draft Order Helpers ---

/**
 * Build reverse standings order: worst record = pick 1 (earliest), best = pick N (latest).
 * Returns a map of roster_id -> 1-based draft slot.
 */
export function buildDraftOrder(rosters: SleeperRoster[]): Map<number, number> {
  const sorted = [...rosters].sort((a, b) => {
    const wDiff = (a.settings?.wins ?? 0) - (b.settings?.wins ?? 0);
    if (wDiff !== 0) return wDiff;
    return (a.settings?.fpts ?? 0) - (b.settings?.fpts ?? 0);
  });
  const order = new Map<number, number>();
  sorted.forEach((r, i) => order.set(r.roster_id, i + 1));
  return order;
}

/**
 * Extract roster_id -> slot mapping from a draft.
 * Uses slot_to_roster_id (definitive) if available, falls back to draft_order (user_id based).
 */
export function getDraftSlotOrder(
  draft: SleeperDraft,
  rosters: SleeperRoster[],
): Map<number, number> {
  const order = new Map<number, number>();

  if (draft.slot_to_roster_id) {
    for (const [slotStr, rosterId] of Object.entries(draft.slot_to_roster_id)) {
      order.set(rosterId, Number(slotStr));
    }
    return order;
  }

  if (draft.draft_order) {
    const assignedSlots = new Set<number>();
    for (const [userId, slot] of Object.entries(draft.draft_order)) {
      const roster = rosters.find((r) => r.owner_id === userId);
      if (roster) {
        order.set(roster.roster_id, slot);
        assignedSlots.add(slot);
      }
    }

    const unmatchedRosters = rosters.filter((r) => !order.has(r.roster_id));
    if (unmatchedRosters.length > 0) {
      const totalSlots = draft.settings?.teams ?? rosters.length;
      const unassignedSlots: number[] = [];
      for (let s = 1; s <= totalSlots; s++) {
        if (!assignedSlots.has(s)) unassignedSlots.push(s);
      }
      for (let i = 0; i < Math.min(unmatchedRosters.length, unassignedSlots.length); i++) {
        order.set(unmatchedRosters[i].roster_id, unassignedSlots[i]);
      }
    }
  }

  return order;
}

// --- Pick Ownership Building ---

/**
 * Build pick ownership for specified seasons.
 * For the current season: show projected pick positions (e.g. ~1.03).
 * For future seasons (>1 year away): just show round (e.g. "Round 1"), no position estimate.
 */
export function buildPickOwnership(
  rosters: SleeperRoster[],
  tradedPicks: SleeperTradedPick[],
  seasons: string[],
  maxRounds: number,
  currentSeason: string,
  projectedOrder: Map<number, number>,
  completedDraftPicks: Map<string, SleeperDraftPick[]>,
  preDraftOrders: Map<string, Map<number, number>>,
  totalTeams: number,
): PickOwnership[] {
  const picks: PickOwnership[] = [];
  const currentSeasonNum = parseInt(currentSeason, 10);

  for (const season of seasons) {
    const seasonNum = parseInt(season, 10);
    const isFuture = seasonNum > currentSeasonNum; // more than current season
    const actualPicks = completedDraftPicks.get(season);
    const preDraftOrder = preDraftOrders.get(season);

    for (let round = 1; round <= maxRounds; round++) {
      for (const roster of rosters) {
        let pickInRound: number;
        let isProjected: boolean;
        let pickLabel: string;

        if (actualPicks) {
          // Completed draft — use actual pick data
          const actual = actualPicks.find(
            (p) => p.round === round && p.roster_id === roster.roster_id,
          );
          if (actual) {
            pickInRound = actual.draft_slot;
            isProjected = false;
          } else {
            pickInRound = projectedOrder.get(roster.roster_id) ?? roster.roster_id;
            isProjected = true;
          }
          const slot = String(pickInRound).padStart(2, '0');
          pickLabel = isProjected ? `~${round}.${slot}` : `${round}.${slot}`;
        } else if (!isFuture && preDraftOrder && preDraftOrder.has(roster.roster_id)) {
          // Current season pre-draft with set draft order
          pickInRound = preDraftOrder.get(roster.roster_id)!;
          isProjected = false;
          const slot = String(pickInRound).padStart(2, '0');
          pickLabel = `${round}.${slot}`;
        } else if (!isFuture) {
          // Current season, no draft data — project from standings
          pickInRound = projectedOrder.get(roster.roster_id) ?? roster.roster_id;
          isProjected = true;
          const slot = String(pickInRound).padStart(2, '0');
          pickLabel = `~${round}.${slot}`;
        } else {
          // Future season — just show round, no position
          pickInRound = 0;
          isProjected = false;
          pickLabel = `Round ${round}`;
        }

        const yearsOut = seasonNum - currentSeasonNum;
        const estValue = isFuture
          ? estimatePickValue(round, null, totalTeams, yearsOut)
          : estimatePickValue(round, pickInRound, totalTeams, 0);

        picks.push({
          season,
          round,
          pickInRound,
          originalOwner: roster.roster_id,
          currentOwner: roster.roster_id,
          pickLabel,
          isProjected,
          estimatedValue: estValue,
        });
      }
    }
  }

  // Apply traded picks — override current owner
  for (const tp of tradedPicks) {
    const pick = picks.find(
      (p) =>
        p.season === tp.season &&
        p.round === tp.round &&
        p.originalOwner === tp.roster_id,
    );
    if (pick) {
      pick.currentOwner = tp.owner_id;
    }
  }

  // Sort picks
  picks.sort((a, b) => {
    if (a.season !== b.season) return a.season.localeCompare(b.season);
    if (a.round !== b.round) return a.round - b.round;
    return a.pickInRound - b.pickInRound;
  });

  return picks;
}

/**
 * Apply rookie trade values to current-season picks.
 * For picks in the current season where we know the pick position,
 * replace the static estimated value with the actual rookie value at that draft slot.
 * Returns a new array (does not mutate the input).
 */
export function applyRookieValues(
  picks: PickOwnership[],
  currentSeason: string,
  totalTeams: number,
  rookieValuesByOverallPick: Map<number, number>,
): PickOwnership[] {
  return picks.map(p => {
    if (p.season !== currentSeason || p.pickInRound <= 0) return p;
    const overallPick = (p.round - 1) * totalTeams + p.pickInRound;
    const rookieValue = rookieValuesByOverallPick.get(overallPick);
    if (rookieValue === undefined) return p;
    return { ...p, estimatedValue: rookieValue };
  });
}

/**
 * Compute total draft capital value for a roster across specified seasons.
 */
export function computePicksValue(
  allPicks: PickOwnership[],
  rosterId: number,
): number {
  return allPicks
    .filter(p => p.currentOwner === rosterId)
    .reduce((sum, p) => sum + p.estimatedValue, 0);
}
