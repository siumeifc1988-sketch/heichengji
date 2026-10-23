import { bannerHasChange, diffLines, sellProgress, shopTax, stanceLines, xiangzhuClosed } from './blackmarket.ts';
import { DESIGN_BASE_VOLUME, SAVE_NODE } from './design.ts';
import { formatNum, formatSigned } from './format.ts';
import { SCREEN_LABEL, opLabel, statLabel, triggerLabel } from './labels.ts';
import { saltAction } from './combat.ts';
import {
  activeForbidStats,
  canAfford,
  chargenReport,
  discreteValues,
  effectPowerScore,
  equipSlot,
  firstEnemyName,
  goodUnitPrice,
  statAtBound,
  statError,
  statPointDelta,
} from './rules.ts';
import type { AppState, ChapterConfig, ChargenReport, EffectSelection, PlayerState } from './types.ts';

const SCORE_HINT =
  '攻同防按數值計（敵方降防取絕對值）。命中、閃避每 5 計 1。回血每 2 計 1。傷害倍率 1.2 計 2、1.5 計 3，中間直線內插。反傷按數值。揭示情報計 0。';

export function renderFatal(message: string): string {
  return `<div class="wrap"><main class="sheet">
    <h1>黑秤記</h1>
    <p class="report">${esc(message)}</p>
    <p>請確認 <code>public/config/chapter1.json</code> 可以讀取。</p>
  </main></div>`;
}

export function renderApp(config: ChapterConfig, state: AppState): string {
  const screen = state.screen;
  return `<div class="wrap"><div class="sheet" data-screen="${screen}">
    <header>
      <p class="eyebrow">第一章 · 灰模 M3</p>
      <div class="title-row">
        <h1>黑秤記</h1>
        <p class="chapter">${esc(config.chapter.title)}</p>
        <div class="seal" aria-hidden="true">黑<br>秤</div>
      </div>
      <ol class="flow">
        ${(['prologue', 'chargen', 'market', 'combat', 'blackmarket', 'stance'] as const)
          .map((id) => {
            const here = screen === 'win' || screen === 'gameover'
              ? 'combat'
              : screen === 'done'
                ? 'stance'
                : screen;
            const current = id === here;
            return `<li class="${current ? 'current' : ''}"${current ? ' aria-current="step"' : ''}>${SCREEN_LABEL[id]}</li>`;
          })
          .join('')}
      </ol>
    </header>
    <main>
      ${screen === 'prologue' ? renderPrologue(config, state) : ''}
      ${screen === 'chargen' ? renderChargen(config, state) : ''}
      ${screen === 'market' ? renderMarket(config, state) : ''}
      ${screen === 'combat' ? renderCombat(config, state) : ''}
      ${screen === 'win' ? renderWin(config, state) : ''}
      ${screen === 'blackmarket' ? renderBlackMarket(config, state) : ''}
      ${screen === 'stance' ? renderStance(config, state) : ''}
      ${screen === 'done' ? renderDone(config, state) : ''}
      ${screen === 'gameover' ? renderGameOver(config) : ''}
      <p id="note" class="note" aria-live="polite">${state.note ? esc(state.note) : ''}</p>
    </main>
    <footer>灰模 M3 · 升舖收章 · 戰敗即完局 · 香主勝後唔再戰</footer>
  </div></div>`;
}

function renderPrologue(config: ChapterConfig, state: AppState): string {
  const beats = config.prologue.beats;
  const last = beats.length === 0 || state.beat >= beats.length - 1;
  const beat = beats[state.beat] ?? '';
  const continueLabel = last ? '去開檔' : '繼續';
  return `<section>
    <h2>序幕</h2>
    ${
      beats.length === 0
        ? '<p>呢章設定冇序幕文字。</p>'
        : `<p class="beat-index">第 ${state.beat + 1} 段，共 ${beats.length} 段</p>
           <blockquote class="beat">${esc(beat)}</blockquote>`
    }
    <div class="actions">
      ${
        config.prologue.skippable
          ? '<button type="button" id="skip" data-action="prologue-skip">跳過序幕</button>'
          : ''
      }
      ${
        state.hasSave
          ? '<button type="button" id="load-save" data-action="load-save">讀取市集存檔</button>'
          : ''
      }
      <button type="button" id="continue" class="primary push" data-action="prologue-next">${continueLabel}</button>
    </div>
  </section>`;
}

function renderChargen(config: ChapterConfig, state: AppState): string {
  const report = chargenReport(config, state.draft);
  const budget = report.pointsBudget;
  const spent = report.pointsSpent;
  const remaining = Number.isFinite(spent) ? budget - spent : Number.NaN;
  const ratio = !Number.isFinite(spent) || budget <= 0 ? 0 : Math.max(0, Math.min(1, spent / budget));
  const forbidStats = new Set(activeForbidStats(config, state.draft.stats));
  const hpPerPoint = config.chargen.statPool.hpPerPoint;

  return `<section>
    <h2>開檔</h2>
    <div class="chargen">
      <section class="panel">
        <h3>你是誰</h3>
        <label for="name">名字
          <input id="name" name="name" data-action="field-name" autocomplete="off" placeholder="例如：阿鹽" value="${esc(state.draft.name)}">
        </label>
        <label for="catchphrase">口頭禪
          <input id="catchphrase" name="catchphrase" data-action="field-catchphrase" autocomplete="off" placeholder="例如：秤平先開市" value="${esc(state.draft.catchphrase)}">
        </label>
        <h3>六圍</h3>
        <p id="pool-text" class="pool-text ${report.overBudget ? 'bad-text' : ''}">已用 ${esc(formatNum(spent))} · 預算 ${esc(formatNum(budget))} · 剩餘 ${esc(formatNum(remaining))}</p>
        <div id="pool-meter" class="meter ${report.overBudget ? 'over' : ''}" style="--fill: ${ratio.toFixed(4)}"><span></span></div>
        <p class="hint">由基線重配。氣血每點 ${esc(formatNum(hpPerPoint))}。剩餘點數可以留低。</p>
        ${Object.keys(config.chargen.statPool.baseline)
          .map((key) => renderStat(config, state, key, forbidStats.has(key)))
          .join('')}
      </section>
      <section class="panel">
        <h3>自創招式</h3>
        <label for="skill-name">招式名稱
          <input id="skill-name" data-action="field-skill-name" autocomplete="off" placeholder="例如：碎鹽入眼" value="${esc(state.draft.skillName)}">
        </label>
        <label for="skill-flavor">招式說明
          <textarea id="skill-flavor" data-action="field-skill-flavor" rows="3" placeholder="例如：袋底一撮鹽，揚出去就盲一陣">${esc(state.draft.skillFlavor)}</textarea>
        </label>
        <label for="skill-trigger">觸發時機
          <select id="skill-trigger" data-action="field-trigger">
            <option value="">請選擇</option>
            ${config.chargen.skill.triggers
              .map((trigger) => {
                const selected = trigger === state.draft.skillTrigger ? ' selected' : '';
                return `<option value="${esc(trigger)}"${selected}>${esc(triggerLabel(trigger))} · ${esc(trigger)}</option>`;
              })
              .join('')}
          </select>
        </label>
        <div class="effect-head">
          <h3>效果</h3>
          <p id="power-text" class="power ${report.overPower ? 'bad-text' : ''}">威力 ${esc(formatNum(report.powerScore))} / ${esc(formatNum(report.powerMax))}</p>
        </div>
        ${state.draft.effects.map((effect, index) => renderEffect(config, effect, index, state.draft.effects.length)).join('')}
        ${
          state.draft.effects.length < config.chargen.skill.maxEffects
            ? '<button type="button" id="effect-add" data-action="effect-add">加一項效果</button>'
            : `<p class="hint">效果已到上限 ${esc(formatNum(config.chargen.skill.maxEffects))} 項。</p>`
        }
        <details>
          <summary>點計威力</summary>
          <p class="hint">${SCORE_HINT}</p>
        </details>
      </section>
      <div class="confirm-bar">
        <div id="issues" class="report ${report.valid ? 'ok' : ''}" aria-live="polite">
          ${renderIssues(report)}
        </div>
        <div class="actions">
          <button type="button" id="random-fill" data-action="random-fill">隨機填好</button>
          <button type="button" id="random-enter" data-action="random-enter">隨機開檔並進入市集</button>
          <button type="button" id="confirm" class="primary push" data-action="confirm" ${report.valid ? '' : 'disabled'} aria-describedby="issues">確認開檔</button>
        </div>
      </div>
    </div>
  </section>`;
}

function renderStat(config: ChapterConfig, state: AppState, key: string, forbidden: boolean): string {
  const value = state.draft.stats[key] ?? Number.NaN;
  const error = statError(config, state.draft.stats, key);
  const bounds = statAtBound(config, key, value);
  const clamp = config.chargen.statPool.clamps[key];
  const base = config.chargen.statPool.baseline[key];
  const delta = Number.isFinite(value) ? statPointDelta(config, key, value) : Number.NaN;
  const step = key === 'hp' ? config.chargen.statPool.hpPerPoint : 1;
  const hint = `基線 ${formatNum(base ?? Number.NaN)} · 限 ${formatNum(clamp?.[0] ?? Number.NaN)}–${formatNum(clamp?.[1] ?? Number.NaN)}`;
  const hpHint = key === 'hp' ? ` · 每點 ${formatNum(config.chargen.statPool.hpPerPoint)} 氣血` : '';
  const classes = ['stat', error ? 'bad' : '', forbidden ? 'forbid' : ''].filter(Boolean).join(' ');
  const shown = Number.isFinite(value) ? String(value) : '';
  return `<div class="${classes}" id="stat-row-${esc(key)}">
    <label for="stat-${esc(key)}">${esc(statLabel(key))}</label>
    <button type="button" class="step" id="stat-dec-${esc(key)}" data-action="stat-dec" data-stat="${esc(key)}" aria-label="減少${esc(statLabel(key))}" ${bounds.atMin ? 'disabled' : ''}>−</button>
    <input id="stat-${esc(key)}" data-action="field-stat" data-stat="${esc(key)}" inputmode="decimal" type="number" step="${esc(String(step))}" value="${esc(shown)}">
    <button type="button" class="step" id="stat-inc-${esc(key)}" data-action="stat-inc" data-stat="${esc(key)}" aria-label="增加${esc(statLabel(key))}" ${bounds.atMax ? 'disabled' : ''}>+</button>
    <span class="delta" id="stat-delta-${esc(key)}">${esc(formatSigned(delta))} 點</span>
    <small>${esc(hint + hpHint)}</small>
  </div>`;
}

function renderEffect(config: ChapterConfig, effect: EffectSelection, index: number, count: number): string {
  const ops = config.chargen.skill.ops;
  const def = effect.op ? ops[effect.op] : undefined;
  const values = def ? discreteValues(def) : [];
  const valueIndex = values.findIndex((value) => Math.abs(value - effect.value) < 1e-6);
  const score = effect.op && Number.isFinite(effect.value) ? effectPowerScore(effect.op, effect.value) : null;
  const atMin = valueIndex === 0;
  const atMax = valueIndex >= 0 && valueIndex === values.length - 1;
  return `<div class="effect">
    <div class="effect-top">
      <label for="effect-op-${index}">效果 ${index + 1}
        <select id="effect-op-${index}" data-action="field-effect-op" data-index="${index}">
          <option value="">請選擇</option>
          ${Object.keys(ops)
            .map((op) => {
              const selected = op === effect.op ? ' selected' : '';
              return `<option value="${esc(op)}"${selected}>${esc(opLabel(op))} · ${esc(op)}</option>`;
            })
            .join('')}
        </select>
      </label>
      ${count > 1 ? `<button type="button" id="effect-remove-${index}" data-action="effect-remove" data-index="${index}">移除</button>` : ''}
    </div>
    ${
      def
        ? `<div class="stepper">
            <button type="button" class="step" id="effect-dec-${index}" data-action="effect-dec" data-index="${index}" aria-label="減少效果 ${index + 1} 數值" ${atMin ? 'disabled' : ''}>−</button>
            <strong id="effect-value-${index}">${esc(formatNum(effect.value))}</strong>
            <button type="button" class="step" id="effect-inc-${index}" data-action="effect-inc" data-index="${index}" aria-label="增加效果 ${index + 1} 數值" ${atMax ? 'disabled' : ''}>+</button>
          </div>
          <p class="hint">允許 ${esc(formatNum(def.min))}–${esc(formatNum(def.max))}${def.step ? `，每步 ${esc(formatNum(def.step))}` : ''} · 呢項計分 ${esc(formatNum(score ?? Number.NaN))}</p>`
        : '<p class="hint">請先選效果種類。</p>'
    }
  </div>`;
}

function renderMarket(config: ChapterConfig, state: AppState): string {
  const player = state.player;
  if (!player) {
    return `<section><h2>市集看板</h2><p>未有角色。</p>
      <button type="button" data-action="to-prologue">返去序幕</button></section>`;
  }
  const unit = config.currency.label;
  const enemy = firstEnemyName(config);
  return `<section>
    <h2>市集看板</h2>
    <div class="stall">
      <div>
        <p class="stall-name">${esc(player.name)}</p>
        <p class="stall-phrase">「${esc(player.catchphrase)}」</p>
      </div>
      <dl class="stall-meta">
        ${renderShopFacts(config, player, unit)}
        <div><dt>存檔節點</dt><dd>${esc(SAVE_NODE)}</dd></div>
      </dl>
    </div>
    ${renderStatReadout(config, player)}
    ${renderSkillReadout(config, player)}
    <div id="goods" class="goods">
      ${Object.values(config.goods).map((good) => renderGood(config, player, good.id)).join('')}
    </div>
    <p class="hint">而家按牌價交易，一件起。稅率跟鋪等顯示，稅點點計唔喺章節設定，未實扣。</p>
    <section class="combat-stub" aria-labelledby="combat-title">
      <h3 id="combat-title">街頭</h3>
      ${player.flags.beatXiangzhu ? '<p class="badge">已教訓香主</p>' : ''}
      ${renderFightButton(config, player)}
      <p id="m2-note">${enemy ? `對手係${esc(enemy)}。` : ''}${config.combat.onDefeat === 'game_over' ? '戰敗即完局。' : `戰敗處理：${esc(config.combat.onDefeat)}。`}勝咗會被推去黑市，賣咗貨先見管事。</p>
    </section>
    ${state.warnFight ? renderWarn(config) : ''}
    <div class="actions">
      <button type="button" id="save" data-action="save">存檔</button>
      <button type="button" id="restart" data-action="restart">重新開檔</button>
    </div>
  </section>`;
}

function renderStatReadout(config: ChapterConfig, player: PlayerState): string {
  const rows = Object.keys(config.chargen.statPool.baseline)
    .map((key) => {
      const value = player.stats[key];
      return `<div><dt>${esc(statLabel(key))}</dt><dd>${esc(formatNum(value ?? Number.NaN))}</dd></div>`;
    })
    .join('');
  return `<dl class="stats-read">${rows}</dl>`;
}

function renderSkillReadout(config: ChapterConfig, player: PlayerState): string {
  const skill = player.skill;
  const lines = skill.effects
    .map((effect) => {
      const score = effectPowerScore(effect.op, effect.value);
      return `<li>${esc(opLabel(effect.op))} ${esc(formatNum(effect.value))} · 計 ${esc(formatNum(score ?? Number.NaN))}</li>`;
    })
    .join('');
  return `<article class="skill-read">
    <h3>${esc(skill.name || '未命名招式')}</h3>
    <p>${esc(skill.flavor)}</p>
    <p>觸發：${esc(triggerLabel(skill.trigger))} <code>${esc(skill.trigger)}</code></p>
    <ul>${lines}</ul>
    <p>威力 ${esc(formatNum(skill.powerScore))} / ${esc(formatNum(config.chargen.skill.maxPowerScore))}</p>
  </article>`;
}

function renderGood(config: ChapterConfig, player: PlayerState, goodId: string): string {
  const good = Object.values(config.goods).find((item) => item.id === goodId);
  if (!good) return '';
  const price = goodUnitPrice(good);
  const qty = player.inventory[good.id] ?? 0;
  const afford = canAfford(player.cash, price);
  const unit = config.currency.label;
  const slot = equipSlot(good);
  const equipped = slot !== null && player.equipment[slot] === good.id;
  const canStack = good.stackable !== false || qty < 1;
  return `<article class="good" data-good-id="${esc(good.id)}">
    <h3>${esc(good.name)}</h3>
    <p class="good-id"><code>${esc(good.id)}</code></p>
    <p class="price">${esc(formatNum(price))} <span>${esc(unit)}</span></p>
    <p class="formula">底價 ${esc(formatNum(good.basePrice))} × 指數 ${esc(formatNum(good.index))}</p>
    <p class="qty">存貨 ${esc(formatNum(qty))}${equipped ? ' · 裝備中' : ''}</p>
    ${good.use?.uiHint ? `<p class="hint">${esc(good.use.uiHint)}</p>` : ''}
    <div class="actions tight">
      <button type="button" data-action="buy" data-good="${esc(good.id)}" ${afford && canStack ? '' : 'disabled'}>進貨</button>
      <button type="button" data-action="sell" data-good="${esc(good.id)}" ${qty >= 1 ? '' : 'disabled'}>拋售</button>
      ${
        slot
          ? `<button type="button" data-action="equip" data-good="${esc(good.id)}" ${qty >= 1 || equipped ? '' : 'disabled'}>${equipped ? '卸下' : '裝備'}</button>`
          : ''
      }
    </div>
    ${!canStack && qty >= 1 ? '<p class="hint">唔疊加。</p>' : ''}
    ${afford || qty >= 1 ? '' : '<p class="warn">現金未夠一件</p>'}
  </article>`;
}

function renderWarn(config: ChapterConfig): string {
  const warn = config.combat.warnIfNoWeapon;
  return `<div class="modal-back">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="warn-title">
      <h3 id="warn-title">${esc(warn.title)}</h3>
      <p>${esc(warn.body)}</p>
      <div class="actions">
        <button type="button" id="warn-cancel" data-action="warn-cancel">${esc(warn.cancelLabel)}</button>
        <button type="button" id="warn-confirm" class="primary" data-action="warn-confirm">${esc(warn.confirmLabel)}</button>
      </div>
    </div>
  </div>`;
}

function renderCombat(config: ChapterConfig, state: AppState): string {
  const battle = state.battle;
  const player = state.player;
  if (!battle || !player) {
    return `<section><h2>對決</h2><p>未有戰局。</p>
      <button type="button" data-action="to-market">返市集</button></section>`;
  }
  const salt = saltAction(config);
  const saltQty = salt ? (player.inventory[salt.good.id] ?? 0) : 0;
  const saltLeft = salt ? battle.saltUses < salt.maxPerBattle && saltQty >= salt.consumeQty : false;
  return `<section>
    <h2>對決</h2>
    <div class="duel">
      ${renderFighter(battle.player, '我方', battle.player.guarding ? '守勢' : '')}
      ${renderFighter(battle.enemy, '對方', battle.reap ? '收割' : '')}
    </div>
    <div id="battle-log" class="log" aria-live="polite">
      ${battle.log.map((line) => `<p>${esc(line)}</p>`).join('')}
    </div>
    <div class="actions">
      <button type="button" id="act-attack" data-action="battle-attack">攻擊</button>
      <button type="button" id="act-guard" data-action="battle-guard">守勢</button>
      <button type="button" id="act-skill" data-action="battle-skill">招式</button>
      ${
        salt && (saltQty >= salt.consumeQty || battle.saltUses > 0)
          ? `<button type="button" id="act-salt" data-action="battle-salt" ${saltLeft ? '' : 'disabled'}>${esc(salt.label)}</button>`
          : ''
      }
      <button type="button" id="act-auto" data-action="battle-auto" aria-pressed="${state.autoFight ? 'true' : 'false'}">${state.autoFight ? '停止' : '自動'}</button>
    </div>
    ${state.autoFight ? '<p class="hint" id="auto-hint">自動戰鬥：每回合只會攻擊。撳停止就返手動。</p>' : ''}
    ${battle.saltReady && salt ? `<p class="hint">下一擊傷害 +${esc(formatNum(salt.dmgAdd))}、命中 +${esc(formatNum(salt.hitAdd))}。</p>` : ''}
  </section>`;
}

function renderFighter(fighter: { name: string; hp: number; maxHp: number; atk: number; def: number; hit: number; spd: number; dodge: number }, side: string, status: string): string {
  const pct = fighter.maxHp > 0 ? Math.max(0, Math.min(1, fighter.hp / fighter.maxHp)) : 0;
  return `<article class="fighter">
    <h3>${esc(side)} · ${esc(fighter.name)}</h3>
    <p class="hp-text">氣血 ${esc(formatNum(fighter.hp))} / ${esc(formatNum(fighter.maxHp))}${status ? ` · ${esc(status)}` : ''}</p>
    <div class="hp" aria-hidden="true"><span style="width:${(pct * 100).toFixed(1)}%"></span></div>
    <p class="hint">攻 ${esc(formatNum(fighter.atk))} · 防 ${esc(formatNum(fighter.def))} · 命中 ${esc(formatNum(fighter.hit))} · 閃 ${esc(formatNum(fighter.dodge))} · 速 ${esc(formatNum(fighter.spd))}</p>
  </article>`;
}

function renderWin(config: ChapterConfig, state: AppState): string {
  const enemy = firstEnemyName(config) ?? '對手';
  const name = state.player?.name ?? '';
  const next = config.postFightBlackMarket.title;
  return `<section>
    <h2>戰勝</h2>
    <p class="beat">${esc(name)}收秤。${esc(enemy)}倒地。</p>
    <p>未到結局。下一屏係「${esc(next)}」，價同成交量會先改，賣咗貨先見管事。</p>
    <div class="actions">
      <button type="button" id="enter-black-market" class="primary" data-action="enter-black-market">入黑市</button>
    </div>
  </section>`;
}

function renderBlackMarket(config: ChapterConfig, state: AppState): string {
  const player = state.player;
  const post = config.postFightBlackMarket;
  if (!player?.board?.opened) {
    return `<section><h2>${esc(post.title)}</h2><p>黑市未開板。</p></section>`;
  }
  const unit = config.currency.label;
  const progress = sellProgress(config, player);
  const gang = player.board.usingFallback ? `後備 ${player.board.gang}` : player.board.gangLabel;
  const lines = diffLines(config, player);
  const banner = post.onEnter.showDiffBanner
    ? `<section id="banner" class="banner" aria-label="價差">
        <h3>價差</h3>
        <p>幫派訊號：${esc(gang)}。庫存照舊，牌價同成交量已改。</p>
        ${bannerHasChange(lines) ? '' : '<p class="warn">呢輪衝擊冇改到價或成交量。</p>'}
        <ul class="diffs">
          ${lines.map((line) => `<li>
            <strong>${esc(line.name)}</strong>
            <span class="${deltaClass(line.oldPrice, line.newPrice)}">${esc(formatNum(line.oldPrice))} → ${esc(formatNum(line.newPrice))} ${esc(unit)}</span>
            <span class="${deltaClass(line.oldVolume, line.newVolume)}">成交量 ${esc(formatNum(line.oldVolume))} → ${esc(formatNum(line.newVolume))}</span>
          </li>`).join('')}
        </ul>
      </section>`
    : '';
  const tax = config.chapter.taxByShopLv[String(player.shopLv)];
  const taxNote = config.market.taxApplies && typeof tax === 'number'
    ? `<p class="hint">鋪稅 ${esc(formatNum(tax))} 記低咗。牌價仍係底價乘指數；稅點點計唔喺章節設定。</p>`
    : '';
  return `<section>
    <h2>${esc(post.title)}</h2>
    <p>${esc(post.body)}</p>
    ${renderPromotion(config, player)}
    <dl class="stall-meta">${renderShopFacts(config, player, unit)}</dl>
    ${banner}
    ${taxNote}
    ${
      player.settle
        ? `<p class="hint">立場已定。香主唔會再打。</p>
           <div class="actions">
             <button type="button" id="to-chapter-end" data-action="finish">章末總表</button>
             <button type="button" id="save" data-action="save">存檔</button>
           </div>`
        : `<p id="must-sell" class="hint">${esc(post.mustSell.hint)} 而家 ${esc(formatNum(progress.done))} / ${esc(formatNum(progress.need))}。</p>
           <div class="actions">
             <button type="button" id="meet-steward" class="primary" data-action="meet-steward" ${progress.unlocked ? '' : 'disabled'}>去見管事</button>
             <button type="button" id="save" data-action="save">存檔</button>
           </div>`
    }
    <div id="goods" class="goods">
      ${Object.values(config.goods).map((good) => renderBoardGood(config, player, good.id)).join('')}
      ${player.stubs.map((stub) => `<article class="good" data-good-id="${esc(stub.id)}">
        <h3>${esc(stub.name)}</h3>
        <p class="qty">存貨 ${esc(formatNum(stub.qty))}</p>
        <p class="hint">${stub.sellable ? '可賣。' : '賣唔出。'}</p>
        <div class="actions tight">
          <button type="button" disabled>${stub.sellable ? '拋售' : '賣唔出'}</button>
        </div>
      </article>`).join('')}
    </div>
    ${renderClosedFight(config, player)}
  </section>`;
}

function renderShopFacts(config: ChapterConfig, player: PlayerState, unit: string): string {
  const tax = shopTax(config, player.shopLv);
  return `<div><dt>鋪</dt><dd id="shop-lv">Lv ${esc(formatNum(player.shopLv))}</dd></div>
    <div><dt>貨架</dt><dd id="shop-slots">${esc(formatNum(player.slots))} 格</dd></div>
    <div><dt>稅</dt><dd id="shop-tax">${esc(formatNum(tax * 100))}%</dd></div>
    <div><dt>現金</dt><dd id="cash">${esc(formatNum(player.cash))} ${esc(unit)}</dd></div>`;
}

function renderPromotion(config: ChapterConfig, player: PlayerState): string {
  if (!player.settle) return '';
  const promo = config.m3.promotion;
  return `<p class="badge" id="lv2-badge">流動小販 → ${esc(promo.title)}</p>
    <p class="beat">${esc(promo.body)}</p>`;
}

function renderFightButton(config: ChapterConfig, player: PlayerState): string {
  if (xiangzhuClosed(config, player)) {
    return `<button type="button" id="combat" disabled>已了結</button>`;
  }
  return `<button type="button" id="combat" data-action="fight" aria-describedby="m2-note">去教訓香主</button>`;
}

function renderClosedFight(config: ChapterConfig, player: PlayerState): string {
  if (!xiangzhuClosed(config, player)) return '';
  return `<section class="combat-stub"><h3>街頭</h3><button type="button" id="combat" disabled>已了結</button><p class="hint">香主一戰已完，唔會再開。</p></section>`;
}

function renderBoardGood(config: ChapterConfig, player: PlayerState, goodId: string): string {
  const good = Object.values(config.goods).find((item) => item.id === goodId);
  const quote = player.board?.quotes[goodId];
  if (!good || !quote) return '';
  const oldPrice = good.basePrice * good.index;
  const price = good.basePrice * quote.index;
  const qty = player.inventory[good.id] ?? 0;
  const afford = canAfford(player.cash, price);
  const unit = config.currency.label;
  const slot = equipSlot(good);
  const equipped = slot !== null && player.equipment[slot] === good.id;
  const canStack = good.stackable !== false || qty < 1;
  const lot = quote.volumeMul >= DESIGN_BASE_VOLUME;
  return `<article class="good" data-good-id="${esc(good.id)}">
    <h3>${esc(good.name)}</h3>
    <p class="price"><s class="old">${esc(formatNum(oldPrice))}</s> ${esc(formatNum(price))} <span>${esc(unit)}</span></p>
    <p class="formula">指數 ${esc(formatNum(good.index))} → ${esc(formatNum(quote.index))}</p>
    <p class="qty">存貨 ${esc(formatNum(qty))} · 成交量 ${esc(formatNum(quote.volumeMul))}${equipped ? ' · 裝備中' : ''}</p>
    ${lot ? '' : '<p class="warn">未夠一手</p>'}
    <div class="actions tight">
      <button type="button" data-action="board-buy" data-good="${esc(good.id)}" ${afford && canStack && lot ? '' : 'disabled'}>進貨</button>
      <button type="button" data-action="board-sell" data-good="${esc(good.id)}" ${qty >= 1 && lot ? '' : 'disabled'}>拋售</button>
      ${
        slot
          ? `<button type="button" data-action="equip" data-good="${esc(good.id)}" ${qty >= 1 || equipped ? '' : 'disabled'}>${equipped ? '卸下' : '裝備'}</button>`
          : ''
      }
    </div>
  </article>`;
}

function renderStance(config: ChapterConfig, state: AppState): string {
  const player = state.player;
  if (!player) return `<section><h2>見管事</h2><p>未有角色。</p></section>`;
  const unit = config.currency.label;
  const settled = player.settle;
  if (settled) {
    const choice = config.stance.choices.find((item) => item.id === settled.choiceId);
    const redeemed = settled.redeemed.map((line) => {
      const good = Object.values(config.goods).find((item) => item.id === line.goodId);
      return `<li>${esc(good?.name ?? line.goodId)} ${esc(formatNum(line.qty))} × ${esc(formatNum(line.unit))} = ${esc(formatNum(line.qty * line.unit))} ${esc(unit)}</li>`;
    }).join('');
    return `<section>
      <h2>見管事</h2>
      ${renderPromotion(config, player)}
      <dl class="stall-meta">${renderShopFacts(config, player, unit)}</dl>
      ${
        config.m3.settle.showBeforeAfterCash
          ? `<p id="cash-line" class="beat">結算前 ${esc(formatNum(settled.cashBefore))} ${esc(unit)} → 結算後 ${esc(formatNum(settled.cashAfter))} ${esc(unit)}</p>`
          : ''
      }
      <p id="settle">${choice ? `${esc(choice.label)} ×${esc(formatNum(choice.sellMul))}` : '已結算'}${config.stance.choices.map((item) => `／${esc(item.label)} ${esc(formatNum(item.sellMul))}`).join('')}</p>
      ${redeemed ? `<ul class="diffs">${redeemed}</ul>` : '<p class="hint">冇剩餘庫存要兌現。</p>'}
      <div class="actions">
        <button type="button" id="done-ack" class="primary" data-action="finish">章末總表</button>
      </div>
    </section>`;
  }
  const redeem = state.redeemStock ?? config.m3.settle.autoRedeemAppliesToStock;
  const lines = stanceLines(config, player);
  const cards = config.stance.choices.map((choice) => {
    const rows = lines.filter((line) => line.choiceId === choice.id);
    return `<article class="good" id="stance-${esc(choice.id)}">
      <h3>${esc(choice.label)}</h3>
      <p class="price">×${esc(formatNum(choice.sellMul))}</p>
      ${rows.map((line) => `<p>${esc(line.goodName)} 勝後 ${esc(formatNum(line.boardPrice))} × ${esc(formatNum(line.sellMul))} = ${esc(formatNum(line.settlePrice))} ${esc(unit)}</p>
        <p class="hint">指數再 ${esc(formatSigned(line.indexDelta))} 之後兌現單價 ${esc(formatNum(line.redeemUnit))} ${esc(unit)}。</p>`).join('')}
      ${choice.note ? `<p class="hint">${esc(choice.note)}</p>` : ''}
      <div class="actions tight">
        <button type="button" data-action="stance" data-stance="${esc(choice.id)}">揀呢條</button>
      </div>
    </article>`;
  }).join('');
  const summary = config.stance.choices.map((choice) => `${choice.label} ${formatNum(choice.sellMul)}`).join('／');
  return `<section>
    <h2>見管事</h2>
    <p>賣完貨先到呢度。兌現單價 =（勝後指數 + 立場指數）× 底價 × 拋售倍率。</p>
    <p id="settle">${esc(summary)}</p>
    <label class="hint" for="redeem-stock">
      <input type="checkbox" id="redeem-stock" data-action="field-redeem" ${redeem ? 'checked' : ''}>
      結算時按倍率兌現庫存
    </label>
    <div class="goods">${cards}</div>
  </section>`;
}

function renderDone(config: ChapterConfig, state: AppState): string {
  const player = state.player;
  if (!player) return `<section><h2>章末</h2><p>未有角色。</p></section>`;
  const unit = config.currency.label;
  const choice = config.stance.choices.find((item) => item.id === player.flags.stanceId);
  const gang = player.board?.usingFallback ? `後備 ${player.board.gang}` : (player.board?.gangLabel ?? '—');
  const rows = Object.values(config.goods).map((good) => {
    const quote = player.board?.quotes[good.id];
    const index = quote?.index ?? good.index;
    const volume = quote?.volumeMul ?? 1;
    const price = good.basePrice * index;
    return `<li data-good-id="${esc(good.id)}"><strong>${esc(good.name)}</strong> 指數 ${esc(formatNum(index))} · 牌價 ${esc(formatNum(price))} ${esc(unit)} · 成交量 ${esc(formatNum(volume))}</li>`;
  }).join('');
  const buttons = config.m3.chapterEnd.actions.map((action) => {
    if (action === 'new_run') return `<button type="button" id="new-run" data-action="new-run">新開一局</button>`;
    if (action === 'stay_on_board_lv2') return `<button type="button" id="stay-board" class="primary" data-action="stay-board">留喺黑市看板</button>`;
    return `<button type="button" disabled>${esc(action)}</button>`;
  }).join('');
  return `<section id="chapter-sheet">
    <h2>章末</h2>
    ${renderPromotion(config, player)}
    <dl class="stall-meta">${renderShopFacts(config, player, unit)}</dl>
    <ul class="diffs" id="summary">
      <li>立場：${choice ? `${esc(choice.label)} ×${esc(formatNum(choice.sellMul))}` : '未定'}</li>
      <li>現金：${esc(formatNum(player.cash))} ${esc(unit)}</li>
      <li>幫派：${esc(gang)}</li>
      <li>已教訓香主：${player.flags.beatXiangzhu ? '是' : '否'}</li>
      <li>勝後黑市做完：${player.flags.postFightMarketDone ? '是' : '否'}</li>
      ${rows}
    </ul>
    <div class="actions">${buttons}</div>
  </section>`;
}

function deltaClass(before: number, after: number): string {
  if (after > before) return 'up';
  if (after < before) return 'down';
  return '';
}

function renderGameOver(config: ChapterConfig): string {
  const over = config.combat.gameOver;
  const buttons = over.actions.map((action) => {
    if (action === 'reload_last_open_board') {
      return `<button type="button" id="gameover-reload" data-action="gameover-reload">讀返市集存檔</button>`;
    }
    if (action === 'new_run') {
      return `<button type="button" id="gameover-new" class="primary" data-action="gameover-new">重新開檔</button>`;
    }
    return `<button type="button" disabled>${esc(action)}</button>`;
  }).join('');
  return `<section>
    <h2>${esc(over.title)}</h2>
    <p class="beat">${esc(over.body)}</p>
    <p class="hint">讀檔會返到最近一次 OpenBoard 市集存檔。未存檔嘅市集變動會一併冇咗。</p>
    <div class="actions">${buttons}</div>
  </section>`;
}

export function renderIssues(report: ChargenReport): string {
  if (report.valid) return '<p>可以確認，落去市集看板。</p>';
  return `<p>未可以確認。</p><ul>${report.issues.map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul>`;
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
