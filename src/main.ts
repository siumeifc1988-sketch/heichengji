import './style.css';
import { applyStanceSettle, boardBuy, boardSell, openBlackMarket, sellProgress, xiangzhuClosed } from './blackmarket.ts';
import { createBattle, playerAction } from './combat.ts';
import { loadConfig } from './config.ts';
import { SAVE_NODE } from './design.ts';
import { formatNum } from './format.ts';
import { SCREEN_LABEL } from './labels.ts';
import {
  bringingWeapon,
  buyOne,
  chargenReport,
  discreteValues,
  draftToPlayer,
  sellOne,
  stepEffectValue,
  stepStat,
  toggleEquip,
} from './rules.ts';
import { clearSave, createAppState, readSave, readSaveBundle, writeSave } from './state.ts';
import type { AppState, ChapterConfig, PlayerState } from './types.ts';
import { renderApp, renderFatal } from './view.ts';

const appRoot = document.querySelector('#app');
if (!(appRoot instanceof HTMLElement)) throw new Error('缺 #app');
const root: HTMLElement = appRoot;

let config: ChapterConfig | null = null;
let state: AppState | null = null;
let lastScreen: AppState['screen'] | null = null;
let composing = false;

void boot();

async function boot(): Promise<void> {
  try {
    config = await loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : '讀唔到章節設定';
    root.innerHTML = renderFatal(message);
    return;
  }
  const bundle = readSaveBundle(config);
  state = createAppState(config, bundle !== null);
  if (bundle && (bundle.player.settle || bundle.player.flags.stanceId)) {
    landPlayer(state, bundle.player);
    const screen = bundle.resumeScreen;
    if (screen === 'blackmarket' || screen === 'done' || screen === 'stance') state.screen = screen;
  }
  draw();
  root.addEventListener('click', onClick);
  root.addEventListener('input', onField);
  root.addEventListener('change', onField);
  root.addEventListener('compositionstart', () => {
    composing = true;
  });
  root.addEventListener('compositionend', (event) => {
    composing = false;
    onField(event);
  });
}

function draw(): void {
  if (!config || !state || !root) return;
  const screenChanged = lastScreen !== state.screen;
  const focus = screenChanged ? null : captureFocus();
  const scrollY = screenChanged ? 0 : window.scrollY;
  root.innerHTML = renderApp(config, state);
  document.title = `黑秤記 · ${config.chapter.title} · ${SCREEN_LABEL[state.screen]}`;
  const log = document.getElementById('battle-log');
  if (log) log.scrollTop = log.scrollHeight;
  if (state.warnFight) {
    document.getElementById('warn-confirm')?.focus();
  } else if (focus) restoreFocus(focus);
  else {
    const heading = root.querySelector('h2');
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }
  window.scrollTo(0, scrollY);
  lastScreen = state.screen;
}

function onClick(event: Event): void {
  if (!config || !state) return;
  const button = eventElement(event)?.closest('button[data-action]');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return;
  const action = button.dataset.action ?? '';
  const chapter = config;
  const app = state;

  if (action === 'prologue-next') {
    const beats = chapter.prologue.beats;
    if (app.beat < beats.length - 1) app.beat += 1;
    else app.screen = 'chargen';
    app.note = '';
    draw();
    return;
  }
  if (action === 'prologue-skip') {
    if (!chapter.prologue.skippable) return;
    app.screen = 'chargen';
    app.note = '';
    draw();
    return;
  }
  if (action === 'load-save') {
    const player = readSave(chapter);
    if (!player) {
      app.hasSave = false;
      app.note = '存檔讀唔到。';
      draw();
      return;
    }
    landPlayer(app, player);
    app.note = `讀返節點 ${SAVE_NODE} 嘅存檔。`;
    draw();
    return;
  }
  if (action === 'to-prologue') {
    app.screen = 'prologue';
    app.beat = 0;
    app.note = '';
    draw();
    return;
  }
  if (action === 'stat-inc' || action === 'stat-dec') {
    const key = button.dataset.stat;
    if (!key) return;
    stepStat(chapter, app.draft.stats, key, action === 'stat-inc' ? 1 : -1);
    app.note = '';
    draw();
    return;
  }
  if (action === 'effect-add') {
    if (app.draft.effects.length >= chapter.chargen.skill.maxEffects) return;
    app.draft.effects.push({ op: '', value: Number.NaN });
    app.note = '';
    draw();
    return;
  }
  if (action === 'effect-remove') {
    const index = readIndex(button);
    if (index < 0) return;
    app.draft.effects.splice(index, 1);
    app.note = '';
    draw();
    return;
  }
  if (action === 'effect-inc' || action === 'effect-dec') {
    const index = readIndex(button);
    const effect = app.draft.effects[index];
    if (!effect) return;
    stepEffectValue(chapter, effect, action === 'effect-inc' ? 1 : -1);
    app.note = '';
    draw();
    return;
  }
  if (action === 'confirm') {
    const report = chargenReport(chapter, app.draft);
    if (!report.valid) {
      app.note = '仲未開得檔。';
      draw();
      return;
    }
    const player = draftToPlayer(chapter, app.draft);
    app.player = player;
    app.screen = 'market';
    app.note = `開檔完成。本金 ${formatNum(player.cash)} ${chapter.currency.label}（設計初值），可以睇市集價錢。`;
    draw();
    return;
  }
  if (action === 'board-buy' || action === 'board-sell') {
    if (!app.player?.board?.opened) return;
    const goodId = button.dataset.good ?? '';
    const result = action === 'board-buy' ? boardBuy(chapter, app.player, goodId) : boardSell(chapter, app.player, goodId);
    app.note = result.message;
    if (app.player.settle) writeSave(chapter, app.player, app.screen);
    draw();
    return;
  }
  if (action === 'buy' || action === 'sell') {
    if (!app.player) return;
    const goodId = button.dataset.good ?? '';
    const result = action === 'buy' ? buyOne(chapter, app.player, goodId) : sellOne(chapter, app.player, goodId);
    app.note = result.message;
    draw();
    return;
  }
  if (action === 'fight') {
    if (!app.player) return;
    if (xiangzhuClosed(chapter, app.player)) {
      app.note = '香主已了結。';
      draw();
      return;
    }
    const required = chapter.combat.requireItemToFight;
    const held = required
      ? (app.player.inventory[required] ?? 0) > 0
        || app.player.equipment.weapon === required
        || app.player.equipment.armor === required
      : true;
    if (!held) {
      app.note = '未齊開戰條件。';
      draw();
      return;
    }
    if (!bringingWeapon(chapter, app.player)) {
      app.warnFight = true;
      draw();
      return;
    }
    startFight();
    return;
  }
  if (action === 'warn-cancel') {
    app.warnFight = false;
    app.note = '';
    draw();
    return;
  }
  if (action === 'warn-confirm') {
    startFight();
    return;
  }
  if (action === 'equip') {
    if (!app.player) return;
    const result = toggleEquip(chapter, app.player, button.dataset.good ?? '');
    app.note = result.message;
    draw();
    return;
  }
  if (action === 'battle-attack' || action === 'battle-guard' || action === 'battle-skill' || action === 'battle-salt') {
    if (!app.player || !app.battle) return;
    const move = action.slice('battle-'.length) as 'attack' | 'guard' | 'skill' | 'salt';
    playerAction(app.battle, chapter, app.player, move, Math.random);
    if (app.battle.phase === 'win') {
      app.player.flags.beatXiangzhu = true;
      app.screen = 'win';
    } else if (app.battle.phase === 'lose') {
      app.screen = 'gameover';
    }
    draw();
    return;
  }
  if (action === 'enter-black-market') {
    if (!app.player) return;
    app.player.flags.beatXiangzhu = true;
    openBlackMarket(chapter, app.player, app.preFightStock ?? { ...app.player.inventory });
    app.battle = null;
    app.screen = 'blackmarket';
    app.note = '';
    draw();
    return;
  }
  if (action === 'meet-steward') {
    if (!app.player) return;
    if (!sellProgress(chapter, app.player).unlocked) {
      app.note = chapter.postFightBlackMarket.mustSell.hint;
      draw();
      return;
    }
    app.player.flags.postFightMarketDone = true;
    app.screen = 'stance';
    app.note = '';
    draw();
    return;
  }
  if (action === 'stance') {
    if (!app.player?.flags.postFightMarketDone || !app.player.board?.opened) return;
    const redeem = app.redeemStock ?? chapter.m3.settle.autoRedeemAppliesToStock;
    const receipt = applyStanceSettle(chapter, app.player, button.dataset.stance ?? '', redeem);
    if (!receipt) return;
    app.note = '';
    writeSave(chapter, app.player, 'stance');
    draw();
    return;
  }
  if (action === 'finish') {
    if (!app.player?.settle) return;
    app.screen = 'done';
    app.note = '';
    writeSave(chapter, app.player, app.screen);
    draw();
    return;
  }
  if (action === 'stay-board') {
    if (!app.player?.settle) return;
    app.screen = 'blackmarket';
    app.battle = null;
    app.note = '留喺攤檔。香主已了結。';
    writeSave(chapter, app.player, app.screen);
    draw();
    return;
  }
  if (action === 'new-run') {
    clearSave();
    state = createAppState(chapter, false);
    draw();
    return;
  }
  if (action === 'gameover-reload') {
    const saved = readSave(chapter);
    if (!saved) {
      app.hasSave = false;
      app.note = '冇 OpenBoard 存檔可讀。';
      draw();
      return;
    }
    landPlayer(app, saved);
    app.note = `讀返節點 ${SAVE_NODE} 嘅存檔。`;
    draw();
    return;
  }
  if (action === 'gameover-new') {
    state = createAppState(chapter, readSave(chapter) !== null);
    draw();
    return;
  }
  if (action === 'to-market') {
    app.screen = 'market';
    app.battle = null;
    app.note = '';
    draw();
    return;
  }
  if (action === 'save') {
    if (!app.player) return;
    const ok = writeSave(chapter, app.player, app.screen);
    app.hasSave = ok;
    app.note = ok ? `已寫入本機存檔，節點 ${SAVE_NODE}。` : '寫唔到本機存檔。';
    draw();
    return;
  }
  if (action === 'restart') {
    if (!window.confirm('清走本機存檔，返去序幕？')) return;
    clearSave();
    state = createAppState(chapter, false);
    draw();
  }
}

function landPlayer(app: AppState, player: PlayerState): void {
  app.player = player;
  app.battle = null;
  app.warnFight = false;
  app.hasSave = true;
  if (player.flags.stanceId) app.screen = 'done';
  else if (player.flags.postFightMarketDone) app.screen = 'stance';
  else if (player.board?.opened) app.screen = 'blackmarket';
  else app.screen = 'market';
}

function startFight(): void {
  if (!config || !state?.player) return;
  state.warnFight = false;
  state.preFightStock = { ...state.player.inventory };
  state.battle = createBattle(config, state.player);
  state.screen = 'combat';
  state.note = '';
  draw();
}

function onField(event: Event): void {
  if (composing || !config || !state) return;
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) {
    return;
  }
  const action = field.dataset.action ?? '';
  if (!action.startsWith('field-')) return;
  const app = state;
  app.note = '';
  if (action === 'field-redeem' && field instanceof HTMLInputElement) {
    app.redeemStock = field.checked;
  } else if (action === 'field-name') app.draft.name = field.value;
  else if (action === 'field-catchphrase') app.draft.catchphrase = field.value;
  else if (action === 'field-skill-name') app.draft.skillName = field.value;
  else if (action === 'field-skill-flavor') app.draft.skillFlavor = field.value;
  else if (action === 'field-trigger') app.draft.skillTrigger = field.value;
  else if (action === 'field-stat') {
    const key = field.dataset.stat;
    if (!key) return;
    const raw = field.value.trim();
    app.draft.stats[key] = raw === '' ? Number.NaN : Number(raw);
  } else if (action === 'field-effect-op') {
    const index = readIndex(field);
    const effect = app.draft.effects[index];
    if (!effect) return;
    const op = field.value;
    effect.op = op;
    const def = config.chargen.skill.ops[op];
    effect.value = def ? (discreteValues(def)[0] ?? Number.NaN) : Number.NaN;
  } else {
    return;
  }
  draw();
}

function eventElement(event: Event): Element | null {
  const target = event.target;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function readIndex(element: HTMLElement): number {
  const index = Number(element.dataset.index);
  return Number.isInteger(index) ? index : -1;
}

function captureFocus(): { id: string; start: number | null; end: number | null } | null {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || !element.id || !root?.contains(element)) return null;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return { id: element.id, start: element.selectionStart, end: element.selectionEnd };
  }
  return { id: element.id, start: null, end: null };
}

function restoreFocus(saved: { id: string; start: number | null; end: number | null }): void {
  const element = document.getElementById(saved.id);
  if (!(element instanceof HTMLElement)) return;
  element.focus();
  if (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    saved.start !== null &&
    saved.end !== null
  ) {
    try {
      element.setSelectionRange(saved.start, saved.end);
    } catch {
      /* number inputs */
    }
  }
}
