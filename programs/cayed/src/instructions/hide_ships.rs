use anchor_lang::prelude::*;

use crate::errors::CayedError;
use crate::state::{cell_bit, Game, GameStatus, PlayerBoard, ShipCoordinates};

#[derive(Accounts)]
pub struct HideShips<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        seeds = [b"game", game.id.to_le_bytes().as_ref()],
        bump,
        constraint = matches!(game.status, GameStatus::HidingShips) @ CayedError::InvalidGameStatus,
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

        let required_ships = (self.game.grid_size / 2) as usize;
        require!(
            ships.len().eq(&required_ships),
            CayedError::IncorrectShipsLen,
        );

        let grid_size = self.game.grid_size;
        let half = grid_size / 2;

        let mut ship_masks: Vec<u64> = Vec::with_capacity(ships.len());
        let mut all_ships_mask: u64 = 0;

        for ship in &ships {
            // Ships must have start <= end
            require!(
                ship.start_x <= ship.end_x && ship.start_y <= ship.end_y,
                CayedError::ShipCoordsReversed
            );

            // Ships must be linear (horizontal or vertical, not rectangular)
            require!(
                ship.start_x == ship.end_x || ship.start_y == ship.end_y,
                CayedError::ShipNotLinear
            );

            // Bounds check (since start <= end, only need to check end)
            require!(
                ship.end_x < grid_size && ship.end_y < half,
                CayedError::InvalidShipPlacement
            );

            // Compute bitmask for this ship and check for overlaps
            let mut mask: u64 = 0;
            for x in ship.start_x..=ship.end_x {
                for y in ship.start_y..=ship.end_y {
                    let bit = cell_bit(x, y, grid_size);
                    require!((all_ships_mask & bit) == 0, CayedError::ShipOverlap);
                    mask |= bit;
                }
            }
            all_ships_mask |= mask;
            ship_masks.push(mask);
        }

        self.player_board.ship_coordinates = ships;
        self.player_board.ship_masks = ship_masks;
        self.player_board.all_ships_mask = all_ships_mask;

        Ok(())
    }
}
