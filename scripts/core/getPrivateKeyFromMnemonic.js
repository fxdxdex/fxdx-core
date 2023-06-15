const { ethers } = require("ethers");

async function main() {
  const mnemonic = ""
  const data = ethers.Wallet.fromMnemonic(mnemonic)

  console.log('---> address:', data.address)
  console.log('---> privateKey:', data.privateKey)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
