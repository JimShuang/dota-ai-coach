'use strict';

// Convergence layer: maps the three independent anchor scanners' outputs to a
// unified Anchor shape and merges them into a single time-ordered chain.
//
// Takes scanner output as parameters — never imports the scanners themselves.
// No I/O. Pure transformation.
//
// Three scanner sources this layer consumes:
//   buildDeathDigest()       → deaths[]       (openDotaDeathDigest.js)
//   scanMomentumShifts()     → momentumShifts[] (openDotaMomentumScanner.js)
//   scanSpikeWindowDeltas()  → spikeDeltas[]  (openDotaSpikeWindowScanner.js)

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
// death > spike > momentum
// Rationale: "something happened" events (deaths) rank before "state-change"
// events (spike completions), which rank before "trend analysis" (momentum).
const KIND_PRIORITY = { death: 0, spike: 1, momentum: 2 };

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
  const dur      = fmtDuration(delta.delta);

  // severity: spike_deficit + significant → warning; deficit non-significant → info; lead → success.
  const severity = delta.type === 'spike_deficit'
    ? (delta.significant ? 'warning' : 'info')
    : 'success';

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

// ── Merge ──────────────────────────────────────────────────────────────────

/**
 * Merge three anchor arrays into a single time-ordered chain.
 *
 * @param {{ deaths?, momentumShifts?, spikeDeltas? }} inputs
 *   Each array is the direct output of the respective scanner function.
 *   Missing arrays default to [] — no error.
 * @returns {object[]}
 *   Anchors sorted by gameTime ASC.
 *   Same-gameTime tie-break: death (0) > spike (1) > momentum (2).
 */
function buildAnchorChain({ deaths = [], momentumShifts = [], spikeDeltas = [] } = {}) {
  const anchors = [
    ...deaths.map(deathToAnchor),
    ...momentumShifts.map(momentumToAnchor),
    ...spikeDeltas.map(spikeToAnchor),
  ];

  anchors.sort((a, b) => {
    if (a.gameTime !== b.gameTime) return a.gameTime - b.gameTime;
    return (KIND_PRIORITY[a.kind] ?? 3) - (KIND_PRIORITY[b.kind] ?? 3);
  });

  return anchors;
}

module.exports = {
  buildAnchorChain,
  deathToAnchor,
  momentumToAnchor,
  spikeToAnchor,
};
