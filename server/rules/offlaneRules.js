// Offlane-specific rules that require hero profile + match config context.

const { ITEM_DISPLAY_NAMES } = require('../data/offlaneHeroProfiles');

// ctx = { heroProfile, suggested, config, getPowerSpikeState }
function getOfflaneRules(ctx) {
  const { heroProfile, suggested, getPowerSpikeState } = ctx || {};
  if (!heroProfile) return [];

  return [
    // ── Key Item Near Completion ──────────────────────────────────────────
    {
      id: 'key_item_near_completion',
      check(data) {
        if (!suggested?.suggestedKeyItem || !suggested.cost) return null;
        const gold = data.player?.gold || 0;
        const gap = suggested.cost - gold;
        if (gap > 0 && gap < 600) {
          return {
            message: `关键装备 ${suggested.displayName} 快到了（差 ${gap} 金），先稳一点，别在成型前死。`,
            severity: 'warning',
          };
        }
        return null;
      },
    },

    // ── Power Spike Unused ────────────────────────────────────────────────
    {
      id: 'power_spike_unused_alert',
      check(data) {
        if (!getPowerSpikeState) return null;
        const spike = getPowerSpikeState();
        if (!spike.active) return null;
        const clock = data.map?.clock_time || 0;
        if (clock - spike.startClock < 180) return null;
        const currentKA = (data.player?.kills || 0) + (data.player?.assists || 0);
        if (currentKA <= spike.startKA) {
          return {
            message: '关键装备完成后暂时没有转化为节奏，考虑和队友找机会。',
            severity: 'warning',
          };
        }
        return null;
      },
    },

    // ── Low Farm Window ───────────────────────────────────────────────────
    {
      id: 'low_farm_window',
      check(data, prevData) {
        if (!prevData) return null;
        const clock = data.map?.clock_time || 0;
        if (clock < 600) return null;
        const gpmNow = data.player?.gpm || 0;
        const gpmPrev = prevData.player?.gpm || 0;
        const currKA = (data.player?.kills || 0) + (data.player?.assists || 0);
        const prevKA = (prevData.player?.kills || 0) + (prevData.player?.assists || 0);
        if (gpmPrev > 300 && gpmNow < gpmPrev * 0.85 && currKA === prevKA) {
          return {
            message: '这段时间经济增长放缓，且没有节奏收益。可能需要重新选择刷钱/带线区域。',
            severity: 'warning',
          };
        }
        return null;
      },
    },
  ];
}

module.exports = { getOfflaneRules };
