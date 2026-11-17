import { SEALS, sealRoundsDefended, sealTargetCount } from './hadi-rules.js';
import { setEffect, removeEffect, getEffect } from './effects.js';

export { SEALS, sealRoundsDefended, sealTargetCount };

export async function applySeal(env, { chat, ownerId, targetId, kind = 'one_round', rounds = 1, data = {} }) {
  await setEffect(env, {
    chat, ownerId, targetId, type: kind === 'mental' ? 'mental_seal' : 'physical_seal',
    rounds: kind === 'one_round' ? 1 : rounds, data
  });
}

export async function releaseSeal(env, chat, targetId, kind = 'physical_seal') {
  await removeEffect(env, chat, targetId, kind);
  await setEffect(env, { chat, targetId, ownerId: 0, type: 'anti_seal', rounds: SEALS.antiSealRounds });
}

export async function isSealed(env, chat, targetId) {
  return Boolean(await getEffect(env, chat, targetId, 'physical_seal') || await getEffect(env, chat, targetId, 'mental_seal'));
}
