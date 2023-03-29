const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];
const tokens = require('./tokens')[network];

async function main() {
  const { btc, eth, feth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, feth, usdc, usdt]

  const vault = await contractAt("Vault", addresses.vault);
  const timelock = await contractAt("Timelock", await vault.gov())

  for (const token of tokenArr) {
    await sendTxn(timelock.setTokenFeeFactorsV2(
      addresses.feeUtilsV2,
      token.address,
      token.taxBasisPoints,
      token.mintBurnFeeBasisPoints,
      token.swapFeeBasisPoints,
      token.rolloverRateFactor,
      token.relativePnlList,
      token.positionFeeBpsList,
      token.profitFeeBpsList
    ), `feeUtilsV2.setTokenFeeFactors - (${token.name})`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
