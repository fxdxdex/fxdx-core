const { getFrameSigner, deployContract, contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function deploy() {
  // const signer = await getFrameSigner()

  const vault = await contractAt("Vault", addresses.vault)
  // const timelock = await contractAt("Timelock", await vault.gov(), signer)
  // const router = await contractAt("Router", addresses.router, signer)
  // const timelock = await contractAt("Timelock", await vault.gov())
  const router = await contractAt("Router", addresses.router)
  const weth = await contractAt("WETH", tokens.nativeToken.address)
  const depositFee = "30" // 0.3%
  const minExecutionFee = "10000000000000000" // 0.0003 ETH

  const positionRouter = await deployContract("PositionRouter", [vault.address, router.address, weth.address, depositFee, minExecutionFee], "PositionRouter")
  // const positionRouter = await contractAt("PositionRouter", addresses.positionRouter)

  await sendTxn(router.addPlugin(positionRouter.address), "router.addPlugin")

  await sendTxn(positionRouter.setDelayValues(1, 180, 30 * 60), "positionRouter.setDelayValues")
  // await sendTxn(timelock.setContractHandler(positionRouter.address, true), "timelock.setContractHandler(positionRouter)")
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
