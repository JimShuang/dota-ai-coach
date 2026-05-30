// Rule engine coordinator.
// Combines common, offlane, and archetype-specific rules.
// Backward-compatible: evaluate(data) still works; pass ctx for offlane features.

const COMMON_RULES = require('./rules/commonRules');
const { getOfflaneRules } = require('./rules/offlaneRules');
const { getArchetypeRules } = require('./rules/archetypeRules');

let prevData = null;
const recentlyFired = new Map(); // rule_id -> last clock_time fired

/**
 * @param {object} data - GSI payload
 * @param {object} [ctx] - Offlane context: { heroProfile, suggested, getPowerSpikeState }
 */
function evaluate(data, ctx = {}) {
  const clock = data.map?.clock_time || 0;
  const matchId = String(data.map?.matchid || '0');
  const alerts = [];

  const allRules = [
    ...COMMON_RULES,
    ...getOfflaneRules(ctx),
    ...getArchetypeRules(ctx),
  ];

  for (const rule of allRules) {
    const lastFired = recentlyFired.get(rule.id) || -999;
    if (clock - lastFired < 60) continue;

    const result = rule.check(data, prevData);
    if (result) {
      alerts.push({
        match_id: matchId,
        clock_time: clock,
        rule_id: rule.id,
        message: result.message,
        severity: result.severity || 'info',
      });
      recentlyFired.set(rule.id, clock);
    }
  }

  prevData = data;
  return alerts;
}

module.exports = { evaluate };
