use anchor_lang::prelude::*;

use crate::state::{config::Config, Vault};

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        seeds = [b"config"],
        space = 8 + Config::INIT_SPACE,
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault"],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitConfig<'info> {
    pub fn init_config(
        &mut self,
        max_grid_size: u8,
        fee: u16,
        bumps: InitConfigBumps,
    ) -> Result<()> {
        self.vault.set_inner(Vault {
            authority: self.authority.key(),
        });

        self.config.set_inner(Config {
            authority: self.authority.key(),
            vault: self.vault.key(),
            max_grid_size,
            fee,
            bump: bumps.config,
        });

        Ok(())
    }
}
