import type { ScreenId } from './types.ts';

export const SCREEN_LABEL: Record<ScreenId, string> = {
  prologue: '序幕',
  chargen: '開檔',
  market: '市集',
  combat: '對決',
  win: '戰勝',
  gameover: '完局',
  blackmarket: '黑市',
  stance: '立場',
  done: '收秤',
};

const STAT_LABEL: Record<string, string> = {
  atk: '攻擊',
  def: '防禦',
  hp: '氣血',
  hit: '命中',
  spd: '速度',
  dodge: '閃避',
};

const TRIGGER_LABEL: Record<string, string> = {
  on_battle_start: '開戰時',
  on_turn_start: '回合開始',
  on_attack: '我方攻擊時',
  on_guard: '我方守勢時',
  on_hit_taken: '我方受擊時',
  on_hp_below_30: '我方氣血低於三成',
  on_enemy_reap: '敵方發動收割時',
};

const OP_LABEL: Record<string, string> = {
  self_atk_add: '自身攻擊上升',
  self_def_add: '自身防禦上升',
  self_hit_add: '自身命中上升',
  self_dodge_add: '自身閃避上升',
  self_heal: '自身回復氣血',
  enemy_def_add: '敵方防禦下降',
  dmg_mul_next: '下次傷害倍率',
  reflect_flat: '固定反傷',
  info_reveal: '揭示情報',
};

export function statLabel(key: string): string {
  return STAT_LABEL[key] ?? key;
}

export function triggerLabel(key: string): string {
  return TRIGGER_LABEL[key] ?? key;
}

export function opLabel(key: string): string {
  return OP_LABEL[key] ?? key;
}
