# Cayed Agent Guide

Purpose: This file is a high-context architecture guide for coding agents working in this repo.

Primary goal:
1. Give enough architectural context that agents can act with minimal repo re-discovery.
2. Reduce token usage by centralizing decisions, constraints, and tradeoffs.
3. Keep implementation aligned with the 28-day target: `5+ games + simplified prediction market` on a modular single core program.

Status note:
1. Cayed started as Battleship-first.
2. The direction is now an on-chain consumer arcade.
3. Route system should use `/games/*` for all game and `/market` for markets.

## 1. Project Thesis

Cayed is positioning as a consumer on-chain arcade, not a DeFi terminal.

Key UX thesis:
1. Users should understand game loops in seconds.
2. Wager flow should feel simple and transparent.
3. Settlement should be trustless and verifiable.
4. Prediction is a lightweight spectator/player layer, not a full exchange.

Core technology thesis:
1. One modular Anchor program gives the best sprint velocity for a duo team.
2. MagicBlock ER is used for private state and responsive gameplay.
3. Game-specific logic lives in adapters/modules, while custody/settlement/privacy remain core.

## 2. North-Star Deliverables (Day 28)

Must-have outcomes:
1. 5+ games with full create/join/play/settle lifecycle.
2. Simplified prediction market tied to game outcomes.
3. Frontend routes and codebase organized under `/games/*`.
4. Reusable architecture for adding new games without reworking core.

Definition of done for each game:
1. On-chain flow works: create session, join session, play actions, settle session.
2. Frontend flow works under `/games/<slug>` and `/games/<slug>/<sessionId>`.
3. Outcome maps to a `result_code` consumed by market settlement.
4. Error states are user-readable and mapped from program errors.

## 3. Architecture Decision Record (ADR)

Decision:
1. Use a single modular core program for this sprint.

Alternatives considered:
1. One program per game.
2. Core program plus separate market program now.
3. Keep current monolithic Battleship-centric pattern.

Why single modular core wins now:
1. Fastest execution path for a small team.
2. One deploy path, one IDL generation path, one client package.
3. Shared fee/wager/privacy logic avoids duplicated security-critical code.
4. Lowest frontend integration overhead in a 28-day window.

Known cost of this decision:
1. Shared upgrade blast radius.
2. Larger binary and IDL over time.
3. Greater need for internal module boundaries and tests.

Risk controls:
1. Hard boundaries in folder/module layout.
2. Per-game adapter test suites.
3. Feature flags in game registry.
4. Freeze schema boundaries after week 1.

## 4. Design Principles (Non-Negotiable)

1. Keep state and instruction naming game-agnostic in core.
2. Keep game rule logic isolated in `games/*` adapters.
3. Keep ER permission/delegation logic in core only.
4. Keep generated client usage inside service layers, not pages/components.
5. Add games by composing contracts, not by branching core flow.
6. Avoid frontend route hardcoding; use registry-driven mounting.

## 5. Current Coupling and What Must Change

Current coupling hotspots:
1. `programs/cayed/src/state/game.rs` uses battleship-specific fields.
2. `programs/cayed/src/instructions/hide_ships.rs` and `make_move.rs` embed battleship rules.
3. `web/src/App.tsx` and `web/src/services/game-service.ts` are battleship-oriented.

Refactor target:
1. Replace `Game` concept with generic `Session`.
2. Replace `PlayerBoard` with generic delegated `PlayerState` blob.
3. Replace battleship action instructions with generic `submit_action` and adapter dispatch.
4. Move UI and service layering to `/games/*` modules.

## 6. On-Chain Architecture (Target)

### 6.1 Module Layout

Recommended shape in `programs/cayed/src/`:

```text
src/
  lib.rs
  errors.rs
  instructions/
    core/
      init_config.rs
      create_session.rs
      join_session.rs
      submit_action.rs
      settle_session.rs
      create_permission.rs
      delegate_pda.rs
    market/
      create_market.rs
      place_bet.rs
      resolve_market.rs
      claim_payout.rs
    mod.rs
  state/
    config.rs
    vault.rs
    session.rs
    player_state.rs
    market.rs
    bet_position.rs
    mod.rs
  games/
    mod.rs
    adapter.rs
    battleship.rs
    coinflip_duel.rs
    high_card.rs
    tic_tac_toe.rs
    dice_hi_lo.rs
```

Why this split:
1. `instructions/core` = shared lifecycle/custody/security logic.
2. `instructions/market` = simplified market flow without contaminating game core.
3. `games/*` = rule engines per game.
4. `state/*` = stable account model boundaries.

Pros:
1. Easier ownership of concerns.
2. Easier code reviews and regression analysis.
3. Easier extension to new games.

Cons:
1. More files and plumbing initially.
2. Requires discipline in where logic lives.

### 6.2 Core State Model

#### `Session`

Suggested fields:

```rust
pub struct Session {
    pub id: u64,
    pub game_type: GameType,
    pub player_1: Pubkey,
    pub player_2: Option<Pubkey>,
    pub wager_lamports: u64,
    pub next_actor: Pubkey,
    pub move_count: u16,
    pub status: SessionStatus,
    pub winner: Option<Pubkey>,
    pub result_code: Option<u8>,
    pub bump: u8,
}
```

Why this shape:
1. Works for turn-based and instant-settlement games.
2. `result_code` unifies game settlement with market settlement.
3. `game_type` is the dispatch anchor.

Pros:
1. Stable generic lifecycle.
2. Easy market linkage.
3. Easy frontend representation.

Cons:
1. Some games need richer metadata in private state blobs.
2. Validation complexity moves into adapters.

#### `PlayerState`

Suggested fields:

```rust
pub struct PlayerState {
    pub session_id: u64,
    pub player: Pubkey,
    pub game_type: GameType,
    pub state_version: u16,
    pub state_blob: Vec<u8>,
    pub bump: u8,
}
```

Why blob-based private state:
1. Supports hidden info games (Battleship, card games).
2. Keeps core accounts stable while game internals evolve.
3. Enables adapter-local schema evolution (`state_version`).

Pros:
1. Very flexible.
2. Prevents core account explosion.

Cons:
1. Requires strict decode guards.
2. Corruption risk if versioning is ignored.

#### `Market` + `BetPosition`

Simplified market model:
1. One market references one session.
2. Two outcomes only.
3. Bet positions are per bettor and side.

Pros:
1. Minimal implementation risk.
2. Easy UX and settlement.

Cons:
1. Not as expressive as order-book/AMM systems.
2. Limited market design in v1.

### 6.3 Game Adapter Contract

Core adapter interface:

```rust
pub trait GameAdapter {
    fn init_state(params: &[u8]) -> Result<Vec<u8>>;
    fn validate_action(state: &[u8], action: &[u8], actor: Pubkey) -> Result<()>;
    fn apply_action(state: &[u8], action: &[u8], actor: Pubkey) -> Result<ApplyResult>;
    fn is_terminal(state: &[u8]) -> Result<bool>;
    fn resolve_outcome(state: &[u8]) -> Result<Outcome>;
}
```

Dispatch style:

```rust
match session.game_type {
    GameType::Battleship => battleship::apply(...),
    GameType::CoinflipDuel => coinflip_duel::apply(...),
    GameType::HighCard => high_card::apply(...),
    GameType::TicTacToe => tic_tac_toe::apply(...),
    GameType::DiceHiLo => dice_hi_lo::apply(...),
}
```

Pros:
1. Compile-time deterministic module selection.
2. Keeps instruction surface stable while adding games.
3. Easy to test per adapter.

Cons:
1. Program grows as game count grows.
2. Care needed to avoid adapter side effects bleeding into core.

### 6.4 Instruction Surface

Core instructions:
1. `init_config(max_state_bytes, fee_bps, min_wager)`
2. `create_session(id, game_type, wager, game_init_params)`
3. `join_session()`
4. `submit_action(action_blob)`
5. `settle_session()`
6. `create_permission(account_type, members)`
7. `delegate_pda(account_type)`

Market instructions:
1. `create_market(market_id, session_id, outcome_a_code, outcome_b_code)`
2. `place_bet(side_code, amount)`
3. `resolve_market()`
4. `claim_payout()`

Design note:
1. Keep action payloads compact.
2. Keep serialization contract stable and versioned.
3. Prefer error enums that are adapter-prefixed but routed through common user-facing mapping.

### 6.5 PDA Strategy

Stable seeds:
1. `Config`: `["config"]`
2. `Vault`: `["vault"]`
3. `Session`: `["session", id.to_le_bytes()]`
4. `PlayerState`: `["player_state", session_id.to_le_bytes(), player.as_ref()]`
5. `Market`: `["market", market_id.to_le_bytes()]`
6. `BetPosition`: `["bet", market_id.to_le_bytes(), bettor.as_ref(), side_code]`

Why this seed plan:
1. Human-readable and debuggable.
2. Predictable client derivation.
3. Works cleanly for account indexing.

## 7. MagicBlock ER Strategy

Core rule:
1. ER-related account privacy and delegation belong to core instructions.
2. Game adapters do not perform permission/delegation orchestration.

Session lifecycle with ER:
1. Create/join on base layer and fund vault.
2. Create permissions and delegate private state accounts.
3. Run hidden or rapid gameplay actions on ER.
4. Settle by resolving outcome, clearing permissions, and commit/undelegate.

Pros:
1. Uniform privacy/security path across games.
2. Less risk of per-game ER misconfiguration.

Cons:
1. Requires robust shared utilities and tests.
2. ER integration bugs can affect all games.

Mitigation:
1. Keep ER logic isolated in `instructions/core`.
2. Add ER privacy regression tests per game.

## 8. Frontend Architecture (`/games/*`)

### 8.1 Folder Plan

```text
web/src/
  core/
    context/
    providers/
    rpc/
    wallet/
  games/
    registry.ts
    battleship/
      index.ts
      routes.tsx
      service.ts
      hooks/
      pages/
      components/
      types.ts
    coinflip-duel/
    high-card/
    tic-tac-toe/
    dice-hi-lo/
    prediction/
  shared/
    components/
    hooks/
    tx/
    account/
  App.tsx
  main.tsx
```

Why this split:
1. `core` for platform concerns.
2. `games/<slug>` for isolated game modules.
3. `shared` for reusable UI and data hooks.

Pros:
1. New game onboarding is predictable.
2. Router and app shell remain stable.
3. Easier lazy-loading and feature flags.

Cons:
1. Requires discipline to avoid leaking game logic into `core`.
2. Some duplication acceptable for speed.

### 8.2 Route Contract

Required route shape:
1. `/` arcade launcher.
2. `/games/:slug` lobby/detail entrypoint.
3. `/games/:slug/:sessionId` active session page.
4. `/games/prediction` market flows.

Rules:
1. No hardcoded battleship routes in app shell.
2. Every game route must be registry-generated.

### 8.3 Registry Contract

`web/src/games/registry.ts`:

```ts
type GameDefinition = {
  slug: string;
  title: string;
  isEnabled: boolean;
  serviceFactory: () => GameService;
  routes: React.ReactNode;
  marketOutcomeMap: Record<string, number>;
};
```

Pros:
1. Feature-flag rollout control.
2. Launcher UI generated from metadata.
3. No repeated router edits.

Cons:
1. Bad registry metadata can break route discovery.
2. Need simple runtime validation.

### 8.4 Service Layer Strategy

Split existing `web/src/services/game-service.ts` into:
1. `web/src/core/rpc/core-session-service.ts`.
2. `web/src/games/<slug>/service.ts`.

Core service owns:
1. connection selection (devnet vs ER).
2. tx assembly/send lifecycle.
3. auth token management.
4. common PDA derivation helpers.

Game service owns:
1. game action encoding/decoding.
2. game state view-model mapping.
3. game-specific command methods.

Anti-pattern to avoid:
1. Calling generated instruction builders directly from page components.

## 9. Prediction Market in Same Program Scope

Scope constraints for v1 market:
1. Two outcomes only.
2. Session-linked only.
3. No orderbook and no complex market making.
4. Payout based only on `Session.result_code`.

Pros:
1. Deliverable in sprint timeline.
2. Clear user understanding.
3. Lower audit and implementation risk.

Cons:
1. Limited strategy expressiveness.
2. Not suitable for advanced traders.

Reason this is acceptable now:
1. Cayed is consumer-first game platform.
2. Prediction layer is augmentative, not primary product.

## 10. Testing and Quality Strategy

Test layers:
1. Core lifecycle tests.
2. Per-game adapter tests.
3. ER privacy tests.
4. Market tests.
5. Cross-game smoke test.

Proposed layout:

```text
tests/
  harness/
    validator.ts
    fixtures.ts
    tx.ts
  games/
    battleship.test.ts
    coinflip-duel.test.ts
    high-card.test.ts
    tic-tac-toe.test.ts
    dice-hi-lo.test.ts
  market/
    prediction.test.ts
  smoke/
    full-arcade.test.ts
```

Why this matters:
1. Guards against regression while adding games quickly.
2. Keeps confidence high with shared-core architecture.
3. Localizes failures to game adapters when possible.

## 11. 28-Day Delivery Plan (Execution-Centric)

Week 1:
1. Introduce generic state (`Session`, `PlayerState`) and adapter interface.
2. Keep Battleship functionality intact via adapter wrapper.
3. Freeze initial schema boundaries.

Week 2:
1. Add `coinflip-duel` and `high-card` adapters.
2. Move frontend to `/games/*` registry and routes.
3. Split service layers.

Week 3:
1. Add `tic-tac-toe` and `dice-hi-lo` adapters.
2. Add shared frontend hooks/components.
3. Expand E2E matrix and ER regressions.

Week 4:
1. Add simplified market accounts/instructions.
2. Add `/games/prediction` UI flow.
3. Stabilize, polish, and demo-hardening.

## 12. Game Catalog and Rationale

Recommended lineup:
1. `battleship`: flagship hidden-state game and ER showcase.
2. `coinflip-duel`: fastest low-risk game for throughput.
3. `high-card`: simple PvP with strong wagering intuition.
4. `tic-tac-toe`: familiar turn-based benchmark.
5. `dice-hi-lo`: quick risk/reward loop and replayability.

Why this set:
1. Mixes hidden-state, turn-based, and instant games.
2. Good demo coverage for architecture flexibility.
3. Balanced implementation complexity for a duo.

## 13. Error Design and UX Mapping

Guideline:
1. Keep adapter errors precise, but map to concise user language.
2. Include shared errors for lifecycle and wagering constraints.

Examples of user-facing mapping categories:
1. session state invalid.
2. unauthorized actor.
3. invalid action format.
4. not your turn.
5. market not resolvable.

## 14. Performance and Compute Notes

Hot paths likely to need optimization:
1. `submit_action` dispatch and state decode/encode.
2. settle path with ER commit/undelegate.
3. market payout scans.

Controls:
1. Keep blobs compact.
2. Avoid unnecessary vector growth.
3. Profile adapter-specific CU costs.
4. Prefer fixed-size or bounded structures where feasible.

## 15. Security and Integrity Notes

Key concerns:
1. Blob decode safety and version checks.
2. Outcome tampering between session settle and market resolve.
3. Unauthorized private-state reads during active sessions.
4. Re-entrancy-like sequencing mistakes in settlement/claim logic.

Controls:
1. strict state versioning.
2. deterministic result-code mapping.
3. enforce session terminal status before market resolve.
4. comprehensive negative-path tests.

## 16. Agent Workflow Guidance (Token-Efficient)

When an agent starts work:
1. Read this file first.
2. Confirm target is still single-program modular architecture.
3. Verify routes are `/games/*`.
4. Check for latest schema names in state/instructions before coding.

When proposing changes:
1. Preserve core-vs-game-vs-market boundaries.
2. Avoid introducing game-specific fields into core accounts.
3. Keep generated client usage inside service wrappers.
4. Add tests in the right layer.

When reviewing PRs:
1. Ask whether change belongs in core or adapter.
2. Check if new game can be added without changing core lifecycle logic.
3. Check if frontend uses registry rather than route hardcoding.
4. Check if result_code mapping remains stable for market settlement.

## 17. Anti-Patterns to Avoid

1. Adding new game-specific fields directly to `Session` for one game only.
2. Hardcoding game routes in `App.tsx` repeatedly.
3. Embedding Codama generated builders inside UI pages.
4. Implementing ER permission logic separately per game module.
5. Expanding market scope to orderbook/AMM in this sprint.

## 18. Immediate Refactor Checklist

On-chain:
1. Add `GameType` enum and `Session` account.
2. Add `PlayerState` and migrate from board-specific assumptions.
3. Add adapter trait and Battleship adapter implementation.
4. Introduce `submit_action` and `settle_session`.
5. Add market accounts and instructions with simplified constraints.

Frontend:
1. Add `web/src/games/registry.ts`.
2. Migrate routing to `/games/:slug` and `/games/:slug/:sessionId`.
3. Move battleship code under `web/src/games/battleship`.
4. Create game scaffolds for the other four games.
5. Add `/games/prediction` flow.

Testing:
1. Split monolithic tests into harness + per-game + market + smoke.
2. Add ER privacy regressions for each hidden/private-state game.

## 19. File-Level Priority Map

Highest priority on-chain files:
1. `programs/cayed/src/lib.rs`
2. `programs/cayed/src/state/game.rs` to be replaced by `session.rs`
3. `programs/cayed/src/state/player_board.rs` to evolve toward `player_state.rs`
4. `programs/cayed/src/instructions/make_move.rs` to evolve toward `submit_action.rs`
5. `programs/cayed/src/instructions/reveal_winner.rs` to evolve toward `settle_session.rs`

Highest priority frontend files:
1. `web/src/App.tsx`
2. `web/src/main.tsx`
3. `web/src/services/game-service.ts`
4. `web/src/pages/battleship/*` to migrate under `web/src/games/battleship/*`
5. `web/src/games/registry.ts` new

## 20. Known Open Questions (Track Explicitly)

1. Which simplified payout model first: pari-mutuel-lite or fixed-odds?
2. Should single-player games be allowed in v1 market, or only PvP sessions?
3. What is the exact maximum `state_blob` size per game to cap compute/storage?
4. Which game-specific fields belong in `Session` versus encoded state blob?

If unresolved, default choices:
1. pari-mutuel-lite for simple fairness and no external odds dependency.
2. market enabled first for PvP sessions only.
3. conservative capped blob size with adapter-level validation.
4. keep `Session` minimal and adapter state in blob.

## 21. Positioning Reminder

Cayed should feel like an arcade first:
1. fast loops.
2. clean wager UX.
3. trustless settlement.
4. prediction as optional enhancement.

If an implementation choice improves technical purity but hurts this consumer feel or timeline, prefer the pragmatic option that ships within 28 days.
