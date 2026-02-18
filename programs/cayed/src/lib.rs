use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("3jatZuig82z7WWiKJmtzeiWoK2hxQnUwfAFNcJJPXAyN");

#[program]
pub mod cayed {
    use super::*;

    pub fn init_config(
        ctx: Context<InitConfig>,
        vault: Pubkey,
        max_grid_size: u8,
        fee: u16,
    ) -> Result<()> {
        ctx.accounts
            .init_config(vault, max_grid_size, fee, ctx.bumps)?;
        Ok(())
    }

    pub fn create_game(
        ctx: Context<CreateGame>,
        id: u64,
        grid_size: u8,
        wager: Option<u64>,
    ) -> Result<()> {
        ctx.accounts.create_game(id, grid_size, wager, ctx.bumps)?;
        Ok(())
    }
}
