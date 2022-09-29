const { Token: UniToken } = require("@uniswap/sdk-core")
const { Pool } = require("@uniswap/v3-sdk")

const { ARBITRUM, signers, contractAt } = require("../shared/helpers")
const { expandDecimals, formatAmount, parseValue, bigNumberify } = require("../../test/shared/utilities")
const { getArbValues: getArbKeeperValues, getAvaxValues: getAvaxKeeperValues } = require("../shared/fundAccountsUtils")

const allTokens = require('../core/tokens')

async function getInfoTokens(vault, reader, tokens) {
  const tokenArr = Object.values(tokens)
  const vaultTokenInfo = await reader.getVaultTokenInfo(
    vault.address,
    tokens.nativeToken.address,
    expandDecimals(1, 18),
    tokenArr.map(t => t.address)
  )
  const infoTokens = {}
  const vaultPropsLength = 10

  for (let i = 0; i < tokenArr.length; i++) {
    const token = JSON.parse(JSON.stringify(tokenArr[i]))

    token.poolAmount = vaultTokenInfo[i * vaultPropsLength]
    token.reservedAmount = vaultTokenInfo[i * vaultPropsLength + 1]
    token.usdfAmount = vaultTokenInfo[i * vaultPropsLength + 2]
    token.redemptionAmount = vaultTokenInfo[i * vaultPropsLength + 3]
    token.weight = vaultTokenInfo[i * vaultPropsLength + 4]
    token.minPrice = vaultTokenInfo[i * vaultPropsLength + 5]
    token.maxPrice = vaultTokenInfo[i * vaultPropsLength + 6]
    token.guaranteedUsd = vaultTokenInfo[i * vaultPropsLength + 7]
    token.maxPrimaryPrice = vaultTokenInfo[i * vaultPropsLength + 8]
    token.minPrimaryPrice = vaultTokenInfo[i * vaultPropsLength + 9]

    infoTokens[token.address] = token
  }

  return infoTokens
}

async function getFeesUsd(vault, reader, tokenInfo) {
  const tokenArr = Object.values(tokenInfo)
  const feeAmounts = await reader.getFees(vault.address, tokenArr.map(t => t.address))
  let feesUsd = bigNumberify(0)

  for (let i = 0; i < tokenArr.length; i++) {
    const token = tokenArr[i]
    const feeAmount = feeAmounts[i]
    const feeInUsd = feeAmount.mul(token.minPrice).div(expandDecimals(1, token.decimals))
    feesUsd = feesUsd.add(feeInUsd)
  }

  return feesUsd
}

async function getFxdxPrice(ethPrice) {
  const uniPool = await contractAt("UniPool", "0x80A9ae39310abf666A87C743d6ebBD0E8C42158E")
  const uniPoolSlot0 = await uniPool.slot0()

  const tokenA = new UniToken(ARBITRUM, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", 18, "SYMBOL", "NAME");
  const tokenB = new UniToken(ARBITRUM, "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", 18, "SYMBOL", "NAME");

  const pool = new Pool(
    tokenA, // tokenA
    tokenB, // tokenB
    10000, // fee
    uniPoolSlot0.sqrtPriceX96, // sqrtRatioX96
    1, // liquidity
    uniPoolSlot0.tick, // tickCurrent
    []
  );

  const poolTokenPrice = pool.priceOf(tokenB).toSignificant(6);
  const poolTokenPriceAmount = parseValue(poolTokenPrice, 18);
  return poolTokenPriceAmount.mul(ethPrice).div(expandDecimals(1, 18));
}

async function getArbValues() {
  const signer = signers.arbitrum
  const vault = await contractAt("Vault", "0x489ee077994B6658eAfA855C308275EAd8097C4A", signer)
  const reader = await contractAt("Reader", "0x2b43c90D1B727cEe1Df34925bcd5Ace52Ec37694", signer)
  const tokens = allTokens.arbitrum
  const tokenInfo = await getInfoTokens(vault, reader, tokens)
  const nativeTokenPrice = tokenInfo[tokens.nativeToken.address].maxPrice
  const feesUsd = await getFeesUsd(vault, reader, tokenInfo)
  const stakedFxdx = await contractAt("Token", "0xd2D1162512F927a7e282Ef43a362659E4F2a728F", signer)
  const stakedFxdxSupply = await stakedFxdx.totalSupply()
  const { totalTransferAmount: keeperCosts } = await getArbKeeperValues()
  const flpManager = await contractAt("FlpManager", "0x321F653eED006AD1C29D174e17d96351BDe22649", signer)
  const flpAum = await flpManager.getAum(true)

  return { vault, reader, tokens, tokenInfo, nativeTokenPrice, feesUsd, stakedFxdx, stakedFxdxSupply, keeperCosts, flpManager, flpAum }
}

async function getAvaxValues() {
  const signer = signers.avax
  const vault = await contractAt("Vault", "0x9ab2De34A33fB459b538c43f251eB825645e8595", signer)
  const reader = await contractAt("Reader", "0x2eFEE1950ededC65De687b40Fd30a7B5f4544aBd", signer)
  const tokens = allTokens.avax
  const tokenInfo = await getInfoTokens(vault, reader, tokens)
  const nativeTokenPrice = tokenInfo[tokens.nativeToken.address].maxPrice
  const feesUsd = await getFeesUsd(vault, reader, tokenInfo)
  const stakedFxdx = await contractAt("Token", "0x4d268a7d4C16ceB5a606c173Bd974984343fea13", signer)
  const stakedFxdxSupply = await stakedFxdx.totalSupply()
  const { totalTransferAmount: keeperCosts } = await getAvaxKeeperValues()
  const flpManager = await contractAt("FlpManager", "0xe1ae4d4b06A5Fe1fc288f6B4CD72f9F8323B107F", signer)
  const flpAum = await flpManager.getAum(true)

  return { vault, reader, tokens, tokenInfo, nativeTokenPrice, feesUsd, stakedFxdx, stakedFxdxSupply, keeperCosts, flpManager, flpAum }
}

async function main() {
  const values = {
    arbitrum: await getArbValues(),
    avax: await getAvaxValues()
  }

  const ethPrice = values.arbitrum.nativeTokenPrice
  const avaxPrice = values.avax.nativeTokenPrice
  const fxdxPrice = await getFxdxPrice(ethPrice)

  const data = [
    ["ETH Price", formatAmount(ethPrice, 30, 2)],
    ["AVAX Price", formatAmount(avaxPrice, 30, 2)],
    ["FXDX Price", formatAmount(fxdxPrice, 30, 2)],
    ["ARB Fees", formatAmount(values.arbitrum.feesUsd, 30, 2)],
    ["AVAX Fees", formatAmount(values.avax.feesUsd, 30, 2)],
    ["ARB sbfFXDX", formatAmount(values.arbitrum.stakedFxdxSupply, 18, 2)],
    ["AVAX sbfFXDX", formatAmount(values.avax.stakedFxdxSupply, 18, 2)],
    ["ARB Keeper Costs", formatAmount(values.arbitrum.keeperCosts, 18, 2)],
    ["AVAX Keeper Costs", formatAmount(values.avax.keeperCosts, 18, 2)],
    ["FLP AUM (ARB)", formatAmount(values.arbitrum.flpAum, 30, 2)],
    ["FLP AUM (AVAX)", formatAmount(values.avax.flpAum, 30, 2)],
  ]

  for (let i = 0; i < data.length; i++) {
    const item = data[i]
    console.log([item[0], item[1]].join(","))
  }
  // console.log(
  //   ["ETH Price", formatAmount(ethPrice, 30, 2)],
  //   ["AVAX Price", formatAmount(avaxPrice, 30, 2)],
  //   ["FXDX Price", formatAmount(fxdxPrice, 30, 2)],
  //   ["ARB Fees", formatAmount(values.arbitrum.feesUsd, 30, 2)],
  //   ["AVAX Fees", formatAmount(values.avax.feesUsd, 30, 2)],
  //   ["ARB sbfFXDX", formatAmount(values.arbitrum.stakedFxdxSupply, 18, 2)],
  //   ["AVAX sbfFXDX", formatAmount(values.avax.stakedFxdxSupply, 18, 2)],
  //   ["ARB Keeper Costs", formatAmount(values.arbitrum.keeperCosts, 18, 2)],
  //   ["AVAX Keeper Costs", formatAmount(values.avax.keeperCosts, 18, 2)],
  //   ["FLP AUM (ARB)", formatAmount(values.arbitrum.flpAum, 30, 2)],
  //   ["FLP AUM (AVAX)", formatAmount(values.avax.flpAum, 30, 2)],
  // )
  //
// ETH Price
// AVAX Price
// FXDX Price
// ARB Fees
// AVAX Fees
// ARB sbfFXDX
// AVAX sbfFXDX
// ARB Referral Rewards
// AVAX Referral Rewards
// ARB Keeper Costs
// AVAX Keeper Costs
// FLP AUM (ARB)
// FLP AUM (AVAX)

}

main()
