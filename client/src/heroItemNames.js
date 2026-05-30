// Shared Chinese display name maps for heroes and items.
// Format: 中文（English）

export const ITEM_ZH = {
  item_vanguard:         '先锋盾（Vanguard）',
  item_blink:            '闪烁匕首（Blink Dagger）',
  item_pipe:             '洞察烟斗（Pipe of Insight）',
  item_crimson_guard:    '猩红卫士（Crimson Guard）',
  item_black_king_bar:   '黑皇杖（Black King Bar）',
  item_blade_mail:       '刃甲（Blade Mail）',
  item_hood_of_defiance: '抗魔斗篷（Hood of Defiance）',
  item_eternal_shroud:   '永恒裹布（Eternal Shroud）',
  item_aghanims_scepter: "阿哈利姆神杖（Aghanim's Scepter）",
  item_kaya_and_sange:   '凯亚与桑格（Kaya and Sange）',
  item_force_staff:      '推推棒（Force Staff）',
  item_glimmer_cape:     '闪烁斗篷（Glimmer Cape）',
  item_mekansm:          '梅肯斯姆（Mekansm）',
  item_guardian_greaves: '守护者护胫（Guardian Greaves）',
  item_lotus_orb:        '莲花宝珠（Lotus Orb）',
  item_assault:          '强袭胸甲（Assault Cuirass）',
  item_rod_of_atos:      '阿托斯之棒（Rod of Atos）',
  item_shivas_guard:     "希瓦的守护（Shiva's Guard）",
};

// Keyed by dotaHeroName (npc_dota_hero_xxx)
export const HERO_ZH = {
  npc_dota_hero_necrolyte:      '死灵法师（Necrophos）',
  npc_dota_hero_razor:          '电魂（Razor）',
  npc_dota_hero_viper:          '冥毒蛇（Viper）',
  npc_dota_hero_tidehunter:     '潮汐猎手（Tidehunter）',
  npc_dota_hero_vengefulspirit: '复仇之魂（Vengeful Spirit）',
  npc_dota_hero_abaddon:        '亚巴顿（Abaddon）',
  npc_dota_hero_centaur:        '半人马战行者（Centaur Warrunner）',
};

export function heroDisplayName(dotaName) {
  if (!dotaName) return '未知英雄';
  return HERO_ZH[dotaName]
    || dotaName.replace('npc_dota_hero_', '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function itemDisplayName(itemKey) {
  if (!itemKey) return '—';
  return ITEM_ZH[itemKey]
    || itemKey.replace('item_', '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
