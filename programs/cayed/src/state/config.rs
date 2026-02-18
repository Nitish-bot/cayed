use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub vault: Pubkey, // Where fee ends up
    pub max_grid_size: u8,
    pub fee: u16, // Basis points (10,000 = 100%)
    pub bump: u8,
}
