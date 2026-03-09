import { Redis } from '@upstash/redis';

// Initialized from UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars
export const redis = Redis.fromEnv();

// Cache key prefixes
export const CACHE_KEYS = {
  KTC_1QB: 'values:ktc:1qb',
  KTC_SF: 'values:ktc:sf',
  FANTASYCALC_1QB: 'values:fantasycalc:1qb',
  FANTASYCALC_SF: 'values:fantasycalc:sf',
  DYNASTYPROCESS_1QB: 'values:dynastyprocess:1qb',
  DYNASTYPROCESS_SF: 'values:dynastyprocess:sf',
  LAST_REFRESH: 'values:last_refresh',
} as const;

// TTL: 25 hours (gives buffer for daily refresh)
export const VALUES_TTL_SECONDS = 25 * 60 * 60;
