use anchor_lang::error_code;

#[error_code]
pub enum QuadraticVotingError {
    #[msg("Number overflowed")]
    Overflow,
}
