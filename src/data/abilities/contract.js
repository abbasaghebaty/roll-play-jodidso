// Shared, data-only Ability contract. It describes capabilities; it does not execute them.
export const ABILITY_CATEGORIES = Object.freeze(['attack', 'defense', 'support', 'summon', 'utility']);
export const ABILITY_EXECUTION_MODES = Object.freeze(['legacy', 'standard', 'handler', 'multi_stage']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

function validateDescriptorList(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(path + ' must be an array');
    return;
  }
  value.forEach((item, index) => {
    const at = path + '[' + index + ']';
    if (!isRecord(item) || !isNonEmptyString(item.type)) {
      errors.push(at + ' must be an object with a non-empty type');
    }
  });
}

export function validateAbility(ability, { path = 'ability' } = {}) {
  const errors = [];
  if (!isRecord(ability)) return [path + ' must be an object'];
  for (const field of ['id', 'code', 'key', 'category']) {
    if (!isNonEmptyString(ability[field])) errors.push(path + '.' + field + ' is required');
  }
  if (!isRecord(ability.name) || !isNonEmptyString(ability.name.fa)) {
    errors.push(path + '.name.fa is required');
  }
  if (!isRecord(ability.owners) || !['any', 'allowlist'].includes(ability.owners.mode)) {
    errors.push(path + '.owners.mode must be any or allowlist');
  } else if (ability.owners.mode === 'allowlist') {
    if (!Array.isArray(ability.owners.characterIds) ||
        ability.owners.characterIds.some((id) => !isNonEmptyString(id))) {
      errors.push(path + '.owners.characterIds must be an array of non-empty character IDs');
    }
  }
  validateDescriptorList(ability.conditions, path + '.conditions', errors);
  if (!isRecord(ability.targeting) || !isNonEmptyString(ability.targeting.mode)) {
    errors.push(path + '.targeting.mode is required');
  }
  if (!isRecord(ability.targeting) ||
      !['manual', 'automatic', 'none'].includes(ability.targeting.selection)) {
    errors.push(path + '.targeting.selection must be manual, automatic or none');
  }
  if (!isRecord(ability.cost) || !isNonEmptyString(ability.cost.mode)) {
    errors.push(path + '.cost.mode is required');
  } else if (ability.cost.mode === 'legacy' && !isNonEmptyString(ability.cost.resolver)) {
    errors.push(path + '.cost.resolver is required for legacy cost');
  }
  validateDescriptorList(ability.effects, path + '.effects', errors);
  if (!isRecord(ability.execution) || !isNonEmptyString(ability.execution.mode)) {
    errors.push(path + '.execution.mode is required');
  } else if (['handler', 'legacy'].includes(ability.execution.mode) &&
      !isNonEmptyString(ability.execution.handler)) {
    errors.push(path + '.execution.handler is required for ' + ability.execution.mode + ' execution');
  }
  if (!isRecord(ability.config)) errors.push(path + '.config must be an object');
  if (typeof ability.active !== 'boolean') errors.push(path + '.active must be an explicit boolean');
  return errors;
}

export function validateAbilities(abilities) {
  const errors = [];
  if (!Array.isArray(abilities)) return ['abilities must be an array'];
  const seen = { id: new Set(), code: new Set(), key: new Set() };
  abilities.forEach((ability, index) => {
    errors.push(...validateAbility(ability, { path: 'abilities[' + index + ']' }));
    if (!isRecord(ability)) return;
    for (const field of Object.keys(seen)) {
      const value = ability[field];
      const normalized = field === 'code' ? String(value || '').toUpperCase() : value;
      if (isNonEmptyString(normalized) && seen[field].has(normalized)) {
        errors.push('abilities[' + index + ']: duplicate ' + field + ' ' + normalized);
      }
      if (isNonEmptyString(normalized)) seen[field].add(normalized);
    }
  });
  return errors;
}

// Handlers return declarative effect intents; they never mutate game state, D1, or UI.
export function validateAbilityHandlerResult(result) {
  const errors = [];
  if (!isRecord(result)) return ['handler result must be an object'];
  if (!['ready', 'rejected'].includes(result.status)) errors.push('handler result.status must be ready or rejected');
  if (!Array.isArray(result.effects) ||
      result.effects.some((effect) => !isRecord(effect) || !isNonEmptyString(effect.type))) {
    errors.push('handler result.effects must be an array of typed effect objects');
  }
  if (result.status === 'rejected' && Array.isArray(result.effects) && result.effects.length) {
    errors.push('handler result.effects must be empty when rejected');
  }
  if (result.status === 'rejected' && !isNonEmptyString(result.reason)) {
    errors.push('handler result.reason is required when rejected');
  }
  if (result.metadata !== undefined && !isRecord(result.metadata)) {
    errors.push('handler result.metadata must be an object when provided');
  }
  return errors;
}
