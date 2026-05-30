// General rules that apply to all roles/heroes.
// Moved from the original server/rules.js.

const COMMON_RULES = [
  {
    id: 'low_gold',
    check(data) {
      const gold = data.player?.gold || 0;
      const clock = data.map?.clock_time || 0;
      if (clock > 60 && gold < 200) {
        return { message: `金币不足 (${gold})，考虑打野或补给`, severity: 'warning' };
      }
      return null;
    },
  },
  {
    id: 'buy_back_reminder',
    check(data) {
      const player = data.player || {};
      const clock = data.map?.clock_time || 0;
      if (clock > 600 && player.buyback_cooldown_time === 0 && player.gold >= player.buyback_cost) {
        return { message: '买活可用，确保关键团战时有买活保障', severity: 'info' };
      }
      return null;
    },
  },
  {
    id: 'low_last_hits',
    check(data) {
      const player = data.player || {};
      const clock = data.map?.clock_time || 0;
      const lh = player.last_hits || 0;
      const minuteMark = Math.floor(clock / 60);
      if (minuteMark >= 5 && minuteMark <= 15 && lh < minuteMark * 5) {
        return {
          message: `补刀偏低 (${lh}刀/${minuteMark}分钟)，目标每分钟 8 刀`,
          severity: 'warning',
        };
      }
      return null;
    },
  },
  {
    id: 'roshan_window',
    check(data) {
      if (data.map?.roshan_state === 'respawn_base' && (data.map?.clock_time || 0) > 0) {
        return { message: 'Roshan 即将复活，注意视野控制', severity: 'warning' };
      }
      return null;
    },
  },
  {
    id: 'ward_reminder',
    check(data) {
      const player = data.player || {};
      const clock = data.map?.clock_time || 0;
      const items = data.items || {};
      const allItems = [...Object.values(items.slot || {}), ...Object.values(items.stash || {})];
      const wardCount = allItems.filter(
        (i) => i && (i.name === 'item_ward_observer' || i.name === 'item_ward_sentry')
      ).length;
      if (clock > 120 && wardCount === 0 && (player.team_name === 'dire' || player.team_name === 'radiant')) {
        return { message: '背包中没有视野道具，记得购买插眼', severity: 'info' };
      }
      return null;
    },
  },
  {
    id: 'death_streak',
    check(data, prevData) {
      if (!prevData) return null;
      const deaths = data.player?.deaths || 0;
      const prevDeaths = prevData.player?.deaths || 0;
      if (deaths - prevDeaths >= 3) {
        return { message: `连续死亡 ${deaths} 次，考虑调整站位，避免过于激进`, severity: 'danger' };
      }
      return null;
    },
  },
  {
    id: 'teleport_scroll',
    check(data) {
      const items = data.items || {};
      const allItems = [...Object.values(items.slot || {}), ...Object.values(items.stash || {})];
      const hasTp = allItems.some((i) => i && i.name === 'item_tpscroll');
      const clock = data.map?.clock_time || 0;
      if (clock > 300 && !hasTp) {
        return { message: '没有传送卷轴，购买一个以备不时之需', severity: 'warning' };
      }
      return null;
    },
  },
];

module.exports = COMMON_RULES;
