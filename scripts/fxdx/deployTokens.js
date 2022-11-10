const { deployContract } = require("../shared/helpers")

async function main() {
  await deployContract("EsFXDX", [])
  // await deployContract("MintableBaseToken", ["esFXDX IOU", "esFXDX:IOU", 0])
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
