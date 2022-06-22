const { getFrameSigner, deployContract, contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function getArbValues() {
  const signer = await getFrameSigner()

  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx)
  const esFxdxGov = await contractAt("Timelock", await esFxdx.gov(), signer)
  const fxdxVester = await contractAt("Vester", "0x199070DDfd1CFb69173aa2F7e20906F26B363004")
  const fxdxVesterGov = await contractAt("Timelock", await fxdxVester.gov(), signer)
  const flpVester = await contractAt("Vester", "0xA75287d2f8b217273E7FCD7E86eF07D33972042E")
  const flpVesterGov = await contractAt("Timelock", await flpVester.gov(), signer)

  return { esFxdx, esFxdxGov, fxdxVester, fxdxVesterGov, flpVester, flpVesterGov }
}

async function getAvaxValues() {
  const signer = await getFrameSigner()

  const esFxdx = await contractAt("EsFXDX", "0xFf1489227BbAAC61a9209A08929E4c2a526DdD17")
  const esFxdxGov = await contractAt("Timelock", await esFxdx.gov(), signer)
  const fxdxVester = await contractAt("Vester", "0x472361d3cA5F49c8E633FB50385BfaD1e018b445")
  const fxdxVesterGov = await contractAt("Timelock", await fxdxVester.gov(), signer)
  const flpVester = await contractAt("Vester", "0x62331A7Bd1dfB3A7642B7db50B5509E57CA3154A")
  const flpVesterGov = await contractAt("Timelock", await flpVester.gov(), signer)

  return { esFxdx, esFxdxGov, fxdxVester, fxdxVesterGov, flpVester, flpVesterGov }
}

async function main() {
  const method = network === "arbitrum" ? getArbValues : getAvaxValues
  const { esFxdx, esFxdxGov, fxdxVester, fxdxVesterGov, flpVester, flpVesterGov } = await method()

  const esFxdxBatchSender = await deployContract("EsFxdxBatchSender", [esFxdx.address])

  console.log("esFxdx", esFxdx.address)
  console.log("esFxdxGov", esFxdxGov.address)
  console.log("fxdxVester", fxdxVester.address)
  console.log("fxdxVesterGov", fxdxVesterGov.address)
  console.log("flpVester", flpVester.address)
  console.log("flpVesterGov", flpVesterGov.address)

  await sendTxn(esFxdxGov.signalSetHandler(esFxdx.address, esFxdxBatchSender.address, true), "esFxdxGov.signalSetHandler")
  await sendTxn(fxdxVesterGov.signalSetHandler(fxdxVester.address, esFxdxBatchSender.address, true), "fxdxVesterGov.signalSetHandler")
  await sendTxn(flpVesterGov.signalSetHandler(flpVester.address, esFxdxBatchSender.address, true), "flpVesterGov.signalSetHandler")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
