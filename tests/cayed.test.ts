import {
  CAYED_PROGRAM_ADDRESS,
  CONFIG_DISCRIMINATOR,
  getConfigDecoder,
  getInitConfigInstruction
} from '@client/cayed';
import { address, assertAccountExists, getAddressEncoder, type Address, type KeyPairSigner } from '@solana/kit';
import { describe, beforeAll, it, expect } from 'bun:test'
import { connect, type Connection } from 'solana-kite';

describe('cayed', () => {
  let authority: KeyPairSigner;
  let player1: KeyPairSigner;
  let player2: KeyPairSigner;
  
  let configPda: Address;
  let vaultPda: Address;
  let gamePda: Address;
  let player1BoardPda: Address;
  let player2BoardPda: Address;

  let baseConnection: Connection;
  let ephemeralConnection: Connection;

  const gameId = BigInt(Date.now());

  const teeUrl = 'https://tee.magicblock.app'
  const teeWsUrl = 'wss://tee.magicblock.app' 
  const ER_VALIDATOR = address('mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev');
  
  beforeAll(async () => {
    baseConnection = connect();
    ephemeralConnection = connect(teeUrl, teeWsUrl);

    const wallets = await baseConnection.createWallets(3);
    authority = wallets[0]!;
    player1 = wallets[1]!;
    player2 = wallets[2]!;

    const configSeeds = ['config'];
    const configPDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      configSeeds
    );
    configPda = configPDAAndBump.pda;

    const vaultSeeds = ['vault']
    const vaultPDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      vaultSeeds
    )
    vaultPda = vaultPDAAndBump.pda

    const gameSeeds = ['game', gameId];
    const gamePDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      gameSeeds
    )
    gamePda = gamePDAAndBump.pda

    const player1BoardSeeds = ['player', gameId, player1.address];
    const player1BoardPDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      player1BoardSeeds
    )
    player1BoardPda = player1BoardPDAAndBump.pda

    const player2BoardSeeds = ['player', gameId, player2.address];
    const player2BoardPDAAndBump = await baseConnection.getPDAAndBump(
      CAYED_PROGRAM_ADDRESS,
      player2BoardSeeds
    )
    player2BoardPda = player2BoardPDAAndBump.pda
  })

  it('inits config', async () => {
    const ix = getInitConfigInstruction({
      authority: authority,
      config: configPda,
      vault: vaultPda,
      maxGridSize: 10,
      fee: 100, // Basis points: 1%
    })

    const sig = await baseConnection.sendTransactionFromInstructions({
      feePayer: authority,
      instructions: [ix]
    })

    const getConfig = baseConnection.getAccountsFactory(
      CAYED_PROGRAM_ADDRESS,
      CONFIG_DISCRIMINATOR,
      getConfigDecoder()
    )
    const configAccounts = await getConfig();
    expect(configAccounts.length == 1, 'More than one config accounts should not exist')

    const config = configAccounts[0]!
    assertAccountExists(config)
    
    console.log(`Initted config with sig: ${sig}`)
  })
});
