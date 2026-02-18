use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Game {
    pub id: u64,
    pub grid_size: u8,
    #[max_len(5)]
    pub revealed_ships_player_1: Vec<ShipCoordinates>,
    #[max_len(5)]
    pub revealed_ships_player_2: Vec<ShipCoordinates>,
    pub wager: Option<u64>,
    pub status: GameStatus,
    pub creator_pubkey: Pubkey,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone)]
pub struct ShipCoordinates {
    start_x: u8,
    start_y: u8,
    end_x: u8,
    end_y: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone)]
pub enum GameStatus {
    AwaitingPlayerTwo,
    InProgress,
    Completed,
    Cancelled,
}
