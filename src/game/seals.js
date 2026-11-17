import { SEALS, sealRoundsDefended, sealTargetCount } from './hadi-rules.js';
import { setEffect, removeEffect, getEffect } from './effects.js';

export { SEALS, sealRoundsDefended, sealTargetCount };

export async function applySeal(env, { chat, ownerId, targetId, kind = 'one_round', rounds = 1, data = {} }) {
  if (await getEffect(env, chat, targetId, 'anti_seal')) return { applied: false, reason: 'anti_seal' };
  const type = kind === 'mental' ? 'mental_seal' : 'physical_seal';
  await setEffect(env, {
    chat, ownerId, targetId, type,
    rounds: kind === 'one_round' ? 1 : rounds, data
  });
  if (kind === 'mental') await removeEffect(env, chat, targetId, 'domain');
  return { applied: true };
}

export async function releaseSeal(env, chat, targetId, kind = 'physical_seal') {
  await removeEffect(env, chat, targetId, kind);
  await setEffect(env, { chat, targetId, ownerId: 0, type: 'anti_seal', rounds: SEALS.antiSealRounds });
}

export async function isSealed(env, chat, targetId) {
  return Boolean(await getEffect(env, chat, targetId, 'physical_seal') || await getEffect(env, chat, targetId, 'mental_seal'));
}
