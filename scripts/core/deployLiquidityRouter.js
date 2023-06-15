const { deployContract, contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function deploy() {
  const vault = await contractAt("Vault", addresses.vault)
  const router = await contractAt("Router", addresses.router)
  // const referralStorage = await contractAt("Router", addresses.referralStorage)
  const rewardRouterV2 = await contractAt("RewardRouterV2", addresses.rewardRouterV2)
  const weth = await contractAt("WETH", tokens.nativeToken.address)

  // const minExecutionFee = "10000000000000000" // 0.01 ETH for L1
  // const minExecutionFee = "100000000000000" // 0.0001 for Arbitrum
  // const minExecutionFee = "2000000000000000" // 0.002 ETH for Optimism Goerli
  const minExecutionFee = "500000000000000" // 0.0005 ETH for Optimism

  const liquidityRouter = await deployContract("LiquidityRouter", [vault.address, router.address, rewardRouterV2.address, weth.address, minExecutionFee], "LiquidityRouter")
  // const liquidityRouter = await contractAt("LiquidityRouter", addresses.liquidityRouter)

  await sendTxn(router.addPlugin(liquidityRouter.address), "router.addPlugin")
  await sendTxn(rewardRouterV2.setLiquidityRouter(liquidityRouter.address, true), "rewardRouterV2.setLiquidityRouter")
  await sendTxn(liquidityRouter.setDelayValues(1, 180, 30 * 60), "liquidityRouter.setDelayValues")

  // await sendTxn(liquidityRouter.setReferralStorage(addresses.referralStorage), "liquidityRouter.setReferralStorage")
  // await sendTxn(referralStorage.setHandler(liquidityRouter.address, true), "referralStorage.setHandler(liquidityRouter)")

  // await sendTxn(liquidityRouter.setMinExecutionFee(minExecutionFee), "liquidityRouter.setMinExecutionFee")
}

async function main() {
  await deploy()
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
