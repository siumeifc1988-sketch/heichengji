import './style.css';
import { applyStanceSettle, boardBuy, boardSell, openBlackMarket, sellProgress, xiangzhuClosed } from './blackmarket.ts';
import { createBattle, playerAction } from './combat.ts';
import { loadConfig } from './config.ts';
import { SAVE_NODE } from './design.ts';
import { formatNum, formatSigned } from './format.ts';
import { SCREEN_LABEL } from './labels.ts';
import {
  activeForbidStats,
  bringingWeapon,
  buyOne,
  chargenReport,
  discreteValues,
  draftToPlayer,
  randomDraft,
  sellOne,
  statAtBound,
  statError,
  statPointDelta,
  stepEffectValue,
  stepStat,
  toggleEquip,
} from './rules.ts';
import { clearSave, createAppState, readSave, readSaveBundle, writeSave } from './state.ts';
import type { AppState, ChapterConfig, PlayerState } from './types.ts';
import { renderApp, renderFatal, renderIssues } from './view.ts';

const appRoot = document.querySelector('#app');
if (!(appRoot instanceof HTMLElement)) throw new Error('缺 #app');
const root: HTMLElement = appRoot;

let config: ChapterConfig | null = null;
let state: AppState | null = null;
let lastScreen: AppState['screen'] | null = null;
let composing = false;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_ATTACK_MS = 650;

interface FocusSnapshot {
  id: string;
  start: number | null;
  end: number | null;
}

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
  if (state.screen !== 'combat') stopAutoFight();
  const screenChanged = lastScreen !== state.screen;
  const focus = screenChanged ? null : captureFocus();
  const scrollY = screenChanged ? 0 : window.scrollY;
  root.innerHTML = renderApp(config, state);
  document.title = `黑秤記 · ${config.chapter.title} · ${SCREEN_LABEL[state.screen]}`;
  const log = document.getElementById('battle-log');
  if (log) log.scrollTop = log.scrollHeight;
  if (state.warnFight) {
    document.getElementById('warn-confirm')?.focus();
  } else if (focus) {
    restoreFocus(focus);
  } else if (screenChanged) {
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
  if (action === 'random-fill') {
    app.draft = randomDraft(chapter);
    app.note = '';
    draw();
    return;
  }
  if (action === 'random-enter') {
    app.draft = randomDraft(chapter);
    app.note = '';
    confirmChargen(chapter, app);
    draw();
    return;
  }
  if (action === 'confirm') {
    confirmChargen(chapter, app);
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
  if (action === 'battle-auto') {
    if (!app.player || !app.battle || app.screen !== 'combat') return;
    if (app.autoFight) {
      stopAutoFight();
      draw();
      return;
    }
    app.autoFight = true;
    draw();
    scheduleAutoAttack();
    return;
  }
  if (action === 'battle-attack' || action === 'battle-guard' || action === 'battle-skill' || action === 'battle-salt') {
    stopAutoFight();
    const move = action.slice('battle-'.length) as 'attack' | 'guard' | 'skill' | 'salt';
    resolveBattleMove(move);
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

function confirmChargen(chapter: ChapterConfig, app: AppState): void {
  const report = chargenReport(chapter, app.draft);
  if (!report.valid) {
    app.note = '仲未開得檔。';
    return;
  }
  const player = draftToPlayer(chapter, app.draft);
  app.player = player;
  app.screen = 'market';
  app.note = `開檔完成。本金 ${formatNum(player.cash)} ${chapter.currency.label}（設計初值），可以睇市集價錢。`;
}

function startFight(): void {
  if (!config || !state?.player) return;
  stopAutoFight();
  state.warnFight = false;
  state.preFightStock = { ...state.player.inventory };
  state.battle = createBattle(config, state.player);
  state.screen = 'combat';
  state.note = '';
  draw();
}

function stopAutoFight(): void {
  if (autoTimer !== null) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  if (state) state.autoFight = false;
}

function scheduleAutoAttack(): void {
  if (autoTimer !== null) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    if (!state?.autoFight || state.screen !== 'combat' || state.battle?.phase !== 'player') {
      stopAutoFight();
      return;
    }
    resolveBattleMove('attack');
  }, AUTO_ATTACK_MS);
}

function resolveBattleMove(move: 'attack' | 'guard' | 'skill' | 'salt'): void {
  if (!config || !state) return;
  const app = state;
  const player = app.player;
  const battle = app.battle;
  if (!player || !battle) return;
  playerAction(battle, config, player, move, Math.random);
  if (battle.phase === 'win') {
    player.flags.beatXiangzhu = true;
    app.screen = 'win';
    app.autoFight = false;
  } else if (battle.phase === 'lose') {
    app.screen = 'gameover';
    app.autoFight = false;
  }
  draw();
  if (app.autoFight && app.screen === 'combat' && battle.phase === 'player') scheduleAutoAttack();
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
  if (composing) return;
  const liveField =
    action === 'field-name' ||
    action === 'field-catchphrase' ||
    action === 'field-skill-name' ||
    action === 'field-skill-flavor' ||
    action === 'field-trigger' ||
    action === 'field-stat';
  if (liveField && state.screen === 'chargen') {
    syncChargenChrome();
    return;
  }
  draw();
}

function syncChargenChrome(): void {
  if (!config || !state || state.screen !== 'chargen') return;
  const report = chargenReport(config, state.draft);
  const issues = document.getElementById('issues');
  if (issues) {
    issues.className = report.valid ? 'report ok' : 'report';
    issues.innerHTML = renderIssues(report);
  }
  const confirmButton = document.getElementById('confirm');
  if (confirmButton instanceof HTMLButtonElement) confirmButton.disabled = !report.valid;

  const budget = report.pointsBudget;
  const spent = report.pointsSpent;
  const remaining = Number.isFinite(spent) ? budget - spent : Number.NaN;
  const ratio = !Number.isFinite(spent) || budget <= 0 ? 0 : Math.max(0, Math.min(1, spent / budget));
  const pool = document.getElementById('pool-text');
  if (pool) {
    pool.className = report.overBudget ? 'pool-text bad-text' : 'pool-text';
    pool.textContent = `已用 ${formatNum(spent)} · 預算 ${formatNum(budget)} · 剩餘 ${formatNum(remaining)}`;
  }
  const meter = document.getElementById('pool-meter');
  if (meter instanceof HTMLElement) {
    meter.className = report.overBudget ? 'meter over' : 'meter';
    meter.style.setProperty('--fill', ratio.toFixed(4));
  }
  const power = document.getElementById('power-text');
  if (power) {
    power.className = report.overPower ? 'power bad-text' : 'power';
    power.textContent = `威力 ${formatNum(report.powerScore)} / ${formatNum(report.powerMax)}`;
  }

  const forbid = new Set(activeForbidStats(config, state.draft.stats));
  for (const key of Object.keys(config.chargen.statPool.baseline)) {
    const row = document.getElementById(`stat-row-${key}`);
    if (row) {
      const error = statError(config, state.draft.stats, key);
      row.className = ['stat', error ? 'bad' : '', forbid.has(key) ? 'forbid' : ''].filter(Boolean).join(' ');
    }
    const value = state.draft.stats[key] ?? Number.NaN;
    const delta = document.getElementById(`stat-delta-${key}`);
    if (delta) {
      const points = Number.isFinite(value) ? statPointDelta(config, key, value) : Number.NaN;
      delta.textContent = `${formatSigned(points)} 點`;
    }
    const bounds = statAtBound(config, key, value);
    const dec = document.getElementById(`stat-dec-${key}`);
    const inc = document.getElementById(`stat-inc-${key}`);
    if (dec instanceof HTMLButtonElement) dec.disabled = bounds.atMin;
    if (inc instanceof HTMLButtonElement) inc.disabled = bounds.atMax;
  }
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

function captureFocus(): FocusSnapshot | null {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || !element.id || !root.contains(element)) return null;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    let start: number | null = null;
    let end: number | null = null;
    try {
      start = element.selectionStart;
      end = element.selectionEnd;
    } catch {
      /* number inputs throw on selection */
    }
    return { id: element.id, start, end };
  }
  return { id: element.id, start: null, end: null };
}

function restoreFocus(saved: FocusSnapshot): void {
  const apply = (): void => {
    const element = document.getElementById(saved.id);
    if (!(element instanceof HTMLElement) || !root.contains(element)) return;
    if (element instanceof HTMLButtonElement && element.disabled) {
      const stat = element.dataset.stat;
      const index = element.dataset.index;
      const fallback = stat
        ? document.getElementById(`stat-${stat}`)
        : index
          ? document.getElementById(`effect-op-${index}`)
          : null;
      if (fallback instanceof HTMLElement) fallback.focus({ preventScroll: true });
      return;
    }
    element.focus({ preventScroll: true });
    if (
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
      element.type !== 'number' &&
      saved.start !== null &&
      saved.end !== null
    ) {
      try {
        element.setSelectionRange(saved.start, saved.end);
      } catch {
        /* number / detached */
      }
    }
  };
  apply();
  requestAnimationFrame(() => {
    const active = document.activeElement;
    const dumped = !(active instanceof HTMLElement) || active === document.body || active.tagName === 'H2';
    if (dumped) apply();
  });
}
