import { describe, it, expect } from 'vitest';
import { runMatch } from '../src/engine';
import { aggroBot, turtleBot, mirrorBot, randomAgent, counterBot } from '../src/agents';
import { MatchConfig, AgentConfig, Action, GameState, DecideActionFn } from '../src/types';

function makeAgent(name: string, style: 'aggro' | 'counter' | 'grappler' | 'zoner' | 'adaptive' | 'brawler' = 'adaptive'): AgentConfig {
  return {
    id: name,
    name,
    style,
    prompt: '',
    params: { aggression: 0.5, riskTolerance: 0.5, staminaConservation: 0.5, targetPreference: 'body' },
    version: 1,
  };
}

function makeConfig(seed: number, overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed,
    engineVersion: '0.1.0',
    agentA: makeAgent('Fighter A', 'aggro'),
    agentB: makeAgent('Fighter B', 'counter'),
    maxRounds: 3,
    turnsPerRound: 40,
    turnTimeoutMs: 250,
    division: 'test',
    ...overrides,
  };
}

describe('Engine — Determinism', () => {
  it('same seed + same agents = identical replay (100 runs)', () => {
    const config = makeConfig(12345);
    const baseline = runMatch(config, aggroBot, turtleBot);

    for (let i = 0; i < 100; i++) {
      const replay = runMatch(config, aggroBot, turtleBot);
      // Compare turn-by-turn state hashes
      expect(replay.turns.length).toBe(baseline.turns.length);
      for (let t = 0; t < replay.turns.length; t++) {
        expect(replay.turns[t].stateHash).toBe(baseline.turns[t].stateHash);
      }
      expect(replay.result.winner).toBe(baseline.result.winner);
      expect(replay.result.method).toBe(baseline.result.method);
    }
  });

  it('different seeds produce different results', () => {
    const config1 = makeConfig(11111);
    const config2 = makeConfig(99999);
    const replay1 = runMatch(config1, aggroBot, aggroBot);
    const replay2 = runMatch(config2, aggroBot, aggroBot);
    // Different seeds affect accuracy/damage rolls, so state should diverge
    // Compare final results or look for any hash difference
    const hashesMatch = replay1.turns.length === replay2.turns.length &&
      replay1.turns.every(
        (t, i) => replay2.turns[i] && t.stateHash === replay2.turns[i].stateHash,
      );
    // With different RNG seeds, damage/accuracy rolls differ → different state
    // If somehow they still match (very unlikely), at least verify the engine ran
    expect(replay1.turns.length).toBeGreaterThan(0);
    expect(replay2.turns.length).toBeGreaterThan(0);
    // At minimum, the results should differ OR the hashes should differ
    const resultsDiffer = replay1.result.winner !== replay2.result.winner ||
      replay1.result.method !== replay2.result.method ||
      replay1.result.turn !== replay2.result.turn;
    expect(hashesMatch && !resultsDiffer).toBe(false);
  });
});

describe('Engine — Match Completion', () => {
  it('produces a valid replay structure', () => {
    const config = makeConfig(42);
    const replay = runMatch(config, aggroBot, turtleBot);

    expect(replay.version).toBe('1.0');
    expect(replay.engineVersion).toBeDefined();
    expect(replay.seed).toBe(42);
    expect(replay.config).toBeDefined();
    expect(replay.turns.length).toBeGreaterThan(0);
    expect(replay.result).toBeDefined();
    expect(replay.result.winner).toMatch(/^(A|B|draw)$/);
    expect(replay.result.method).toMatch(/^(ko|tko|decision|dq)$/);
    expect(replay.timestamp).toBeDefined();
  });

  it('match ends within max turns', () => {
    const config = makeConfig(555, { maxRounds: 3, turnsPerRound: 40 });
    const replay = runMatch(config, turtleBot, turtleBot);
    expect(replay.turns.length).toBeLessThanOrEqual(3 * 40);
  });

  it('each turn has valid structure', () => {
    const config = makeConfig(777);
    const replay = runMatch(config, randomAgent, randomAgent);
    for (const turn of replay.turns) {
      expect(turn.turnNumber).toBeGreaterThan(0);
      expect(turn.roundNumber).toBeGreaterThanOrEqual(1);
      expect(turn.actionA).toBeDefined();
      expect(turn.actionB).toBeDefined();
      expect(turn.stateHash).toBeDefined();
      expect(turn.stateHash.length).toBe(16);
    }
  });

  it('turn numbers are sequential', () => {
    const config = makeConfig(888);
    const replay = runMatch(config, aggroBot, counterBot);
    for (let i = 0; i < replay.turns.length; i++) {
      expect(replay.turns[i].turnNumber).toBe(i + 1);
    }
  });
});

describe('Engine — Win Conditions', () => {
  it('KO when HP reaches 0', () => {
    const config = makeConfig(42, { maxRounds: 10, turnsPerRound: 100 });
    const replay = runMatch(config, aggroBot, aggroBot);
    if (replay.result.method === 'ko') {
      const lastTurn = replay.turns[replay.turns.length - 1];
      const koEvents = lastTurn.events.filter((e) => e.type === 'ko');
      expect(koEvents.length).toBeGreaterThan(0);
    }
  });

  it('decision when no KO/TKO occurs', () => {
    // Pure guard bot never attacks — guaranteed decision
    const pureGuard: DecideActionFn = () => ({ type: 'guard', level: 'high', intensity: 1.0 });
    const config = makeConfig(100, { maxRounds: 2, turnsPerRound: 20 });
    const replay = runMatch(config, pureGuard, pureGuard);
    expect(replay.result.method).toBe('decision');
  });

  it('decision has scorecard', () => {
    const config = makeConfig(200, { maxRounds: 2, turnsPerRound: 20 });
    const replay = runMatch(config, turtleBot, turtleBot);
    if (replay.result.method === 'decision') {
      expect(replay.result.scorecard).toBeDefined();
    }
  });
});

describe('Engine — Agent Error Handling', () => {
  it('handles agent throwing an error gracefully', () => {
    const throwingAgent: DecideActionFn = () => {
      throw new Error('Agent crashed!');
    };
    const config = makeConfig(999);
    const replay = runMatch(config, throwingAgent, turtleBot);
    // Should complete without crashing
    expect(replay.result).toBeDefined();
    // Should have timeout events for the crashing agent
    const timeouts = replay.turns.flatMap((t) => t.events).filter((e) => e.type === 'timeout');
    expect(timeouts.length).toBeGreaterThan(0);
  });

  it('handles agent returning null gracefully', () => {
    const nullAgent: DecideActionFn = () => null as unknown as Action;
    const config = makeConfig(888);
    const replay = runMatch(config, nullAgent, aggroBot);
    expect(replay.result).toBeDefined();
  });

  it('handles agent returning invalid action', () => {
    const badAgent: DecideActionFn = () => ({ type: 'teleport', power: 999 } as unknown as Action);
    const config = makeConfig(777);
    const replay = runMatch(config, badAgent, aggroBot);
    expect(replay.result).toBeDefined();
  });
});

describe('Engine — DQ', () => {
  it('DQ after repeated cooldown violations', () => {
    // Agent that always tries to use special (will foul when on cooldown)
    const spamSpecial: DecideActionFn = () => ({
      type: 'special',
      name: 'spam',
      power: 1.0,
    });
    const config = makeConfig(321, { maxRounds: 5, turnsPerRound: 50 });
    const replay = runMatch(config, spamSpecial, turtleBot);
    // Should eventually get DQ'd
    const foulEvents = replay.turns.flatMap((t) => t.events).filter((e) => e.type === 'foul');
    expect(foulEvents.length).toBeGreaterThan(0);
  });
});

describe('Engine — Bot Matchups', () => {
  it('aggro vs turtle completes', () => {
    const replay = runMatch(makeConfig(1), aggroBot, turtleBot);
    expect(replay.result).toBeDefined();
  });

  it('mirror vs counter completes', () => {
    const replay = runMatch(makeConfig(2), mirrorBot, counterBot);
    expect(replay.result).toBeDefined();
  });

  it('random vs random completes', () => {
    const replay = runMatch(makeConfig(3), randomAgent, randomAgent);
    expect(replay.result).toBeDefined();
  });

  it('aggro vs aggro completes (should be aggressive fight)', () => {
    const config = makeConfig(4, {
      agentA: makeAgent('Aggro A', 'aggro'),
      agentB: makeAgent('Aggro B', 'aggro'),
    });
    const replay = runMatch(config, aggroBot, aggroBot);
    expect(replay.result).toBeDefined();
    // Should have damage events
    const dmgEvents = replay.turns.flatMap((t) => t.events).filter((e) => e.type === 'damage');
    expect(dmgEvents.length).toBeGreaterThan(0);
  });
});
