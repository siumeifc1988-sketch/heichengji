export interface ChapterConfig {
  schemaVersion: number;
  chapter: {
    id: string;
    title: string;
    startShopLv: number;
    endShopLv: number;
    startSlots: number;
    endSlots: number;
    taxByShopLv: Record<string, number>;
  };
  currency: { id: string; label: string };
  prologue: { skippable: boolean; beats: string[] };
  chargen: {
    required: string[];
    statPool: {
      baseline: Record<string, number>;
      budgetPoints: number;
      hpPerPoint: number;
      clamps: Record<string, [number, number]>;
      forbid: ForbidRule[];
    };
    skill: {
      mode: string;
      maxEffects: number;
      maxPowerScore: number;
      triggers: string[];
      ops: Record<string, OpDef>;
    };
  };
  goods: Record<string, GoodDef>;
  enemies: Record<string, EnemyDef>;
  combat: CombatConfig;
  market: MarketConfig;
  postFightBlackMarket: PostFightBlackMarket;
  stance: StanceConfig;
  m3: M3Config;
  save: SaveConfig;
}

export interface M3Config {
  id: string;
  promotion: {
    fromShopLv: number;
    toShopLv: number;
    title: string;
    body: string;
  };
  settle: {
    autoRedeemAppliesToStock: boolean;
    showBeforeAfterCash: boolean;
  };
  /** 立場結算後的升舖正文。缺則用 promotion.body。 */
  promotionByStance?: Record<string, string>;
  chapterEnd: {
    xiangzhuRematch: boolean;
    actions: string[];
    closing?: string;
  };
}

export interface SaveConfig {
  schemaVersion: number;
  fields: string[];
}

export interface MarketConfig {
  boardId: string;
  label: string;
  priceFormula: string;
  taxApplies: boolean;
  volumeNote?: string;
  /** 市集目標句。旁白，不參與計價。 */
  objective?: string;
}

export interface GangRule {
  when: Record<string, number | boolean>;
  gang: string;
  label: string;
}

export interface MarketShock {
  indexDelta: Record<string, number>;
  volumeMul: Record<string, number>;
}

export interface LootStub {
  id: string;
  name: string;
  qty: number;
  sellable: boolean;
}

export interface PostFightBlackMarket {
  id: string;
  trigger: string;
  forceReturn: boolean;
  skipEndingUntil: string;
  title: string;
  body: string;
  gangResolve: {
    mode: string;
    note?: string;
    rules: GangRule[];
    fallbackGang: string;
  };
  onEnter: {
    applyIndexDelta: boolean;
    applyVolumeDelta: boolean;
    showDiffBanner: boolean;
  };
  shocks: { win: Record<string, MarketShock> };
  mustSell: {
    required: boolean;
    minSellActions: number;
    hint: string;
    unlockAction: string;
  };
  inventory: {
    preservePlayerStock: boolean;
    addWinLootStub: LootStub[];
  };
  /** 戰勝短句。不參與計價。 */
  winLine?: string;
}

export interface StanceChoice {
  id: string;
  label: string;
  sellMul: number;
  appliesTo: string[];
  indexDelta: Record<string, number>;
  note?: string;
}

export interface StanceConfig {
  afterPostFightMarket: boolean;
  choices: StanceChoice[];
  flow: string;
  note?: string;
}

export interface CombatConfig {
  hitFloor: number;
  hitCeil: number;
  guardDefBonus: number;
  critRateCap: number;
  critMulStack: string;
  requireItemToFight: string | null;
  warnIfNoWeapon: {
    itemId: string;
    title: string;
    body: string;
    confirmLabel: string;
    cancelLabel: string;
  };
  onDefeat: string;
  gameOver: {
    title: string;
    body: string;
    actions: string[];
  };
}

export interface GoodCombatUse {
  critRate?: number;
  critMul?: number;
  atkAdd?: number;
  maxPerBattle?: number;
  actionId?: string;
  actionLabel?: string;
  nextAttack?: { dmgAdd: number; hitAdd: number };
  consumeQty?: number;
  dodgeAdd?: number;
  infoRevealExtraLine?: boolean;
}

export interface GoodUse {
  type: string;
  requiredToFight?: boolean;
  combat?: GoodCombatUse;
  meta?: { holdQtyForIntelOption?: number; intelOptionId?: string };
  uiHint?: string;
}

export interface GoodDef {
  id: string;
  name: string;
  basePrice: number;
  index: number;
  slot?: string;
  stackable?: boolean;
  use?: GoodUse;
}

export interface OpDef {
  min: number;
  max: number;
  step?: number;
}

export interface ForbidRule {
  when: Record<string, number>;
  reason: string;
}

export interface EnemySkill {
  id: string;
  name: string;
  hpRatioTrigger: number;
  onTrigger: { def: number; spdMul: number; atkPerTurnBonus: number };
  reapStaysOn: boolean;
}

export interface EnemyDef {
  id: string;
  name: string;
  atk: number;
  def: number;
  hp: number;
  hit: number;
  spd: number;
  dodge: number;
  skill: EnemySkill;
  /** 開戰譏語。不參與公式。 */
  taunts?: string[];
}

export interface EquipmentState {
  weapon: string | null;
  armor: string | null;
}

export interface PlayerFlags {
  beatXiangzhu: boolean;
  postFightMarketDone: boolean;
  stanceId: string | null;
}

export interface RedeemLine {
  goodId: string;
  qty: number;
  unit: number;
}

export interface SettleRecord {
  choiceId: string;
  cashBefore: number;
  cashAfter: number;
  redeemed: RedeemLine[];
}

export interface BoardQuote {
  index: number;
  volumeMul: number;
}

export interface BoardState {
  opened: boolean;
  gang: string;
  gangLabel: string;
  usingFallback: boolean;
  quotes: Record<string, BoardQuote>;
  sellActions: number;
}

export interface EffectSelection {
  op: string;
  value: number;
}

export interface ChargenDraft {
  name: string;
  catchphrase: string;
  skillName: string;
  skillFlavor: string;
  skillTrigger: string;
  effects: EffectSelection[];
  stats: Record<string, number>;
}

export interface SkillState {
  name: string;
  flavor: string;
  trigger: string;
  effects: EffectSelection[];
  powerScore: number;
}

export interface PlayerState {
  name: string;
  catchphrase: string;
  stats: Record<string, number>;
  skill: SkillState;
  cash: number;
  shopLv: number;
  slots: number;
  inventory: Record<string, number>;
  equipment: EquipmentState;
  flags: PlayerFlags;
  board: BoardState | null;
  stubs: LootStub[];
  settle: SettleRecord | null;
}

export type ScreenId = 'prologue' | 'chargen' | 'market' | 'combat' | 'win' | 'gameover' | 'blackmarket' | 'stance' | 'done';

export type BattlePhase = 'player' | 'win' | 'lose';

export interface Fighter {
  name: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  hit: number;
  spd: number;
  dodge: number;
  guarding: boolean;
}

export interface BattleState {
  phase: BattlePhase;
  round: number;
  player: Fighter;
  enemy: Fighter;
  enemyId: string;
  log: string[];
  saltUses: number;
  saltReady: boolean;
  nextDmgMul: number | null;
  reflect: number;
  reap: boolean;
  lowHpFired: boolean;
  critRate: number;
  critMul: number;
  critSourceId: string | null;
  enemyBaseAtk: number;
  enemyBaseDef: number;
  enemyBaseSpd: number;
}

export interface AppState {
  screen: ScreenId;
  beat: number;
  draft: ChargenDraft;
  player: PlayerState | null;
  note: string;
  hasSave: boolean;
  warnFight: boolean;
  /** 對決畫面自動出攻擊。唔寫入存檔。 */
  autoFight: boolean;
  battle: BattleState | null;
  /** 開戰瞬間嘅庫存。幫派偏置用呢份，唔用打完之後嘅袋。 */
  preFightStock: Record<string, number> | null;
  /** null 代表跟 m3.settle.autoRedeemAppliesToStock。 */
  redeemStock: boolean | null;
}

export interface ChargenReport {
  issues: string[];
  valid: boolean;
  pointsSpent: number;
  pointsBudget: number;
  powerScore: number;
  powerMax: number;
  overBudget: boolean;
  overPower: boolean;
}

export interface TradeResult {
  ok: boolean;
  message: string;
}
