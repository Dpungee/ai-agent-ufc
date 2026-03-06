/**
 * Game Balance Configuration
 *
 * ALL balance parameters live here. Nothing is hardcoded in the engine.
 * When you patch balance, update the version and document changes.
 */

export const ENGINE_VERSION = '0.1.0';

export const BALANCE = {
  // Fighter defaults
  maxHp: 100,
  maxStamina: 100,
  maxGuard: 100,
  maxBalance: 100,

  // Per-turn regeneration
  staminaRegen: 3,
  guardRegen: 5,
  balanceRegen: 3,

  // Guard mechanics
  guardBlockReduction: 0.6,   // % damage reduced when guarding
  guardDrainOnBlock: 10,      // Guard meter lost per blocked hit
  guardStaminaRecovery: 10,   // Extra stamina recovered when guarding

  // Action definitions
  actions: {
    strike: { baseDamage: [8, 14], staminaCost: 8, accuracy: 0.75, balanceDamage: 5 },
    hook:   { baseDamage: [14, 22], staminaCost: 14, accuracy: 0.60, balanceDamage: 12 },
    kick:   { baseDamage: [12, 18], staminaCost: 12, accuracy: 0.65, balanceDamage: 8 },
    guard:  { baseDamage: [0, 0], staminaCost: -15, accuracy: 1.0, balanceDamage: 0 },
    special: { baseDamage: [22, 35], staminaCost: 25, accuracy: 0.45, balanceDamage: 20 },
    move:   { baseDamage: [0, 0], staminaCost: 3, accuracy: 1.0, balanceDamage: 0 },
  },

  // Cooldowns (in turns)
  specialCooldown: 5,

  // Match structure
  defaultMaxRounds: 3,
  defaultTurnsPerRound: 40,
  defaultTurnTimeoutMs: 250,

  // Win conditions
  knockdownBalanceThreshold: 0,   // Balance at or below this = knockdown
  knockdownsForTko: 3,
  knockdownBalanceReset: 40,      // Balance set to this after knockdown

  // Style modifiers
  styles: {
    aggro:    { power: 1.15, defense: 0.80, speed: 1.00, staminaRate: 1.10 },
    counter:  { power: 1.05, defense: 1.20, speed: 1.10, staminaRate: 0.85 },
    grappler: { power: 0.95, defense: 1.10, speed: 0.90, staminaRate: 0.90 },
    zoner:    { power: 1.00, defense: 1.00, speed: 1.15, staminaRate: 0.95 },
    adaptive: { power: 1.00, defense: 1.00, speed: 1.00, staminaRate: 1.00 },
    brawler:  { power: 1.30, defense: 0.65, speed: 0.85, staminaRate: 1.25 },
  },

  // Timeout penalty
  timeoutStaminaPenalty: 10,
  timeoutDefaultAction: 'guard' as const,

  // Foul limits
  maxFoulsBeforeDq: 5,
} as const;

export type ActionName = keyof typeof BALANCE.actions;
