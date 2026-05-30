const { PROFILES, ITEM_COSTS, ITEM_DISPLAY_NAMES } = require('./data/offlaneHeroProfiles');

/**
 * Returns the next key item the player should build.
 *
 * @param {string} heroKey - Key from PROFILES (e.g. 'centaur')
 * @param {string[]} currentItems - Array of item internal names currently owned
 * @param {number} _gameTime - Reserved for future time-gated logic
 * @param {string|null} userOverride - item internal name override, or null for auto
 * @returns {{ suggestedKeyItem: string|null, displayName: string|null, reason: string, cost: number|null } | null}
 */
function suggestKeyItem(heroKey, currentItems, _gameTime, userOverride) {
  if (userOverride) {
    const displayName =
      ITEM_DISPLAY_NAMES[userOverride] ||
      userOverride.replace('item_', '').replace(/_/g, ' ');
    return {
      suggestedKeyItem: userOverride,
      displayName,
      reason: '用户自定义',
      cost: ITEM_COSTS[userOverride] || null,
    };
  }

  const profile = PROFILES[heroKey];
  if (!profile) return null;

  const owned = new Set(currentItems);
  for (const item of profile.keyItems) {
    if (!owned.has(item)) {
      const displayName =
        ITEM_DISPLAY_NAMES[item] ||
        item.replace('item_', '').replace(/_/g, ' ');
      return {
        suggestedKeyItem: item,
        displayName,
        reason: '当前进度下一件关键装备',
        cost: ITEM_COSTS[item] || null,
      };
    }
  }

  return {
    suggestedKeyItem: null,
    displayName: null,
    reason: '关键装备路线已完成',
    cost: null,
  };
}

module.exports = { suggestKeyItem };
