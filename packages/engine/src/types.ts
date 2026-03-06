/**
 * AI Agent UFC — Core Type Definitions
 * All types used by the deterministic match engine.
 */

// === Actions ===

export type ActionType = 'strike' | 'hook' | 'kick' | 'guard' | 'special' | 'move';
export type StrikeVariant = 'jab' | 'cross';
export type Target = 'head' | 'body' | 'leg';
export type Direction = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';

export interface ActionStrike {
  type: 'strike';
  variant: StrikeVariant;
  target: Target;
  power: number; // 0.0 - 1.0
}

export interface ActionHook {
  type: 'hook';
  target: Target;
  power: number;
}

export interface ActionKick {
  type: 'kick';
  target: Target;
  power: number;
}

export interface ActionGuard {
  type: 'guard';
  level: 'high' | 'low';
  intensity: number; // 0.0 - 1.0
}

export interface ActionSpecial {
  type: 'special';
  name: string;
  power: number;
}

export interface ActionMove {
  type: 'move';
  direction: Direction;
  distance: number; // 0.0 - 1.0
}

export type Action = ActionStrike | ActionHook | ActionKick | ActionGuard | ActionSpecial | ActionMove;

// === Fighter State ===

export interface FighterState {
  hp: number;
  stamina: number;
  guard: number;
  balance: number;
  position: { x: number; y: number };
  cooldowns: Record<string, number>;
  statusEffects: string[];
  knockdowns: number;
}

export interface FighterView {
  hp: number;
  stamina: number; // may be approximate for opponent
  position: { x: number; y: number };
  lastAction: ActionType | null;
}

// === Game State (what agents see) ===

export interface GameState {
  turnNumber: number;
  roundNumber: number;
  timeLeft: number;
  self: FighterState;
  opponent: FighterView;
  arena: ArenaConfig;
  history: Action[];
}

export interface ArenaConfig {
  width: number;
  height: number;
  hazards: string[];
}

// === Match Configuration ===

export type StyleTemplate = 'aggro' | 'counter' | 'grappler' | 'zoner' | 'adaptive' | 'brawler';

export interface AgentConfig {
  id: string;
  name: string;
  style: StyleTemplate;
  prompt: string;
  params: {
    aggression: number;      // 0.0 - 1.0
    riskTolerance: number;   // 0.0 - 1.0
    staminaConservation: number; // 0.0 - 1.0
    targetPreference: Target;
  };
  version: number;
}

export interface MatchConfig {
  seed: number;
  engineVersion: string;
  agentA: AgentConfig;
  agentB: AgentConfig;
  maxRounds: number;
  turnsPerRound: number;
  turnTimeoutMs: number;
  division: string;
}

// === Turn Events ===

export type EventType = 'damage' | 'block' | 'miss' | 'knockdown' | 'foul' | 'timeout' | 'ko' | 'tko';

export interface TurnEvent {
  type: EventType;
  source: 'A' | 'B';
  target: 'A' | 'B';
  value?: number;
  detail?: string;
}

export interface AgentReasoning {
  thinking: string;     // The AI's internal reasoning
  strategy: string;     // Short strategy summary (1 line)
  confidence: number;   // 0.0 - 1.0
  model?: string;       // Which LLM made this decision
}

export interface TurnRecord {
  turnNumber: number;
  roundNumber: number;
  actionA: Action;
  actionB: Action;
  reasoningA?: AgentReasoning;
  reasoningB?: AgentReasoning;
  events: TurnEvent[];
  stateHash: string;
}

// === Match Result ===

export type WinMethod = 'ko' | 'tko' | 'decision' | 'dq';

export interface MatchResult {
  winner: 'A' | 'B' | 'draw';
  method: WinMethod;
  round: number;
  turn: number;
  scorecard?: {
    damageA: number;
    damageB: number;
    hitsA: number;
    hitsB: number;
    knockdownsA: number;
    knockdownsB: number;
  };
}

// === Replay ===

export interface Replay {
  version: string;
  engineVersion: string;
  seed: number;
  config: MatchConfig;
  turns: TurnRecord[];
  result: MatchResult;
  timestamp: string;
}

// === Agent Interface ===

export type DecideActionFn = (state: GameState) => Action;

/** Async version that returns reasoning alongside the action */
export interface AgentDecision {
  action: Action;
  reasoning: AgentReasoning;
}

export type DecideActionAsyncFn = (state: GameState) => Promise<AgentDecision>;
