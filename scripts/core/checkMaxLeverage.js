const { contractAt } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const vault = await contractAt("Vault", addresses.vault);

  const maxLeverage = await vault.maxLeverage();

  console.log('Max Leverage:', maxLeverage.toString());
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
