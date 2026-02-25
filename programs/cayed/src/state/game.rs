use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Game {
    pub id: u64,
    pub grid_size: u8,
    pub player_1: Pubkey,
    pub player_2: Option<Pubkey>,
    #[max_len(5)]
    pub revealed_ships_player_1: Vec<ShipCoordinates>,
    #[max_len(5)]
    pub revealed_ships_player_2: Vec<ShipCoordinates>,
    #[max_len(100)]
    pub moves: Vec<MoveResult>,
    pub next_move_player_1: bool,
    pub wager: u64,
    pub status: GameStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, PartialEq)]
pub struct ShipCoordinates {
    pub start_x: u8,
    pub start_y: u8,
    pub end_x: u8,
    pub end_y: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, PartialEq)]
pub struct MoveResult {
    pub x: u8,
    pub y: u8,
    pub is_hit: bool,
    // pub made_by_player1: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, PartialEq)]
pub enum GameStatus {
    AwaitingPlayerTwo,
    HidingShips,
    InProgress,
    Cancelled,
    Completed { winner: Pubkey },
    Forfeited { winner: Pubkey },
    WinnerRevealed { winner: Pubkey },
}
