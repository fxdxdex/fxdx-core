const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const account = addresses.admin
  const liquidityRouter = await contractAt("LiquidityRouter", addresses.liquidityRouterOld)

  await sendTxn(liquidityRouter.cancelAddLiquidity(168, account), "liquidityRouter.cancelAddLiquidity")
  await sendTxn(liquidityRouter.cancelAddLiquidity(169, account), "liquidityRouter.cancelAddLiquidity")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
