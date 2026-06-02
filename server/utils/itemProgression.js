// Pure helper: extract item state from a death snapshot for key item progression inference.

/**
 * Given a death snapshot, return a structured item state object.
 * This is a pure function with no side effects — safe to use in tests and analysis pipelines.
 *
 * @param {object} snapshot - A hero_death event's snapshot field
 * @returns {{
 *   inventoryNames: string[],
 *   backpackNames:  string[],
 *   stashNames:     string[],
 *   neutralName:    string|null,
 *   allNames:       string[],
 * }}
 */
function extractItemStateForProgression(snapshot) {
  if (!snapshot) {
    return { inventoryNames: [], backpackNames: [], stashNames: [], neutralName: null, allNames: [] };
  }

  const inventoryNames = Object.values(snapshot.inventoryAtDeath || {}).filter(Boolean);
  const backpackNames  = Object.values(snapshot.backpackAtDeath  || {}).filter(Boolean);
  const stashNames     = Object.values(snapshot.stashAtDeath     || {}).filter(Boolean);
  const neutralName    = snapshot.neutralItemAtDeath || null;

  const allNames = [
    ...inventoryNames,
    ...backpackNames,
    ...stashNames,
    ...(neutralName ? [neutralName] : []),
  ];

  return { inventoryNames, backpackNames, stashNames, neutralName, allNames };
}

module.exports = { extractItemStateForProgression };
