/**
 * AI Agent UFC — Bot Agents
 *
 * Simple AI strategies for testing the engine.
 * Each implements DecideActionFn: (state: GameState) => Action
 *
 * These use the seeded RNG embedded in the game state
 * for deterministic behavior via a simple hash-based approach.
 */

import { Action, DecideActionFn, GameState, Target } from './types';
import { SeededRNG } from './rng';

// Helper: create a deterministic RNG from turn number for bot decisions
function botRng(state: GameState): SeededRNG {
  return new SeededRNG(state.turnNumber * 7919 + state.roundNumber * 104729);
}

// === Random Agent ===
// Picks a valid action completely at random.

export const randomAgent: DecideActionFn = (state: GameState): Action => {
  const rng = botRng(state);
  const types = ['strike', 'hook', 'kick', 'guard', 'special', 'move'] as const;
  const type = rng.pick([...types]);
  const targets: Target[] = ['head', 'body', 'leg'];

  switch (type) {
    case 'strike':
      return {
        type: 'strike',
        variant: rng.chance(0.5) ? 'jab' : 'cross',
        target: rng.pick(targets),
        power: rng.next(),
      };
    case 'hook':
      return { type: 'hook', target: rng.pick(targets), power: rng.next() };
    case 'kick':
      return { type: 'kick', target: rng.pick(targets), power: rng.next() };
    case 'guard':
      return { type: 'guard', level: rng.chance(0.5) ? 'high' : 'low', intensity: rng.next() };
    case 'special':
      return { type: 'special', name: 'random_special', power: rng.next() };
    case 'move':
      return {
        type: 'move',
        direction: rng.pick(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'] as const),
        distance: rng.next(),
      };
  }
};

// === Aggro Bot ===
// Always attacks. Uses special when available, otherwise jabs/hooks.
// High power, no guarding.

export const aggroBot: DecideActionFn = (state: GameState): Action => {
  const rng = botRng(state);

  // Use special if we haven't recently (cooldown is tracked server-side)
  if (state.self.stamina >= 25) {
    if (state.turnNumber % 6 === 0) {
      return { type: 'special', name: 'haymaker', power: 1.0 };
    }
  }

  // Low stamina → one guard turn to recover
  if (state.self.stamina < 15) {
    return { type: 'guard', level: 'high', intensity: 0.8 };
  }

  // Alternate between high-power strikes
  const attacks: Action[] = [
    { type: 'strike', variant: 'cross', target: 'head', power: 0.9 },
    { type: 'hook', target: 'head', power: 0.85 },
    { type: 'kick', target: 'body', power: 0.8 },
    { type: 'strike', variant: 'jab', target: 'body', power: 0.7 },
  ];

  return rng.pick(attacks);
};

// === Turtle Bot ===
// Defensive strategy. Guards most of the time.
// Only attacks when stamina is full.

export const turtleBot: DecideActionFn = (state: GameState): Action => {
  const rng = botRng(state);

  // Attack when stamina is high
  if (state.self.stamina >= 90) {
    const counters: Action[] = [
      { type: 'hook', target: 'body', power: 0.7 },
      { type: 'strike', variant: 'cross', target: 'head', power: 0.6 },
      { type: 'kick', target: 'leg', power: 0.5 },
    ];
    return rng.pick(counters);
  }

  // Otherwise guard
  return {
    type: 'guard',
    level: rng.chance(0.7) ? 'high' : 'low',
    intensity: 0.9,
  };
};

// === Mirror Bot ===
// Copies the opponent's last action type.
// If no previous action, guards.

export const mirrorBot: DecideActionFn = (state: GameState): Action => {
  const rng = botRng(state);
  const lastOpponentAction = state.opponent.lastAction;

  if (!lastOpponentAction) {
    return { type: 'guard', level: 'high', intensity: 0.7 };
  }

  switch (lastOpponentAction) {
    case 'strike':
      return { type: 'strike', variant: 'jab', target: 'head', power: 0.6 };
    case 'hook':
      return { type: 'hook', target: 'body', power: 0.6 };
    case 'kick':
      return { type: 'kick', target: 'leg', power: 0.6 };
    case 'guard':
      // Opponent guarding → attack
      return { type: 'hook', target: 'head', power: 0.8 };
    case 'special':
      return { type: 'special', name: 'mirror_special', power: 0.7 };
    case 'move':
      return {
        type: 'move',
        direction: rng.pick(['N', 'S', 'E', 'W'] as const),
        distance: 0.5,
      };
    default:
      return { type: 'guard', level: 'high', intensity: 0.5 };
  }
};

// === Counter Bot ===
// Reads the opponent and tries to exploit patterns.
// Guards against attacks, attacks when opponent guards/moves.

export const counterBot: DecideActionFn = (state: GameState): Action => {
  const rng = botRng(state);
  const lastOpponentAction = state.opponent.lastAction;

  // Opening moves: guard to observe
  if (state.turnNumber <= 2) {
    return { type: 'guard', level: 'high', intensity: 0.8 };
  }

  // If opponent is attacking, guard
  if (lastOpponentAction === 'strike' || lastOpponentAction === 'hook' || lastOpponentAction === 'kick' || lastOpponentAction === 'special') {
    return { type: 'guard', level: 'high', intensity: 0.85 };
  }

  // Opponent guarding or moving → punish
  if (state.self.stamina >= 20) {
    const punishes: Action[] = [
      { type: 'hook', target: 'body', power: 0.75 },
      { type: 'kick', target: 'leg', power: 0.7 },
      { type: 'strike', variant: 'cross', target: 'head', power: 0.8 },
    ];
    return rng.pick(punishes);
  }

  return { type: 'guard', level: 'low', intensity: 0.7 };
};

/** All built-in bots */
export const BOTS = {
  random: randomAgent,
  aggro: aggroBot,
  turtle: turtleBot,
  mirror: mirrorBot,
  counter: counterBot,
} as const;

export type BotName = keyof typeof BOTS;
