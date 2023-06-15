const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const referralStorage = await contractAt("ReferralStorage", addresses.referralStorage)

  // await sendTxn(referralStorage.setHandler(addresses.positionRouter, true), "referralStorage.setHandler(positionRouter, true)")
  await sendTxn(referralStorage.setHandler(addresses.liquidityRouter, true), "referralStorage.setHandler(lquidityRouter, true)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
