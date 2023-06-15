const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  const admin = addresses.admin

  const timelock = await contractAt("Timelock", addresses.timelock);
  const priceFeedTimelock = await contractAt("PriceFeedTimelock", addresses.priceFeedTimelock);

  console.log("timelock", timelock.address);
  console.log("priceFeedTimelock", priceFeedTimelock.address);

  // const method = "signalSetGov";
  const method = "setGov";

  await sendTxn(timelock[method](
    addresses.vault, // vault
    admin, // deployer
  ), `timelock.${method}(vault, admin)`)

  await sendTxn(timelock[method](
    addresses.feeUtilsV2, // vault
    admin, // deployer
  ), `timelock.${method}(feeUtilsV2, admin)`)

  await sendTxn(timelock[method](
    addresses.referralStorage, // vault
    admin, // deployer
  ), `timelock.${method}(referralStorage, admin)`)

  await sendTxn(timelock[method](
    addresses.liquidityReferralStorage, // vault
    admin, // deployer
  ), `timelock.${method}(liquiidtyReferralStorage, admin)`)

  await sendTxn(priceFeedTimelock[method](
    addresses.vaultPriceFeed, // _vaultPriceFeed
    admin, // deployer
  ), `priceFeedTimelock.${method}(vaultPriceFeed, admin)`)

  await sendTxn(priceFeedTimelock[method](
    addresses.fastPriceFeed, // _vaultPriceFeed
    admin, // deployer
  ), `priceFeedTimelock.${method}(fastPriceFeed, admin)`)

  // const vaultPriceFeed = await contractAt("VaultPriceFeed", addresses.vaultPriceFeed)
  // const fastPriceFeed = await contractAt("FastPriceFeed", addresses.fastPriceFeed)

  // await sendTxn(
  //   vaultPriceFeed.setGov(priceFeedTimelock.address),
  //   `vaultPriceFeed.setGov(priceFeedTimelock)`
  // )

  // await sendTxn(
  //   fastPriceFeed.setGov(priceFeedTimelock.address),
  //   `fastPriceFeed.setGov(priceFeedTimelock)`
  // )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
