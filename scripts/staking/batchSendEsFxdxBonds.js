const { deployContract, contractAt, sendTxn, readCsv } = require("../shared/helpers")
const { expandDecimals, bigNumberify } = require("../../test/shared/utilities")

const path = require('path')
const fs = require('fs')
const parse = require('csv-parse')

const inputDir = path.resolve(__dirname, "../..") + "/data/bonds/"

const network = (process.env.HARDHAT_NETWORK || 'mainnet');

const inputFile = inputDir + "2022-06-01_transfers.csv"
const shouldSendTxns = false

async function getArbValues() {
  const esFxdx = await contractAt("EsFXDX", "0xf42Ae1D54fd613C9bb14810b0588FaAa09a426cA")
  const esFxdxBatchSender = await contractAt("EsFxdxBatchSender", "0xc3828fa579996090Dc7767E051341338e60207eF")

  const vestWithFxdxOption = "0x544a6ec142Aa9A7F75235fE111F61eF2EbdC250a"
  const vestWithFlpOption = "0x9d8f6f6eE45275A5Ca3C6f6269c5622b1F9ED515"

  const fxdxVester = await contractAt("Vester", "0x199070DDfd1CFb69173aa2F7e20906F26B363004")
  const flpVester = await contractAt("Vester", "0xA75287d2f8b217273E7FCD7E86eF07D33972042E")

  return { esFxdx, esFxdxBatchSender, vestWithFxdxOption, vestWithFlpOption, fxdxVester, flpVester }
}

async function getAvaxValues() {
  const esFxdx = await contractAt("EsFXDX", "0xFf1489227BbAAC61a9209A08929E4c2a526DdD17")
  const esFxdxBatchSender = await contractAt("EsFxdxBatchSender", "0xc9baFef924159138697e72899a2753a3Dc8D1F4d")
  const vestWithFxdxOption = "0x171a321A78dAE0CDC0Ba3409194df955DEEcA746"
  const vestWithFlpOption = "0x28863Dd19fb52DF38A9f2C6dfed40eeB996e3818"

  const fxdxVester = await contractAt("Vester", "0x472361d3cA5F49c8E633FB50385BfaD1e018b445")
  const flpVester = await contractAt("Vester", "0x62331A7Bd1dfB3A7642B7db50B5509E57CA3154A")

  return { esFxdx, esFxdxBatchSender, vestWithFxdxOption, vestWithFlpOption, fxdxVester, flpVester }
}

async function main() {
  const wallet = { address: "0x5F799f365Fa8A2B60ac0429C48B153cA5a6f0Cf8" }

  const values = network === "arbitrum" ? await getArbValues() : await getAvaxValues()
  const { esFxdx, esFxdxBatchSender, vestWithFxdxOption, vestWithFlpOption, fxdxVester, flpVester } = values

  const txns = await readCsv(inputFile)
  console.log("processing list", txns.length)

  const vestWithFxdxAccounts = []
  const vestWithFxdxAmounts = []

  const vestWithFlpAccounts = []
  const vestWithFlpAmounts = []

  let totalEsFxdx = bigNumberify(0)

  for (let i = 0; i < txns.length; i++) {
    const txn = txns[i]
    if (txn.Method !== "Transfer") {
      continue
    }

    const amount = ethers.utils.parseUnits(txn.Quantity, 18)

    if (txn.To.toLowerCase() === vestWithFxdxOption.toLowerCase()) {
      vestWithFxdxAccounts.push(txn.From)
      vestWithFxdxAmounts.push(amount)
      totalEsFxdx = totalEsFxdx.add(amount)
    }

    if (txn.To.toLowerCase() === vestWithFlpOption.toLowerCase()) {
      vestWithFlpAccounts.push(txn.From)
      vestWithFlpAmounts.push(amount)
      totalEsFxdx = totalEsFxdx.add(amount)
    }
  }

  console.log("vestWithFxdxAccounts", vestWithFxdxAccounts.length)
  console.log("vestWithFlpAccounts", vestWithFlpAccounts.length)
  console.log("totalEsFxdx", totalEsFxdx.toString(), ethers.utils.formatUnits(totalEsFxdx, 18))

  if (shouldSendTxns) {
    if (vestWithFxdxAccounts.length > 0) {
      await sendTxn(esFxdxBatchSender.send(fxdxVester.address, 4, vestWithFxdxAccounts, vestWithFxdxAmounts), "esFxdxBatchSender.send(fxdxVester)")
    }
    if (vestWithFlpAccounts.length > 0) {
      await sendTxn(esFxdxBatchSender.send(flpVester.address, 320, vestWithFlpAccounts, vestWithFlpAmounts), "esFxdxBatchSender.send(flpVester)")
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
