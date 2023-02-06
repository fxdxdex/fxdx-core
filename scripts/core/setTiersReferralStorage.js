const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  const referralStorage = await contractAt("ReferralStorage", addresses.referralStorage)

  await sendTxn(referralStorage.setTier(0, 1000, 5000), "referralStorage.setTier 0")
  await sendTxn(referralStorage.setTier(1, 2000, 5000), "referralStorage.setTier 1")
  await sendTxn(referralStorage.setTier(2, 2500, 4000), "referralStorage.setTier 2")

  await sendTxn(referralStorage.setReferrerTier(addresses.mintReceiver, 1), "referralStorage.setReferrerTier 1")
  await sendTxn(referralStorage.setReferrerTier(addresses.admin, 2), "referralStorage.setReferrerTier 2")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
