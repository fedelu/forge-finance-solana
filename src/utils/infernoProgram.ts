import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'
import infernoIdl from '../idl/forge-crucibles-inferno.json'
import { SOLANA_TESTNET_PROGRAM_IDS } from '../config/solana-testnet'
import { AnchorWallet } from './anchorProgram'

export function getInfernoCruciblesProgram(
  connection: Connection,
  wallet: AnchorWallet
): Program {
  const provider = new AnchorProvider(
    connection,
    wallet as any,
    AnchorProvider.defaultOptions()
  )

  const programId = new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.FORGE_CRUCIBLES_INFERNO)
  const idlData = infernoIdl as any
  const idlWithAddress = {
    ...idlData,
    address: programId.toString(),
  } as Idl

  return new Program(idlWithAddress, provider) as any
}
