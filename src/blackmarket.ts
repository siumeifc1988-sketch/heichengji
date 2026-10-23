import { DESIGN_BASE_VOLUME } from './design.ts';
import { formatNum, roundCash } from './format.ts';
import { canAfford, findGood } from './rules.ts';
import type {
  ChapterConfig,
  MarketShock,
  PlayerState,
  StanceChoice,
  TradeResult,
} from './types.ts';

export interface GangHit {
  gang: string;
  label: string;
  usingFallback: boolean;
}

export interface DiffLine {
  goodId: string;
  name: string;
  oldPrice: number;
  newPrice: number;
  oldVolume: number;
  newVolume: number;
}

export interface SettleLine {
  choiceId: string;
  label: string;
  sellMul: number;
  note: string;
  goodId: string;
  goodName: string;
  boardPrice: number;
  settlePrice: number;
  /** 新指數牌價 × sellMul。自動兌現用呢個單價。 */
  redeemUnit: number;
  indexDelta: number;
  nextIndex: number;
}

/** 第一條 when 全中就用。cloth／salt／blade 對住 goods 嘅鍵，唔係寫死件數。 */
export function resolveGang(config: ChapterConfig, stock: Record<string, number>): GangHit {
  const resolve = config.postFightBlackMarket.gangResolve;
  for (const rule of resolve.rules) {
    if (whenMatches(config, rule.when, stock)) {
      return { gang: rule.gang, label: rule.label, usingFallback: false };
    }
  }
  return { gang: resolve.fallbackGang, label: resolve.fallbackGang, usingFallback: true };
}

export function openBlackMarket(config: ChapterConfig, player: PlayerState, preFightStock: Record<string, number>): void {
  if (player.board?.opened) return;
  const post = config.postFightBlackMarket;
  const hit = resolveGang(config, preFightStock);
  const shock = post.shocks.win[hit.gang];
  if (!shock) throw new Error(`冇呢個幫派嘅勝場衝擊：${hit.gang}`);
  if (!post.inventory.preservePlayerStock) {
    for (const id of Object.keys(player.inventory)) player.inventory[id] = 0;
    player.equipment = { weapon: null, armor: null };
  }
  for (const stub of post.inventory.addWinLootStub) {
    if (player.stubs.some((held) => held.id === stub.id)) continue;
    player.stubs.push({ id: stub.id, name: stub.name, qty: stub.qty, sellable: stub.sellable });
  }
  player.board = {
    opened: true,
    gang: hit.gang,
    gangLabel: hit.label,
    usingFallback: hit.usingFallback,
    quotes: quoteTable(config, shock),
    sellActions: 0,
  };
}

export function diffLines(config: ChapterConfig, player: PlayerState): DiffLine[] {
  const board = player.board;
  if (!board?.opened) return [];
  const lines: DiffLine[] = [];
  for (const good of Object.values(config.goods)) {
    const quote = board.quotes[good.id];
    if (!quote) continue;
    lines.push({
      goodId: good.id,
      name: good.name,
      oldPrice: good.basePrice * good.index,
      newPrice: good.basePrice * quote.index,
      oldVolume: DESIGN_BASE_VOLUME,
      newVolume: quote.volumeMul,
    });
  }
  return lines;
}

export function bannerHasChange(lines: DiffLine[]): boolean {
  return lines.some((line) => line.oldPrice !== line.newPrice || line.oldVolume !== line.newVolume);
}

export function sellProgress(config: ChapterConfig, player: PlayerState): { done: number; need: number; unlocked: boolean } {
  const must = config.postFightBlackMarket.mustSell;
  const done = player.board?.sellActions ?? 0;
  const need = must.minSellActions;
  return { done, need, unlocked: !must.required || done >= need };
}

export function boardBuy(config: ChapterConfig, player: PlayerState, goodId: string): TradeResult {
  const priced = pricedGood(config, player, goodId);
  if (!priced.ok) return priced.result;
  const { good, price, unit, volumeMul } = priced;
  if (volumeMul < DESIGN_BASE_VOLUME) {
    return { ok: false, message: `${good.name}成交量 ${formatNum(volumeMul)}，未夠一手，買唔入。` };
  }
  if (!canAfford(player.cash, price)) return { ok: false, message: `錢唔夠，買唔到${good.name}。` };
  const qty = player.inventory[good.id] ?? 0;
  if (good.stackable === false && qty >= 1) return { ok: false, message: `${good.name}唔疊加，身上已經有。` };
  player.cash = roundCash(player.cash - price);
  player.inventory[good.id] = (Number.isFinite(qty) ? qty : 0) + 1;
  return { ok: true, message: `黑市進貨：${good.name}，−${formatNum(price)} ${unit}。` };
}

export function boardSell(config: ChapterConfig, player: PlayerState, goodId: string): TradeResult {
  const priced = pricedGood(config, player, goodId);
  if (!priced.ok) return priced.result;
  const { good, price, unit, volumeMul } = priced;
  const qty = player.inventory[good.id] ?? 0;
  if (!Number.isFinite(qty) || qty < 1) return { ok: false, message: `冇${good.name}可拋。` };
  if (volumeMul < DESIGN_BASE_VOLUME) {
    return { ok: false, message: `${good.name}成交量 ${formatNum(volumeMul)}，未夠一手，賣唔出。` };
  }
  player.inventory[good.id] = qty - 1;
  if ((player.inventory[good.id] ?? 0) <= 0) {
    if (player.equipment.weapon === good.id) player.equipment.weapon = null;
    if (player.equipment.armor === good.id) player.equipment.armor = null;
  }
  player.cash = roundCash(player.cash + price);
  if (player.board) player.board.sellActions += 1;
  return { ok: true, message: `黑市拋售：${good.name}，+${formatNum(price)} ${unit}。` };
}

export function stanceLines(config: ChapterConfig, player: PlayerState): SettleLine[] {
  const lines: SettleLine[] = [];
  for (const choice of config.stance.choices) {
    for (const goodId of choice.appliesTo) {
      const good = findGood(config, goodId);
      const quote = player.board?.quotes[goodId];
      if (!good || !quote) continue;
      const boardPrice = good.basePrice * quote.index;
      const indexDelta = choice.indexDelta[goodId] ?? 0;
      const nextIndex = quote.index + indexDelta;
      lines.push({
        choiceId: choice.id,
        label: choice.label,
        sellMul: choice.sellMul,
        note: choice.note ?? '',
        goodId,
        goodName: good.name,
        boardPrice,
        settlePrice: boardPrice * choice.sellMul,
        redeemUnit: good.basePrice * nextIndex * choice.sellMul,
        indexDelta,
        nextIndex,
      });
    }
  }
  return lines;
}

export function choiceById(config: ChapterConfig, id: string): StanceChoice | undefined {
  return config.stance.choices.find((choice) => choice.id === id);
}

export function shopTax(config: ChapterConfig, shopLv: number): number {
  const rate = config.chapter.taxByShopLv[String(shopLv)];
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : 0;
}

export function xiangzhuClosed(config: ChapterConfig, player: PlayerState): boolean {
  return player.flags.beatXiangzhu && config.m3.chapterEnd.xiangzhuRematch === false;
}

export interface SettleReceipt {
  cashBefore: number;
  cashAfter: number;
  redeemed: { goodId: string; qty: number; unit: number }[];
}

/**
 * 先把立場 indexDelta 加落勝後指數，再按新牌價 × sellMul 兌現 appliesTo 剩餘庫存。
 * 乘數次序唔喺 JSON，只係「sellMul ＋ indexDelta」一齊生效。
 * 已結算過就唔再加減現金。
 */
export function applyStanceSettle(config: ChapterConfig, player: PlayerState, choiceId: string, redeem: boolean): SettleReceipt | null {
  const choice = choiceById(config, choiceId);
  const board = player.board;
  if (!choice || !board?.opened) return null;
  if (player.settle) {
    return {
      cashBefore: player.settle.cashBefore,
      cashAfter: player.settle.cashAfter,
      redeemed: player.settle.redeemed,
    };
  }
  const cashBefore = player.cash;
  for (const good of Object.values(config.goods)) {
    const quote = board.quotes[good.id];
    if (!quote) continue;
    quote.index += choice.indexDelta[good.id] ?? 0;
  }
  const redeemed: SettleReceipt['redeemed'] = [];
  if (redeem) {
    for (const goodId of choice.appliesTo) {
      const good = findGood(config, goodId);
      const quote = board.quotes[goodId];
      const qty = player.inventory[goodId] ?? 0;
      if (!good || !quote || !Number.isFinite(qty) || qty < 1) continue;
      const unit = good.basePrice * quote.index * choice.sellMul;
      const gain = roundCash(qty * unit);
      player.cash = roundCash(player.cash + gain);
      player.inventory[goodId] = 0;
      if (player.equipment.weapon === goodId) player.equipment.weapon = null;
      if (player.equipment.armor === goodId) player.equipment.armor = null;
      redeemed.push({ goodId, qty, unit });
    }
  }
  player.flags.stanceId = choice.id;
  player.flags.postFightMarketDone = true;
  player.shopLv = config.m3.promotion.toShopLv;
  player.slots = config.chapter.endSlots;
  player.settle = {
    choiceId: choice.id,
    cashBefore,
    cashAfter: player.cash,
    redeemed,
  };
  return { cashBefore, cashAfter: player.cash, redeemed };
}

function quoteTable(config: ChapterConfig, shock: MarketShock): BoardStateQuotes {
  const post = config.postFightBlackMarket.onEnter;
  const quotes: BoardStateQuotes = {};
  for (const good of Object.values(config.goods)) {
    const indexDelta = post.applyIndexDelta ? (shock.indexDelta[good.id] ?? 0) : 0;
    const volumeMul = post.applyVolumeDelta ? (shock.volumeMul[good.id] ?? DESIGN_BASE_VOLUME) : DESIGN_BASE_VOLUME;
    quotes[good.id] = { index: good.index + indexDelta, volumeMul };
  }
  return quotes;
}

type BoardStateQuotes = NonNullable<PlayerState['board']>['quotes'];

function whenMatches(config: ChapterConfig, when: Record<string, number | boolean>, stock: Record<string, number>): boolean {
  const entries = Object.entries(when);
  if (entries.length === 0) return false;
  return entries.every(([key, raw]) => {
    if (key.endsWith('_qty_gte')) {
      const good = config.goods[key.slice(0, -'_qty_gte'.length)];
      return typeof raw === 'number' && !!good && (stock[good.id] ?? 0) >= raw;
    }
    if (key.endsWith('_owned')) {
      const good = config.goods[key.slice(0, -'_owned'.length)];
      if (!good || typeof raw !== 'boolean') return false;
      const owned = (stock[good.id] ?? 0) >= 1;
      return owned === raw;
    }
    return false;
  });
}

function pricedGood(
  config: ChapterConfig,
  player: PlayerState,
  goodId: string,
):
  | { ok: true; good: NonNullable<ReturnType<typeof findGood>>; price: number; unit: string; volumeMul: number }
  | { ok: false; result: TradeResult } {
  const good = findGood(config, goodId);
  if (!good || !player.board?.opened) return { ok: false, result: { ok: false, message: '黑市未開板。' } };
  const quote = player.board.quotes[good.id];
  if (!quote) return { ok: false, result: { ok: false, message: '貨單上冇呢件。' } };
  return {
    ok: true,
    good,
    price: good.basePrice * quote.index,
    unit: config.currency.label,
    volumeMul: quote.volumeMul,
  };
}
