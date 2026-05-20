# Cayed

> Battleship on Solana with MagicBlock Ephemeral Rollups for private ship placement.

## What Is This?

A two-player Battleship game deployed as a single Anchor program on Solana devnet. Players wager SOL, place ships on private boards (hidden via MagicBlock ER), and alternate attacks until one fleet is destroyed. Winner is declared on-chain.

**Current status**: MVP — core game loop works, but payout and ship size validation are not yet implemented on-chain.

## Tech Stack

| Layer          | Technology                               |
| -------------- | ---------------------------------------- |
| Blockchain     | Solana (devnet)                          |
| Smart Contract | Anchor 0.32.1, Rust 1.89.0               |
| Private State  | MagicBlock Ephemeral Rollups SDK 0.8.x   |
| Client SDK     | @solana/kit 6.x, Codama-generated client |
| Frontend       | React 19, TypeScript, Vite 7             |
| Styling        | Tailwind CSS v4.1, React Aria Components |
| Routing        | React Router 7                           |
| Wallet         | wallet-standard, @solana/react           |
| Runtime        | Bun                                      |
| Testing        | Bun test runner + Anchor test harness    |

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) 1.89.0+ (`rust-toolchain.toml` pins it)
- [Anchor CLI](https://www.anchor-lang.com/) 0.32.1
- [Bun](https://bun.sh/) 1.1+
- `mb-test-validator` and `ephemeral-validator` binaries (for local testing)
- A Solana wallet (for devnet interaction)

### Install

```bash
# Root dependencies
bun install

# Frontend dependencies
cd web && bun install
```

### Run Locally

```bash
# Terminal 1: start validators
mb-test-validator
# Terminal 2: start ephemeral-validator
ephemeral-validator

# Terminal 3: dev frontend
cd web && bun run dev
```

### Build the Program

```bash
# Build the Anchor program
anchor build

# Generate the TypeScript client from IDL
bun createCodamaClient.ts
```

### Test

```bash
# Run the full test suite (starts validators, runs tests, cleans up)
./test.sh

# Or run the test directly (requires validators already running)
bun test --timeout 1000000 tests/cayed.test.ts
```

### Deploy

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet

# CI/CD (GitHub Actions) handles:
# anchor build → bun createCodamaClient.ts → cd web && bun run build → deploy to GitHub Pages
```

## Project Structure

```
.
├── programs/cayed/          # Solana Anchor program (Rust)
│   ├── src/
│   │   ├── lib.rs            # Program entry point, 8 instructions
│   │   ├── errors.rs         # Error enum (22 variants)
│   │   ├── instructions/     # Instruction handlers
│   │   │   ├── init_config.rs
│   │   │   ├── create_game.rs
│   │   │   ├── join_game.rs
│   │   │   ├── hide_ships.rs
│   │   │   ├── make_move.rs
│   │   │   ├── reveal_winner.rs
│   │   │   ├── create_permission.rs
│   │   │   └── delegate_pda.rs
│   │   └── state/            # Account definitions
│   │       ├── config.rs
│   │       ├── game.rs
│   │       ├── player_board.rs
│   │       ├── vault.rs
│   │       └── mb_helpers.rs
│   └── Cargo.toml
│
├── tests/
│   └── cayed.test.ts         # Sole test file (504 lines, happy-path E2E)
│
├── web/                      # React frontend
│   ├── src/
│   │   ├── main.tsx          # React entry (provider chain)
│   │   ├── App.tsx           # Router (/, /battleship, /battleship/:gameId)
│   │   ├── components/       # UI components
│   │   ├── context/          # React context providers
│   │   ├── hooks/            # Custom hooks
│   │   ├── lib/              # Utilities (ships, bitmask, constants)
│   │   ├── pages/            # Route pages
│   │   │   └── battleship/
│   │   │       ├── lobby.tsx
│   │   │       ├── game.tsx
│   │   │       └── stages/   # Game stage components
│   │   ├── services/         # GameService, PDA derivation, account fetching
│   │   ├── providers/        # ThemeProvider, RouterProvider
│   │   └── styles/           # Tailwind + arcade theme CSS
│   ├── client/               # Codama-generated client (gitignored)
│   └── package.json
│
├── agents.md                 # Agent architecture guide
├── CONTEXT.md                # Domain glossary
├── Anchor.toml               # Anchor config
├── Cargo.toml                # Rust workspace
├── package.json              # Root dependencies
├── createCodamaClient.ts     # Client code generation script
└── test.sh                   # Test runner script
```

## Game Flow

```
Player 1                    On-Chain                    Player 2
   │                          │                            │
   │── create_game ──────────→│                            │
   │ (deposit wager)          │                            │
   │◄── Game PDA ────────────│                            │
   │                          │                            │
   │                          │◄────────── join_game ──────│
   │                          │            (deposit wager)   │
   │                          │                            │
   │── hide_ships ──────────→│                            │
   │ (ER: private board)      │                            │
   │                          │◄────────── hide_ships ─────│
   │                          │            (ER: private)     │
   │                          │                            │
   │                          │◄──────── make_move ────────│
   │                          │ (attack, hit/miss, sunk?)    │
   │                          │                            │
   │── make_move ────────────→│                            │
   │                          │ ...alternating...          │
   │                          │                            │
   │                          │◄── reveal_winner ──────────│
   │                          │ (declare winner, commit)   │
   │                          │                            │
   │◄── (GAP: no payout yet)  │                            │
```

## Known Limitations (MVP)

1. **No payout** — `reveal_winner` declares the winner but does not transfer wagers from the vault
2. **No ship size enforcement** — the program validates ship count and placement but not individual ship lengths
3. **No timeouts** — if a player stops playing, funds lock indefinitely
4. **Single test file** — only happy-path E2E tested; no error paths, no unit tests
5. **No CI tests** — GitHub Actions deploys without running tests
6. **Polling (3s)** — frontend polls for state updates instead of using websocket subscriptions

See `agents.md` §3 for full gap details and fix recommendations.

## Documentation

| File            | Purpose                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `agents.md`     | Agent architecture guide — how this codebase is structured, what to change, what NOT to change |
| `CONTEXT.md`    | Domain glossary — definitions of Game, PlayerBoard, ShipCoordinates, GameStatus, ER, etc.      |
| `web/CLAUDE.md` | Frontend UI component conventions (React Aria, kebab-case, brand colors)                       |

## License

TBD
