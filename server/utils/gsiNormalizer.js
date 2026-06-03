// Normalize raw Dota 2 GSI items payload to a consistent { slot, stash, neutral } structure.
//
// Real Dota 2 GSI sends items in two layouts depending on client version:
//   Nested  (some versions / mockGSI): data.items.slot.slot0, data.items.stash.stash0
//   Flat    (live game / current):     data.items.slot0, data.items.stash0, data.items.neutral0
//
// Both layouts produce the same output shape:
//   slot    — { slot0..slot8 }   (inventory + backpack)
//   stash   — { stash0..stash5 }
//   neutral — { neutral0 }

function normalizeItems(itemsObj) {
  if (!itemsObj) return { slot: {}, stash: {}, neutral: {}, teleport: null };

  // Nested: items.slot is a plain sub-object (has no .name property, is not an array)
  if (itemsObj.slot && typeof itemsObj.slot === 'object'
      && !Array.isArray(itemsObj.slot) && !itemsObj.slot.name) {
    return {
      slot:     itemsObj.slot      || {},
      stash:    itemsObj.stash     || {},
      neutral:  itemsObj.neutral   || {},
      teleport: itemsObj.teleport  || null,
    };
  }

  // Flat: collect by prefix
  const slot = {};
  const stash = {};
  const neutral = {};

  for (let i = 0; i <= 8; i++) {
    const k = `slot${i}`;
    if (k in itemsObj) slot[k] = itemsObj[k];
  }
  for (let i = 0; i <= 5; i++) {
    const k = `stash${i}`;
    if (k in itemsObj) stash[k] = itemsObj[k];
  }
  if ('neutral0'  in itemsObj) neutral.neutral0 = itemsObj.neutral0;

  // Dedicated TP slot — present in live GSI as a top-level "teleport" key
  const teleport = itemsObj.teleport || null;

  return { slot, stash, neutral, teleport };
}

module.exports = { normalizeItems };
