const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const usdf = await contractAt("USDF", "0x85E76cbf4893c1fbcB34dCF1239A91CE2A4CF5a7")
  const wbnb = await contractAt("WETH", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c")
  const xgmt = await contractAt("YieldToken", "0xe304ff0983922787Fd84BC9170CD21bF78B16B10")

  const autoUsdfPair = { address: "0x0523FD5C53ea5419B4DAF656BC1b157dDFE3ce50" }
  const autoUsdfFarm = await deployContract("YieldFarm", ["AUTO-USDF Farm", "AUTO-USDF:FARM", autoUsdfPair.address], "autoUsdfFarm")

  const autoUsdfFarmYieldTrackerXgmt = await deployContract("YieldTracker", [autoUsdfFarm.address], "autoUsdfFarmYieldTrackerXgmt")
  const autoUsdfFarmDistributorXgmt = await deployContract("TimeDistributor", [], "autoUsdfFarmDistributorXgmt")

  await sendTxn(autoUsdfFarmYieldTrackerXgmt.setDistributor(autoUsdfFarmDistributorXgmt.address), "autoUsdfFarmYieldTrackerXgmt.setDistributor")
  await sendTxn(autoUsdfFarmDistributorXgmt.setDistribution([autoUsdfFarmYieldTrackerXgmt.address], ["0"], [xgmt.address]), "autoUsdfFarmDistributorXgmt.setDistribution")

  const autoUsdfFarmYieldTrackerWbnb = await deployContract("YieldTracker", [autoUsdfFarm.address], "autoUsdfFarmYieldTrackerWbnb")
  const autoUsdfFarmDistributorWbnb = await deployContract("TimeDistributor", [], "autoUsdfFarmDistributorWbnb")

  await sendTxn(autoUsdfFarmYieldTrackerWbnb.setDistributor(autoUsdfFarmDistributorWbnb.address), "autoUsdfFarmYieldTrackerWbnb.setDistributor")
  await sendTxn(autoUsdfFarmDistributorWbnb.setDistribution([autoUsdfFarmYieldTrackerWbnb.address], ["0"], [wbnb.address]), "autoUsdfFarmDistributorWbnb.setDistribution")

  await sendTxn(autoUsdfFarm.setYieldTrackers([autoUsdfFarmYieldTrackerXgmt.address, autoUsdfFarmYieldTrackerWbnb.address]), "autoUsdfFarm.setYieldTrackers")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
