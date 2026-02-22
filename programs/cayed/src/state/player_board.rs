use anchor_lang::prelude::*;

use crate::state::ShipCoordinates;

#[account]
#[derive(InitSpace)]
pub struct PlayerBoard {
    pub game_id: u64,
    pub player: Pubkey,
    pub bump: u8,
    #[max_len(5)]
    pub ship_coordinates: Vec<ShipCoordinates>,
}
