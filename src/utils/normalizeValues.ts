import type { ValuesResponse } from '../api/values';

const NORMALIZED_SCALE = 10000;

interface SourceStats {
  min: number;
  max: number;
}

function computeStats(source: Record<string, number> | null): SourceStats | null {
  if (!source) return null;
  const vals = Object.values(source).filter(v => v > 0);
  if (vals.length === 0) return null;
  return {
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}

// Min-max normalize a single value to 0-NORMALIZED_SCALE
function normalize(value: number, stats: SourceStats): number {
  if (stats.max === stats.min) return NORMALIZED_SCALE / 2;
  return ((value - stats.min) / (stats.max - stats.min)) * NORMALIZED_SCALE;
}

export interface NormalizedValues {
  sources: ValuesResponse['sources'];
  stats: {
    ktc: SourceStats | null;
    fantasycalc: SourceStats | null;
    dynastyprocess: SourceStats | null;
  };
}

export function computeNormalizationStats(values: ValuesResponse): NormalizedValues {
  return {
    sources: values.sources,
    stats: {
      ktc: computeStats(values.sources.ktc),
      fantasycalc: computeStats(values.sources.fantasycalc),
      dynastyprocess: computeStats(values.sources.dynastyprocess),
    },
  };
}

// Get a player's normalized value from a single source
export function getNormalizedSourceValue(
  raw: number,
  stats: SourceStats | null,
): number {
  if (!stats || raw <= 0) return 0;
  return normalize(raw, stats);
}

// Get a player's normalized average value across available sources
export function getNormalizedPlayerValue(
  nv: NormalizedValues,
  playerId: string,
): number {
  const vals: number[] = [];

  const ktcRaw = nv.sources.ktc?.[playerId];
  if (ktcRaw && ktcRaw > 0 && nv.stats.ktc) {
    vals.push(normalize(ktcRaw, nv.stats.ktc));
  }

  const fcRaw = nv.sources.fantasycalc?.[playerId];
  if (fcRaw && fcRaw > 0 && nv.stats.fantasycalc) {
    vals.push(normalize(fcRaw, nv.stats.fantasycalc));
  }

  const dpRaw = nv.sources.dynastyprocess?.[playerId];
  if (dpRaw && dpRaw > 0 && nv.stats.dynastyprocess) {
    vals.push(normalize(dpRaw, nv.stats.dynastyprocess));
  }

  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Get normalized breakdown per source + normalized average
export function getNormalizedBreakdown(
  nv: NormalizedValues,
  playerId: string,
): { ktc: number; fantasycalc: number; dynastyprocess: number; average: number; rawKtc: number; rawFantasycalc: number; rawDynastyprocess: number } {
  const ktcRaw = nv.sources.ktc?.[playerId] ?? 0;
  const fcRaw = nv.sources.fantasycalc?.[playerId] ?? 0;
  const dpRaw = nv.sources.dynastyprocess?.[playerId] ?? 0;

  const ktcNorm = getNormalizedSourceValue(ktcRaw, nv.stats.ktc);
  const fcNorm = getNormalizedSourceValue(fcRaw, nv.stats.fantasycalc);
  const dpNorm = getNormalizedSourceValue(dpRaw, nv.stats.dynastyprocess);

  const normVals = [ktcNorm, fcNorm, dpNorm].filter(v => v > 0);
  const average = normVals.length > 0 ? normVals.reduce((a, b) => a + b, 0) / normVals.length : 0;

  return {
    ktc: ktcNorm,
    fantasycalc: fcNorm,
    dynastyprocess: dpNorm,
    average,
    rawKtc: ktcRaw,
    rawFantasycalc: fcRaw,
    rawDynastyprocess: dpRaw,
  };
}
