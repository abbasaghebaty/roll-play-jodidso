// Pure resource-cost planning. It never checks out or mutates actor resources.
import { techNpCost } from '../rules.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const error = (code, message) => ({ stage: 'costs', code, message });

function countResolvedTargets(targets) {
  if (!Array.isArray(targets)) return null;
  const ids = targets.map((target) => target?.id);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(ids).size !== ids.length) return null;
  return ids.length;
}

export function calculateAbilityCost({ ability, effects, targets } = {}) {
  if (!isRecord(ability) || !isRecord(ability.cost) || !Array.isArray(effects)) {
    return { ok: false, costs: [], errors: [error('invalid_cost_input', 'Ability cost or planned effects are invalid.')] };
  }
  const cost = ability.cost;
  if (cost.mode === 'none') return { ok: true, costs: [], errors: [] };

  if (cost.mode === 'fixed') {
    if (!Object.hasOwn(cost, 'resource') || !Object.hasOwn(cost, 'amount')) {
      return { ok: false, costs: [], errors: [error('malformed_fixed_cost', 'Fixed Cost requires resource and amount fields.')] };
    }
    if (cost.resource !== 'np') {
      const code = cost.resource === 'hp' ? 'fixed_cost_resource_forbidden' : 'unsupported_fixed_cost_resource';
      return { ok: false, costs: [], errors: [error(code, 'Phase 4 Fixed Cost supports only resource "np".')] };
    }
    if (typeof cost.amount !== 'number' || !Number.isFinite(cost.amount) || cost.amount < 0) {
      return { ok: false, costs: [], errors: [error('invalid_fixed_cost_amount', 'Fixed Cost amount must be a finite non-negative number.')] };
    }
    if (Object.hasOwn(cost, 'perTarget') && typeof cost.perTarget !== 'boolean') {
      return { ok: false, costs: [], errors: [error('invalid_per_target_flag', 'Fixed Cost perTarget must be a boolean when provided.')] };
    }
    if (cost.perTarget !== true) {
      return { ok: true, costs: [{ mode: 'fixed', resource: 'np', amount: cost.amount }], errors: [] };
    }
    const targetCount = countResolvedTargets(targets);
    if (targetCount === null) {
      return { ok: false, costs: [], errors: [error('invalid_resolved_targets', 'Per-target Fixed Cost requires unique positive integer IDs from resolved targets.')] };
    }
    const amount = cost.amount * targetCount;
    if (!Number.isFinite(amount)) {
      return { ok: false, costs: [], errors: [error('invalid_calculated_cost', 'Per-target Fixed Cost total must be finite.')] };
    }
    return {
      ok: true,
      costs: [{
        mode: 'fixed', resource: 'np', perTarget: true,
        unitAmount: cost.amount, targetCount, amount,
      }],
      errors: [],
    };
  }

  if (cost.mode === 'legacy') {
    if (cost.resolver !== 'techNpCost') {
      return { ok: false, costs: [], errors: [error('unsupported_legacy_cost_resolver', 'Legacy Cost requires the techNpCost resolver.')] };
    }
    const legacy = ability.config?.legacy;
    if (!isRecord(legacy)) {
      return { ok: false, costs: [], errors: [error('missing_legacy_calculation_data', 'Legacy Cost requires config.legacy calculation data.')] };
    }
    const damage = effects.find((effect) => effect.type === 'damage');
    if (!damage || typeof damage.amount !== 'number' || !Number.isFinite(damage.amount) || damage.amount <= 0) {
      return { ok: false, costs: [], errors: [error('legacy_cost_requires_damage', 'Legacy technique cost requires the already-planned positive damage amount.')] };
    }
    let amount;
    try {
      amount = techNpCost(legacy, damage.amount);
    } catch (cause) {
      return { ok: false, costs: [], errors: [error('calculation_failed', 'techNpCost failed (' + (cause?.name || 'Error') + ').')] };
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      return { ok: false, costs: [], errors: [error('invalid_calculation_result', 'techNpCost must return a finite non-negative amount.')] };
    }
    return { ok: true, costs: [{ mode: 'legacy', resource: 'np', resolver: 'techNpCost', amount }], errors: [] };
  }
  return { ok: false, costs: [], errors: [error('unsupported_cost_mode', 'Cost mode "' + String(cost.mode) + '" is not supported in Phase 4.')] };
}
