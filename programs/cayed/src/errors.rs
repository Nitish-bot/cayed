use anchor_lang::error_code;

#[error_code]
pub enum CayedError {
    #[msg("Number overflowed")]
    Overflow,

    // Create Game
    #[msg("Wager was supplied but below minimum")]
    MinimumWager,

    // Join Game
    #[msg("Cannot join a game created by yourself")]
    CannotJoinSelfGame,
    #[msg("The game has already been joined by someone else")]
    GameFull,

    // Make move
    #[msg("Can't move game hasn't been joined by any player_2")]
    GameNotStarted,
    #[msg("Signer tried to make a move out of turn")]
    InvalidTurn,
    #[msg("Provided opponent account is incorrect")]
    InvalidOpponent,
}
