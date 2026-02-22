use anchor_lang::error_code;

#[error_code]
pub enum CayedError {
    #[msg("Number overflowed")]
    Overflow,

    // Create Game
    #[msg("Wager was supplied but below minimum")]
    MinimumWager,
    #[msg("Grid size must be a multiple of 2")]
    GridNotEven,

    // Join Game
    #[msg("Cannot join a game created by yourself")]
    CannotJoinSelfGame,
    #[msg("The game has already been joined by someone else")]
    GameFull,

    // Hide Ships
    #[msg("Ships have already been placed on this board")]
    ShipsAlreadyPlaced,
    #[msg("Ship coordinates are out of the grid bounds")]
    InvalidShipPlacement,

    // Make move
    #[msg("Can't move game hasn't been joined by any player_2")]
    GameNotStarted,
    #[msg("Signer tried to make a move out of turn")]
    InvalidTurn,
    #[msg("Provided opponent account is incorrect")]
    InvalidOpponent,
    #[msg("Attack coordinates are out of the grid bounds")]
    AttackOutOfBounds,
    #[msg("This cell has already been attacked")]
    CellAlreadyAttacked,
    #[msg("Ships have not been placed yet")]
    ShipsNotPlaced,

    // Reveal Winner
    #[msg("Not all ships have been sunk yet")]
    NotAllShipsSunk,
}
