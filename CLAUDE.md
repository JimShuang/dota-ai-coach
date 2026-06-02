# CLAUDE.md — Dota 2 Offlane AI Coach

Project guide for Claude Code. Update this file after every significant feature.

---

## Constraints (non-negotiable)

- **No LLM API calls** — all coaching is rule-based.
- **No game memory reads, CV/OCR, or replay parsing.**
- **No automatic game control.**
- **Only allowed inputs:** Dota 2 GSI (HTTP POST to localhost:3000), user manual config, local rule system.
- **Role scope:** Offlane (Position 3) only.

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
| `server/rules/commonRules.js` | 7 universal rules (TP, wards, gold, last hits, buyback…) |
| `server/rules/offlaneRules.js` | Offlane-specific rules (key item near-complete, spike unused…) |
| `server/rules/archetypeRules.js` | Archetype-specific coaching (initiator, bully, aura…) |

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

| type | trigger | severity |
|------|---------|----------|
| `hero_death` | `hero.alive` true → false | `critical` \| `danger` |
| `hero_respawn` | `hero.alive` false → true | `info` |
| `item_purchased` | new item appears in allItemNames | `info` |
| `key_item_completed` | key route item newly appears | `info` |
| `key_item_near_completion` | gold gap < 600 to next key item | `warning` |
| `power_spike_started` | powerSpikeItem completed | `info` |
| `power_spike_unused` | spike item completed 3 min with no K/A growth | `warning` |
| `no_tp_warning` | TP missing > 60 s (after 5 min) | `warning` |
| `low_farm_window` | GPM dropped ≥15% in 3 min with no K/A | `warning` |
| `game_end` | `map.game_state` = `DOTA_GAMERULES_STATE_POST_GAME` | `success` \| `danger` |

### `hero_death` snapshot fields

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
```

`INSERT OR IGNORE` + in-memory `persistedIds` Set prevent duplicate persistence across multiple POST_GAME ticks.

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

### 11. Exclude Match never deletes raw data
`excludeMatch()` only sets `is_excluded = 1` on the `matches` row. All associated `match_events` and `key_item_timings` rows are intentionally left untouched. Excluded matches are hidden from `getMatches()` (default) and all `getLongTermStats()` sub-queries, but `getMatchById()` still returns full detail regardless of exclusion state.

---

## Test suite

```
server/tests/
  suggestKeyItem.test.js   18 assertions — pure function, no I/O
  matchHistory.test.js     79 assertions — computeKeyItemTimings, SQLite round-trip, exclude/include
  eventLogger.test.js      53 assertions — death snapshot, item fields, normalizeItems
```

Run with: `node server/tests/<file>.test.js`

All 150 assertions must pass before merging any change.

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

## Exclude Match feature

Allows users to mark specific matches as excluded so they don't pollute stats (e.g., bot games, dev tests, corrupted data).

### Data safety invariant
**Never deletes events or timings.** Only `matches.is_excluded` changes. All `match_events` and `key_item_timings` rows are preserved.

### API

| Method | Route | Body | Effect |
|--------|-------|------|--------|
| `GET` | `/api/history/matches?includeExcluded=true` | — | Returns all matches including excluded |
| `POST` | `/api/history/matches/:matchId/exclude` | `{ reason }` | Sets `is_excluded=1`, records `excluded_at` and `excluded_reason` |
| `POST` | `/api/history/matches/:matchId/include` | — | Resets `is_excluded=0`, clears `excluded_at`/`excluded_reason` |

Valid `reason` values: `bot_test`, `unranked`, `development_test`, `corrupted_data`, `duplicate`, `other`.

### DB functions (`server/db.js`)

- `excludeMatch(matchId, reason)` — UPDATE only; returns `{ changes }` (0 if not found)
- `includeMatch(matchId)` — reverses exclusion
- `getMatches(limit, includeExcluded=false)` — filters `WHERE is_excluded = 0` by default
- `getLongTermStats(recentCount)` — all sub-queries filter `AND is_excluded = 0`

### UI (`client/src/components/MatchHistory.jsx`)

- **"显示已排除" checkbox** at top of list — re-fetches with `includeExcluded=true`
- **Excluded match rows** — 55% opacity, "已排除" badge, no click-through to detail, "恢复" button
- **Non-excluded rows** — "排除" button (stops propagation so row click still works)
- **Exclude dialog** — fixed overlay modal with reason `<select>` dropdown + confirm/cancel

### Migration
`server/db.js` runs `ALTER TABLE matches ADD COLUMN ...` (with try-catch) on startup so existing `coach.db` files without the new columns are migrated automatically.

---

## Future roadmap

### Near-term
- **Ward reminder GSI fix**: `commonRules.js` `ward_reminder` now uses `normalizeItems()` but Dota 2 may not send ward items in the GSI payload at all — verify with real game data.
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
