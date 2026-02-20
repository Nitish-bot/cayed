use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::errors::CayedError;
use crate::state::{Config, Game, PlayerBoard, Vault};

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
    seeds = [b"game", game.id.to_le_bytes().as_ref()],
    bump
  )]
    pub game: Account<'info, Game>,
    #[account(
    init,
    payer = player,
    space = 8 + PlayerBoard::INIT_SPACE,
    seeds = [b"player", game.id.to_le_bytes().as_ref(), player.key().as_ref()],
    bump,
  )]
    pub player_board: Account<'info, PlayerBoard>,

    #[account(
    seeds = [b"config"],
    bump
  )]
    pub config: Account<'info, Config>,
    #[account(
    mut,
    seeds = [b"vault"],
    bump,
  )]
    pub vault: Account<'info, Vault>,

    pub system_program: Program<'info, System>,
}

impl<'info> JoinGame<'info> {
    pub fn join_game(&mut self) -> Result<()> {
        let wager = self.game.wager;
        let player_1 = self.game.player_1;
        require!(
            player_1 != self.player.key(),
            CayedError::CannotJoinSelfGame
        );
        require!(self.game.player_2.is_none(), CayedError::GameFull);

        if wager > 0 {
            self.deposit(wager)?;
        }

        self.game.player_2 = Some(self.player.key());

        self.player_board.set_inner(PlayerBoard {
            game_id: self.game.id,
            ship_coordinates: vec![],
        });

        Ok(())
    }

    pub fn deposit(&mut self, wager: u64) -> Result<()> {
        let cpi_accounts = Transfer {
            from: self.player.to_account_info(),
            to: self.vault.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(self.system_program.to_account_info(), cpi_accounts);

        transfer(cpi_ctx, wager)
    }
}
