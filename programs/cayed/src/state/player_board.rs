use anchor_lang::prelude::*;

use crate::state::ShipCoordinates;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, PartialEq)]
pub struct Coordinate {
    pub x: u8,
    pub y: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerBoard {
    pub game_id: u64,
    pub player: Pubkey,
    pub bump: u8,
    #[max_len(5)]
    pub ship_coordinates: Vec<ShipCoordinates>,
    #[max_len(50)]
    pub hits_received: Vec<Coordinate>,
}
