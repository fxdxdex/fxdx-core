// it("setFees", async () => {
//   await expect(vault.connect(user0).setFees(
//     90, // _taxBasisPoints
//     91, // _stableTaxBasisPoints
//     92, // _mintBurnFeeBasisPoints
//     93, // _swapFeeBasisPoints
//     94, // _stableSwapFeeBasisPoints
//     95, // _marginFeeBasisPoints
//     toUsd(8), // _liquidationFeeUsd
//     96, // _minProfitTime
//     true // _hasDynamicFees
//   )).to.be.revertedWith("Vault: forbidden")

//   await vault.setGov(user0.address)

//   expect(await vault.taxBasisPoints()).eq(50)
//   expect(await vault.stableTaxBasisPoints()).eq(20)
//   expect(await vault.mintBurnFeeBasisPoints()).eq(30)
//   expect(await vault.swapFeeBasisPoints()).eq(30)
//   expect(await vault.stableSwapFeeBasisPoints()).eq(4)
//   expect(await vault.marginFeeBasisPoints()).eq(10)
//   expect(await vault.liquidationFeeUsd()).eq(toUsd(5))
//   expect(await vault.minProfitTime()).eq(0)
//   expect(await vault.hasDynamicFees()).eq(false)
//   await vault.connect(user0).setFees(
//     90, // _taxBasisPoints
//     91, // _stableTaxBasisPoints
//     92, // _mintBurnFeeBasisPoints
//     93, // _swapFeeBasisPoints
//     94, // _stableSwapFeeBasisPoints
//     95, // _marginFeeBasisPoints
//     toUsd(8), // _liquidationFeeUsd
//     96, // _minProfitTime
//     true // _hasDynamicFees
//   )
//   expect(await vault.taxBasisPoints()).eq(90)
//   expect(await vault.stableTaxBasisPoints()).eq(91)
//   expect(await vault.mintBurnFeeBasisPoints()).eq(92)
//   expect(await vault.swapFeeBasisPoints()).eq(93)
//   expect(await vault.stableSwapFeeBasisPoints()).eq(94)
//   expect(await vault.marginFeeBasisPoints()).eq(95)
//   expect(await vault.liquidationFeeUsd()).eq(toUsd(8))
//   expect(await vault.minProfitTime()).eq(96)
//   expect(await vault.hasDynamicFees()).eq(true)
// })

// it("setFundingRate", async () => {
//   await expect(vault.connect(user0).setFundingRate(59 * 60, 10001, 10001))
//     .to.be.revertedWith("Vault: forbidden")

//   await vault.setGov(user0.address)

//   await expect(vault.connect(user0).setFundingRate(59 * 60, 10001, 10001))
//     .to.be.revertedWith("Vault: invalid _fundingInterval")

//   await expect(vault.connect(user0).setFundingRate(60 * 60, 10001, 10001))
//     .to.be.revertedWith("Vault: invalid _fundingRateFactor")

//   await expect(vault.connect(user0).setFundingRate(60 * 60, 10000, 10001))
//     .to.be.revertedWith("Vault: invalid _stableFundingRateFactor")

//   expect(await vault.fundingInterval()).eq(8 * 60 * 60)
//   expect(await vault.fundingRateFactor()).eq(600)
//   expect(await vault.stableFundingRateFactor()).eq(600)
//   await vault.connect(user0).setFundingRate(60 * 60, 10000, 10000)
//   expect(await vault.fundingInterval()).eq(60 * 60)
//   expect(await vault.fundingRateFactor()).eq(10000)
//   expect(await vault.stableFundingRateFactor()).eq(10000)

//   await vault.connect(user0).setFundingRate(120 * 60, 1000,2000)
//   expect(await vault.fundingInterval()).eq(120 * 60)
//   expect(await vault.fundingRateFactor()).eq(1000)
//   expect(await vault.stableFundingRateFactor()).eq(2000)
// })
