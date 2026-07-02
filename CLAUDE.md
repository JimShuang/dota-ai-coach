# CLAUDE.md — Dota 2 Offlane AI Coach

Project guide for Claude Code. Update this file after every significant feature.

---

## Constraints (non-negotiable)

- **No LLM API calls** — all coaching is rule-based.
- **No game memory reads, CV/OCR, or replay parsing.**
- **No automatic game control.**
- **Only allowed inputs:** Dota 2 GSI (HTTP POST to localhost:3000), user manual config, local rule system.
- **Role scope:** Offlane (Position 3) only.
- **External API exception:** OpenDota public API (`https://api.opendota.com/api/matches/:id`) is used **only** for the manual Import Match feature. No other external APIs are permitted.

---

## Architecture

### Process topology

```
Dota 2 client
    │  GSI POST (every ~0.5 s)
    ▼
gsiApp (Express, port 3000)          ← receives raw GSI, runs rules, logs events
    │
    ├─ saveGameState()               → game_states table
    ├─ evaluate(data, ctx)           → alerts table
    ├─ logEvents(data, ctx)          → in-memory events[]
    └─ persistMatch() at POST_GAME   → matches / match_events / key_item_timings tables

dashApp (Express, port 3001)         ← serves REST API to frontend
    └─ React (Vite, port 5173)
           ├─ GameState.jsx
           ├─ Alerts.jsx
           ├─ OfflaneSetup.jsx
           ├─ EventTimeline.jsx      ← live events + PostGameSummary
           ├─ MatchHistory.jsx       ← historical match list + detail
           ├─ MatchImportPreview.jsx ← 10-player import preview card (history tab)
           └─ LongTermTrends.jsx     ← multi-match aggregate stats
```

### Server modules

| File | Responsibility |
|------|----------------|
| `server/index.js` | Express setup, GSI endpoint, API routes, match persist trigger |
| `server/db.js` | better-sqlite3 CRUD — all DB access is synchronous |
| `server/rules.js` | Rule engine coordinator (cooldown 60 s per rule) |
| `server/eventLogger.js` | In-memory event accumulator; builds PostGame summary |
| `server/matchConfig.js` | In-process config store (hero, playstyle, keyItemOverride) |
| `server/matchHistory.js` | `persistMatch()` + `computeKeyItemTimings()` |
| `server/suggestKeyItem.js` | Pure function: infer next key item from profile + owned items |
| `server/data/offlaneHeroProfiles.js` | 7 hero profiles, item costs, display names |
| `server/data/itemLocalization.js` | 90+ item Chinese display names + `getDisplayName()` |
| `server/utils/gsiNormalizer.js` | **`normalizeItems()`** — handles flat vs. nested GSI format |
| `server/utils/itemProgression.js` | `extractItemStateForProgression()` — pure, for future inference |
| `server/rules/commonRules.js` | 6 universal rules (TP, gold, last hits, buyback, death streak, roshan) |
| `server/rules/offlaneRules.js` | Offlane-specific rules (key item near-complete, spike unused…) |
| `server/rules/archetypeRules.js` | Archetype-specific coaching (initiator, bully, aura…) |
| `server/matchImporter.js` | Import match by ID via OpenDota API; reconstructs events + timings |
| `server/openDotaRawService.js` | Raw OpenDota cache: fetch → store full response in `raw_opendota_matches` |
| `server/importPreviewService.js` | Pure: `buildPreview(rawMatchData)` → structured 10-player preview object |
| `server/data/dotaHeroNames.js` | `hero_id` → display name + `hero_id` → internal name (`npc_dota_hero_xxx`) maps |
| `server/importConfirmService.js` | `confirmImport(matchId, playerSlot)` — writes `matches` row + key item timings + match events |
| `server/openDotaKeyItemAnalyzer.js` | Pure: `analyzeKeyItemTimings(matchId, player, profile)` — extracts timings from `purchase_log` |
| `server/openDotaEventBuilder.js` | Pure: `buildEventsFromOpenDota(player, profile, matchInfo)` — builds `match_events` array from `purchase_log` |
| `server/openDotaKillDeathExtractor.js` | Pure: `extractKillDeath(players, selectedPlayerSlot)` — extracts kill/death timeline from OpenDota `kills_log` |
| `server/openDotaDeathDigest.js` | Pure: `buildDeathDigest(events, timeseries?)` — annotates each `hero_death` with a ±5s/+60s battlefield context window and optional economy delta |
| `server/openDotaEconomyTimeseries.js` | Pure: `buildEconomyTimeseries(raw, playerSlot)` → player-perspective minute-granularity economy/XP timeseries; `economyDeltaAroundDeath(ts, gameTime)` → per-death delta |
| `server/openDotaMomentumScanner.js` | Pure: `scanMomentumShifts(timeseries)` — independent anchor scanner, no imports from event/death/digest modules |
| `server/data/genericPowerSpikeItems.js` | 6-bucket universal power-spike item list for enemy comparison (distinct from hero-specific `offlaneHeroProfiles.js` keyItems) |
| `server/openDotaSpikeWindowScanner.js` | Pure: `scanSpikeWindowDeltas(players, selectedPlayerSlot)` — third anchor class; enemy vs. player spike timing deltas, decoupled from event/death/digest/timeseries/momentum modules |
| `server/anchorChain.js` | Pure convergence layer: maps the three anchor scanner outputs to a unified `Anchor` shape and merges into a time-ordered chain. Never imports the scanners — receives their output as parameters. |
| `server/anchorLinker.js` | Pure link detector: `isLethalDeath()`, `scoreA1()`, `ruleA1()` — links death anchors to following momentum_loss anchors; exports `GAP_THRESHOLD`. |

---

## GSI item format — critical note

Real Dota 2 GSI (live game) sends items **flat** under `data.items`:

```json
"items": {
  "slot0": { "name": "item_vanguard", "cooldown": 0, "charges": 0 },
  "slot1": { "name": "item_tpscroll", "charges": 1 },
  "slot6": { "name": "item_empty" },
  "stash0": { "name": "item_empty" },
  "neutral0": { "name": "item_empty" }
}
```

The mock GSI (`server/tests/mockGSI.json`) uses a **nested** format (`items.slot.slot0`).

**Always use `normalizeItems(data.items)` from `server/utils/gsiNormalizer.js`** to get a consistent `{ slot, stash, neutral }` structure. Never access `data.items.slot` directly.

Slot ranges:
- `slot0–slot5` = inventory (main bag)
- `slot6–slot8` = backpack
- `stash0–stash5` = stash
- `neutral0` = neutral item
- `teleport` = dedicated TP scroll slot (top-level key, separate from inventory; normalizeItems exposes it as `.teleport`)

---

## Hero profiles & archetypes

Defined in `server/data/offlaneHeroProfiles.js`. Each profile has:
- `keyItems[]` — ordered progression; `suggestKeyItem` returns the first unowned item
- `powerSpikeItems[]` — items that trigger a `power_spike_started` event
- `archetype` — drives which archetype rules fire

| Hero | archetype | Key item route |
|------|-----------|----------------|
| Centaur Warrunner | `teamfight_initiator` | Vanguard → Blink → Pipe → Crimson Guard |
| Tidehunter | `teamfight_initiator` | Vanguard → Blink → Pipe → Crimson Guard |
| Razor | `lane_bully_tempo` | Hood → Blade Mail → BKB → Assault |
| Viper | `lane_bully_tempo` | Hood → Aghanim's → Pipe → Rod of Atos |
| Necrophos | `lane_bully_tempo` | Hood → Kaya & Sange → Eternal Shroud → Aghanim's |
| Abaddon | `aura_tank_save` | Mekansm → Guardian Greaves → Pipe → Lotus Orb |
| Vengeful Spirit | `utility_save_initiator` | Force Staff → Glimmer Cape → Aghanim's → BKB |

Hero auto-detection: `getProfileByDotaName(data.hero?.name)` in `buildCtx()`.

---

## Event schema

Events are accumulated in-memory by `server/eventLogger.js` and flushed to `match_events` at game end.

### Event object shape

```js
{
  game_time: number,      // map.clock_time in seconds (negative = before creep spawn)
  type: string,           // see types below
  severity: string,       // 'critical' | 'danger' | 'warning' | 'info' | 'success'
  message: string,        // human-readable Chinese string
  snapshot: object,       // type-specific payload (see below)
}
```

### Event types

| type | trigger | severity | source |
|------|---------|----------|--------|
| `hero_kill`  | kill appears in `kills_log` | `success` | OpenDota import only |
| `hero_death` | `hero.alive` true → false | `critical` \| `danger` | GSI only; `danger` (fixed) for OpenDota import |
| `hero_respawn` | `hero.alive` false → true | `info` | GSI only |
| `key_item_completed` | key route item newly appears | `info` | GSI + OpenDota import |
| `key_item_near_completion` | gold gap < 600 to next key item | `warning` | GSI only |
| `power_spike_started` | powerSpikeItem completed | `info` | GSI + OpenDota import |
| `power_spike_unused` | spike item completed 3 min with no K/A growth | `warning` | GSI only |
| `no_tp_warning` | TP missing > 60 s (after 5 min) | `warning` | GSI only |
| `low_farm_window` | GPM dropped ≥15% in 3 min with no K/A | `warning` | GSI only |
| `game_end` | `map.game_state` = `DOTA_GAMERULES_STATE_POST_GAME` or match end | `success` \| `danger` \| `info` | GSI + OpenDota import |
| `item_purchased` | each `purchase_log` entry | `info` | OpenDota import only |
| `hero_kill`  | entry in `kills_log` of selected player | `success` | OpenDota import only |
| `hero_death` (import) | entry in another player's `kills_log` matching selected hero | `danger` (fixed) | OpenDota import only |
| `objective` *(planned, not yet implemented)* | tower / barracks destroyed, or Roshan killed | own structure destroyed → `danger`; enemy structure destroyed → `success`; Roshan → `warning` | OpenDota import only — sourced from `objectives[]` (top-level field in parsed OpenDota match data) |

**OpenDota import event snapshots** are minimal — only `{ item, source: 'opendota_import', isConsumable }` for `item_purchased`; `{ item, source }` for `key_item_completed` / `power_spike_started`; `{ source }` for `game_end`. The full GSI death snapshot fields (`goldBeforeDeathPenalty`, `itemsAtDeath`, etc.) are absent and the frontend renders them defensively (missing fields silently skipped). `hero_kill` and `hero_death` (import) have their own minimal snapshot shapes — see below.

### `hero_death` snapshot fields (GSI)

```js
{
  // ── Gold ──────────────────────────────────────────────────────
  goldBeforeDeathPenalty:           number,   // gold from latestAliveSnapshot
  currentGoldAfterDeathIfAvailable: number,   // gold from dead tick

  // ── Items (from latestAliveSnapshot) ─────────────────────────
  itemsAtDeath:      string[],  // all non-empty items (inv + bp + stash + neutral)
  inventoryAtDeath:  { slot0: string|null, …slot5 },  // all 6 explicit, null=empty
  backpackAtDeath:   { slot6: string|null, slot7, slot8 },
  stashAtDeath:      { stash0?: string|null, … },
  neutralItemAtDeath: string|null,
  tpAtDeath:         { name: string, charges: number }|null,
  itemDetailsAtDeath: [{
    slot, internalName, displayName, cooldown, charges,
    isInventory, isBackpack, isStash, isNeutral, isTeleport
  }],

  // ── Key item analysis ─────────────────────────────────────────
  keyItemAtDeath:      string|null,
  goldToKeyItemAtDeath: number|null,
  wasNearKeyItem:      boolean,   // goldToKeyItemAtDeath < 600
  wasInPowerSpikeWindow: boolean,
  hadTpAtDeath:        boolean,

  // ── Player stats at death ─────────────────────────────────────
  gpmAtDeath, xpmAtDeath, killsAtDeath, deathsAtDeath, assistsAtDeath,
  gameTimeAtDeath: number,

  // ── Backward-compat aliases ───────────────────────────────────
  pre_key_item, gold_gap_to_key_item, in_power_spike, has_tp,
}
```

### `hero_kill` snapshot fields (OpenDota import)

Built by `buildKillDeathEvents()` in `server/openDotaEventBuilder.js` from `extractKillDeath()`'s `kills[]` output. `victim` is already the **resolved display name** (not the raw `npc_dota_hero_xxx` string) — `victimDisplayName` is currently a duplicate of the same value, kept as a separate field for forward compatibility with a future raw-internal-name field.

```js
{
  victim:            string,  // display name of the hero killed, e.g. '屠夫（Pudge）' or 'Phantom Lancer'
  victimDisplayName: string,  // same value as `victim` today (see note above)
  killNumber:        number,  // this player's Nth kill in the match, 1-indexed
  source:            'opendota_import',
}
```

Display name resolution (`heroDisplayNameFromInternal()` in `openDotaKillDeathExtractor.js`): the 7 profile heroes use `中文（English）`; other known heroes use English only; unknown hero IDs fall back to a title-cased strip of the internal name.

### `hero_death` snapshot fields (OpenDota import)

Built by the same `buildKillDeathEvents()`, from `extractKillDeath()`'s `deaths[]` output (reconstructed by scanning every other player's `kills_log` for an entry matching the selected player's hero). Severity is always `danger` — GSI's `critical` tier depends on gold/items data not available from the basic OpenDota API. None of the GSI-rich fields (`goldBeforeDeathPenalty`, `itemsAtDeath`, `wasNearKeyItem`, etc.) are present.

```js
{
  killer:            string,  // display name of the killer, e.g. '帕克（Puck）'
  killerDisplayName: string,  // same value as `killer` today (see note above)
  deathNumber:       number,  // this player's Nth death in the match, 1-indexed
  source:            'opendota_import',
}
```

**Precision limit:** tower, creep, and Roshan kills never appear in any player's `kills_log`, so `deaths.length` (reconstructed) can be less than `player.deaths` (OpenDota's true count) — the gap is reported separately as `deathStats: { reconstructed, total, missing }` by `extractKillDeath()`, not embedded in this snapshot.

### `objective` snapshot fields (planned, not yet implemented)

No code currently produces this event type — `objectives[]` (a top-level array in parsed OpenDota match data covering tower/barracks destructions and Roshan kills) is not yet read by any server module. This schema is documented ahead of implementation so `openDotaEventBuilder.js` has a fixed contract to build against.

```js
{
  objectiveType: 'tower' | 'barracks' | 'roshan',
  team:          'radiant' | 'dire',       // side whose structure was destroyed, or that killed Roshan
  lane:          'top' | 'mid' | 'bot' | null,  // null for roshan
  tier:          number | null,            // tower tier 1-4; null for barracks / roshan
  barrackType:   'melee' | 'ranged' | null, // null for non-barracks
  executedBy:    string | null,            // display name of the hero credited with the kill; null if unknown (e.g. tower deny/suicide)
  key:           string,                   // raw OpenDota key, e.g. 'npc_dota_goodguys_tower1_top'
  source:        'opendota_import',
}
```

Severity rule once implemented: own structure destroyed → `danger`; enemy structure destroyed → `success`; Roshan kill → `warning`.

### `latestAliveSnapshot` pattern

`eventLogger.js` stores the last GSI tick where `hero.alive === true`.
`makeDeathSnapshot()` reads items and gold **from that snapshot**, not the dead tick,
because GSI already applies the death gold penalty by the time `alive` flips to `false`.

---

## SQLite schema

Database file: `server/coach.db` (auto-created by better-sqlite3).

```sql
-- Raw GSI frames
game_states (id, match_id, clock_time, hero, level, gold, net_worth,
             kills, deaths, assists, last_hits, denies, gpm, xpm,
             map_name, game_state, raw_json, created_at)

-- Rule-engine alerts
alerts (id, match_id, clock_time, rule_id, message, severity, created_at)

-- One row per match (summary)
matches (id, match_id UNIQUE, hero, role, archetype, playstyle, result,
         start_time, end_time, duration,
         kills, deaths, assists, gpm, xpm, last_hits, denies, final_gold,
         suggested_key_item, user_override_key_item,
         overall_grade, one_thing_to_improve,
         pre_key_item_deaths, spike_unused_count, low_farm_windows,
         is_excluded INTEGER DEFAULT 0,   -- Exclude Match feature
         excluded_at TEXT,                -- datetime('now') when excluded
         excluded_reason TEXT,            -- bot_test | unranked | development_test | corrupted_data | duplicate | other
         import_source TEXT,              -- legacy; NULL for GSI, 'opendota' for old matchImporter flow
         source TEXT DEFAULT 'gsi',      -- 'gsi' | 'opendota_import'
         imported_at TEXT,               -- ISO timestamp when confirm-imported
         import_match_id TEXT,           -- original Dota match_id (before synthetic suffix)
         player_slot INTEGER,            -- 0-4 radiant, 128-132 dire
         account_id INTEGER,             -- Steam account_id of imported player
         radiant_win INTEGER,            -- 1 = radiant won, 0 = dire won, NULL = unknown
         team TEXT,                      -- 'radiant' | 'dire'
         created_at)

-- Event timeline per match (all 10 types)
match_events (id, match_id, game_time, type, severity, message,
              snapshot_json,   -- JSON of hero_death snapshot etc.
              created_at)

-- Per key-item per match
key_item_timings (id, match_id, item_name,
                  completed, completed_time,
                  deaths_before_completion, power_spike_used,
                  created_at)

-- Raw OpenDota API response cache
raw_opendota_matches (match_id TEXT PRIMARY KEY,
                      raw_json TEXT NOT NULL,        -- full OpenDota response as JSON string
                      parsed_status TEXT,            -- 'ok' | 'unparsed' | 'no_players'
                      fetched_at TEXT,               -- datetime('now') at insert/replace time
                      warnings_json TEXT)            -- JSON array of warning strings
```

`INSERT OR IGNORE` + in-memory `persistedIds` Set prevent duplicate persistence across multiple POST_GAME ticks.

`raw_opendota_matches` uses `INSERT OR REPLACE` so `force: true` refreshes the cache row.

---

## Key design decisions

### 1. Module-level state in eventLogger.js
`events[]`, `latestAliveSnapshot`, `powerSpike`, `prevData` etc. are module-level. They reset via `resetForMatch(matchId)` when `matchId` changes. This avoids passing state through every call. **Consequence:** eventLogger is not re-entrant — one game at a time.

### 2. Two-server design (ports 3000 / 3001)
Port 3000 receives raw GSI from Dota 2. Port 3001 serves the React dashboard. Keeping them separate avoids CORS issues with GSI (which sends no origin header) and lets the dashboard API evolve independently.

### 3. suggestKeyItem is a pure function
`server/suggestKeyItem.js` takes `(heroKey, currentItems[], gameTime, userOverride)` and returns a result with no side effects. This makes it easily testable and reusable. The rule engine and eventLogger both call it via `ctx.suggested`.

### 4. Death gold uses latestAliveSnapshot
Dota 2's GSI reports gold **after** the death penalty has been applied by the time `hero.alive` flips to `false`. We snapshot the last alive tick (`latestAliveSnapshot`) to record pre-penalty gold and items, then the dead tick for post-penalty gold.

### 5. normalizeItems() handles two GSI layouts
The real Dota 2 client sends items flat (`data.items.slot0`). The mock GSI uses a nested layout (`data.items.slot.slot0`). `server/utils/gsiNormalizer.js` detects which layout is present (by checking whether `items.slot` is a sub-object or undefined) and normalizes to `{ slot, stash, neutral }`. **Every** item read must go through `normalizeItems(data.items)` — never access `data.items.slot` directly.

### 6. Rule cooldown at 60 seconds
`rules.js` throttles each rule to fire at most once per 60 seconds per match. This is global state in the rules coordinator, not per-rule config.

### 7. Match persistence is idempotent
`matchHistory.js` checks `persistedIds` (in-memory) and `matchExists()` (DB) before writing. Both `saveMatch` and `saveMatchEvents` use `INSERT OR IGNORE`. Safe to call multiple times on POST_GAME ticks.

### 8. Chinese display names: 中文（English）format
All hero and item names shown to the player use the format `中文（English）`, e.g., `闪烁匕首（Blink Dagger）`. Server-side names live in `server/data/itemLocalization.js` (CommonJS). Client-side names live in `client/src/heroItemNames.js` (ESM). Both must be kept in sync when adding heroes or items.

### 9. All server code is CommonJS
The server uses `require()` / `module.exports` throughout. VS Code shows a 80001 hint about converting to ESM — this is intentional and should be ignored.

### 10. Test isolation via matchId
`eventLogger.test.js` uses `resetForMatch(uniqueId)` at the start of each test group. Tests must use distinct match IDs to avoid state bleed between groups.

### 11. Two match-removal mechanisms, split by data recoverability
`excludeMatch()` (soft exclusion, all matches) only sets `is_excluded = 1` on the `matches` row — `match_events` and `key_item_timings` are left untouched, and `getMatchById()` still returns full detail regardless of exclusion state. `deleteImportedMatch()` (hard delete, `source = 'opendota_import'` only) atomically removes the `matches`, `match_events`, and `key_item_timings` rows for that match inside one `transaction()`. GSI matches can never be hard-deleted — their data is not recoverable, unlike OpenDota imports whose source data stays cached in `raw_opendota_matches` and can be re-imported.

---

## Test suite

```
server/tests/
  suggestKeyItem.test.js          18 assertions — pure function, no I/O
  matchHistory.test.js            89 assertions — computeKeyItemTimings, SQLite round-trip, exclude/include, hard delete
  eventLogger.test.js             53 assertions — death snapshot, item fields, normalizeItems
  matchImporter.test.js           39 assertions — opendotaKeyToItemName, buildKeyItemTimings, computeGrade, computeOneThingToImprove
  openDotaRaw.test.js             47 assertions — detectParsedStatus, buildWarnings, fetchAndCache (mock), getCached
  importPreview.test.js           53 assertions — getHeroName, buildPreview (structure, fields, sort, edge cases)
  importConfirm.test.js          104 assertions — syntheticMatchId, getHeroInternalName, normalizeForMatch, confirmImport (DB + events + deathStats + kill/death events + pre_key_item_deaths + deaths_before_completion)
  openDotaKeyItemAnalyzer.test.js 67 assertions — buildPurchaseMap, analyzeKeyItemTimings (all cases + deathTimes), countPreKeyItemDeaths, GSI cross-validation
  openDotaEventBuilder.test.js        162 assertions — isConsumable, buildEventsFromOpenDota, buildKillDeathEvents, buildObjectiveEvents (all cases, cross-validation)
  openDotaKillDeathExtractor.test.js   60 assertions — heroDisplayNameFromInternal, extractKillDeath (all cases)
  openDotaDeathDigest.test.js          61 assertions — buildDeathDigest (window boundaries, chainDeaths, killsNearby, objectivesLost/Gained, majorObjectiveLost, diedWithBuyback, slim shape)
  openDotaEconomyTimeseries.test.js    86 assertions — buildEconomyTimeseries (radiant/dire sign flip, null/missing data, xp), economyDeltaAroundDeath (minuteAtDeath, delta, out-of-range, dual-threshold significant), digest integration (context.economy present, degradation)
  openDotaMomentumScanner.test.js      63 assertions — decoupling (no forbidden requires), degenerate inputs, flat plateau, V-shape/inv-V, spike filter, magnitude filter, multiple shifts, anchor fields
  openDotaSpikeWindowScanner.test.js   89 assertions — decoupling, degenerate inputs, spike_lead, spike_deficit, fastest-enemy selection, only-my-bucket (null-delta unique anchor), only-enemy-bucket, multi-item one-anchor-per-item (same-item match or null-delta), significant threshold, sort order, anchor shape, dire slot, profile hero display name
  anchorChain.test.js                 102 assertions — decoupling (no scanner imports), deathToAnchor (all summary templates, negative gameTime, severity passthrough), momentumToAnchor (minute×60, severity, summary), spikeToAnchor (all buckets 中文, deficit/lead severity, duration format, null-delta unique spike), buildAnchorChain (gameTime ascending, tie-break, partial inputs, shape)
  anchorLinker.test.js                 68 assertions — decoupling (no scanner imports), isLethalDeath (chainDeaths / economy / critical / null-context edge cases), scoreA1 (all four quadrants including OD-import reaching strong), ruleA1 (three gates, link shape, evidence fields chain_deaths/economy_significant/lethal, score consistency)
```

Run with: `node server/tests/<file>.test.js`

All 1161 assertions must pass before merging any change.

---

## Adding a new hero

1. Add entry to `PROFILES` in `server/data/offlaneHeroProfiles.js`:
   - `heroName`, `heroNameZh`, `dotaHeroName` (the `npc_dota_hero_xxx` string)
   - `archetype` (one of the four existing types, or add a new one)
   - `keyItems[]` (ordered progression)
   - `powerSpikeItems[]` (subset of keyItems)
2. Add Chinese+English name to `ITEM_DISPLAY_NAMES` in the same file (if new items).
3. Add item entries to `server/data/itemLocalization.js` (server display names).
4. Add item entries to `client/src/heroItemNames.js` (client display names).
5. Add `ITEM_COSTS` entries for any new key items.
6. Add hero to `HERO_ZH` in `client/src/heroItemNames.js`.
7. Optionally add archetype-specific rules to `server/rules/archetypeRules.js`.

---

## OpenDota raw cache

`server/openDotaRawService.js` is a standalone cache layer that sits **between** the network and any downstream consumer (currently `matchImporter.js`).

### Behaviour
- **Cache-first by default**: `fetchAndCache(matchId)` returns the cached DB row on second call without hitting the network.
- **Force refresh**: `fetchAndCache(matchId, { force: true })` always re-fetches and overwrites the cache (`INSERT OR REPLACE`).
- **Never caches errors**: 404 / 429 / network failures throw immediately and leave the DB unchanged.
- **Always caches content**: `unparsed` and `no_players` responses are stored so repeat calls stay offline.

### `parsed_status` values
| Value | Meaning |
|-------|---------|
| `ok` | Players present + at least one player has `purchase_log` entries |
| `unparsed` | Players present but OpenDota hasn't parsed the replay (`purchase_log` null/empty everywhere) |
| `no_players` | `players` array missing or empty |

### Error codes
`NOT_FOUND` (404) · `RATE_LIMITED` (429) · `HTTP_ERROR` · `NETWORK_ERROR` · `TIMEOUT`

### API routes
| Method | Route | Body/Params | Effect |
|--------|-------|-------------|--------|
| `POST` | `/opendota/fetch` | `{ matchId, force? }` | Fetch + cache; returns metadata (no raw payload) |
| `GET`  | `/opendota/raw/:matchId` | — | Return full cached response with raw_json as object |

### Test injection
`_setFetchFn(fn)` / `_resetFetchFn()` swap the HTTP implementation for tests — no real network calls in the test suite.

### Test isolation note
`openDotaRaw.test.js` generates unique match IDs per run (timestamp suffix) so cached rows from prior runs never cause false cache-hit failures.

---

## Import Preview feature

Shows all 10 players from a match before the user selects which slot is theirs. Does **not** write to `matches` or `match_events`.

### Flow
1. User opens **比赛预览** panel in the History tab (collapsible card at top).
2. Enters a Match ID and clicks **预览**.
3. Dashboard calls `POST /history/import/preview`.
4. Server checks `raw_opendota_matches` cache; auto-fetches via `openDotaRawService.fetchAndCache` on cache miss.
5. `importPreviewService.buildPreview()` transforms raw JSON into a 10-player preview.
6. UI shows two columns (天辉 / 夜魇) with per-player K/D/A, GPM, XPM, LH/DN and the resolved hero name.

### API

| Method | Route | Body | Effect |
|--------|-------|------|--------|
| `POST` | `/history/import/preview` | `{ matchId }` | Returns preview (no DB write to matches/events) |

### Response shape
```json
{
  "matchId":    "12345678",
  "duration":   2400,
  "radiantWin": true,
  "isParsed":   true,
  "warnings":   [],
  "players": [
    { "playerSlot": 2, "team": "radiant", "accountId": 123,
      "heroId": 96, "heroName": "半人马战行者（Centaur Warrunner）",
      "kills": 5, "deaths": 2, "assists": 8,
      "gpm": 450, "xpm": 520, "lastHits": 120, "denies": 5 }
  ]
}
```

### Hero localization
`server/data/dotaHeroNames.js` maps `hero_id` (numeric) to display name.
- 7 profile heroes: `中文（English）` format.
- ~120 other heroes: English name.
- Unknown IDs: `Hero #N` fallback.

### `isParsed` flag
`true` if at least one player has a non-empty `purchase_log`. `false` means OpenDota hasn't parsed the replay — key item timings will be unavailable for import.

### UI component
`client/src/components/MatchImportPreview.jsx` — collapsible card rendered at the top of the History tab (above `MatchHistory`). Expanding it reveals the input form and player grid.

---

## Import Confirm feature

Writes a selected player's match data from the OpenDota raw cache into the `matches` table, generates `key_item_timings` (when `purchase_log` is available), and builds the full `match_events` timeline.

### Flow
1. User sees the 10-player preview in `MatchImportPreview.jsx`.
2. Clicks **选择** on their row → `POST /history/import/confirm { matchId, playerSlot }`.
3. Server calls `confirmImport(matchId, playerSlot)` from `importConfirmService.js`.
4. Service reads raw cache via `getCached(matchId)`, normalises the player into a `matches` row, calls `saveMatch()`.
5. Calls `analyzeKeyItemTimings()` and `saveKeyItemTimings()` when `purchase_log` is available.
6. Calls `buildEventsFromOpenDota()` (from `openDotaEventBuilder.js`) and `saveMatchEvents()` — always.
7. UI shows a green success banner; the match appears immediately in History with a full event timeline.

### Events generated by `buildEventsFromOpenDota`
| Event type | Condition |
|------------|-----------|
| `item_purchased` | One per `purchase_log` entry (all items, including duplicates/restocks) |
| `key_item_completed` | `purchase_log` entry matches `profile.keyItems` (same logic as `analyzeKeyItemTimings`) |
| `power_spike_started` | `purchase_log` entry matches `profile.powerSpikeItems` |
| `game_end` | Always; severity derived from `radiantWin` + `team`; severity `info` when `radiantWin` is null |

When `purchase_log` is absent or empty, only `game_end` is generated — "no guessing" principle.
When hero has no supported profile, `key_item_completed` and `power_spike_started` are skipped.

### Consumable folding in MatchHistory.jsx
Consecutive `item_purchased` events where `snapshot.isConsumable === true` are grouped into a collapsible row:
- Collapsed by default, showing `▸ 消耗品购买 × N 条`.
- Click toggles expansion. Non-consumable purchases and all other event types remain as individual rows.
- Groups break when a non-consumable event appears between two consumable purchases.
- State is component-local (`useState(new Set())`), not persisted.

### Consumable item set (server: `openDotaEventBuilder.js`, flag in snapshot)
`item_tango`, `item_clarity`, `item_flask`, `item_enchanted_mango`, `item_faerie_fire`, `item_tpscroll`, `item_smoke_of_deceit`, `item_infused_raindrop`, `item_ward_observer`, `item_ward_sentry`, `item_ward_dispenser`, `item_dust`.

### `match_id` scheme for imported rows
`{dotaMatchId}_od{playerSlot}` — e.g., `8838859325_od2`. Allows multiple player slots from the same match without conflicting on the `match_id UNIQUE` index. `import_match_id` stores the original Dota match ID.

### Dedup
`matchExists(syntheticId)` before write → 409 DUPLICATE if already imported.
`getCached(matchId) === null` → 400 CACHE_MISS (preview must run first).

### Key item timings
After writing the `matches` row, `confirmImport` calls `analyzeKeyItemTimings` (from `openDotaKeyItemAnalyzer.js`):
- If the hero has a supported profile AND `purchase_log` is non-empty → writes `key_item_timings` rows
- If `purchase_log` is absent or empty → skips (no guessing); History shows a "关键装备数据不可用" warning banner

### match_events
`buildEventsFromOpenDota` (from `openDotaEventBuilder.js`) is always called and its output written via `saveMatchEvents`. The function returns at minimum a `game_end` event. See "Events generated" table above.

### `power_spike_used` in OpenDota imports
`null` for completed spike items (whether the spike was "used" cannot be determined from the basic API).
`0` for non-spike items or uncompleted items.
History detail shows **N/A** for `null`, matching the existing `已转化` / `未转化` logic for GSI matches.

### `deaths_before_completion` in OpenDota imports
Computed as a **lower bound** from reconstructed death times (see `openDotaKillDeathExtractor`):
- If the item was **completed**: deaths where `reconstructed_death_time < completed_time` (mirrors `computeKeyItemTimings` in `matchHistory.js` exactly)
- If the item was **not completed**: count of all reconstructed deaths
- When no `kills_log` data is available (death times empty): `0` — never `null`

**Precision limit:** tower, creep, and Roshan kills do not appear in any player's `kills_log`, so the reconstructed death count is ≤ `player.deaths`. Both `deaths_before_completion` and `matches.pre_key_item_deaths` for OpenDota imports are therefore lower bounds. This is documented in `openDotaKeyItemAnalyzer.js`.

### `source` field
| Value | Where set | Meaning |
|-------|-----------|---------|
| `'gsi'` | default / all live matches | Recorded from Dota 2 GSI |
| `'opendota_import'` | `confirmImport()` | Imported via OpenDota API |

### API

| Method | Route | Body | Effect |
|--------|-------|------|--------|
| `POST` | `/history/import/confirm` | `{ matchId, playerSlot }` | Writes to matches; returns `{ ok, match_id, import_match_id, player_slot, hero, result, grade }` |

### Match History labels
- `source === 'opendota_import'` → **"OpenDota 导入"** badge (cyan)
- All other matches → **"Live GSI"** badge (grey), shown in detail view header

### Exclude compatibility
Imported matches behave identically to GSI matches for exclude/include, long-term trends, and all existing queries.

---

## Import Match feature

Allows users to import a past Dota 2 match by ID using the OpenDota public API. Imported matches participate in History and Long-Term Trends identically to live-tracked matches, and support Exclude Match.

### Flow
1. User clicks **"+ 导入比赛"** in MatchHistory.
2. Enters Match ID + selects hero from supported list.
3. **Preview step** (`POST /api/history/import/preview`) — fetches OpenDota, returns match stats + key item timings. No DB write.
4. User confirms → **Import** (`POST /api/history/import`) — fetches again, reconstructs events, persists.

### Data reconstructed from OpenDota
| Source | Events generated |
|--------|-----------------|
| `purchase_log` | `key_item_completed`, `power_spike_started` |
| Match end | `game_end` (win/loss) |

Not available without replay parsing: `hero_death`, `no_tp_warning`, `low_farm_window`.

### Analysis
Grade and `one_thing_to_improve` are computed from KDA, GPM, and key item timing (see `computeGrade` / `computeOneThingToImprove` in `matchImporter.js`). `spike_unused_count` and `low_farm_windows` are always 0 for imported matches. `pre_key_item_deaths` is a **lower bound** computed from reconstructed deaths — see "Import Confirm feature → `deaths_before_completion` in OpenDota imports" for the precision limitation.

### API

| Method | Route | Body | Effect |
|--------|-------|------|--------|
| `POST` | `/api/history/import/preview` | `{ matchId, heroKey }` | Returns preview data — no DB write |
| `POST` | `/api/history/import` | `{ matchId, heroKey }` | Fetches + persists; returns `{ ok, match_id, result, grade }` |

### Hero key → OpenDota hero_id map (in `matchImporter.js`)
`centaur=96, tidehunter=29, razor=15, viper=47, necrophos=36, abaddon=102, vengefulspirit=20`

### `import_source` column
Imported matches have `import_source = 'opendota'`; live matches have `import_source = NULL`. Used to render "导入" badge in the UI.

### Constraints preserved
- `matchExists()` dedup prevents re-importing.
- All existing `getMatches`, `getLongTermStats` queries include imported matches automatically.
- Exclude/Include works identically.

---

## Exclude Match feature

Allows users to mark specific matches as excluded so they don't pollute stats (e.g., bot games, dev tests, corrupted data).

Two removal mechanisms exist, split by whether the underlying match data is recoverable:

| Mechanism | Applies to | Effect |
|-----------|-----------|--------|
| **Soft exclusion** (`excludeMatch`) | All matches (`gsi` and `opendota_import`) | Sets `is_excluded=1`; data never deleted |
| **Hard delete** (`deleteImportedMatch`) | `opendota_import` only | Atomically deletes `matches` + `match_events` + `key_item_timings` rows |

GSI matches can only be soft-excluded — there is no underlying source to re-derive them from, so deleting one would be permanent and irreversible. OpenDota imports can be hard-deleted because their source data lives in the `raw_opendota_matches` cache (untouched by the delete) and the match can simply be re-imported later — e.g., if it was originally `unparsed` and OpenDota has since finished parsing the replay. Hard-deleting frees up the `match_id UNIQUE` constraint so the same Dota match ID can be re-confirmed.

### Data safety invariant (soft exclusion)
**Never deletes events or timings.** Only `matches.is_excluded` changes. All `match_events` and `key_item_timings` rows are preserved.

### API

| Method | Route | Body | Effect |
|--------|-------|------|--------|
| `GET` | `/api/history/matches?includeExcluded=true` | — | Returns all matches including excluded |
| `POST` | `/api/history/matches/:matchId/exclude` | `{ reason }` | Sets `is_excluded=1`, records `excluded_at` and `excluded_reason` |
| `POST` | `/api/history/matches/:matchId/include` | — | Resets `is_excluded=0`, clears `excluded_at`/`excluded_reason` |
| `DELETE` | `/api/history/matches/:matchId` | — | Hard-deletes an `opendota_import` match (3 tables). 404 if not found. **403** `{ error: 'GSI_MATCH_CANNOT_DELETE' }` if `source = 'gsi'` |
| `GET` | `/api/history/matches/:matchId/death-digest` | — | Returns `{ deaths: [...] }` — each `hero_death` event annotated with a battlefield context window; 404 if match not found; `deaths: []` if match has no deaths |

Valid `reason` values: `bot_test`, `unranked`, `development_test`, `corrupted_data`, `duplicate`, `other`.

### DB functions (`server/db.js`)

- `excludeMatch(matchId, reason)` — UPDATE only; returns `{ changes }` (0 if not found)
- `includeMatch(matchId)` — reverses exclusion
- `deleteImportedMatch(matchId)` — hard delete, `opendota_import` only; runs the 3-table delete inside one `db.transaction()`; returns `{ deleted: true }` or `{ deleted: false, reason: 'not_found' | 'gsi_match' }`. `raw_opendota_matches` is never touched.
- `getMatches(limit, includeExcluded=false)` — filters `WHERE is_excluded = 0` by default
- `getLongTermStats(recentCount)` — all sub-queries filter `AND is_excluded = 0`

### UI (`client/src/components/MatchHistory.jsx`)

- **"显示已排除" checkbox** at top of list — re-fetches with `includeExcluded=true`
- **Excluded match rows** — 55% opacity, "已排除" badge, no click-through to detail, "恢复" button
- **Non-excluded rows** — "排除" button (stops propagation so row click still works)
- **"🗑 删除" button** — shown only for `source === 'opendota_import'` rows (list row + match detail header); never shown for `gsi` matches
- **Shared confirm dialog** — `actionDialog` state with a `mode: 'exclude' | 'delete'` field drives the title/body/button text; `'exclude'` shows the reason `<select>`, `'delete'` shows the irreversible-action warning text instead
- **Error toast** — fixed bottom-right banner shown on delete failure (e.g. attempting to delete a GSI match), auto-dismisses after 4s or on click

### Migration
`server/db.js` runs `ALTER TABLE matches ADD COLUMN ...` (with try-catch) on startup so existing `coach.db` files without the new columns are migrated automatically.

---

## Death Digest feature

Associates each `hero_death` event with the battlefield context that happened nearby in time.

### Pure function: `buildDeathDigest(events)`

Input: full `match_events` array for one match, sorted by `game_time` ASC.
Returns: array containing only `hero_death` entries, each extended with a `.context` object.

### Window definition

| Bound | Value | Rationale |
|-------|-------|-----------|
| `windowStart` | `death.game_time - 5` | Capture kill lead-up (stun/disable before death) |
| `windowEnd` | `death.game_time + 60` | Capture full respawn window of ~30–70 s |

### `context` fields

| Field | Type | Notes |
|-------|------|-------|
| `windowStart` / `windowEnd` | number | Inclusive bounds used for the filter |
| `chainDeaths` | `{game_time, message, snapshot}[]` | Other `hero_death` events in window (self excluded) |
| `killsNearby` | `{game_time, message, snapshot}[]` | `hero_kill` events in window |
| `objectivesLost` | `{game_time, message, snapshot}[]` | Objectives with `severity='danger'` OR `objectiveType='roshan'` in window |
| `objectivesGained` | `{game_time, message, snapshot}[]` | Objectives with `severity='success'` in window |
| `diedWithBuyback` | `boolean \| null` | See below |
| `majorObjectiveLost` | `boolean` | `true` if `objectivesLost` contains a `barracks` or `roshan` event |
| `economy` | object | Economy delta around the death — see below |

### `context.economy` fields

Sourced from `openDotaEconomyTimeseries.js`. Only populated when the match has `radiant_gold_adv` in the raw cache (i.e. OpenDota-parsed imports). Always present as a field; `available: false` when data is absent.

**PRECISION LIMIT:** `radiant_gold_adv` / `radiant_xp_adv` are **minute-granularity** arrays. A death at e.g. t=754s lands at minute 12; "the next minute" is minute 13. The delta is `gold[13] − gold[12]` — one data-point gap. No interpolation. This is a fixed data-source constraint; results are labelled `≈ 分钟级` in the UI.

Economy curves are **never stored in the database** — computed on-demand from `raw_opendota_matches` cache each time the death-digest or economy-timeseries endpoint is called.

| Field | Type | Notes |
|-------|------|-------|
| `available` | boolean | `false` when timeseries not passed or `radiant_gold_adv` is null |
| `minuteAtDeath` | number \| null | `Math.floor(game_time / 60)` |
| `advBefore` | number \| null | Economy advantage (our perspective) at `minuteAtDeath` |
| `advAfter` | number \| null | Economy advantage at `minuteAtDeath + 1`; null if that minute doesn't exist |
| `delta` | number \| null | `advAfter − advBefore`; negative = deterioration |
| `significant` | boolean | Absolute (`\|delta\| > 1000g`) OR relative (`\|delta\| > 20% of \|advBefore\|`, skipped when `\|advBefore\| < 500g`) |

**Threshold constants** (in `openDotaEconomyTimeseries.js`):
- `ABS_THRESHOLD = 1000` — absolute gold delta
- `REL_THRESHOLD = 0.20` — 20% relative change
- `BASELINE_MIN = 500` — minimum `|advBefore|` to apply relative threshold

### `diedWithBuyback` semantics

- **GSI deaths** (`snapshot.source !== 'opendota_import'`): `goldBeforeDeathPenalty >= 200` — a minimum-gold proxy for whether buyback was theoretically affordable. The exact cost (`200 + 3.6% × net_worth`) cannot be computed because `net_worth` is not in the death snapshot.
- **OD-import deaths** (`snapshot.source === 'opendota_import'`): `null` — no gold data available.
- **Missing snapshot**: `null`.

### `objectivesLost` / `objectivesGained` split

Uses event `severity`, which is set with the observed player's perspective at event-creation time:
- `danger` → our structure destroyed → `objectivesLost`
- `success` → enemy structure destroyed → `objectivesGained`
- `warning` (Roshan kill) → `objectivesLost` (Roshan killed during the death respawn window is always a major setback regardless of which team did it)

### API

| Method | Route | Effect |
|--------|-------|--------|
| `GET` | `/api/history/matches/:matchId/death-digest` | Returns `{ deaths: [...] }`. Each death includes `context.economy` when `radiant_gold_adv` is in cache. 404 if match not found; `deaths: []` if no `hero_death` events. |
| `GET` | `/api/history/matches/:matchId/economy-timeseries` | Returns `buildEconomyTimeseries` output for the match's player slot. 200 `{ available: false }` if match is GSI-only or cache is missing. 404 if match not found. |

### Frontend integration (`MatchHistory.jsx`)

`MatchDetail` fetches `/death-digest` in parallel with the main detail request (same `useEffect`). Results are stored in `deathDigest` state and indexed by event `id` into `digestById`. In `renderEventRow`, deaths with a matching digest entry render a "战场上下文" sub-block below the existing death detail. The block is suppressed if the fetch fails or returns no data — fallback is silent.

Death digest entries are mapped to unified Anchors by `deathToAnchor()` in `anchorChain.js` — see **Anchor Chain** section.

---

## Momentum Shift Anchors

Second class of match-analysis anchors, parallel to Death Digest (first class).
Implemented in `server/openDotaMomentumScanner.js`.

### Design principles

- **Fully decoupled from events / deaths / digest.** Takes only a `timeseries` object (output of `buildEconomyTimeseries`) as input; does not import any event, death, or digest module. Future integration into a logical chain is a separate task.
- **Minute-granularity precision** (same data-source constraint as the economy timeseries). A shift reported at minute N means the new trend direction begins there.
- **Not persisted** — computed on demand from cached data, same as economy timeseries.

### `scanMomentumShifts(timeseries) → anchors[]`

Returns anchors sorted by `minute` ASC. Each anchor:

```js
{
  minute,         // first minute of the new trend direction
  type,           // 'momentum_gain' | 'momentum_loss' (player perspective)
  slopeBefore,    // avg gold/min over the before-window (positive = our lead growing)
  slopeAfter,     // avg gold/min over the after-window
  magnitude,      // Math.abs(slopeAfter - slopeBefore)
  advAtShift,     // gold[minute].adv — economy gap at the shift point
}
```

### Algorithm (noise suppression)

For each candidate reversal at slope index `i` (where `i ≥ MIN_TREND_MINUTES` and `i ≤ slopes.length − MIN_TREND_MINUTES`):
1. `beforeSlopes` = `slopes[i−N..i−1]`, `afterSlopes` = `slopes[i..i+N−1]`
2. Compute windowed averages (`avgBefore`, `avgAfter`) — more stable than single-point slopes.
3. Both averages must be **outside FLAT_BAND** (clear direction) and **opposite sign** (true reversal).
4. `magnitude = |avgAfter − avgBefore| > MIN_SLOPE_CHANGE` (magnitude filter).
5. Every individual slope in the after-window must match `avgAfter`'s direction (persistence filter — rejects single-minute spikes).
6. Same consistency check on the before-window.

### Threshold constants (`openDotaMomentumScanner.js`)

| Constant | Default | Meaning |
|----------|---------|---------|
| `MIN_SLOPE_CHANGE` | 400 g/min | Min absolute slope change to be a real shift |
| `MIN_TREND_MINUTES` | 2 | Window size on each side of candidate reversal |
| `FLAT_BAND` | ±100 g/min | Slopes within this band are directionally neutral |

Momentum shifts are mapped to unified Anchors by `momentumToAnchor()` in `anchorChain.js` — see **Anchor Chain** section.

---

## Spike Window Delta Anchors

Third class of match-analysis anchors, parallel to Death Digest and Momentum Shifts.
Implemented in `server/openDotaSpikeWindowScanner.js`.

### Design principles

- **Fully decoupled** from event / death / digest / timeseries / momentum modules. Takes only `players[]` and `selectedPlayerSlot`; does not import any other anchor module.
- **Generic items, not profile-specific.** `server/data/genericPowerSpikeItems.js` defines 6 universal ability buckets applicable to any hero. These are intentionally separate from `offlaneHeroProfiles.js` keyItems, which are player-hero-specific progression routes. Enemy heroes have no profile, so this generic list is used for them.
- **Second-granularity** from `purchase_log` timestamps (same source as `openDotaEventBuilder`).
- **Not persisted** — computed on demand from the `players[]` array already in the raw cache.

### Ability buckets (`genericPowerSpikeItems.js`)

| Bucket | Items |
|--------|-------|
| `initiation` | blink, invis_sword, blade_mail |
| `survivability` | black_king_bar, pipe, eternal_shroud, guardian_greaves, crimson_guard, mekansm, shivas_guard, consecrated_wraps† |
| `farming` | radiance, manta, bfury, maelstrom, specialists_array† |
| `damage` | desolator, aghanims_scepter, assault, monkey_king_bar, nullifier |
| `control` | rod_of_atos, sheepstick, orchid, gleipnir, abyssal_blade |
| `support` | force_staff, glimmer_cape, lotus_orb, solar_crest |

† 7.41 new items — marked `// unverified` in source; no real parsed match in cache confirms key spelling. If wrong, update `genericPowerSpikeItems.js` when a real match is available.

### `scanSpikeWindowDeltas(players, selectedPlayerSlot) → anchors[]`

Produces **one anchor per spike item purchased by the player** (not one per bucket). For each item the player bought that belongs to any bucket, the comparison target is:
1. **Same-item**: the enemy's earliest purchase of the exact same item (preferred).
2. **Bucket fallback**: the enemy's earliest item in the same ability bucket (when no enemy bought that exact item).

Sorted by `|delta|` descending (largest gap first).

```js
{
  bucket,       // 'survivability' | 'initiation' | 'farming' | 'damage' | 'control' | 'support'
  myItem,       // item key purchased by the player (e.g. 'black_king_bar')
  myTime,       // player's purchase_log time in seconds
  enemyHero,    // display name of the matched enemy (profile heroes 中文（English）, others English)
  enemyItem,    // matched enemy item (same as myItem on exact match; different on bucket fallback)
  enemyTime,    // matched enemy's purchase_log time in seconds
  delta,        // myTime − enemyTime (positive = deficit, negative = lead)
  type,         // 'spike_deficit' (delta > 0) | 'spike_lead' (delta < 0)
  significant,  // Math.abs(delta) > SIGNIFICANT_GAP_SECONDS (default 120 s)
}
```

### Boundary conditions

- Player bought no items in any bucket → `[]`
- `purchase_log` missing or empty → `[]`
- All enemies have empty `purchase_log` (unparsed match) → `[]`
- At least one enemy has purchases but no enemy bought the same item → null-delta anchor (`type='spike_lead'`, `delta/enemyHero/enemyItem/enemyTime=null`, `significant=true`)
- Player bought multiple items in same bucket → one anchor per item
- Tie among enemies → any one of the co-earliest qualifies (order undefined for ties)
- Null-delta anchors sort last in scanner output (`|null ?? 0| = 0`); final chain order is gameTime ASC

### Threshold constant (`openDotaSpikeWindowScanner.js`)

| Constant | Default | Meaning |
|----------|---------|---------|
| `SIGNIFICANT_GAP_SECONDS` | 120 s | `|delta|` must exceed this to be flagged significant |

Spike deltas are mapped to unified Anchors by `spikeToAnchor()` in `anchorChain.js` — see **Anchor Chain** section.

---

## Anchor Chain

Convergence layer implemented in `server/anchorChain.js`. Receives the outputs of the three scanner functions as parameters and maps them to a uniform `Anchor` shape, then merges them into a single time-ordered array. Does not import any scanner module — fully decoupled.

The scanners are invoked by the endpoint in `server/index.js`, which passes their outputs to `buildAnchorChain()`.

### Unified Anchor shape

```js
{
  gameTime,   // number, seconds — primary sort key
  minute,     // number — Math.floor(gameTime / 60), auxiliary display
  kind,       // 'death' | 'momentum' | 'spike'
  type,       // original scanner type value (e.g. 'hero_death', 'momentum_loss', 'spike_deficit')
  severity,   // 'critical' | 'danger' | 'warning' | 'info' | 'success'
  summary,    // one-line Chinese human-readable description
  detail,     // original scanner object, kept verbatim for renderer use
}
```

### Severity mapping per kind

| kind | type | severity |
|------|------|----------|
| `death` | any | passthrough from the event row's own `severity` |
| `momentum` | `momentum_loss` | `warning` |
| `momentum` | `momentum_gain` | `success` |
| `spike` | `spike_deficit` (any) | `warning` — `significant` controls emphasis (bold / 显著 badge) only |
| `spike` | `spike_lead` | `success` |

### Time unit decision

`gameTime` is always **seconds** (the primary sort key). `minute` is a floored integer for display. Momentum shift anchors are produced at minute granularity — `gameTime = minute * 60` is an approximation; the actual shift happened somewhere within that minute.

### Tie-break rule (same gameTime)

`death (0) > spike (1) > momentum (2)` — "something happened" events rank before "state-change" events, which rank before "trend analysis" events. Documented in `KIND_PRIORITY` constant in `anchorChain.js`.

### Time format (`fmtTime`)

Negative `gameTime` (pre-creep-spawn) renders as `-mm:ss` (not clamped to `00:00`) so early-game events remain distinguishable.

### API

| Method | Route | Effect |
|--------|-------|--------|
| `GET` | `/api/history/matches/:matchId/anchor-chain` | Returns `{ anchors: [...] }`. Each anchor follows the shape above. 404 if match not found. Non-parsed or cache-miss input degrades each scanner to `[]` — returns partial or empty anchor list, never an error. |

Death anchors reference Death Digest — see **Death Digest feature** section.
Momentum anchors reference the scanner — see **Momentum Shift Anchors** section.
Spike anchors reference the scanner — see **Spike Window Delta Anchors** section.

### Frontend integration (`MatchHistory.jsx`)

`MatchDetail` fetches `/anchor-chain` in parallel with `/death-digest` and `/economy-timeseries` (same `useEffect`, same silent-fail pattern). Result stored in `anchorChain` state (empty array as default — no extra guard needed).

**"关键时刻" block** renders immediately above the full event timeline in match detail view. Entire block is suppressed when `anchorChain` is empty (common for GSI-only matches that have no OpenDota timeseries). When present, anchors are rendered in `gameTime` ascending order (endpoint already sorts them).

**Per-row layout:** `mm:ss` | kind icon (💀/📈/📉/⏱️) | `summary` text coloured by `severity` (critical/danger → red, warning → orange, info → grey, success → green) | expand arrow `▸`/`▾`.

**Expand detail by kind:**
- `death` — calls `renderDeathContext(anchor.detail.context)`, the same function used by the full event timeline's "战场上下文" sub-block. No duplicate implementation.
- `momentum` — inline panel: slope before/after (gold/min), magnitude, economy gap at shift point.
- `spike` — inline panel: my item + time vs enemy hero + item + time, lead/deficit formatted as mm:ss with "显著" label when `significant: true`. Item names passed through `itemDisplayName('item_' + rawKey)`.

**`renderDeathContext(ctx)`** is an extracted inner function inside `MatchDetail`. Both the event timeline and anchor chain call it. The function returns `null` when `ctx` is null or has no interesting fields (empty arrays and `diedWithBuyback == null` and no economy data).

**Degradation:** anchor-chain fetch failure → `anchorChain` stays `[]` → block absent, no error shown. GSI matches where only death anchors exist will show just death rows (no momentum/spike). That is normal.

---

## Anchor Links

Links pairs of anchors where one event plausibly caused or contributed to another.
Implemented in `server/anchorLinker.js`. Pure function — no I/O, no DB, does not import any scanner module.

### Rule A1: death → momentum_loss

Hypothesis: a hero death triggered (or was part of) the team momentum shift that followed.

**Three gates:**
1. `anchorA.kind === 'death'`
2. `anchorB.kind === 'momentum' && anchorB.type === 'momentum_loss'`
3. `gap = anchorB.gameTime − anchorA.gameTime` in `[0, GAP_THRESHOLD]` (default 300 s)

Returns `null` if any gate fails; otherwise a link object `{ rule, anchors, score, evidence }`.

### `isLethalDeath(deathAnchor)`

Determines whether a death anchor carries measurable downstream consequences available from OpenDota import data. Three OR signals:

| Signal | Source | Notes |
|--------|--------|-------|
| `context.chainDeaths.length > 0` | death digest context | Other deaths in the ±5s/+60s window — teamwipe cascade |
| `context.economy.available && context.economy.significant` | death digest economy delta | Economy advantage deteriorated significantly around the death minute |
| `severity === 'critical'` | GSI only | OD imports are always `'danger'` — this branch is always `false` for imports; kept for GSI compatibility |

`context` guard fires first: if `detail.context` is null/absent, returns `false` regardless of severity.

### `scoreA1(deathAnchor, gap) → 'strong' | 'medium' | 'weak'`

| `near` (gap ≤ 45 s) | `lethal` | score |
|---------------------|----------|-------|
| true | true | **strong** |
| true | false | medium |
| false | true | medium |
| false | false | weak |

**Key:** the `'strong'` tier is now reachable for OpenDota imports via `chainDeaths` or `economy.significant`. The previous `severity === 'critical'`-only approach permanently capped OD imports at `'medium'`.

### `evidence` fields

```js
{
  gap_seconds:         number,   // anchorB.gameTime − anchorA.gameTime
  death_severity:      string,   // 'danger' | 'critical'
  chain_deaths:        number,   // ctx.chainDeaths.length (0 if absent)
  economy_significant: boolean,  // ctx.economy.available && ctx.economy.significant
  lethal:              boolean,  // isLethalDeath(anchorA)
  slope_after:         number,   // anchorB.detail.slopeAfter
  magnitude:           number,   // anchorB.detail.magnitude
}
```

### Exported API

`isLethalDeath`, `scoreA1`, `ruleA1`, `GAP_THRESHOLD`

### Backend wiring (`server/index.js`)

After building the anchor chain, the `/anchor-chain` endpoint iterates over all death-then-momentum pairs within `GAP_THRESHOLD` seconds, calls `ruleA1(a, b)`, and collects the results into a `links[]` array. The endpoint now returns `{ anchors, links }` (links defaults to `[]` for GSI-only or un-parsed matches).

Each link shape:
```js
{ from, to, rule, relation, confidence, evidence }
// from/to: gameTime in seconds
// relation: 'death_triggered_collapse'
// confidence: 'strong' | 'medium' | 'weak'
// evidence: { gap_seconds, death_severity, chain_deaths, economy_significant, lethal, slope_after, magnitude }
```

### Frontend integration (`MatchHistory.jsx`)

**Module-level constants (add to `RELATION_META` for new rules):**
```js
const RELATION_META = {
  death_triggered_collapse: {
    fromKind:  'death',
    toKind:    'momentum',
    fromBadge: '⚡ 引发经济崩盘',        // shown on the death anchor
    toBadge:   (l) => `← 源于 mm:ss 的死亡`,  // shown on the momentum_loss anchor
    cardTitle: (l) => `mm:ss 阵亡 → mm:ss 经济崩盘`,
  },
  // Add A2, A3… here; all frontends pick them up automatically
};
```

**`CONFIDENCE_STYLE`** maps `'strong' | 'medium' | 'weak'` → `{ color, bg, border, label }`. Strong uses red, medium amber, weak muted grey.

**`CausalBadge`** — inline span component. Renders with solid background (strong/medium) or outline-only (weak). Active state (outline glow + bold) when its link is `activeLink`.

**State in `MatchDetail`:**
- `anchorLinks` — from API `links[]`; empty until fetch completes
- `activeLink` — string key `"${rule}-${from}-${to}"` or null; toggles on badge/card click
- `expandedCards` — Set of card keys whose evidence panel is open

**Preprocessing (computed each render, not state):**
- `linksByFrom[gameTime]` and `linksByTo[gameTime]` — O(1) lookup per anchor row
- `linkKey(link)` — stable string key `${rule}-${from}-${to}`

**Anchor chain row enhancements:**
- Highlighted border/bg (`#79c0ff33` / `#79c0ff09`) when the row's gameTime participates in `activeLink`
- `CausalBadge` inserted between summary text and expand arrow
  - `fromLinks` → `fromBadge` text; `toLinks` → `toBadge(link)` text
  - Kind-filtered disambiguation: same-gameTime anchors of different kinds don't steal each other's badges
- **Inline evidence panel** appears below the row (regardless of expand state) when `activeLink` targets this anchor. Shows: gap_seconds, chain_deaths (if >0), economy_significant (if true), magnitude.

**`逻辑链` cards section** (rendered after the anchor chain block):
- Hidden when `anchorLinks` is empty — no error, no empty state UI
- Each card: title from `cardTitle(link)`, confidence label, expand arrow (independent of `activeLink`)
- Clicking card header → toggle `activeLink` (highlights both timeline ends)
- Clicking expand arrow → toggle `expandedCards` (shows evidence breakdown, stops propagation)
- Evidence items: gap_seconds, chain_deaths (if >0), economy_significant (if true), magnitude

**Degradation:**
- GSI matches / unparsed imports → `links: []` → no badges, no cards, existing behavior unchanged
- `anchor-chain` fetch failure → both `anchorChain` and `anchorLinks` stay `[]` → full block absent

---

## Future roadmap

### Near-term
- **Real GSI format verification**: Capture one live GSI payload and confirm flat vs. nested item layout, then remove the nested branch from `normalizeItems` if it's never used.
- **EventTimeline in MatchHistory**: The historical match detail page shows death event messages but no snapshot expansion. Add an expandable `DeathDetail` panel (reuse the component from EventTimeline).

### Medium-term
- **`extractItemStateForProgression` integration**: The pure function in `server/utils/itemProgression.js` was scaffolded for inferring next key item from death snapshots. Wire it into a multi-death analysis to improve key item suggestions beyond the fixed profile ordering.
- **Minimap / position data**: If GSI adds position data, track lane presence and warn on unsafe positioning.
- **More heroes**: Expand hero pool beyond the current 7. Priorities: Dragon Knight, Bristleback, Mars, Underlord.
- **Patch-aware item costs**: `ITEM_COSTS` values are hardcoded and drift with patches. Consider a lightweight patch-version check or a community-maintained JSON source.

### Long-term
- **Replay import**: Parse `.dem` files offline to generate event timelines and post-game summaries without a live GSI connection.
- **Cross-match pattern detection**: Identify repeating death patterns (e.g., always dying at the same clock time, always dying without TP) across multiple matches and surface as long-term coaching advice.
- **Export / share**: Let the player export a match's event timeline as a shareable text or image summary.

---

## File map (current)

```
dota-ai-coach/
├── CLAUDE.md                          ← this file
├── gamestate_integration_coach.cfg    ← copy to Dota 2 GSI folder
├── server/
│   ├── index.js                       ← dual Express servers (3000 GSI / 3001 API)
│   ├── db.js                          ← SQLite layer (better-sqlite3, synchronous)
│   ├── rules.js                       ← rule coordinator, 60 s cooldown
│   ├── eventLogger.js                 ← in-memory event log + PostGame summary
│   ├── matchConfig.js                 ← in-process config (hero, playstyle, override)
│   ├── matchHistory.js                ← persistMatch() + computeKeyItemTimings()
│   ├── suggestKeyItem.js              ← pure function: next key item inference
│   ├── matchImporter.js               ← Import Match: OpenDota fetch + event reconstruction
│   ├── openDotaRawService.js          ← Raw cache layer: fetch → raw_opendota_matches table
│   ├── openDotaEventBuilder.js        ← Pure: buildEventsFromOpenDota() → match_events[]
│   ├── openDotaKillDeathExtractor.js  ← Pure: extractKillDeath(players, slot) → {kills, deaths, deathStats}
│   ├── openDotaDeathDigest.js         ← Pure: buildDeathDigest(events, timeseries?) → hero_death[] with .context windows + economy delta
│   ├── openDotaEconomyTimeseries.js   ← Pure: buildEconomyTimeseries(raw, slot) + economyDeltaAroundDeath(ts, t)
│   ├── openDotaMomentumScanner.js     ← Pure: scanMomentumShifts(timeseries) — decoupled anchor scanner
│   ├── anchorChain.js                 ← Pure convergence layer: deathToAnchor / momentumToAnchor / spikeToAnchor + buildAnchorChain()
│   ├── anchorLinker.js                ← Pure link detector: isLethalDeath / scoreA1 / ruleA1 + GAP_THRESHOLD
│   ├── coach.db                       ← SQLite database (auto-created)
│   ├── data/
│   │   ├── offlaneHeroProfiles.js     ← 7 profiles, ITEM_COSTS, ITEM_DISPLAY_NAMES
│   │   └── itemLocalization.js        ← 90+ item Chinese names, getDisplayName()
│   ├── rules/
│   │   ├── commonRules.js             ← 7 universal rules
│   │   ├── offlaneRules.js            ← offlane-specific rules
│   │   └── archetypeRules.js          ← per-archetype coaching
│   ├── utils/
│   │   ├── gsiNormalizer.js           ← normalizeItems() — flat vs. nested GSI
│   │   └── itemProgression.js         ← extractItemStateForProgression() (pure)
│   └── tests/
│       ├── eventLogger.test.js        ← 53 assertions
│       ├── matchHistory.test.js       ← 79 assertions
│       ├── suggestKeyItem.test.js     ← 18 assertions
│       ├── matchImporter.test.js      ← 39 assertions (pure helpers only)
│       ├── openDotaRaw.test.js        ← 47 assertions (mock network, DB round-trip)
│       ├── importPreview.test.js      ← 53 assertions (getHeroName, buildPreview)
│       ├── importConfirm.test.js          ← 104 assertions (normalizeForMatch, confirmImport + events + deathStats + kill/death + pre_key_item_deaths)
│       ├── openDotaKeyItemAnalyzer.test.js ← 67 assertions (buildPurchaseMap, analyzeKeyItemTimings + deathTimes, countPreKeyItemDeaths, GSI cross-validation)
│       ├── openDotaEventBuilder.test.js         ← 162 assertions (isConsumable, buildEventsFromOpenDota, buildKillDeathEvents, buildObjectiveEvents)
│       ├── openDotaKillDeathExtractor.test.js   ← 60 assertions (heroDisplayNameFromInternal, extractKillDeath)
│       ├── openDotaDeathDigest.test.js          ← 61 assertions (buildDeathDigest, window, chainDeaths, objectives, diedWithBuyback)
│       ├── openDotaEconomyTimeseries.test.js    ← 86 assertions (buildEconomyTimeseries, economyDeltaAroundDeath, digest integration)
│       ├── openDotaMomentumScanner.test.js      ← 63 assertions (decoupling, degenerate, V-shape, spike filter, multi-shift)
│       ├── openDotaSpikeWindowScanner.test.js   ← 89 assertions (decoupling, spike_lead/deficit, multi-item per-item, null-delta unique, fastest enemy, sort, significant)
│       ├── anchorChain.test.js                  ← 93 assertions (decoupling, all mappers, merge sort, tie-break, shape)
│       ├── anchorLinker.test.js                 ← 68 assertions (decoupling, isLethalDeath, scoreA1, ruleA1 gates + evidence)
│       └── mockGSI.json               ← Centaur 10-min mock payload (nested format)
└── client/src/
    ├── App.jsx                        ← 3-tab navigation (live / history / trends)
    ├── heroItemNames.js               ← ESM: ITEM_ZH, HERO_ZH, itemDisplayName()
    └── components/
        ├── GameState.jsx
        ├── Alerts.jsx
        ├── OfflaneSetup.jsx
        ├── EventTimeline.jsx          ← live timeline + DeathDetail + PostGameSummary
        ├── MatchHistory.jsx           ← past matches list + detail
        └── LongTermTrends.jsx         ← aggregate stats
```
