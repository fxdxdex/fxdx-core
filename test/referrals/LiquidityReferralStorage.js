const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals } = require("../shared/utilities")

use(solidity)

describe("LiquidityReferralStorage", function () {
  const provider = waffle.provider
  const [wallet, user0, rewardManager, tokenManager, mintReceiver] = provider.getWallets()
  let liquidityReferralStorage
  let timelock

  beforeEach(async () => {
    liquidityReferralStorage = await deployContract("LiquidityReferralStorage", []);
    timelock = await deployContract("Timelock", [
      wallet.address,
      5 * 24 * 60 * 60,
      rewardManager.address,
      tokenManager.address,
      mintReceiver.address,
      expandDecimals(1000, 18)
    ])
  })

  it("setTierTotalRebate", async () => {
    await expect(liquidityReferralStorage.connect(user0).setTierTotalRebate(0, 1000))
      .to.be.revertedWith("Governable: forbidden")

    expect(await liquidityReferralStorage.tierTotalRebates(0)).eq(0)

    await expect(liquidityReferralStorage.setTierTotalRebate(0, 10001))
      .to.be.revertedWith("LiquidityReferralStorage: invalid totalRebate")

    await liquidityReferralStorage.setTierTotalRebate(0, 1000)
    expect(await liquidityReferralStorage.tierTotalRebates(0)).eq(1000)

    await liquidityReferralStorage.setTierTotalRebate(0, 500)
    expect(await liquidityReferralStorage.tierTotalRebates(0)).eq(500)
  })

  it("setReferrerTier", async () => {
    await expect(liquidityReferralStorage.connect(user0).setReferrerTier(user0.address, 2))
      .to.be.revertedWith("Governable: forbidden")

    let user0Tier = await liquidityReferralStorage.referrerTiers(user0.address)
    expect(user0Tier).eq(0)

    await liquidityReferralStorage.setReferrerTier(user0.address, 2)
    user0Tier = await liquidityReferralStorage.referrerTiers(user0.address)
    expect(user0Tier).eq(2)
  })
});
