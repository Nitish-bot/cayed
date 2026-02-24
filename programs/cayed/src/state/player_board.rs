use anchor_lang::prelude::*;

use crate::state::ShipCoordinates;

/// Encode cell (x, y) into a single-bit `u64` mask for the grid bitmap.
/// Each player's board is `grid_size` wide × `grid_size / 2` tall.
/// Bit index = y × grid_size + x.  Max index = 4 × 10 + 9 = 49 (fits u64).
#[inline]
pub fn cell_bit(x: u8, y: u8, grid_size: u8) -> u64 {
    1u64 << (y as u32 * grid_size as u32 + x as u32)
}

#[account]
#[derive(InitSpace)]
pub struct PlayerBoard {
    pub game_id: u64,
    pub player: Pubkey,
    pub bump: u8,
    /// Ship placements - kept for public reveal of sunk ships.
    #[max_len(5)]
    pub ship_coordinates: Vec<ShipCoordinates>,
    /// Pre-computed bitmask per ship (index-aligned with `ship_coordinates`).
    #[max_len(5)]
    pub ship_masks: Vec<u64>,
    /// Union of all `ship_masks` - every cell occupied by any ship.
    pub all_ships_mask: u64,
    /// Bitmask of every cell that has been attacked on this board.
    pub hits_bitmap: u64,
    /// Per-ship sunk tracker - bit `i` set means `ship_coordinates[i]` is fully sunk.
    pub sunk_mask: u8,
}

impl PlayerBoard {
    /// True when every ship cell has been hit.
    #[inline]
    pub fn all_ships_sunk(&self) -> bool {
        self.all_ships_mask != 0 && (self.hits_bitmap & self.all_ships_mask) == self.all_ships_mask
    }
}
