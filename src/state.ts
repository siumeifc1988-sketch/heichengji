import { SAVE_NODE, SAVE_STORAGE_KEY, SAVE_VERSION, SAVE_VERSIONS_ACCEPTED } from './design.ts';
import { isRecord } from './config.ts';
import { blankDraft } from './rules.ts';
import type { AppState, BoardState, ChapterConfig, EffectSelection, LootStub, PlayerState, ScreenId, SettleRecord } from './types.ts';

export function createAppState(config: ChapterConfig, hasSave: boolean): AppState {
  return {
    screen: 'prologue',
    beat: 0,
    draft: blankDraft(config),
    player: null,
    note: '',
    hasSave,
    warnFight: false,
    autoFight: false,
    battle: null,
    preFightStock: null,
    redeemStock: null,
  };
}

export interface SaveBundle {
  player: PlayerState;
  resumeScreen: ScreenId | null;
}

export function writeSave(config: ChapterConfig, player: PlayerState, resumeScreen: ScreenId): boolean {
  try {
    const file = {
      version: SAVE_VERSION,
      schemaVersion: config.save.schemaVersion,
      node: SAVE_NODE,
      savedAt: new Date().toISOString(),
      resumeScreen,
      fields: saveFields(config, player),
      player,
    };
    localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

export function saveFields(config: ChapterConfig, player: PlayerState): Record<string, unknown> {
  const indices: Record<string, number> = {};
  const volumeMul: Record<string, number> = {};
  for (const good of Object.values(config.goods)) {
    const quote = player.board?.quotes[good.id];
    if (!quote) continue;
    indices[good.id] = quote.index;
    volumeMul[good.id] = quote.volumeMul;
  }
  const tax = config.chapter.taxByShopLv[String(player.shopLv)];
  return {
    shopLv: player.shopLv,
    slots: player.slots,
    tax: typeof tax === 'number' ? tax : null,
    cash: player.cash,
    inventory: { ...player.inventory },
    equipment: { ...player.equipment },
    indices,
    volumeMul,
    stance: player.flags.stanceId,
    gang: player.board?.gang ?? null,
    flags: { ...player.flags },
    player: { name: player.name, catchphrase: player.catchphrase },
    skill: player.skill,
  };
}

export function readSave(config: ChapterConfig): PlayerState | null {
  return readSaveBundle(config)?.player ?? null;
}

export function readSaveBundle(config: ChapterConfig): SaveBundle | null {
  try {
    const raw = localStorage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.node !== SAVE_NODE) return null;
    const versionOk = typeof parsed.version === 'number' && (SAVE_VERSIONS_ACCEPTED as readonly number[]).includes(parsed.version);
    const schemaOk = parsed.schemaVersion === config.save.schemaVersion;
    if (!versionOk && !schemaOk) return null;
    const player = hydratePlayer(config, parsed.player);
    if (!player) return null;
    applySaveFields(config, player, parsed.fields);
    const resumeScreen = typeof parsed.resumeScreen === 'string' ? (parsed.resumeScreen as ScreenId) : null;
    return { player, resumeScreen };
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

function hydrateSettle(value: unknown): SettleRecord | null {
  if (!isRecord(value) || typeof value.choiceId !== 'string') return null;
  if (typeof value.cashBefore !== 'number' || typeof value.cashAfter !== 'number') return null;
  const redeemed: SettleRecord['redeemed'] = [];
  if (Array.isArray(value.redeemed)) {
    for (const line of value.redeemed) {
      if (!isRecord(line) || typeof line.goodId !== 'string') continue;
      if (typeof line.qty !== 'number' || typeof line.unit !== 'number') continue;
      redeemed.push({ goodId: line.goodId, qty: line.qty, unit: line.unit });
    }
  }
  return { choiceId: value.choiceId, cashBefore: value.cashBefore, cashAfter: value.cashAfter, redeemed };
}

function applySaveFields(config: ChapterConfig, player: PlayerState, value: unknown): void {
  if (!isRecord(value)) return;
  if (typeof value.shopLv === 'number' && Number.isFinite(value.shopLv)) player.shopLv = value.shopLv;
  if (typeof value.slots === 'number' && Number.isFinite(value.slots)) player.slots = value.slots;
  if (typeof value.cash === 'number' && Number.isFinite(value.cash)) player.cash = value.cash;
  if (isRecord(value.inventory)) {
    for (const good of Object.values(config.goods)) {
      const qty = value.inventory[good.id];
      if (typeof qty === 'number' && Number.isFinite(qty)) player.inventory[good.id] = Math.max(0, Math.floor(qty));
    }
  }
  if (isRecord(value.equipment)) {
    player.equipment = {
      weapon: typeof value.equipment.weapon === 'string' ? value.equipment.weapon : null,
      armor: typeof value.equipment.armor === 'string' ? value.equipment.armor : null,
    };
    if (player.equipment.weapon && (player.inventory[player.equipment.weapon] ?? 0) < 1) player.equipment.weapon = null;
    if (player.equipment.armor && (player.inventory[player.equipment.armor] ?? 0) < 1) player.equipment.armor = null;
  }
  if (isRecord(value.flags)) {
    if (value.flags.beatXiangzhu === true) player.flags.beatXiangzhu = true;
    if (value.flags.postFightMarketDone === true) player.flags.postFightMarketDone = true;
    if (typeof value.flags.stanceId === 'string') player.flags.stanceId = value.flags.stanceId;
  }
  if (typeof value.stance === 'string') player.flags.stanceId = value.stance;
  if (player.board && isRecord(value.indices)) {
    for (const [id, index] of Object.entries(value.indices)) {
      const quote = player.board.quotes[id];
      if (quote && typeof index === 'number' && Number.isFinite(index)) quote.index = index;
    }
  }
  if (player.board && isRecord(value.volumeMul)) {
    for (const [id, volume] of Object.entries(value.volumeMul)) {
      const quote = player.board.quotes[id];
      if (quote && typeof volume === 'number' && Number.isFinite(volume)) quote.volumeMul = volume;
    }
  }
  if (player.board && typeof value.gang === 'string') player.board.gang = value.gang;
}

function hydrateBoard(config: ChapterConfig, value: unknown): BoardState | null {
  if (!isRecord(value) || value.opened !== true) return null;
  if (typeof value.gang !== 'string' || !value.gang) return null;
  if (!isRecord(value.quotes)) return null;
  const quotes: BoardState['quotes'] = {};
  for (const good of Object.values(config.goods)) {
    const quote = value.quotes[good.id];
    if (!isRecord(quote) || typeof quote.index !== 'number' || typeof quote.volumeMul !== 'number') return null;
    quotes[good.id] = { index: quote.index, volumeMul: quote.volumeMul };
  }
  const sellActions = typeof value.sellActions === 'number' && Number.isFinite(value.sellActions)
    ? Math.max(0, Math.floor(value.sellActions))
    : 0;
  return {
    opened: true,
    gang: value.gang,
    gangLabel: typeof value.gangLabel === 'string' ? value.gangLabel : value.gang,
    usingFallback: value.usingFallback === true,
    quotes,
    sellActions,
  };
}

function hydrateStubs(value: unknown): LootStub[] {
  if (!Array.isArray(value)) return [];
  const stubs: LootStub[] = [];
  for (const stub of value) {
    if (!isRecord(stub) || typeof stub.id !== 'string' || typeof stub.name !== 'string') continue;
    if (typeof stub.qty !== 'number' || typeof stub.sellable !== 'boolean') continue;
    stubs.push({ id: stub.id, name: stub.name, qty: Math.max(0, Math.floor(stub.qty)), sellable: stub.sellable });
  }
  return stubs;
}

function hydratePlayer(config: ChapterConfig, value: unknown): PlayerState | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== 'string' || !value.name.trim()) return null;
  if (typeof value.catchphrase !== 'string') return null;
  if (typeof value.cash !== 'number' || !Number.isFinite(value.cash)) return null;
  if (!isRecord(value.stats) || !isRecord(value.skill)) return null;

  const stats = { ...config.chargen.statPool.baseline };
  for (const key of Object.keys(stats)) {
    const stat = value.stats[key];
    if (typeof stat === 'number' && Number.isFinite(stat)) stats[key] = stat;
  }

  const inventory: Record<string, number> = {};
  const rawInventory = isRecord(value.inventory) ? value.inventory : {};
  for (const good of Object.values(config.goods)) {
    const qty = rawInventory[good.id];
    inventory[good.id] = typeof qty === 'number' && Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0;
  }

  const skill = value.skill;
  const effects: EffectSelection[] = [];
  if (Array.isArray(skill.effects)) {
    for (const effect of skill.effects) {
      if (!isRecord(effect) || typeof effect.op !== 'string' || typeof effect.value !== 'number') continue;
      effects.push({ op: effect.op, value: effect.value });
    }
  }

  const shopLv = typeof value.shopLv === 'number' && Number.isFinite(value.shopLv)
    ? value.shopLv
    : config.chapter.startShopLv;
  const slots = typeof value.slots === 'number' && Number.isFinite(value.slots)
    ? value.slots
    : shopLv >= config.chapter.endShopLv
      ? config.chapter.endSlots
      : config.chapter.startSlots;
  const settle = hydrateSettle(value.settle);

  const equipment = { weapon: null as string | null, armor: null as string | null };
  if (isRecord(value.equipment)) {
    if (typeof value.equipment.weapon === 'string') equipment.weapon = value.equipment.weapon;
    if (typeof value.equipment.armor === 'string') equipment.armor = value.equipment.armor;
  }
  if (equipment.weapon && (inventory[equipment.weapon] ?? 0) < 1) equipment.weapon = null;
  if (equipment.armor && (inventory[equipment.armor] ?? 0) < 1) equipment.armor = null;
  const rawFlags = isRecord(value.flags) ? value.flags : {};
  const flags = {
    beatXiangzhu: rawFlags.beatXiangzhu === true,
    postFightMarketDone: rawFlags.postFightMarketDone === true,
    stanceId: typeof rawFlags.stanceId === 'string' ? rawFlags.stanceId : null,
  };
  const board = hydrateBoard(config, value.board);
  const stubs = hydrateStubs(value.stubs);

  return {
    name: value.name.trim(),
    catchphrase: value.catchphrase.trim(),
    stats,
    cash: value.cash,
    shopLv,
    slots,
    inventory,
    equipment,
    flags,
    board,
    stubs,
    settle,
    skill: {
      name: typeof skill.name === 'string' ? skill.name : '',
      flavor: typeof skill.flavor === 'string' ? skill.flavor : '',
      trigger: typeof skill.trigger === 'string' ? skill.trigger : '',
      effects,
      powerScore: typeof skill.powerScore === 'number' && Number.isFinite(skill.powerScore) ? skill.powerScore : 0,
    },
  };
}
