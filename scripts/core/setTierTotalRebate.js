const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  const liquidytReferralStorage = await contractAt("LiquidityReferralStorage", addresses.liquidityReferralStorage)

  await sendTxn(liquidytReferralStorage.setTierTotalRebate(0, 1000), "liquidytReferralStorage.setTierTotalRebate 0")
  await sendTxn(liquidytReferralStorage.setTierTotalRebate(1, 2000), "liquidytReferralStorage.setTierTotalRebate 1")
  await sendTxn(liquidytReferralStorage.setTierTotalRebate(2, 2500), "liquidytReferralStorage.setTierTotalRebate 2")

  await sendTxn(liquidytReferralStorage.setReferrerTier(addresses.mintReceiver, 1), "referralStorage.setReferrerTier 1")
  await sendTxn(liquidytReferralStorage.setReferrerTier(addresses.admin, 2), "referralStorage.setReferrerTier 2")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
