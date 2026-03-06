/**
 * AI Agent UFC — LLM Agent Adapter
 *
 * Sends game state to an LLM (Claude, GPT, etc.) and parses
 * the response into a valid Action + reasoning.
 *
 * This is what makes the AI "real" — the LLM reads the fight
 * situation and decides what to do, explaining its thinking.
 */

import {
  Action,
  AgentConfig,
  AgentDecision,
  AgentReasoning,
  DecideActionAsyncFn,
  GameState,
} from './types';
import { BALANCE } from './config';

// === Prompt Builder ===

export function buildSystemPrompt(config: AgentConfig): string {
  return `You are "${config.name}", an AI fighter in a turn-based combat arena.

FIGHTING STYLE: ${config.style.toUpperCase()}
PERSONALITY: ${config.prompt || 'A skilled fighter who adapts to their opponent.'}

PARAMETERS:
- Aggression: ${(config.params.aggression * 100).toFixed(0)}%
- Risk Tolerance: ${(config.params.riskTolerance * 100).toFixed(0)}%
- Stamina Conservation: ${(config.params.staminaConservation * 100).toFixed(0)}%
- Preferred Target: ${config.params.targetPreference}

AVAILABLE ACTIONS (pick ONE per turn):
1. STRIKE - Fast jab or cross punch. Target: head/body/leg. Power: 0-1. Cost: ~8 stamina. Accuracy: 75%.
2. HOOK - Powerful wide punch. Target: head/body/leg. Power: 0-1. Cost: ~14 stamina. Accuracy: 60%.
3. KICK - Mid-range leg/body attack. Target: head/body/leg. Power: 0-1. Cost: ~12 stamina. Accuracy: 65%.
4. GUARD - Block incoming attacks. Level: high/low. Intensity: 0-1. Recovers stamina.
5. SPECIAL - Devastating haymaker. Power: 0-1. Cost: 25 stamina. Accuracy: 45%. 5-turn cooldown.
6. MOVE - Reposition. Direction: N/S/E/W/NE/NW/SE/SW. Distance: 0-1.

RULES:
- You have ${BALANCE.maxHp} HP, ${BALANCE.maxStamina} Stamina, ${BALANCE.maxGuard} Guard, ${BALANCE.maxBalance} Balance
- If stamina is too low for an action, you'll be forced to guard
- 3 knockdowns = TKO loss
- HP reaching 0 = KO loss
- Think about what your opponent just did and predict their next move
- Higher power = more damage but more stamina cost

You MUST respond in this exact JSON format:
{
  "thinking": "<your reasoning about the situation, 2-3 sentences>",
  "strategy": "<one-line strategy summary>",
  "confidence": <0.0-1.0>,
  "action": {
    "type": "<action type>",
    ...action-specific fields
  }
}`;
}

export function buildTurnPrompt(state: GameState): string {
  const self = state.self;
  const opp = state.opponent;

  let situationNotes = '';
  if (self.hp <= 20) situationNotes += ' YOU ARE CRITICALLY LOW ON HP!';
  if (self.stamina <= 15) situationNotes += ' Low stamina — consider guarding.';
  if (opp.hp <= 30) situationNotes += ' Opponent is hurt — press the advantage!';
  if (self.knockdowns >= 2) situationNotes += ' WARNING: One more knockdown = TKO loss!';

  return `TURN ${state.turnNumber} | ROUND ${state.roundNumber} | Time left: ${state.timeLeft}

YOUR STATUS:
  HP: ${self.hp}/${BALANCE.maxHp}
  Stamina: ${self.stamina}/${BALANCE.maxStamina}
  Guard: ${self.guard}/${BALANCE.maxGuard}
  Balance: ${self.balance}/${BALANCE.maxBalance}
  Knockdowns taken: ${self.knockdowns}

OPPONENT:
  HP: ${opp.hp}/${BALANCE.maxHp}
  Stamina: ~${opp.stamina} (estimated)
  Last action: ${opp.lastAction || 'none'}
  Position: (${opp.position.x.toFixed(1)}, ${opp.position.y.toFixed(1)})

RECENT HISTORY: ${state.history.length > 0 ? state.history.map(a => a.type).join(' → ') : 'none'}
${situationNotes ? '\n⚠️' + situationNotes : ''}

What is your action? Respond with JSON only.`;
}

// === Response Parser ===

export interface LLMResponse {
  thinking: string;
  strategy: string;
  confidence: number;
  action: Record<string, unknown>;
}

export function parseLLMResponse(raw: string): LLMResponse | null {
  try {
    // Try to extract JSON from the response (LLMs sometimes wrap in markdown)
    let jsonStr = raw;
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    // Also try to find raw JSON object
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];

    const parsed = JSON.parse(jsonStr);
    return {
      thinking: String(parsed.thinking || ''),
      strategy: String(parsed.strategy || ''),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      action: parsed.action || {},
    };
  } catch {
    return null;
  }
}

// === LLM Provider Interface ===

export interface LLMProvider {
  /** Send a prompt and get a text response */
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
  /** Name of the model for logging */
  modelName: string;
}

// === Claude Provider (Anthropic API) ===

export function createClaudeProvider(apiKey: string, model = 'claude-sonnet-4-20250514'): LLMProvider {
  return {
    modelName: model,
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 500,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Claude API error: ${response.status} — ${err}`);
      }

      const data = await response.json() as { content: Array<{ text: string }> };
      return data.content[0]?.text || '';
    },
  };
}

// === OpenAI-Compatible Provider ===

export function createOpenAIProvider(
  apiKey: string,
  model = 'gpt-4o-mini',
  baseUrl = 'https://api.openai.com/v1',
): LLMProvider {
  return {
    modelName: model,
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI API error: ${response.status} — ${err}`);
      }

      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
      return data.choices[0]?.message?.content || '';
    },
  };
}

// === Create an LLM-Powered Agent ===

export function createLLMAgent(
  config: AgentConfig,
  provider: LLMProvider,
): DecideActionAsyncFn {
  const systemPrompt = buildSystemPrompt(config);

  return async (state: GameState): Promise<AgentDecision> => {
    const turnPrompt = buildTurnPrompt(state);

    try {
      const raw = await provider.complete(systemPrompt, turnPrompt);
      const parsed = parseLLMResponse(raw);

      if (!parsed) {
        return {
          action: { type: 'guard', level: 'high', intensity: 0.5 },
          reasoning: {
            thinking: 'Failed to parse LLM response. Defaulting to guard.',
            strategy: 'Error recovery — guarding',
            confidence: 0,
            model: provider.modelName,
          },
        };
      }

      return {
        action: parsed.action as unknown as Action,
        reasoning: {
          thinking: parsed.thinking,
          strategy: parsed.strategy,
          confidence: parsed.confidence,
          model: provider.modelName,
        },
      };
    } catch (err) {
      return {
        action: { type: 'guard', level: 'high', intensity: 0.5 },
        reasoning: {
          thinking: `LLM call failed: ${err instanceof Error ? err.message : 'unknown error'}. Defaulting to guard.`,
          strategy: 'API error — defensive fallback',
          confidence: 0,
          model: provider.modelName,
        },
      };
    }
  };
}
