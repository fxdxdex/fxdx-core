const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../shared/utilities")

use(solidity)

describe("USDF", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let usdf

  beforeEach(async () => {
    usdf = await deployContract("USDF", [user1.address])
  })

  it("addVault", async () => {
    await expect(usdf.connect(user0).addVault(user0.address))
      .to.be.revertedWith("YieldToken: forbidden")

    await usdf.setGov(user0.address)

    expect(await usdf.vaults(user0.address)).eq(false)
    await usdf.connect(user0).addVault(user0.address)
    expect(await usdf.vaults(user0.address)).eq(true)
  })

  it("removeVault", async () => {
    await expect(usdf.connect(user0).removeVault(user0.address))
      .to.be.revertedWith("YieldToken: forbidden")

    await usdf.setGov(user0.address)

    expect(await usdf.vaults(user0.address)).eq(false)
    await usdf.connect(user0).addVault(user0.address)
    expect(await usdf.vaults(user0.address)).eq(true)
    await usdf.connect(user0).removeVault(user0.address)
    expect(await usdf.vaults(user0.address)).eq(false)
  })

  it("mint", async () => {
    expect(await usdf.balanceOf(user1.address)).eq(0)
    await usdf.connect(user1).mint(user1.address, 1000)
    expect(await usdf.balanceOf(user1.address)).eq(1000)
    expect(await usdf.totalSupply()).eq(1000)

    await expect(usdf.connect(user0).mint(user1.address, 1000))
      .to.be.revertedWith("USDF: forbidden")

    await usdf.addVault(user0.address)

    expect(await usdf.balanceOf(user1.address)).eq(1000)
    await usdf.connect(user0).mint(user1.address, 500)
    expect(await usdf.balanceOf(user1.address)).eq(1500)
    expect(await usdf.totalSupply()).eq(1500)
  })

  it("burn", async () => {
    expect(await usdf.balanceOf(user1.address)).eq(0)
    await usdf.connect(user1).mint(user1.address, 1000)
    expect(await usdf.balanceOf(user1.address)).eq(1000)
    await usdf.connect(user1).burn(user1.address, 300)
    expect(await usdf.balanceOf(user1.address)).eq(700)
    expect(await usdf.totalSupply()).eq(700)

    await expect(usdf.connect(user0).burn(user1.address, 100))
      .to.be.revertedWith("USDF: forbidden")

    await usdf.addVault(user0.address)

    await usdf.connect(user0).burn(user1.address, 100)
    expect(await usdf.balanceOf(user1.address)).eq(600)
    expect(await usdf.totalSupply()).eq(600)
  })
})
