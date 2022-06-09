const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../shared/utilities")

use(solidity)

describe("Bridge", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let fxdx
  let wfxdx
  let bridge

  beforeEach(async () => {
    fxdx = await deployContract("FXDX", [])
    wfxdx = await deployContract("FXDX", [])
    bridge = await deployContract("Bridge", [fxdx.address, wfxdx.address])
  })

  it("wrap, unwrap", async () => {
    await fxdx.setMinter(wallet.address, true)
    await fxdx.mint(user0.address, 100)
    await fxdx.connect(user0).approve(bridge.address, 100)
    await expect(bridge.connect(user0).wrap(200, user1.address))
      .to.be.revertedWith("BaseToken: transfer amount exceeds allowance")

    await expect(bridge.connect(user0).wrap(100, user1.address))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await wfxdx.setMinter(wallet.address, true)
    await wfxdx.mint(bridge.address, 50)

    await expect(bridge.connect(user0).wrap(100, user1.address))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await wfxdx.mint(bridge.address, 50)

    expect(await fxdx.balanceOf(user0.address)).eq(100)
    expect(await fxdx.balanceOf(bridge.address)).eq(0)
    expect(await wfxdx.balanceOf(user1.address)).eq(0)
    expect(await wfxdx.balanceOf(bridge.address)).eq(100)

    await bridge.connect(user0).wrap(100, user1.address)

    expect(await fxdx.balanceOf(user0.address)).eq(0)
    expect(await fxdx.balanceOf(bridge.address)).eq(100)
    expect(await wfxdx.balanceOf(user1.address)).eq(100)
    expect(await wfxdx.balanceOf(bridge.address)).eq(0)

    await wfxdx.connect(user1).approve(bridge.address, 100)

    expect(await fxdx.balanceOf(user2.address)).eq(0)
    expect(await fxdx.balanceOf(bridge.address)).eq(100)
    expect(await wfxdx.balanceOf(user1.address)).eq(100)
    expect(await wfxdx.balanceOf(bridge.address)).eq(0)

    await bridge.connect(user1).unwrap(100, user2.address)

    expect(await fxdx.balanceOf(user2.address)).eq(100)
    expect(await fxdx.balanceOf(bridge.address)).eq(0)
    expect(await wfxdx.balanceOf(user1.address)).eq(0)
    expect(await wfxdx.balanceOf(bridge.address)).eq(100)
  })

  it("withdrawToken", async () => {
    await fxdx.setMinter(wallet.address, true)
    await fxdx.mint(bridge.address, 100)

    await expect(bridge.connect(user0).withdrawToken(fxdx.address, user1.address, 100))
      .to.be.revertedWith("Governable: forbidden")

    await expect(bridge.connect(user0).setGov(user0.address))
      .to.be.revertedWith("Governable: forbidden")

    await bridge.connect(wallet).setGov(user0.address)

    expect(await fxdx.balanceOf(user1.address)).eq(0)
    expect(await fxdx.balanceOf(bridge.address)).eq(100)
    await bridge.connect(user0).withdrawToken(fxdx.address, user1.address, 100)
    expect(await fxdx.balanceOf(user1.address)).eq(100)
    expect(await fxdx.balanceOf(bridge.address)).eq(0)
  })
})
