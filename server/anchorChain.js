'use strict';

// Convergence layer: maps the three independent anchor scanners' outputs to a
// unified Anchor shape and merges them into a single time-ordered chain.
//
// Takes scanner output as parameters — never imports the scanners themselves.
// No I/O. Pure transformation.
//
// Four scanner sources this layer consumes:
//   buildDeathDigest()       → deaths[]         (openDotaDeathDigest.js)
//   scanMomentumShifts()     → momentumShifts[] (openDotaMomentumScanner.js)
//   scanSpikeWindowDeltas()  → spikeDeltas[]    (openDotaSpikeWindowScanner.js)
//   scanPaceDeficits()       → paceDeficits[]   (openDotaSpikeWindowScanner.js)

// ── Bucket Chinese display names ──────────────────────────────────────────
const BUCKET_ZH = {
  survivability: '生存',
  initiation:    '先手',
  farming:       '刷钱',
  damage:        '爆发',
  control:       '控制',
  support:       '团队',
};

// ── Tie-break priority for same gameTime: lower number = earlier ──────────
// death > spike > pace > momentum
// Rationale: "something happened" events (deaths) rank before "state-change"
// events (spike completions, then aggregate pace state changes), which rank
// before "trend analysis" (momentum).
const KIND_PRIORITY = { death: 0, spike: 1, pace: 2, momentum: 3 };

// ── Time helpers ───────────────────────────────────────────────────────────

// Format a game_time in seconds as mm:ss.
// Negative game_time (pre-creep-spawn) is rendered as -mm:ss, not clamped to
// 00:00, so early-game events remain distinguishable on the timeline.
function fmtTime(seconds) {
  const neg = seconds < 0;
  const abs = Math.abs(Math.floor(seconds));
  const mm  = String(Math.floor(abs / 60)).padStart(2, '0');
  const ss  = String(abs % 60).padStart(2, '0');
  return `${neg ? '-' : ''}${mm}:${ss}`;
}

// Format an absolute gap (|delta| seconds) as a plain mm:ss duration string.
function fmtDuration(seconds) {
  const abs = Math.abs(Math.floor(seconds));
  const mm  = String(Math.floor(abs / 60)).padStart(2, '0');
  const ss  = String(abs % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// ── Mapping functions ──────────────────────────────────────────────────────

/**
 * Map a hero_death entry from buildDeathDigest() to a unified Anchor.
 *
 * @param {object} entry  A death digest entry — the hero_death event spread
 *                        with an added .context object.
 */
function deathToAnchor(entry) {
  const snap     = entry.snapshot || {};
  // OD import deaths carry deathNumber; GSI deaths carry deathsAtDeath.
  const deathNum = snap.deathNumber ?? snap.deathsAtDeath ?? null;
  const killer   = snap.killer ?? null;

  let summary;
  if (killer != null && deathNum != null) {
    summary = `${fmtTime(entry.game_time)} 阵亡（${killer}，第 ${deathNum} 次）`;
  } else if (deathNum != null) {
    summary = `${fmtTime(entry.game_time)} 阵亡（第 ${deathNum} 次）`;
  } else {
    summary = `${fmtTime(entry.game_time)} 阵亡`;
  }

  return {
    gameTime: entry.game_time,
    minute:   Math.floor(entry.game_time / 60),
    kind:     'death',
    type:     'hero_death',
    severity: entry.severity,
    summary,
    detail:   entry,
  };
}

/**
 * Map a momentum shift from scanMomentumShifts() to a unified Anchor.
 *
 * @param {object} shift  { minute, type, slopeBefore, slopeAfter, magnitude, advAtShift }
 */
function momentumToAnchor(shift) {
  const gameTime = shift.minute * 60;

  // Severity: momentum_loss → warning; momentum_gain → success.
  // Future: promote large-magnitude losses to 'danger' via a threshold constant here.
  const severity = shift.type === 'momentum_loss' ? 'warning' : 'success';

  const summary = shift.type === 'momentum_loss'
    ? `${fmtTime(gameTime)} 经济差由涨转跌（节奏丢失）`
    : `${fmtTime(gameTime)} 经济差由跌转涨（夺回节奏）`;

  return {
    gameTime,
    minute:   shift.minute,
    kind:     'momentum',
    type:     shift.type,
    severity,
    summary,
    detail:   shift,
  };
}

/**
 * Map a spike delta from scanSpikeWindowDeltas() to a unified Anchor.
 *
 * @param {object} delta  { bucket, myItem, myTime, enemyHero, enemyItem,
 *                          enemyTime, delta, type, significant }
 */
function spikeToAnchor(delta) {
  const bucketZh = BUCKET_ZH[delta.bucket] || delta.bucket;

  // Null delta → no enemy bought the same item; this is the start of the player's unique power spike.
  if (delta.delta === null) {
    return {
      gameTime: delta.myTime,
      minute:   Math.floor(delta.myTime / 60),
      kind:     'spike',
      type:     'spike_lead',
      severity: 'success',
      summary:  `${fmtTime(delta.myTime)} ${bucketZh} 强势期开始（无敌方同装备）`,
      detail:   delta,
    };
  }

  const dur = fmtDuration(delta.delta);

  // severity: any spike_deficit → warning (being behind is always a concern);
  // significant flag controls emphasis (bold / 显著 badge) but not color.
  const severity = delta.type === 'spike_deficit' ? 'warning' : 'success';

  const summary = delta.type === 'spike_deficit'
    ? `${fmtTime(delta.myTime)} ${bucketZh} 强势期落后敌方 ${dur}`
    : `${fmtTime(delta.myTime)} ${bucketZh} 强势期领先敌方 ${dur}`;

  return {
    gameTime: delta.myTime,
    minute:   Math.floor(delta.myTime / 60),
    kind:     'spike',
    type:     delta.type,
    severity,
    summary,
    detail:   delta,
  };
}

/**
 * Map a pace anchor from scanPaceDeficits() to a unified Anchor.
 *
 * @param {object} pace  { gameTime, type, myCount, enemyCount, gap,
 *                          enemyHero, triggerItem, significant }
 */
function paceToAnchor(pace) {
  let severity;
  let summary;

  if (pace.type === 'pace_recovered') {
    severity = 'success';
    summary  = `${fmtTime(pace.gameTime)} 关键装数量追平（${pace.myCount} 件）`;
  } else {
    severity = pace.significant ? 'warning' : 'info';
    summary  = `${fmtTime(pace.gameTime)} 敌方 ${pace.enemyHero} 已 ${pace.enemyCount} 件关键装，我方 ${pace.myCount} 件（落后 ${pace.gap}）`;
  }

  return {
    gameTime: pace.gameTime,
    minute:   Math.floor(pace.gameTime / 60),
    kind:     'pace',
    type:     pace.type,
    severity,
    summary,
    detail:   pace,
  };
}

// ── Merge ──────────────────────────────────────────────────────────────────

/**
 * Merge four anchor arrays into a single time-ordered chain.
 *
 * @param {{ deaths?, momentumShifts?, spikeDeltas?, paceDeficits? }} inputs
 *   Each array is the direct output of the respective scanner function.
 *   Missing arrays default to [] — no error.
 * @returns {object[]}
 *   Anchors sorted by gameTime ASC.
 *   Same-gameTime tie-break: death (0) > spike (1) > pace (2) > momentum (3).
 */
function buildAnchorChain({ deaths = [], momentumShifts = [], spikeDeltas = [], paceDeficits = [] } = {}) {
  const anchors = [
    ...deaths.map(deathToAnchor),
    ...momentumShifts.map(momentumToAnchor),
    ...spikeDeltas.map(spikeToAnchor),
    ...paceDeficits.map(paceToAnchor),
  ];

  anchors.sort((a, b) => {
    if (a.gameTime !== b.gameTime) return a.gameTime - b.gameTime;
    return (KIND_PRIORITY[a.kind] ?? 4) - (KIND_PRIORITY[b.kind] ?? 4);
  });

  return anchors;
}

module.exports = {
  buildAnchorChain,
  deathToAnchor,
  momentumToAnchor,
  spikeToAnchor,
  paceToAnchor,
};
