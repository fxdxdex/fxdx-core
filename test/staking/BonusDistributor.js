const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")

use(solidity)

describe("BonusDistributor", function () {
  const provider = waffle.provider
  const [wallet, rewardRouter, user0, user1, user2, user3] = provider.getWallets()
  let fxdx
  let esFxdx
  let bnFxdx
  let stakedFxdxTracker
  let stakedFxdxDistributor
  let bonusFxdxTracker
  let bonusFxdxDistributor

  beforeEach(async () => {
    fxdx = await deployContract("FXDX", []);
    esFxdx = await deployContract("EsFXDX", []);
    bnFxdx = await deployContract("MintableBaseToken", ["Bonus FXDX", "bnFXDX", 0]);

    stakedFxdxTracker = await deployContract("RewardTracker", ["Staked FXDX", "stFXDX"])
    stakedFxdxDistributor = await deployContract("RewardDistributor", [esFxdx.address, stakedFxdxTracker.address])
    await stakedFxdxDistributor.updateLastDistributionTime()

    bonusFxdxTracker = await deployContract("RewardTracker", ["Staked + Bonus FXDX", "sbFXDX"])
    bonusFxdxDistributor = await deployContract("BonusDistributor", [bnFxdx.address, bonusFxdxTracker.address])
    await bonusFxdxDistributor.updateLastDistributionTime()

    await stakedFxdxTracker.initialize([fxdx.address, esFxdx.address], stakedFxdxDistributor.address)
    await bonusFxdxTracker.initialize([stakedFxdxTracker.address], bonusFxdxDistributor.address)

    await stakedFxdxTracker.setInPrivateTransferMode(true)
    await stakedFxdxTracker.setInPrivateStakingMode(true)
    await bonusFxdxTracker.setInPrivateTransferMode(true)
    await bonusFxdxTracker.setInPrivateStakingMode(true)

    await stakedFxdxTracker.setHandler(rewardRouter.address, true)
    await stakedFxdxTracker.setHandler(bonusFxdxTracker.address, true)
    await bonusFxdxTracker.setHandler(rewardRouter.address, true)
    await bonusFxdxDistributor.setBonusMultiplier(10000)
  })

  it("distributes bonus", async () => {
    await esFxdx.setMinter(wallet.address, true)
    await esFxdx.mint(stakedFxdxDistributor.address, expandDecimals(50000, 18))
    await bnFxdx.setMinter(wallet.address, true)
    await bnFxdx.mint(bonusFxdxDistributor.address, expandDecimals(1500, 18))
    await stakedFxdxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esFxdx per second
    await fxdx.setMinter(wallet.address, true)
    await fxdx.mint(user0.address, expandDecimals(1000, 18))

    await fxdx.connect(user0).approve(stakedFxdxTracker.address, expandDecimals(1001, 18))
    await expect(stakedFxdxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, fxdx.address, expandDecimals(1001, 18)))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")
    await stakedFxdxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, fxdx.address, expandDecimals(1000, 18))
    await expect(bonusFxdxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, stakedFxdxTracker.address, expandDecimals(1001, 18)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds balance")
    await bonusFxdxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, stakedFxdxTracker.address, expandDecimals(1000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedFxdxTracker.claimable(user0.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedFxdxTracker.claimable(user0.address)).lt(expandDecimals(1786, 18))
    expect(await bonusFxdxTracker.claimable(user0.address)).gt("2730000000000000000") // 2.73, 1000 / 365 => ~2.74
    expect(await bonusFxdxTracker.claimable(user0.address)).lt("2750000000000000000") // 2.75

    await esFxdx.mint(user1.address, expandDecimals(500, 18))
    await esFxdx.connect(user1).approve(stakedFxdxTracker.address, expandDecimals(500, 18))
    await stakedFxdxTracker.connect(rewardRouter).stakeForAccount(user1.address, user1.address, esFxdx.address, expandDecimals(500, 18))
    await bonusFxdxTracker.connect(rewardRouter).stakeForAccount(user1.address, user1.address, stakedFxdxTracker.address, expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedFxdxTracker.claimable(user0.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedFxdxTracker.claimable(user0.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await stakedFxdxTracker.claimable(user1.address)).gt(expandDecimals(595, 18))
    expect(await stakedFxdxTracker.claimable(user1.address)).lt(expandDecimals(596, 18))

    expect(await bonusFxdxTracker.claimable(user0.address)).gt("5470000000000000000") // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusFxdxTracker.claimable(user0.address)).lt("5490000000000000000") // 5.49

    expect(await bonusFxdxTracker.claimable(user1.address)).gt("1360000000000000000") // 1.36, 500 / 365 => ~1.37
    expect(await bonusFxdxTracker.claimable(user1.address)).lt("1380000000000000000") // 1.38
  })
})
