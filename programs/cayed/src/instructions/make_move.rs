use anchor_lang::prelude::*;

use crate::state::{Game, PlayerBoard};

#[derive(Accounts)]
pub struct MakeMove<'info> {
  #[account(mut)]
  pub player: Signer<'info>,

  /// CHECK: checked with game
  pub opponent: UncheckedAccount<'info>,

  #[account(
    seeds = [b"game", game.id.to_le_bytes().as_ref()],
    bump,
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
    Ok(())
  }
}