import { DOMAIN_BARRIERS, domainClashWinner, domainBarrierBreakDamage, domainRounds } from './hadi-rules.js';
import { getEffect, setEffect, removeEffect } from './effects.js';

export { DOMAIN_BARRIERS, domainClashWinner, domainBarrierBreakDamage, domainRounds };

export async function activateDomain(env, { chat, ownerId, barrier, positiveRoll, data = {} }) {
  if (!DOMAIN_BARRIERS[barrier]) throw new Error('نوع حصار قلمرو معتبر نیست.');
  const rounds = domainRounds(positiveRoll);
  if (rounds < 1) throw new Error('برای فعال‌سازی قلمرو تاس مثبت لازم است.');
  await setEffect(env, {
    chat, ownerId, targetId: ownerId, type: 'domain', rounds,
    data: { barrier, guaranteedHit: !['higuruma', 'hakari', 'megumi'].includes(data.character), ...data }
  });
  return { rounds, npCost: DOMAIN_BARRIERS[barrier].np };
}

export async function endDomain(env, chat, ownerId) {
  await removeEffect(env, chat, ownerId, 'domain');
}
