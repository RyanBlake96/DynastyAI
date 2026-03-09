# Dynasty Fantasy Football Manager

## Project Overview

A web-based tool that helps dynasty fantasy football managers analyse their Sleeper league, evaluate rosters, and make smarter decisions. No user accounts — enter a Sleeper username or league ID and get instant results.

### Core Features
- League power rankings (overall + positional) using three value sources
- Competitive tier classification (Strong Contender / Contender / Fringe Playoff / Rebuilder)
- Roster construction analysis (starting lineup projection, depth grades, efficiency flags)
- Hold/trade/sell advice per player, tailored to team window
- Sell window alerts for players at peak value
- Mutually beneficial trade finder with explanations
- Manual trade evaluator
- Player pages with form (using league scoring), news, and league context
- Trade history analysis with value grades
- Strength of schedule
- Rookie draft strategy (personalised targets, pick trade suggestions)
- League format sensitivity notes (TE premium, PPR variants, roster size)
- Dark/light mode toggle

### Tech Stack
- **Frontend:** React (Vite) + TypeScript + Tailwind CSS
- **Backend:** Vercel Serverless Functions
- **Cache:** Vercel KV (player values from three sources, refreshed daily)
- **Hosting:** Vercel (everything in one platform)
- **External APIs:**
  - Sleeper API (https://docs.sleeper.com/) — leagues, rosters, users, picks, matchups, transactions, player data
  - KeepTradeCut — dynasty player trade values (1QB + SF)
  - FantasyCalc — dynasty player trade values (1QB + SF)
  - DynastyProcess — dynasty player trade values (1QB + SF)

### League Format Support
- Auto-detect 1QB vs Superflex from Sleeper league settings
- Use correct value set (1QB or SF) from all three sources accordingly
- Flag TE premium, PPR variants, and non-standard roster sizes with qualitative notes

---

## Project Structure

```
/src
  /components    — Reusable UI components (LeagueLayout shared header/nav)
  /pages         — Page-level components (Landing, Dashboard, TeamDetail, PlayerDetail, TradeFinder, RookieDraft, LeagueRankings, Transactions, DraftPicks)
  /hooks         — Custom React hooks
  /utils         — Helper functions, algorithms, constants
  /types         — TypeScript type definitions
  /api           — API client functions (calling our serverless functions)
/api             — Vercel serverless functions
  /sleeper       — Sleeper API proxy routes
  /values        — Player value endpoints (KTC, FantasyCalc, DynastyProcess)
  /cron          — Daily value refresh cron job
```

---

## Design Direction
- Clean, modern sports analytics dashboard (ESPN / Sleeper aesthetic)
- Desktop-first, fully responsive on mobile
- Light background default with dark mode toggle
- Accent colours: green (positive), red (negative), blue/grey (neutral)
- Heavy use of tables, charts (bar, radar, line, heatmap), and comparison views
- All player names are clickable links to their player page

---

## Algorithms & Logic

### Competitive Tier Classification
Based on: starting lineup value (league rank), average starter age, bench depth, draft capital (next 2 years), recent season finish, strength of schedule.
- **Strong Contender:** Top 20% starters, young core, adequate+ depth
- **Contender:** Top 40% starters, under 27 avg age
- **Fringe Playoff:** Middle 30%, any age, schedule factors in
- **Rebuilder:** Bottom 30% starters, aging core or heavy draft capital
Thresholds are configurable in code.

### Hold / Trade / Sell Recommendations
Factors: player age + trajectory, team tier, positional need, injury history, contract status, roster construction surplus, value across sources (overvalued = sell, undervalued = hold/buy).

### Sell Window Triggers
- Career-best season at age 27+
- Final contract year
- Trade value significantly above historical norms
- RB age decline curve (28+)

### Roster Construction Score
- Auto-slot optimal starting lineup based on league roster settings
- Starter vs bench drop-off per position
- Value efficiency (flag trapped value at surplus positions)
- Positional depth grades: Strong / Adequate / Weak

### Trade Finder
- Evaluate all team pairs
- Match positional surpluses to needs, respecting competitive tiers
- Construct fair packages (balanced across all three value sources)
- Generate plain-English explanations for both sides

### Rookie Draft Strategy
- Pull rookie rankings from available sources
- Map recommended rookies to team's owned draft slots
- Suggest pick trades if current picks don't align with needs
- Flag picks worth trading away if aligned with surplus positions

---

## Build Phases & Progress

### Phase 1 — Foundation & Data ✅
- [x] Project scaffolding (Vite, Tailwind, Vercel deploy)
- [x] Serverless functions + Upstash Redis setup
- [x] Sleeper API proxy (league, rosters, users, drafts, transactions, traded picks, matchups, players, state)
- [x] Landing page — username/league ID lookup, dynasty league filter, auto-navigate
- [x] Dashboard — standings, roster composition, nav links
- [x] Team Detail page — starters, bench, taxi, IR with player links
- [x] Transactions page — trades, waivers, free agents with filters
- [x] Draft Picks page — pick ownership by team/round, actual + projected positions
- [x] usePlayers hook with module-level caching (~10MB player DB)
- [x] useLeagueData hook with re-sync/cache-bust support
- **Milestone 1:** App connects to any Sleeper league with full data and core pages

### Phase 2 — Player Values & Power Rankings ✅
- [x] Provision Upstash Redis (Vercel Marketplace) + set CRON_SECRET env var
- [x] Player value ingestion — KeepTradeCut (1QB + SF) — scraped from dynasty-rankings HTML, name-matched to Sleeper IDs
- [x] Player value ingestion — FantasyCalc (1QB + SF) — direct API with native Sleeper IDs
- [x] Player value ingestion — DynastyProcess (1QB + SF) — CSV parsed, name-matched to Sleeper IDs
- [x] Daily cron refresh job verified working (6am UTC, 60s timeout)
- [x] usePlayerValues hook with module-level caching by league type
- [x] Power rankings algorithm (total, starter, bench, QB/RB/WR/TE positional values)
- [x] Power rankings Dashboard UI — stacked positional bar chart, starter/bench split, toggle to standings
- [x] Competitive tier classification (Strong Contender / Contender / Fringe / Rebuilder)
- **Milestone 2:** League dashboard with power rankings, positional breakdowns, and competitive tiers

### Phase 3 — Player Detail & Roster Analysis ✅
- [x] Player detail page — bio, values across sources, league context
- [x] Player detail page — hold/trade/sell recommendation
- [x] Sell window alerts (age curve, peak value detection)
- [x] Starting lineup projection (auto-slot optimal starters from roster settings) *(completed in Phase 2)*
- [x] Roster construction scoring + positional depth grades
- [x] League format sensitivity notes (TE premium, PPR variant, roster size)
- **Milestone 3:** Player pages with values + advice, roster analysis with depth grades

### Phase 3.5 — Value Normalisation, Landing Page Rankings & Smarter Insights ✅
- [x] Normalise player values across sources (min-max normalisation to 0–10,000 common scale)
- [x] Landing page — show site-wide highest valued players (independent of any league)
- [x] Landing page — toggle for 1QB vs SF league type
- [x] Landing page — positional rankings view (overall + by QB/RB/WR/TE filter tabs)
- [x] Landing page — retain username/league ID input; after league selected, show values tuned to league settings
- [x] Team Detail insights — contender: identify weakest roster position as a need
- [x] Team Detail insights — rebuilder: surface highest-value players with Trade/Sell recommendation
- [x] Team Detail — player rows show value and league-wide positional rank (e.g. QB3, WR12)
- [x] Dashboard standings — added Max PF column, removed Roster/Composition columns, sortable column headers
- [x] Value formatting — full numbers with comma separators (no k suffix), rounded to whole numbers
- [x] League-scoped Player Rankings page (`/league/:leagueId/rankings`) — all players ranked by normalised value with owner info, positional rank, position + ownership filters (All/Rostered/Free Agents)
- [x] Shared league header layout (LeagueLayout) — persistent nav bar across all league sub-pages using React Router nested routes + Outlet context
- **Milestone 3.5:** Normalised values, public player rankings on landing page, team-aware roster insights, league player rankings with free agent filter

### Phase 4 — Trade Tools ✅
- [x] Trade evaluator — manual trade input + value comparison across sources
- [x] Trade evaluator — fairness score + explanation
- [x] Trade finder — algorithm (match surpluses to needs across team pairs)
- [x] Trade finder — value balancing + plain-English explanations
- [x] Trade finder — UI (suggested trades per team)
- [x] Trade history analysis — grade past trades by value change
- **Milestone 4:** Trade evaluator, automated trade finder, and trade history grading live

### Phase 5 — Rookie Draft Strategy ✅
- [x] Rookie rankings ingestion — uses existing value sources (KTC, FantasyCalc, DynastyProcess) filtered to years_exp === 0 rookies
- [x] Draft strategy — map recommended rookies to owned pick slots with positional fit scoring
- [x] Draft strategy — pick trade suggestions (trade up/down/sell based on team tier and needs)
- [x] Draft strategy — UI with two tabs: Draft Strategy (per-team cards with pick targets) and Rookie Rankings (sortable table with position filters)
- **Milestone 5:** Rookie draft strategy with personalised targets and pick trade suggestions

### Phase 5.5 — Visual Polish & Player News ✅
- [x] Dark mode toggle
- [x] Data visualisation pass (charts, heatmaps, radar)
- [x] Player news integration
- **Milestone 5.5:** Dark/light mode, enhanced data visualisations, and player news live

### Phase 6 — In-Season Features (deferred until season starts)
- [ ] Matchups display (weekly head-to-head results)
- [ ] Strength of schedule
- [ ] Player current form (league scoring stats)

### Phase 7 — Polish & Launch
- [ ] Mobile responsiveness
- [ ] Error handling + error boundaries
- [ ] Final testing + launch
- **Milestone 7:** App complete, polished, and live

---

## Session Log

### Day 1 — 2026-03-05
**Status:** Complete
**Completed:**
- Scaffolded Vite + React + TypeScript project
- Installed and configured Tailwind CSS v4 (via @tailwindcss/vite plugin)
- Set up React Router with all planned routes (Landing, Dashboard, TeamDetail, PlayerDetail, TradeFinder, RookieDraft)
- Created full project folder structure (/src/components, pages, hooks, utils, types, api + /api serverless stubs)
- Defined core TypeScript types (SleeperUser, SleeperLeague, SleeperRoster, SleeperPlayer, PlayerValue, LeagueType, CompetitiveTier)
- Created client-side Sleeper API module (src/api/sleeper.ts)
- Created stub Vercel serverless functions for /api/sleeper, /api/values, /api/cron
- Configured vercel.json with SPA rewrites and API routing
- Installed Vercel CLI as local dev dependency
- Initialized git repo
- Production build passes cleanly
**Issues:**
- npm install -g is blocked by permissions on this machine; Vercel CLI installed locally instead (use `npx vercel` to run)
- @vercel/node has 27 npm audit vulnerabilities (inherited transitive deps, not actionable) — monitor on future updates
- Vercel deploy not yet run (needs user to authenticate via `npx vercel` in terminal)
**Tomorrow:** Day 2 — Serverless functions + Vercel KV setup. Build out the /api/sleeper proxy routes and configure Vercel KV for player value caching.

### Day 2 — 2026-03-09
**Status:** Complete
**Completed:**
- Built Sleeper API proxy as 3 consolidated serverless functions (query-param routing):
  - /api/sleeper/user?id=<username_or_id> — user lookup
  - /api/sleeper/user?id=<user_id>&resource=leagues&sport=nfl&season=2025 — user's leagues
  - /api/sleeper/league?id=<league_id> — league details
  - /api/sleeper/league?id=<league_id>&resource=rosters|users|drafts|transactions|matchups|traded_picks — league sub-resources
  - /api/sleeper/league?id=<league_id>&resource=matchups&week=<week> — weekly matchups
  - /api/sleeper/league?id=<league_id>&resource=transactions&round=<round> — transactions by round
  - /api/sleeper/players — full NFL player database
- All proxy routes include Cache-Control headers (short TTL for live data, long TTL for static data)
- Replaced deprecated @vercel/kv with @upstash/redis
- Created shared Redis client module (api/_lib/redis.ts) with cache key constants and TTL config
- Built /api/values endpoint — serves cached player values by league type (1qb/sf)
- Built /api/cron/refresh-values endpoint — daily cron that fetches from KTC, FantasyCalc, and DynastyProcess (1QB + SF from each), stores in Redis
- Configured cron schedule in vercel.json (6am UTC daily)
- Cron endpoint protected with CRON_SECRET bearer token auth
- Updated client-side API modules (src/api/sleeper.ts, src/api/values.ts) with typed functions matching all new routes
- Deployed to Vercel (preview + production) — Sleeper proxy endpoints verified working against live API
- Disabled Vercel Authentication on deployment protection settings
- Total serverless functions: 5 (well under Hobby plan limit of 12)
**Issues:**
- Upstash Redis not yet provisioned — add Upstash Redis integration from Vercel Marketplace (auto-sets UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars)
- CRON_SECRET env var must be set in Vercel project settings (used to authenticate the cron endpoint)
- KTC, FantasyCalc, and DynastyProcess API response shapes are based on known formats — may need adjustment if APIs have changed
- DynastyProcess CSV parsing assumes specific column names (sleeper_id, value_1qb, value_2qb) — will break if schema changes
**Tomorrow:** Day 3 — Sleeper API: league fetching by username + league ID. Wire up the Landing page to call the proxy, resolve username to user ID, fetch leagues, and navigate to the selected league dashboard.

### Day 3 — 2026-03-09
**Status:** Complete
**Completed:**
- Rewrote Landing page with full Sleeper API integration:
  - Numeric input (10+ digits) tried as league ID first, falls back to username
  - Username resolves to user via proxy, then fetches dynasty leagues (filtered by settings.type === 2)
  - Single dynasty league auto-navigates to Dashboard
  - Multiple leagues shows selector with name, season, team count, SF badge
  - Loading and error states with clear messaging
- Built useLeagueData hook (src/hooks/useLeagueData.ts):
  - Fetches league, rosters, and users in parallel via Promise.all
  - Returns typed LeagueContext with auto-detected league type
  - Handles loading/ready/error states with cleanup on unmount
- Created league type detection utility (src/utils/leagueType.ts):
  - Checks roster_positions for SUPER_FLEX to determine 1QB vs SF
- Wired up Dashboard page with real Sleeper data:
  - Header shows league name, season, team count, format (1QB/SF), PPR variant, TE premium
  - Standings table sorted by wins then points for, with team name links to TeamDetail
  - Nav links to Trade Finder and Rookie Draft pages
  - Loading spinner and error state with back-to-home link
- Fixed Vercel serverless function TS errors: added .js extensions to relative imports (required by nodenext module resolution)
- Deployed to production: https://dynasty-ai.vercel.app
**Issues:**
- Sleeper league settings.type === 2 is used to filter dynasty leagues — need to verify this is the correct value across all league types
- Dashboard standings show W/L/PF/PA but no positional breakdown yet (Phase 2)
- No error boundary wrapping the app yet — unhandled errors will show blank screen
**Tomorrow:** Day 4 — Sleeper API: rosters + users. Enhance Dashboard with roster detail, expand type definitions for full roster/user data.

### Day 4 — 2026-03-09
**Status:** Complete
**Completed:**
- Created usePlayers hook (src/hooks/usePlayers.ts) with module-level caching:
  - Fetches full Sleeper player database (~10MB) once, cached in memory across all components
  - Exposes getPlayerName() and getPlayerInfo() helpers for resolving player IDs to names/positions/teams/ages
- Built full TeamDetail page (src/pages/TeamDetail.tsx):
  - Sections for Starters, Bench, Taxi Squad, and IR
  - Each player row shows position badge (colour-coded), name (linked to player page), team, age
  - Bench/taxi/IR sorted by position priority (QB > RB > WR > TE > K > DEF)
  - Header shows team name, record, points for, total player count
  - Back link to league dashboard
- Enhanced Dashboard standings table:
  - Added roster composition column (e.g. "2QB · 5RB · 6WR · 3TE") per team
  - Combined W/L/T into single Record column
  - Composition column loads progressively after player data fetches
- Added Re-sync button to Dashboard and TeamDetail pages:
  - Cache-busting via timestamp query param to bypass CDN cache
  - Separate `refreshing` boolean state to avoid TypeScript narrowing conflict with status
- Fixed hardcoded season bug — app was defaulting to '2025' season:
  - Created new serverless function api/sleeper/state.ts to proxy Sleeper's /state/nfl endpoint
  - Added fetchNflState() to src/api/sleeper.ts
  - Updated fetchLeaguesByUserId() to dynamically fetch current league_season instead of hardcoding '2025'
  - Now correctly resolves to 2026 season (or whatever Sleeper reports as current)
- Deployed to production: https://dynasty-ai.vercel.app
**Issues:**
- Player database is ~10MB — loads fine on broadband but could be slow on mobile; may want to slim this down or lazy-load in future
- No error boundary yet — player fetch failure silently degrades (composition column just doesn't show)
- Total serverless functions now 6 (added state.ts) — still well under Hobby plan limit of 12
**Tomorrow:** Day 5 — Sleeper API: draft picks + transactions. Build draft pick display and transaction history into the dashboard or team detail page.

### Day 5 — 2026-03-09
**Status:** Complete
**Completed:**
- Added TypeScript types for drafts, draft picks, transactions, and traded picks (SleeperDraft, SleeperDraftPick, SleeperTransaction, SleeperTradedPick)
- Added draft_picks resource to api/sleeper/league.ts serverless proxy (routes /draft/{draft_id}/picks via query param)
- Added fetchDraftPicks() and typed all existing transaction/draft API functions in src/api/sleeper.ts
- Built Transactions page (src/pages/Transactions.tsx):
  - Fetches transactions across all 18 weeks in parallel
  - Filter buttons: All, Trades, Waivers, Free Agents
  - Trade cards show both sides with players received and draft picks received
  - Waiver/FA cards show player adds and drops
  - All player names linked to player pages, team names linked to team pages
  - Timestamp display for each transaction
- Built Draft Picks page (src/pages/DraftPicks.tsx):
  - Fetches traded picks and builds full pick ownership map for current + next 2 seasons
  - Two view modes: By Team and By Round
  - By Team: each team shows their owned picks per season, with "via TeamName" for acquired picks
  - By Round: table view per season showing original owner vs current owner, traded picks highlighted
  - Draft rounds auto-detected from league settings
- Added routes in App.tsx: /league/:leagueId/transactions and /league/:leagueId/picks
- Added nav links (Transactions, Draft Picks) to Dashboard header
- Deployed to production: https://dynasty-ai.vercel.app
**Issues:**
- Transactions page fetches 18 API calls in parallel on load — works but could be slow on first visit before CDN caches
- draft_rounds setting may not be present in all leagues — falls back to 4 rounds
- No error boundary yet
**Tomorrow:** Day 6 — Sleeper API: matchups + player data. Build matchup display and begin enhancing player detail page with real data.

### Day 5 addendum — 2026-03-09
**Status:** Complete
**Completed:**
- Enhanced Draft Picks page with pick position labels (e.g. 1.03, 2.07):
  - Completed drafts: uses actual draft pick data for exact positions
  - Pre-draft with set order: uses `slot_to_roster_id` or `draft_order` from Sleeper draft object
  - Future/unknown: projects from reverse standings with `~` prefix
- Added `slot_to_roster_id` field to SleeperDraft type
- Refactored draft order resolution: `getDraftSlotOrder()` prefers `slot_to_roster_id` over `draft_order` (user_id-based)
- Fixed race condition: pre-draft order computation moved from useEffect to render phase (data was null in effect closure)
- Debugged draft order with real league data (league ID: 1312026783058505728):
  - `slot_to_roster_id` is null for pre_draft status drafts — not populated until draft starts
  - `draft_order` maps user_id -> slot but excludes new owners who replaced previous managers
  - Fix: after mapping `draft_order` by user_id, compute missing slots (1..N minus assigned) and pair with unmatched rosters
  - For single ownership change (1 missing slot, 1 unmatched roster), this is deterministic
  - For multiple ownership changes, assignment is best-effort (sorted by roster_id and slot number)
- Deployed to production: https://dynasty-ai.vercel.app

### Day 6 — 2026-03-09
**Status:** Complete
**Completed:**
- Reprioritized build phases for offseason focus (trades, rookies, draft over matchups/SOS)
- Provisioned Upstash Redis via Vercel Marketplace, set CRON_SECRET env var
- Fixed player value ingestion for all 3 sources:
  - KTC: no public API — rewrote to scrape dynasty-rankings HTML page, extract embedded `playersArray` JS variable (both 1QB + SF values in one fetch)
  - FantasyCalc: already working with native Sleeper IDs (451 players)
  - DynastyProcess: CSV has no `sleeper_id` column — switched to `player` name column + name matching; fixed quoted CSV headers/values
  - Both KTC and DynastyProcess now use a Sleeper player name map (~11k players) for ID resolution via `normalizeName()` (strips suffixes, punctuation, case)
- Set cron function maxDuration to 60s in vercel.json (fetches ~10MB Sleeper player DB + 3 external sources)
- Built `usePlayerValues` hook (src/hooks/usePlayerValues.ts) with module-level cache by league type
- Built power rankings utility (src/utils/powerRankings.ts) — computes total, starter, bench, and positional (QB/RB/WR/TE) values per roster
- Rewrote Dashboard with two view modes:
  - Power Rankings (default): cards ranked by total roster value, stacked positional bar chart (QB red, RB blue, WR green, TE orange), starter/bench split
  - Standings: original table view with new Value column
- Fixed LeagueType mapping: app uses `'superflex'`, API expects `'sf'` — mapped in fetchPlayerValues()
- Deployed to production: https://dynasty-ai.vercel.app
**Issues:**
- Name matching may miss edge cases (players with unusual name spellings across sources)
- KTC HTML scraping is fragile — will break if KTC changes their page structure
- KTC includes draft picks as position "RDP" (e.g. "2027 Early 1st") — not currently mapped to anything
**Tomorrow:** Phase 3 — Player Detail page or Trade Evaluator

### Day 7 — 2026-03-09
**Status:** Complete
**Completed:**
- Built competitive tier classification algorithm (src/utils/powerRankings.ts):
  - Weighted composite score: 60% starter value percentile, 15% youth bonus (avg starter age), 15% win percentage, 10% bench depth ratio
  - Four tiers: Strong Contender (79+), Contender (60+), Fringe Playoff (50+), Rebuilder (<50)
  - Max 4 teams per tier (or ceil(n/3) for smaller leagues) — overflow bumps down to next tier
  - Average starter age computed from Sleeper player data for each roster
- Built optimal starting lineup projection (src/utils/powerRankings.ts):
  - `computeOptimalStarters()` auto-slots best lineup from league's `roster_positions`
  - Greedy algorithm: fills most restrictive slots first (QB before FLEX before SUPER_FLEX)
  - Handles all slot types: QB, RB, WR, TE, FLEX, SUPER_FLEX, REC_FLEX, WRRB_FLEX, IDP_FLEX
  - Used for starter value calculation and average starter age (not the owner's current lineup)
- Added `avgStarterAge`, `tier`, and `tierScore` fields to RosterRanking interface
- Updated Dashboard Power Rankings view:
  - Colour-coded tier badges with score next to each team name (e.g. "Contender (62)")
  - Average starter age display per team
- Updated Dashboard Standings view:
  - New Tier column with colour-coded badges
- Phase 2 complete — all items checked off
- Iterated on tier thresholds with user testing (65/48/32 → 80/55/40 → 79/60/50)
**Issues:**
- Age data depends on Sleeper player DB accuracy — some players may have null ages
- SOS not factored in yet (deferred to Phase 6 in-season features)
**Tomorrow:** Phase 3 — Player Detail page with values, hold/trade/sell recommendations

### Day 8 — 2026-03-09
**Status:** Complete
**Completed:**
- Changed player route from `/player/:playerId` to `/league/:leagueId/player/:playerId` for league context
- Updated all player links across TeamDetail, Transactions pages to include leagueId
- Built Player Detail page (src/pages/PlayerDetail.tsx):
  - Bio section: position badge, name, team, age, years exp, status, average trade value
  - Dynasty Trade Values: horizontal bar chart comparing KTC, FantasyCalc, DynastyProcess with average
  - League positional rank (e.g. "Ranked #3 WR in this league")
  - League Context: rostered by (linked), roster slot, team tier badge, power rank
  - Positional depth chart for owner's team with values
  - Free agent notice for unrostered players
- Built hold/trade/sell recommendation algorithm (src/utils/recommendations.ts):
  - Scoring based on: age trajectory (position-specific peak/decline), team tier alignment, positional surplus, value divergence across sources, league positional rank, IR status
  - Four levels: Strong Hold, Hold, Trade, Sell — with colour-coded card and bullet-point reasons
- Built sell window alerts (src/utils/recommendations.ts):
  - Triggers: RB 28+ with high value, any position at/past decline age with elite value, final peak year, large value spread across sources
  - Displayed as amber alert banner above the recommendation card
- Built roster construction scoring (src/utils/rosterConstruction.ts):
  - Positional depth grades (Strong/Adequate/Weak) based on league-wide position averages
  - Starter/bench value split with bench percentage
  - Efficiency flags: positional surplus alerts, trade opportunities (strong→weak), bench ratio warnings
  - Overall roster grade
  - Displayed as analysis card at top of Team Detail page
- Built league format sensitivity notes (src/utils/formatNotes.ts):
  - Detects and explains: TE premium, PPR variants, Superflex, deep/shallow rosters, taxi squad, multiple flex slots, IDP
  - Displayed on Dashboard (all notes) and Player Detail (position-relevant notes)
- Phase 3 complete — all items checked off
**Issues:**
- Sell window alerts use static value thresholds (2000/3000/4000) — may need tuning per source
- Roster construction grading depends on league-wide averages — small leagues may have skewed grades
- Format notes are qualitative only — no quantitative value adjustments yet
**Tomorrow:** Phase 4 — Trade Tools (evaluator, finder, history grading)

### Day 9 — 2026-03-09
**Status:** Complete
**Completed:**
- Built value normalisation utility (src/utils/normalizeValues.ts):
  - Min-max normalisation per source to 0–10,000 common scale
  - `computeNormalizationStats()` computes min/max per source, cached alongside values
  - `getNormalizedPlayerValue()` averages normalised values across available sources
  - `getNormalizedBreakdown()` returns per-source normalised + raw values
- Rewrote `usePlayerValues` hook to integrate normalisation:
  - `getPlayerValue()` now returns normalised values (0–10,000 scale)
  - `getPlayerValueBreakdown()` returns both normalised and raw values per source
  - Normalisation stats computed once on fetch and cached at module level
- Rewrote Landing page with player rankings:
  - Dynasty Player Rankings table below the username/league ID input
  - 1QB / Superflex toggle (defaults to Superflex)
  - Position filter tabs: All, QB, RB, WR, TE
  - Top 100 players displayed with rank, position badge, name, team, age, value
  - Builds ranked list via useMemo across all three value sources
- Added tier-aware insights to Team Detail (src/pages/TeamDetail.tsx):
  - Roster Construction card now shows team's competitive tier badge
  - Contenders: "Contender Needs" section identifies weakest position(s) with upgrade advice
  - Rebuilders: "Sell Targets" section lists up to 5 highest-value Trade/Sell players with links
  - Fringe Playoff: highlights weakest position group
  - Uses `computePowerRankings()` and `computeRecommendation()` for tier + recommendation data
- Added player value and positional rank columns to Team Detail roster tables:
  - Each player row shows normalised value and league-wide positional rank (e.g. QB3, WR12)
  - Computed from all rosters in the league, sorted by value per position
- Updated Dashboard standings table:
  - Added Max PF column (Sleeper's `ppts` — potential points / best possible score)
  - Removed Roster and Composition columns
  - Sortable column headers: click to sort by Record, PF, PA, Max PF, Value, Tier; click again to toggle asc/desc
  - Sort indicator (▾/▴) displayed on active column
  - Added `ppts` and `ppts_decimal` to SleeperRoster settings type
- Updated value formatting across the entire site:
  - Removed k suffix — all values now show full numbers with comma separators (e.g. 8,472 instead of 8.5k)
  - All values rounded to whole numbers consistently
  - Updated formatValue/formatVal in Landing, Dashboard, TeamDetail, PlayerDetail
- Phase 3.5 complete — all items checked off
- Deployed all changes to production: https://dynasty-ai.vercel.app
**Issues:**
- Landing page rankings load the full player values on page load (~500-650 players per source) — fast but could be lazy-loaded if needed
- Tier-aware insights recompute power rankings inside the RosterAnalysisCard — could be memoised or lifted up if performance is a concern
- Max PF (ppts) shows 0.00 during offseason — Sleeper only populates this once matchups are scored
**Tomorrow:** Phase 4 — Trade Tools (evaluator, finder, history grading)

### Day 10 — 2026-03-09
**Status:** Complete
**Completed:**
- Built league-scoped Player Rankings page (src/pages/LeagueRankings.tsx):
  - Uses league's auto-detected type (1QB/SF) for values
  - Builds owner lookup map from all rosters — shows team owner per player
  - Positional rank column (e.g. QB3, WR12) computed across all value sources
  - Position filter tabs: All/QB/RB/WR/TE
  - Ownership filter tabs: All Players / Rostered / Free Agents
  - Top 200 players displayed with links to player detail and team detail pages
  - Free agents shown as "Free Agent" in owner column
- Fixed React Rules of Hooks violation in LeagueRankings:
  - `useMemo` hooks were after early returns, causing "Rendered more hooks" crash
  - Moved all hooks before conditional returns, using `data?.rosters ?? []` for safe defaults
- Built shared LeagueLayout component (src/components/LeagueLayout.tsx):
  - Persistent header with league name, settings, nav links across all league sub-pages
  - Uses React Router nested routes with `<Outlet>` and outlet context
  - `useLeagueLayout()` hook for child pages to access league data, leagueId, refresh, refreshing
  - `NavLink` for active page highlighting (filled pill style)
  - Re-sync button in shared header
  - Nav order: Dashboard, Player Rankings, Transactions, Draft Picks, Trade Finder, Rookie Draft
- Refactored all league sub-pages to use shared layout:
  - Removed individual `<header>` sections and `useLeagueData` calls from Dashboard, TeamDetail, PlayerDetail, Transactions, DraftPicks, LeagueRankings, TradeFinder, RookieDraft
  - All pages now use `useLeagueLayout()` for league data via outlet context
  - Loading/error states for league data handled once in LeagueLayout
  - Updated App.tsx with nested routes under `/league/:leagueId`
- Deployed all changes to production: https://dynasty-ai.vercel.app
**Issues:**
- None encountered — all builds passed cleanly
**Tomorrow:** Phase 4 — Trade Tools (evaluator, finder, history grading)

### Day 11 — 2026-03-09
**Status:** Complete
**Completed:**
- Built Phase 4 — Trade Tools (all 6 items):
- Trade Evaluator utility (src/utils/tradeEvaluator.ts):
  - Evaluates trades with normalised value comparison across all 3 sources
  - Fairness grading: Even (≤10%), Slight Edge (≤20%), Uneven (≤35%), Lopsided (>35%)
  - Draft pick valuation (estimated values on 0-10,000 scale by round + draft position)
  - Winner determination, age analysis, tier-context explanations
- Trade Evaluator page (src/pages/TradeEvaluator.tsx):
  - Team selector dropdowns, player search within each team's roster
  - Side-by-side trade builder with live value totals
  - Real-time evaluation display: fairness badge, value comparison bars, per-asset breakdown, explanation bullets
  - Route: `/league/:leagueId/trade-eval`
- Trade Finder algorithm (src/utils/tradeFinder.ts):
  - Builds roster profiles with positional values, surplus/need detection (vs league averages)
  - Iterates all team pairs, matches surplus positions to need positions in both directions
  - Constructs balanced trades: selects bench players from surplus positions, adds balancing players if needed
  - Only suggests trades within 30% value balance, filters out trivially small trades
  - Plain-English explanations for each suggestion (who benefits and why)
- Trade Finder page (src/pages/TradeFinder.tsx):
  - Three-tab interface: Trade Finder, Trade Evaluator (links to evaluator page), Trade History
  - Trade Finder: suggested trades with team filter dropdown, tier badges, value balance indicator
  - Trade History: grades past trades by current player values (Won Big/Won/Fair/Lost/Lost Big)
  - Lazy-loads transaction data only when history tab is selected
- Trade History grading (src/utils/tradeHistory.ts):
  - Fetches all completed trades from transactions
  - Grades each side by current value of assets received
  - Grade scale: Won Big (>25% edge), Won (>10%), Fair (≤10%), Lost (>10%), Lost Big (>25%)
- Updated App.tsx with `trade-eval` route and TradeEvaluator import
- Updated LeagueLayout nav: "Trade Finder" → "Trade Tools"
- Fixed Trade Tools nav pill: stays active on both `/trades` and `/trade-eval` pages using `alsoActive` array in NavLinkItem + `useLocation()` matching in LeagueLayout
- Fixed Trade Evaluator "receives" display bug: `evaluateTrade()` parameters are what each side receives, but the UI was passing what each side gives — swapped `sideAPlayers`/`sideBPlayers` in the call so receives labels are correct
- Improved Trade Evaluator player search: shows full team roster dropdown on focus (sorted by value), with type-to-filter — no longer requires 2+ characters to show results
- Added balance suggestions to Trade Evaluator: when trade is uneven, an amber panel shows up to 5 players from the winning side's roster that could be added to balance the trade, with one-click "+ Add" buttons and remaining gap indicators
- Added "Back to Trade Tools" link on the Trade Evaluator page
- Cleaned up duplicate roster lookup in balance suggestion computation
- Deployed all changes to production: https://dynasty-ai.vercel.app
**Issues:**
- Trade finder only matches single-position surplus/need pairs — doesn't handle multi-position package trades
- Draft pick values are estimated (static table by round) — not dynamically adjusted by team strength or draft position
- Trade history grades by current values only — doesn't know the values at time of trade (Sleeper doesn't store historical values)
**Tomorrow:** Phase 5 — Rookie Draft Strategy

### Day 12 — 2026-03-09
**Status:** Complete
**Completed:**
- Built Phase 5 — Rookie Draft Strategy (all 4 items):
- Rookie rankings utility (src/utils/rookieDraft.ts):
  - `buildRookieRankings()` — filters all valued players to years_exp === 0 (incoming rookie class), ranks by normalised value
  - No separate ingestion needed — rookies already exist in KTC, FantasyCalc, DynastyProcess value sources
  - Returns ranked list with player ID, name, position, team, age, value
- Draft strategy algorithm (src/utils/rookieDraft.ts):
  - `buildCurrentSeasonPicks()` — builds pick ownership map for current season using reverse standings projections + traded picks
  - `buildTeamStrategies()` — generates per-team draft strategy with:
    - Positional needs from roster construction analysis (Weak/Adequate grades)
    - Pick-by-pick rookie targets: maps a window of rookies (±2 spots) to each pick slot, scores by positional fit
    - Pick trade suggestions: tier-aware advice (contenders: sell late picks; rebuilders: trade up for R1; fringe: consolidate surplus picks)
    - Plain-English strategy summary tailored to team tier
  - Pick value estimation using same static table as trade evaluator (by round + draft position)
- Rookie Draft page (src/pages/RookieDraft.tsx):
  - Two-tab interface: Draft Strategy (default) and Rookie Rankings
  - Draft Strategy tab: team selector dropdown, expandable team cards showing:
    - Team name, tier badge, pick count, strategy summary
    - Positional need badges (Weak in red, Adequate in yellow)
    - Pick-by-pick targets with recommended rookies (up to 3 per pick), positional fit labels, estimated pick value
    - Acquired picks shown with "via TeamName" notation
    - Pick Trade Ideas section with trade-up/sell suggestions
  - Rookie Rankings tab: sortable table with position filter (All/QB/RB/WR/TE), rank, player name (linked), position badge, team, value, owner status
  - Empty state message when no rookie values are available yet (pre-draft class)
- Deployed to production: https://dynasty-ai.vercel.app
**Issues:**
- Rookie rankings depend on value sources including the incoming class — KTC/FantasyCalc/DynastyProcess may not have rookies valued until January-April of the draft year
- Pick positions are projected from reverse standings (~prefix) — not actual draft order until the draft starts
- years_exp === 0 filter may miss some rookies if Sleeper hasn't updated their database for the new class yet
**Tomorrow:** Phase 6 — In-Season Features (deferred until season starts)

### Day 13 — 2026-03-09
**Status:** Complete
**Completed:**
- Addressed 8 user feedback items on Phase 5 + cross-cutting pick integration:
- Created shared draft pick utility (src/utils/draftPicks.ts):
  - Extracted `buildDraftOrder()`, `getDraftSlotOrder()`, `buildPickOwnership()`, `estimatePickValue()`, `computePicksValue()` from duplicated code
  - `PickOwnership` type with `estimatedValue` field for pick valuation
  - Future picks (>1 year away) show "Round X" label with mid value (no early/mid/late estimation)
  - Current season picks show projected positions (~1.03) or actual positions from completed/pre-draft data
- Rewrote DraftPicks page to use shared utility (same logic as Draft Strategy)
- Rewrote rookieDraft.ts to use shared `PickOwnership` type and import from draftPicks.ts
- Fixed Pick Trade Ideas: `PickTradeSuggestion` changed to embed specific pick labels in reason text
- Pick Trade Ideas are now more selective — only shown when genuinely relevant to team situation
- Draft Picks page moved into Rookie Draft as third tab (Draft Strategy / Rookie Rankings / Draft Picks)
- Removed standalone Draft Picks route from App.tsx and nav link from LeagueLayout
- Added draft pick values to Dashboard power rankings:
  - Purple bar segment for draft capital in stacked value chart
  - Combined total (roster + picks) shown per team
  - Pick values loaded via fetchTradedPicks/fetchDrafts in Dashboard useEffect
- Added draft picks to Trade Evaluator:
  - New "+ Add draft pick..." dropdown in each trade side
  - Shows all picks owned by the selected team with estimated values
  - Picks included in trade evaluation total with PK badge display
  - Selected picks tracked with unique keys (season-round-originalOwner)
- Added draft picks to Team Detail page:
  - New "Draft Picks" section at bottom showing all owned picks grouped by season
  - Each pick shows label, "via TeamName" for acquired picks, and estimated value
  - Total pick value displayed in section header
- Cleaned up unused imports (Outlet, useLocation from RookieDraft; useMemo, computePicksValue, SleeperTradedPick from TeamDetail/Dashboard)
- Deployed to production: https://dynasty-ai.vercel.app
**Issues:**
- Draft pick values are estimated from static table — not sourced from KTC/FantasyCalc/DynastyProcess pick values
- Dashboard, TeamDetail, and TradeEvaluator all independently fetch draft pick data — could be lifted to a shared hook in future
**Tomorrow:** Phase 5.5 — Visual Polish & Player News

### Day 13 addendum — 2026-03-09
**Status:** Complete
**Completed:**
- Enhanced Trade Evaluator balance suggestions to include draft picks:
  - Balance suggestions now use discriminated union type (`BalanceSuggestion`) supporting both players and picks
  - When a trade is unbalanced, picks owned by the winning side (not already in the trade) are considered alongside players
  - All suggestions (players + picks) sorted by closeness to the value gap
  - `handleAddBalanceSuggestion` routes player suggestions to player state and pick suggestions to pick state
  - Pick suggestions render with PK badge and estimated value, player suggestions with position badges and player links
- Updated CLAUDE.md: created Phase 5.5 (Dark mode, Data visualisation, Player news), updated Phases 6 & 7
**Issues:**
- None
**Tomorrow:** Phase 5.5 — Visual Polish & Player News

### Day 14 — 2026-03-09
**Status:** Complete
**Completed:**
- Fixed Trade Evaluator pick value bug: picks losing `pickInRound` and `estimatedValue` during conversion
  - Changed `evaluateTrade()` to accept `PickOwnership[]` directly instead of `SleeperTradedPick[]`
  - Pick 1.11 now correctly shows as "2026 Pick 1.11" with value 4500 (was "2026 Round 1" at 6000)
- Added rookie-based pick values for current season draft picks:
  - `buildRookiePickValueMap()` maps overall pick number to ranked rookie's trade value
  - `applyRookieValues()` post-processing replaces static estimates with actual rookie values
  - Applied in TradeEvaluator, Dashboard, TeamDetail, and RookieDraft via `enrichedPicks` useMemo
- Added future pick discount: `FUTURE_DISCOUNT` record (year 0: 1.0, year 1: 1.0, year 2: 0.85)
- User manually updated PICK_VALUES in draftPicks.ts (1: 6500/5500/4500, etc.)
- Phase 5.5 — Visual Polish & Player News (all 3 items):
  - Dark mode toggle: ThemeProvider with localStorage persistence + system preference detection, `.dark` class on `<html>`, dark mode variants on all 10 page files + LeagueLayout
  - Data visualisation: Recharts library — tier distribution donut chart, league radar chart (top 3 teams), player value bar charts (PlayerDetail), trade comparison bar charts (TradeEvaluator)
  - Player news: ESPN public API integration via `/api/news/player` serverless function (search → athlete ID → news feed), `usePlayerNews` hook, news section on PlayerDetail page, injury details display
- Added `NewsItem` type to types/index.ts, injury fields to `SleeperPlayer`
- Total serverless functions: 7 of 12 (added news/player.ts)
- Deployed to production: https://dynasty-ai.vercel.app
**Issues:**
- ESPN API athlete search may not find all NFL players (especially rookies or practice squad)
- KTC HTML scraping remains fragile
- Recharts adds ~150KB to bundle — acceptable for the visualisation value
**Tomorrow:** Phase 4 remaining items or Phase 6

### Day 15 — 2026-03-09
**Status:** Complete
**Completed:**
- Fixed dark mode standings table: Record, PF, PA, and Max PF columns had black text in dark mode — added `dark:text-gray-300`
- Fixed ESPN player news returning no results: ESPN search API changed response structure — athlete ID is now at `items[0].id` directly instead of nested in `items[0].items[0].links`. Updated `api/news/player.ts` to extract ID from the new location with fallback to old link-based extraction.
- Deployed both fixes to production
**Issues:**
- None
**Tomorrow:** Phase 4 remaining items or Phase 6

<!--
  UPDATE THIS LOG AT THE END OF EVERY SESSION.
  Copy the template below for each new day:

### Day X — [DATE]
**Status:** In progress / Complete
**Completed:** What was built or finished today
**Issues:** Any bugs, blockers, or open questions
**Tomorrow:** What to start with next session
-->

---

## Known Issues & Debt
- Vercel CLI must be run via `nocorrect npx vercel` (global install blocked by OS permissions; zsh autocorrect maps `vercel` to `.vercel` without `nocorrect`)
- npm audit shows 27 vulnerabilities from @vercel/node transitive deps — not actionable, revisit on package updates
- KTC HTML scraping is fragile — extracts `playersArray` JS variable from dynasty-rankings page; will break if KTC changes page structure
- KTC draft picks (position "RDP", e.g. "2027 Early 1st") are not currently mapped to trade values — could be useful for trade evaluator
- Name matching across sources may miss edge cases (unusual spellings, suffixes like Jr./III)
- Total serverless functions: 7 of 12 Hobby plan limit (user, league, players, state, values, cron, news/player)
- Cron function has 60s maxDuration — fetches Sleeper player DB (~10MB) + 3 external sources sequentially

---

## API Documentation
- **Sleeper API docs:** https://docs.sleeper.com/
  - Base URL: `https://api.sleeper.app/v1`
  - Key endpoints used:
    - `GET /user/{username}` — user lookup
    - `GET /user/{user_id}/leagues/{sport}/{season}` — user's leagues
    - `GET /league/{league_id}` — league details
    - `GET /league/{league_id}/rosters` — rosters
    - `GET /league/{league_id}/users` — league users
    - `GET /league/{league_id}/drafts` — drafts for a league
    - `GET /draft/{draft_id}/picks` — picks for a specific draft
    - `GET /league/{league_id}/transactions/{round}` — transactions by round (1–18)
    - `GET /league/{league_id}/traded_picks` — all traded picks
    - `GET /league/{league_id}/matchups/{week}` — weekly matchups
    - `GET /state/{sport}` — current NFL state (season, week, leg)
    - `GET /players/{sport}` — full player database (~10MB)
  - No authentication required
  - Rate limits: undocumented, but be respectful (we proxy through our serverless functions with CDN caching)

---

## Decisions & Notes
- Using Tailwind CSS v4 with the native Vite plugin (@tailwindcss/vite) — no postcss.config or tailwind.config needed
- Vercel CLI installed as local devDependency rather than global (avoids permission issues, version-locked to project)
- React Router v7 for client-side routing with SPA fallback in vercel.json
- Serverless functions use @vercel/node for TypeScript support in /api directory
- Switched from @vercel/kv (deprecated) to @upstash/redis — Vercel now recommends Upstash Redis via Marketplace integration
- Shared Redis client lives in api/_lib/redis.ts (Vercel excludes _lib from routing)
- Cache-Control headers vary by data volatility: 24h for player DB, 5min for league/user data, 1min for rosters/matchups/transactions
- Cron endpoint uses Bearer token auth via CRON_SECRET env var (Vercel auto-sends this for scheduled crons)
- Value refresh uses Promise.allSettled so one source failing doesn't block the others
- Vercel Hobby plan limits to 12 serverless functions — consolidated Sleeper routes into 3 functions using query-param routing instead of file-per-route
- `[...path]` catch-all route syntax is NOT supported for plain Vercel Serverless Functions (Next.js only) — use query params for sub-resource routing
- Vercel Authentication must be disabled in project settings for public access to preview deployments
- Deploy commands: `nocorrect npx vercel` (preview), `nocorrect npx vercel --prod` (production)
- Production URL: https://dynasty-ai.vercel.app
- Vercel serverless functions require `.js` extensions on relative imports (nodenext module resolution) — e.g. `import { redis } from '../_lib/redis.js'`
- Sleeper league type detection: settings.type === 2 identifies dynasty leagues (0 = redraft, 1 = keeper, 2 = dynasty)
- Sleeper player database (~10MB) is cached at module level in usePlayers hook — fetched once, shared across all components that use it
- Position badge colour scheme: QB=red, RB=blue, WR=green, TE=orange, K=purple, DEF=gray
- Season is resolved dynamically via Sleeper's /state/nfl endpoint (league_season field) — never hardcode the season year
- Re-sync uses cache-busting timestamp appended as query param (e.g. `&_t=1709...`) to bypass Vercel CDN cache
- Sleeper draft object has two order fields: `draft_order` (user_id -> slot) and `slot_to_roster_id` (slot -> roster_id). `slot_to_roster_id` is null for pre_draft status — only populated once the draft starts/completes. For pre_draft, must use `draft_order` with user_id -> roster owner_id matching.
- `draft_order` excludes new owners who replaced previous managers mid-season. Fix: after matching by user_id, compute missing slot numbers and assign to unmatched rosters. Deterministic when only 1 ownership change; best-effort for multiple.
- Draft pick position resolution priority: 1) completed draft actual picks, 2) pre_draft slot_to_roster_id (if available), 3) pre_draft draft_order + gap-fill for new owners, 4) projected from reverse standings (~prefix)
- Test league ID for debugging: 1312026783058505728 (Premier Gridiron Dynasty, 12-team SF dynasty, 5-round rookie draft)
- Player value sources and their ID strategies:
  - KeepTradeCut: no public API, scrape HTML from dynasty-rankings page, extract `playersArray` JS variable. Both 1QB (`oneQBValues`) and SF (`superflexValues`) in one fetch. ~500 players. Map to Sleeper IDs by normalized name matching.
  - FantasyCalc: public API at api.fantasycalc.com, returns native `sleeperId` on each player. ~450 players. Separate 1QB and SF endpoints (numQbs=1 vs numQbs=2).
  - DynastyProcess: CSV from GitHub (dynastyprocess/data), columns include `player`, `value_1qb`, `value_2qb`, `fp_id` (no sleeper_id). ~645 players. Map to Sleeper IDs by normalized name matching.
- Name normalization for cross-source matching: lowercase, strip periods/apostrophes, remove suffixes (Jr, Sr, II, III, IV, V), collapse whitespace
- Cron function fetches Sleeper player DB directly from api.sleeper.app (not our proxy) to build name map — runs server-side only
- App LeagueType uses `'superflex'` but API expects `'sf'` — mapped in `fetchPlayerValues()`
- Power rankings use averaged values across all available sources per player; sources with 0/missing values are excluded from the average
- Dashboard defaults to Power Rankings view; Standings view is accessible via toggle
- Vercel build runs `tsc -b` which enforces noUnusedLocals — stricter than `tsc --noEmit` alone; always run `npm run build` locally before deploying
- Competitive tier algorithm: weighted composite score (0-100) from starter value percentile (60%), youth bonus (15%, peaks at age 24, zero at 30+), win percentage (15%), bench depth ratio (10%, healthy = 20-45% of value on bench). Thresholds: Strong Contender ≥79, Contender ≥60, Fringe Playoff ≥50, Rebuilder <50. Max 4 per tier with overflow bump-down. Tunable in `assignTiers()` in src/utils/powerRankings.ts.
- Tier badge colours: Strong Contender = green, Contender = blue, Fringe Playoff = yellow, Rebuilder = red
- Optimal lineup projection: `computeOptimalStarters()` in powerRankings.ts uses greedy slot-filling (most restrictive slots first) to auto-slot the best starting lineup by trade value. SLOT_ELIGIBLE map defines which positions can fill each slot type. Used for starter value and avg age calculations instead of owner's current lineup.
- Starter value in power rankings uses optimal projected lineup, not actual lineup set by owner — reflects true roster strength regardless of lineup decisions
- Player route changed to `/league/:leagueId/player/:playerId` (was `/player/:playerId`) so player pages have full league context for values, ownership, and recommendations
- Hold/trade/sell recommendation scoring: positive = hold, negative = sell. Factors: age trajectory (position-specific), team tier alignment, positional surplus, value divergence across sources, league positional rank, IR status. Thresholds: Strong Hold ≥3, Hold ≥1, Trade ≥-1, Sell <-1.
- Sell window alerts trigger on: RB 28+ with avgValue ≥2000, any position at decline age with avgValue ≥3000, final peak year with avgValue ≥4000, large value spread (max > min × 1.5) with avgValue ≥2000
- Position decline ages: QB=33, RB=27, WR=29, TE=29. Peak ranges: QB=[26,32], RB=[23,26], WR=[24,28], TE=[25,28]
- Roster construction grading: positional depth grades (Strong/Adequate/Weak) based on ≥120%/≥80%/<80% of league-wide average value at each position. Overall grade: Strong = 0 weak + 2+ strong, Weak = 2+ weak, Adequate = everything else
- Format notes utility detects: TE premium (bonus_rec_te > 0), PPR variants (rec=0/0.5/1), Superflex, deep rosters (≥30), shallow rosters (≤18), taxi squad, multiple flex slots (≥3), IDP
- Value normalisation: min-max normalisation per source to 0–10,000 scale. `normalizeValues.ts` computes stats (min/max) per source, then `normalize()` maps each raw value to the common scale. Average of normalised values across available sources = the player's Dynasty AI value. Normalisation stats cached at module level alongside raw values.
- Landing page rankings: `useMemo` iterates all player IDs across all three value sources, filters to QB/RB/WR/TE, computes normalised value via `getPlayerValue()`, sorts descending, displays top 100. Defaults to Superflex; 1QB toggle available. Position filter tabs (All/QB/RB/WR/TE).
- Team Detail tier-aware insights: `buildTierInsights()` function computes power rankings to get the team's tier, then: contenders get weakest position(s) flagged, rebuilders get top 5 Trade/Sell players by value, fringe teams get weakest position highlighted.
- Team Detail player rows include Value column (normalised trade value) and Rank column (league-wide positional rank, e.g. QB3). Computed by building league-wide positional lists from all rosters, sorting by value, and mapping each player to their rank.
- Dashboard standings: sortable column headers with `handleSort()` toggling asc/desc per column. Max PF column uses Sleeper's `ppts`/`ppts_decimal` fields. Removed Roster and Composition columns.
- Sleeper roster `settings.ppts` and `settings.ppts_decimal` = potential points (max PF) — the best possible score if the owner had set the optimal lineup every week. Only populated during/after the season.
- Value formatting: `Math.round(val).toLocaleString()` everywhere — full numbers with comma separators, no k suffix. Consistent across Landing, Dashboard, TeamDetail, PlayerDetail.
- LeagueLayout (src/components/LeagueLayout.tsx): shared header component for all league sub-pages. Fetches league data once via `useLeagueData`, passes it to children via React Router's `useOutletContext`. Exports `useLeagueLayout()` hook for child pages. All league routes are nested under `/league/:leagueId` in App.tsx.
- React Router nested routes: `<Route path="/league/:leagueId" element={<LeagueLayout />}>` wraps all league sub-pages. Dashboard is the `index` route. Child routes are relative paths (e.g. `path="rankings"` not `path="/league/:leagueId/rankings"`).
- NavLink active state: uses React Router's `NavLink` with `className` callback for active pill styling. Dashboard link uses `end` prop to prevent matching all `/league/:leagueId/*` paths.
- League Player Rankings page: shows all valued players (from all 3 sources), not just rostered ones. Owner column shows team name (linked) or "Free Agent". Ownership filter (All Players / Rostered / Free Agents) works in combination with position filter. Top 200 displayed.
- React Rules of Hooks: never place `useMemo`/`useState`/`useEffect` after conditional early returns — React requires the same number and order of hooks on every render. Always call all hooks first, then do conditional returns.
- Trade Evaluator (src/utils/tradeEvaluator.ts): evaluates trade packages (players + picks) by comparing normalised values. Fairness grades: Even (≤10% diff), Slight Edge (≤20%), Uneven (≤35%), Lopsided (>35%). Includes tier-context explanations and age analysis per side.
- Draft pick valuation: static estimated values on 0-10,000 scale by round (R1: 4500-7500, R2: 2000-4000, R3: 1000-2000, R4: 400-1000, R5: 200-500). Uses mid-range value for future picks. Defined in `PICK_VALUES` in tradeEvaluator.ts.
- Trade Finder (src/utils/tradeFinder.ts): builds roster profiles with positional surplus/need detection (vs league-wide averages, same thresholds as roster construction). Iterates all team pairs, matches surplus→need in both directions, constructs balanced trades from bench players. Only suggests trades within 30% value balance and >500 total value.
- Trade Finder page combines three views: Trade Finder (suggested trades with team filter), Trade Evaluator (links to separate evaluator page), Trade History (graded past trades). Tab navigation within the page, evaluator link navigates to `/league/:leagueId/trade-eval`.
- Trade History grading (src/utils/tradeHistory.ts): grades past trades by current value of assets received. Won Big (>25% edge), Won (10-25%), Fair (≤10%), Lost (10-25%), Lost Big (>25%). Note: grades use current values, not values at time of trade.
- Trade Tools nav label: renamed from "Trade Finder" to "Trade Tools" in LeagueLayout to reflect the expanded functionality (evaluator + finder + history).
- Trade Evaluator parameter semantics: `evaluateTrade()` takes `sideAPlayerIds` as what Team A **receives**, not what Team A gives. When calling from the UI where sideAPlayers = what Team A gives, must swap: pass `sideBPlayers` (what B gives = what A receives) as sideA's players.
- NavLink `alsoActive` pattern: LeagueLayout nav items can specify `alsoActive: string[]` — additional path prefixes that should also highlight the pill. Uses `useLocation().pathname.startsWith()` check alongside React Router's built-in `isActive`. Used for Trade Tools pill to stay active on `/trade-eval`.
- Trade Evaluator balance suggestions: when trade is uneven, computes candidates from the winning side's roster (players not already in the trade) that would reduce the gap. Sorted by closeness to balance. Shows up to 5 suggestions with one-click add. Suggestion shows "Even" when adding would bring gap within 10% of the original gap.
- Rookie Draft Strategy (src/utils/rookieDraft.ts): no separate rookie data ingestion needed — rookies already exist in KTC/FantasyCalc/DynastyProcess value sources. Filtered by Sleeper player DB `years_exp === 0` to identify incoming class. Rookies appear in sources typically January–April as the draft class crystallises.
- Rookie rankings: `buildRookieRankings()` collects all player IDs across three value sources, filters to QB/RB/WR/TE with years_exp === 0, computes normalised value via `getPlayerValue()`, sorts descending and assigns ranks.
- Draft strategy per team: `buildTeamStrategies()` combines positional need analysis (from `analyseRoster()`), pick ownership mapping, and tier-aware pick trade suggestions. Each pick gets a window of ±2 ranked rookies with positional fit scoring (need positions get priority).
- Pick trade suggestions are tier-driven: contenders advised to sell late picks or package up for needs; rebuilders advised to acquire first-rounders; fringe teams advised to consolidate surplus picks. Suggestions are qualitative guidance, not specific trade proposals.
- Pick value estimation in rookie draft uses same PICK_VALUES table as tradeEvaluator.ts — static values by round (R1: 4500-7500, R2: 2000-4000, etc.) with early/mid/late tiers based on pick position within the round (thirds of total teams).
- Rookie Draft page (src/pages/RookieDraft.tsx): two-tab interface (Draft Strategy default, Rookie Rankings). Strategy tab has team selector dropdown and expandable cards. Rankings tab has position filter pills. Route: `/league/:leagueId/draft`.