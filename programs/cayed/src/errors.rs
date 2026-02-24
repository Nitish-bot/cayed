use anchor_lang::error_code;

#[error_code]
pub enum CayedError {
    #[msg("Number overflowed")]
    Overflow,

    // Config
    #[msg("Not authorized to perform this action")]
    Unauthorized,
    #[msg("Max grid size cannot exceed 10")]
    MaxGridSizeTooLarge,

    // Create Game
    #[msg("Wager was supplied but below minimum")]
    MinimumWager,
    #[msg("Grid size must be a positive multiple of 2")]
    GridNotEven,
    #[msg("Grid size exceeds the maximum allowed by config")]
    GridSizeTooLarge,

    // Join Game
    #[msg("Cannot join a game created by yourself")]
    CannotJoinSelfGame,
    #[msg("The game has already been joined by someone else")]
    GameFull,

    // Hide Ships
    #[msg("Incorrect number of ships placed on grid (0.5 * grid)")]
    IncorrectShipsLen,
    #[msg("Ships have already been placed on this board")]
    ShipsAlreadyPlaced,
    #[msg("Ship coordinates are out of the grid bounds")]
    InvalidShipPlacement,
    #[msg("Ships must be horizontal or vertical, not diagonal or rectangular")]
    ShipNotLinear,
    #[msg("Ship start coordinates must be <= end coordinates")]
    ShipCoordsReversed,
    #[msg("Two or more ships occupy the same cell")]
    ShipOverlap,

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
    #[msg("Game is not in the correct state for this action")]
    InvalidGameStatus,

    // Reveal Winner
    #[msg("Not all ships have been sunk yet")]
    NotAllShipsSunk,
}
