use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::UpdatePermissionCpiBuilder;
use ephemeral_rollups_sdk::access_control::structs::MembersArgs;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

use crate::errors::CayedError;
use crate::state::{Game, PlayerBoard};

fn all_ships_sunk(board: &PlayerBoard) -> bool {
    for ship in &board.ship_coordinates {
        let min_x = ship.start_x.min(ship.end_x);
        let max_x = ship.start_x.max(ship.end_x);
        let min_y = ship.start_y.min(ship.end_y);
        let max_y = ship.start_y.max(ship.end_y);

        for x in min_x..=max_x {
            for y in min_y..=max_y {
                if !board.hits_received.iter().any(|h| h.x == x && h.y == y) {
                    return false;
                }
            }
        }
    }
    true
}

#[commit]
#[derive(Accounts)]
pub struct RevealWinner<'info> {
    #[account(
        seeds = [b"game", game.id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [b"player", game.id.to_le_bytes().as_ref(), game.player_1.as_ref()],
        bump,
    )]
    pub player1_board: Account<'info, PlayerBoard>,

    #[account(
        mut,
        seeds = [b"player", game.id.to_le_bytes().as_ref(), game.player_2.unwrap().as_ref()],
        bump,
    )]
    pub player2_board: Account<'info, PlayerBoard>,

    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission1: UncheckedAccount<'info>,

    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission2: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: PERMISSION PROGRAM
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}

impl<'info> RevealWinner<'info> {
    pub fn reveal_winner(&mut self) -> Result<()> {
        let p1_sunk = all_ships_sunk(&self.player1_board);
        let p2_sunk = all_ships_sunk(&self.player2_board);
        require!(p1_sunk || p2_sunk, CayedError::NotAllShipsSunk);

        let winner = if p2_sunk {
            self.game.player_1
        } else {
            self.game.player_2.unwrap()
        };
        msg!("Winner: {}", winner);

        // Clear permissions so boards are no longer restricted
        let game_id_bytes = self.game.id.to_le_bytes();
        let permission_program = self.permission_program.to_account_info();

        let p1_key = self.game.player_1;
        let p2_key = self.game.player_2.unwrap();
        let p1_bump = self.player1_board.bump;
        let p2_bump = self.player2_board.bump;

        UpdatePermissionCpiBuilder::new(&permission_program)
            .permissioned_account(&self.player1_board.to_account_info(), true)
            .authority(&self.player1_board.to_account_info(), false)
            .permission(&self.permission1.to_account_info())
            .args(MembersArgs { members: None })
            .invoke_signed(&[&[
                b"player",
                game_id_bytes.as_ref(),
                p1_key.as_ref(),
                &[p1_bump],
            ]])?;

        UpdatePermissionCpiBuilder::new(&permission_program)
            .permissioned_account(&self.player2_board.to_account_info(), true)
            .authority(&self.player2_board.to_account_info(), false)
            .permission(&self.permission2.to_account_info())
            .args(MembersArgs { members: None })
            .invoke_signed(&[&[
                b"player",
                game_id_bytes.as_ref(),
                p2_key.as_ref(),
                &[p2_bump],
            ]])?;

        // Exit and commit both player boards back to base layer
        self.player1_board.exit(&crate::ID)?;
        self.player2_board.exit(&crate::ID)?;

        let magic_context = self.magic_context.to_account_info();
        let magic_program = self.magic_program.to_account_info();

        commit_and_undelegate_accounts(
            &self.payer,
            vec![
                &self.player1_board.to_account_info(),
                &self.player2_board.to_account_info(),
            ],
            &magic_context,
            &magic_program,
        )?;

        Ok(())
    }
}
