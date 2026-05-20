# Cayed — Context Glossary

> Domain language for the Battleship-on-Solana codebase. This file is a glossary, not a spec. Implementation decisions live in `agents.md` and code.

---

## Core Entities

### Game

An on-chain account (PDA) that represents a single Battleship session. Holds all **public** state: player pubkeys, grid size, wager, turn order, move history, and game status. Does NOT hold ship positions.

- **PDA seed**: `["game", id.to_le_bytes()]`
- **Key fields**: `id`, `grid_size`, `player_1`, `player_2`, `wager`, `status`, `moves`, `next_move_player_1`
- **Status machine**: `AwaitingPlayerTwo → HidingShips → InProgress → Completed → WinnerRevealed`

### PlayerBoard

An on-chain account (PDA) that represents a **single player's private state**. Holds ship placements, hit bitmap, and sunk tracking. Lives on the Ephemeral Rollup during gameplay for privacy.

- **PDA seed**: `["player", game_id.to_le_bytes(), player_pubkey]`
- **Key fields**: `ship_coordinates`, `ship_masks`, `all_ships_mask`, `hits_bitmap`, `sunk_mask`
- **Privacy**: delegated to ER so only the owning player can read it

### ShipCoordinates

A placement record for a single ship. Battleship ships are axis-aligned line segments.

```
ShipCoordinates {
  start_x: u8,
  start_y: u8,
  end_x: u8,
  end_y: u8,
}
```

- Ships must be horizontal (`start_y == end_y`) or vertical (`start_x == end_x`)
- `start` must be `<=` `end`
- All cells must be within the board bounds
- Ships must not overlap with other ships
- **Current gap**: the program does not enforce ship _length_ (see `agents.md` Known Gaps)

### MoveResult

A public record of a single attack, stored in `Game.moves`.

```
MoveResult {
  x: u8,
  y: u8,
  is_hit: bool,
}
```

- Moves are stored in alternating order (P1, P2, P1, P2...)
- `is_hit` is computed on-chain by checking the opponent's `all_ships_mask`

### GameStatus

The state machine for a Battleship session:

| State               | Meaning                                           |
| ------------------- | ------------------------------------------------- |
| `AwaitingPlayerTwo` | Game created, waiting for opponent to join        |
| `HidingShips`       | Both players must place ships                     |
| `InProgress`        | Active gameplay, players alternate attacks        |
| `Completed`         | All ships on one side are sunk; winner determined |
| `WinnerRevealed`    | Winner declared on-chain, permissions cleared     |
| `Cancelled`         | Unused in current MVP                             |
| `Forfeited`         | Unused in current MVP                             |

---

## Infrastructure Terms

### ER (Ephemeral Rollups)

MagicBlock's layer for private, low-latency game state. Accounts delegated to ER are only readable by permitted parties. Used for `PlayerBoard` accounts during gameplay.

### Permission

ER access-control structure that restricts who can read/write a delegated account. Created during game setup; cleared during winner reveal.

### Delegation

Moving an on-chain account from the Solana base layer to the ER validator. `PlayerBoard` accounts are delegated after both players join.

### Commit

Writing ER state back to the Solana base layer. `reveal_winner` commits the final `Game` and `PlayerBoard` states so the winner is recorded on-chain.

### Undelegate

Returning an account from ER to base layer. Happens during `reveal_winner` after the game ends.

### Vault

A PDA that custodies wagered SOL during gameplay.

- **PDA seed**: `["vault"]`
- **Purpose**: holds both players' wagers until settlement
- **Current gap**: no instruction pays out the winner (see `agents.md` Known Gaps)

### Config

Protocol-wide parameters set by the authority.

- **PDA seed**: `["config"]`
- **Fields**: `authority`, `vault`, `max_grid_size`, `fee` (basis points)

---

## Game Mechanics

### Grid

The Battleship board. Width = `grid_size`, height = `grid_size / 2`.

- `grid_size` must be even and `<= 10` (enforced by `Config.max_grid_size`)
- Cell `(x, y)` is encoded as bit `y * grid_size + x` in the `u64` bitmap
- Max index = `4 * 10 + 9 = 49` (fits in `u64`)

### Bitmap

A `u64` where each bit represents one cell on the grid.

- `hits_bitmap`: which cells have been attacked
- `all_ships_mask`: which cells contain any ship
- `ship_masks[i]`: which cells belong to ship `i`
- `sunk_mask`: which ships are fully sunk (bit `i` = 1 means ship `i` is sunk)

### Turn

Determined by the parity of total moves made:

```
total_moves = p1_hits.count_ones() + p2_hits.count_ones()
is_p1_turn = (total_moves % 2 == 0) == game.next_move_player_1
```

The first move is determined by `game_id % 2 == 0`.

### Sunk Detection

A ship is sunk when every cell in its `ship_mask` has been hit:

```
(opponent_board.hits_bitmap & ship_mask) == ship_mask
```

When a ship sinks, its coordinates are pushed to `game.revealed_ships_*` so the opponent can see what they destroyed.

### Wager

The bet amount in lamports. Both players deposit this amount into the `Vault` on game creation/joining.

- Minimum: 100,000 lamports (enforced on-chain)
- Zero-wager games are allowed (for free play)

---

## PDA (Program Derived Address)

A deterministic on-chain address derived from seeds and the program ID. All game-related accounts are PDAs so their addresses can be computed client-side without RPC calls.

| Account     | Seeds                                              |
| ----------- | -------------------------------------------------- |
| Config      | `["config"]`                                       |
| Vault       | `["vault"]`                                        |
| Game        | `["game", id.to_le_bytes()]`                       |
| PlayerBoard | `["player", game_id.to_le_bytes(), player_pubkey]` |

---

## Frontend Terms

### Stage

A UI phase in the Battleship game page. Rendered based on `GameStatus`:

| Stage              | When                                         |
| ------------------ | -------------------------------------------- |
| `Loading`          | Game account not yet fetched                 |
| `AwaitingOpponent` | `AwaitingPlayerTwo` status                   |
| `Placement`        | `HidingShips` + my ships not placed          |
| `WaitingShips`     | `HidingShips` + opponent ships not placed    |
| `Battle`           | `HidingShips` (both placed) or `InProgress`  |
| `Finished`         | `Completed` — winner known, not yet revealed |
| `Revealed`         | `WinnerRevealed` — final state               |
| `Error`            | Fetch or transaction failure                 |

### Optimistic Update

The frontend immediately updates local state (e.g., `myBoard.shipCoordinates`) before the transaction confirms, so the UI feels responsive. Reconciled on next poll.

---

## Out of Scope (MVP)

These concepts exist in the codebase enum/state but are not implemented:

- **Timeout / Forfeit**: no mechanism to claim a game after inactivity
- **Fee collection**: `Config.fee` is stored but never applied to payouts
- **Spectator mode**: no read-only observers
- **Replay / history**: moves are logged but not exposed as a feature
