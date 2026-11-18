// Shared command helpers: response delivery and optional battle-panel refresh.
import { sayFlow } from '../util.js';
import { refreshBattlePanel } from '../game/ui.js';

// Send the result first; refresh only when the caller marked the context.
export async function sayThenRefresh(ctx, text) {
  await sayFlow(ctx, text);
  if (ctx.refreshAfter) {
    ctx.refreshAfter = false;
    await refreshBattlePanel(ctx.env, ctx.chat);
  }
}