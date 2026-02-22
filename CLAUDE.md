# Cayed — On-Chain Battleships

## Project Overview

**Cayed** is a fully on-chain Battleships game built on Solana using the **Anchor** framework and **MagicBlock's Ephemeral Rollups (ER)** for private state and high-throughput gameplay. Players place ships on a hidden board, take turns attacking each other's cells, and the first player to sink all opponent ships wins the wagered SOL.

The key innovation is using MagicBlock's **permission system** and **account delegation** so that each player's board state is hidden from the opponent during gameplay — ship positions are only visible to the owning player on the Ephemeral Rollup, then committed back to the base Solana layer when the game ends.

---

## Repository Structure

```
cayed/
├── Anchor.toml                  # Anchor config (devnet, program ID, test script)
├── Cargo.toml                   # Rust workspace (members: programs/*)
├── package.json                 # Root JS/TS deps, scripts (gen:client, test, lint)
├── tsconfig.json                # Root TS config with @client/* path alias
├── rust-toolchain.toml          # Rust 1.89.0, rustfmt + clippy
├── createCodamaClient.ts        # Codama client generation script
├── test.sh                      # Full integration test runner (validators + anchor test)
├── CLAUDE.md                    # This file
│
├── programs/cayed/              # Anchor on-chain program (Rust)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs               # Program entrypoint, instruction dispatch
│       ├── errors.rs            # Custom CayedError enum
│       ├── instructions/        # One file per instruction handler
│       │   ├── mod.rs
│       │   ├── init_config.rs
│       │   ├── create_game.rs
│       │   ├── join_game.rs
│       │   ├── hide_ships.rs
│       │   ├── make_move.rs
│       │   ├── reveal_winner.rs
│       │   ├── create_permission.rs
│       │   └── delegate_pda.rs
│       └── state/               # Account structs
│           ├── mod.rs
│           ├── config.rs
│           ├── game.rs
│           ├── player_board.rs
│           └── vault.rs
│
├── web/                         # Frontend (React + Vite + Tailwind)
│   ├── CLAUDE.md                # Frontend-specific docs (React Aria, conventions)
│   ├── client/cayed/            # Codama-generated TypeScript client
│   └── src/                     # React app source
│
├── tests/
│   └── cayed.test.ts            # End-to-end integration test
│
├── target/                      # Anchor build artifacts (IDL, deploy, types)
└── test-ledger/                 # Local validator ledger (gitignored)
```

---

## On-Chain Program (Anchor)

**Program ID:** `3jatZuig82z7WWiKJmtzeiWoK2hxQnUwfAFNcJJPXAyN`

### Dependencies

| Crate                   | Version  | Purpose                                                          |
| ----------------------- | -------- | ---------------------------------------------------------------- |
| `anchor-lang`           | `0.32.1` | Solana program framework (with `init-if-needed` feature)         |
| `ephemeral-rollups-sdk` | `0.8.0`  | MagicBlock ER integration (`anchor` + `access-control` features) |

### Account State

#### `Config` (seed: `["config"]`)

Global singleton holding game parameters.

| Field           | Type     | Description                         |
| --------------- | -------- | ----------------------------------- |
| `authority`     | `Pubkey` | Admin who can update config         |
| `vault`         | `Pubkey` | Vault address where fees collect    |
| `max_grid_size` | `u8`     | Maximum allowed grid size           |
| `fee`           | `u16`    | Fee in basis points (10,000 = 100%) |
| `bump`          | `u8`     | PDA bump seed                       |

#### `Vault` (seed: `["vault"]`)

Simple account holding wager deposits.

| Field       | Type     | Description     |
| ----------- | -------- | --------------- |
| `authority` | `Pubkey` | Vault authority |

#### `Game` (seed: `["game", id.to_le_bytes()]`)

Tracks the state of a single game between two players.

| Field                     | Type                   | Description                                             |
| ------------------------- | ---------------------- | ------------------------------------------------------- |
| `id`                      | `u64`                  | Unique game identifier                                  |
| `grid_size`               | `u8`                   | Grid dimensions (must be even, e.g. 4 = 4×2 per player) |
| `player_1`                | `Pubkey`               | Creator of the game                                     |
| `player_2`                | `Option<Pubkey>`       | Opponent (None until joined)                            |
| `revealed_ships_player_1` | `Vec<ShipCoordinates>` | P1's ships (max 5), populated after reveal              |
| `revealed_ships_player_2` | `Vec<ShipCoordinates>` | P2's ships (max 5), populated after reveal              |
| `next_move_player_1`      | `bool`                 | Whether P1 moves first (determined by `id % 2`)         |
| `wager`                   | `u64`                  | SOL wager amount in lamports                            |
| `status`                  | `GameStatus`           | Current game lifecycle state                            |
| `bump`                    | `u8`                   | PDA bump seed                                           |

#### `GameStatus` (enum)

```
AwaitingPlayerTwo → InProgress → AwaitingWinnerReveal → Completed { winner }
                                                      → Cancelled
                                                      → Forfeited
```

#### `PlayerBoard` (seed: `["player", game_id.to_le_bytes(), player.as_ref()]`)

Per-player private board state. Delegated to the Ephemeral Rollup during gameplay.

| Field              | Type                   | Description                             |
| ------------------ | ---------------------- | --------------------------------------- |
| `game_id`          | `u64`                  | Associated game ID                      |
| `player`           | `Pubkey`               | Owner of this board                     |
| `bump`             | `u8`                   | PDA bump seed                           |
| `ship_coordinates` | `Vec<ShipCoordinates>` | Ship placements (max 5)                 |
| `hits_received`    | `Vec<Coordinate>`      | Attacks received on this board (max 50) |

#### `ShipCoordinates`

```rust
{ start_x: u8, start_y: u8, end_x: u8, end_y: u8 }
```

Defines a ship as a rectangle from `(start_x, start_y)` to `(end_x, end_y)`. Ships can be horizontal, vertical, or single-cell.

#### `Coordinate`

```rust
{ x: u8, y: u8 }
```

### PDA Seeds Reference

| Account     | Seeds                                               |
| ----------- | --------------------------------------------------- |
| Config      | `["config"]`                                        |
| Vault       | `["vault"]`                                         |
| Game        | `["game", game_id (u64 LE bytes)]`                  |
| PlayerBoard | `["player", game_id (u64 LE bytes), player_pubkey]` |

### Instructions

#### 1. `init_config(max_grid_size: u8, fee: u16)`

- **Signer:** `authority`
- **Creates:** `Config` PDA and `Vault` PDA (both `init_if_needed`)
- **Purpose:** One-time setup of global game parameters

#### 2. `create_game(id: u64, grid_size: u8, wager: u64)`

- **Signer:** `player` (becomes `player_1`)
- **Creates:** `Game` PDA and player 1's `PlayerBoard` PDA
- **Validation:** Grid size must be even and > 0; wager must be ≥ 100,000 lamports if non-zero
- **Effect:** Transfers wager SOL from player to vault; sets `next_move_player_1 = (id % 2 == 0)`

#### 3. `join_game()`

- **Signer:** `player` (becomes `player_2`)
- **Creates:** Player 2's `PlayerBoard` PDA
- **Validation:** Cannot join own game; game must not already have a player 2
- **Effect:** Transfers matching wager to vault; sets `game.player_2`

#### 4. `hide_ships(ships: Vec<ShipCoordinates>)`

- **Signer:** `player`
- **Runs on:** Ephemeral Rollup (after delegation)
- **Validation:** Ships cannot already be placed; all coordinates must be within bounds (`x < grid_size`, `y < grid_size / 2`)
- **Effect:** Writes ship placements to the player's board (private — only visible to the owning player via ER permissions)

#### 5. `make_move(x: u8, y: u8)`

- **Signer:** `player`
- **Runs on:** Ephemeral Rollup
- **Validation:**
  - Both players must have placed ships
  - Turn order enforced via total move count parity and `next_move_player_1`
  - Opponent account must match the game's recorded players
  - Attack coordinates must be within bounds (`x < grid_size`, `y < grid_size / 2`)
  - Cell must not have been previously attacked
- **Effect:** Pushes the attack coordinate onto `opponent_board.hits_received`

#### 6. `reveal_winner()`

- **Signer:** `payer`
- **Runs on:** Ephemeral Rollup
- **Validation:** At least one player's ships must all be sunk (every cell of every ship has a matching hit)
- **Effect:**
  1. Determines winner (if P2's ships are all sunk, P1 wins; otherwise P2 wins)
  2. Clears ER permissions on both player boards (via `UpdatePermissionCpi` with `members: None`)
  3. Exits both boards from the ER session
  4. Commits and undelegates both boards back to the base Solana layer

#### 7. `create_permission(game_id: u64, player: Pubkey, bump: u8, members: Option<Vec<Member>>)`

- **Signer:** `payer`
- **Purpose:** Creates an ER permission for a player board PDA so that only the owning player can read the board data during the game
- **Effect:** CPI into MagicBlock's Permission Program with the player board as the permissioned account

#### 8. `delegate_pda(game_id: u64, player: Pubkey)`

- **Signer:** `payer`
- **Purpose:** Delegates a player board PDA from the base Solana layer to a specific Ephemeral Rollup validator
- **Effect:** The account becomes writable on the ER; reads are restricted by the previously created permission

### Error Codes (`CayedError`)

| Error                  | Context         | Description                                  |
| ---------------------- | --------------- | -------------------------------------------- |
| `Overflow`             | General         | Numeric overflow                             |
| `MinimumWager`         | `create_game`   | Wager > 0 but < 100,000 lamports             |
| `GridNotEven`          | `create_game`   | Grid size is not even or is zero             |
| `CannotJoinSelfGame`   | `join_game`     | Player tried to join their own game          |
| `GameFull`             | `join_game`     | Game already has two players                 |
| `ShipsAlreadyPlaced`   | `hide_ships`    | Board already has ships                      |
| `InvalidShipPlacement` | `hide_ships`    | Ship coordinates out of grid bounds          |
| `GameNotStarted`       | `make_move`     | No player 2 has joined yet                   |
| `InvalidTurn`          | `make_move`     | Not this player's turn                       |
| `InvalidOpponent`      | `make_move`     | Provided opponent doesn't match game data    |
| `AttackOutOfBounds`    | `make_move`     | Attack coordinate outside grid               |
| `CellAlreadyAttacked`  | `make_move`     | Cell was previously attacked                 |
| `ShipsNotPlaced`       | `make_move`     | One or both players haven't placed ships yet |
| `NotAllShipsSunk`      | `reveal_winner` | Game isn't over — ships remain afloat        |

---

## MagicBlock Ephemeral Rollups Integration

The game leverages MagicBlock's Ephemeral Rollups (ER) for two critical features:

### 1. Private State via Permissions

Player boards contain ship positions that must remain secret from opponents. The ER permission system ensures:

- Each `PlayerBoard` PDA gets a **permission** created via `create_permission` with the owning player as the sole authorized `Member` (with `AUTHORITY_FLAG | TX_LOGS_FLAG`)
- Only the player who owns the board can read its account data on the ER
- Opponents querying the ER for the other player's board receive `null` or are blocked

### 2. Account Delegation

Player board PDAs are **delegated** from the base Solana validator to the Ephemeral Rollup validator:

- `delegate_pda` uses the ER SDK's `#[delegate]` macro and `DelegateConfig` to move the account to a specific ER validator
- Once delegated, the board is writable on the ER but locked on the base layer
- The `#[ephemeral]` macro on the program module enables ER-aware instruction processing
- `hide_ships` and `make_move` execute on the ER for fast, private gameplay

### 3. Commit & Undelegate

When the game ends (`reveal_winner`):

1. Permissions are cleared (both boards become publicly readable)
2. Both boards call `.exit(&crate::ID)` to finalize ER state
3. `commit_and_undelegate_accounts` CPIs back to the MagicBlock program to push the final board state to the base Solana layer
4. The `#[commit]` macro on `RevealWinner` enables this commit flow

### Key ER SDK Constructs Used

- `#[ephemeral]` — program-level macro enabling ER processing
- `#[commit]` — instruction-level macro enabling commit+undelegate flow (adds `magic_context` and `magic_program` accounts)
- `#[delegate]` — instruction-level macro for delegation (adds `delegate_*` accounts)
- `#[account(mut, del)]` — marks an account for delegation
- `CreatePermissionCpiBuilder` / `UpdatePermissionCpiBuilder` — CPI helpers for the Permission Program
- `commit_and_undelegate_accounts` — commits ER state back to the base layer
- `DelegateConfig` — configuration for delegation (validator target, etc.)

### ER Validator Address

Default ER validator: `mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev`

---

## Game Flow (End-to-End)

```
1. Authority calls `init_config` on BASE LAYER
   → Creates Config + Vault PDAs

2. Player 1 calls `create_game` on BASE LAYER
   → Creates Game PDA + Player 1 Board PDA
   → Deposits wager to Vault
   → Creates permission for P1 Board (only P1 can read)
   → Delegates permission to ER
   → Delegates P1 Board PDA to ER

3. Player 2 calls `join_game` on BASE LAYER
   → Creates Player 2 Board PDA
   → Deposits matching wager
   → Creates permission for P2 Board (only P2 can read)
   → Delegates permission to ER
   → Delegates P2 Board PDA to ER

4. Both players call `hide_ships` on EPHEMERAL ROLLUP
   → Each writes ship positions to their own board (private)
   → Opponent cannot see the other board's data

5. Players alternate `make_move` on EPHEMERAL ROLLUP
   → Turn order enforced by move count parity
   → Attacks recorded on opponent's board

6. When all ships of one player are sunk:
   Someone calls `reveal_winner` on EPHEMERAL ROLLUP
   → Clears permissions (boards become public)
   → Commits both boards back to BASE LAYER
   → Both boards with full history are now publicly verifiable
```

---

## Codama Client Generation

The TypeScript client for the on-chain program is auto-generated using **Codama**.

### How It Works

1. The Anchor program is compiled, producing an IDL at `target/idl/cayed.json`
2. The `createCodamaClient.ts` script:
   - Loads the IDL from `target/idl/cayed.json`
   - Parses it into a Codama root node via `rootNodeFromAnchor(idl)`
   - Creates a Codama instance with `createFromRoot(...)`
   - Renders the TypeScript client via `renderVisitor(genPath)` to `web/client/cayed/`

### Running the Generator

```bash
bun run gen:client
```

### Generated Output (`web/client/cayed/`)

```
web/client/cayed/
├── index.ts              # Re-exports everything
├── accounts/             # Account decoders & fetch helpers
│   ├── config.ts         # Config account
│   ├── game.ts           # Game account
│   ├── playerBoard.ts    # PlayerBoard account
│   └── vault.ts          # Vault account
├── errors/
│   └── cayed.ts          # CayedError enum in TypeScript
├── instructions/         # Instruction builders
│   ├── createGame.ts
│   ├── createPermission.ts
│   ├── delegatePda.ts
│   ├── hideShips.ts
│   ├── initConfig.ts
│   ├── joinGame.ts
│   ├── makeMove.ts
│   ├── processUndelegation.ts
│   └── revealWinner.ts
├── programs/
│   └── cayed.ts          # Program address, instruction parser
├── shared/
│   └── index.ts          # Shared helpers
└── types/                # Type definitions
    ├── coordinate.ts
    ├── gameStatus.ts
    ├── member.ts
    └── shipCoordinates.ts
```

**⚠️ Do NOT edit files in `web/client/cayed/` manually** — they are overwritten on every `gen:client` run.

### Key Dependencies for Client Gen

| Package                     | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `codama`                    | Core Codama library                        |
| `@codama/nodes-from-anchor` | Parses Anchor IDL into Codama nodes        |
| `@codama/renderers-js`      | Renders TypeScript client from Codama tree |

---

## TypeScript / Client Dependencies

| Package                                  | Version  | Purpose                                                                                |
| ---------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `@solana/kit`                            | `^6.1.0` | Solana Web3.js v2 (transactions, accounts, RPC)                                        |
| `@magicblock-labs/ephemeral-rollups-kit` | `^0.8.5` | MagicBlock ER client helpers (MBConnection, delegation PDAs, permissions, auth tokens) |
| `solana-kite`                            | `^3.2.0` | Ergonomic Solana connection wrapper for tests                                          |
| `tweetnacl`                              | `^1.0.3` | Ed25519 signing (for ER auth tokens)                                                   |

### Path Alias

The root `tsconfig.json` defines:

```json
"paths": { "@client/*": ["./web/client/*"] }
```

This allows importing the generated client as `@client/cayed` throughout the codebase.

---

## Testing

### Integration Test (`tests/cayed.test.ts`)

The test file runs a full game lifecycle against local validators. It uses:

- **solana-kite** (`Connection`) for the base layer
- **MBConnection** (from `@magicblock-labs/ephemeral-rollups-kit`) for the Ephemeral Rollup
- `sendAndPoll` custom helper for HTTP-based transaction confirmation (avoids WebSocket issues)

#### Test Flow

1. `init_config` — Sets up Config + Vault
2. `create_game` — Player 1 creates game with wager, delegates board to ER
3. `join_game` — Player 2 joins, matches wager, delegates board to ER
4. `hide_ships` — Both players place ships on their boards (on ER)
5. Permission check — Verifies P1 can't read P2's board and vice versa
6. `make_move` (multiple) — Alternating attacks until one player's ships are all sunk
7. `reveal_winner` — Commits boards back to base layer, verifies final state

### Running Tests

#### Full Test (spins up validators):

```bash
bun run test
# or directly:
./test.sh
```

The `test.sh` script:

1. Kills any existing `solana-test-validator` and `ephemeral-validator` processes
2. Starts `mb-test-validator` (wraps `solana-test-validator`) on ports 8899/8900
3. Starts `ephemeral-validator` on ports 7799/7800, connecting to the base validator
4. Waits for both validators to be healthy
5. Runs `anchor test --skip-local-validator` with the correct environment variables
6. Cleans up validator processes

#### Environment Variables (set by `test.sh`):

- `PROVIDER_ENDPOINT` — Base validator RPC (default: `http://127.0.0.1:8899`)
- `WS_ENDPOINT` — Base validator WebSocket (default: `ws://127.0.0.1:8900`)
- `EPHEMERAL_PROVIDER_ENDPOINT` — ER validator RPC (default: `http://127.0.0.1:7799`)
- `EPHEMERAL_WS_ENDPOINT` — ER validator WebSocket (default: `ws://127.0.0.1:7800`)

#### Logging:

```bash
LOG=ON ./test.sh
# Writes mb-validator.log and ephemeral-validator.log
```

---

## Frontend (`web/`)

The frontend lives in the `web/` directory and has its own [CLAUDE.md](web/CLAUDE.md) with detailed documentation. Key summary:

- **React 19** with TypeScript
- **Vite** as the build tool
- **Tailwind CSS v4** for styling
- **React Aria Components** for accessible UI primitives
- Components use the Aria\* import prefix convention
- Files are kebab-case
- The generated Codama client at `web/client/cayed/` provides all on-chain interaction types and instruction builders

---

## Development Commands

| Command              | Description                               |
| -------------------- | ----------------------------------------- |
| `anchor build`       | Compile the Solana program                |
| `anchor deploy`      | Deploy to configured cluster              |
| `bun run gen:client` | Regenerate TypeScript client from IDL     |
| `bun run test`       | Full integration test (starts validators) |
| `bun run compile`    | TypeScript type-check (no emit)           |
| `bun run lint`       | ESLint check                              |
| `bun run lint:fix`   | ESLint auto-fix                           |
| `bun run format`     | Prettier check                            |
| `bun run format:fix` | Prettier auto-fix                         |

---

## Toolchain

- **Rust:** 1.89.0 (via `rust-toolchain.toml`) with `rustfmt` + `clippy`
- **Anchor:** 0.32.1
- **Solana CLI / SBF target:** Required for `anchor build`
- **Bun:** Runtime for TypeScript scripts and tests
- **Node.js / npm:** For package management (Anchor uses yarn per `Anchor.toml`)
- **MagicBlock CLI:** `mb-test-validator` and `ephemeral-validator` for local testing
