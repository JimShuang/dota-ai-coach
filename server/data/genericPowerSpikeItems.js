'use strict';

// Generic power-spike item buckets used to compare my-vs-enemy spike timing,
// and to build the pace (aggregate key-item count) anchors in
// scanPaceDeficits(). Both consumers rely on the same item set so "my vs.
// enemy" comparisons and "total key items completed" counts use one
// consistent definition of what counts as a key item.
//
// These are UNIVERSAL items that any hero can build — intentionally separate from
// the 7-hero offlaneHeroProfiles.js keyItems, which are player-hero-specific.
// Enemy heroes don't have a profile, so this generic list is used for them.
// vanguard / hood_of_defiance / kaya_and_sange are also present in some
// offlaneHeroProfiles.js keyItems routes — included here too so pace counts
// treat "my profile's key items" and "generic enemy key items" symmetrically.
//
// Keys match OpenDota purchase_log entry.key values (no "item_" prefix).
//
// aghanims_scepter → ultimate_scepter: OpenDota's purchase_log uses the item's
// internal Dota name, which for Aghanim's Scepter is `item_ultimate_scepter`
// (not `item_aghanims_scepter`) — confirmed by the existing OPENDOTA_KEY_OVERRIDES
// map in matchImporter.js, which remaps the real key back to our item_aghanims_scepter
// display name. The old `aghanims_scepter` key here never matched real purchase_log data.
//
// 7.41 item status:
//   consecrated_wraps — unverified (no real parsed match in cache to confirm key spelling)
//   specialists_array — unverified (no real parsed match in cache to confirm key spelling)

const POWER_SPIKE_ITEMS = {
  initiation:    ['blink', 'invis_sword', 'blade_mail'],
  survivability: ['black_king_bar', 'pipe', 'eternal_shroud', 'guardian_greaves',
                  'crimson_guard', 'mekansm', 'shivas_guard', 'consecrated_wraps',  // unverified: consecrated_wraps
                  'vanguard', 'hood_of_defiance'],
  farming:       ['radiance', 'manta', 'bfury', 'maelstrom', 'specialists_array',   // unverified: specialists_array
                  'kaya_and_sange'],  // spell damage + status resistance sustain; grouped with farming/sustain rather than damage
  damage:        ['desolator', 'ultimate_scepter', 'assault', 'monkey_king_bar', 'nullifier'],
  control:       ['rod_of_atos', 'sheepstick', 'orchid', 'gleipnir', 'abyssal_blade'],
  support:       ['force_staff', 'glimmer_cape', 'lotus_orb', 'solar_crest'],
};

const ALL_SPIKE_ITEMS = new Set(Object.values(POWER_SPIKE_ITEMS).flat());

module.exports = { POWER_SPIKE_ITEMS, ALL_SPIKE_ITEMS };
