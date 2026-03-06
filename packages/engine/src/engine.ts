/**
 * AI Agent UFC — Match Engine
 *
 * The core game loop. Takes a MatchConfig + two decision functions,
 * runs the fight turn-by-turn, and returns a full Replay.
 *
 * DETERMINISTIC: same seed + same decisions = identical output.
 */

import { createHash } from 'crypto';
import { BALANCE, ENGINE_VERSION } from './config';
import { SeededRNG } from './rng';
import {
  Action,
  AgentConfig,
  ArenaConfig,
  DecideActionFn,
  FighterState,
  FighterView,
  GameState,
  MatchConfig,
  MatchResult,
  Replay,
  TurnEvent,
  TurnRecord,
  WinMethod,
} from './types';
import {
  resolveAttack,
  getStaminaCost,
  applyRegen,
  checkKo,
  checkTko,
  checkKnockdown,
  tickCooldowns,
  applyCooldown,
  getStyleModifiers,
} from './rules';
import { validateAction, defaultAction } from './validator';

// === State Initialization ===

function createInitialState(arena: ArenaConfig, side: 'A' | 'B'): FighterState {
  // Start fighters close enough to be in range of all attacks
  const x = side === 'A' ? arena.width * 0.45 : arena.width * 0.55;
  const y = arena.height / 2;
  return {
    hp: BALANCE.maxHp,
    stamina: BALANCE.maxStamina,
    guard: BALANCE.maxGuard,
    balance: BALANCE.maxBalance,
    position: { x, y },
    cooldowns: {},
    statusEffects: [],
    knockdowns: 0,
  };
}

function createArena(): ArenaConfig {
  return { width: 10, height: 10, hazards: [] };
}

// === View Creation (what agents see) ===

function createFighterView(state: FighterState, lastAction: Action | null): FighterView {
  return {
    hp: state.hp,
    stamina: state.stamina,
    position: { ...state.position },
    lastAction: lastAction?.type ?? null,
  };
}

function createGameState(
  turnNumber: number,
  roundNumber: number,
  turnsPerRound: number,
  selfState: FighterState,
  opponentState: FighterState,
  arena: ArenaConfig,
  history: Action[],
  lastOpponentAction: Action | null,
): GameState {
  const turnInRound = ((turnNumber - 1) % turnsPerRound) + 1;
  const timeLeft = turnsPerRound - turnInRound;
  return {
    turnNumber,
    roundNumber,
    timeLeft,
    self: { ...selfState },
    opponent: createFighterView(opponentState, lastOpponentAction),
    arena,
    history: history.slice(-5), // last 5 actions
  };
}

// === State Hashing ===

function hashState(stateA: FighterState, stateB: FighterState, turnNumber: number): string {
  const data = JSON.stringify({ turnNumber, a: stateA, b: stateB });
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

// === Movement ===

function applyMovement(state: FighterState, action: Action, arena: ArenaConfig): FighterState {
  if (action.type !== 'move') return state;
  const dist = action.distance * 2; // max 2 units per move
  const dirMap: Record<string, { dx: number; dy: number }> = {
    N:  { dx: 0, dy: -1 },
    S:  { dx: 0, dy: 1 },
    E:  { dx: 1, dy: 0 },
    W:  { dx: -1, dy: 0 },
    NE: { dx: 0.707, dy: -0.707 },
    NW: { dx: -0.707, dy: -0.707 },
    SE: { dx: 0.707, dy: 0.707 },
    SW: { dx: -0.707, dy: 0.707 },
  };
  const dir = dirMap[action.direction] ?? { dx: 0, dy: 0 };
  const newX = Math.max(0, Math.min(arena.width, state.position.x + dir.dx * dist));
  const newY = Math.max(0, Math.min(arena.height, state.position.y + dir.dy * dist));
  return { ...state, position: { x: newX, y: newY } };
}

// === Guard Stamina Recovery ===

function applyGuardRecovery(state: FighterState, action: Action): FighterState {
  if (action.type !== 'guard') return state;
  const recovery = BALANCE.guardStaminaRecovery * (action as { intensity: number }).intensity;
  return {
    ...state,
    stamina: Math.min(state.stamina + recovery, BALANCE.maxStamina),
  };
}

// === Scorecard ===

interface Scorecard {
  damageA: number;
  damageB: number;
  hitsA: number;
  hitsB: number;
  knockdownsA: number;
  knockdownsB: number;
}

function judgeDecision(scorecard: Scorecard): 'A' | 'B' | 'draw' {
  // Simple scoring: damage dealt + knockdowns * 10
  const scoreA = scorecard.damageA + scorecard.knockdownsA * 10;
  const scoreB = scorecard.damageB + scorecard.knockdownsB * 10;
  if (scoreA > scoreB) return 'A';
  if (scoreB > scoreA) return 'B';
  return 'draw';
}

// === Main Engine ===

export function runMatch(
  config: MatchConfig,
  decideA: DecideActionFn,
  decideB: DecideActionFn,
): Replay {
  const rng = new SeededRNG(config.seed);
  const arena = createArena();
  const maxRounds = config.maxRounds || BALANCE.defaultMaxRounds;
  const turnsPerRound = config.turnsPerRound || BALANCE.defaultTurnsPerRound;

  let stateA = createInitialState(arena, 'A');
  let stateB = createInitialState(arena, 'B');

  const turns: TurnRecord[] = [];
  const historyA: Action[] = [];
  const historyB: Action[] = [];
  let lastActionA: Action | null = null;
  let lastActionB: Action | null = null;
  let foulsA = 0;
  let foulsB = 0;

  const scorecard: Scorecard = {
    damageA: 0, damageB: 0,
    hitsA: 0, hitsB: 0,
    knockdownsA: 0, knockdownsB: 0,
  };

  let matchResult: MatchResult | null = null;

  for (let round = 1; round <= maxRounds && !matchResult; round++) {
    for (let turnInRound = 1; turnInRound <= turnsPerRound && !matchResult; turnInRound++) {
      const turnNumber = (round - 1) * turnsPerRound + turnInRound;
      const events: TurnEvent[] = [];

      // === 1. Get agent decisions ===
      const gameStateA = createGameState(turnNumber, round, turnsPerRound, stateA, stateB, arena, historyA, lastActionB);
      const gameStateB = createGameState(turnNumber, round, turnsPerRound, stateB, stateA, arena, historyB, lastActionA);

      let rawActionA: Action;
      let rawActionB: Action;

      try {
        rawActionA = decideA(gameStateA);
      } catch {
        rawActionA = defaultAction();
        events.push({ type: 'timeout', source: 'A', target: 'A', detail: 'agent_error' });
      }

      try {
        rawActionB = decideB(gameStateB);
      } catch {
        rawActionB = defaultAction();
        events.push({ type: 'timeout', source: 'B', target: 'B', detail: 'agent_error' });
      }

      // === 2. Validate actions ===
      const valA = validateAction(rawActionA, stateA, config.agentA.style, 'A');
      const valB = validateAction(rawActionB, stateB, config.agentB.style, 'B');

      const actionA = valA.action;
      const actionB = valB.action;

      if (valA.event) events.push(valA.event);
      if (valB.event) events.push(valB.event);
      if (valA.wasFouled) foulsA++;
      if (valB.wasFouled) foulsB++;

      // === 3. Check DQ ===
      if (foulsA >= BALANCE.maxFoulsBeforeDq) {
        events.push({ type: 'foul', source: 'A', target: 'A', detail: 'disqualified' });
        matchResult = { winner: 'B', method: 'dq', round, turn: turnNumber };
        turns.push({ turnNumber, roundNumber: round, actionA, actionB, events, stateHash: hashState(stateA, stateB, turnNumber) });
        break;
      }
      if (foulsB >= BALANCE.maxFoulsBeforeDq) {
        events.push({ type: 'foul', source: 'B', target: 'B', detail: 'disqualified' });
        matchResult = { winner: 'A', method: 'dq', round, turn: turnNumber };
        turns.push({ turnNumber, roundNumber: round, actionA, actionB, events, stateHash: hashState(stateA, stateB, turnNumber) });
        break;
      }

      // === 4. Apply stamina costs ===
      const costA = getStaminaCost(actionA, config.agentA.style);
      const costB = getStaminaCost(actionB, config.agentB.style);
      stateA = { ...stateA, stamina: Math.max(0, stateA.stamina - costA) };
      stateB = { ...stateB, stamina: Math.max(0, stateB.stamina - costB) };

      // === 5. Apply movement ===
      stateA = applyMovement(stateA, actionA, arena);
      stateB = applyMovement(stateB, actionB, arena);

      // === 6. Resolve attacks (simultaneous) ===
      const isGuardingA = actionA.type === 'guard';
      const isGuardingB = actionB.type === 'guard';

      const attackResultA = resolveAttack(
        rng, actionA, config.agentA.style, stateB, isGuardingB,
        stateA.position, stateB.position, 'A', 'B',
      );

      const attackResultB = resolveAttack(
        rng, actionB, config.agentB.style, stateA, isGuardingA,
        stateB.position, stateA.position, 'B', 'A',
      );

      events.push(...attackResultA.events);
      events.push(...attackResultB.events);

      // === 7. Apply damage ===
      stateB = {
        ...stateB,
        hp: Math.max(0, stateB.hp - attackResultA.damage),
        balance: Math.max(0, stateB.balance - attackResultA.balanceDamage),
        guard: Math.max(0, stateB.guard - attackResultA.guardDrain),
      };

      stateA = {
        ...stateA,
        hp: Math.max(0, stateA.hp - attackResultB.damage),
        balance: Math.max(0, stateA.balance - attackResultB.balanceDamage),
        guard: Math.max(0, stateA.guard - attackResultB.guardDrain),
      };

      // Update scorecard
      if (attackResultA.damage > 0) { scorecard.damageA += attackResultA.damage; scorecard.hitsA++; }
      if (attackResultB.damage > 0) { scorecard.damageB += attackResultB.damage; scorecard.hitsB++; }

      // === 8. Apply guard recovery ===
      stateA = applyGuardRecovery(stateA, actionA);
      stateB = applyGuardRecovery(stateB, actionB);

      // === 9. Check knockdowns ===
      if (checkKnockdown(stateB.balance)) {
        stateB = { ...stateB, knockdowns: stateB.knockdowns + 1, balance: BALANCE.knockdownBalanceReset };
        scorecard.knockdownsA++;
        events.push({ type: 'knockdown', source: 'A', target: 'B', value: stateB.knockdowns });
      }
      if (checkKnockdown(stateA.balance)) {
        stateA = { ...stateA, knockdowns: stateA.knockdowns + 1, balance: BALANCE.knockdownBalanceReset };
        scorecard.knockdownsB++;
        events.push({ type: 'knockdown', source: 'B', target: 'A', value: stateA.knockdowns });
      }

      // === 10. Check KO / TKO ===
      const koA = checkKo(stateA.hp);
      const koB = checkKo(stateB.hp);
      const tkoA = checkTko(stateA.knockdowns);
      const tkoB = checkTko(stateB.knockdowns);

      if (koA && koB) {
        // Double KO → draw
        events.push({ type: 'ko', source: 'B', target: 'A' });
        events.push({ type: 'ko', source: 'A', target: 'B' });
        matchResult = { winner: 'draw', method: 'ko', round, turn: turnNumber, scorecard };
      } else if (koB) {
        events.push({ type: 'ko', source: 'A', target: 'B' });
        matchResult = { winner: 'A', method: 'ko', round, turn: turnNumber, scorecard };
      } else if (koA) {
        events.push({ type: 'ko', source: 'B', target: 'A' });
        matchResult = { winner: 'B', method: 'ko', round, turn: turnNumber, scorecard };
      } else if (tkoB) {
        events.push({ type: 'tko', source: 'A', target: 'B' });
        matchResult = { winner: 'A', method: 'tko', round, turn: turnNumber, scorecard };
      } else if (tkoA) {
        events.push({ type: 'tko', source: 'B', target: 'A' });
        matchResult = { winner: 'B', method: 'tko', round, turn: turnNumber, scorecard };
      }

      // === 11. Update cooldowns ===
      stateA = { ...stateA, cooldowns: applyCooldown(tickCooldowns(stateA.cooldowns), actionA) };
      stateB = { ...stateB, cooldowns: applyCooldown(tickCooldowns(stateB.cooldowns), actionB) };

      // === 12. Apply regen ===
      stateA = applyRegen(stateA);
      stateB = applyRegen(stateB);

      // === 13. Record turn ===
      const stateHash = hashState(stateA, stateB, turnNumber);
      turns.push({ turnNumber, roundNumber: round, actionA, actionB, events, stateHash });

      lastActionA = actionA;
      lastActionB = actionB;
      historyA.push(actionA);
      historyB.push(actionB);
    }
  }

  // === Decision if no KO/TKO/DQ ===
  if (!matchResult) {
    const winner = judgeDecision(scorecard);
    matchResult = {
      winner,
      method: 'decision',
      round: config.maxRounds || BALANCE.defaultMaxRounds,
      turn: turns.length,
      scorecard,
    };
  }

  return {
    version: '1.0',
    engineVersion: ENGINE_VERSION,
    seed: config.seed,
    config,
    turns,
    result: matchResult,
    timestamp: new Date().toISOString(),
  };
}
