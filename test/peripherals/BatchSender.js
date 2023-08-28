const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")

use(solidity)

describe("BatchSender", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2] = provider.getWallets()
  let batchSender
  let esFxdx
  let bnb

  beforeEach(async () => {
    bnb = await deployContract("Token", [])
    esFxdx = await deployContract("EsFXDX", [])
    batchSender = await deployContract("BatchSender", [])

    await esFxdx.setMinter(wallet.address, true);
  })

  it("setGov", async () => {
    await expect(batchSender.connect(user0).setGov(user1.address))
      .to.be.revertedWith("Governable: forbidden")

    expect(await batchSender.gov()).equal(wallet.address)
    await batchSender.setGov(user1.address)
    expect(await batchSender.gov()).equal(user1.address)
  })

  it("setHandler", async () => {
    await expect(batchSender.connect(user0).setHandler(user1.address, true))
      .to.be.revertedWith("Governable: forbidden")

    expect(await batchSender.isHandler(user0.address)).to.be.false
    await expect(batchSender.connect(user1).setHandler(user0.address, true)).to.be.revertedWith("Governable: forbidden")
    await batchSender.setHandler(user0.address, true)
    expect(await batchSender.isHandler(user0.address)).to.be.true

    await batchSender.setHandler(user0.address, false)
    expect(await batchSender.isHandler(user0.address)).to.be.false
  })

  it("send", async () => {
    await expect(batchSender.connect(user0).send(bnb.address, [user1.address], [1000]))
      .to.be.revertedWith("BatchSender: forbidden")

    await batchSender.setHandler(user0.address, true)

    await bnb.mint(user0.address, 1000)
    expect(await bnb.balanceOf(user1.address)).equal("0")
    expect(await bnb.balanceOf(user2.address)).equal("0")

    await bnb.connect(user0).approve(batchSender.address, 1000)
    await batchSender.connect(user0).send(bnb.address, [user1.address, user2.address], [200, 800])

    expect(await bnb.balanceOf(user1.address)).equal("200")
    expect(await bnb.balanceOf(user2.address)).equal("800")
  })

  it("sendAndEmit", async () => {
    await expect(batchSender.connect(user0).sendAndEmit(bnb.address, [user1.address], [1000], 1))
      .to.be.revertedWith("BatchSender: forbidden")

    await batchSender.setHandler(user0.address, true)

    await bnb.mint(user0.address, 2000)
    expect(await bnb.balanceOf(user1.address)).equal("0")
    expect(await bnb.balanceOf(user2.address)).equal("0")

    await bnb.connect(user0).approve(batchSender.address, 2000)
    await batchSender.connect(user0).sendAndEmit(bnb.address, [user1.address, user2.address], [500, 1500], 1)

    expect(await bnb.balanceOf(user1.address)).equal("500")
    expect(await bnb.balanceOf(user2.address)).equal("1500")
  })

  it("sendAndEmit esFxdx", async () => {
    await expect(batchSender.connect(user0).sendAndEmit(esFxdx.address, [user1.address], [1000], 1))
      .to.be.revertedWith("BatchSender: forbidden")

    await batchSender.setHandler(user0.address, true)

    await esFxdx.mint(user0.address, 2000)
    await esFxdx.connect(user0).approve(batchSender.address, 2000)

    await esFxdx.setInPrivateTransferMode(true)

    await expect(batchSender.connect(user0).sendAndEmit(esFxdx.address, [user1.address, user2.address], [500, 1500], 2))
      .to.be.revertedWith("BaseToken: msg.sender not whitelisted")

    await esFxdx.setHandler(batchSender.address, true)

    expect(await esFxdx.balanceOf(user1.address)).equal("0")
    expect(await esFxdx.balanceOf(user2.address)).equal("0")

    await batchSender.connect(user0).sendAndEmit(esFxdx.address, [user1.address, user2.address], [500, 1500], 2)

    expect(await esFxdx.balanceOf(user1.address)).equal("500")
    expect(await esFxdx.balanceOf(user2.address)).equal("1500")
  })
});
