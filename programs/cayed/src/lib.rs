use anchor_lang::prelude::*;

declare_id!("3jatZuig82z7WWiKJmtzeiWoK2hxQnUwfAFNcJJPXAyN");

#[program]
pub mod cayed {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
