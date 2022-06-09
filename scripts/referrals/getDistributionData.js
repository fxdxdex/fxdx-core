const fs = require('fs')

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { ArgumentParser } = require('argparse');
const ethers = require('ethers')

const ARBITRUM_SUBGRAPH_ENDPOINT = 'https://api.thegraph.com/subgraphs/name/gdev8317/fxdx-arbitrum-referrals-staging'
const AVALANCHE_SUBGRAPH_ENDPOINT = 'https://api.thegraph.com/subgraphs/name/gdev8317/fxdx-avalanche-referrals-staging'

const BigNumber = ethers.BigNumber
const { formatUnits, parseUnits } = ethers.utils
const SHARE_DIVISOR = BigNumber.from("1000000000") // 1e9
const BONUS_TIER = 2 // for EsFXDX distributions
const USD_DECIMALS = 30
const FXDX_DECIMALS = 18

function stringToFixed(s, n) {
  return Number(s).toFixed(n)
}

function bigNumberify(n) {
  return ethers.BigNumber.from(n)
}

function expandDecimals(n, decimals) {
  return bigNumberify(n).mul(bigNumberify(10).pow(decimals))
}

function getSubgraphEndpoint(network) {
  return {
    avalanche: AVALANCHE_SUBGRAPH_ENDPOINT,
    arbitrum: ARBITRUM_SUBGRAPH_ENDPOINT
  }[network]
}

async function requestSubgraph(network, query) {
  const subgraphEndpoint = getSubgraphEndpoint(network)

  if (!subgraphEndpoint) {
    throw new Error("Unknown network " + network)
  }

  const payload = JSON.stringify({query})
  const res = await fetch(subgraphEndpoint, {
    method: 'POST',
    body: payload,
    headers: {'Content-Type': 'application/json'}
  })

  const j = await res.json()
  if (j.errors) {
    throw new Error(JSON.stringify(j))
  }

  return j.data
}

async function getReferrersTiers(network) {
  const data = await requestSubgraph(network, `{
    referrers(first: 1000, where: { tierId_in: ["2", "1"]}) {
      id,
      tierId
    }
  }`)

  return data.referrers.reduce((memo, item) => {
    memo[item.id] = parseInt(item.tierId)
    return memo
  }, {})
}

async function queryDistributionData(network, fromTimestamp, toTimestamp, account, fxdxPrice, esfxdxRewards) {
  if (fxdxPrice) {
    fxdxPrice = parseUnits(fxdxPrice, USD_DECIMALS)
  }
  if (esfxdxRewards) {
    esfxdxRewards = parseUnits(esfxdxRewards, FXDX_DECIMALS)
  }
  let referrerCondition = ""
  let referralCondition = ""
  if (account) {
    referrerCondition = `,referrer: "${account.toLowerCase()}"`
    referralCondition = `,referral: "${account.toLowerCase()}"`
  }

  const getReferrerStatsQuery = (skip) => `referrerStats(first: 1000, skip: ${skip}, where: {
      period: daily,
      timestamp_gte: ${fromTimestamp},
      timestamp_lt: ${toTimestamp},
      discountUsd_gt: 0
      ${referrerCondition}
    }) {
      id
      totalRebateUsd
      discountUsd
      timestamp
      volume
      tradedReferralsCount
      trades
      referrer
    }`

  const getReferralStatsQuery = (skip) => `referralStats(first: 1000, skip: ${skip}, where: {
      period: daily,
      timestamp_gte: ${fromTimestamp},
      timestamp_lt: ${toTimestamp},
      discountUsd_gt: 0
      ${referralCondition}
    }) {
      id
      discountUsd
      timestamp
      referral
      volume
    }`

  const query = `{
    referrerStats0: ${getReferrerStatsQuery(0)}
    referrerStats1: ${getReferrerStatsQuery(1000)}
    referrerStats2: ${getReferrerStatsQuery(2000)}
    referrerStats3: ${getReferrerStatsQuery(3000)}
    referrerStats4: ${getReferrerStatsQuery(4000)}
    referrerStats5: ${getReferrerStatsQuery(5000)}

    referralStats0: ${getReferralStatsQuery(0)}
    referralStats1: ${getReferralStatsQuery(1000)}
    referralStats2: ${getReferralStatsQuery(2000)}
    referralStats3: ${getReferralStatsQuery(3000)}
    referralStats4: ${getReferralStatsQuery(4000)}
    referralStats5: ${getReferralStatsQuery(5000)}
  }`

  let [data, referrersTiers] = await Promise.all([
    requestSubgraph(network, query),
    getReferrersTiers(network)
  ])

  const referrerStats = [
    ...data.referrerStats0,
    ...data.referrerStats1,
    ...data.referrerStats2,
    ...data.referrerStats3,
    ...data.referrerStats4,
    ...data.referrerStats5,
  ]

  const referralStats = [
    ...data.referralStats0,
    ...data.referralStats1,
    ...data.referralStats2,
    ...data.referralStats3,
    ...data.referralStats4,
    ...data.referralStats5,
  ]

  if (referralStats.length === 6000) {
    throw new Error("Referrals stats should be paginated")
  }

  if (referrerStats.length === 6000) {
    throw new Error("Referrers stats should be paginated")
  }

  let allReferrersRebateUsd = BigNumber.from(0)
  let totalReferralVolume = BigNumber.from(0)
  let bonusTierReferralVolume = BigNumber.from(0)
  let totalRebateUsd = BigNumber.from(0)
  const referrersRebatesData = referrerStats.reduce((memo, item) => {
    const tierId = referrersTiers[item.referrer] || 0
    memo[item.referrer] = memo[item.referrer] || {
      rebateUsd: BigNumber.from(0),
      totalRebateUsd: BigNumber.from(0),
      volume: BigNumber.from(0),
      tradesCount: 0,
      tierId
    }
    const referrerRebatesUsd = BigNumber.from(item.totalRebateUsd).sub(BigNumber.from(item.discountUsd))
    allReferrersRebateUsd = allReferrersRebateUsd.add(referrerRebatesUsd)
    memo[item.referrer].rebateUsd = memo[item.referrer].rebateUsd.add(referrerRebatesUsd)
    memo[item.referrer].totalRebateUsd = memo[item.referrer].totalRebateUsd.add(
      BigNumber.from(item.totalRebateUsd)
    )
    memo[item.referrer].volume = memo[item.referrer].volume.add(BigNumber.from(item.volume))
    memo[item.referrer].tradesCount += Number(item.trades)

    totalRebateUsd = totalRebateUsd.add(BigNumber.from(item.totalRebateUsd))
    totalReferralVolume = totalReferralVolume.add(BigNumber.from(item.volume))
    if (tierId === BONUS_TIER) {
      bonusTierReferralVolume = bonusTierReferralVolume.add(BigNumber.from(item.volume))
    }
    return memo
  }, {})

  if (allReferrersRebateUsd.eq(0)) {
    console.warn("No rebates on %s", network)
    return
  }

  Object.entries(referrersRebatesData).forEach(([account, data]) => {
    data.allReferrersRebateUsd = allReferrersRebateUsd
    data.account = account
    data.share = data.rebateUsd.mul(SHARE_DIVISOR).div(allReferrersRebateUsd)
    data.esfxdxUsd
  })
  if (fxdxPrice && esfxdxRewards) {
    const esfxdxRewardsUsdLimit = esfxdxRewards.mul(fxdxPrice).div(expandDecimals(1, FXDX_DECIMALS))
    let esfxdxRewardsUsdTotal = BigNumber.from(0)
    Object.values(referrersRebatesData).forEach(data => {
      if (data.tierId !== BONUS_TIER) {
        return
      }
      data.esfxdxRewardsUsd = data.volume.div(1000).div(20) // 0.1% margin fee, 0.05% of fee is EsFXDX bonus rewards
      data.esfxdxRewards = data.esfxdxRewardsUsd
        .mul(expandDecimals(1, USD_DECIMALS))
        .div(fxdxPrice)
        .div(expandDecimals(1, 12))
      esfxdxRewardsUsdTotal = esfxdxRewardsUsdTotal.add(data.esfxdxRewardsUsd)
    })

    if (esfxdxRewardsUsdTotal.gt(esfxdxRewardsUsdLimit)) {
      const denominator = esfxdxRewardsUsdTotal.mul(USD_DECIMALS).div(esfxdxRewardsUsdLimit)
      Object.values(referrersRebatesData).forEach(data => {
        data.esfxdxRewardsUsd = data.esfxdxRewardsUsd.mul(USD_DECIMALS).div(denominator)
        data.esfxdxRewards = data.esfxdxRewardsUsd
          .mul(expandDecimals(1, USD_DECIMALS))
          .div(fxdxPrice)
          .div(expandDecimals(1, 12))
      })
    }
  }

  const output = {
    fromTimestamp,
    toTimestamp,
    network,
    totalReferralVolume: totalReferralVolume.toString(),
    totalRebateUsd: totalRebateUsd.toString(),
    shareDivisor: SHARE_DIVISOR.toString(),
    referrers: [],
    referrals: []
  }
  console.log("\nTotal referral volume: %s ($%s)",
    totalReferralVolume.toString(),
    Number(formatUnits(totalReferralVolume, USD_DECIMALS)).toFixed(4)
  )
  console.log("Total fees collected from referral traders: %s ($%s)",
    totalReferralVolume.div(1000).toString(),
    Number(formatUnits(totalReferralVolume.div(1000), USD_DECIMALS)).toFixed(4)
  )
  console.log("Total rebates (for Affiliates + Traders): %s ($%s)",
    totalRebateUsd.toString(),
    Number(formatUnits(totalRebateUsd, USD_DECIMALS)).toFixed(4)
  )

  console.log("\nReferrers (Affiliates):")
  console.log("Rebates sum: %s ($%s)",
    allReferrersRebateUsd.toString(),
    Number(formatUnits(allReferrersRebateUsd, USD_DECIMALS)).toFixed(4)
  )
  let consoleData = []
  for (const data of Object.values(referrersRebatesData)) {
    if (data.share.eq(0)) {
      continue
    }
    consoleData.push({
      referrer: data.account,
      "share, %": stringToFixed(formatUnits(data.share, 7), 4),
      "volume, $": stringToFixed(formatUnits(data.volume, USD_DECIMALS), 4),
      "rebateUsd, $": stringToFixed(formatUnits(data.rebateUsd, USD_DECIMALS), 4),
      trades: data.tradesCount,
      tierId: data.tierId,
      "esfxdxRewards, $": data.esfxdxRewardsUsd ? formatUnits(data.esfxdxRewardsUsd, USD_DECIMALS) : null,
      esfxdxRewards: data.esfxdxRewards ? formatUnits(data.esfxdxRewards, FXDX_DECIMALS) : null,
    })
    output.referrers.push({
      account: data.account,
      share: data.share.toString(),
      volume: data.volume.toString(),
      tradesCount: data.tradesCount,
      rebateUsd: data.rebateUsd.toString(),
      totalRebateUsd: data.totalRebateUsd.toString(),
      tierId: data.tierId,
      esfxdxRewards: data.esfxdxRewards ? data.esfxdxRewards.toString() : null,
      esfxdxRewardsUsd: data.esfxdxRewardsUsd ? data.esfxdxRewardsUsd.toString() : null,
    })
  }
  console.table(consoleData)

  let allReferralsDiscountUsd = BigNumber.from(0)
  const referralDiscountData = referralStats.reduce((memo, item) => {
    memo[item.referral] = memo[item.referral] || {
      discountUsd: BigNumber.from(0),
      volume: BigNumber.from(0)
    }
    memo[item.referral].discountUsd = memo[item.referral].discountUsd.add(BigNumber.from(item.discountUsd))
    memo[item.referral].volume = memo[item.referral].volume.add(BigNumber.from(item.volume))
    allReferralsDiscountUsd = allReferralsDiscountUsd.add(BigNumber.from(item.discountUsd))
    return memo
  }, {})

  Object.entries(referralDiscountData).forEach(([account, data]) => {
    data.allReferralsDiscountUsd = allReferralsDiscountUsd
    data.account = account
    data.share = data.discountUsd.mul(SHARE_DIVISOR).div(allReferralsDiscountUsd)
  })

  console.log("Referrals (Traders):")
  console.log("Discount sum: %s ($%s)",
    allReferralsDiscountUsd.toString(),
    Number(formatUnits(allReferralsDiscountUsd, USD_DECIMALS)).toFixed(4)
  )
  consoleData = []
  for (const data of Object.values(referralDiscountData)) {
    if (data.share.eq(0)) {
      continue
    }
    consoleData.push({
      referral: data.account,
      "share, %": stringToFixed(formatUnits(data.share, 7), 4),
      "volume, $": stringToFixed(formatUnits(data.volume, USD_DECIMALS), 4),
      "discountUsd, $": stringToFixed(formatUnits(data.discountUsd, USD_DECIMALS), 4),
    })
    output.referrals.push({
      account: data.account,
      share: data.share.toString(),
      discountUsd: data.discountUsd.toString(),
      volume: data.volume.toString()
    })
  }
  console.table(consoleData)

  fs.writeFileSync(`./distribution-data-${network}.json`, JSON.stringify(output, null, 4))
}

async function main() {
  const FROM_TIMESTAMP = 1650402000
  const TO_TIMESTAMP = parseInt(Date.now() / 1000)

  const parser = new ArgumentParser({
    description: 'Get distribution data'
  });
  parser.add_argument('-n', '--network', {
    help: 'Network: arbitrum, avalanche',
    required: true
  });
  parser.add_argument('-f', '--from-date', {
    help: 'Date from. E.g. 2022-04-20',
    default: "2022-04-20"
  });
  parser.add_argument('-t', '--to-date', {
    help: 'Date to. Exclusive. E.g. 2022-04-27',
    default: "2022-04-27"
  });
  parser.add_argument('-a', '--account', { help: 'Account address' })
  parser.add_argument('-g', '--fxdx-price', { help: 'FXDX TWAP price' })
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

  await queryDistributionData(
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
