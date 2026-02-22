use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

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
    pub fn del_pda(&mut self, game_id: u64, player: Pubkey) -> Result<()> {
        let game_id_bytes = game_id.to_le_bytes();
        let player_id_bytes = player.to_bytes();
        let signer_seeds: &[&[u8]] = &[b"player", game_id_bytes.as_ref(), player_id_bytes.as_ref()];

        let validator = self.validator.as_ref().map(|v| v.key());
        self.delegate_pda(
            &self.payer,
            signer_seeds,
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }
}
