const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const wallet = { address: "0x5F799f365Fa8A2B60ac0429C48B153cA5a6f0Cf8" }
  const fxdx = await contractAt("FXDX", "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a");
  const rewardRouter = await contractAt("RewardRouter", "0xEa7fCb85802713Cb03291311C66d6012b23402ea")

  const account = "0x5F799f365Fa8A2B60ac0429C48B153cA5a6f0Cf8"
  const amount = "1000000000000000000"

  await sendTxn(rewardRouter.stakeFxdxForAccount(account, amount), `Stake for ${account}: ${amount}`)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
