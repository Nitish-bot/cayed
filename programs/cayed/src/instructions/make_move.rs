use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_accounts};

use crate::{
    errors::CayedError,
    state::{cell_bit, Game, GameStatus, PlayerBoard},
};

#[commit]
#[derive(Accounts)]
pub struct MakeMove<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    /// CHECK: We verify this is the correct opponent via constraints on the game account
    pub opponent: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"game", game.id.to_le_bytes().as_ref()],
        bump,
        constraint = matches!(
            game.status,
            GameStatus::HidingShips | GameStatus::InProgress
        ) @ CayedError::InvalidGameStatus,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player", game.id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub player_board: Account<'info, PlayerBoard>,
    #[account(
        mut,
        seeds = [b"player", game.id.to_le_bytes().as_ref(), opponent.key().as_ref()],
        bump,
    )]
    pub opponent_board: Account<'info, PlayerBoard>,
}

impl<'info> MakeMove<'info> {
    pub fn make_move(&mut self, x: u8, y: u8) -> Result<()> {
        // Validate both players have placed ships
        require!(
            !self.player_board.ship_coordinates.is_empty()
                && !self.opponent_board.ship_coordinates.is_empty(),
            CayedError::ShipsNotPlaced
        );
        require!(
            !self.player_board.all_ships_sunk(),
            CayedError::AllShipsSunk
        );

        // Transition from HidingShips → InProgress on first valid move
        if matches!(self.game.status, GameStatus::HidingShips) {
            self.game.status = GameStatus::InProgress;
        }

        // Turn validation via hit count
        let total_moves = (self.player_board.hits_bitmap.count_ones()
            + self.opponent_board.hits_bitmap.count_ones()) as usize;
        let is_player1_turn = (total_moves % 2 == 0) == self.game.next_move_player_1;

        let player_key = self.player.key();
        let p2_key = self.game.player_2.unwrap();

        if is_player1_turn {
            require!(player_key == self.game.player_1, CayedError::InvalidTurn);
        } else {
            require!(player_key == p2_key, CayedError::InvalidTurn);
        }

        // Opponent validation
        let opponent_key = self.opponent.key();
        let valid_opponent = (player_key == self.game.player_1 && opponent_key == p2_key)
            || (player_key == p2_key && opponent_key == self.game.player_1);
        require!(valid_opponent, CayedError::InvalidOpponent);

        // Grid bounds validation - each player's board is grid_size x (grid_size / 2)
        let grid_size = self.game.grid_size;
        let half = grid_size / 2;
        require!(x < grid_size && y < half, CayedError::AttackOutOfBounds);

        // Duplicate check via bitmap
        let bit = cell_bit(x, y, grid_size);
        require!(
            (self.opponent_board.hits_bitmap & bit) == 0,
            CayedError::CellAlreadyAttacked
        );

        // Record the attack
        self.opponent_board.hits_bitmap |= bit;

        // Was this a hit? (did the attacked cell have a ship?)
        let is_hit = (self.opponent_board.all_ships_mask & bit) != 0;

        // O(n_ships) sunk detection using pre-computed masks
        // Clone masks locally to release the immutable borrow on opponent_board.
        let ship_masks: Vec<u64> = self.opponent_board.ship_masks.clone();
        let mut any_newly_sunk = false;
        for (i, ship_mask) in ship_masks.iter().enumerate() {
            if *ship_mask == 0 {
                continue;
            }
            // Skip already-sunk ships
            if (self.opponent_board.sunk_mask >> i) & 1 == 1 {
                continue;
            }
            // Check if this ship is now fully sunk
            if (self.opponent_board.hits_bitmap & ship_mask) == *ship_mask {
                self.opponent_board.sunk_mask |= 1u8 << i;
                let ship = self.opponent_board.ship_coordinates[i].clone();
                if is_player1_turn {
                    self.game.revealed_ships_player_1.push(ship);
                } else {
                    self.game.revealed_ships_player_2.push(ship);
                }
                any_newly_sunk = true;
            }
        }

        // Record move result on the public Game account so clients can poll it
        self.game
            .moves
            .push(crate::state::MoveResult { x, y, is_hit });

        if any_newly_sunk {
            // Game completion check
            if self.opponent_board.all_ships_sunk() {
                self.game.status = GameStatus::Completed {
                    winner: self.player.key(),
                };
            }

            commit_accounts(
                &self.player,
                vec![&self.game.to_account_info()],
                &self.magic_context,
                &self.magic_program,
            )?;
        }

        Ok(())
    }
}
