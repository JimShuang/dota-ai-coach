// Match event logger — detects and accumulates structured timeline events.
// State resets automatically when match_id changes.

const { getDisplayName } = require('./data/itemLocalization');
const { normalizeItems } = require('./utils/gsiNormalizer');

// ── Module-level state ─────────────────────────────────────────────────────

let events = [];
let currentMatchId = null;
let prevData = null;

// Last tick where hero was alive — used for pre-death-penalty gold/items
let latestAliveSnapshot = null;

// TP-missing episode tracking
let tpMissingStart = null;
let tpMissingFired = false;

// GPM history ring-buffer: { clock, gpm }[]
let gpmHistory = [];

// Power spike state
let powerSpike = {
  active: false,
  itemName: null,      // display name
  itemKey: null,       // internal name
  startClock: null,
  startKA: null,
  unusedFired: false,
};

// Low farm window state
let lastFarmCheck = { clock: 0, gpm: 0, ka: 0 };

// ── Helpers ────────────────────────────────────────────────────────────────

function resetForMatch(matchId) {
  events = [];
  currentMatchId = matchId;
  prevData = null;
  latestAliveSnapshot = null;
  tpMissingStart = null;
  tpMissingFired = false;
  gpmHistory = [];
  powerSpike = { active: false, itemName: null, itemKey: null, startClock: null, startKA: null, unusedFired: false };
  lastFarmCheck = { clock: 0, gpm: 0, ka: 0 };
}

// Inventory slots 0–5: explicit presence, null for empty
function buildInventoryAtDeath(slotObj) {
  const out = {};
  for (let i = 0; i <= 5; i++) {
    const key = `slot${i}`;
    const item = slotObj?.[key];
    out[key] = (item?.name && !item.name.includes('empty')) ? item.name : null;
  }
  return out;
}

// Backpack slots 6–8: explicit presence, null for empty
function buildBackpackAtDeath(slotObj) {
  const out = {};
  for (let i = 6; i <= 8; i++) {
    const key = `slot${i}`;
    const item = slotObj?.[key];
    out[key] = (item?.name && !item.name.includes('empty')) ? item.name : null;
  }
  return out;
}

// Stash: only non-empty slots
function buildStashAtDeath(stashObj) {
  const out = {};
  for (const [key, item] of Object.entries(stashObj || {})) {
    out[key] = (item?.name && !item.name.includes('empty')) ? item.name : null;
  }
  return out;
}

// Rich per-item objects covering inventory, backpack, stash, and neutral
function buildItemDetails(slotObj, stashObj, neutralObj) {
  const details = [];

  for (let i = 0; i <= 5; i++) {
    const item = slotObj?.[`slot${i}`];
    if (item?.name && !item.name.includes('empty')) {
      details.push({
        slot: `slot${i}`,
        internalName: item.name,
        displayName:  getDisplayName(item.name),
        cooldown:     item.cooldown  ?? 0,
        charges:      item.charges   ?? null,
        isInventory:  true,
        isBackpack:   false,
        isStash:      false,
        isNeutral:    false,
        isTeleport:   item.name === 'item_tpscroll',
      });
    }
  }

  for (let i = 6; i <= 8; i++) {
    const item = slotObj?.[`slot${i}`];
    if (item?.name && !item.name.includes('empty')) {
      details.push({
        slot: `slot${i}`,
        internalName: item.name,
        displayName:  getDisplayName(item.name),
        cooldown:     item.cooldown  ?? 0,
        charges:      item.charges   ?? null,
        isInventory:  false,
        isBackpack:   true,
        isStash:      false,
        isNeutral:    false,
        isTeleport:   item.name === 'item_tpscroll',
      });
    }
  }

  for (const [key, item] of Object.entries(stashObj || {})) {
    if (item?.name && !item.name.includes('empty')) {
      details.push({
        slot: key,
        internalName: item.name,
        displayName:  getDisplayName(item.name),
        cooldown:     item.cooldown  ?? 0,
        charges:      item.charges   ?? null,
        isInventory:  false,
        isBackpack:   false,
        isStash:      true,
        isNeutral:    false,
        isTeleport:   item.name === 'item_tpscroll',
      });
    }
  }

  const neutralArr = Object.values(neutralObj || {}).filter((i) => i?.name && !i.name.includes('empty'));
  if (neutralArr.length > 0) {
    const item = neutralArr[0];
    details.push({
      slot: 'neutral0',
      internalName: item.name,
      displayName:  getDisplayName(item.name),
      cooldown:     item.cooldown  ?? 0,
      charges:      item.charges   ?? null,
      isInventory:  false,
      isBackpack:   false,
      isStash:      false,
      isNeutral:    true,
      isTeleport:   false,
    });
  }

  return details;
}

function allItemNames(data) {
  const { slot, stash } = normalizeItems(data.items);
  return [
    ...Object.values(slot),
    ...Object.values(stash),
  ]
    .filter((i) => i && i.name && !i.name.includes('empty'))
    .map((i) => i.name);
}

function hasTp(data) {
  return allItemNames(data).includes('item_tpscroll');
}

function makeSnapshot(data, ctx) {
  const p = data.player || {};
  const h = data.hero || {};
  const itemNames = allItemNames(data);
  const keyItemNames = ctx?.heroProfile?.keyItems || [];
  return {
    gold: p.gold,
    net_worth: p.net_worth,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    last_hits: p.last_hits,
    gpm: p.gpm,
    xpm: p.xpm,
    level: h.level,
    items: itemNames,
    keyItems: keyItemNames.filter((k) => itemNames.includes(k)),
  };
}

// Build a rich death snapshot using the last alive tick for pre-penalty gold/items.
function makeDeathSnapshot(data, clock, ctx) {
  const alive = latestAliveSnapshot || data;
  const ap = alive.player || {};
  const ai = normalizeItems(alive.items);

  const inventoryAtDeath   = buildInventoryAtDeath(ai.slot);
  const backpackAtDeath    = buildBackpackAtDeath(ai.slot);
  const stashAtDeath       = buildStashAtDeath(ai.stash);
  const itemDetailsAtDeath = buildItemDetails(ai.slot, ai.stash, ai.neutral);

  // Flat list: all non-empty items across inventory + backpack + stash + neutral
  const itemsAtDeath = [
    ...Object.values(ai.slot    || {}),
    ...Object.values(ai.stash   || {}),
    ...Object.values(ai.neutral || {}),
  ].filter((i) => i?.name && !i.name.includes('empty')).map((i) => i.name);

  const tpObj = [...Object.values(ai.slot || {}), ...Object.values(ai.stash || {})]
    .find((i) => i?.name === 'item_tpscroll') || null;
  const hadTp = tpObj !== null;

  const neutralArr = Object.values(ai.neutral || {}).filter((i) => i?.name && !i.name.includes('empty'));
  const neutralItem = neutralArr[0]?.name || null;

  const { suggested } = ctx || {};
  const goldBefore = ap.gold ?? 0;
  const ownedSet = new Set(itemsAtDeath);
  const preKeyItem = !!(suggested?.suggestedKeyItem && !ownedSet.has(suggested.suggestedKeyItem));
  const goldToKey = (suggested?.cost && preKeyItem) ? Math.max(0, suggested.cost - goldBefore) : null;
  const wasNearKey = goldToKey !== null && goldToKey < 600;
  const inSpike = powerSpike.active;

  return {
    goldBeforeDeathPenalty:            goldBefore,
    currentGoldAfterDeathIfAvailable:  data.player?.gold ?? null,
    itemsAtDeath,
    inventoryAtDeath,
    backpackAtDeath,
    stashAtDeath,
    neutralItemAtDeath:                neutralItem,
    tpAtDeath:                         tpObj ? { name: tpObj.name, charges: tpObj.charges ?? null } : null,
    itemDetailsAtDeath,
    keyItemAtDeath:                    suggested?.suggestedKeyItem || null,
    goldToKeyItemAtDeath:              goldToKey,
    gpmAtDeath:                        ap.gpm || 0,
    xpmAtDeath:                        ap.xpm || 0,
    killsAtDeath:                      ap.kills || 0,
    deathsAtDeath:                     ap.deaths || 0,
    assistsAtDeath:                    ap.assists || 0,
    gameTimeAtDeath:                   clock,
    wasNearKeyItem:                    wasNearKey,
    wasInPowerSpikeWindow:             inSpike,
    hadTpAtDeath:                      hadTp,
    // Backward-compat aliases used by buildSummary and EventTimeline
    pre_key_item:          preKeyItem,
    gold_gap_to_key_item:  goldToKey,
    in_power_spike:        inSpike,
    has_tp:                hadTp,
  };
}

function push(event) {
  events.push(event);
}

function lastEventOfType(type) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) return events[i];
  }
  return null;
}

// ── Event detectors ────────────────────────────────────────────────────────

function detectHeroDeath(data, clock, ctx) {
  if (!prevData) return;
  if (!(data.hero?.alive === false && prevData.hero?.alive !== false)) return;

  const snap = makeDeathSnapshot(data, clock, ctx);
  const { suggested } = ctx || {};

  let severity = 'danger';
  let context = '';

  if (snap.pre_key_item && snap.gold_gap_to_key_item !== null && snap.gold_gap_to_key_item < 600) {
    severity = 'critical';
    context = `关键装备 ${suggested?.displayName || snap.keyItemAtDeath} 差 ${snap.gold_gap_to_key_item} 金，可能严重拖慢节奏`;
  } else if (snap.in_power_spike) {
    context = `强势期（${powerSpike.itemName || '关键装备'}完成后）死亡，可能浪费关键 timing`;
  }

  const noTpNote = !snap.has_tp ? '（当时无传送卷轴）' : '';

  push({
    game_time: clock,
    type: 'hero_death',
    severity,
    message: [
      `英雄阵亡（第 ${data.player?.deaths || 0} 次）`,
      context,
      noTpNote,
    ].filter(Boolean).join(' — '),
    snapshot: snap,
  });
}

function detectHeroRespawn(data, clock, ctx) {
  if (!prevData) return;
  if (!(data.hero?.alive === true && prevData.hero?.alive === false)) return;
  push({
    game_time: clock,
    type: 'hero_respawn',
    severity: 'info',
    message: '英雄复活',
    snapshot: makeSnapshot(data, ctx),
  });
}

function detectItemPurchased(data, clock, ctx) {
  if (!prevData) return;
  const prevSet = new Set(allItemNames(prevData));
  const logged = new Set();
  for (const name of allItemNames(data)) {
    if (!prevSet.has(name) && !logged.has(name)) {
      const label = getDisplayName(name);
      push({
        game_time: clock,
        type: 'item_purchased',
        severity: 'info',
        message: `购入道具：${label}`,
        snapshot: { ...makeSnapshot(data, ctx), item: name },
      });
      logged.add(name);
    }
  }
}

function detectKeyItemEvents(data, clock, ctx) {
  if (!prevData) return;
  const { heroProfile, suggested } = ctx || {};
  if (!heroProfile) return;

  const prevOwned = new Set(allItemNames(prevData));
  const currOwned = new Set(allItemNames(data));

  // Check if a key item was just completed
  for (const item of heroProfile.keyItems) {
    if (!prevOwned.has(item) && currOwned.has(item)) {
      const displayName = getDisplayName(item);
      push({
        game_time: clock,
        type: 'key_item_completed',
        severity: 'info',
        message: `关键装备完成：${displayName}`,
        snapshot: { ...makeSnapshot(data, ctx), item },
      });

      // Check if this is a power spike item
      if (heroProfile.powerSpikeItems.includes(item)) {
        const ka = (data.player?.kills || 0) + (data.player?.assists || 0);
        powerSpike = {
          active: true,
          itemName: displayName,
          itemKey: item,
          startClock: clock,
          startKA: ka,
          unusedFired: false,
        };
        push({
          game_time: clock,
          type: 'power_spike_started',
          severity: 'info',
          message: `强势期开始：${displayName} 已完成，现在可以找节奏/逼塔`,
          snapshot: makeSnapshot(data, ctx),
        });
      }
    }
  }

  // Key item near completion
  if (suggested?.suggestedKeyItem && suggested.cost) {
    const alreadyHas = currOwned.has(suggested.suggestedKeyItem);
    if (!alreadyHas) {
      const gold = data.player?.gold || 0;
      const gap = suggested.cost - gold;
      if (gap > 0 && gap < 600) {
        const last = lastEventOfType('key_item_near_completion');
        if (!last || clock - last.game_time > 90) {
          push({
            game_time: clock,
            type: 'key_item_near_completion',
            severity: 'warning',
            message: `关键装备 ${suggested.displayName} 差 ${gap} 金即可完成，稳住走位`,
            snapshot: { ...makeSnapshot(data, ctx), gold_gap: gap },
          });
        }
      }
    }
  }
}

function detectPowerSpikeUnused(data, clock) {
  if (!powerSpike.active || powerSpike.unusedFired) return;
  if (clock - powerSpike.startClock < 180) return;
  const currentKA = (data.player?.kills || 0) + (data.player?.assists || 0);
  if (currentKA <= powerSpike.startKA) {
    push({
      game_time: clock,
      type: 'power_spike_unused',
      severity: 'warning',
      message: `${powerSpike.itemName || '关键装备'} 完成 3 分钟内没有转化为节奏，考虑和队友找机会`,
      snapshot: {
        kills: data.player?.kills,
        assists: data.player?.assists,
        spike_start_clock: powerSpike.startClock,
        spike_item: powerSpike.itemName,
      },
    });
    powerSpike.unusedFired = true;
  }
}

function detectTpMissing(data, clock, ctx) {
  if (clock <= 300) return;
  if (!hasTp(data)) {
    if (tpMissingStart === null) {
      tpMissingStart = clock;
      tpMissingFired = false;
    } else if (!tpMissingFired && clock - tpMissingStart > 60) {
      push({
        game_time: clock,
        type: 'no_tp_warning',
        severity: 'warning',
        message: `传送卷轴缺失已超过 ${Math.floor(clock - tpMissingStart)} 秒`,
        snapshot: { ...makeSnapshot(data, ctx), missing_since: tpMissingStart },
      });
      tpMissingFired = true;
    }
  } else {
    tpMissingStart = null;
    tpMissingFired = false;
  }
}

function detectGpmDrop(data, clock, ctx) {
  const gpm = data.player?.gpm || 0;
  gpmHistory.push({ clock, gpm });
  if (gpmHistory.length > 150) gpmHistory.shift();

  if (clock <= 360 || gpm === 0) return;

  const refEntry = gpmHistory.find((e) => e.clock >= clock - 180);
  if (!refEntry || refEntry.gpm < 300) return;
  if (gpm >= refEntry.gpm * 0.8) return;

  const last = lastEventOfType('gpm_drop');
  if (last && clock - last.game_time < 120) return;

  push({
    game_time: clock,
    type: 'gpm_drop',
    severity: 'warning',
    message: `GPM 明显下滑：${Math.round(refEntry.gpm)} → ${Math.round(gpm)}（近 3 分钟）`,
    snapshot: { ...makeSnapshot(data, ctx), gpm_ref: refEntry.gpm, gpm_ref_clock: refEntry.clock },
  });
}

function detectLowFarmWindow(data, clock, ctx) {
  if (clock < 600) return;
  // Check every ~180 seconds
  if (clock - lastFarmCheck.clock < 170) return;

  const gpm = data.player?.gpm || 0;
  const ka = (data.player?.kills || 0) + (data.player?.assists || 0);

  if (
    lastFarmCheck.gpm > 300 &&
    gpm < lastFarmCheck.gpm * 0.85 &&
    ka === lastFarmCheck.ka
  ) {
    push({
      game_time: clock,
      type: 'low_farm_window',
      severity: 'warning',
      message: `这段时间经济增长放缓（GPM ${Math.round(lastFarmCheck.gpm)} → ${Math.round(gpm)}），且没有节奏收益，考虑重新选择补刀/带线区域`,
      snapshot: makeSnapshot(data, ctx),
    });
  }

  lastFarmCheck = { clock, gpm, ka };
}

function detectGameEnd(data, clock, ctx) {
  if (data.map?.game_state !== 'DOTA_GAMERULES_STATE_POST_GAME') return;
  if (lastEventOfType('game_end')) return;
  const win = data.map?.win_team && data.map.win_team === data.player?.team_name;
  push({
    game_time: clock,
    type: 'game_end',
    severity: win ? 'success' : 'danger',
    message: `比赛结束 — ${win ? '胜利' : '失败'}`,
    snapshot: makeSnapshot(data, ctx),
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * @param {object} data - GSI payload
 * @param {object} [ctx] - { heroProfile, suggested, config }
 */
function logEvents(data, ctx = {}) {
  const clock = data.map?.clock_time || 0;
  const matchId = String(data.map?.matchid || '0');

  if (matchId !== currentMatchId) {
    resetForMatch(matchId);
  }

  // Track the last alive tick BEFORE death detection so makeDeathSnapshot gets pre-penalty values
  if (data.hero?.alive === true) {
    latestAliveSnapshot = data;
  }

  detectHeroDeath(data, clock, ctx);
  detectHeroRespawn(data, clock, ctx);
  detectItemPurchased(data, clock, ctx);
  detectKeyItemEvents(data, clock, ctx);
  detectPowerSpikeUnused(data, clock);
  detectTpMissing(data, clock, ctx);
  detectGpmDrop(data, clock, ctx);
  detectLowFarmWindow(data, clock, ctx);
  detectGameEnd(data, clock, ctx);

  prevData = data;
}

function getEvents() {
  return [...events];
}

function getPowerSpikeState() {
  return { ...powerSpike };
}

function getSummary() {
  return buildSummary(null);
}

function getOfflanieSummary(heroProfile) {
  return buildSummary(heroProfile);
}

function formatTimeSummary(t) {
  if (t == null) return '?';
  const m = Math.floor(Math.abs(t) / 60);
  const s = Math.abs(t) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildSummary(heroProfile) {
  if (events.length === 0) return null;

  const deaths       = events.filter((e) => e.type === 'hero_death');
  const tpEvents     = events.filter((e) => e.type === 'no_tp_warning');
  const gpmDrops     = events.filter((e) => e.type === 'gpm_drop');
  const lowFarmWins  = events.filter((e) => e.type === 'low_farm_window');
  const keyCompleted = events.filter((e) => e.type === 'key_item_completed');
  const spikeUnused  = events.filter((e) => e.type === 'power_spike_unused');
  const gameEnd      = lastEventOfType('game_end');

  // Death classification
  const preKeyItemDeaths   = deaths.filter((e) => e.snapshot?.pre_key_item);
  const closeDeaths        = deaths.filter((e) => e.snapshot?.gold_gap_to_key_item != null && e.snapshot.gold_gap_to_key_item < 600);
  const spikeDeaths        = deaths.filter((e) => e.snapshot?.in_power_spike);
  const noTpDeaths         = deaths.filter((e) => e.snapshot?.has_tp === false);

  // Key item timing analysis
  const keyItemAnalysis = keyCompleted.map((e) => {
    const afterEvents = events.filter(
      (x) => x.game_time > e.game_time && (x.type === 'hero_death' && x.snapshot?.in_power_spike)
    );
    const ka = events.filter(
      (x) => x.game_time > e.game_time && x.game_time < e.game_time + 300 && x.type === 'hero_death'
    );
    return {
      item: e.snapshot?.item,
      displayName: getDisplayName(e.snapshot?.item),
      completedAt: e.game_time,
      spikeDeathsAfter: afterEvents.length,
    };
  });

  // Positives / negatives
  const positives = [];
  const negatives = [];

  if (deaths.length === 0) {
    positives.push('全场零死亡，走位极佳');
  } else if (deaths.length <= 3) {
    positives.push(`死亡次数较少（${deaths.length} 次），风险控制良好`);
  } else {
    negatives.push(`死亡 ${deaths.length} 次，需减少冒进和不必要的风险`);
  }

  if (closeDeaths.length === 0) {
    positives.push('没有在关键装备差钱阶段死亡，节奏管理到位');
  } else {
    negatives.push(`${closeDeaths.length} 次在关键装备差钱 600 以内时死亡，严重影响成型节奏`);
  }

  if (tpEvents.length === 0) {
    positives.push('全场保持传送卷轴，支援意识到位');
  } else {
    negatives.push(`${tpEvents.length} 次超过 60 秒无传送卷轴，支援能力受限`);
  }

  if (spikeUnused.length === 0 && keyCompleted.length > 0) {
    positives.push('关键装备完成后及时转化为节奏，强势期利用良好');
  } else if (spikeUnused.length > 0) {
    negatives.push(`${spikeUnused.length} 次强势期没有有效转化，浪费了关键 timing`);
  }

  if (lowFarmWins.length > 1) {
    negatives.push(`出现 ${lowFarmWins.length} 次低收益窗口，中期经济节奏有断档`);
  }

  // One thing to improve
  let oneThingToImprove = null;
  if (closeDeaths.length >= 2) {
    oneThingToImprove = '关键装备差 600 以内时，优先稳住刷出来，不要主动接高风险团。';
  } else if (spikeUnused.length >= 1) {
    oneThingToImprove = '关键装备完成后 3 分钟内，要主动和队友找一次节奏，不要原地等待。';
  } else if (spikeDeaths.length >= 2) {
    oneThingToImprove = '强势期死亡过多，下一局重点是关键装备完成后先控图，减少冒进开团。';
  } else if (noTpDeaths.length >= 2) {
    oneThingToImprove = '多次在无传送卷轴状态下死亡，保持 TP 可以让你在危险时有退路。';
  } else if (lowFarmWins.length >= 2) {
    oneThingToImprove = '中期出现多次经济停滞，尝试在安全区域找补刀效率更高的路线。';
  } else {
    oneThingToImprove = '整体表现不错，继续保持关键装备节奏和强势期的主动性。';
  }

  // Grade
  const score = positives.length - negatives.length;
  const grade =
    score >= 4 ? '优秀' :
    score >= 2 ? '良好' :
    score >= 0 ? '一般' : '需改进';

  const win = gameEnd ? gameEnd.message.includes('胜利') : null;

  return {
    match_id: currentMatchId,
    result: win === true ? '胜利' : win === false ? '失败' : '进行中',
    grade,
    positives,
    negatives,
    one_thing_to_improve: oneThingToImprove,
    stats: gameEnd?.snapshot || null,
    key_item_analysis: keyItemAnalysis,
    death_analysis: {
      total: deaths.length,
      pre_key_item: preKeyItemDeaths.length,
      close_to_key_item: closeDeaths.length,
      in_power_spike: spikeDeaths.length,
      without_tp: noTpDeaths.length,
      death_details: deaths.map((e) => {
        const s = e.snapshot || {};

        const invItems = Object.values(s.inventoryAtDeath || {})
          .filter((n) => n && n !== 'item_tpscroll')
          .map(getDisplayName);
        const invStr = invItems.length > 0 ? invItems.join('、') : '空';

        const bpItems = Object.values(s.backpackAtDeath || {})
          .filter(Boolean)
          .map(getDisplayName);
        const bpStr = bpItems.length > 0 ? bpItems.join('、') : '空';

        const neutralStr = s.neutralItemAtDeath ? getDisplayName(s.neutralItemAtDeath) : '无';

        const lines = [`${formatTimeSummary(e.game_time)} 死亡：`];
        lines.push(`  当时主背包：${invStr}。`);
        lines.push(`  背包：${bpStr}。`);
        lines.push(`  中立物品：${neutralStr}。`);

        const gap = s.goldToKeyItemAtDeath ?? s.gold_gap_to_key_item;
        if (s.keyItemAtDeath && gap != null) {
          lines.push(`  ${getDisplayName(s.keyItemAtDeath)} 还差 ${gap} 金。`);
        }
        if (s.wasNearKeyItem || (gap != null && gap < 600)) lines.push('  这是关键装备前高影响死亡。');
        if (s.wasInPowerSpikeWindow || s.in_power_spike) lines.push('  处于强势期窗口内死亡，可能浪费 timing。');

        return lines.join('\n');
      }),
    },
    tempo_analysis: {
      spike_unused_count: spikeUnused.length,
      low_farm_windows: lowFarmWins.length,
      gpm_drops: gpmDrops.length,
    },
    event_counts: {
      total: events.length,
      deaths: deaths.length,
      key_items_completed: keyCompleted.length,
      tp_missing: tpEvents.length,
    },
  };
}

module.exports = { logEvents, getEvents, getPowerSpikeState, getSummary, getOfflanieSummary, resetForMatch, normalizeItems };
