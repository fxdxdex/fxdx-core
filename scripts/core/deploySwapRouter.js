const { deployContract, contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function deploy() {
  const vault = await contractAt("Vault", addresses.vault)
  const router = await contractAt("Router", addresses.router)
  const weth = await contractAt("WETH", tokens.nativeToken.address)
  const minExecutionFee = "10000000000000000" // 0.01 ETH

  const swapRouter = await deployContract("SwapRouter", [vault.address, router.address, weth.address, minExecutionFee], "SwapRouter")
  // const swapRouter = await contractAt("SwapRouter", addresses.swapRouter)

  await sendTxn(router.addPlugin(swapRouter.address), "router.addPlugin")

  await sendTxn(swapRouter.setDelayValues(1, 180, 30 * 60), "swapRouter.setDelayValues")
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
