const { sendTxn } = require("../shared/helpers")
const { ethers } = require("hardhat");

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const [ owner ] = await ethers.getSigners()

  await sendTxn(owner.sendTransaction({
    to: addresses.priceSender,
    value: ethers.utils.parseEther("1.0"),
  }), "owner.sendTransaction")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
