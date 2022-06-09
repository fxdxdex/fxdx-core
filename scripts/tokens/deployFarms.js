const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const usdf = await contractAt("USDF", "0x85E76cbf4893c1fbcB34dCF1239A91CE2A4CF5a7")
  const wbnb = await contractAt("WETH", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c")
  const xgmt = await contractAt("YieldToken", "0xe304ff0983922787Fd84BC9170CD21bF78B16B10")

  const gmtUsdfPair = { address: "0xa41e57459f09a126F358E118b693789d088eA8A0" }
  const gmtUsdfFarm = await deployContract("YieldFarm", ["GMT-USDF Farm", "GMT-USDF:FARM", gmtUsdfPair.address], "gmtUsdfFarm")

  const xgmtUsdfPair = { address: "0x0b622208fc0691C2486A3AE6B7C875b4A174b317" }
  const xgmtUsdfFarm = await deployContract("YieldFarm", ["xGMT-USDF Farm", "xGMT-USDF:FARM", xgmtUsdfPair.address], "xgmtUsdfFarm")

  const usdfYieldTracker = await deployContract("YieldTracker", [usdf.address], "usdfYieldTracker")
  const usdfRewardDistributor = await deployContract("TimeDistributor", [], "usdfRewardDistributor")

  await sendTxn(usdf.setYieldTrackers([usdfYieldTracker.address]), "usdf.setYieldTrackers")
  await sendTxn(usdfYieldTracker.setDistributor(usdfRewardDistributor.address), "usdfYieldTracker.setDistributor")
  await sendTxn(usdfRewardDistributor.setDistribution([usdfYieldTracker.address], ["0"], [wbnb.address]), "usdfRewardDistributor.setDistribution")

  const xgmtYieldTracker = await deployContract("YieldTracker", [xgmt.address], "xgmtYieldTracker")
  const xgmtRewardDistributor = await deployContract("TimeDistributor", [], "xgmtRewardDistributor")

  await sendTxn(xgmt.setYieldTrackers([xgmtYieldTracker.address]), "xgmt.setYieldTrackers")
  await sendTxn(xgmtYieldTracker.setDistributor(xgmtRewardDistributor.address), "xgmtYieldTracker.setDistributor")
  await sendTxn(xgmtRewardDistributor.setDistribution([xgmtYieldTracker.address], ["0"], [wbnb.address]), "xgmtRewardDistributor.setDistribution")

  const gmtUsdfFarmYieldTrackerXgmt = await deployContract("YieldTracker", [gmtUsdfFarm.address], "gmtUsdfFarmYieldTrackerXgmt")
  const gmtUsdfFarmDistributorXgmt = await deployContract("TimeDistributor", [], "gmtUsdfFarmDistributorXgmt")

  await sendTxn(gmtUsdfFarmYieldTrackerXgmt.setDistributor(gmtUsdfFarmDistributorXgmt.address), "gmtUsdfFarmYieldTrackerXgmt.setDistributor")
  await sendTxn(gmtUsdfFarmDistributorXgmt.setDistribution([gmtUsdfFarmYieldTrackerXgmt.address], ["0"], [xgmt.address]), "gmtUsdfFarmDistributorXgmt.setDistribution")

  const gmtUsdfFarmYieldTrackerWbnb = await deployContract("YieldTracker", [gmtUsdfFarm.address], "gmtUsdfFarmYieldTrackerWbnb")
  const gmtUsdfFarmDistributorWbnb = await deployContract("TimeDistributor", [], "gmtUsdfFarmDistributorWbnb")

  await sendTxn(gmtUsdfFarmYieldTrackerWbnb.setDistributor(gmtUsdfFarmDistributorWbnb.address), "gmtUsdfFarmYieldTrackerWbnb.setDistributor")
  await sendTxn(gmtUsdfFarmDistributorWbnb.setDistribution([gmtUsdfFarmYieldTrackerWbnb.address], ["0"], [wbnb.address]), "gmtUsdfFarmDistributorWbnb.setDistribution")

  await sendTxn(gmtUsdfFarm.setYieldTrackers([gmtUsdfFarmYieldTrackerXgmt.address, gmtUsdfFarmYieldTrackerWbnb.address]), "gmtUsdfFarm.setYieldTrackers")

  const xgmtUsdfFarmYieldTrackerXgmt = await deployContract("YieldTracker", [xgmtUsdfFarm.address], "xgmtUsdfFarmYieldTrackerXgmt")
  const xgmtUsdfFarmDistributorXgmt = await deployContract("TimeDistributor", [], "xgmtUsdfFarmDistributorXgmt")

  await sendTxn(xgmtUsdfFarmYieldTrackerXgmt.setDistributor(xgmtUsdfFarmDistributorXgmt.address), "xgmtUsdfFarmYieldTrackerXgmt.setDistributor")
  await sendTxn(xgmtUsdfFarmDistributorXgmt.setDistribution([xgmtUsdfFarmYieldTrackerXgmt.address], ["0"], [xgmt.address]), "xgmtUsdfFarmDistributorXgmt.setDistribution")

  const xgmtUsdfFarmYieldTrackerWbnb = await deployContract("YieldTracker", [xgmtUsdfFarm.address], "xgmtUsdfFarmYieldTrackerWbnb")
  const xgmtUsdfFarmDistributorWbnb = await deployContract("TimeDistributor", [], "xgmtUsdfFarmDistributorWbnb")

  await sendTxn(xgmtUsdfFarmYieldTrackerWbnb.setDistributor(xgmtUsdfFarmDistributorWbnb.address), "xgmtUsdfFarmYieldTrackerWbnb.setDistributor")
  await sendTxn(xgmtUsdfFarmDistributorWbnb.setDistribution([xgmtUsdfFarmYieldTrackerWbnb.address], ["0"], [wbnb.address]), "gmtUsdfFarmDistributorWbnb.setDistribution")

  await sendTxn(xgmtUsdfFarm.setYieldTrackers([xgmtUsdfFarmYieldTrackerXgmt.address, xgmtUsdfFarmYieldTrackerWbnb.address]), "xgmtUsdfFarm.setYieldTrackers")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
