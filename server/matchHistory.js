// Match persistence: saves completed match data to SQLite.
// Called once per match when game_end event is detected.

const {
  matchExists, saveMatch, saveMatchEvents, saveKeyItemTimings,
} = require('./db');

// Prevent duplicate saves across multiple POST_GAME ticks
const persistedIds = new Set();

// ── Key item timing computation ────────────────────────────────────────────

function computeKeyItemTimings(matchId, heroProfile, allEvents) {
  if (!heroProfile?.keyItems) return [];

  const deaths = allEvents.filter((e) => e.type === 'hero_death');
  const keyCompleted = allEvents.filter((e) => e.type === 'key_item_completed');
  const spikeUnused = allEvents.filter((e) => e.type === 'power_spike_unused');

  return heroProfile.keyItems.map((item) => {
    const completedEvent = keyCompleted.find((e) => e.snapshot?.item === item);
    const completed = !!completedEvent;
    const completedTime = completedEvent?.game_time ?? null;

    // Deaths that happened before this item was completed
    const deathsBefore = completed
      ? deaths.filter((e) => e.game_time < completedTime).length
      : deaths.length;

    // Power spike used: item is a spike item, was completed, and no
    // power_spike_unused event fired within 5 minutes of completion
    const isPowerSpikeItem = heroProfile.powerSpikeItems?.includes(item) ?? false;
    let powerSpikeUsed = 0;
    if (isPowerSpikeItem && completed) {
      const unusedInWindow = spikeUnused.some(
        (e) => e.game_time >= completedTime && e.game_time <= completedTime + 300
      );
      powerSpikeUsed = unusedInWindow ? 0 : 1;
    }

    return {
      match_id: matchId,
      item_name: item,
      completed: completed ? 1 : 0,
      completed_time: completedTime,
      deaths_before_completion: deathsBefore,
      power_spike_used: powerSpikeUsed,
    };
  });
}

// ── Main persistence function ──────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}   opts.matchId
 * @param {object}   opts.summary       - from getOfflanieSummary()
 * @param {object[]} opts.allEvents     - from getEvents()
 * @param {object}   opts.config        - from getConfig()
 * @param {object}   opts.heroProfile   - from getProfileByDotaName()
 * @param {number}   opts.startRealTime - Date.now() at match start (ms)
 */
function persistMatch({ matchId, summary, allEvents, config, heroProfile, startRealTime }) {
  if (!matchId || matchId === '0') return;
  if (persistedIds.has(matchId)) return;

  if (matchExists(matchId)) {
    persistedIds.add(matchId);
    return;
  }

  try {
    const stats = summary?.stats || {};
    const da = summary?.death_analysis || {};
    const ta = summary?.tempo_analysis || {};
    const endRealTime = Date.now();
    const duration = startRealTime
      ? Math.round((endRealTime - startRealTime) / 1000)
      : null;

    saveMatch({
      match_id:              matchId,
      hero:                  config.hero || null,
      role:                  'offlane',
      archetype:             heroProfile?.archetype || null,
      playstyle:             config.playstyle || null,
      result:                summary?.result || '未知',
      start_time:            startRealTime ? Math.round(startRealTime / 1000) : null,
      end_time:              Math.round(endRealTime / 1000),
      duration,
      kills:                 stats.kills  || 0,
      deaths:                stats.deaths || 0,
      assists:               stats.assists || 0,
      gpm:                   stats.gpm    || 0,
      xpm:                   stats.xpm    || 0,
      last_hits:             stats.last_hits || 0,
      denies:                stats.denies   || 0,
      final_gold:            stats.gold     || 0,
      suggested_key_item:    config.keyItemOverride
                               ? null
                               : (summary?.key_item_analysis?.[0]?.item || null),
      user_override_key_item: config.keyItemOverride || null,
      overall_grade:          summary?.grade || null,
      one_thing_to_improve:   summary?.one_thing_to_improve || null,
      pre_key_item_deaths:    da.pre_key_item   || 0,
      spike_unused_count:     ta.spike_unused_count || 0,
      low_farm_windows:       ta.low_farm_windows   || 0,
    });

    saveMatchEvents(matchId, allEvents);

    const timings = computeKeyItemTimings(matchId, heroProfile, allEvents);
    saveKeyItemTimings(matchId, timings);

    persistedIds.add(matchId);
    console.log(`[HISTORY] Saved match ${matchId} — ${summary?.result}, grade: ${summary?.grade}`);
  } catch (err) {
    console.error('[HISTORY] Persist failed:', err.message);
  }
}

module.exports = { persistMatch, computeKeyItemTimings };
