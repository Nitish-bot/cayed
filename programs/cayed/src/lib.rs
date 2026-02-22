use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::structs::Member;
use ephemeral_rollups_sdk::anchor::ephemeral;

use state::ShipCoordinates;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("3jatZuig82z7WWiKJmtzeiWoK2hxQnUwfAFNcJJPXAyN");

#[ephemeral]
#[program]
pub mod cayed {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, max_grid_size: u8, fee: u16) -> Result<()> {
        ctx.accounts.init_config(max_grid_size, fee, ctx.bumps)?;
        Ok(())
    }

    pub fn create_game(ctx: Context<CreateGame>, id: u64, grid_size: u8, wager: u64) -> Result<()> {
        ctx.accounts.create_game(id, grid_size, wager, ctx.bumps)?;
        Ok(())
    }

    pub fn hide_ships(ctx: Context<HideShips>, ships: Vec<ShipCoordinates>) -> Result<()> {
        ctx.accounts.hide_ships(ships)?;
        Ok(())
    }

    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        ctx.accounts.join_game(ctx.bumps)?;
        Ok(())
    }

    pub fn make_move(ctx: Context<MakeMove>, x: u8, y: u8) -> Result<()> {
        ctx.accounts.make_move(x, y)?;
        Ok(())
    }

    pub fn reveal_winner(ctx: Context<RevealWinner>) -> Result<()> {
        ctx.accounts.reveal_winner()?;
        Ok(())
    }

    pub fn create_permission(
        ctx: Context<CreatePermission>,
        game_id: u64,
        player: Pubkey,
        bump: u8,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        ctx.accounts
            .create_permission(game_id, player, bump, members)?;
        Ok(())
    }

    pub fn delegate_pda(ctx: Context<DelegatePda>, game_id: u64, player: Pubkey) -> Result<()> {
        ctx.accounts.del_pda(game_id, player)?;
        Ok(())
    }
}
