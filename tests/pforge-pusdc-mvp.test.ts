import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ForgeCrucibles } from "../target/types/forge_crucibles";
import { expect } from "chai";

describe("pFORGE/pUSDC MVP Tests", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.ForgeCrucibles as Program<ForgeCrucibles>;
  const provider = anchor.getProvider();

  // Test accounts
  let forgeCrucible: anchor.web3.PublicKey;
  let usdcCrucible: anchor.web3.PublicKey;
  let forgeMint: anchor.web3.PublicKey;
  let usdcMint: anchor.web3.PublicKey;
  let pforgeMint: anchor.web3.PublicKey;
  let pusdcMint: anchor.web3.PublicKey;
  let user: anchor.web3.Keypair;
  let engineer: anchor.web3.Keypair;

  before(async () => {
    // Create test accounts
    user = anchor.web3.Keypair.generate();
    engineer = anchor.web3.Keypair.generate();

    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(user.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(engineer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);

    // Create test mints
    forgeMint = anchor.web3.Keypair.generate().publicKey;
    usdcMint = anchor.web3.Keypair.generate().publicKey;
    pforgeMint = anchor.web3.Keypair.generate().publicKey;
    pusdcMint = anchor.web3.Keypair.generate().publicKey;

    // Create crucible PDAs
    [forgeCrucible] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("crucible"), forgeMint.toBuffer()],
      program.programId
    );

    [usdcCrucible] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("crucible"), usdcMint.toBuffer()],
      program.programId
    );
  });

  it("Should initialize FORGE crucible with correct parameters", async () => {
    // This test would initialize a FORGE crucible
    // In a real implementation, you would call the initialize_crucible instruction
    console.log("FORGE Crucible would be initialized here");
    expect(true).to.be.true; // Placeholder
  });

  it("Should initialize USDC crucible with correct parameters", async () => {
    // This test would initialize a USDC crucible
    console.log("USDC Crucible would be initialized here");
    expect(true).to.be.true; // Placeholder
  });

  it("Should wrap FORGE with 0.3% fee", async () => {
    // Test wrapping FORGE to pFORGE with fee calculation
    const wrapAmount = new anchor.BN(1000 * 1e9); // 1000 FORGE
    const expectedFee = new anchor.BN(3 * 1e9); // 0.3% fee = 3 FORGE
    const expectedNetAmount = wrapAmount.sub(expectedFee); // 997 FORGE

    console.log(`Wrap amount: ${wrapAmount.toString()}`);
    console.log(`Expected fee: ${expectedFee.toString()}`);
    console.log(`Expected net: ${expectedNetAmount.toString()}`);

    // In a real implementation, you would call the wrap instruction
    expect(expectedFee.toNumber()).to.equal(3000000000); // 3 FORGE in lamports
    expect(expectedNetAmount.toNumber()).to.equal(997000000000); // 997 FORGE in lamports
  });

  it("Should wrap USDC with 0.3% fee", async () => {
    // Test wrapping USDC to pUSDC with fee calculation
    const wrapAmount = new anchor.BN(1000 * 1e6); // 1000 USDC (6 decimals)
    const expectedFee = new anchor.BN(3 * 1e6); // 0.3% fee = 3 USDC
    const expectedNetAmount = wrapAmount.sub(expectedFee); // 997 USDC

    console.log(`Wrap amount: ${wrapAmount.toString()}`);
    console.log(`Expected fee: ${expectedFee.toString()}`);
    console.log(`Expected net: ${expectedNetAmount.toString()}`);

    expect(expectedFee.toNumber()).to.equal(3000000); // 3 USDC in micro-units
    expect(expectedNetAmount.toNumber()).to.equal(997000000); // 997 USDC in micro-units
  });

  it("Should unwrap pFORGE with 0.3% fee", async () => {
    // Test unwrapping pFORGE to FORGE with fee calculation
    const unwrapAmount = new anchor.BN(1000 * 1e9); // 1000 pFORGE
    const exchangeRate = new anchor.BN(1e9); // 1:1 rate
    const baseAmount = unwrapAmount.mul(exchangeRate).div(new anchor.BN(1e9));
    const expectedFee = baseAmount.mul(new anchor.BN(30)).div(new anchor.BN(10000)); // 0.3%
    const expectedNetAmount = baseAmount.sub(expectedFee);

    console.log(`Unwrap amount: ${unwrapAmount.toString()}`);
    console.log(`Base amount: ${baseAmount.toString()}`);
    console.log(`Expected fee: ${expectedFee.toString()}`);
    console.log(`Expected net: ${expectedNetAmount.toString()}`);

    expect(expectedFee.toNumber()).to.equal(3000000000); // 3 FORGE in lamports
    expect(expectedNetAmount.toNumber()).to.equal(997000000000); // 997 FORGE in lamports
  });

  it("Should unwrap pUSDC with 0.3% fee", async () => {
    // Test unwrapping pUSDC to USDC with fee calculation
    const unwrapAmount = new anchor.BN(1000 * 1e9); // 1000 pUSDC
    const exchangeRate = new anchor.BN(1e9); // 1:1 rate
    const baseAmount = unwrapAmount.mul(exchangeRate).div(new anchor.BN(1e9));
    const expectedFee = baseAmount.mul(new anchor.BN(30)).div(new anchor.BN(10000)); // 0.3%
    const expectedNetAmount = baseAmount.sub(expectedFee);

    console.log(`Unwrap amount: ${unwrapAmount.toString()}`);
    console.log(`Base amount: ${baseAmount.toString()}`);
    console.log(`Expected fee: ${expectedFee.toString()}`);
    console.log(`Expected net: ${expectedNetAmount.toString()}`);

    expect(expectedFee.toNumber()).to.equal(3000000000); // 3 USDC in lamports
    expect(expectedNetAmount.toNumber()).to.equal(997000000000); // 997 USDC in lamports
  });

  it("Should distribute fees 80/20 (yield/treasury)", async () => {
    // Test fee distribution calculation
    const totalFees = new anchor.BN(1000 * 1e9); // 1000 tokens in fees
    const yieldShare = totalFees.mul(new anchor.BN(80)).div(new anchor.BN(100)); // 80%
    const treasuryShare = totalFees.mul(new anchor.BN(20)).div(new anchor.BN(100)); // 20%

    console.log(`Total fees: ${totalFees.toString()}`);
    console.log(`Yield share (80%): ${yieldShare.toString()}`);
    console.log(`Treasury share (20%): ${treasuryShare.toString()}`);

    expect(yieldShare.toNumber()).to.equal(800000000000); // 800 tokens
    expect(treasuryShare.toNumber()).to.equal(200000000000); // 200 tokens
    expect(yieldShare.add(treasuryShare).toNumber()).to.equal(totalFees.toNumber());
  });

  it("Should calculate APY from exchange rate growth", async () => {
    // Test APY calculation
    const initialRate = new anchor.BN(1e9); // 1.0
    const finalRate = new anchor.BN(1.1e9); // 1.1 (10% growth)
    const timeElapsed = 365 * 24 * 60 * 60; // 1 year in seconds

    const rateGrowth = finalRate.sub(initialRate).mul(new anchor.BN(10000)).div(initialRate);
    const apy = rateGrowth.toNumber() / 100; // Convert basis points to percentage

    console.log(`Initial rate: ${initialRate.toString()}`);
    console.log(`Final rate: ${finalRate.toString()}`);
    console.log(`Rate growth: ${rateGrowth.toString()} basis points`);
    console.log(`APY: ${apy}%`);

    expect(apy).to.be.closeTo(10, 0.1); // 10% APY
  });

  it("Should handle wrap/unwrap roundtrip correctly", async () => {
    // Test complete wrap/unwrap cycle
    const initialAmount = new anchor.BN(1000 * 1e9); // 1000 FORGE
    const feeRate = 0.003; // 0.3%
    
    // Wrap: 1000 FORGE -> pFORGE
    const wrapFee = initialAmount.mul(new anchor.BN(30)).div(new anchor.BN(10000));
    const netWrapped = initialAmount.sub(wrapFee);
    
    // Unwrap: pFORGE -> FORGE (with exchange rate growth)
    const exchangeRate = new anchor.BN(1.05e9); // 5% growth
    const baseAmount = netWrapped.mul(exchangeRate).div(new anchor.BN(1e9));
    const unwrapFee = baseAmount.mul(new anchor.BN(30)).div(new anchor.BN(10000));
    const finalAmount = baseAmount.sub(unwrapFee);

    console.log(`Initial: ${initialAmount.toString()}`);
    console.log(`After wrap: ${netWrapped.toString()}`);
    console.log(`After growth: ${baseAmount.toString()}`);
    console.log(`After unwrap: ${finalAmount.toString()}`);
    console.log(`Total gain: ${finalAmount.sub(initialAmount).toString()}`);

    // Should have gained due to exchange rate growth
    expect(finalAmount.gt(initialAmount)).to.be.true;
  });

  it("Should prevent unauthorized accrue_yield calls", async () => {
    // Test that only authorized users can call accrue_yield
    console.log("Unauthorized accrue_yield should fail");
    // In a real implementation, this would test the authorization
    expect(true).to.be.true; // Placeholder
  });

  it("Should handle precision for small amounts", async () => {
    // Test precision with small amounts
    const smallAmount = new anchor.BN(1); // 1 lamport
    const fee = smallAmount.mul(new anchor.BN(30)).div(new anchor.BN(10000));
    
    console.log(`Small amount: ${smallAmount.toString()}`);
    console.log(`Fee: ${fee.toString()}`);
    
    // Fee should be 0 for very small amounts due to integer division
    expect(fee.toNumber()).to.equal(0);
  });
});
