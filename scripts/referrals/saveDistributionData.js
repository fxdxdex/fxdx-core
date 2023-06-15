const { ArgumentParser } = require('argparse');
const { saveDistributionData } = require("./distributionData")

async function main() {
  const parser = new ArgumentParser({
    description: 'Get distribution data'
  });
  parser.add_argument('-n', '--network', {
    help: 'Network: optimismGoerli, optimism',
    required: true
  });
  parser.add_argument('-f', '--from-date', {
    help: 'Date from. E.g. 2023-04-03',
    default: "2023-04-03", // optimismGoerli
    // default: "2023-05-15", // optimism
  });
  parser.add_argument('-t', '--to-date', {
    help: 'Date to. Exclusive. E.g. 2023-04-10',
    default: "2023-06-12", // optimismGoerli
    // default: "2023-05-22", // optimism
  });
  parser.add_argument('-a', '--account', { help: 'Account address' })
  parser.add_argument('-p', '--fxdx-price', { help: 'FXDX TWAP price', default: "0.5" })
  parser.add_argument('-e', '--esfxdx-rewards', {
    help: 'Amount of EsFXDX to distribute to Tier 3',
    default: "5000"
  })

  const args = parser.parse_args()

  const fromDate = new Date(args.from_date)
  const fromTimestamp = parseInt(+fromDate / 1000)
  const toDate = new Date(args.to_date)
  const toTimestamp = parseInt(+toDate / 1000)

  console.log("Running script to get distribution data")
  console.log("Network: %s", args.network)
  console.log("From: %s (timestamp %s)", fromDate.toISOString().substring(0, 10), fromTimestamp)
  console.log("To (exclusively): %s (timestamp %s)", toDate.toISOString().substring(0, 10), toTimestamp)
  if (args.account) {
    console.log("Account: %s", args.account)
  }

  await saveDistributionData(
    args.network,
    fromTimestamp,
    toTimestamp,
    args.account,
    args.fxdx_price,
    args.esfxdx_rewards
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
