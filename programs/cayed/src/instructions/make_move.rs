use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_accounts};

use crate::{
    errors::CayedError,
    state::{Coordinate, Game, PlayerBoard},
};

#[commit]
#[derive(Accounts)]
pub struct MakeMove<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    /// CHECK: We verify this is the correct opponent via constraints on the game account
    pub opponent: UncheckedAccount<'info>,

    #[account(
        seeds = [b"game", game.id.to_le_bytes().as_ref()],
        bump,
        constraint = game.player_2.is_some() @ CayedError::GameNotStarted,
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
        let game = &self.game;
        let player = &self.player;
        let opponent = &self.opponent;

        // Validate both players have placed ships
        require!(
            !self.player_board.ship_coordinates.is_empty()
                && !self.opponent_board.ship_coordinates.is_empty(),
            CayedError::ShipsNotPlaced
        );

        // Turn validation: derive whose turn it is from total moves made
        let total_moves =
            self.player_board.hits_received.len() + self.opponent_board.hits_received.len();
        let is_player1_turn = (total_moves % 2 == 0) == game.next_move_player_1;

        if is_player1_turn {
            require!(player.key() == game.player_1, CayedError::InvalidTurn);
        } else {
            require!(
                player.key() == game.player_2.unwrap(),
                CayedError::InvalidTurn
            );
        }

        // Opponent validation
        let valid_opponent = (player.key() == game.player_1
            && opponent.key() == game.player_2.unwrap())
            || (player.key() == game.player_2.unwrap() && opponent.key() == game.player_1);
        require!(valid_opponent, CayedError::InvalidOpponent);

        // Grid bounds validation — each player's board is grid_size x (grid_size / 2)
        let grid_size = game.grid_size;
        let half = grid_size / 2;
        require!(x < grid_size && y < half, CayedError::AttackOutOfBounds);

        // Ensure cell has not already been attacked
        let coord = Coordinate { x, y };
        require!(
            !self.opponent_board.hits_received.contains(&coord),
            CayedError::CellAlreadyAttacked
        );

        // Record the attack on the opponent's board
        self.opponent_board.hits_received.push(coord.clone());

        let hit_ship = self.opponent_board.ship_coordinates.iter().find(|opcord| {
            coord.x >= opcord.start_x
                && coord.x <= opcord.end_x
                && coord.y >= opcord.start_y
                && coord.y <= opcord.end_y
        });

        if let Some(ship) = hit_ship {
            if is_player1_turn {
                self.game.revealed_ships_player_1.push(ship.clone());
            } else {
                self.game.revealed_ships_player_2.push(ship.clone());
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
