import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis, CACHE_KEYS, VALUES_TTL_SECONDS } from '../_lib/redis.js';

// Normalize player names for matching across sources
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build name -> sleeper_id map from Sleeper player database
async function buildSleeperNameMap(): Promise<Map<string, string>> {
  const res = await fetch('https://api.sleeper.app/v1/players/nfl');
  if (!res.ok) throw new Error('Failed to fetch Sleeper players for name mapping');

  const players = await res.json() as Record<string, {
    full_name?: string;
    first_name?: string;
    last_name?: string;
    active?: boolean;
  }>;

  const nameMap = new Map<string, string>();

  for (const [sleeperId, player] of Object.entries(players)) {
    const name = player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (!nameMap.has(key) || player.active) {
      nameMap.set(key, sleeperId);
    }
  }

  return nameMap;
}

// --- KeepTradeCut ---
// No public API — scrape rankings page which embeds player data as JS variable
async function fetchKTC(nameMap: Map<string, string>): Promise<{ oneqb: Record<string, number>; sf: Record<string, number> }> {
  const res = await fetch('https://keeptradecut.com/dynasty-rankings');
  if (!res.ok) throw new Error(`Failed to fetch KTC page: ${res.status}`);

  const html = await res.text();
  const match = html.match(/var\s+playersArray\s*=\s*(\[.*?\]);\s*var/s);
  if (!match) throw new Error('Could not extract playersArray from KTC HTML');

  const players = JSON.parse(match[1]) as Array<{
    playerName: string;
    oneQBValues: { value: number };
    superflexValues: { value: number };
  }>;

  const oneqb: Record<string, number> = {};
  const sf: Record<string, number> = {};

  for (const p of players) {
    const key = normalizeName(p.playerName);
    const sleeperId = nameMap.get(key);
    if (sleeperId) {
      oneqb[sleeperId] = p.oneQBValues.value;
      sf[sleeperId] = p.superflexValues.value;
    }
  }

  return { oneqb, sf };
}

// --- FantasyCalc ---
async function fetchFantasyCalc(): Promise<{ oneqb: Record<string, number>; sf: Record<string, number> }> {
  const [oneqbRes, sfRes] = await Promise.all([
    fetch('https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1'),
    fetch('https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1'),
  ]);

  if (!oneqbRes.ok || !sfRes.ok) {
    throw new Error('Failed to fetch FantasyCalc values');
  }

  const oneqbData = await oneqbRes.json() as Array<{ player: { sleeperId: string }; value: number }>;
  const sfData = await sfRes.json() as Array<{ player: { sleeperId: string }; value: number }>;

  const oneqb: Record<string, number> = {};
  const sf: Record<string, number> = {};

  for (const p of oneqbData) {
    if (p.player.sleeperId) {
      oneqb[p.player.sleeperId] = p.value;
    }
  }
  for (const p of sfData) {
    if (p.player.sleeperId) {
      sf[p.player.sleeperId] = p.value;
    }
  }

  return { oneqb, sf };
}

// --- DynastyProcess ---
// CSV columns: player, pos, team, age, draft_year, ecr_1qb, ecr_2qb, ecr_pos, value_1qb, value_2qb, scrape_date, fp_id
// No sleeper_id — match by player name
async function fetchDynastyProcess(nameMap: Map<string, string>): Promise<{ oneqb: Record<string, number>; sf: Record<string, number> }> {
  const res = await fetch('https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv');
  if (!res.ok) throw new Error('Failed to fetch DynastyProcess values');

  const csv = await res.text();
  const lines = csv.split('\n');
  const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());

  const playerIdx = headers.indexOf('player');
  const oneqbIdx = headers.indexOf('value_1qb');
  const sfIdx = headers.indexOf('value_2qb');

  if (playerIdx === -1 || oneqbIdx === -1 || sfIdx === -1) {
    throw new Error(`DynastyProcess CSV missing expected columns. Found: ${headers.join(', ')}`);
  }

  const oneqb: Record<string, number> = {};
  const sf: Record<string, number> = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.replace(/"/g, '').trim());
    const playerName = cols[playerIdx];
    if (!playerName) continue;

    const val1qb = parseFloat(cols[oneqbIdx]);
    const val2qb = parseFloat(cols[sfIdx]);

    const key = normalizeName(playerName);
    const sleeperId = nameMap.get(key);
    if (!sleeperId) continue;

    if (!isNaN(val1qb)) oneqb[sleeperId] = val1qb;
    if (!isNaN(val2qb)) sf[sleeperId] = val2qb;
  }

  return { oneqb, sf };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Fetch Sleeper player DB first — needed for name matching by KTC and DynastyProcess
    const nameMap = await buildSleeperNameMap();

    const [ktc, fantasycalc, dynastyprocess] = await Promise.allSettled([
      fetchKTC(nameMap),
      fetchFantasyCalc(),
      fetchDynastyProcess(nameMap),
    ]);

    const results: string[] = [];
    results.push(`Name map: ${nameMap.size} Sleeper players`);

    if (ktc.status === 'fulfilled') {
      await Promise.all([
        redis.set(CACHE_KEYS.KTC_1QB, ktc.value.oneqb, { ex: VALUES_TTL_SECONDS }),
        redis.set(CACHE_KEYS.KTC_SF, ktc.value.sf, { ex: VALUES_TTL_SECONDS }),
      ]);
      results.push(`KTC: ${Object.keys(ktc.value.oneqb).length} players`);
    } else {
      results.push(`KTC: FAILED — ${ktc.reason}`);
    }

    if (fantasycalc.status === 'fulfilled') {
      await Promise.all([
        redis.set(CACHE_KEYS.FANTASYCALC_1QB, fantasycalc.value.oneqb, { ex: VALUES_TTL_SECONDS }),
        redis.set(CACHE_KEYS.FANTASYCALC_SF, fantasycalc.value.sf, { ex: VALUES_TTL_SECONDS }),
      ]);
      results.push(`FantasyCalc: ${Object.keys(fantasycalc.value.oneqb).length} players`);
    } else {
      results.push(`FantasyCalc: FAILED — ${fantasycalc.reason}`);
    }

    if (dynastyprocess.status === 'fulfilled') {
      await Promise.all([
        redis.set(CACHE_KEYS.DYNASTYPROCESS_1QB, dynastyprocess.value.oneqb, { ex: VALUES_TTL_SECONDS }),
        redis.set(CACHE_KEYS.DYNASTYPROCESS_SF, dynastyprocess.value.sf, { ex: VALUES_TTL_SECONDS }),
      ]);
      results.push(`DynastyProcess: ${Object.keys(dynastyprocess.value.oneqb).length} players`);
    } else {
      results.push(`DynastyProcess: FAILED — ${dynastyprocess.reason}`);
    }

    await redis.set(CACHE_KEYS.LAST_REFRESH, new Date().toISOString(), { ex: VALUES_TTL_SECONDS });

    return res.status(200).json({ status: 'ok', results });
  } catch (error) {
    return res.status(500).json({ error: 'Cron job failed', details: String(error) });
  }
}
