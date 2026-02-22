use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::errors::CayedError;
use crate::state::{Config, Game, GameStatus, PlayerBoard, Vault};

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        init,
        payer = player,
        space = 8 + Game::INIT_SPACE,
        seeds = [b"game", id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        init,
        payer = player,
        space = 8 + PlayerBoard::INIT_SPACE,
        seeds = [b"player", id.to_le_bytes().as_ref(), player.key().as_ref()],
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

impl<'info> CreateGame<'info> {
    pub fn create_game(
        &mut self,
        id: u64,
        grid_size: u8,
        wager: u64,
        bumps: CreateGameBumps,
    ) -> Result<()> {
        if wager > 0 {
            require!(wager.ge(&100_000u64), CayedError::MinimumWager);
            self.deposit(wager)?;
        }
        // Randomly decide who moves first
        let first_move = id % 2 == 0;

        self.game.set_inner(Game {
            id,
            grid_size,
            player_1: self.player.key(),
            player_2: None,
            revealed_ships_player_1: vec![],
            revealed_ships_player_2: vec![],
            next_move_player_1: first_move,
            wager,
            status: GameStatus::AwaitingPlayerTwo,
            bump: bumps.game,
        });

        self.player_board.set_inner(PlayerBoard {
            game_id: self.game.id,
            player: self.player.key(),
            bump: bumps.player_board,
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
