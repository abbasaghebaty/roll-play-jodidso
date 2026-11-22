// Pure Effect planning. This module creates intents; it never applies them.
import { techDamage, defenseValue } from '../rules.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const error = (code, message) => ({ stage: 'effects', code, message });

function resolvedTargetIds(targets) {
  if (!Array.isArray(targets)) return null;
  const ids = targets.map((target) => target?.id);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(ids).size !== ids.length) return null;
  return ids;
}

export function planEffects({ ability, context, targets } = {}) {
  if (!isRecord(ability) || !Array.isArray(ability.effects) ||
      !isRecord(context) || !Array.isArray(targets)) {
    return { ok: false, effects: [], errors: [error('invalid_effect_input', 'Ability, Context, or resolved targets are invalid.')] };
  }
  const targetIds = resolvedTargetIds(targets);
  if (targetIds === null) {
    return { ok: false, effects: [], errors: [error('invalid_resolved_targets', 'Resolved targets must have unique positive integer IDs.')] };
  }
  const calculation = context.calculation === undefined ? {} : context.calculation;
  if (!isRecord(calculation)) {
    return { ok: false, effects: [], errors: [error('invalid_calculation_context', 'context.calculation must be an object.')] };
  }
  const legacy = isRecord(ability.config?.legacy) ? ability.config.legacy : null;
  const effects = [];
  const errors = [];

  for (let index = 0; index < ability.effects.length; index += 1) {
    const definition = ability.effects[index];
    if (!isRecord(definition) || typeof definition.type !== 'string') {
      errors.push(error('invalid_effect_definition', 'Effect at index ' + index + ' must be a typed object.'));
      continue;
    }
    if (definition.type === 'heal') {
      if (definition.resolver !== 'fixed') {
        errors.push(error('unsupported_effect_resolver', 'Heal Effect requires the fixed resolver in Phase 4.'));
        continue;
      }
      if (typeof definition.amount !== 'number' || !Number.isFinite(definition.amount) || definition.amount <= 0) {
        errors.push(error('invalid_heal_amount', 'Heal Effect amount must be a finite positive number.'));
        continue;
      }
      if (targetIds.length === 0) {
        errors.push(error('heal_requires_targets', 'Heal Effect requires at least one resolved target.'));
        continue;
      }
      effects.push({ type: 'heal', resolver: 'fixed', amount: definition.amount, targetIds: [...targetIds] });
      continue;
    }
    if (definition.type === 'damage') {
      if (definition.resolver !== 'techDamage') {
        errors.push(error('unsupported_effect_resolver', 'Damage Effect requires the techDamage resolver.'));
        continue;
      }
      if (!Object.hasOwn(calculation, 'finalRoll')) {
        errors.push(error('missing_final_roll', 'Damage Effect requires context.calculation.finalRoll.'));
        continue;
      }
      const finalRoll = calculation.finalRoll;
      if (typeof finalRoll !== 'number' || !Number.isFinite(finalRoll) || finalRoll <= 0) {
        errors.push(error('invalid_final_roll', 'Damage Effect requires a finite positive finalRoll.'));
        continue;
      }
      if (!legacy) {
        errors.push(error('missing_legacy_calculation_data', 'Damage Effect requires config.legacy calculation data.'));
        continue;
      }
      let amount;
      try {
        amount = techDamage(legacy, finalRoll);
      } catch (cause) {
        errors.push(error('calculation_failed', 'techDamage failed (' + (cause?.name || 'Error') + ').'));
        continue;
      }
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        errors.push(error('invalid_calculation_result', 'techDamage must return a finite positive damage value.'));
        continue;
      }
      effects.push({ type: 'damage', resolver: 'techDamage', amount, targetIds: [...targetIds] });
      continue;
    }
    if (definition.type === 'defense') {
      if (definition.resolver !== 'defenseValue') {
        errors.push(error('unsupported_effect_resolver', 'Defense Effect requires the defenseValue resolver.'));
        continue;
      }
      if (!Object.hasOwn(calculation, 'defenseRoll')) {
        errors.push(error('missing_defense_roll', 'Defense Effect requires context.calculation.defenseRoll.'));
        continue;
      }
      const defenseRoll = calculation.defenseRoll;
      // The live defense path supplies d10(): an integer from 1 through 10.
      if (!Number.isInteger(defenseRoll) || defenseRoll < 1 || defenseRoll > 10) {
        errors.push(error('invalid_defense_roll', 'Defense Effect requires an integer defenseRoll from 1 through 10.'));
        continue;
      }
      if (!legacy) {
        errors.push(error('missing_legacy_calculation_data', 'Defense Effect requires config.legacy calculation data.'));
        continue;
      }
      let value;
      try {
        value = defenseValue(legacy, defenseRoll);
      } catch (cause) {
        errors.push(error('calculation_failed', 'defenseValue failed (' + (cause?.name || 'Error') + ').'));
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        errors.push(error('invalid_calculation_result', 'defenseValue must return a finite non-negative value.'));
        continue;
      }
      effects.push({ type: 'defense', resolver: 'defenseValue', value, targetIds: [...targetIds] });
      continue;
    }
    errors.push(error('unsupported_effect', 'Effect type "' + definition.type + '" is not supported in Phase 4.'));
  }
  return { ok: errors.length === 0, effects: errors.length === 0 ? effects : [], errors };
}
