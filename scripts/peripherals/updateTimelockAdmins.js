const { deployContract, sendTxn, contractAt } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  // replace this newAdmin value to the account address of new admin
  const newAdmin = "0x26E76B18D4A132A9397C46af11e4688BDB602E92"
  const tokenManager = await contractAt("TokenManager", addresses.tokenManager)

  // signalSetAdmin
  await sendTxn(
    tokenManager.signalSetAdmin(addresses.timelock, newAdmin),
    `tokenManager.signalSetAdmin(timelock, newAdmin)`
  )

  console.log('----> timelock SetAdmin nonce:', (await tokenManager.actionsNonce()).toString())

  await sendTxn(
    tokenManager.signalSetAdmin(addresses.priceFeedTimelock, newAdmin),
    `tokenManager.signalSetAdmin(priceFeedTimelock, newAdmin)`
  )

  console.log('----> priceFeedTimelock SetAdmin nonce:', (await tokenManager.actionsNonce()).toString())

  // // assign nonces: replace these values from the printed ones in the above statements
  // const timelockNonce = "1"
  // const priceFeedTimelockNonce = "2"

  // // signSetAdmin
  // await sendTxn(
  //   tokenManager.signSetAdmin(addresses.timelock, newAdmin, timelockNonce),
  //   `tokenManager.signSetAdmin(timelock, newAdmin, nonce)`
  // )

  // await sendTxn(
  //   tokenManager.signSetAdmin(addresses.priceFeedTimelock, newAdmin, priceFeedTimelockNonce),
  //   `tokenManager.signSetAdmin(priceFeedTimelock, newAdmin, nonce)`
  // )

  // // setAdmin
  // await sendTxn(
  //   tokenManager.setAdmin(addresses.timelock, newAdmin, timelockNonce),
  //   `tokenManager.setAdmin(timelock, newAdmin, nonce)`
  // )

  // await sendTxn(
  //   tokenManager.setAdmin(addresses.priceFeedTimelock, newAdmin, priceFeedTimelockNonce),
  //   `tokenManager.setAdmin(priceFeedTimelock, newAdmin, nonce)`
  // )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
