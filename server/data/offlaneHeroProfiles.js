// Offlane hero pool: profiles, item costs, display names.
// Item costs are approximate and may shift with patches — adjust as needed.

const ITEM_COSTS = {
  item_vanguard:         1825,
  item_blink:            2250,
  item_pipe:             3000,
  item_crimson_guard:    3225,
  item_black_king_bar:   4050,
  item_blade_mail:       2300,
  item_hood_of_defiance: 1750,
  item_eternal_shroud:   2350,
  item_aghanims_scepter: 4200,
  item_kaya_and_sange:   4100,
  item_force_staff:      2200,
  item_glimmer_cape:     1950,
  item_mekansm:          1775,
  item_guardian_greaves: 3500,
  item_lotus_orb:        3850,
  item_assault:          5125,
  item_rod_of_atos:      2750,
  item_shivas_guard:     4850,
};

const ITEM_DISPLAY_NAMES = {
  item_vanguard:         '先锋盾（Vanguard）',
  item_blink:            '闪烁匕首（Blink Dagger）',
  item_pipe:             '洞察烟斗（Pipe of Insight）',
  item_crimson_guard:    '猩红卫士（Crimson Guard）',
  item_black_king_bar:   '黑皇杖（Black King Bar）',
  item_blade_mail:       '刃甲（Blade Mail）',
  item_hood_of_defiance: '抗魔斗篷（Hood of Defiance）',
  item_eternal_shroud:   '永恒裹布（Eternal Shroud）',
  item_aghanims_scepter: '阿哈利姆神杖（Aghanim\'s Scepter）',
  item_kaya_and_sange:   '凯亚与桑格（Kaya and Sange）',
  item_force_staff:      '推推棒（Force Staff）',
  item_glimmer_cape:     '闪烁斗篷（Glimmer Cape）',
  item_mekansm:          '梅肯斯姆（Mekansm）',
  item_guardian_greaves: '守护者护胫（Guardian Greaves）',
  item_lotus_orb:        '莲花宝珠（Lotus Orb）',
  item_assault:          '强袭胸甲（Assault Cuirass）',
  item_rod_of_atos:      '阿托斯之棒（Rod of Atos）',
  item_shivas_guard:     '希瓦的守护（Shiva\'s Guard）',
};

// Archetype categories:
//   teamfight_initiator  — Tidehunter, Centaur
//   lane_bully_tempo     — Razor, Viper, Necrophos
//   aura_tank_save       — Abaddon
//   utility_save_initiator — Vengeful Spirit

const PROFILES = {
  necrophos: {
    heroName:          'Necrophos',
    heroNameZh:        '死灵法师',
    dotaHeroName:      'npc_dota_hero_necrolyte',
    archetype:         'lane_bully_tempo',
    // Ordered progression — suggest the first item the player doesn't own
    keyItems:          ['item_hood_of_defiance', 'item_kaya_and_sange', 'item_eternal_shroud', 'item_aghanims_scepter'],
    powerSpikeItems:   ['item_kaya_and_sange', 'item_aghanims_scepter'],
    preferredPlaystyle: 'lane_bully',
    reviewFocus:       ['lane_pressure', 'kill_timing', 'tempo'],
  },
  razor: {
    heroName:          'Razor',
    heroNameZh:        '电魂',
    dotaHeroName:      'npc_dota_hero_razor',
    archetype:         'lane_bully_tempo',
    keyItems:          ['item_hood_of_defiance', 'item_blade_mail', 'item_black_king_bar', 'item_assault'],
    powerSpikeItems:   ['item_blade_mail', 'item_black_king_bar'],
    preferredPlaystyle: 'lane_bully',
    reviewFocus:       ['lane_pressure', 'tower_push', 'tempo'],
  },
  viper: {
    heroName:          'Viper',
    heroNameZh:        '冥毒蛇',
    dotaHeroName:      'npc_dota_hero_viper',
    archetype:         'lane_bully_tempo',
    keyItems:          ['item_hood_of_defiance', 'item_aghanims_scepter', 'item_pipe', 'item_rod_of_atos'],
    powerSpikeItems:   ['item_aghanims_scepter'],
    preferredPlaystyle: 'lane_bully',
    reviewFocus:       ['lane_pressure', 'kill_timing', 'tempo'],
  },
  tidehunter: {
    heroName:          'Tidehunter',
    heroNameZh:        '潮汐猎手',
    dotaHeroName:      'npc_dota_hero_tidehunter',
    archetype:         'teamfight_initiator',
    keyItems:          ['item_vanguard', 'item_blink', 'item_pipe', 'item_crimson_guard'],
    powerSpikeItems:   ['item_blink'],
    preferredPlaystyle: 'initiator',
    reviewFocus:       ['teamfight_timing', 'initiation', 'power_spike_usage'],
  },
  vengefulspirit: {
    heroName:          'Vengeful Spirit',
    heroNameZh:        '复仇之魂',
    dotaHeroName:      'npc_dota_hero_vengefulspirit',
    archetype:         'utility_save_initiator',
    keyItems:          ['item_force_staff', 'item_glimmer_cape', 'item_aghanims_scepter', 'item_black_king_bar'],
    powerSpikeItems:   ['item_force_staff', 'item_aghanims_scepter'],
    preferredPlaystyle: 'utility_frontliner',
    reviewFocus:       ['save_timing', 'utility_usage', 'initiation'],
  },
  abaddon: {
    heroName:          'Abaddon',
    heroNameZh:        '亚巴顿',
    dotaHeroName:      'npc_dota_hero_abaddon',
    archetype:         'aura_tank_save',
    keyItems:          ['item_mekansm', 'item_guardian_greaves', 'item_pipe', 'item_lotus_orb'],
    powerSpikeItems:   ['item_guardian_greaves', 'item_pipe'],
    preferredPlaystyle: 'aura_tank',
    reviewFocus:       ['team_items_timing', 'save_usage', 'aura_coverage'],
  },
  centaur: {
    heroName:          'Centaur Warrunner',
    heroNameZh:        '半人马战行者',
    dotaHeroName:      'npc_dota_hero_centaur',
    archetype:         'teamfight_initiator',
    keyItems:          ['item_vanguard', 'item_blink', 'item_pipe', 'item_crimson_guard'],
    powerSpikeItems:   ['item_blink'],
    preferredPlaystyle: 'initiator',
    reviewFocus:       ['teamfight_timing', 'blink_initiation', 'power_spike_usage'],
  },
};

function getProfileByDotaName(dotaHeroName) {
  if (!dotaHeroName) return null;
  return Object.values(PROFILES).find((p) => p.dotaHeroName === dotaHeroName) || null;
}

function getProfileKey(dotaHeroName) {
  if (!dotaHeroName) return null;
  return Object.keys(PROFILES).find((k) => PROFILES[k].dotaHeroName === dotaHeroName) || null;
}

module.exports = { PROFILES, ITEM_COSTS, ITEM_DISPLAY_NAMES, getProfileByDotaName, getProfileKey };
