/**
 * AI Agent UFC — Action Validator
 *
 * Validates and clamps agent-submitted actions.
 * Invalid actions are replaced with a default guard action.
 * This prevents agents from cheating or submitting malformed data.
 */

import { BALANCE } from './config';
import {
  Action,
  ActionType,
  ActionStrike,
  ActionHook,
  ActionKick,
  ActionGuard,
  ActionSpecial,
  ActionMove,
  FighterState,
  Target,
  Direction,
  StrikeVariant,
  TurnEvent,
  StyleTemplate,
} from './types';
import { canAffordAction, isOnCooldown, getStaminaCost } from './rules';

// === Constants ===

const VALID_ACTION_TYPES: ActionType[] = ['strike', 'hook', 'kick', 'guard', 'special', 'move'];
const VALID_TARGETS: Target[] = ['head', 'body', 'leg'];
const VALID_STRIKE_VARIANTS: StrikeVariant[] = ['jab', 'cross'];
const VALID_DIRECTIONS: Direction[] = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'];

// === Default Action ===

export function defaultAction(): ActionGuard {
  return { type: 'guard', level: 'high', intensity: 0.5 };
}

// === Clamping Helpers ===

function clamp01(value: unknown): number {
  if (typeof value !== 'number' || isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function clampTarget(target: unknown): Target {
  if (typeof target === 'string' && VALID_TARGETS.includes(target as Target)) {
    return target as Target;
  }
  return 'body'; // safe default
}

// === Type-Specific Validators ===

function validateStrike(raw: Record<string, unknown>): ActionStrike {
  const variant = VALID_STRIKE_VARIANTS.includes(raw.variant as StrikeVariant)
    ? (raw.variant as StrikeVariant)
    : 'jab';
  return {
    type: 'strike',
    variant,
    target: clampTarget(raw.target),
    power: clamp01(raw.power),
  };
}

function validateHook(raw: Record<string, unknown>): ActionHook {
  return {
    type: 'hook',
    target: clampTarget(raw.target),
    power: clamp01(raw.power),
  };
}

function validateKick(raw: Record<string, unknown>): ActionKick {
  return {
    type: 'kick',
    target: clampTarget(raw.target),
    power: clamp01(raw.power),
  };
}

function validateGuard(raw: Record<string, unknown>): ActionGuard {
  const level = (raw.level === 'high' || raw.level === 'low') ? raw.level : 'high';
  return {
    type: 'guard',
    level,
    intensity: clamp01(raw.intensity),
  };
}

function validateSpecial(raw: Record<string, unknown>): ActionSpecial {
  const name = typeof raw.name === 'string' && raw.name.length > 0
    ? raw.name.slice(0, 32) // truncate long names
    : 'unnamed';
  return {
    type: 'special',
    name,
    power: clamp01(raw.power),
  };
}

function validateMove(raw: Record<string, unknown>): ActionMove {
  const direction = VALID_DIRECTIONS.includes(raw.direction as Direction)
    ? (raw.direction as Direction)
    : 'N';
  return {
    type: 'move',
    direction,
    distance: clamp01(raw.distance),
  };
}

// === Main Validator ===

export interface ValidationResult {
  action: Action;
  wasModified: boolean;
  wasFouled: boolean;
  reason?: string;
  event?: TurnEvent;
}

/**
 * Validates an agent's submitted action.
 *
 * - If the action is malformed, replaces with default guard.
 * - If the agent can't afford it (stamina), replaces with guard.
 * - If the action is on cooldown, replaces with guard + foul.
 * - Clamps all numeric values to valid ranges.
 */
export function validateAction(
  raw: unknown,
  fighterState: FighterState,
  style: StyleTemplate,
  source: 'A' | 'B',
): ValidationResult {
  // Null / undefined / non-object → default
  if (!raw || typeof raw !== 'object') {
    return {
      action: defaultAction(),
      wasModified: true,
      wasFouled: false,
      reason: 'action_null_or_invalid',
    };
  }

  const obj = raw as Record<string, unknown>;

  // Check action type is valid
  if (!VALID_ACTION_TYPES.includes(obj.type as ActionType)) {
    return {
      action: defaultAction(),
      wasModified: true,
      wasFouled: false,
      reason: 'invalid_action_type',
    };
  }

  // Parse by type
  let action: Action;
  switch (obj.type) {
    case 'strike':  action = validateStrike(obj); break;
    case 'hook':    action = validateHook(obj); break;
    case 'kick':    action = validateKick(obj); break;
    case 'guard':   action = validateGuard(obj); break;
    case 'special': action = validateSpecial(obj); break;
    case 'move':    action = validateMove(obj); break;
    default:
      return { action: defaultAction(), wasModified: true, wasFouled: false, reason: 'unknown_type' };
  }

  // Cooldown check (special only) — this is a foul
  if (isOnCooldown(fighterState, action)) {
    const foulEvent: TurnEvent = {
      type: 'foul',
      source,
      target: source,
      detail: 'cooldown_violation',
    };
    return {
      action: defaultAction(),
      wasModified: true,
      wasFouled: true,
      reason: 'on_cooldown',
      event: foulEvent,
    };
  }

  // Stamina check — can't afford = forced guard (not a foul, just exhaustion)
  if (!canAffordAction(fighterState.stamina, action, style)) {
    return {
      action: defaultAction(),
      wasModified: true,
      wasFouled: false,
      reason: 'insufficient_stamina',
    };
  }

  return {
    action,
    wasModified: false,
    wasFouled: false,
  };
}
