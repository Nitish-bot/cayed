use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::state::AccountType;

#[delegate]
#[derive(Accounts)]
pub struct DelegatePda {
    /// CHECK: The PDA to delegate
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
    /// CHECK: Checked by delegate program
    pub validator: Option<UncheckedAccount<'info>>,
}

impl<'info> DelegatePda<'info> {
    pub fn del_pda(&mut self, account_type: AccountType) -> Result<()> {
        let mut seed_data = account_type.derive_seeds();
        let (_, bump) = Pubkey::find_program_address(
            &seed_data.iter().map(|s| s.as_slice()).collect::<Vec<_>>(),
            &crate::ID,
        );
        seed_data.push(vec![bump]);

        let signer_seeds = seed_data
            .iter()
            .map(|s| s.as_slice())
            .collect::<Vec<&[u8]>>();

        let validator = self.validator.as_ref().map(|v| v.key());
        self.delegate_pda(
            &self.payer,
            &signer_seeds,
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }
}
