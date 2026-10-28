import { handleUpdate } from './commands.js';

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('anime-rpg-bot is running');

    // Configure WEBHOOK_SECRET in Cloudflare and use the same secret in Telegram's webhook.
    if (!env.WEBHOOK_SECRET) {
      console.error('WEBHOOK_SECRET is not configured');
      return new Response('webhook secret is not configured', { status: 503 });
    }
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    if (!env.BOT_TOKEN || !env.DB) {
      console.error('Missing BOT_TOKEN or D1 binding DB');
      return new Response('server configuration error', { status: 500 });
    }

    let update;
    try {
      update = await req.json();
    } catch {
      return new Response('invalid JSON', { status: 400 });
    }

    try {
      await handleUpdate(update, env);
      return new Response('ok');
    } catch (e) {
      console.error('Failed to handle Telegram update:', e);
      // Non-2xx lets Telegram retry the update instead of silently losing it.
      return new Response('update failed', { status: 500 });
    }
  },
};
