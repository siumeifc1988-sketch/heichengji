import { readFileSync } from 'node:fs';
import { applyStanceSettle, bannerHasChange, boardBuy, boardSell, diffLines, openBlackMarket, resolveGang, sellProgress, shopTax, stanceLines, xiangzhuClosed } from '../src/blackmarket.ts';
import { createBattle, critOffer, hitChance, playerAction, rawDamage, saltAction } from '../src/combat.ts';
import { DESIGN_INITIAL_CASH, DESIGN_MIN_DAMAGE } from '../src/design.ts';
import { parseConfig } from '../src/config.ts';
import { nearlyEqual, roundCash } from '../src/format.ts';
import {
  activeForbidStats,
  blankDraft,
  bringingWeapon,
  buyOne,
  chargenReport,
  draftToPlayer,
  effectPowerScore,
  goodUnitPrice,
  legalStatValues,
  pointsSpent,
  randomDraft,
  sellOne,
  stepStat,
  toggleEquip,
} from '../src/rules.ts';
import { readSaveBundle, saveFields, writeSave } from '../src/state.ts';
import type { ChargenDraft } from '../src/types.ts';

let passed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  passed += 1;
}

const config = parseConfig(
  JSON.parse(readFileSync(new URL('../public/config/chapter1.json', import.meta.url), 'utf8')),
);

assert(config.chapter.title === '糧與血', 'chapter title');
assert(Object.values(config.enemies)[0]?.name === '囤糧閣主', 'enemy is the grain hoarder');
assert(config.goods.blade?.name === '義衡軍刀', 'blade renamed');
assert(config.goods.salt?.name === '陳米', 'salt renamed to aged rice');
assert(config.goods.cloth?.name === '義軍布衣', 'cloth name unchanged');
assert(config.prologue.skippable === true, 'prologue skippable');
assert(config.prologue.beats.length === 3, 'three beats');
assert(config.chargen.statPool.budgetPoints === 6, 'budget');
assert(config.chargen.statPool.hpPerPoint === 2, 'hp per point');
assert(config.chargen.skill.maxPowerScore === 4, 'power cap');
assert(config.chargen.skill.maxEffects === 2, 'max effects');
assert(Object.keys(config.goods).length === 3, 'three goods');

const expectedPrices: Record<string, number> = {
  義衡軍刀: 40,
  陳米: 12,
  義軍布衣: 8,
};
for (const good of Object.values(config.goods)) {
  assert(nearlyEqual(goodUnitPrice(good), good.basePrice * good.index), `price formula ${good.id}`);
  assert(nearlyEqual(goodUnitPrice(good), expectedPrices[good.name] ?? Number.NaN), `sample price ${good.name}`);
}

const baseline = blankDraft(config);
assert(nearlyEqual(pointsSpent(config, baseline.stats), 0), 'baseline spends 0');
assert(legalStatValues(config, 'hp').join(',') === '16,18,20,22,24', 'hp grid');
assert(!legalStatValues(config, 'hp').includes(21), 'hp skips 21');

assert(nearlyEqual(effectPowerScore('self_atk_add', 3) ?? NaN, 3), 'atk score');
assert(nearlyEqual(effectPowerScore('self_def_add', 2) ?? NaN, 2), 'def score');
assert(nearlyEqual(effectPowerScore('enemy_def_add', -2) ?? NaN, 2), 'enemy def abs');
assert(nearlyEqual(effectPowerScore('self_hit_add', 15) ?? NaN, 3), 'hit score');
assert(nearlyEqual(effectPowerScore('self_dodge_add', 5) ?? NaN, 1), 'dodge score');
assert(nearlyEqual(effectPowerScore('self_heal', 1) ?? NaN, 0.5), 'heal 1');
assert(nearlyEqual(effectPowerScore('self_heal', 4) ?? NaN, 2), 'heal 4');
assert(nearlyEqual(effectPowerScore('dmg_mul_next', 1.2) ?? NaN, 2), 'mul 1.2');
assert(nearlyEqual(effectPowerScore('dmg_mul_next', 1.5) ?? NaN, 3), 'mul 1.5');
const mid = effectPowerScore('dmg_mul_next', 1.3);
assert(mid !== null && mid > 2 && mid < 3, 'mul 1.3 interpolates');
assert(nearlyEqual(effectPowerScore('reflect_flat', 2) ?? NaN, 2), 'reflect');
assert(nearlyEqual(effectPowerScore('info_reveal', 0) ?? NaN, 0), 'info');
assert(effectPowerScore('not_an_op', 1) === null, 'unknown op');

function filled(overrides: Partial<ChargenDraft> = {}): ChargenDraft {
  return {
    ...blankDraft(config),
    name: '阿鹽',
    catchphrase: '秤平先開市',
    skillName: '碎鹽',
    skillFlavor: '袋底一撮',
    skillTrigger: 'on_attack',
    effects: [
      { op: 'self_atk_add', value: 2 },
      { op: 'self_heal', value: 4 },
    ],
    ...overrides,
    stats: { ...blankDraft(config).stats, ...overrides.stats },
  };
}

const valid = chargenReport(config, filled());
assert(valid.valid, `valid path: ${valid.issues.join(' | ')}`);
assert(nearlyEqual(valid.powerScore, 4), 'cap is legal');

const overPower = chargenReport(
  config,
  filled({
    effects: [
      { op: 'self_atk_add', value: 3 },
      { op: 'self_def_add', value: 2 },
    ],
  }),
);
assert(!overPower.valid && overPower.overPower, 'over power blocks');
assert(overPower.issues.some((issue) => issue.includes('超過上限') && issue.includes('4')), 'power message');

const forbid = chargenReport(config, filled({ stats: { atk: 10, hp: 24 } }));
assert(!forbid.valid, 'forbid blocks');
assert(forbid.issues.some((issue) => issue.includes('防過強')), 'forbid reason from config');

const nearForbid = chargenReport(config, filled({ stats: { atk: 10, hp: 22 } }));
assert(nearForbid.valid, `atk 10 hp 22 should pass: ${nearForbid.issues.join(' | ')}`);

const overBudget = chargenReport(config, filled({ stats: { atk: 10, def: 5, spd: 8, dodge: 11 } }));
assert(!overBudget.valid && overBudget.overBudget, 'over budget blocks');

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let sawOneEffect = false;
let sawMaxEffects = false;
const randomNames = new Set<string>();
for (let seed = 1; seed <= 80; seed += 1) {
  const draft = randomDraft(config, mulberry32(seed));
  const report = chargenReport(config, draft);
  assert(report.valid, `random draft ${seed} valid: ${report.issues.join(' | ')}`);
  assert(draft.name.trim().length > 0 && draft.catchphrase.trim().length > 0, `random text ${seed}`);
  assert(draft.skillName.trim().length > 0 && draft.skillFlavor.trim().length > 0, `random skill text ${seed}`);
  assert(config.chargen.skill.triggers.includes(draft.skillTrigger), `random trigger ${seed}`);
  assert(
    draft.effects.length >= 1 && draft.effects.length <= config.chargen.skill.maxEffects,
    `random effect count ${seed}`,
  );
  assert(report.powerScore <= config.chargen.skill.maxPowerScore + 1e-6, `random power ${seed}`);
  assert(report.pointsSpent <= config.chargen.statPool.budgetPoints + 1e-6, `random budget ${seed}`);
  assert(report.pointsSpent >= 1 - 1e-6, `random spends a point ${seed}`);
  assert(activeForbidStats(config, draft.stats).length === 0, `random forbid ${seed}`);
  assert(!((draft.stats.atk ?? 0) >= 10 && (draft.stats.hp ?? 0) >= 24), `random not 防過強 ${seed}`);
  const ops = draft.effects.map((effect) => effect.op);
  assert(new Set(ops).size === ops.length, `random unique ops ${seed}`);
  if (draft.effects.length === 1) sawOneEffect = true;
  if (draft.effects.length === config.chargen.skill.maxEffects) sawMaxEffects = true;
  randomNames.add(draft.name);
}
assert(sawOneEffect && sawMaxEffects, 'random drafts use 1 and max effects');
assert(randomNames.size > 1, 'random names vary');

const oddHp = chargenReport(config, filled({ stats: { hp: 21 } }));
assert(oddHp.issues.some((issue) => issue.includes('氣血')), 'hp alignment');

const highAtk = chargenReport(config, filled({ stats: { atk: 11 } }));
assert(highAtk.issues.some((issue) => issue.includes('攻擊')), 'clamp');

const noName = chargenReport(config, filled({ name: '   ' }));
assert(noName.issues.some((issue) => issue.includes('名字')), 'name required');

const duplicate = chargenReport(
  config,
  filled({
    effects: [
      { op: 'info_reveal', value: 0 },
      { op: 'info_reveal', value: 0 },
    ],
  }),
);
assert(duplicate.issues.some((issue) => issue.includes('多過一次')), 'duplicate op');

const stepped = blankDraft(config);
stepStat(config, stepped.stats, 'atk', 1);
stepStat(config, stepped.stats, 'atk', 1);
stepStat(config, stepped.stats, 'atk', 1);
assert(stepped.stats.atk === 10, 'atk stepper clamps at 10');
stepStat(config, stepped.stats, 'hp', 1);
stepStat(config, stepped.stats, 'hp', 1);
assert(stepped.stats.hp === 24, 'hp stepper hits 24');

const player = draftToPlayer(config, filled());
assert(player.cash === DESIGN_INITIAL_CASH, 'starter cash');
assert(player.shopLv === config.chapter.startShopLv, 'shop level from config');
assert(player.inventory.city_blade === 0, 'empty stock');

const broke = buyOne(config, player, 'missing');
assert(!broke.ok, 'unknown good');
player.cash = 0;
const cannot = buyOne(config, player, 'city_blade');
assert(!cannot.ok && player.cash === 0 && player.inventory.city_blade === 0, 'cash check');
player.cash = DESIGN_INITIAL_CASH;
const bought = buyOne(config, player, 'city_blade');
assert(bought.ok && nearlyEqual(player.cash, 10) && player.inventory.city_blade === 1, 'buy blade');
const stacked = buyOne(config, player, 'city_blade');
assert(!stacked.ok && player.inventory.city_blade === 1 && nearlyEqual(player.cash, 10), 'blade does not stack');
const sold = sellOne(config, player, 'city_blade');
assert(sold.ok && nearlyEqual(player.cash, DESIGN_INITIAL_CASH) && player.inventory.city_blade === 0, 'sell blade');
const emptySell = sellOne(config, player, 'city_blade');
assert(!emptySell.ok && nearlyEqual(player.cash, DESIGN_INITIAL_CASH), 'cannot sell empty');

assert(config.combat.onDefeat === 'game_over', 'defeat is death');
assert(config.combat.requireItemToFight === null, 'no item gate');
assert(config.goods.blade?.use?.requiredToFight === false, 'blade not required');
assert(hitChance(0, 100, config) === config.combat.hitFloor, 'hit floor');
assert(hitChance(400, 0, config) === config.combat.hitCeil, 'hit ceil');
assert(rawDamage(1, 99) === DESIGN_MIN_DAMAGE, 'min damage');

const hero = draftToPlayer(config, filled({
  skillTrigger: 'on_battle_start',
  effects: [{ op: 'info_reveal', value: 0 }],
}));
assert(critOffer(config, hero) === null, 'no crit without equip');
assert(!bringingWeapon(config, hero), 'not bringing blade');
buyOne(config, hero, 'city_blade');
toggleEquip(config, hero, 'city_blade');
const offer = critOffer(config, hero);
const bladeCrit = config.goods.blade?.use?.combat;
assert(offer !== null && bladeCrit?.critRate !== undefined && bladeCrit.critMul !== undefined, 'blade crit exists');
assert(offer?.rate === Math.min(bladeCrit?.critRate ?? 0, config.combat.critRateCap), 'crit rate capped');
assert(offer?.mul === bladeCrit?.critMul, 'crit mul from the one equip');
const inflated = structuredClone(config);
const inflatedCrit = inflated.goods.blade?.use?.combat;
if (inflatedCrit) inflatedCrit.critRate = config.combat.critRateCap + 10;
assert(critOffer(inflated, hero)?.rate === config.combat.critRateCap, 'rate respects cap');

const critBattle = createBattle(config, hero);
playerAction(critBattle, config, hero, 'attack', () => 0);
assert(critBattle.log.some((line) => line.startsWith('爆擊（')), 'equipped blade can crit');

const missBattle = createBattle(config, hero);
playerAction(missBattle, config, hero, 'attack', () => 0.99);
assert(missBattle.log.some((line) => line.includes('打唔中')), 'miss');
assert(!missBattle.log.some((line) => line.startsWith('爆擊（')), 'crit only on a hit');

const salt = saltAction(config);
assert(salt !== null, 'salt action');
hero.inventory[salt?.good.id ?? ''] = 1;
const saltBattle = createBattle(config, hero);
playerAction(saltBattle, config, hero, 'salt', () => 0);
assert(hero.inventory[salt?.good.id ?? ''] === 0, 'salt consumed');
playerAction(saltBattle, config, hero, 'salt', () => 0);
assert(saltBattle.saltUses === 1, 'salt once per battle');
const hpBefore = saltBattle.enemy.hp;
playerAction(saltBattle, config, hero, 'attack', () => 0.99);
assert(saltBattle.enemy.hp === hpBefore, 'miss does not spend the salted damage on hp');
assert(!saltBattle.saltReady, 'salt buff is spent on the swing');

const cloth = config.goods.cloth;
if (cloth) {
  hero.inventory[cloth.id] = 1;
  toggleEquip(config, hero, cloth.id);
  const clothed = createBattle(config, hero);
  const dodgeAdd = cloth.use?.combat?.dodgeAdd ?? 0;
  assert(clothed.player.dodge === (hero.stats.dodge ?? 0) + dodgeAdd, 'cloth dodge');
  assert(clothed.log.some((line) => line.includes('布衣')), 'cloth hint line');
}

const enemySkill = Object.values(config.enemies)[0]?.skill;
const reapBattle = createBattle(config, hero);
if (enemySkill) {
  reapBattle.enemy.hp = Math.floor(reapBattle.enemy.maxHp * enemySkill.hpRatioTrigger);
  playerAction(reapBattle, config, hero, 'guard', () => 0);
  assert(reapBattle.reap, 'xiangzhu reaps');
  assert(reapBattle.enemy.def === enemySkill.onTrigger.def, 'reap sets def');
  assert(reapBattle.enemy.atk === reapBattle.enemyBaseAtk + enemySkill.onTrigger.atkPerTurnBonus, 'reap atk bonus');
  assert(reapBattle.log.some((line) => line.includes(enemySkill.name)), 'reap names the skill');
}

const loss = createBattle(config, hero);
loss.player.hp = 1;
playerAction(loss, config, hero, 'guard', () => 0);
assert(loss.phase === 'lose', 'defeat ends the fight');
assert(hero.flags.beatXiangzhu === false, 'defeat does not mark a win');
assert(hero.board === null, 'defeat does not open the black market');

const win = createBattle(config, hero);
win.enemy.hp = 1;
playerAction(win, config, hero, 'attack', () => 0);
assert(win.phase === 'win', 'lethal hit wins');

const bladeId = config.goods.blade?.id ?? '';
const saltId = config.goods.salt?.id ?? '';
const clothId = config.goods.cloth?.id ?? '';
const rules = config.postFightBlackMarket.gangResolve.rules;
const rebelStock = { [clothId]: 2, [bladeId]: 1, [saltId]: 3 };
assert(resolveGang(config, rebelStock).gang === rules[0]?.gang, 'first gang rule wins');
assert(resolveGang(config, { [bladeId]: 1, [saltId]: 2 }).gang === rules[1]?.gang, 'city bias');
assert(resolveGang(config, { [saltId]: 3 }).gang === rules[2]?.gang, 'salt bias');
const unaligned = resolveGang(config, { [bladeId]: 1 });
assert(unaligned.usingFallback && unaligned.gang === config.postFightBlackMarket.gangResolve.fallbackGang, 'fallback gang');

const trader = draftToPlayer(config, filled({
  skillTrigger: 'on_battle_start',
  effects: [{ op: 'info_reveal', value: 0 }],
}));
trader.inventory[bladeId] = 1;
trader.inventory[saltId] = 1;
trader.cash = DESIGN_INITIAL_CASH;
const kept = trader.inventory[bladeId] ?? 0;
openBlackMarket(config, trader, { [saltId]: 3 });
const saltGang = resolveGang(config, { [saltId]: 3 }).gang;
assert(trader.board?.gang === saltGang, 'gang uses pre-fight stock');
assert((trader.inventory[bladeId] ?? 0) === kept, 'stock preserved');
const shock = config.postFightBlackMarket.shocks.win[saltGang];
assert(shock !== undefined && trader.board !== null, 'shock exists');
if (shock && trader.board) {
  assert(nearlyEqual(trader.board.quotes[bladeId]?.index ?? NaN, (config.goods.blade?.index ?? 0) + (shock.indexDelta[bladeId] ?? NaN)), 'index delta once');
  assert(nearlyEqual(trader.board.quotes[saltId]?.volumeMul ?? NaN, shock.volumeMul[saltId] ?? NaN), 'volume from shock');
}
const frozen = trader.board?.quotes[bladeId]?.index;
openBlackMarket(config, trader, { [bladeId]: 1 });
assert(trader.board?.quotes[bladeId]?.index === frozen, 'shock does not stack');
const diffs = diffLines(config, trader);
assert(bannerHasChange(diffs), 'banner has a price or volume change');
const loot = config.postFightBlackMarket.inventory.addWinLootStub[0];
assert(loot !== undefined && trader.stubs.some((stub) => stub.id === loot.id && stub.sellable === loot.sellable && stub.qty === loot.qty), 'win loot stub');

const seller = draftToPlayer(config, filled({
  skillTrigger: 'on_battle_start',
  effects: [{ op: 'info_reveal', value: 0 }],
}));
seller.inventory[bladeId] = 1;
seller.inventory[saltId] = 1;
seller.cash = DESIGN_INITIAL_CASH;
openBlackMarket(config, seller, { [bladeId]: 1 });
assert(!sellProgress(config, seller).unlocked, 'steward locked before a sale');
const clothBuy = boardBuy(config, seller, clothId);
assert(clothBuy.ok && seller.board?.sellActions === 0, 'buying is not a sell');
const thin = boardSell(config, seller, saltId);
assert(!thin.ok && seller.board?.sellActions === 0, 'thin volume does not count');
const dumped = boardSell(config, seller, bladeId);
assert(dumped.ok && sellProgress(config, seller).unlocked, 'one sell unlocks the steward');
const lines = stanceLines(config, seller);
const justice = config.stance.choices.find((choice) => choice.appliesTo.includes(clothId));
const dark = config.stance.choices.find((choice) => choice.appliesTo.includes(bladeId));
const clothSettle = lines.find((line) => line.choiceId === justice?.id && line.goodId === clothId);
const bladeSettle = lines.find((line) => line.choiceId === dark?.id && line.goodId === bladeId);
assert(justice !== undefined && dark !== undefined && clothSettle !== undefined && bladeSettle !== undefined, 'both stance paths');
assert(nearlyEqual(justice?.sellMul ?? NaN, 1.3) && nearlyEqual(dark?.sellMul ?? NaN, 1.35), 'stance multipliers from config');
assert(nearlyEqual(clothSettle?.settlePrice ?? NaN, (clothSettle?.boardPrice ?? NaN) * (justice?.sellMul ?? NaN)), 'justice settle uses sellMul');
assert(nearlyEqual(bladeSettle?.settlePrice ?? NaN, (bladeSettle?.boardPrice ?? NaN) * (dark?.sellMul ?? NaN)), 'dark settle uses sellMul');

const closer = draftToPlayer(config, filled({
  skillTrigger: 'on_battle_start',
  effects: [{ op: 'info_reveal', value: 0 }],
}));
closer.inventory[clothId] = 2;
closer.cash = 20;
closer.flags.beatXiangzhu = true;
openBlackMarket(config, closer, { [bladeId]: 1 });
const justiceChoice = config.stance.choices.find((choice) => choice.id === 'justice');
const clothBefore = closer.board?.quotes[clothId]?.index ?? Number.NaN;
const settled = justiceChoice ? applyStanceSettle(config, closer, justiceChoice.id, true) : null;
const clothAfter = closer.board?.quotes[clothId]?.index ?? Number.NaN;
const clothGood = config.goods.cloth;
assert(justiceChoice !== undefined && clothGood !== undefined && settled !== null, 'stance settle runs');
assert(nearlyEqual(clothAfter, clothBefore + (justiceChoice?.indexDelta[clothId] ?? NaN)), 'stance index delta applied');
const redeemUnit = (clothGood?.basePrice ?? 0) * clothAfter * (justiceChoice?.sellMul ?? 0);
assert(nearlyEqual(settled?.cashAfter ?? NaN, roundCash(20 + roundCash(2 * redeemUnit))), 'redeem leftover stock');
assert(nearlyEqual(settled?.cashBefore ?? NaN, 20), 'cash before is kept');
assert((closer.inventory[clothId] ?? 1) === 0, 'appliesTo stock cleared');
assert(closer.shopLv === config.m3.promotion.toShopLv, 'shop level from promotion');
assert(closer.slots === config.chapter.endSlots, 'slots from chapter end');
assert(nearlyEqual(shopTax(config, closer.shopLv), config.chapter.taxByShopLv[String(closer.shopLv)] ?? NaN), 'tax follows shop level');
assert(closer.shopLv !== config.chapter.startShopLv && closer.slots !== config.chapter.startSlots, 'promotion changes the stall');
const frozenCash = closer.cash;
const frozenIndex = closer.board?.quotes[clothId]?.index;
applyStanceSettle(config, closer, 'dark', true);
assert(closer.cash === frozenCash && closer.board?.quotes[clothId]?.index === frozenIndex, 'settle does not run twice');
assert(xiangzhuClosed(config, closer), 'xiangzhu stays closed');
assert(config.m3.chapterEnd.xiangzhuRematch === false, 'config forbids rematch');
assert(config.m3.settle.autoRedeemAppliesToStock === true, 'redeem defaults on');
assert(config.save.schemaVersion === 1, 'save schema stays 1');
for (const key of ['shopLv', 'slots', 'tax', 'cash', 'inventory', 'indices', 'volumeMul', 'stance', 'gang', 'flags']) {
  assert(config.save.fields.includes(key), `save field ${key}`);
}
const fields = saveFields(config, closer);
assert(fields.shopLv === closer.shopLv && fields.slots === closer.slots && fields.stance === closer.flags.stanceId, 'save fields mirror the stall');
const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  },
});
assert(writeSave(config, closer, 'blackmarket'), 'write lv2 save');
const restored = readSaveBundle(config);
assert(restored?.resumeScreen === 'blackmarket', 'reload screen is the lv2 board');
assert(restored?.player.shopLv === closer.shopLv && restored.player.slots === closer.slots, 'reload keeps shop');
assert(nearlyEqual(restored?.player.cash ?? NaN, closer.cash), 'reload keeps cash');
assert(nearlyEqual(restored?.player.board?.quotes[clothId]?.index ?? NaN, clothAfter), 'reload keeps index');
assert(restored?.player.flags.beatXiangzhu === true, 'reload keeps the flag');

let threw = false;
try {
  parseConfig({});
} catch {
  threw = true;
}
assert(threw, 'bad config throws');

console.log(`selfcheck: ${passed} assertions passed`);
