/**
 * AI Agent UFC — Combat Rules
 *
 * All damage formulas, accuracy calculations, stamina costs,
 * and combat resolution logic lives here.
 * Uses BALANCE config for all numbers — nothing hardcoded.
 */

import { BALANCE } from './config';
import { SeededRNG } from './rng';
import {
  Action,
  ActionType,
  FighterState,
  StyleTemplate,
  TurnEvent,
} from './types';

// === Style Modifiers ===

export interface StyleModifiers {
  power: number;
  defense: number;
  speed: number;
  staminaRate: number;
}

export function getStyleModifiers(style: StyleTemplate): StyleModifiers {
  return BALANCE.styles[style];
}

// === Stamina ===

export function getStaminaCost(action: Action, style: StyleTemplate): number {
  const base = BALANCE.actions[action.type as keyof typeof BALANCE.actions];
  if (!base) return 0;
  const mods = getStyleModifiers(style);
  const cost = base.staminaCost * mods.staminaRate;
  // Guard has negative cost (recovery), don't modify sign
  if (action.type === 'guard') {
    return base.staminaCost; // flat recovery, not style-scaled
  }
  // Power slider increases stamina cost for attacks
  if ('power' in action) {
    return Math.round(cost * (0.8 + 0.4 * action.power));
  }
  return Math.round(cost);
}

export function canAffordAction(stamina: number, action: Action, style: StyleTemplate): boolean {
  const cost = getStaminaCost(action, style);
  // Negative cost = recovery, always affordable
  if (cost <= 0) return true;
  return stamina >= cost;
}

// === Accuracy ===

export function getAccuracy(
  action: Action,
  attackerStyle: StyleTemplate,
  defenderGuarding: boolean,
): number {
  const base = BALANCE.actions[action.type as keyof typeof BALANCE.actions];
  if (!base) return 1.0;
  const mods = getStyleModifiers(attackerStyle);
  let accuracy = base.accuracy * mods.speed;
  // Guarding defender is harder to hit cleanly (but doesn't prevent hits)
  if (defenderGuarding) {
    accuracy *= 0.85;
  }
  return Math.min(accuracy, 0.99); // cap at 99%
}

export function rollAccuracy(
  rng: SeededRNG,
  action: Action,
  attackerStyle: StyleTemplate,
  defenderGuarding: boolean,
): boolean {
  const accuracy = getAccuracy(action, attackerStyle, defenderGuarding);
  return rng.chance(accuracy);
}

// === Damage ===

export function calculateBaseDamage(
  rng: SeededRNG,
  action: Action,
  attackerStyle: StyleTemplate,
): number {
  const base = BALANCE.actions[action.type as keyof typeof BALANCE.actions];
  if (!base || (base.baseDamage[0] === 0 && base.baseDamage[1] === 0)) return 0;

  const mods = getStyleModifiers(attackerStyle);
  const [min, max] = base.baseDamage;
  const rawDamage = rng.nextFloat(min, max);

  // Power slider scales damage
  const powerMul = 'power' in action ? (0.7 + 0.6 * action.power) : 1.0;

  return Math.round(rawDamage * mods.power * powerMul);
}

export function applyGuardReduction(damage: number, guardIntensity: number): number {
  const reduction = BALANCE.guardBlockReduction * guardIntensity;
  return Math.round(damage * (1 - reduction));
}

// === Balance Damage ===

export function getBalanceDamage(action: Action, attackerStyle: StyleTemplate): number {
  const base = BALANCE.actions[action.type as keyof typeof BALANCE.actions];
  if (!base) return 0;
  const mods = getStyleModifiers(attackerStyle);
  const powerMul = 'power' in action ? (0.8 + 0.4 * action.power) : 1.0;
  return Math.round(base.balanceDamage * mods.power * powerMul);
}

// === Guard Drain ===

export function getGuardDrain(action: Action): number {
  // Only attacks drain guard
  if (action.type === 'guard' || action.type === 'move') return 0;
  const powerMul = 'power' in action ? (0.8 + 0.4 * action.power) : 1.0;
  return Math.round(BALANCE.guardDrainOnBlock * powerMul);
}

// === Per-Turn Regeneration ===

export function applyRegen(state: FighterState): FighterState {
  return {
    ...state,
    stamina: Math.min(state.stamina + BALANCE.staminaRegen, BALANCE.maxStamina),
    guard: Math.min(state.guard + BALANCE.guardRegen, BALANCE.maxGuard),
    balance: Math.min(state.balance + BALANCE.balanceRegen, BALANCE.maxBalance),
  };
}

// === Distance ===

export function getDistance(
  posA: { x: number; y: number },
  posB: { x: number; y: number },
): number {
  const dx = posA.x - posB.x;
  const dy = posA.y - posB.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Max range for an attack to connect */
export function getAttackRange(action: Action): number {
  switch (action.type) {
    case 'strike': return 1.5;
    case 'hook': return 1.3;
    case 'kick': return 2.0;
    case 'special': return 2.5;
    default: return 0;
  }
}

export function isInRange(
  posA: { x: number; y: number },
  posB: { x: number; y: number },
  action: Action,
): boolean {
  if (action.type === 'guard' || action.type === 'move') return true;
  return getDistance(posA, posB) <= getAttackRange(action);
}

// === Cooldowns ===

export function isOnCooldown(state: FighterState, action: Action): boolean {
  if (action.type !== 'special') return false;
  return (state.cooldowns['special'] ?? 0) > 0;
}

export function tickCooldowns(cooldowns: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(cooldowns)) {
    if (val > 1) result[key] = val - 1;
    // Drop entries that reach 0
  }
  return result;
}

export function applyCooldown(cooldowns: Record<string, number>, action: Action): Record<string, number> {
  if (action.type !== 'special') return cooldowns;
  return { ...cooldowns, special: BALANCE.specialCooldown };
}

// === Knockdown Check ===

export function checkKnockdown(balance: number): boolean {
  return balance <= BALANCE.knockdownBalanceThreshold;
}

// === Win Condition Helpers ===

export function checkKo(hp: number): boolean {
  return hp <= 0;
}

export function checkTko(knockdowns: number): boolean {
  return knockdowns >= BALANCE.knockdownsForTko;
}

// === Resolve a Single Attack ===

export interface AttackResult {
  damage: number;
  blocked: boolean;
  missed: boolean;
  outOfRange: boolean;
  balanceDamage: number;
  guardDrain: number;
  events: TurnEvent[];
}

export function resolveAttack(
  rng: SeededRNG,
  action: Action,
  attackerStyle: StyleTemplate,
  defenderState: FighterState,
  defenderGuarding: boolean,
  attackerPos: { x: number; y: number },
  defenderPos: { x: number; y: number },
  source: 'A' | 'B',
  target: 'A' | 'B',
): AttackResult {
  const events: TurnEvent[] = [];

  // Non-attack actions produce no attack result
  if (action.type === 'guard' || action.type === 'move') {
    return { damage: 0, blocked: false, missed: false, outOfRange: false, balanceDamage: 0, guardDrain: 0, events };
  }

  // Range check
  if (!isInRange(attackerPos, defenderPos, action)) {
    events.push({ type: 'miss', source, target, detail: 'out_of_range' });
    return { damage: 0, blocked: false, missed: true, outOfRange: true, balanceDamage: 0, guardDrain: 0, events };
  }

  // Accuracy roll
  if (!rollAccuracy(rng, action, attackerStyle, defenderGuarding)) {
    events.push({ type: 'miss', source, target });
    return { damage: 0, blocked: false, missed: true, outOfRange: false, balanceDamage: 0, guardDrain: 0, events };
  }

  // Calculate damage
  let damage = calculateBaseDamage(rng, action, attackerStyle);
  let balanceDamage = getBalanceDamage(action, attackerStyle);
  let guardDrain = 0;
  let blocked = false;

  // Guard reduction
  if (defenderGuarding && defenderState.guard > 0) {
    const guardAction = { type: 'guard' as const, level: 'high' as const, intensity: 1.0 };
    damage = applyGuardReduction(damage, 1.0);
    balanceDamage = Math.round(balanceDamage * 0.5);
    guardDrain = getGuardDrain(action);
    blocked = true;
    events.push({ type: 'block', source: target, target: source, value: guardDrain });
  }

  if (damage > 0) {
    events.push({ type: 'damage', source, target, value: damage });
  }

  return { damage, blocked, missed: false, outOfRange: false, balanceDamage, guardDrain, events };
}
