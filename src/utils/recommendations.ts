import type { CompetitiveTier } from '../types';

export type Recommendation = 'Strong Hold' | 'Hold' | 'Trade' | 'Sell';

export interface SellWindowAlert {
  active: boolean;
  reasons: string[];
}

export interface RecommendationResult {
  action: Recommendation;
  reasons: string[];
  sellWindow: SellWindowAlert;
}

// Position-specific age thresholds where decline typically begins
const POS_DECLINE_AGE: Record<string, number> = {
  QB: 33,
  RB: 27,
  WR: 29,
  TE: 29,
};

// Position-specific peak age range [start, end]
const POS_PEAK_AGE: Record<string, [number, number]> = {
  QB: [26, 32],
  RB: [23, 26],
  WR: [24, 28],
  TE: [25, 28],
};

interface RecommendationInput {
  position: string;
  age: number | null;
  yearsExp: number | undefined;
  teamTier: CompetitiveTier | null;
  rosterSlot: 'Starter' | 'Bench' | 'Taxi' | 'IR' | null;
  // Value data
  avgValue: number;
  ktcValue: number;
  fantasycalcValue: number;
  dynastyprocessValue: number;
  // Positional context on owner's team
  posDepthRank: number; // 1 = highest valued at position on team
  posDepthCount: number; // total at this position on team
  // League-wide positional rank
  leaguePosRank: number | null;
  leagueTeamCount: number;
}

export function computeRecommendation(input: RecommendationInput): RecommendationResult {
  const reasons: string[] = [];
  let score = 0; // positive = hold, negative = sell

  const {
    position, age, teamTier, rosterSlot,
    avgValue, ktcValue, fantasycalcValue, dynastyprocessValue,
    posDepthRank, posDepthCount, leaguePosRank, leagueTeamCount,
  } = input;

  // If no trade value, not much to recommend on
  if (avgValue === 0) {
    return { action: 'Hold', reasons: ['No trade value data available'], sellWindow: { active: false, reasons: [] } };
  }

  // --- Age & trajectory ---
  const declineAge = POS_DECLINE_AGE[position] ?? 30;
  const peakRange = POS_PEAK_AGE[position] ?? [25, 29];

  if (age !== null) {
    if (age >= declineAge + 3) {
      score -= 3;
      reasons.push(`Age ${age} is well past ${position} prime — declining asset`);
    } else if (age >= declineAge) {
      score -= 2;
      reasons.push(`Age ${age} is entering decline window for ${position}s`);
    } else if (age >= peakRange[0] && age <= peakRange[1]) {
      score += 1;
      reasons.push(`Age ${age} is in peak production window for ${position}s`);
    } else if (age < peakRange[0]) {
      score += 2;
      reasons.push(`Age ${age} — still ascending, value likely to grow`);
    }
  }

  // --- Team tier alignment ---
  if (teamTier) {
    if (teamTier === 'Rebuilder') {
      if (age !== null && age >= declineAge) {
        score -= 2;
        reasons.push('Aging asset on a rebuilding team — sell for future picks');
      } else if (age !== null && age < peakRange[0]) {
        score += 1;
        reasons.push('Young player fits the rebuild timeline');
      }
    } else if (teamTier === 'Strong Contender' || teamTier === 'Contender') {
      if (age !== null && age >= peakRange[0] && age <= declineAge) {
        score += 1;
        reasons.push('Window player on a contending team — maximize now');
      }
    }
  }

  // --- Positional surplus ---
  if (posDepthCount >= 4 && posDepthRank >= 3 && rosterSlot === 'Bench') {
    score -= 1;
    reasons.push(`${position}${posDepthRank} on team with ${posDepthCount} rostered — positional surplus`);
  } else if (posDepthCount >= 3 && posDepthRank === 1) {
    score += 1;
    reasons.push(`Top ${position} on the roster — core piece`);
  }

  // --- Value divergence across sources ---
  const sourceVals = [ktcValue, fantasycalcValue, dynastyprocessValue].filter(v => v > 0);
  if (sourceVals.length >= 2) {
    const maxVal = Math.max(...sourceVals);
    const minVal = Math.min(...sourceVals);
    const spread = maxVal - minVal;
    const spreadPct = avgValue > 0 ? spread / avgValue : 0;

    if (spreadPct > 0.4) {
      // Check if player is overvalued on one source (potential sell high)
      if (maxVal === ktcValue && ktcValue > avgValue * 1.2) {
        score -= 1;
        reasons.push('KTC values significantly higher than other sources — potential sell-high window');
      } else if (maxVal === fantasycalcValue && fantasycalcValue > avgValue * 1.2) {
        score -= 1;
        reasons.push('FantasyCalc values significantly higher than other sources — potential sell-high window');
      } else {
        reasons.push('Large value spread across sources — market is uncertain');
      }
    }
  }

  // --- League positional rank ---
  if (leaguePosRank !== null) {
    const topTier = Math.ceil(leagueTeamCount * 0.25); // top 25%
    if (leaguePosRank <= topTier) {
      score += 1;
      reasons.push(`Top-tier ${position} in this league (#${leaguePosRank})`);
    } else if (leaguePosRank > leagueTeamCount * 2) {
      // Ranked beyond 2x the number of teams — low-end asset
      if (rosterSlot === 'Bench') {
        score -= 1;
        reasons.push(`Low-ranked ${position} (#${leaguePosRank}) — limited roster value`);
      }
    }
  }

  // --- Roster slot ---
  if (rosterSlot === 'IR') {
    score -= 1;
    reasons.push('Currently on IR — injury risk reduces near-term value');
  }

  // --- Sell window detection ---
  const sellWindowReasons: string[] = [];

  if (age !== null) {
    // RB at 28+ with meaningful value — classic sell window
    if (position === 'RB' && age >= 28 && avgValue >= 2000) {
      sellWindowReasons.push(`RB age ${age} with high trade value — peak sell window before decline accelerates`);
    }

    // High-value player at or past decline age — value is as high as it will be
    if (age >= declineAge && avgValue >= 3000) {
      sellWindowReasons.push(`Age ${age} ${position} at elite value (${Math.round(avgValue)}) — unlikely to maintain this value long-term`);
    }

    // Player in final peak year (1 year before decline) with top-tier value
    if (age === declineAge - 1 && avgValue >= 4000) {
      sellWindowReasons.push(`Final peak year at age ${age} — maximise return before age-related discount`);
    }
  }

  // Value significantly above the lowest source — someone in the market may pay the high price
  if (sourceVals.length >= 2) {
    const maxVal = Math.max(...sourceVals);
    const minVal = Math.min(...sourceVals);
    if (maxVal > minVal * 1.5 && avgValue >= 2000) {
      sellWindowReasons.push(`Value spread (${Math.round(minVal)}–${Math.round(maxVal)}) suggests sell-high opportunity on platforms using the higher valuation`);
    }
  }

  const sellWindow: SellWindowAlert = {
    active: sellWindowReasons.length > 0,
    reasons: sellWindowReasons,
  };

  // --- Determine action ---
  let action: Recommendation;
  if (score >= 3) {
    action = 'Strong Hold';
  } else if (score >= 1) {
    action = 'Hold';
  } else if (score >= -1) {
    action = 'Trade';
  } else {
    action = 'Sell';
  }

  // If no specific reasons were generated, add a default
  if (reasons.length === 0) {
    reasons.push('No strong signals — monitor and reassess');
  }

  return { action, reasons, sellWindow };
}
