// In-memory match configuration. Resets when the server restarts.
// Persisted to disk is out of scope for MVP.

let config = {
  role: 'offlane',
  hero: null,        // dotaHeroName auto-populated from GSI
  heroKey: null,     // PROFILES key, e.g. 'centaur'
  playstyle: null,   // 'initiator' | 'aura_tank' | 'lane_bully' | 'utility_frontliner'
  keyItemOverride: null, // item internal name, or null for auto
};

function getConfig() {
  return { ...config };
}

function setConfig(updates) {
  config = { ...config, ...updates };
  return { ...config };
}

module.exports = { getConfig, setConfig };
