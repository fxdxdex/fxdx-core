const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet')
const addresses = require("../core/addresses")[network]

async function main() {
  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx)

  await sendTxn(esFxdx.setHandler(addresses.batchSender, true), "esFxdx.setHandler(batchSender, true)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
