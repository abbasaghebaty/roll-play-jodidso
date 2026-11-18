// Backward-compatible UI entry point. UI concerns are split by responsibility.
export { sendDefensePrompt, clearDefensePrompts } from './ui/prompts.js';
export { renderBattlePanel, ensureBattlePanel, refreshBattlePanel } from './ui/panel.js';
export { handleBattleCallback } from './ui/callbacks.js';
