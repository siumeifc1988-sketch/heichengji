import { DESIGN_MIN_DAMAGE } from './design.ts';
import { formatNum } from './format.ts';
import { opLabel, triggerLabel } from './labels.ts';
import { findGood } from './rules.ts';
import type {
  BattleState,
  ChapterConfig,
  EffectSelection,
  EnemyDef,
  Fighter,
  GoodCombatUse,
  GoodDef,
  PlayerState,
} from './types.ts';

/** 命中＝攻方命中 − 守方閃避，再壓入 combat.hitFloor / hitCeil。JSON 冇另一條公式。 */
export type Rng = () => number;

export interface CritOffer {
  rate: number;
  mul: number;
  sourceId: string;
}

export interface SaltAction {
  good: GoodDef;
  label: string;
  maxPerBattle: number;
  consumeQty: number;
  dmgAdd: number;
  hitAdd: number;
}

export function primaryEnemy(config: ChapterConfig): EnemyDef {
  const enemy = Object.values(config.enemies)[0];
  if (!enemy) throw new Error('冇敵人');
  return enemy;
}

export function hitChance(hit: number, dodge: number, config: ChapterConfig): number {
  const raw = hit - dodge;
  return Math.min(config.combat.hitCeil, Math.max(config.combat.hitFloor, raw));
}

export function rawDamage(atk: number, def: number): number {
  return Math.max(DESIGN_MIN_DAMAGE, atk - def);
}

/** 爆擊只睇裝備。critMulStack = max_one_equip 時只取一件（倍率最高）再封頂 critRateCap。 */
export function critOffer(config: ChapterConfig, player: PlayerState): CritOffer | null {
  const ids = [player.equipment.weapon, player.equipment.armor].filter((id): id is string => Boolean(id));
  const offers: CritOffer[] = [];
  for (const id of ids) {
    const combat = findGood(config, id)?.use?.combat;
    if (!combat || typeof combat.critRate !== 'number' || typeof combat.critMul !== 'number') continue;
    offers.push({ rate: combat.critRate, mul: combat.critMul, sourceId: id });
  }
  if (offers.length === 0) return null;
  const best = config.combat.critMulStack === 'max_one_equip'
    ? offers.reduce((top, item) => (item.mul > top.mul ? item : top))
    : offers[0];
  if (!best) return null;
  return { ...best, rate: Math.min(best.rate, config.combat.critRateCap) };
}

export function saltAction(config: ChapterConfig): SaltAction | null {
  for (const good of Object.values(config.goods)) {
    const combat = good.use?.combat;
    const next = combat?.nextAttack;
    if (good.use?.type !== 'consumable' || !combat?.actionLabel || !next) continue;
    return {
      good,
      label: combat.actionLabel,
      maxPerBattle: combat.maxPerBattle ?? 1,
      consumeQty: combat.consumeQty ?? 1,
      dmgAdd: next.dmgAdd,
      hitAdd: next.hitAdd,
    };
  }
  return null;
}

export function createBattle(config: ChapterConfig, player: PlayerState): BattleState {
  const enemyDef = primaryEnemy(config);
  const crit = critOffer(config, player);
  const playerFighter = fighterFromStats(player.name, player.stats);
  const enemy = fighterFromStats(enemyDef.name, enemyDef);
  applyGear(config, player, playerFighter);

  const battle: BattleState = {
    phase: 'player',
    round: 0,
    player: playerFighter,
    enemy,
    enemyId: enemyDef.id,
    log: [],
    saltUses: 0,
    saltReady: false,
    nextDmgMul: null,
    reflect: 0,
    reap: false,
    lowHpFired: false,
    critRate: crit?.rate ?? 0,
    critMul: crit?.mul ?? 1,
    critSourceId: crit?.sourceId ?? null,
    enemyBaseAtk: enemy.atk,
    enemyBaseDef: enemy.def,
    enemyBaseSpd: enemy.spd,
  };

  const rules = config.combat;
  battle.log.push(
    `對決開始。命中壓喺 ${formatNum(rules.hitFloor)} 至 ${formatNum(rules.hitCeil)}。守勢加 ${formatNum(rules.guardDefBonus)} 防禦。`,
  );
  const cloth = equippedCloth(config, player);
  if (cloth?.combat?.dodgeAdd) {
    battle.log.push(`裝備${cloth.good.name}：閃避 +${formatNum(cloth.combat.dodgeAdd)}。`);
  }
  if (cloth?.combat?.infoRevealExtraLine) battle.log.push(clothHint(enemyDef));
  if (crit) {
    const name = findGood(config, crit.sourceId)?.name ?? crit.sourceId;
    battle.log.push(`裝備${name}：爆擊率 ${formatNum(crit.rate)}，倍率 ${formatNum(crit.mul)}。`);
  }
  if (player.skill.trigger === 'on_battle_start') applySkill(battle, config, player, '開戰');
  beginPlayerPhase(battle, config, player);
  return battle;
}

export function playerAction(
  battle: BattleState,
  config: ChapterConfig,
  player: PlayerState,
  action: 'attack' | 'guard' | 'skill' | 'salt',
  rng: Rng,
): void {
  if (battle.phase !== 'player') return;
  if (action === 'salt') {
    useSalt(battle, config, player);
    return;
  }
  if (action === 'guard') {
    battle.player.guarding = true;
    battle.log.push(`你擺守勢，下一記實招防禦 +${formatNum(config.combat.guardDefBonus)}。`);
    if (player.skill.trigger === 'on_guard') applySkill(battle, config, player, '守勢');
  } else if (action === 'skill') {
    applySkill(battle, config, player, '你掀招');
    if (player.skill.trigger === 'on_attack') strike(battle, config, player, 'player', rng);
    if (player.skill.trigger === 'on_guard') {
      battle.player.guarding = true;
      battle.log.push(`招式帶守，防禦 +${formatNum(config.combat.guardDefBonus)}。`);
    }
  } else {
    if (player.skill.trigger === 'on_attack') applySkill(battle, config, player, '攻擊');
    strike(battle, config, player, 'player', rng);
  }
  if (battle.phase !== 'player') return;
  if (battle.enemy.hp <= 0) {
    finish(battle, 'win');
    return;
  }
  enemyTurn(battle, config, player, rng);
}

function beginPlayerPhase(battle: BattleState, config: ChapterConfig, player: PlayerState): void {
  battle.phase = 'player';
  battle.round += 1;
  battle.log.push(`—— 第 ${battle.round} 回合 ——`);
  if (player.skill.trigger === 'on_turn_start') applySkill(battle, config, player, '回合開始');
}

function enemyTurn(battle: BattleState, config: ChapterConfig, player: PlayerState, rng: Rng): void {
  const enemyDef = primaryEnemy(config);
  const skill = enemyDef.skill;
  const ratio = battle.enemy.hp / battle.enemy.maxHp;
  if (!battle.reap && ratio <= skill.hpRatioTrigger) {
    battle.reap = true;
    battle.enemy.def = skill.onTrigger.def;
    battle.enemy.spd = battle.enemyBaseSpd * skill.onTrigger.spdMul;
    battle.log.push(
      `${enemyDef.name}發動「${skill.name}」。防禦變 ${formatNum(skill.onTrigger.def)}，速度 ×${formatNum(skill.onTrigger.spdMul)}。`,
    );
    if (player.skill.trigger === 'on_enemy_reap') applySkill(battle, config, player, '敵方收割');
  }
  if (battle.reap) {
    battle.enemy.atk += skill.onTrigger.atkPerTurnBonus;
    battle.log.push(
      `收割未停，攻擊 +${formatNum(skill.onTrigger.atkPerTurnBonus)}，而家 ${formatNum(battle.enemy.atk)}。`,
    );
  }
  strike(battle, config, player, 'enemy', rng);
  if (!skill.reapStaysOn && battle.reap) {
    battle.reap = false;
    battle.enemy.def = battle.enemyBaseDef;
    battle.enemy.spd = battle.enemyBaseSpd;
    battle.enemy.atk = battle.enemyBaseAtk;
    battle.log.push('收割過去，香主回復原狀。');
  }
  if (battle.player.hp <= 0) {
    finish(battle, 'lose');
    return;
  }
  if (battle.enemy.hp <= 0) {
    finish(battle, 'win');
    return;
  }
  beginPlayerPhase(battle, config, player);
}

function finish(battle: BattleState, phase: 'win' | 'lose'): void {
  battle.phase = phase;
  battle.log.push(phase === 'win' ? `${battle.enemy.name}倒下。` : '你倒地。');
}

function strike(
  battle: BattleState,
  config: ChapterConfig,
  player: PlayerState,
  side: 'player' | 'enemy',
  rng: Rng,
): void {
  const attacker = side === 'player' ? battle.player : battle.enemy;
  const defender = side === 'player' ? battle.enemy : battle.player;
  const salt = side === 'player' && battle.saltReady ? saltAction(config) : null;
  const hitAdd = salt?.hitAdd ?? 0;
  const chance = hitChance(attacker.hit + hitAdd, defender.dodge, config);
  const roll = rng() * 100;
  const subject = side === 'player' ? '你' : attacker.name;
  if (roll >= chance) {
    battle.log.push(`${subject}打唔中。命中線 ${formatNum(chance)}，擲出 ${formatNum(roll)}。`);
    if (salt) {
      battle.saltReady = false;
      battle.log.push('抹刀落空，加成果消。');
    }
    return;
  }

  const guardBonus = defender.guarding ? config.combat.guardDefBonus : 0;
  if (defender.guarding) defender.guarding = false;
  let damage = rawDamage(attacker.atk, defender.def + guardBonus);
  if (side === 'player' && battle.nextDmgMul !== null) {
    damage = Math.max(DESIGN_MIN_DAMAGE, Math.round(damage * battle.nextDmgMul));
    battle.log.push(`倍率 ×${formatNum(battle.nextDmgMul)}，傷害 ${formatNum(damage)}。`);
    battle.nextDmgMul = null;
  }
  let crit = false;
  if (side === 'player' && battle.critSourceId && rng() * 100 < battle.critRate) {
    crit = true;
    damage = Math.max(DESIGN_MIN_DAMAGE, Math.round(damage * battle.critMul));
  }
  if (salt) {
    damage += salt.dmgAdd;
    battle.saltReady = false;
  }
  damage = Math.max(DESIGN_MIN_DAMAGE, damage);
  defender.hp = Math.max(0, defender.hp - damage);

  const weapon = battle.critSourceId ? findGood(config, battle.critSourceId)?.name : '';
  if (crit) {
    battle.log.push(`爆擊（${weapon} ×${formatNum(battle.critMul)}）${salt ? `，抹刀 +${formatNum(salt.dmgAdd)}` : ''}，傷害 ${formatNum(damage)}。`);
  } else if (salt) {
    battle.log.push(`打中，抹刀 +${formatNum(salt.dmgAdd)}，傷害 ${formatNum(damage)}。`);
  } else {
    battle.log.push(`${subject}打中，傷害 ${formatNum(damage)}。`);
  }

  if (side === 'enemy' && battle.reflect > 0 && battle.enemy.hp > 0) {
    battle.enemy.hp = Math.max(0, battle.enemy.hp - battle.reflect);
    battle.log.push(`反傷 ${formatNum(battle.reflect)}。`);
  }
  if (side === 'enemy' && battle.player.hp > 0) afterPlayerHurt(battle, config, player);
}

function afterPlayerHurt(battle: BattleState, config: ChapterConfig, player: PlayerState): void {
  if (player.skill.trigger === 'on_hit_taken') applySkill(battle, config, player, '受擊');
  const ratio = lowHpRatio(player.skill.trigger);
  if (ratio !== null && !battle.lowHpFired && battle.player.hp / battle.player.maxHp <= ratio) {
    battle.lowHpFired = true;
    applySkill(battle, config, player, '氣血告急');
  }
}

function useSalt(battle: BattleState, config: ChapterConfig, player: PlayerState): void {
  const salt = saltAction(config);
  if (!salt) {
    battle.log.push('冇可抹嘅鹽。');
    return;
  }
  if (battle.saltUses >= salt.maxPerBattle) {
    battle.log.push(`${salt.label}呢場用過，唔可以再抹。`);
    return;
  }
  const qty = player.inventory[salt.good.id] ?? 0;
  if (qty < salt.consumeQty) {
    battle.log.push(`冇${salt.good.name}可抹。`);
    return;
  }
  player.inventory[salt.good.id] = qty - salt.consumeQty;
  battle.saltUses += 1;
  battle.saltReady = true;
  battle.log.push(
    `${salt.label}：下一擊傷害 +${formatNum(salt.dmgAdd)}、命中 +${formatNum(salt.hitAdd)}。用咗 ${formatNum(salt.consumeQty)} ${salt.good.name}。`,
  );
}

function applyGear(config: ChapterConfig, player: PlayerState, fighter: Fighter): void {
  const weapon = player.equipment.weapon ? findGood(config, player.equipment.weapon) : undefined;
  const atkAdd = weapon?.use?.combat?.atkAdd;
  if (typeof atkAdd === 'number') fighter.atk += atkAdd;
  const cloth = equippedCloth(config, player);
  const dodgeAdd = cloth?.combat?.dodgeAdd;
  if (typeof dodgeAdd === 'number') fighter.dodge += dodgeAdd;
}

function equippedCloth(config: ChapterConfig, player: PlayerState): { good: GoodDef; combat: GoodCombatUse } | null {
  const id = player.equipment.armor;
  if (!id) return null;
  const good = findGood(config, id);
  const combat = good?.use?.combat;
  if (!good || !combat) return null;
  if (typeof combat.dodgeAdd !== 'number' && !combat.infoRevealExtraLine) return null;
  return { good, combat };
}

function clothHint(enemy: EnemyDef): string {
  const skill = enemy.skill;
  return `布衣多一眼：${enemy.name}「${skill.name}」發動後防禦 ${formatNum(skill.onTrigger.def)}、速度 ×${formatNum(skill.onTrigger.spdMul)}、每回合攻擊 +${formatNum(skill.onTrigger.atkPerTurnBonus)}。`;
}

function applySkill(battle: BattleState, config: ChapterConfig, player: PlayerState, reason: string): void {
  const skill = player.skill;
  battle.log.push(`「${skill.name}」(${triggerLabel(skill.trigger)}，${reason})。`);
  for (const effect of skill.effects) applyOp(battle, config, effect);
}

function applyOp(battle: BattleState, config: ChapterConfig, effect: EffectSelection): void {
  const { op, value } = effect;
  switch (op) {
    case 'self_atk_add':
      battle.player.atk += value;
      battle.log.push(`${opLabel(op)} +${formatNum(value)}，攻擊 ${formatNum(battle.player.atk)}。`);
      return;
    case 'self_def_add':
      battle.player.def += value;
      battle.log.push(`${opLabel(op)} +${formatNum(value)}，防禦 ${formatNum(battle.player.def)}。`);
      return;
    case 'self_hit_add':
      battle.player.hit += value;
      battle.log.push(`${opLabel(op)} +${formatNum(value)}。`);
      return;
    case 'self_dodge_add':
      battle.player.dodge += value;
      battle.log.push(`${opLabel(op)} +${formatNum(value)}。`);
      return;
    case 'self_heal':
      battle.player.hp = Math.min(battle.player.maxHp, battle.player.hp + value);
      battle.log.push(`回復 ${formatNum(value)}，氣血 ${formatNum(battle.player.hp)}。`);
      return;
    case 'enemy_def_add':
      battle.enemy.def += value;
      battle.log.push(`${opLabel(op)} ${formatNum(value)}，對方防禦 ${formatNum(battle.enemy.def)}。`);
      return;
    case 'dmg_mul_next':
      battle.nextDmgMul = value;
      battle.log.push(`下一擊倍率 ×${formatNum(value)}。`);
      return;
    case 'reflect_flat':
      battle.reflect += value;
      battle.log.push(`反傷累計 ${formatNum(battle.reflect)}。`);
      return;
    case 'info_reveal':
      battle.log.push(infoLine(primaryEnemy(config)));
      return;
    default:
      battle.log.push(`未知效果 ${op}。`);
  }
}

function infoLine(enemy: EnemyDef): string {
  return `情報：${enemy.name}氣血比例 ≤ ${formatNum(enemy.skill.hpRatioTrigger)} 會發動「${enemy.skill.name}」。`;
}

function lowHpRatio(trigger: string): number | null {
  const match = /^on_hp_below_(\d+)$/.exec(trigger);
  if (!match?.[1]) return null;
  return Number(match[1]) / 100;
}

function fighterFromStats(
  name: string,
  stats: { atk: number; def: number; hp: number; hit: number; spd: number; dodge: number } | Record<string, number>,
): Fighter {
  const bag = stats as Record<string, number>;
  const n = (key: string) => bag[key] ?? 0;
  const hp = n('hp');
  return {
    name,
    hp,
    maxHp: hp,
    atk: n('atk'),
    def: n('def'),
    hit: n('hit'),
    spd: n('spd'),
    dodge: n('dodge'),
    guarding: false,
  };
}
