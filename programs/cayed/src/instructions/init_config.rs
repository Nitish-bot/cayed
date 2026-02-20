use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::state::config::Config;

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        seeds = [b"config"],
        space = Config::INIT_SPACE,
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitConfig<'info> {
    pub fn init_config(
        &mut self,
        max_grid_size: u8,
        fee: u16,
        bumps: InitConfigBumps,
    ) -> Result<()> {
        self.create_vault()?;

        self.config.set_inner(Config {
            authority: self.authority.key(),
            vault: self.vault.key(),
            max_grid_size,
            fee,
            bump: bumps.config,
        });

        Ok(())
    }

    pub fn create_vault(&mut self) -> Result<()> {
        let rent = Rent::get()?.minimum_balance(0);

        let cpi_accounts = Transfer {
            from: self.authority.to_account_info(),
            to: self.vault.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(self.system_program.to_account_info(), cpi_accounts);

        transfer(cpi_ctx, rent)
    }
}
