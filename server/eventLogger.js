// Detects and accumulates match events from the GSI data stream.
// All state is in-memory and resets automatically on a new match_id.

let events = [];
let currentMatchId = null;

// TP-missing episode tracking
let tpMissingStart = null;
let tpMissingFired = false;

// GPM history ring-buffer: { clock, gpm }[]
let gpmHistory = [];

// Previous GSI payload (for diff-based detection)
let prevData = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function resetForMatch(matchId) {
  events = [];
  currentMatchId = matchId;
  tpMissingStart = null;
  tpMissingFired = false;
  gpmHistory = [];
  prevData = null;
}

function makeSnapshot(data) {
  const p = data.player || {};
  const h = data.hero || {};
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
  };
}

function allItemNames(data) {
  const items = data.items || {};
  return [
    ...Object.values(items.slot || {}),
    ...Object.values(items.stash || {}),
  ]
    .filter((i) => i && i.name && !i.name.includes('empty'))
    .map((i) => i.name);
}

function hasTp(data) {
  return allItemNames(data).includes('item_tpscroll');
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

function detectHeroDeath(data, clock) {
  if (!prevData) return;
  if (data.hero?.alive === false && prevData.hero?.alive !== false) {
    push({
      game_time: clock,
      type: 'hero_death',
      severity: 'danger',
      message: `英雄阵亡（第 ${data.player?.deaths || 0} 次）`,
      snapshot: makeSnapshot(data),
    });
  }
}

function detectHeroRespawn(data, clock) {
  if (!prevData) return;
  if (data.hero?.alive === true && prevData.hero?.alive === false) {
    push({
      game_time: clock,
      type: 'hero_respawn',
      severity: 'info',
      message: '英雄复活',
      snapshot: makeSnapshot(data),
    });
  }
}

function detectItemPurchased(data, clock) {
  if (!prevData) return;
  const prevSet = new Set(allItemNames(prevData));
  const logged = new Set();
  for (const name of allItemNames(data)) {
    if (!prevSet.has(name) && !logged.has(name)) {
      const label = name.replace('item_', '').replace(/_/g, ' ');
      push({
        game_time: clock,
        type: 'item_purchased',
        severity: 'info',
        message: `购入道具：${label}`,
        snapshot: { ...makeSnapshot(data), item: name },
      });
      logged.add(name);
    }
  }
}

function detectTpMissing(data, clock) {
  if (clock <= 300) return;
  if (!hasTp(data)) {
    if (tpMissingStart === null) {
      tpMissingStart = clock;
      tpMissingFired = false;
    } else if (!tpMissingFired && clock - tpMissingStart > 60) {
      push({
        game_time: clock,
        type: 'tp_missing',
        severity: 'warning',
        message: `传送卷轴缺失已超过 ${Math.floor(clock - tpMissingStart)} 秒`,
        snapshot: { ...makeSnapshot(data), missing_since: tpMissingStart },
      });
      tpMissingFired = true;
    }
  } else {
    tpMissingStart = null;
    tpMissingFired = false;
  }
}

function detectGpmDrop(data, clock) {
  const gpm = data.player?.gpm || 0;
  gpmHistory.push({ clock, gpm });
  // Keep ~5 minutes of history at ~2 s/tick
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
    snapshot: { ...makeSnapshot(data), gpm_ref: refEntry.gpm, gpm_ref_clock: refEntry.clock },
  });
}

function detectGameEnd(data, clock) {
  if (data.map?.game_state !== 'DOTA_GAMERULES_STATE_POST_GAME') return;
  if (lastEventOfType('game_end')) return;
  const win = data.map?.win_team && data.map.win_team === data.player?.team_name;
  push({
    game_time: clock,
    type: 'game_end',
    severity: win ? 'success' : 'danger',
    message: `比赛结束 — ${win ? '胜利' : '失败'}`,
    snapshot: makeSnapshot(data),
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

function logEvents(data) {
  const clock = data.map?.clock_time || 0;
  const matchId = String(data.map?.matchid || '0');

  if (matchId !== currentMatchId) {
    resetForMatch(matchId);
  }

  detectHeroDeath(data, clock);
  detectHeroRespawn(data, clock);
  detectItemPurchased(data, clock);
  detectTpMissing(data, clock);
  detectGpmDrop(data, clock);
  detectGameEnd(data, clock);

  prevData = data;
}

function getEvents() {
  return [...events];
}

function getSummary() {
  if (events.length === 0) return null;

  const deaths = events.filter((e) => e.type === 'hero_death');
  const tpEvents = events.filter((e) => e.type === 'tp_missing');
  const gpmDrops = events.filter((e) => e.type === 'gpm_drop');
  const gameEnd = lastEventOfType('game_end');

  const positives = [];
  const negatives = [];

  // Deaths
  if (deaths.length === 0) {
    positives.push('全场零死亡，走位极佳');
  } else if (deaths.length <= 3) {
    positives.push(`死亡次数较少（${deaths.length} 次），风险控制良好`);
  } else {
    negatives.push(`死亡 ${deaths.length} 次，需减少冒进和不必要的风险`);
  }

  // TP
  if (tpEvents.length === 0) {
    positives.push('全场保持传送卷轴，支援意识到位');
  } else {
    negatives.push(`${tpEvents.length} 次超过 60 秒无传送卷轴，支援能力受限`);
  }

  // GPM
  if (gpmDrops.length === 0) {
    positives.push('GPM 曲线稳定，经济效率持续');
  } else if (gpmDrops.length === 1) {
    negatives.push('GPM 出现 1 次明显下滑，注意中期经济节奏');
  } else {
    negatives.push(`GPM 出现 ${gpmDrops.length} 次明显下滑，经济波动较大`);
  }

  const score = positives.length - negatives.length;
  const rating =
    score >= 3 ? '优秀' : score >= 1 ? '良好' : score >= 0 ? '一般' : '需改进';

  return {
    match_id: currentMatchId,
    result: gameEnd ? (gameEnd.message.includes('胜利') ? '胜利' : '失败') : '进行中',
    rating,
    positives,
    negatives,
    stats: gameEnd?.snapshot || null,
    event_counts: {
      deaths: deaths.length,
      tp_missing: tpEvents.length,
      gpm_drops: gpmDrops.length,
      total: events.length,
    },
  };
}

module.exports = { logEvents, getEvents, getSummary };
