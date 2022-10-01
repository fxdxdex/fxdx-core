const { contractAt , sendTxn, callWithRetries } = require("../shared/helpers")
const network = (process.env.HARDHAT_NETWORK || 'mainnet');

const addresses = require("./addresses")[network]

async function main() {
  const router = await callWithRetries(contractAt, ["Router", addresses.router])

  await sendTxn(callWithRetries(router.addPlugin.bind(router), [
    addresses.orderBook
  ]), "router.addPlugin")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
