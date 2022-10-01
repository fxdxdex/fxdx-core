const { getFrameSigner, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  // const signer = await getFrameSigner()

  const vault = await contractAt("Vault", addresses.vault)
  const vaultGov = await vault.gov()

  const vaultTimelock = await contractAt("Timelock", vaultGov/*, signer*/)
  const vaultMethod = "signalVaultSetTokenConfig"
  // const vaultMethod = "vaultSetTokenConfig"

  console.log("vault", vault.address)
  console.log("vaultTimelock", vaultTimelock.address)
  console.log("vaultMethod", vaultMethod)

  // const { link, uni } = tokens
  // const tokenArr = [link, uni]
  const { btc, eth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, usdc, usdt]

  for (const token of tokenArr) {
    await sendTxn(vaultTimelock[vaultMethod](
      vault.address,
      token.address, // _token
      token.decimals, // _tokenDecimals
      token.tokenWeight, // _tokenWeight
      token.minProfitBps, // _minProfitBps
      expandDecimals(token.maxUsdfAmount, 18), // _maxUsdfAmount
      token.isStable, // _isStable
      token.isShortable // _isShortable
    ), `vault.${vaultMethod}(${token.name}) ${token.address}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
