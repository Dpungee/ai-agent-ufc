import { describe, it, expect } from 'vitest';
import { validateAction, defaultAction } from '../src/validator';
import { FighterState } from '../src/types';
import { BALANCE } from '../src/config';

function createFreshState(): FighterState {
  return {
    hp: BALANCE.maxHp,
    stamina: BALANCE.maxStamina,
    guard: BALANCE.maxGuard,
    balance: BALANCE.maxBalance,
    position: { x: 2.5, y: 5 },
    cooldowns: {},
    statusEffects: [],
    knockdowns: 0,
  };
}

describe('Validator', () => {
  it('accepts a valid strike action', () => {
    const state = createFreshState();
    const action = { type: 'strike', variant: 'jab', target: 'head', power: 0.5 };
    const result = validateAction(action, state, 'adaptive', 'A');
    expect(result.wasModified).toBe(false);
    expect(result.action.type).toBe('strike');
  });

  it('accepts a valid guard action', () => {
    const state = createFreshState();
    const action = { type: 'guard', level: 'high', intensity: 0.8 };
    const result = validateAction(action, state, 'adaptive', 'A');
    expect(result.wasModified).toBe(false);
    expect(result.action.type).toBe('guard');
  });

  it('rejects null action and returns default guard', () => {
    const state = createFreshState();
    const result = validateAction(null, state, 'adaptive', 'A');
    expect(result.wasModified).toBe(true);
    expect(result.action.type).toBe('guard');
    expect(result.reason).toBe('action_null_or_invalid');
  });

  it('rejects undefined action', () => {
    const state = createFreshState();
    const result = validateAction(undefined, state, 'adaptive', 'A');
    expect(result.wasModified).toBe(true);
  });

  it('rejects invalid action type', () => {
    const state = createFreshState();
    const result = validateAction({ type: 'teleport' }, state, 'adaptive', 'A');
    expect(result.wasModified).toBe(true);
    expect(result.reason).toBe('invalid_action_type');
  });

  it('clamps power to [0, 1]', () => {
    const state = createFreshState();
    const result = validateAction({ type: 'strike', variant: 'jab', target: 'head', power: 5.0 }, state, 'adaptive', 'A');
    expect(result.wasModified).toBe(false);
    const action = result.action as { power: number };
    expect(action.power).toBeLessThanOrEqual(1);
  });

  it('clamps negative power to 0', () => {
    const state = createFreshState();
    const result = validateAction({ type: 'hook', target: 'head', power: -2 }, state, 'adaptive', 'A');
    const action = result.action as { power: number };
    expect(action.power).toBeGreaterThanOrEqual(0);
  });

  it('defaults invalid target to body', () => {
    const state = createFreshState();
    const result = validateAction({ type: 'kick', target: 'neck', power: 0.5 }, state, 'adaptive', 'A');
    const action = result.action as { target: string };
    expect(action.target).toBe('body');
  });

  it('defaults invalid strike variant to jab', () => {
    const state = createFreshState();
    const result = validateAction({ type: 'strike', variant: 'uppercut', target: 'head', power: 0.5 }, state, 'adaptive', 'A');
    const action = result.action as { variant: string };
    expect(action.variant).toBe('jab');
  });

  it('forces guard when stamina is too low for action', () => {
    const state = createFreshState();
    state.stamina = 1; // too low for any attack
    const result = validateAction({ type: 'hook', target: 'head', power: 0.8 }, state, 'adaptive', 'A');
    expect(result.wasModified).toBe(true);
    expect(result.action.type).toBe('guard');
    expect(result.reason).toBe('insufficient_stamina');
  });

  it('flags foul when special is on cooldown', () => {
    const state = createFreshState();
    state.cooldowns = { special: 3 };
    const result = validateAction({ type: 'special', name: 'test', power: 0.5 }, state, 'adaptive', 'A');
    expect(result.wasModified).toBe(true);
    expect(result.wasFouled).toBe(true);
    expect(result.reason).toBe('on_cooldown');
    expect(result.event?.type).toBe('foul');
  });

  it('allows special when not on cooldown', () => {
    const state = createFreshState();
    const result = validateAction({ type: 'special', name: 'test', power: 0.5 }, state, 'adaptive', 'A');
    expect(result.wasModified).toBe(false);
    expect(result.action.type).toBe('special');
  });

  it('validates move action with direction clamping', () => {
    const state = createFreshState();
    const result = validateAction({ type: 'move', direction: 'INVALID', distance: 0.5 }, state, 'adaptive', 'A');
    const action = result.action as { direction: string };
    expect(action.direction).toBe('N'); // default
  });

  it('truncates long special names', () => {
    const state = createFreshState();
    const longName = 'a'.repeat(100);
    const result = validateAction({ type: 'special', name: longName, power: 0.5 }, state, 'adaptive', 'A');
    const action = result.action as { name: string };
    expect(action.name.length).toBeLessThanOrEqual(32);
  });
});
