use anchor_lang::prelude::*;

use crate::{
    errors::CayedError,
    state::{Game, PlayerBoard},
};

#[derive(Accounts)]
pub struct MakeMove<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    /// CHECK: We verify this is the correct opponent via constraints on the game account
    pub opponent: UncheckedAccount<'info>,

    #[account(
        seeds = [b"game", game.id.to_le_bytes().as_ref()],
        bump,
        constraint = game.player_2.is_some() @ CayedError::GameNotStarted,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player", game.id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub player_board: Account<'info, PlayerBoard>,
    #[account(
        mut,
        seeds = [b"player", game.id.to_le_bytes().as_ref(), opponent.key().as_ref()],
        bump,
    )]
    pub opponent_board: Account<'info, PlayerBoard>,
}

impl<'info> MakeMove<'info> {
    pub fn make_move(&mut self) -> Result<()> {
        let game = &self.game;
        let player = &self.player;
        let opponent = &self.opponent;

        let constraint = if game.next_move_player_1 {
            player.key() == game.player_1
        } else {
            player.key() == game.player_2.unwrap()
        };
        require!(constraint, CayedError::InvalidTurn);

        let constraint = (player.key() == game.player_1
            && opponent.key() == game.player_2.unwrap())
            || (player.key() == game.player_2.unwrap() && opponent.key() == game.player_1);
        require!(constraint, CayedError::InvalidOpponent);

        Ok(())
    }
}
