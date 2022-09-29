const { getFrameSigner, deployContract, contractAt, sendTxn, readTmpAddresses, callWithRetries } = require("../shared/helpers")
const { bigNumberify, expandDecimals } = require("../../test/shared/utilities")
const { toChainlinkPrice } = require("../../test/shared/chainlink")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function getValues(/* signer */) {
  const vault = await contractAt("Vault", addresses.vault)
  const timelock = await contractAt("Timelock", await vault.gov()/*, signer*/)
  const reader = await contractAt("Reader", addresses.reader)

  // const { btc, eth, usdc, link, uni, usdt, mim, frax, dai } = tokens
  // const tokenArr = [usdt]
  // const { avax, eth, btc, mim, usdce, usdc } = tokens
  // const tokenArr = [avax]
  const { btc, eth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, usdc, usdt]

  const vaultTokenInfo = await reader.getVaultTokenInfoV2(vault.address, eth.address, 1, tokenArr.map(t => t.address))

  return { vault, timelock, reader, tokenArr, vaultTokenInfo }
}

async function main() {
  // const signer = await getFrameSigner()

  const { vault, timelock, reader, tokenArr, vaultTokenInfo } = await getValues(/*signer*/)

  console.log("vault", vault.address)
  console.log("timelock", timelock.address)

  const vaultPropsLength = 14;

  const shouldSendTxn = true

  let totalUsdfAmount = bigNumberify(0)

  for (const [i, tokenItem] of tokenArr.entries()) {
    const token = {}
    token.poolAmount = vaultTokenInfo[i * vaultPropsLength]
    token.reservedAmount = vaultTokenInfo[i * vaultPropsLength + 1]
    token.availableAmount = token.poolAmount.sub(token.reservedAmount)
    token.usdfAmount = vaultTokenInfo[i * vaultPropsLength + 2]
    token.redemptionAmount = vaultTokenInfo[i * vaultPropsLength + 3]
    token.weight = vaultTokenInfo[i * vaultPropsLength + 4]
    token.bufferAmount = vaultTokenInfo[i * vaultPropsLength + 5]
    token.maxUsdfAmount = vaultTokenInfo[i * vaultPropsLength + 6]
    token.globalShortSize = vaultTokenInfo[i * vaultPropsLength + 7]
    token.maxGlobalShortSize = vaultTokenInfo[i * vaultPropsLength + 8]
    token.minPrice = vaultTokenInfo[i * vaultPropsLength + 9]
    token.maxPrice = vaultTokenInfo[i * vaultPropsLength + 10]
    token.guaranteedUsd = vaultTokenInfo[i * vaultPropsLength + 11]

    token.availableUsd = tokenItem.isStable
      ? token.poolAmount
          .mul(token.minPrice)
          .div(expandDecimals(1, tokenItem.decimals))
      : token.availableAmount
          .mul(token.minPrice)
          .div(expandDecimals(1, tokenItem.decimals));

    token.managedUsd = token.availableUsd.add(token.guaranteedUsd);
    token.managedAmount = token.managedUsd
      .mul(expandDecimals(1, tokenItem.decimals))
      .div(token.minPrice);

    const usdfAmount = token.managedUsd.div(expandDecimals(1, 30 - 18))
    totalUsdfAmount = totalUsdfAmount.add(usdfAmount)

    const adjustedMaxUsdfAmount = expandDecimals(tokenItem.maxUsdfAmount, 18)
    // if (usdfAmount.gt(adjustedMaxUsdfAmount)) {
    //   usdfAmount = adjustedMaxUsdfAmount
    // }

    if (shouldSendTxn) {
      await sendTxn(timelock.setTokenConfig(
        vault.address,
        tokenItem.address, // _token
        tokenItem.tokenWeight, // _tokenWeight
        tokenItem.minProfitBps, // _minProfitBps
        expandDecimals(tokenItem.maxUsdfAmount, 18), // _maxUsdfAmount
        expandDecimals(tokenItem.bufferAmount, tokenItem.decimals), // _bufferAmount
        usdfAmount
      ), `vault.setTokenConfig(${tokenItem.name}) ${tokenItem.address}`)
    }
  }

  console.log("totalUsdfAmount", totalUsdfAmount.toString())
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
