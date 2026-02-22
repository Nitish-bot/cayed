use anchor_lang::prelude::*;

use crate::errors::CayedError;
use crate::state::{Game, PlayerBoard, ShipCoordinates};

#[derive(Accounts)]
pub struct HideShips<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

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
}

impl<'info> HideShips<'info> {
    pub fn hide_ships(&mut self, ships: Vec<ShipCoordinates>) -> Result<()> {
        require!(
            self.player_board.ship_coordinates.is_empty(),
            CayedError::ShipsAlreadyPlaced
        );

        let grid_size = self.game.grid_size;
        let half = grid_size / 2;

        // Validate all ship coordinates are within the player's half of the grid
        for ship in &ships {
            require!(
                ship.start_x < grid_size
                    && ship.end_x < grid_size
                    && ship.start_y < half
                    && ship.end_y < half,
                CayedError::InvalidShipPlacement
            );
        }

        self.player_board.ship_coordinates = ships;

        Ok(())
    }
}
