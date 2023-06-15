const { getFrameSigner, deployContract, contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

const depositFee = 30 // 0.3%

async function main() {
  // const signer = await getFrameSigner()

  const vault = await contractAt("Vault", addresses.vault)
  // const timelock = await contractAt("Timelock", await vault.gov(), signer)
  // const router = await contractAt("Router", addresses.router, signer)
  // const timelock = await contractAt("Timelock", await vault.gov())
  const router = await contractAt("Router", addresses.router)
  const weth = await contractAt("WETH", tokens.nativeToken.address)
  const orderBook = await contractAt("OrderBook", addresses.orderBook)

  const orderKeeper = { address: addresses.orderKeeper }
  const liquidator = { address: addresses.liquidator }

  // const partnerContracts = [
  //   "0x9ba57a1D3f6C61Ff500f598F16b97007EB02E346", // Vovo ETH up vault
  //   "0x5D8a5599D781CC50A234D73ac94F4da62c001D8B", // Vovo ETH down vault
  //   "0xE40bEb54BA00838aBE076f6448b27528Dd45E4F0", // Vovo BTC up vault
  //   "0x1704A75bc723A018D176Dc603b0D1a361040dF16", // Vovo BTC down vault
  // ]

  // const partnerContracts = [
  //   "0xbFbEe90E2A96614ACe83139F41Fa16a2079e8408", // Vovo FLP ETH up vault
  //   "0x0FAE768Ef2191fDfCb2c698f691C49035A53eF0f", // Vovo FLP ETH down vault
  //   "0x2b8E28667A29A5Ab698b82e121F2b9Edd9271e93", // Vovo FLP BTC up vault
  //   "0x46d6dEE922f1d2C6421895Ba182120C784d986d3", // Vovo FLP BTC down vault
  // ]

  const partnerContracts = []

  const positionManager = await deployContract("PositionManager", [vault.address, router.address, weth.address, depositFee, orderBook.address])
  // const positionManager = await contractAt("PositionManager", addresses.positionManager)
  await sendTxn(positionManager.setOrderKeeper(orderKeeper.address, true), "positionManager.setOrderKeeper(orderKeeper)")
  await sendTxn(positionManager.setLiquidator(liquidator.address, true), "positionManager.setLiquidator(liquidator)")
  await sendTxn(positionManager.setShouldValidateIncreaseOrder(false), "positionManager.setShouldValidateIncreaseOrder(false)")
  // await sendTxn(timelock.setContractHandler(positionManager.address, true), "timelock.setContractHandler(positionManager)")
  // await sendTxn(timelock.setLiquidator(vault.address, positionManager.address, true), "timelock.setLiquidator(vault, positionManager, true)")
  await sendTxn(router.addPlugin(positionManager.address), "router.addPlugin(positionManager)")

  for (let i = 0; i < partnerContracts.length; i++) {
    const partnerContract = partnerContracts[i]
    await sendTxn(positionManager.setPartner(partnerContract, true), "positionManager.setPartner(partnerContract)")
  }

  // await sendTxn(positionManager.setFastPriceFeed(addresses.fastPriceFeed), "positionManager.setFastPriceFeed")
  // await sendTxn(positionManager.setReferralStorage(addresses.referralStorage), "positionManager.setReferralStorage")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
