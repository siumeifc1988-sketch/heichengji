/**
 * Design-initial values that are intentionally absent from chapter1.json.
 * Documented in the README. Do not treat these as chapter data.
 */

/** 開局現金（文）。JSON 未定義本金。 */
export const DESIGN_INITIAL_CASH = 50;

/**
 * 灰模保底傷害。chapter1.json 冇寫最低傷害，只寫命中上下限同守勢加防。
 * 攻減防低過呢個數，仍然打出呢一點。
 */
export const DESIGN_MIN_DAMAGE = 1;

/**
 * 勝前黑市一手成交量。chapter1.json 只寫 shock 後嘅 volumeMul，冇寫基線。
 * 成交量低過呢一手，買唔入亦賣唔出。
 */
export const DESIGN_BASE_VOLUME = 1;

/** 市集看板存檔節點。 */
export const SAVE_NODE = 'OpenBoard';

export const SAVE_STORAGE_KEY = 'heichengji.m1.save';

export const SAVE_VERSION = 4;

/** 舊存檔仲讀得。章節 save.schemaVersion 維持 1，新欄位寫喺 fields。 */
export const SAVE_VERSIONS_ACCEPTED = [1, 2, 3, 4] as const;
