import { DESIGN_INITIAL_CASH } from './design.ts';
import { formatNum, nearlyEqual, roundCash } from './format.ts';
import { opLabel, statLabel } from './labels.ts';
import type {
  ChapterConfig,
  ChargenDraft,
  ChargenReport,
  EffectSelection,
  GoodDef,
  OpDef,
  PlayerState,
  TradeResult,
} from './types.ts';

/**
 * Power scoring comes from the M1 spec. chapter1.json stores the cap and the
 * legal ranges, not the formula.
 *
 * atk/def: the number itself (enemy def uses the absolute value, so a debuff
 * cannot buy budget by going negative)
 * hit/dodge: every 5 scores 1
 * heal: every 2 scores 1
 * dmg_mul: 1.2 scores 2 and 1.5 scores 3, linear in between
 * reflect: the number itself
 * info_reveal: 0
 */
const HP_STAT = 'hp';

export function blankDraft(config: ChapterConfig): ChargenDraft {
  return {
    name: '',
    catchphrase: '',
    skillName: '',
    skillFlavor: '',
    skillTrigger: '',
    effects: [{ op: '', value: Number.NaN }],
    stats: { ...config.chargen.statPool.baseline },
  };
}

export function goodUnitPrice(good: GoodDef): number {
  return good.basePrice * good.index;
}

export function findGood(config: ChapterConfig, id: string): GoodDef | undefined {
  return Object.values(config.goods).find((good) => good.id === id);
}

export function firstEnemyName(config: ChapterConfig): string | null {
  for (const enemy of Object.values(config.enemies)) {
    if (typeof enemy?.name === 'string' && enemy.name.trim()) return enemy.name;
  }
  return null;
}

export function canAfford(cash: number, price: number): boolean {
  return cash + 1e-9 >= price;
}

export function statPointDelta(config: ChapterConfig, key: string, value: number): number {
  const base = config.chargen.statPool.baseline[key] ?? 0;
  if (key === HP_STAT) return (value - base) / config.chargen.statPool.hpPerPoint;
  return value - base;
}

export function pointsSpent(config: ChapterConfig, stats: Record<string, number>): number {
  let spent = 0;
  for (const key of Object.keys(config.chargen.statPool.baseline)) {
    const value = stats[key];
    if (!Number.isFinite(value)) return Number.NaN;
    spent += statPointDelta(config, key, value ?? 0);
  }
  return spent;
}

export function legalStatValues(config: ChapterConfig, key: string): number[] {
  const clamp = config.chargen.statPool.clamps[key];
  const base = config.chargen.statPool.baseline[key];
  if (!clamp || !Number.isFinite(base)) return [];
  const [min, max] = clamp;
  const step = key === HP_STAT ? config.chargen.statPool.hpPerPoint : 1;
  if (!(step > 0)) return [];
  const decimals = decimalPlaces(step);
  const values: number[] = [];
  for (const dir of [-1, 1] as const) {
    for (let i = dir === 1 ? 0 : 1; i < 1000; i += 1) {
      const value = Number((base + dir * i * step).toFixed(decimals));
      if (value < min - 1e-9 || value > max + 1e-9) break;
      values.push(value);
    }
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

export function stepStat(
  config: ChapterConfig,
  stats: Record<string, number>,
  key: string,
  dir: 1 | -1,
): void {
  const values = legalStatValues(config, key);
  const first = values[0];
  if (first === undefined) return;
  const current = stats[key];
  if (!Number.isFinite(current)) {
    const base = config.chargen.statPool.baseline[key];
    stats[key] = values.find((value) => nearlyEqual(value, base ?? Number.NaN)) ?? first;
    return;
  }
  const index = values.findIndex((value) => nearlyEqual(value, current ?? Number.NaN));
  if (index === -1) {
    if (dir > 0) {
      const higher = values.find((value) => value > (current ?? 0));
      if (higher !== undefined) stats[key] = higher;
    } else {
      const lower = [...values].reverse().find((value) => value < (current ?? 0));
      if (lower !== undefined) stats[key] = lower;
    }
    return;
  }
  const next = values[index + dir];
  if (next === undefined) return;
  stats[key] = next;
}

export function statAtBound(
  config: ChapterConfig,
  key: string,
  current: number,
): { atMin: boolean; atMax: boolean } {
  const values = legalStatValues(config, key);
  const first = values[0];
  const last = values[values.length - 1];
  if (first === undefined || last === undefined || !Number.isFinite(current)) {
    return { atMin: false, atMax: false };
  }
  return {
    atMin: current <= first + 1e-9,
    atMax: current >= last - 1e-9,
  };
}

export function discreteValues(def: OpDef): number[] {
  const step = def.step ?? 1;
  if (!(step > 0) || !Number.isFinite(def.min) || !Number.isFinite(def.max) || def.max < def.min) {
    return [def.min];
  }
  const decimals = decimalPlaces(step);
  const count = Math.round((def.max - def.min) / step);
  const values: number[] = [];
  for (let i = 0; i <= count; i += 1) {
    values.push(Number((def.min + i * step).toFixed(decimals)));
  }
  return values.length > 0 ? values : [def.min];
}

export function stepEffectValue(config: ChapterConfig, effect: EffectSelection, dir: 1 | -1): void {
  const def = config.chargen.skill.ops[effect.op];
  if (!def) return;
  const values = discreteValues(def);
  const first = values[0];
  if (first === undefined) return;
  const index = values.findIndex((value) => nearlyEqual(value, effect.value));
  if (index === -1) {
    effect.value = first;
    return;
  }
  const next = values[index + dir];
  if (next === undefined) return;
  effect.value = next;
}

export function effectPowerScore(op: string, value: number): number | null {
  switch (op) {
    case 'self_atk_add':
    case 'self_def_add':
      return value;
    case 'enemy_def_add':
      return Math.abs(value);
    case 'self_hit_add':
    case 'self_dodge_add':
      return value / 5;
    case 'self_heal':
      return value / 2;
    case 'dmg_mul_next': {
      const t = (value - 1.2) / (1.5 - 1.2);
      return 2 + t;
    }
    case 'reflect_flat':
      return value;
    case 'info_reveal':
      return 0;
    default:
      return null;
  }
}

export function skillPowerScore(effects: EffectSelection[]): number {
  let sum = 0;
  for (const effect of effects) {
    if (!effect.op || !Number.isFinite(effect.value)) continue;
    const score = effectPowerScore(effect.op, effect.value);
    if (score === null) continue;
    sum += score;
  }
  return sum;
}

export function statError(
  config: ChapterConfig,
  stats: Record<string, number>,
  key: string,
): string | null {
  const label = statLabel(key);
  const value = stats[key];
  if (!Number.isFinite(value)) return `請為${label}填數字`;
  const base = config.chargen.statPool.baseline[key];
  if (!Number.isFinite(base)) return `${label}缺基線`;
  const clamp = config.chargen.statPool.clamps[key];
  if (!clamp) return `${label}缺上下限設定`;
  const [min, max] = clamp;
  if ((value ?? 0) < min || (value ?? 0) > max) {
    return `${label}要喺 ${formatNum(min)}–${formatNum(max)} 之間`;
  }
  if (key === HP_STAT) {
    const delta = ((value ?? 0) - (base ?? 0)) / config.chargen.statPool.hpPerPoint;
    if (Math.abs(delta - Math.round(delta)) > 1e-6) {
      return `氣血要按每點 ${formatNum(config.chargen.statPool.hpPerPoint)} 點調整`;
    }
  } else if (Math.abs((value ?? 0) - Math.round(value ?? 0)) > 1e-6) {
    return `${label}要係整數`;
  }
  return null;
}

export function activeForbidStats(config: ChapterConfig, stats: Record<string, number>): string[] {
  const keys: string[] = [];
  for (const rule of config.chargen.statPool.forbid) {
    if (!whenMatches(rule.when, stats)) continue;
    for (const raw of Object.keys(rule.when)) {
      const stat = raw.split('_')[0];
      if (stat && !keys.includes(stat)) keys.push(stat);
    }
  }
  return keys;
}

export function chargenReport(config: ChapterConfig, draft: ChargenDraft): ChargenReport {
  const issues: string[] = [];
  const required = new Set(config.chargen.required);
  const budget = config.chargen.statPool.budgetPoints;
  const powerMax = config.chargen.skill.maxPowerScore;

  if (required.has('name') && !draft.name.trim()) issues.push('請填寫名字');
  if (required.has('catchphrase') && !draft.catchphrase.trim()) issues.push('請填寫口頭禪');

  for (const key of Object.keys(config.chargen.statPool.baseline)) {
    const message = statError(config, draft.stats, key);
    if (message) issues.push(message);
  }

  const spent = pointsSpent(config, draft.stats);
  const overBudget = Number.isFinite(spent) && spent > budget + 1e-6;
  if (overBudget) issues.push(`點數超支：已用 ${formatNum(spent)}，預算 ${formatNum(budget)}`);

  for (const rule of config.chargen.statPool.forbid) {
    if (whenMatches(rule.when, draft.stats)) issues.push(`此配點被禁止：${rule.reason}`);
  }

  if (required.has('skillName') && !draft.skillName.trim()) issues.push('請填寫招式名稱');
  if (required.has('skillFlavor') && !draft.skillFlavor.trim()) issues.push('請填寫招式說明');
  if (required.has('skillTrigger') && !draft.skillTrigger) issues.push('請選擇觸發時機');
  if (draft.skillTrigger && !config.chargen.skill.triggers.includes(draft.skillTrigger)) {
    issues.push('觸發時機唔喺設定表');
  }

  if (config.chargen.skill.mode !== 'assembler') issues.push('呢個里程只支援組裝式招式');

  const maxEffects = config.chargen.skill.maxEffects;
  if (draft.effects.length < 1) issues.push('請至少裝一項效果');
  if (draft.effects.length > maxEffects) issues.push(`效果最多 ${formatNum(maxEffects)} 項`);

  const seen = new Set<string>();
  let complete = draft.effects.length > 0;
  draft.effects.forEach((effect, index) => {
    const nth = index + 1;
    if (!effect.op) {
      complete = false;
      issues.push(`請為效果 ${nth} 選擇種類`);
      return;
    }
    const def = config.chargen.skill.ops[effect.op];
    if (!def) {
      complete = false;
      issues.push(`效果 ${nth} 唔喺設定表`);
      return;
    }
    if (seen.has(effect.op)) issues.push(`「${opLabel(effect.op)}」揀咗多過一次`);
    seen.add(effect.op);
    const allowed = discreteValues(def).some((value) => nearlyEqual(value, effect.value));
    if (!allowed) {
      complete = false;
      issues.push(`效果 ${nth} 數值超出允許範圍`);
    }
    if (effectPowerScore(effect.op, effect.value) === null) {
      complete = false;
      issues.push(`「${opLabel(effect.op)}」未有計分規則`);
    }
  });

  const powerScore = skillPowerScore(draft.effects);
  const overPower = complete && powerScore > powerMax + 1e-6;
  if (overPower) {
    issues.push(`威力分數 ${formatNum(powerScore)} 超過上限 ${formatNum(powerMax)}`);
  }

  return {
    issues,
    valid: issues.length === 0,
    pointsSpent: spent,
    pointsBudget: budget,
    powerScore,
    powerMax,
    overBudget,
    overPower,
  };
}

const RANDOM_NAMES = ['阿米', '秤仔', '巷口', '陳末', '老秤', '米斗', '黑斗', '阿灰'];
const RANDOM_PHRASES = ['米價先問過', '糧盡先收秤', '先問價後動手', '黑市不賒帳', '刀鈍米還在'];
const RANDOM_SKILL_NAMES = ['陳米罩眼', '破秤一擊', '米霧罩面', '秤砣砸腕', '收米補刀'];
const RANDOM_SKILL_FLAVORS = [
  '袋底一撮陳米，揚出去就盲一陣。',
  '秤砣脫手，專砸對家腕骨。',
  '米塵一罩，睜不開眼。',
  '收秤之前，補多一刀。',
];

/** 填一份過得 chargenReport 嘅草稿：文字隨機、觸發跟表、招式威力唔超、六圍守 clamps／預算／forbid。 */
export function randomDraft(config: ChapterConfig, rng: () => number = Math.random): ChargenDraft {
  const trigger = pickOne(config.chargen.skill.triggers, rng);
  const draft: ChargenDraft = {
    name: pickOne(RANDOM_NAMES, rng),
    catchphrase: pickOne(RANDOM_PHRASES, rng),
    skillName: pickOne(RANDOM_SKILL_NAMES, rng),
    skillFlavor: pickOne(RANDOM_SKILL_FLAVORS, rng),
    skillTrigger: trigger,
    effects: randomEffects(config, rng),
    stats: randomStats(config, rng),
  };
  if (chargenReport(config, draft).valid) return draft;
  return fallbackDraft(config);
}

export function draftToPlayer(config: ChapterConfig, draft: ChargenDraft): PlayerState {
  const effects = draft.effects.map((effect) => ({ op: effect.op, value: effect.value }));
  const inventory: Record<string, number> = {};
  for (const good of Object.values(config.goods)) inventory[good.id] = 0;
  return {
    name: draft.name.trim(),
    catchphrase: draft.catchphrase.trim(),
    stats: { ...draft.stats },
    skill: {
      name: draft.skillName.trim(),
      flavor: draft.skillFlavor.trim(),
      trigger: draft.skillTrigger,
      effects,
      powerScore: skillPowerScore(effects),
    },
    cash: DESIGN_INITIAL_CASH,
    shopLv: config.chapter.startShopLv,
    slots: config.chapter.startSlots,
    inventory,
    equipment: { weapon: null, armor: null },
    flags: { beatXiangzhu: false, postFightMarketDone: false, stanceId: null },
    board: null,
    stubs: [],
    settle: null,
  };
}

export function buyOne(config: ChapterConfig, player: PlayerState, goodId: string): TradeResult {
  const good = findGood(config, goodId);
  const unit = config.currency.label;
  if (!good) return { ok: false, message: '貨單上冇呢件。' };
  const price = goodUnitPrice(good);
  if (!canAfford(player.cash, price)) return { ok: false, message: `錢唔夠，買唔到${good.name}。` };
  const qty = player.inventory[good.id] ?? 0;
  if (good.stackable === false && qty >= 1) return { ok: false, message: `${good.name}唔疊加，身上已經有。` };
  player.cash = roundCash(player.cash - price);
  player.inventory[good.id] = (Number.isFinite(qty) ? qty : 0) + 1;
  return { ok: true, message: `進貨：${good.name}，−${formatNum(price)} ${unit}。` };
}

export function sellOne(config: ChapterConfig, player: PlayerState, goodId: string): TradeResult {
  const good = findGood(config, goodId);
  const unit = config.currency.label;
  if (!good) return { ok: false, message: '貨單上冇呢件。' };
  const qty = player.inventory[good.id] ?? 0;
  if (!Number.isFinite(qty) || qty < 1) return { ok: false, message: `冇${good.name}可拋。` };
  const price = goodUnitPrice(good);
  player.inventory[good.id] = qty - 1;
  if ((player.inventory[good.id] ?? 0) <= 0) {
    if (player.equipment.weapon === good.id) player.equipment.weapon = null;
    if (player.equipment.armor === good.id) player.equipment.armor = null;
  }
  player.cash = roundCash(player.cash + price);
  return { ok: true, message: `拋售：${good.name}，+${formatNum(price)} ${unit}。` };
}

export function equipSlot(good: GoodDef): 'weapon' | 'armor' | null {
  if (good.use?.type !== 'equip') return null;
  if (good.slot === 'weapon' || good.slot === 'armor') return good.slot;
  return null;
}

export function toggleEquip(config: ChapterConfig, player: PlayerState, goodId: string): TradeResult {
  const good = findGood(config, goodId);
  if (!good) return { ok: false, message: '貨單上冇呢件。' };
  const slot = equipSlot(good);
  if (!slot) return { ok: false, message: `${good.name}唔可以裝備。` };
  if (player.equipment[slot] === good.id) {
    player.equipment[slot] = null;
    return { ok: true, message: `卸下${good.name}。` };
  }
  if ((player.inventory[good.id] ?? 0) < 1) return { ok: false, message: `冇${good.name}可裝備。` };
  player.equipment[slot] = good.id;
  return { ok: true, message: `裝備${good.name}。` };
}

export function bringingWeapon(config: ChapterConfig, player: PlayerState): boolean {
  return player.equipment.weapon === config.combat.warnIfNoWeapon.itemId;
}

function randomStats(config: ChapterConfig, rng: () => number): Record<string, number> {
  const stats = { ...config.chargen.statPool.baseline };
  const keys = Object.keys(stats);
  const steps = 12 + Math.floor(rng() * 12);
  for (let i = 0; i < steps; i += 1) {
    const key = pickOne(keys, rng);
    const dir: 1 | -1 = rng() < 0.7 ? 1 : -1;
    const trial = { ...stats };
    stepStat(config, trial, key, dir);
    if (trial[key] === stats[key] || !legalStatSpread(config, trial)) continue;
    stats[key] = trial[key] ?? stats[key] ?? 0;
  }
  for (let i = 0; i < keys.length * 2 && pointsSpent(config, stats) < 1; i += 1) {
    const key = pickOne(keys, rng);
    const trial = { ...stats };
    stepStat(config, trial, key, 1);
    if (trial[key] === stats[key] || !legalStatSpread(config, trial)) continue;
    stats[key] = trial[key] ?? stats[key] ?? 0;
  }
  return stats;
}

function legalStatSpread(config: ChapterConfig, stats: Record<string, number>): boolean {
  for (const key of Object.keys(config.chargen.statPool.baseline)) {
    if (statError(config, stats, key)) return false;
  }
  const spent = pointsSpent(config, stats);
  const budget = config.chargen.statPool.budgetPoints;
  if (!Number.isFinite(spent) || spent > budget + 1e-6) return false;
  return activeForbidStats(config, stats).length === 0;
}

function randomEffects(config: ChapterConfig, rng: () => number): EffectSelection[] {
  const maxEffects = Math.max(1, config.chargen.skill.maxEffects);
  const maxPower = config.chargen.skill.maxPowerScore;
  const ops = Object.keys(config.chargen.skill.ops);
  const count = 1 + Math.floor(rng() * maxEffects);
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const chosen = shuffle(ops, rng).slice(0, count);
    const effects: EffectSelection[] = [];
    let power = 0;
    let ok = chosen.length === count;
    for (const op of chosen) {
      const def = config.chargen.skill.ops[op];
      if (!def) {
        ok = false;
        break;
      }
      const options = discreteValues(def).flatMap((value) => {
        const score = effectPowerScore(op, value);
        if (score === null || !Number.isFinite(score) || score < -1e-9) return [];
        if (power + score > maxPower + 1e-6) return [];
        return [{ value, score }];
      });
      const pick = options.length > 0 ? options[Math.floor(rng() * options.length)] : undefined;
      if (!pick) {
        ok = false;
        break;
      }
      effects.push({ op, value: pick.value });
      power += pick.score;
    }
    if (ok && effects.length >= 1 && effects.length <= maxEffects && power <= maxPower + 1e-6) return effects;
  }
  return fallbackEffects(config);
}

function fallbackEffects(config: ChapterConfig): EffectSelection[] {
  let safest: EffectSelection | null = null;
  let safestScore = Number.POSITIVE_INFINITY;
  for (const [op, def] of Object.entries(config.chargen.skill.ops)) {
    for (const value of discreteValues(def)) {
      const score = effectPowerScore(op, value);
      if (score === null || !Number.isFinite(score) || score < -1e-9) continue;
      if (score > config.chargen.skill.maxPowerScore + 1e-6) continue;
      if (score < safestScore) {
        safestScore = score;
        safest = { op, value };
      }
    }
  }
  return safest ? [safest] : [{ op: '', value: Number.NaN }];
}

function fallbackDraft(config: ChapterConfig): ChargenDraft {
  return {
    name: '阿米',
    catchphrase: '米價先問過',
    skillName: '陳米罩眼',
    skillFlavor: '袋底一撮陳米，揚出去就盲一陣。',
    skillTrigger: config.chargen.skill.triggers[0] ?? '',
    effects: fallbackEffects(config),
    stats: { ...config.chargen.statPool.baseline },
  };
}

function pickOne<T>(items: readonly T[], rng: () => number): T {
  if (items.length === 0) throw new Error('冇得抽');
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  const item = items[index];
  if (item === undefined) throw new Error('冇得抽');
  return item;
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

function whenMatches(when: Record<string, number>, stats: Record<string, number>): boolean {
  const entries = Object.entries(when);
  if (entries.length === 0) return false;
  return entries.every(([raw, threshold]) => {
    if (typeof threshold !== 'number') return false;
    const match = /^([A-Za-z0-9]+)_(gte|lte|gt|lt|eq)$/.exec(raw);
    const stat = match?.[1];
    const op = match?.[2];
    if (!stat || !op) return false;
    const value = stats[stat];
    if (!Number.isFinite(value)) return false;
    switch (op) {
      case 'gte':
        return value >= threshold;
      case 'lte':
        return value <= threshold;
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'eq':
        return value === threshold;
      default:
        return false;
    }
  });
}

function decimalPlaces(step: number): number {
  const text = step.toString().toLowerCase();
  if (text.includes('e-')) {
    const exp = Number(text.slice(text.indexOf('e-') + 2));
    return Number.isFinite(exp) ? exp : 6;
  }
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}
