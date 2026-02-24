use anchor_lang::prelude::*;

use crate::errors::CayedError;
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
        // If already initialized, only the existing authority can reconfigure
        if self.config.authority != Pubkey::default() {
            require!(
                self.authority.key() == self.config.authority,
                CayedError::Unauthorized
            );
        }
        // Cap max_grid_size at 10 to fit account space allocations (5 ships, 50 hits)
        require!(max_grid_size <= 10, CayedError::MaxGridSizeTooLarge);
        require!(
            max_grid_size > 0 && max_grid_size % 2 == 0,
            CayedError::GridNotEven
        );

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
