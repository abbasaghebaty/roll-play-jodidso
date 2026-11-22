import { first, run } from '../../db.js';
import { searchCharacters } from '../../data/registry/search.js';
import {
  getCharacterById,
  getCharacterByKey,
  getTechniquesByCharacter,
} from '../../data/registry/index.js';
import {
  createSelectionRequest,
  getActiveSelectionRequest,
  validateSelectionRequest,
  updateSelectionSearch,
  setSelectionCandidate,
  completeCharacterSelection,
  cancelSelectionRequest,
} from './requests.js';
import { send, sendKeyboard, answerCallback, esc } from '../../telegram.js';
import { refreshBattlePanel } from '../ui/panel.js';

const PAGE_SIZE = 5;

function selectionPromptMarkup(requestId) {
  return { inline_keyboard: [[{ text: 'لغو انتخاب', callback_data: `cs:x:${requestId}` }]] };
}

export async function startCharacterSelection(ctx, payload) {
  if (!ctx.private) return send(ctx.env, ctx.chat, 'لینک انتخاب کاراکتر را در پیوی ربات باز کن.');
  const result = await createSelectionRequest(ctx.env, {
    payload,
    userId: ctx.uid,
    privateChatId: ctx.chat,
    userName: ctx.uname,
    promptMessageId: ctx.msgId,
  });
  if (!result.ok) {
    return send(ctx.env, ctx.chat,
      result.reason === 'invalid_link'
        ? 'لینک انتخاب معتبر نیست.'
        : 'این لینک مربوط به مسابقه‌ای قدیمی است یا لابی آن بسته شده. از پنل فعلی گروه دوباره وارد شو.');
  }

  const sent = await sendKeyboard(
    ctx.env,
    ctx.chat,
    'نام فارسی، نام انگلیسی یا کد کاراکتر را بفرست. برای تغییر انتخاب هم می‌توانی کاراکتر دیگری جست‌وجو کنی.',
    selectionPromptMarkup(result.request.request_id),
  );
  await run(ctx.env.DB,
    'UPDATE character_selection_requests SET prompt_message_id=? WHERE request_id=? AND status=\'pending\'',
    sent.result.message_id, result.request.request_id);
}

async function showSearchResults(env, request, query, offset = 0) {
  const result = searchCharacters(query, { limit: PAGE_SIZE, offset });
  if (!result.total) {
    return send(env, request.private_chat_id,
      'کاراکتری با این نام یا کد پیدا نشد. املای دیگری را امتحان کن یا کد اختصاصی را بفرست.');
  }

  const rows = result.items.map(({ character, matchType, distance }) => [{
    text: `${character.name.fa} · ${character.code}`.slice(0, 60),
    callback_data: `cs:s:${request.request_id}:${character.id}`,
  }]);

  const navigation = [];
  if (offset > 0) navigation.push({
    text: 'صفحه قبل',
    callback_data: `cs:p:${request.request_id}:${Math.max(0, offset - PAGE_SIZE)}`,
  });
  if (result.hasMore) navigation.push({
    text: 'صفحه بعد',
    callback_data: `cs:p:${request.request_id}:${offset + PAGE_SIZE}`,
  });
  if (navigation.length) rows.push(navigation);
  rows.push([{ text: 'لغو', callback_data: `cs:x:${request.request_id}` }]);

  const exact = result.items.every((item) => item.matchType !== 'fuzzy');
  const heading = exact ? 'نتایج منطبق:' : 'پیشنهادهای نزدیک (برای انتخاب، خودت روی مورد درست بزن):';
  return sendKeyboard(env, request.private_chat_id,
    `${heading}\nنتیجه ${offset + 1} تا ${offset + result.items.length} از ${result.total}`,
    { inline_keyboard: rows });
}

export async function handleSelectionText(ctx, text) {
  if (!ctx.private) return false;
  const request = await getActiveSelectionRequest(ctx.env, ctx.uid, ctx.chat);
  if (!request) return false;

  const query = String(text || '').trim();
  if (!query) return send(ctx.env, ctx.chat, 'نام یا کد کاراکتر را بفرست.');
  await updateSelectionSearch(ctx.env, request, query);
  const refreshed = await first(ctx.env.DB,
    'SELECT * FROM character_selection_requests WHERE request_id=?',
    request.request_id);
  await showSearchResults(ctx.env, refreshed, query, 0);
  return true;
}

function renderCharacterConfirmation(character) {
  const techniques = getTechniquesByCharacter(character)
    .map((item) => item.name.fa)
    .join('، ') || 'بدون تکنیک ثبت‌شده';
  return [
    '<b>تأیید کاراکتر</b>',
    `نام: ${esc(character.name.fa)}`,
    `کد: <code>${esc(character.code)}</code>`,
    `❤️ حداکثر HP: ${character.stats.hp}`,
    `🔮 حداکثر NP: ${character.stats.np}`,
    `تکنیک‌ها: ${esc(techniques)}`,
    '',
    'با تأیید، انتخابت در لابی ثبت می‌شود. اگر قبلاً بازیکن این لابی باشی، مقدار فعلی HP و NP فقط در صورت بالاتر بودن از سقف جدید محدود می‌شود.',
  ].join('\n');
}

export async function handleSelectionCallback(query, env) {
  const data = String(query.data || '');
  const message = query.message;
  const userId = query.from?.id;
  if (!message || message.chat?.type !== 'private' || !userId || !data.startsWith('cs:')) {
    return answerCallback(env, query.id, 'این دکمه فقط در پیوی و برای صاحب درخواست معتبر است.', true);
  }

  const [, action, requestId, value] = data.split(':');
  const checked = await validateSelectionRequest(env, requestId, userId, message.chat.id);
  if (!checked.ok) {
    return answerCallback(env, query.id,
      checked.reason === 'expired_request' ? 'مهلت درخواست تمام شده.' :
        checked.reason === 'session_closed' ? 'این لابی بسته شده یا مسابقه تغییر کرده.' :
          'این درخواست دیگر فعال نیست. از پنل فعلی گروه دوباره وارد شو.',
      true);
  }
  const request = checked.request;

  if (action === 'x') {
    await cancelSelectionRequest(env, request);
    await answerCallback(env, query.id, 'درخواست لغو شد.');
    return send(env, message.chat.id, 'انتخاب کاراکتر لغو شد.');
  }

  if (action === 'p') {
    const offset = Math.max(0, Math.min(10000, Number(value) || 0));
    const current = await first(env.DB,
      'SELECT * FROM character_selection_requests WHERE request_id=?',
      requestId);
    await answerCallback(env, query.id, 'صفحه نتایج');
    return showSearchResults(env, current, current.search_query, offset);
  }

  if (action === 's') {
    const character = getCharacterById(value);
    if (!character || !character.active || character.hidden) {
      return answerCallback(env, query.id, 'این کاراکتر قابل انتخاب نیست.', true);
    }
    const saved = await setSelectionCandidate(env, request, character.key);
    if (!saved) return answerCallback(env, query.id, 'درخواست تغییر کرده؛ دوباره جست‌وجو کن.', true);
    await answerCallback(env, query.id, 'کاراکتر انتخاب شد؛ تأیید نهایی لازم است.');
    return sendKeyboard(env, message.chat.id, renderCharacterConfirmation(character), {
      inline_keyboard: [[
        { text: 'تأیید و ثبت', callback_data: `cs:y:${requestId}` },
        { text: 'لغو', callback_data: `cs:x:${requestId}` },
      ]],
    });
  }

  if (action === 'y') {
    const selected = getCharacterByKey(request.selected_char_key);
    if (!selected || !selected.active || selected.hidden) {
      return answerCallback(env, query.id, 'ابتدا یک کاراکتر معتبر انتخاب کن.', true);
    }
    const result = await completeCharacterSelection(env, request, selected);
    if (!result.applied) {
      return answerCallback(env, query.id, 'ثبت انجام نشد؛ احتمالاً لابی بسته شده یا درخواست هم‌زمان تغییر کرده است.', true);
    }
    await answerCallback(env, query.id, 'انتخاب ثبت شد.');
    await send(env, message.chat.id,
      `✅ ${esc(selected.name.fa)} برای این مسابقه ثبت شد.\n❤️ ${result.player.hp}/${result.player.max_hp}  🔮 ${result.player.np}/${result.player.max_np}`);
    await refreshBattlePanel(env, request.chat_id);
    return;
  }

  return answerCallback(env, query.id, 'عملیات انتخاب ناشناخته است.', true);
}
