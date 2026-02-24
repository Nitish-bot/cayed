use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountType {
    Game { game_id: u64 },
    PlayerBoard { game_id: u64, player: Pubkey },
}

impl AccountType {
    pub fn derive_seeds(&self) -> Vec<Vec<u8>> {
        match self {
            Self::Game { game_id } => {
                vec![b"game".to_vec(), game_id.to_le_bytes().to_vec()]
            }
            Self::PlayerBoard { game_id, player } => {
                vec![
                    b"player".to_vec(),
                    game_id.to_le_bytes().to_vec(),
                    player.to_bytes().to_vec(),
                ]
            }
        }
    }
}
