// Archetype-specific rules. Each archetype gets tailored reminders
// around power spike timing, tempo, and role-specific priorities.

// ctx = { heroProfile, suggested, getPowerSpikeState }
function getArchetypeRules(ctx) {
  const { heroProfile, getPowerSpikeState } = ctx || {};
  if (!heroProfile || !getPowerSpikeState) return [];

  const archetype = heroProfile.archetype;
  const rules = [];

  // ── teamfight_initiator (Tidehunter, Centaur) ───────────────────────────
  if (archetype === 'teamfight_initiator') {
    rules.push(
      {
        id: 'initiator_spike_ready',
        check(data) {
          const spike = getPowerSpikeState();
          if (!spike.active) return null;
          const elapsed = (data.map?.clock_time || 0) - spike.startClock;
          if (elapsed >= 0 && elapsed < 45) {
            return {
              message: `团战开团装已完成（${spike.itemName || '关键装备'}），进入强势期，可以考虑和队友开雾/逼塔。`,
              severity: 'info',
            };
          }
          return null;
        },
      },
      {
        id: 'initiator_spike_stale',
        check(data) {
          const spike = getPowerSpikeState();
          if (!spike.active) return null;
          const clock = data.map?.clock_time || 0;
          if (clock - spike.startClock < 180) return null;
          const currentKA = (data.player?.kills || 0) + (data.player?.assists || 0);
          if (currentKA <= spike.startKA) {
            return {
              message: '开团装完成 3 分钟内没有 K/A 产出，考虑主动和队友配合找机会。',
              severity: 'warning',
            };
          }
          return null;
        },
      }
    );
  }

  // ── lane_bully_tempo (Razor, Viper, Necrophos) ──────────────────────────
  if (archetype === 'lane_bully_tempo') {
    rules.push(
      {
        id: 'bully_tempo_stall',
        check(data, prevData) {
          if (!prevData) return null;
          const clock = data.map?.clock_time || 0;
          if (clock < 600 || clock > 2100) return null;
          const gpmDrop = (prevData.player?.gpm || 0) - (data.player?.gpm || 0);
          const kaChange =
            (data.player?.kills || 0) + (data.player?.assists || 0) -
            ((prevData.player?.kills || 0) + (prevData.player?.assists || 0));
          if (gpmDrop > 60 && kaChange === 0) {
            return {
              message: '前中期 GPM 持续停滞且没有节奏收益，不要被拖成低压制局。',
              severity: 'warning',
            };
          }
          return null;
        },
      },
      {
        id: 'bully_spike_push',
        check(data) {
          const spike = getPowerSpikeState();
          if (!spike.active) return null;
          const elapsed = (data.map?.clock_time || 0) - spike.startClock;
          if (elapsed >= 0 && elapsed < 45) {
            return {
              message: `核心战斗装备已完成（${spike.itemName || '关键装备'}），利用强势期主动压塔/控图。`,
              severity: 'info',
            };
          }
          return null;
        },
      }
    );
  }

  // ── aura_tank_save (Abaddon) ────────────────────────────────────────────
  if (archetype === 'aura_tank_save') {
    rules.push(
      {
        id: 'aura_spike_teamfight',
        check(data) {
          const spike = getPowerSpikeState();
          if (!spike.active) return null;
          const elapsed = (data.map?.clock_time || 0) - spike.startClock;
          if (elapsed >= 0 && elapsed < 45) {
            return {
              message: `团队功能装已完成（${spike.itemName || '关键装备'}），围绕核心打团，充分发挥光环效果。`,
              severity: 'info',
            };
          }
          return null;
        },
      },
      {
        id: 'aura_no_team_items',
        check(data) {
          const clock = data.map?.clock_time || 0;
          if (clock < 900) return null;
          const items = data.items || {};
          const allItems = [...Object.values(items.slot || {}), ...Object.values(items.stash || {})]
            .filter(Boolean)
            .map((i) => i.name);
          const teamItems = ['item_mekansm', 'item_guardian_greaves', 'item_pipe', 'item_lotus_orb', 'item_crimson_guard'];
          const hasTeamItem = teamItems.some((t) => allItems.includes(t));
          if (!hasTeamItem) {
            return {
              message: '支持位长时间没有团队功能装进展，优先补功能装而不是贪个人经济。',
              severity: 'warning',
            };
          }
          return null;
        },
      }
    );
  }

  // ── utility_save_initiator (Vengeful Spirit) ────────────────────────────
  if (archetype === 'utility_save_initiator') {
    rules.push(
      {
        id: 'utility_spike_ready',
        check(data) {
          const spike = getPowerSpikeState();
          if (!spike.active) return null;
          const elapsed = (data.map?.clock_time || 0) - spike.startClock;
          if (elapsed >= 0 && elapsed < 45) {
            return {
              message: `功能性道具已完成（${spike.itemName || '关键装备'}），可以围绕核心进行保护或先手开团。`,
              severity: 'info',
            };
          }
          return null;
        },
      }
    );
  }

  return rules;
}

module.exports = { getArchetypeRules };
