/**
 * AI Agent UFC — Async Match Engine
 *
 * Like engine.ts but supports async DecideActionAsyncFn for LLM agents.
 * Captures reasoning alongside each action for the replay viewer.
 *
 * Use this when running LLM-powered fights.
 * Use engine.ts (sync) for bot-only fights and testing.
 */

import { createHash } from 'crypto';
import { BALANCE, ENGINE_VERSION } from './config';
import { SeededRNG } from './rng';
import {
  Action,
  AgentDecision,
  AgentReasoning,
  ArenaConfig,
  DecideActionAsyncFn,
  FighterState,
  FighterView,
  GameState,
  MatchConfig,
  MatchResult,
  Replay,
  TurnEvent,
  TurnRecord,
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
} from './rules';
import { validateAction, defaultAction } from './validator';

function createInitialState(arena: ArenaConfig, side: 'A' | 'B'): FighterState {
  const x = side === 'A' ? arena.width * 0.45 : arena.width * 0.55;
  const y = arena.height / 2;
  return {
    hp: BALANCE.maxHp, stamina: BALANCE.maxStamina, guard: BALANCE.maxGuard,
    balance: BALANCE.maxBalance, position: { x, y }, cooldowns: {},
    statusEffects: [], knockdowns: 0,
  };
}

function createArena(): ArenaConfig { return { width: 10, height: 10, hazards: [] }; }

function createFighterView(state: FighterState, lastAction: Action | null): FighterView {
  return { hp: state.hp, stamina: state.stamina, position: { ...state.position }, lastAction: lastAction?.type ?? null };
}

function createGameState(turnNumber: number, roundNumber: number, turnsPerRound: number, selfState: FighterState, opponentState: FighterState, arena: ArenaConfig, history: Action[], lastOpponentAction: Action | null): GameState {
  const turnInRound = ((turnNumber - 1) % turnsPerRound) + 1;
  return { turnNumber, roundNumber, timeLeft: turnsPerRound - turnInRound, self: { ...selfState }, opponent: createFighterView(opponentState, lastOpponentAction), arena, history: history.slice(-5) };
}

function hashState(stateA: FighterState, stateB: FighterState, turnNumber: number): string {
  return createHash('sha256').update(JSON.stringify({ turnNumber, a: stateA, b: stateB })).digest('hex').slice(0, 16);
}

function applyMovement(state: FighterState, action: Action, arena: ArenaConfig): FighterState {
  if (action.type !== 'move') return state;
  const dist = action.distance * 2;
  const dirMap: Record<string, { dx: number; dy: number }> = {
    N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 }, E: { dx: 1, dy: 0 }, W: { dx: -1, dy: 0 },
    NE: { dx: 0.707, dy: -0.707 }, NW: { dx: -0.707, dy: -0.707 }, SE: { dx: 0.707, dy: 0.707 }, SW: { dx: -0.707, dy: 0.707 },
  };
  const dir = dirMap[action.direction] ?? { dx: 0, dy: 0 };
  return { ...state, position: { x: Math.max(0, Math.min(arena.width, state.position.x + dir.dx * dist)), y: Math.max(0, Math.min(arena.height, state.position.y + dir.dy * dist)) } };
}

function applyGuardRecovery(state: FighterState, action: Action): FighterState {
  if (action.type !== 'guard') return state;
  const recovery = BALANCE.guardStaminaRecovery * (action as { intensity: number }).intensity;
  return { ...state, stamina: Math.min(state.stamina + recovery, BALANCE.maxStamina) };
}

interface Scorecard { damageA: number; damageB: number; hitsA: number; hitsB: number; knockdownsA: number; knockdownsB: number; }

function judgeDecision(sc: Scorecard): 'A' | 'B' | 'draw' {
  const scoreA = sc.damageA + sc.knockdownsA * 10;
  const scoreB = sc.damageB + sc.knockdownsB * 10;
  return scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw';
}

/** Callback fired after each turn — for live streaming / UI updates */
export type OnTurnCallback = (turn: TurnRecord, stateA: FighterState, stateB: FighterState) => void;

/**
 * Run a match with async LLM agents.
 * Each turn awaits both agents' decisions (can be parallel).
 */
export async function runMatchAsync(
  config: MatchConfig,
  decideA: DecideActionAsyncFn,
  decideB: DecideActionAsyncFn,
  onTurn?: OnTurnCallback,
): Promise<Replay> {
  const rng = new SeededRNG(config.seed);
  const arena = createArena();
  const maxRounds = config.maxRounds || BALANCE.defaultMaxRounds;
  const turnsPerRound = config.turnsPerRound || BALANCE.defaultTurnsPerRound;

  let stateA = createInitialState(arena, 'A');
  let stateB = createInitialState(arena, 'B');
  const turns: TurnRecord[] = [];
  const historyA: Action[] = [], historyB: Action[] = [];
  let lastActionA: Action | null = null, lastActionB: Action | null = null;
  let foulsA = 0, foulsB = 0;
  const scorecard: Scorecard = { damageA: 0, damageB: 0, hitsA: 0, hitsB: 0, knockdownsA: 0, knockdownsB: 0 };
  let matchResult: MatchResult | null = null;

  for (let round = 1; round <= maxRounds && !matchResult; round++) {
    for (let turnInRound = 1; turnInRound <= turnsPerRound && !matchResult; turnInRound++) {
      const turnNumber = (round - 1) * turnsPerRound + turnInRound;
      const events: TurnEvent[] = [];

      // Build game states
      const gameStateA = createGameState(turnNumber, round, turnsPerRound, stateA, stateB, arena, historyA, lastActionB);
      const gameStateB = createGameState(turnNumber, round, turnsPerRound, stateB, stateA, arena, historyB, lastActionA);

      // Get LLM decisions — run both in parallel
      let decisionA: AgentDecision;
      let decisionB: AgentDecision;

      try {
        const [resA, resB] = await Promise.all([
          decideA(gameStateA).catch((err): AgentDecision => ({
            action: defaultAction(),
            reasoning: { thinking: `Error: ${err?.message || 'unknown'}`, strategy: 'Error fallback', confidence: 0 },
          })),
          decideB(gameStateB).catch((err): AgentDecision => ({
            action: defaultAction(),
            reasoning: { thinking: `Error: ${err?.message || 'unknown'}`, strategy: 'Error fallback', confidence: 0 },
          })),
        ]);
        decisionA = resA;
        decisionB = resB;
      } catch {
        decisionA = { action: defaultAction(), reasoning: { thinking: 'Fatal error', strategy: 'Fallback', confidence: 0 } };
        decisionB = { action: defaultAction(), reasoning: { thinking: 'Fatal error', strategy: 'Fallback', confidence: 0 } };
      }

      // Validate
      const valA = validateAction(decisionA.action, stateA, config.agentA.style, 'A');
      const valB = validateAction(decisionB.action, stateB, config.agentB.style, 'B');
      const actionA = valA.action, actionB = valB.action;
      if (valA.event) events.push(valA.event);
      if (valB.event) events.push(valB.event);
      if (valA.wasFouled) foulsA++;
      if (valB.wasFouled) foulsB++;

      // DQ check
      if (foulsA >= BALANCE.maxFoulsBeforeDq) {
        events.push({ type: 'foul', source: 'A', target: 'A', detail: 'disqualified' });
        matchResult = { winner: 'B', method: 'dq', round, turn: turnNumber };
        turns.push({ turnNumber, roundNumber: round, actionA, actionB, reasoningA: decisionA.reasoning, reasoningB: decisionB.reasoning, events, stateHash: hashState(stateA, stateB, turnNumber) });
        break;
      }
      if (foulsB >= BALANCE.maxFoulsBeforeDq) {
        events.push({ type: 'foul', source: 'B', target: 'B', detail: 'disqualified' });
        matchResult = { winner: 'A', method: 'dq', round, turn: turnNumber };
        turns.push({ turnNumber, roundNumber: round, actionA, actionB, reasoningA: decisionA.reasoning, reasoningB: decisionB.reasoning, events, stateHash: hashState(stateA, stateB, turnNumber) });
        break;
      }

      // Stamina costs
      stateA = { ...stateA, stamina: Math.max(0, stateA.stamina - getStaminaCost(actionA, config.agentA.style)) };
      stateB = { ...stateB, stamina: Math.max(0, stateB.stamina - getStaminaCost(actionB, config.agentB.style)) };

      // Movement
      stateA = applyMovement(stateA, actionA, arena);
      stateB = applyMovement(stateB, actionB, arena);

      // Combat resolution
      const isGuardingA = actionA.type === 'guard', isGuardingB = actionB.type === 'guard';
      const atkA = resolveAttack(rng, actionA, config.agentA.style, stateB, isGuardingB, stateA.position, stateB.position, 'A', 'B');
      const atkB = resolveAttack(rng, actionB, config.agentB.style, stateA, isGuardingA, stateB.position, stateA.position, 'B', 'A');
      events.push(...atkA.events, ...atkB.events);

      // Apply damage
      stateB = { ...stateB, hp: Math.max(0, stateB.hp - atkA.damage), balance: Math.max(0, stateB.balance - atkA.balanceDamage), guard: Math.max(0, stateB.guard - atkA.guardDrain) };
      stateA = { ...stateA, hp: Math.max(0, stateA.hp - atkB.damage), balance: Math.max(0, stateA.balance - atkB.balanceDamage), guard: Math.max(0, stateA.guard - atkB.guardDrain) };

      if (atkA.damage > 0) { scorecard.damageA += atkA.damage; scorecard.hitsA++; }
      if (atkB.damage > 0) { scorecard.damageB += atkB.damage; scorecard.hitsB++; }

      // Guard recovery
      stateA = applyGuardRecovery(stateA, actionA);
      stateB = applyGuardRecovery(stateB, actionB);

      // Knockdowns
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

      // KO/TKO
      const koA = checkKo(stateA.hp), koB = checkKo(stateB.hp);
      const tkoA = checkTko(stateA.knockdowns), tkoB = checkTko(stateB.knockdowns);
      if (koA && koB) { events.push({ type: 'ko', source: 'B', target: 'A' }, { type: 'ko', source: 'A', target: 'B' }); matchResult = { winner: 'draw', method: 'ko', round, turn: turnNumber, scorecard }; }
      else if (koB) { events.push({ type: 'ko', source: 'A', target: 'B' }); matchResult = { winner: 'A', method: 'ko', round, turn: turnNumber, scorecard }; }
      else if (koA) { events.push({ type: 'ko', source: 'B', target: 'A' }); matchResult = { winner: 'B', method: 'ko', round, turn: turnNumber, scorecard }; }
      else if (tkoB) { events.push({ type: 'tko', source: 'A', target: 'B' }); matchResult = { winner: 'A', method: 'tko', round, turn: turnNumber, scorecard }; }
      else if (tkoA) { events.push({ type: 'tko', source: 'B', target: 'A' }); matchResult = { winner: 'B', method: 'tko', round, turn: turnNumber, scorecard }; }

      // Cooldowns + regen
      stateA = { ...stateA, cooldowns: applyCooldown(tickCooldowns(stateA.cooldowns), actionA) };
      stateB = { ...stateB, cooldowns: applyCooldown(tickCooldowns(stateB.cooldowns), actionB) };
      stateA = applyRegen(stateA);
      stateB = applyRegen(stateB);

      // Record turn WITH reasoning
      const turn: TurnRecord = {
        turnNumber, roundNumber: round, actionA, actionB,
        reasoningA: decisionA.reasoning,
        reasoningB: decisionB.reasoning,
        events, stateHash: hashState(stateA, stateB, turnNumber),
      };
      turns.push(turn);
      if (onTurn) onTurn(turn, stateA, stateB);

      lastActionA = actionA; lastActionB = actionB;
      historyA.push(actionA); historyB.push(actionB);
    }
  }

  if (!matchResult) {
    matchResult = { winner: judgeDecision(scorecard), method: 'decision', round: maxRounds, turn: turns.length, scorecard };
  }

  return { version: '1.0', engineVersion: ENGINE_VERSION, seed: config.seed, config, turns, result: matchResult, timestamp: new Date().toISOString() };
}
