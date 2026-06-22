'use strict';

// Generic power-spike item buckets used to compare my-vs-enemy spike timing.
//
// These are UNIVERSAL items that any hero can build — intentionally separate from
// the 7-hero offlaneHeroProfiles.js keyItems, which are player-hero-specific.
// Enemy heroes don't have a profile, so this generic list is used for them.
//
// Keys match OpenDota purchase_log entry.key values (no "item_" prefix).
//
// 7.41 item status:
//   consecrated_wraps — unverified (no real parsed match in cache to confirm key spelling)
//   specialists_array — unverified (no real parsed match in cache to confirm key spelling)

const POWER_SPIKE_ITEMS = {
  initiation:    ['blink', 'invis_sword', 'blade_mail'],
  survivability: ['black_king_bar', 'pipe', 'eternal_shroud', 'guardian_greaves',
                  'crimson_guard', 'mekansm', 'shivas_guard', 'consecrated_wraps'],  // unverified: consecrated_wraps
  farming:       ['radiance', 'manta', 'bfury', 'maelstrom', 'specialists_array'],   // unverified: specialists_array
  damage:        ['desolator', 'aghanims_scepter', 'assault', 'monkey_king_bar', 'nullifier'],
  control:       ['rod_of_atos', 'sheepstick', 'orchid', 'gleipnir', 'abyssal_blade'],
  support:       ['force_staff', 'glimmer_cape', 'lotus_orb', 'solar_crest'],
};

const ALL_SPIKE_ITEMS = new Set(Object.values(POWER_SPIKE_ITEMS).flat());

module.exports = { POWER_SPIKE_ITEMS, ALL_SPIKE_ITEMS };
