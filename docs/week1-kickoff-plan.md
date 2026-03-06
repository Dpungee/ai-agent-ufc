# AI Agent UFC — Week 1 Technical Kickoff Plan

**For:** Contractors (Backend Engineer + Frontend Engineer)
**Goal:** By end of Week 1, have a working match engine that can run a fight, store a replay, and prove determinism with tests.

---

## What We're Building (Big Picture)

A competitive platform where AI agents fight each other in a structured, turn-based arena — like UFC but for AI. Users create agents (via prompts + sliders), agents fight under strict rules, spectators watch live, and outcomes update rankings.

**The MVP is:** turn-based 2D arena, prompt-based agents (LLM-powered), live WebSocket broadcast, deterministic replays, ranked matchmaking with Elo.

---

## Week 1 Deliverables

### 1. Action & State JSON Schemas

Define the exact data contracts the entire system runs on. Everything else depends on these.

**State schema** (what each agent sees per turn):
```
turn_number, round_number, time_left
self: { hp, stamina, guard, position, cooldowns, balance }
opponent: { hp_estimate, stamina_estimate, position, last_action }
arena: { width, height }
history: [ last 5 actions ]
```

**Action schema** (what each agent outputs):
```
{ type: "strike|hook|kick|guard|special",
  variant: "jab|cross|...",     (for strikes)
  target: "head|body|leg",       (for attacks)
  power: 0.0-1.0 }
```

**Deliverable:** TypeScript types + JSON Schema files in `/schemas/`. Validated with ajv or zod.

### 2. Deterministic Match Engine

The core game loop. This is the most important piece — get it right and everything else is straightforward.

**Requirements:**
- Takes: initial seed + two agent decision functions
- Produces: ordered list of turn events + final result
- MUST be deterministic: same seed + same actions = identical output every time
- Uses seeded PRNG (e.g., Mulberry32) — no Math.random() anywhere
- Runs headless (no UI dependency)

**Game rules to implement:**
- 6 action types: move, jab, hook, kick, guard, special
- HP (100), Stamina (100), Guard (100), Balance (knockdown threshold)
- Stamina costs per action, regen per turn
- Accuracy rolls, damage ranges, guard damage reduction
- Cooldowns on special moves
- Win conditions: KO (HP=0), TKO (3 knockdowns), Decision (scorecard after max rounds), DQ (repeated fouls)

**Structure:**
```
/engine/
  types.ts          — State, Action, MatchResult, TurnEvent
  rng.ts            — Seeded PRNG
  rules.ts          — Damage formulas, stamina costs, accuracy
  engine.ts         — Main loop: runMatch(config) → MatchResult
  validator.ts      — Action validation + clamping
  config.ts         — All balance parameters (not hardcoded)
```

**Deliverable:** `engine.ts` with `runMatch()` that returns a full match result with all turns logged.

### 3. Replay Format & Storage

Every match must be replayable from its data alone.

**Replay format:**
```json
{
  "version": "1.0",
  "engine_version": "0.1.0",
  "seed": 1234567890,
  "fighters": {
    "a": { "style": "aggro", "params": {...} },
    "b": { "style": "counter", "params": {...} }
  },
  "turns": [
    { "turn": 1, "action_a": {...}, "action_b": {...}, "events": [...], "state_hash": "abc123" }
  ],
  "result": { "winner": "a", "method": "ko", "round": 2 }
}
```

**State hashing:** SHA-256 hash of the serialized state each turn. This enables integrity verification and cheat detection later.

**Deliverable:** Replay JSON writer + a replay runner that can re-execute a match from replay data and verify it matches.

### 4. Determinism Tests

**Critical test:** Run the same match (same seed, same agent configs) 100 times. Every run MUST produce identical output, byte-for-byte.

**Additional tests:**
- Invalid action rejection (unknown fields, out-of-range values)
- Stamina enforcement (can't use action you can't afford)
- Cooldown enforcement
- Win condition triggers (KO at 0 HP, TKO at 3 knockdowns)
- Timeout behavior (default guard action)
- Replay verification (re-run from replay data, compare hashes)

**Deliverable:** Test suite with 20+ test cases. Use vitest or jest. CI must pass before any PR merges.

### 5. Simple Agent Implementations (for testing)

Build 3-4 "bot" agents to test the engine against:

- **Random agent:** picks a valid action at random (using seeded RNG)
- **Aggro bot:** always strikes, uses special when available
- **Turtle bot:** always guards unless stamina is full
- **Mirror bot:** copies opponent's last action

These also serve as the foundation for the 6 built-in agents mentioned in the blueprint.

**Deliverable:** Agent functions that implement `decideAction(state) → action`.

---

## Tech Stack for Week 1

| Component | Choice | Why |
|-----------|--------|-----|
| Language | TypeScript | Type safety, same language front+back |
| Runtime | Node.js 20+ | Stable, fast enough for turn-based |
| Package manager | pnpm | Fast, strict |
| Testing | vitest | Fast, TS-native |
| Schema validation | zod | Runtime + type inference |
| Project structure | Monorepo (turborepo) | Shared types between engine/api/web |

### Repo Structure
```
ai-agent-ufc/
├── packages/
│   ├── engine/        ← Week 1 focus
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── rng.ts
│   │   │   ├── rules.ts
│   │   │   ├── engine.ts
│   │   │   ├── validator.ts
│   │   │   └── config.ts
│   │   ├── tests/
│   │   └── package.json
│   ├── api/           ← Week 2
│   ├── web/           ← Week 3
│   └── shared/        ← Shared types/schemas
├── turbo.json
├── package.json
└── README.md
```

---

## How to Hire for This

You need two contractors to start:

### Backend / Engine Developer
**What they'll do:** Build the match engine, API, matchmaking, and database layer.
**Skills:** TypeScript, Node.js, PostgreSQL, Redis, WebSockets. Game engine experience is a plus but not required — this is turn-based logic, not physics.
**Where to find:** Upwork, Toptal, or r/gamedev. Search for "multiplayer game server" or "turn-based game engine" experience.
**Rate:** $60-120/hr depending on experience.
**Week 1 scope:** Items 1-5 above.

### Frontend Developer
**What they'll do:** Build the web app — lobby, agent builder, broadcast viewer, replays.
**Skills:** Next.js, TypeScript, React, WebSocket client, Canvas/WebGL for the arena view.
**Where to find:** Same platforms. Look for experience with real-time data visualization or sports/esports UIs.
**Rate:** $50-100/hr.
**Week 1 scope:** Can start on the broadcast viewer layout and agent builder UI while the engine is being built. Wire up to real engine in Week 3.

### What to put in the job posting
> "Building an AI competition platform (think UFC for AI agents). Need a TypeScript developer to build a deterministic turn-based match engine. The engine runs fights between AI agents, validates actions, resolves combat, and produces replayable match logs. Week 1 is the core engine + tests. Weeks 2-4 add API, matchmaking, and live streaming."

---

## Key Decisions Already Made

These are locked in for MVP (from the blueprint). Don't revisit unless there's a blocking technical reason:

1. **Turn-based, not real-time** — simpler, scalable, deterministic
2. **Prompt-based agents only for MVP** — no user code execution yet
3. **Seeded PRNG for all randomness** — enables perfect replays
4. **Engine is stateless** — receives config, returns result
5. **All balance params in config** — never hardcoded
6. **PostgreSQL + Redis** — proven stack, well-understood
7. **Next.js + TypeScript** — one language across the stack

---

## Definition of Done (Week 1)

- [ ] Can run `pnpm test` and all 20+ tests pass
- [ ] Can run a match between two bot agents from the command line
- [ ] Match produces a replay JSON file
- [ ] Replaying that JSON produces identical output (verified by state hashes)
- [ ] Action validation rejects bad inputs gracefully
- [ ] All code is typed (no `any`)
- [ ] README explains how to run the engine and tests
