const { contractAt, sendTxn } = require("../shared/helpers")
const { formatAmount } = require("../../test/shared/utilities");

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('../core/tokens')[network];
const addresses = require('../core/addresses')[network];

function getGoerliValues() {
  const { btc, eth, usdc, usdt } = tokens

  const tokenArr = [btc, eth, usdc, usdt]

  return { tokenArr }
}

function getOptimismGoerliValues() {
  const { btc, eth, feth, usdc, usdt } = tokens

  const tokenArr = [btc, eth, feth, usdc, usdt]

  return { tokenArr }
}

function getOptimismValues() {
  const { btc, eth, usdc, usdt } = tokens

  const tokenArr = [btc, eth, usdc, usdt]

  return { tokenArr }
}

function getValues() {
  if (network === "goerli") {
    return getGoerliValues()
  } else if (network === "optimismGoerli") {
    return getOptimismGoerliValues()
  } else if (network === "optimism") {
    return getOptimismValues()
  }
}

async function main() {
  const receiver = { address: addresses.admin }
  const vault = await contractAt("Vault", addresses.vault)
  const gov = await contractAt("Timelock", await vault.gov())

  const { tokenArr } = getValues();

  console.log("\n----", network, "chain fees ----")
  console.log("-> Timestamp:", Math.floor(Date.now() / 1000), "\n")

  for (let i = 0; i < tokenArr.length; i++) {
    const token = await contractAt("Token", tokenArr[i].address)
    const poolAmount = await vault.poolAmounts(token.address)
    const balance = await token.balanceOf(vault.address)
    const feeReserve = await vault.feeReserves(token.address)
    const vaultAmount = poolAmount.add(feeReserve)

    if (vaultAmount.gt(balance)) {
      throw new Error("vaultAmount > vault.balance")
    }

    await sendTxn(gov.withdrawFees(vault.address, token.address, receiver.address), `gov.withdrawFees ${i}, ${tokenArr[i].name}`)

    console.log(`\n----> ${tokenArr[i].name} fees:`, formatAmount(feeReserve, tokenArr[i].decimals, tokenArr[i].decimals, true), '\n')
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
