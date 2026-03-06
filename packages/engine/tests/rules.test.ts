import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/rng';
import { BALANCE } from '../src/config';
import {
  getStaminaCost,
  canAffordAction,
  calculateBaseDamage,
  applyGuardReduction,
  getBalanceDamage,
  applyRegen,
  isInRange,
  getStyleModifiers,
  checkKo,
  checkTko,
  checkKnockdown,
  tickCooldowns,
  applyCooldown,
  resolveAttack,
} from '../src/rules';
import { Action, FighterState } from '../src/types';

function freshState(): FighterState {
  return {
    hp: BALANCE.maxHp,
    stamina: BALANCE.maxStamina,
    guard: BALANCE.maxGuard,
    balance: BALANCE.maxBalance,
    position: { x: 5, y: 5 },
    cooldowns: {},
    statusEffects: [],
    knockdowns: 0,
  };
}

describe('Rules — Stamina', () => {
  it('strike costs stamina based on config', () => {
    const action: Action = { type: 'strike', variant: 'jab', target: 'head', power: 0.5 };
    const cost = getStaminaCost(action, 'adaptive');
    expect(cost).toBeGreaterThan(0);
  });

  it('guard has negative/zero cost (recovery)', () => {
    const action: Action = { type: 'guard', level: 'high', intensity: 0.8 };
    const cost = getStaminaCost(action, 'adaptive');
    expect(cost).toBeLessThanOrEqual(0);
  });

  it('canAffordAction returns false when stamina too low', () => {
    const action: Action = { type: 'special', name: 'test', power: 1.0 };
    expect(canAffordAction(1, action, 'adaptive')).toBe(false);
  });

  it('canAffordAction returns true for guard at any stamina', () => {
    const action: Action = { type: 'guard', level: 'high', intensity: 1.0 };
    expect(canAffordAction(0, action, 'adaptive')).toBe(true);
  });

  it('higher power increases stamina cost', () => {
    const lowPower: Action = { type: 'hook', target: 'head', power: 0.2 };
    const highPower: Action = { type: 'hook', target: 'head', power: 1.0 };
    expect(getStaminaCost(highPower, 'adaptive')).toBeGreaterThan(getStaminaCost(lowPower, 'adaptive'));
  });
});

describe('Rules — Damage', () => {
  it('calculateBaseDamage returns positive for attacks', () => {
    const rng = new SeededRNG(42);
    const action: Action = { type: 'strike', variant: 'jab', target: 'head', power: 0.8 };
    const damage = calculateBaseDamage(rng, action, 'adaptive');
    expect(damage).toBeGreaterThan(0);
  });

  it('calculateBaseDamage returns 0 for guard', () => {
    const rng = new SeededRNG(42);
    const action: Action = { type: 'guard', level: 'high', intensity: 0.8 };
    const damage = calculateBaseDamage(rng, action, 'adaptive');
    expect(damage).toBe(0);
  });

  it('guard reduction reduces damage', () => {
    const original = 20;
    const reduced = applyGuardReduction(original, 1.0);
    expect(reduced).toBeLessThan(original);
    expect(reduced).toBeGreaterThan(0);
  });

  it('aggro style increases damage', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);
    const action: Action = { type: 'hook', target: 'head', power: 0.8 };
    const dmgAggro = calculateBaseDamage(rng1, action, 'aggro');
    const dmgAdaptive = calculateBaseDamage(rng2, action, 'adaptive');
    expect(dmgAggro).toBeGreaterThanOrEqual(dmgAdaptive);
  });
});

describe('Rules — Balance & Knockdowns', () => {
  it('getBalanceDamage returns positive for attacks', () => {
    const action: Action = { type: 'hook', target: 'head', power: 0.8 };
    expect(getBalanceDamage(action, 'adaptive')).toBeGreaterThan(0);
  });

  it('checkKnockdown triggers at 0 balance', () => {
    expect(checkKnockdown(0)).toBe(true);
    expect(checkKnockdown(50)).toBe(false);
  });

  it('checkKo triggers at 0 hp', () => {
    expect(checkKo(0)).toBe(true);
    expect(checkKo(1)).toBe(false);
  });

  it('checkTko triggers at 3 knockdowns', () => {
    expect(checkTko(3)).toBe(true);
    expect(checkTko(2)).toBe(false);
  });
});

describe('Rules — Regen', () => {
  it('applyRegen restores stamina, guard, balance', () => {
    const state = freshState();
    state.stamina = 50;
    state.guard = 50;
    state.balance = 50;
    const after = applyRegen(state);
    expect(after.stamina).toBeGreaterThan(50);
    expect(after.guard).toBeGreaterThan(50);
    expect(after.balance).toBeGreaterThan(50);
  });

  it('regen does not exceed max values', () => {
    const state = freshState(); // already at max
    const after = applyRegen(state);
    expect(after.stamina).toBe(BALANCE.maxStamina);
    expect(after.guard).toBe(BALANCE.maxGuard);
    expect(after.balance).toBe(BALANCE.maxBalance);
  });
});

describe('Rules — Range', () => {
  it('strike is in range when close', () => {
    const action: Action = { type: 'strike', variant: 'jab', target: 'head', power: 0.5 };
    expect(isInRange({ x: 5, y: 5 }, { x: 5.5, y: 5 }, action)).toBe(true);
  });

  it('strike is out of range when far', () => {
    const action: Action = { type: 'strike', variant: 'jab', target: 'head', power: 0.5 };
    expect(isInRange({ x: 0, y: 0 }, { x: 9, y: 9 }, action)).toBe(false);
  });

  it('guard is always in range', () => {
    const action: Action = { type: 'guard', level: 'high', intensity: 0.5 };
    expect(isInRange({ x: 0, y: 0 }, { x: 100, y: 100 }, action)).toBe(true);
  });
});

describe('Rules — Cooldowns', () => {
  it('tickCooldowns decrements values', () => {
    const result = tickCooldowns({ special: 3, other: 1 });
    expect(result.special).toBe(2);
    expect(result.other).toBeUndefined(); // dropped at 0
  });

  it('applyCooldown sets cooldown for special', () => {
    const action: Action = { type: 'special', name: 'test', power: 0.5 };
    const result = applyCooldown({}, action);
    expect(result.special).toBe(BALANCE.specialCooldown);
  });

  it('applyCooldown does nothing for non-special', () => {
    const action: Action = { type: 'strike', variant: 'jab', target: 'head', power: 0.5 };
    const result = applyCooldown({}, action);
    expect(result.special).toBeUndefined();
  });
});

describe('Rules — Style Modifiers', () => {
  it('aggro has high power, low defense', () => {
    const mods = getStyleModifiers('aggro');
    expect(mods.power).toBeGreaterThan(1);
    expect(mods.defense).toBeLessThan(1);
  });

  it('adaptive is neutral (all 1.0)', () => {
    const mods = getStyleModifiers('adaptive');
    expect(mods.power).toBe(1.0);
    expect(mods.defense).toBe(1.0);
    expect(mods.speed).toBe(1.0);
    expect(mods.staminaRate).toBe(1.0);
  });
});
