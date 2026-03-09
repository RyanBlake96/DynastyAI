import type { SleeperLeague } from '../types';

export interface FormatNote {
  label: string;
  note: string;
}

export function getFormatNotes(league: SleeperLeague): FormatNote[] {
  const notes: FormatNote[] = [];
  const scoring = league.scoring_settings || {};
  const positions = league.roster_positions || [];

  // TE Premium
  const teBonus = scoring.bonus_rec_te ?? 0;
  if (teBonus > 0) {
    notes.push({
      label: `TE Premium (+${teBonus})`,
      note: 'TEs receive an extra reception bonus — elite TEs like top-5 are significantly more valuable. Prioritise TE in trades and drafts.',
    });
  }

  // PPR variant
  const rec = scoring.rec ?? 0;
  if (rec === 0) {
    notes.push({
      label: 'Standard (non-PPR)',
      note: 'No reception bonus — high-volume pass catchers lose value relative to PPR formats. RBs with rushing volume gain relative value.',
    });
  } else if (rec === 0.5) {
    notes.push({
      label: 'Half PPR',
      note: 'Half-point per reception — balanced between volume and efficiency. Mid-range WRs and pass-catching RBs benefit.',
    });
  }
  // Full PPR (rec === 1) is standard dynasty — no note needed

  // Superflex detection
  const hasSF = positions.includes('SUPER_FLEX');
  if (hasSF) {
    notes.push({
      label: 'Superflex',
      note: 'QBs are significantly more valuable — expect 2x-3x premium over 1QB leagues. Rostering 3+ QBs is recommended.',
    });
  }

  // Roster size
  const totalRosterSpots = positions.length;
  const taxiCount = positions.filter(s => s === 'TAXI').length;

  if (totalRosterSpots >= 30) {
    notes.push({
      label: `Deep rosters (${totalRosterSpots} spots)`,
      note: 'Large roster size increases the value of depth and young stashes. Handcuffs and developmental players are worth rostering.',
    });
  } else if (totalRosterSpots <= 18) {
    notes.push({
      label: `Shallow rosters (${totalRosterSpots} spots)`,
      note: 'Small roster size favours proven starters over stashes. Bench depth is limited — prioritise immediate production.',
    });
  }

  if (taxiCount > 0) {
    notes.push({
      label: `Taxi squad (${taxiCount} spots)`,
      note: 'Taxi squad allows stashing rookies without using bench spots. Use all taxi spots to develop young talent.',
    });
  }

  // Number of starting flex spots
  const flexSlots = positions.filter(s =>
    s === 'FLEX' || s === 'SUPER_FLEX' || s === 'REC_FLEX' || s === 'WRRB_FLEX'
  ).length;
  if (flexSlots >= 3) {
    notes.push({
      label: `${flexSlots} flex slots`,
      note: 'Multiple flex slots reward positional depth — having extra startable RB/WR/TE is highly valuable.',
    });
  }

  // IDP
  const hasIDP = positions.some(s => ['DL', 'LB', 'DB', 'IDP_FLEX'].includes(s));
  if (hasIDP) {
    notes.push({
      label: 'IDP league',
      note: 'Defensive players are rostered — LBs typically score the most in IDP formats. Factor IDP into trades and draft strategy.',
    });
  }

  return notes;
}
