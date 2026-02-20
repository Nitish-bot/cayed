use anchor_lang::error_code;

#[error_code]
pub enum CayedError {
    #[msg("Number overflowed")]
    Overflow,
    #[msg("Wager was supplied but below minimum")]
    MinimumWager,
    #[msg("Cannot join a game created by yourself")]
    CannotJoinSelfGame,
    #[msg("The game has already been joined by someone else")]
    GameFull,
}
