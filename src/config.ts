import type { ChapterConfig } from './types.ts';

export async function loadConfig(): Promise<ChapterConfig> {
  const response = await fetch(`${import.meta.env.BASE_URL}config/chapter1.json`);
  if (!response.ok) throw new Error(`讀唔到章節設定（${response.status}）`);
  return parseConfig(await response.json());
}

export function parseConfig(data: unknown): ChapterConfig {
  if (!isRecord(data)) fail('章節設定唔係物件');
  const chapter = requireRecord(data.chapter, 'chapter');
  requireString(chapter.id, 'chapter.id');
  requireString(chapter.title, 'chapter.title');
  requireNumber(chapter.startShopLv, 'chapter.startShopLv');
  requireNumber(chapter.endShopLv, 'chapter.endShopLv');
  requireNumber(chapter.startSlots, 'chapter.startSlots');
  requireNumber(chapter.endSlots, 'chapter.endSlots');

  const currency = requireRecord(data.currency, 'currency');
  requireString(currency.label, 'currency.label');

  const prologue = requireRecord(data.prologue, 'prologue');
  if (typeof prologue.skippable !== 'boolean') fail('prologue.skippable 要係布林');
  if (!Array.isArray(prologue.beats) || prologue.beats.some((beat) => typeof beat !== 'string')) {
    fail('prologue.beats 要係字串陣列');
  }

  const chargen = requireRecord(data.chargen, 'chargen');
  if (!Array.isArray(chargen.required) || chargen.required.some((item) => typeof item !== 'string')) {
    fail('chargen.required 要係字串陣列');
  }
  const statPool = requireRecord(chargen.statPool, 'chargen.statPool');
  const baseline = requireRecord(statPool.baseline, 'statPool.baseline');
  if (Object.keys(baseline).length === 0) fail('statPool.baseline 係空');
  for (const [key, value] of Object.entries(baseline)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`baseline.${key} 要係數字`);
  }
  requireNumber(statPool.budgetPoints, 'budgetPoints');
  requireNumber(statPool.hpPerPoint, 'hpPerPoint');
  if ((statPool.hpPerPoint as number) <= 0) fail('hpPerPoint 要大過 0');

  const clamps = requireRecord(statPool.clamps, 'clamps');
  for (const key of Object.keys(baseline)) {
    const clamp = clamps[key];
    if (!Array.isArray(clamp) || clamp.length !== 2 || typeof clamp[0] !== 'number' || typeof clamp[1] !== 'number') {
      fail(`clamps.${key} 要係 [min, max]`);
    }
    if ((clamp as number[])[0]! > (clamp as number[])[1]!) fail(`clamps.${key} 上下限顛倒`);
  }
  if (!Array.isArray(statPool.forbid)) fail('forbid 要係陣列');
  for (const rule of statPool.forbid) {
    if (!isRecord(rule) || typeof rule.reason !== 'string' || !isRecord(rule.when)) {
      fail('forbid 每條要有 when 同 reason');
    }
  }

  const skill = requireRecord(chargen.skill, 'chargen.skill');
  requireString(skill.mode, 'skill.mode');
  requireNumber(skill.maxEffects, 'maxEffects');
  if (!Number.isInteger(skill.maxEffects) || (skill.maxEffects as number) < 1) fail('maxEffects 要係正整數');
  requireNumber(skill.maxPowerScore, 'maxPowerScore');
  if (!Array.isArray(skill.triggers) || skill.triggers.some((item) => typeof item !== 'string')) {
    fail('triggers 要係字串陣列');
  }
  const ops = requireRecord(skill.ops, 'skill.ops');
  if (Object.keys(ops).length === 0) fail('skill.ops 係空');
  for (const [name, op] of Object.entries(ops)) {
    if (!isRecord(op) || typeof op.min !== 'number' || typeof op.max !== 'number') fail(`ops.${name} 缺 min/max`);
    if (op.step !== undefined && (typeof op.step !== 'number' || !(op.step > 0))) fail(`ops.${name} step 唔啱`);
  }

  const goods = requireRecord(data.goods, 'goods');
  const goodList = Object.values(goods);
  if (goodList.length === 0) fail('goods 係空');
  for (const good of goodList) {
    if (!isRecord(good)) fail('goods 項目唔啱');
    requireString(good.id, 'goods.id');
    requireString(good.name, 'goods.name');
    requireNumber(good.basePrice, 'goods.basePrice');
    requireNumber(good.index, 'goods.index');
    requireString(good.slot, 'goods.slot');
    if (typeof good.stackable !== 'boolean') fail(`goods.${String(good.id)} stackable 要係布林`);
    const use = requireRecord(good.use, `goods.${String(good.id)}.use`);
    requireString(use.type, 'goods.use.type');
    if (use.combat !== undefined && !isRecord(use.combat)) fail('goods.use.combat 要係物件');
    if (use.uiHint !== undefined) requireString(use.uiHint, 'goods.use.uiHint');
  }

  const combat = requireRecord(data.combat, 'combat');
  requireNumber(combat.hitFloor, 'combat.hitFloor');
  requireNumber(combat.hitCeil, 'combat.hitCeil');
  requireNumber(combat.guardDefBonus, 'combat.guardDefBonus');
  requireNumber(combat.critRateCap, 'combat.critRateCap');
  requireString(combat.critMulStack, 'combat.critMulStack');
  requireString(combat.onDefeat, 'combat.onDefeat');
  if (combat.requireItemToFight !== null && typeof combat.requireItemToFight !== 'string') {
    fail('combat.requireItemToFight 要係字串或 null');
  }
  const warn = requireRecord(combat.warnIfNoWeapon, 'combat.warnIfNoWeapon');
  requireString(warn.itemId, 'warnIfNoWeapon.itemId');
  requireString(warn.title, 'warnIfNoWeapon.title');
  requireString(warn.body, 'warnIfNoWeapon.body');
  requireString(warn.confirmLabel, 'warnIfNoWeapon.confirmLabel');
  requireString(warn.cancelLabel, 'warnIfNoWeapon.cancelLabel');
  const gameOver = requireRecord(combat.gameOver, 'combat.gameOver');
  requireString(gameOver.title, 'gameOver.title');
  requireString(gameOver.body, 'gameOver.body');
  if (!Array.isArray(gameOver.actions) || gameOver.actions.some((item) => typeof item !== 'string')) {
    fail('gameOver.actions 要係字串陣列');
  }

  const enemies = requireRecord(data.enemies, 'enemies');
  if (Object.keys(enemies).length === 0) fail('enemies 係空');
  for (const enemy of Object.values(enemies)) {
    if (!isRecord(enemy)) fail('enemies 項目唔啱');
    requireString(enemy.id, 'enemy.id');
    requireString(enemy.name, 'enemy.name');
    for (const key of ['atk', 'def', 'hp', 'hit', 'spd', 'dodge']) requireNumber(enemy[key], `enemy.${key}`);
    const skill = requireRecord(enemy.skill, 'enemy.skill');
    requireString(skill.id, 'enemy.skill.id');
    requireString(skill.name, 'enemy.skill.name');
    requireNumber(skill.hpRatioTrigger, 'enemy.skill.hpRatioTrigger');
    if (typeof skill.reapStaysOn !== 'boolean') fail('enemy.skill.reapStaysOn 要係布林');
    const onTrigger = requireRecord(skill.onTrigger, 'enemy.skill.onTrigger');
    requireNumber(onTrigger.def, 'onTrigger.def');
    requireNumber(onTrigger.spdMul, 'onTrigger.spdMul');
    requireNumber(onTrigger.atkPerTurnBonus, 'onTrigger.atkPerTurnBonus');
  }

  const market = requireRecord(data.market, 'market');
  requireString(market.boardId, 'market.boardId');
  requireString(market.label, 'market.label');
  requireString(market.priceFormula, 'market.priceFormula');
  if (typeof market.taxApplies !== 'boolean') fail('market.taxApplies 要係布林');

  const post = requireRecord(data.postFightBlackMarket, 'postFightBlackMarket');
  requireString(post.id, 'postFightBlackMarket.id');
  requireString(post.title, 'postFightBlackMarket.title');
  requireString(post.body, 'postFightBlackMarket.body');
  if (typeof post.forceReturn !== 'boolean') fail('postFightBlackMarket.forceReturn 要係布林');
  const gangResolve = requireRecord(post.gangResolve, 'gangResolve');
  requireString(gangResolve.mode, 'gangResolve.mode');
  requireString(gangResolve.fallbackGang, 'gangResolve.fallbackGang');
  if (!Array.isArray(gangResolve.rules) || gangResolve.rules.length === 0) fail('gangResolve.rules 係空');
  const gangs = new Set<string>([gangResolve.fallbackGang as string]);
  for (const rule of gangResolve.rules) {
    if (!isRecord(rule)) fail('gangResolve.rules 項目唔啱');
    requireString(rule.gang, 'gang.gang');
    requireString(rule.label, 'gang.label');
    if (!isRecord(rule.when) || Object.keys(rule.when).length === 0) fail('gang.when 係空');
    for (const [key, value] of Object.entries(rule.when)) {
      if (typeof value !== 'number' && typeof value !== 'boolean') fail(`gang.when.${key} 要係數字或布林`);
    }
    gangs.add(rule.gang as string);
  }
  const onEnter = requireRecord(post.onEnter, 'onEnter');
  for (const key of ['applyIndexDelta', 'applyVolumeDelta', 'showDiffBanner']) {
    if (typeof onEnter[key] !== 'boolean') fail(`onEnter.${key} 要係布林`);
  }
  const shocks = requireRecord(post.shocks, 'shocks');
  const winShocks = requireRecord(shocks.win, 'shocks.win');
  const goodIds = Object.values(goods).map((good) => (good as Record<string, unknown>).id as string);
  for (const gang of gangs) {
    const shock = requireRecord(winShocks[gang], `shocks.win.${gang}`);
    const indexDelta = requireRecord(shock.indexDelta, `shocks.win.${gang}.indexDelta`);
    const volumeMul = requireRecord(shock.volumeMul, `shocks.win.${gang}.volumeMul`);
    for (const id of goodIds) {
      requireNumber(indexDelta[id], `indexDelta.${id}`);
      requireNumber(volumeMul[id], `volumeMul.${id}`);
    }
  }
  const mustSell = requireRecord(post.mustSell, 'mustSell');
  if (typeof mustSell.required !== 'boolean') fail('mustSell.required 要係布林');
  requireNumber(mustSell.minSellActions, 'mustSell.minSellActions');
  requireString(mustSell.hint, 'mustSell.hint');
  requireString(mustSell.unlockAction, 'mustSell.unlockAction');
  const inventory = requireRecord(post.inventory, 'postFight.inventory');
  if (typeof inventory.preservePlayerStock !== 'boolean') fail('preservePlayerStock 要係布林');
  if (!Array.isArray(inventory.addWinLootStub)) fail('addWinLootStub 要係陣列');
  for (const stub of inventory.addWinLootStub) {
    if (!isRecord(stub)) fail('addWinLootStub 項目唔啱');
    requireString(stub.id, 'loot.id');
    requireString(stub.name, 'loot.name');
    requireNumber(stub.qty, 'loot.qty');
    if (typeof stub.sellable !== 'boolean') fail('loot.sellable 要係布林');
  }

  const stance = requireRecord(data.stance, 'stance');
  if (typeof stance.afterPostFightMarket !== 'boolean') fail('stance.afterPostFightMarket 要係布林');
  if (!Array.isArray(stance.choices) || stance.choices.length === 0) fail('stance.choices 係空');
  for (const choice of stance.choices) {
    if (!isRecord(choice)) fail('stance.choices 項目唔啱');
    requireString(choice.id, 'stance.id');
    requireString(choice.label, 'stance.label');
    requireNumber(choice.sellMul, 'stance.sellMul');
    if (!Array.isArray(choice.appliesTo) || choice.appliesTo.some((id) => typeof id !== 'string')) {
      fail('stance.appliesTo 要係字串陣列');
    }
    const indexDelta = requireRecord(choice.indexDelta, 'stance.indexDelta');
    for (const id of goodIds) requireNumber(indexDelta[id], `stance.indexDelta.${id}`);
  }

  const m3 = requireRecord(data.m3, 'm3');
  requireString(m3.id, 'm3.id');
  const promotion = requireRecord(m3.promotion, 'm3.promotion');
  requireNumber(promotion.fromShopLv, 'm3.promotion.fromShopLv');
  requireNumber(promotion.toShopLv, 'm3.promotion.toShopLv');
  requireString(promotion.title, 'm3.promotion.title');
  requireString(promotion.body, 'm3.promotion.body');
  const settle = requireRecord(m3.settle, 'm3.settle');
  if (typeof settle.autoRedeemAppliesToStock !== 'boolean') fail('m3.settle.autoRedeemAppliesToStock 要係布林');
  if (typeof settle.showBeforeAfterCash !== 'boolean') fail('m3.settle.showBeforeAfterCash 要係布林');
  const chapterEnd = requireRecord(m3.chapterEnd, 'm3.chapterEnd');
  if (typeof chapterEnd.xiangzhuRematch !== 'boolean') fail('m3.chapterEnd.xiangzhuRematch 要係布林');
  if (!Array.isArray(chapterEnd.actions) || chapterEnd.actions.some((item) => typeof item !== 'string')) {
    fail('m3.chapterEnd.actions 要係字串陣列');
  }
  const save = requireRecord(data.save, 'save');
  requireNumber(save.schemaVersion, 'save.schemaVersion');
  if (!Array.isArray(save.fields) || save.fields.length === 0 || save.fields.some((item) => typeof item !== 'string')) {
    fail('save.fields 要係非空字串陣列');
  }

  return data as unknown as ChapterConfig;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} 要係物件`);
  return value;
}

function requireString(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} 要係非空字串`);
}

function requireNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} 要係數字`);
}

function fail(message: string): never {
  throw new Error(message);
}
