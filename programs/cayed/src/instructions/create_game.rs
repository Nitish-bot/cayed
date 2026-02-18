use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::state::{Config, Game, GameStatus, PlayerBoard};

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
    init,
    payer = player,
    space = Game::INIT_SPACE,
    seeds = [b"game", id.to_le_bytes().as_ref()],
    bump,
  )]
    pub game: Account<'info, Game>,
    #[account(
    init,
    payer = player,
    space = PlayerBoard::INIT_SPACE,
    seeds = [b"player1", id.to_le_bytes().as_ref()],
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
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> CreateGame<'info> {
    pub fn create_game(
        &mut self,
        id: u64,
        grid_size: u8,
        wager: Option<u64>,
        bumps: CreateGameBumps,
    ) -> Result<()> {
        self.deposit(wager)?;

        self.game.set_inner(Game {
            id,
            grid_size,
            revealed_ships_player_1: vec![],
            revealed_ships_player_2: vec![],
            wager,
            status: GameStatus::AwaitingPlayerTwo,
            creator_pubkey: self.player.key(),
            bump: bumps.game,
        });

        self.player_board.set_inner(PlayerBoard {
            game_id: self.game.id,
            ship_coordinates: vec![],
        });

        Ok(())
    }

    pub fn deposit(&mut self, wager: Option<u64>) -> Result<()> {
        let amount = wager.unwrap_or(0);
        if amount == 0 {
            return Ok(());
        }

        let cpi_accounts = Transfer {
            from: self.player.to_account_info(),
            to: self.vault.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(self.system_program.to_account_info(), cpi_accounts);

        transfer(cpi_ctx, amount)
    }
}
