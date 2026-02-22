use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::CreatePermissionCpiBuilder,
        structs::{Member, MembersArgs},
    },
    consts::PERMISSION_PROGRAM_ID,
};

#[derive(Accounts)]
pub struct CreatePermission<'info> {
    /// CHECK: Validated via permission program CPI
    pub permissioned_account: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PERMISSION PROGRAM
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> CreatePermission<'info> {
    pub fn create_permission(
        &mut self,
        game_id: u64,
        player: Pubkey,
        bump: u8,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        let CreatePermission {
            permissioned_account,
            permission,
            payer,
            permission_program,
            system_program,
        } = &self;

        let game_id_bytes = game_id.to_le_bytes();
        let player_id_bytes = player.to_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"player",
            game_id_bytes.as_ref(),
            player_id_bytes.as_ref(),
            &[bump],
        ]];

        CreatePermissionCpiBuilder::new(permission_program)
            .permissioned_account(permissioned_account)
            .permission(permission)
            .payer(payer)
            .system_program(system_program)
            .args(MembersArgs { members })
            .invoke_signed(signer_seeds)?;

        Ok(())
    }
}
