# Cayed Agent Guide

> High-context guide for agents working in this repo. Read `CONTEXT.md` first for domain glossary, then this file for architecture and constraints.

---

## 1. What Cayed Currently Is

Cayed is a **Battleship game on Solana** using MagicBlock Ephemeral Rollups for private ship placement. One Anchor program, one React frontend. No multi-game support yet. No prediction market yet.

**Core flow:**
1. Player 1 creates a game with grid size and wager → deposits SOL into vault
2. Player 2 joins → deposits matching wager
3. Both players place ships (hidden via ER delegation)
4. Players alternate attacks until all ships on one side are sunk
5. `reveal_winner` declares winner, clears permissions, commits state to base layer
6. **(GAP) Winner should be paid from vault — not yet implemented**

---

## 2. Current Architecture

### 2.1 On-Chain (`programs/cayed/`)

**Program ID**: `6xLHbAHw2ibrmdVEPHm7jDkDmghw3fp3gUCBy511DMKV` (devnet)

**Instructions** (8 total):

| Instruction | Purpose |
|-------------|---------|
| `init_config` | Initialize protocol params (authority, vault, max_grid_size, fee) |
| `create_game` | Player 1 creates game + deposits wager |
| `join_game` | Player 2 joins + deposits wager |
| `hide_ships` | Player places ships on their private board |
| `make_move` | Attack a cell on opponent's board |
| `reveal_winner` | Declare winner, clear permissions, commit/undelegate |
| `create_permission` | ER access control setup |
| `delegate_pda` | Move account to ER validator |

**State accounts:**
- `Config` — protocol-wide params
- `Vault` — wager custody
- `Game` — public session state
- `PlayerBoard` — private per-player state (ships, hits, sunk tracking)

**Key on-chain design:**
- `u64` bitmaps for O(1) hit detection and sunk checking
- Turn order derived from move count parity (no external oracle)
- Ship placement validated for bounds, linearity, and overlap — **but NOT for size** (see Gaps)

### 2.2 Frontend (`web/`)

**Tech**: React 19, Vite 7, TypeScript, Tailwind v4, React Aria Components, React Router 7

**Provider chain** (dependency injection):
```
ThemeProvider → ChainContextProvider → SelectedWalletAccountContextProvider
  → ConnectionContextProvider → GameServiceProvider → App
```

**Service layer:**
- `GameService` — all program interactions, dual connection (devnet + ER), auth token management, instruction bundling
- `pda.ts` — centralized PDA derivation
- `fetch-accounts.ts` — account fetching with ER fallback

**Pages:**
- `/` — home/arcade launcher
- `/battleship` — lobby (create/join)
- `/battleship/:gameId` — active game (stage router)

**Game stages** (rendered by `game.tsx` based on `GameStatus`):
`Loading → AwaitingOpponent → Placement → WaitingShips → Battle → Finished → Revealed`

**Client generation:**
```
anchor build → target/idl/cayed.json → bun createCodamaClient.ts → web/client/cayed/
```
The `web/client/` directory is gitignored and must be regenerated after program changes.

---

## 3. Known Gaps (Honest List)

These are real problems in the current MVP. Do not paper over them.

### 3.1 No Payout in `reveal_winner`

**Severity: 🔴 Critical**

`create_game` and `join_game` deposit wagers into the `Vault` PDA via CPI transfer. `reveal_winner` sets the winner in `Game.status` but **never transfers the accumulated wagers out**.

**Fix**: Add payout logic to `reveal_winner`:
```rust
let total_pot = game.wager * 2;
let fee_amount = (total_pot * config.fee as u64) / 10_000;
let payout = total_pot - fee_amount;
// Transfer payout to winner
// Transfer fee to config.authority
```

### 3.2 No Ship Size Enforcement in Program

**Severity: 🔴 Critical**

`hide_ships` validates count, bounds, linearity, and overlap — but a "ship" can be 1 cell or the entire board. The frontend's `getShipSizes()` suggests sizes like `[5,4,3,2,1]` for a 10×5 grid, but the program ignores this.

**Attack vector**: A player can submit 5 single-cell ships via direct transaction, making the game trivial to win.

**Fix**: Add a `required_ship_lengths` parameter (or hardcode per grid size) and validate each ship's cell count in `hide_ships`.

### 3.3 No Timeouts / Forfeit Mechanism

**Severity: 🟡 Acceptable for MVP**

If a player creates a game and no one joins, or if a player stops making moves, wagers lock indefinitely. The `Forfeited` and `Cancelled` statuses exist but have no instruction to set them.

**Fix (post-MVP)**: Add `claim_timeout` instruction with phase-based deadlines (e.g., 24h to join, 10m per move).

### 3.4 Zero Error-Path Tests

**Severity: 🟡 High**

The sole test (`tests/cayed.test.ts`) tests the happy path only. None of the 22 `CayedError` variants are exercised. This means incorrect ship placement, out-of-bounds attacks, duplicate attacks, and invalid turns are all untested.

**Fix**: Add tests for each error variant. See Testing Strategy below.

### 3.5 Monolithic Frontend Component

**Severity: 🟡 Architectural debt**

`web/src/pages/battleship/game.tsx` is 571 lines with PDA derivation, state polling, placement logic, attack handling, winner reveal, keyboard shortcuts, error dismissal, and stage rendering all in one file.

**Fix (post-MVP)**: Extract into hooks:
- `useBattleshipPdas(gameId)` — PDA derivation
- `useBattleshipState(gameService, pdas)` — polling + account fetching
- `useShipPlacement(gridSize, shipSizes)` — placement state machine
- `useBattleshipGame(game, myBoard, opponentBoard)` — turn logic, attacks

Leave in place for now — the user has explicitly deferred this.

### 3.6 No CI Test Step

**Severity: 🟡 Medium**

`.github/workflows/deploy.yml` builds and deploys but never runs tests. Broken code can reach production.

**Fix**: Add `bun test` step before build. May need to adjust for validator availability in CI.

### 3.7 `skipPreflight: true` in Tests

**Severity: 🟡 Medium**

The test helper uses `skipPreflight: true` on every transaction, bypassing simulation. This means simulation errors (e.g., account not found, insufficient funds) are not caught.

**Fix**: Remove `skipPreflight` or add a variant that uses it conditionally.

---

## 4. Testing Reality

### What Exists

**One file**: `tests/cayed.test.ts` (504 lines)
- Full happy-path E2E: init config → create game → join → hide ships → verify privacy → play full game → reveal winner
- Uses real `mb-test-validator` + `ephemeral-validator`
- Tests ER privacy invariant (player can't read opponent board)
- Custom `sendAndConfirmER` helper with retry logic

### What's Missing

| Layer | Status | Needed |
|-------|--------|--------|
| Rust unit tests | ❌ None | `#[cfg(test)]` modules for bitmap math, turn logic, sunk detection |
| Error path tests | ❌ None | One test per `CayedError` variant |
| Frontend unit tests | ❌ None | Component tests for stages, placement validation |
| Integration tests (per-flow) | ❌ None | Separate tests for: create+join, hide ships, move mechanics, reveal |
| CI test step | ❌ None | Run tests in GitHub Actions before deploy |

### Recommended Test Strategy

**Phase 1 (now — fixes the critical gaps):**
1. Add payout test to existing E2E (verify vault balance decreases, winner balance increases)
2. Add ship size validation test (verify `hide_ships` rejects wrong sizes)
3. Add error-path matrix: `InvalidTurn`, `CellAlreadyAttacked`, `AttackOutOfBounds`, `ShipOverlap`, `InvalidShipPlacement`, `ShipsAlreadyPlaced`

**Phase 2 (next):**
1. Add Rust unit tests: `cell_bit()`, `all_ships_sunk()`, `PlayerBoard` bitmap operations
2. Split monolithic test into focused files: `test_config.ts`, `test_game_flow.ts`, `test_gameplay.ts`, `test_reveal.ts`
3. Add frontend tests: placement validation, stage rendering

**Phase 3 (later):**
1. Add timeout/forfeit tests
2. Add fee calculation tests
3. Add edge cases: zero-wager game, max grid size, minimum grid size

---

## 5. Anti-Patterns for This Codebase

### 5.1 Don't Add Multi-Game Abstractions Yet

The codebase is Battleship-only. Do NOT introduce:
- `Session` / `PlayerState` generic accounts
- `GameAdapter` trait or dispatch pattern
- `GameType` enum
- `/games/*` directory structure
- `registry.ts` route system
- Prediction market accounts or instructions

These are planned for the future but will complicate the current MVP. When the time comes, refactor in a dedicated branch.

### 5.2 Don't Call Generated Builders from Components

Always go through `GameService`. The Codama-generated client lives in `web/client/cayed/` and its API can change when the program changes. `GameService` is the stable abstraction layer.

### 5.3 Don't Add Game-Specific Fields to Shared Accounts

If you need Battleship-specific state, put it in `PlayerBoard` or `Game`. Don't create new shared accounts that assume future games.

### 5.4 Don't Bypass Frontend Validation

Any validation the frontend does (ship size, placement bounds) must also be enforced on-chain. A player can always craft a transaction directly.

### 5.5 Don't Use `skipPreflight` in Production Code

The test helper uses it for local validator quirks. Never use it in actual user-facing transaction code.

### 5.6 Don't Poll for Real-Time Updates

Current polling is 3s (`POLL_MS`). This is acceptable for MVP but should be replaced with websocket subscriptions when scaling.

---

## 6. File Priority Map

When touching this codebase, these files matter most (highest to lowest):

### On-Chain (Rust)

| Priority | File | Why |
|----------|------|-----|
| 🔴 | `programs/cayed/src/instructions/reveal_winner.rs` | Missing payout — critical gap |
| 🔴 | `programs/cayed/src/instructions/hide_ships.rs` | Missing ship size validation |
| 🔴 | `programs/cayed/src/instructions/make_move.rs` | Core game logic, turn order, hit detection |
| 🟡 | `programs/cayed/src/state/player_board.rs` | Bitmap math, sunk detection |
| 🟡 | `programs/cayed/src/state/game.rs` | Game status, move history |
| 🟡 | `programs/cayed/src/instructions/create_game.rs` | Wager deposit, game init |
| 🟡 | `programs/cayed/src/instructions/join_game.rs` | P2 join, duplicate deposit logic |
| 🟢 | `programs/cayed/src/instructions/init_config.rs` | Protocol setup |
| 🟢 | `programs/cayed/src/instructions/create_permission.rs` | ER plumbing |
| 🟢 | `programs/cayed/src/instructions/delegate_pda.rs` | ER plumbing |

### Frontend (TypeScript/React)

| Priority | File | Why |
|----------|------|-----|
| 🔴 | `web/src/services/game-service.ts` | All program interactions, auth, bundling |
| 🟡 | `web/src/pages/battleship/game.tsx` | God component — all game logic |
| 🟡 | `web/src/pages/battleship/lobby.tsx` | Create/join flows |
| 🟡 | `web/src/lib/ships.ts` | Placement validation (frontend side) |
| 🟢 | `web/src/services/pda.ts` | PDA derivation |
| 🟢 | `web/src/services/fetch-accounts.ts` | Account fetching with ER fallback |
| 🟢 | `web/src/App.tsx` | Router (hardcoded Battleship routes) |
| 🟢 | `web/src/components/battleship/game-grid.tsx` | Grid rendering |

### Tests

| Priority | File | Why |
|----------|------|-----|
| 🔴 | `tests/cayed.test.ts` | Only test file — needs error paths + payout test |
| 🟡 | `test.sh` | Test runner script |

### Config/Build

| Priority | File | Why |
|----------|------|-----|
| 🟡 | `.github/workflows/deploy.yml` | Missing test step |
| 🟢 | `Anchor.toml` | Program config |
| 🟢 | `createCodamaClient.ts` | Client code generation |

---

## 7. Decision Log

Actual decisions made for this codebase (not aspirational):

| # | Decision | Date | Rationale |
|---|----------|------|-----------|
| 1 | Single Anchor program | Initial | Fastest path for a small team |
| 2 | MagicBlock ER for private state | Initial | Required for hidden ship placements |
| 3 | Bitmap-based hit tracking | Initial | O(1) operations, fits in single u64 |
| 4 | Turn parity + game_id for first move | Initial | No external oracle needed |
| 5 | `u64` bitmap with grid_size ≤ 10 | Initial | Max 50 cells fits in u64 |
| 6 | Zero-wager games allowed | Initial | Free play mode |
| 7 | Polling (3s) instead of websockets | Initial | Simpler MVP, deferred real-time |
| 8 | No timeouts for MVP | May 2026 | Complexity deferred, indefinite locking accepted |
| 9 | No ship size enforcement (yet) | May 2026 | Frontend guides sizes, program trusts input |
| 10 | God component accepted for velocity | May 2026 | Extract later when adding features |

---

## 8. Quick Reference

### Run Tests
```bash
./test.sh
# or
cd web && bun test
```

### Generate Client
```bash
anchor build
bun createCodamaClient.ts
```

### Dev Frontend
```bash
cd web && bun run dev
```

### Deploy
```bash
# CI handles: anchor build → gen client → vite build → gh-pages
```

---

## 9. What NOT in This File

The following have been **removed** from this guide because they describe code that does not exist:

- ❌ `Session` / `PlayerState` generic accounts
- ❌ `GameAdapter` trait or `games/` module
- ❌ `submit_action` / `settle_session` instructions
- ❌ Prediction market (`Market`, `BetPosition`, `result_code`)
- ❌ 5-game catalog and 28-day roadmap
- ❌ `/games/*` registry-driven routing
- ❌ `GameType` enum

When the codebase actually contains these, this guide will be updated.
