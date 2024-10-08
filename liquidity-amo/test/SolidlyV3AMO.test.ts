import { expect } from "chai";
import hre, { ethers, upgrades, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Minter,
  BoostStablecoin,
  MockERC20,
  ISolidlyV3Pool,
  ISolidlyV3Factory,
  SolidlyV3AMO
} from "../typechain-types";

before(async () => {
  await network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: "https://rpc.ftm.tools",
          blockNumber: 92000000 // Optional: specify a block number
        }
      }
    ]
  });
});

describe("SolidlyV3AMO", function() {
  let solidlyV3AMO: SolidlyV3AMO;
  let boost: BoostStablecoin;
  let testUSD: MockERC20;
  let minter: Minter;
  let pool: ISolidlyV3Pool;
  let poolFactory: ISolidlyV3Factory;
  let admin: SignerWithAddress;
  let setter: SignerWithAddress;
  let amo: SignerWithAddress;
  let withdrawer: SignerWithAddress;
  let pauser: SignerWithAddress;
  let unpauser: SignerWithAddress;
  let boostMinter: SignerWithAddress;
  let user: SignerWithAddress;

  let SETTER_ROLE: string;
  let AMO_ROLE: string;
  let WITHDRAWER_ROLE: string;
  let PAUSER_ROLE: string;
  let UNPAUSER_ROLE: string;

  const V3_POOL_FACTORY = "0x70Fe4a44EA505cFa3A57b95cF2862D4fd5F0f687";
  const MIN_SQRT_RATIO = BigInt("4295128739"); // Minimum sqrt price ratio
  const MAX_SQRT_RATIO = BigInt("1461446703485210103287273052203988822378723970342"); // Maximum sqrt price ratio
  let sqrtPriceX96: bigint;
  const liquidity = ethers.parseUnits("10000000", 12); // ~10M
  const boostDesired = ethers.parseUnits("11000000", 18); // 10M
  const usdDesired = ethers.parseUnits("11000000", 6); // 10M
  const boostMin4Liquidity = ethers.parseUnits("9990000", 18);
  const usdMin4Liquidity = ethers.parseUnits("9990000", 6);
  const tickLower = -887200;
  const tickUpper = 887200;
  const poolFee = 100;
  const price = "1";
  const boostMultiplier = ethers.parseUnits("1.1", 6);
  const validRangeWidth = ethers.parseUnits("0.01", 6);
  const validRemovingRatio = ethers.parseUnits("1.01", 6);
  const usdUsageRatio = ethers.parseUnits("0.95", 6);
  const boostLowerPriceSell = ethers.parseUnits("0.99", 6);
  const boostUpperPriceBuy = ethers.parseUnits("1.01", 6);
  const errorTolerance = 0.001; // 0.1%

  let boostAddress: string;
  let usdAddress: string;
  let minterAddress: string;
  let poolAddress: string;
  let amoAddress: string;
  let usd2boost: boolean;
  let boost2usd: boolean;
  const deadline = Math.floor(Date.now() / 1000) + 60 * 100;

  beforeEach(async function() {
    this.timeout(100000);
    [admin, setter, amo, withdrawer, pauser, unpauser, boostMinter, user] = await ethers.getSigners();

    // Deploy the actual contracts using deployProxy
    const BoostFactory = await ethers.getContractFactory("BoostStablecoin");
    boost = (await upgrades.deployProxy(BoostFactory, [admin.address]));
    await boost.waitForDeployment();
    boostAddress = await boost.getAddress();

    const MockErc20Factory = await ethers.getContractFactory("MockERC20");
    testUSD = await MockErc20Factory.deploy("USD", "USD", 6);
    await testUSD.waitForDeployment();
    usdAddress = await testUSD.getAddress();

    usd2boost = boostAddress.toLowerCase() > usdAddress.toLowerCase();
    boost2usd = boostAddress.toLowerCase() < usdAddress.toLowerCase();

    const MinterFactory = await ethers.getContractFactory("Minter");
    minter = (await upgrades.deployProxy(MinterFactory, [boostAddress, usdAddress, admin.address]));
    await minter.waitForDeployment();
    minterAddress = await minter.getAddress();

    // Mint Boost and TestUSD
    await boost.grantRole(await boost.MINTER_ROLE(), minterAddress);
    await boost.grantRole(await boost.MINTER_ROLE(), boostMinter.address);
    await boost.connect(boostMinter).mint(admin.address, boostDesired);
    await testUSD.connect(boostMinter).mint(admin.address, usdDesired);

    // Create Pool
    poolFactory = await ethers.getContractAt("ISolidlyV3Factory", V3_POOL_FACTORY);
    const tickSpacing = await poolFactory.feeAmountTickSpacing(poolFee);
    await poolFactory.createPool(boostAddress, usdAddress, poolFee);
    poolAddress = await poolFactory.getPool(boostAddress, usdAddress, tickSpacing);

    if (boostAddress.toLowerCase() < usdAddress.toLowerCase()) {
      sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(Number((BigInt(price) * BigInt(2 ** 192)) / BigInt(10 ** 12)))));
    } else {
      sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(Number((BigInt(price) * BigInt(2 ** 192)) * BigInt(10 ** 12)))));
    }
    pool = await ethers.getContractAt("ISolidlyV3Pool", poolAddress);
    await pool.initialize(sqrtPriceX96);

    // Deploy SolidlyV3AMO using upgrades.deployProxy
    const SolidlyV3AMOFactory = await ethers.getContractFactory("SolidlyV3AMO");
    const args = [
      admin.address,
      boostAddress,
      usdAddress,
      poolAddress,
      minterAddress,
      tickLower,
      tickUpper,
      sqrtPriceX96,
      boostMultiplier,
      validRangeWidth,
      validRemovingRatio,
      usdUsageRatio,
      boostLowerPriceSell,
      boostUpperPriceBuy
    ];
    solidlyV3AMO = (await upgrades.deployProxy(SolidlyV3AMOFactory, args, {
      initializer: "initialize(address,address,address,address,address,int24,int24,uint160,uint256,uint24,uint24,uint24,uint256,uint256)"
    }));
    await solidlyV3AMO.waitForDeployment();
    amoAddress = await solidlyV3AMO.getAddress();

    // Provide liquidity
    await boost.approve(poolAddress, boostDesired);
    await testUSD.approve(poolAddress, usdDesired);

    let amount0Min, amount1Min;
    if (boostAddress.toLowerCase() < usdAddress.toLowerCase()) {
      amount0Min = boostMin4Liquidity;
      amount1Min = usdMin4Liquidity;
    } else {
      amount1Min = boostMin4Liquidity;
      amount0Min = usdMin4Liquidity;
    }
    await pool.mint(
      amoAddress,
      tickLower,
      tickUpper,
      liquidity,
      amount0Min,
      amount1Min,
      deadline
    );

    // Grant Roles
    SETTER_ROLE = await solidlyV3AMO.SETTER_ROLE();
    AMO_ROLE = await solidlyV3AMO.AMO_ROLE();
    WITHDRAWER_ROLE = await solidlyV3AMO.WITHDRAWER_ROLE();
    PAUSER_ROLE = await solidlyV3AMO.PAUSER_ROLE();
    UNPAUSER_ROLE = await solidlyV3AMO.UNPAUSER_ROLE();

    await solidlyV3AMO.grantRole(SETTER_ROLE, setter.address);
    await solidlyV3AMO.grantRole(AMO_ROLE, amo.address);
    await solidlyV3AMO.grantRole(WITHDRAWER_ROLE, withdrawer.address);
    await solidlyV3AMO.grantRole(PAUSER_ROLE, pauser.address);
    await solidlyV3AMO.grantRole(UNPAUSER_ROLE, unpauser.address);
    await minter.grantRole(await minter.AMO_ROLE(), amoAddress);
  });

  describe("Initialization", function() {
    it("Should initialize with correct parameters", async function() {
      expect(await solidlyV3AMO.boost()).to.equal(boostAddress);
      expect(await solidlyV3AMO.usd()).to.equal(usdAddress);
      expect(await solidlyV3AMO.pool()).to.equal(poolAddress);
      expect(await solidlyV3AMO.boostMinter()).to.equal(minterAddress);
      expect(await solidlyV3AMO.tickLower()).to.equal(tickLower);
      expect(await solidlyV3AMO.tickUpper()).to.equal(tickUpper);
      expect(await solidlyV3AMO.targetSqrtPriceX96()).to.equal(sqrtPriceX96);
      expect(await solidlyV3AMO.boostMultiplier()).to.equal(boostMultiplier);
      expect(await solidlyV3AMO.validRangeWidth()).to.equal(validRangeWidth);
      expect(await solidlyV3AMO.validRemovingRatio()).to.equal(validRemovingRatio);
      expect(await solidlyV3AMO.usdUsageRatio()).to.equal(usdUsageRatio);
      expect(await solidlyV3AMO.boostLowerPriceSell()).to.equal(boostLowerPriceSell);
      expect(await solidlyV3AMO.boostUpperPriceBuy()).to.equal(boostUpperPriceBuy);
    });

    it("Should set correct roles", async function() {
      expect(await solidlyV3AMO.hasRole(SETTER_ROLE, setter.address)).to.be.true;
      expect(await solidlyV3AMO.hasRole(AMO_ROLE, amo.address)).to.be.true;
      expect(await solidlyV3AMO.hasRole(WITHDRAWER_ROLE, withdrawer.address)).to.be.true;
      expect(await solidlyV3AMO.hasRole(PAUSER_ROLE, pauser.address)).to.be.true;
      expect(await solidlyV3AMO.hasRole(UNPAUSER_ROLE, unpauser.address)).to.be.true;
    });
  });

  describe("Setter Role Actions", function() {
    describe("setTickBounds", function() {
      it("Should set tick bounds correctly", async function() {
        await expect(solidlyV3AMO.connect(setter).setTickBounds(-100000, 100000))
          .to.emit(solidlyV3AMO, "TickBoundsSet")
          .withArgs(-100000, 100000);
        expect(await solidlyV3AMO.tickLower()).to.equal(-100000);
        expect(await solidlyV3AMO.tickUpper()).to.equal(100000);
      });

      it("Should revert when called by non-setter", async function() {
        await expect(solidlyV3AMO.connect(user).setTickBounds(-100000, 100000))
          .to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${SETTER_ROLE}`);
      });
    });

    describe("setTargetSqrtPriceX96", function() {
      it("Should set target sqrt priceX96 correctly", async function() {
        await expect(solidlyV3AMO.connect(setter).setTargetSqrtPriceX96(MIN_SQRT_RATIO + BigInt(10)))
          .to.emit(solidlyV3AMO, "TargetSqrtPriceX96Set")
          .withArgs(MIN_SQRT_RATIO + BigInt(10));
        expect(await solidlyV3AMO.targetSqrtPriceX96()).to.equal(MIN_SQRT_RATIO + BigInt(10));
      });

      it("Should revert when called by non-setter", async function() {
        await expect(solidlyV3AMO.connect(user).setTargetSqrtPriceX96(MIN_SQRT_RATIO))
          .to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${SETTER_ROLE}`);
      });

      it("Should revert when value is out of range", async function() {
        await expect(solidlyV3AMO.connect(setter).setTargetSqrtPriceX96(MIN_SQRT_RATIO - BigInt(1)))
          .to.be.revertedWithCustomError(solidlyV3AMO, "InvalidRatioValue");
      });
    });

    describe("setParams", function() {
      it("Should set params correctly", async function() {
        await expect(solidlyV3AMO.connect(setter).setParams(
          boostMultiplier + BigInt(100),
          validRangeWidth + BigInt(100),
          validRemovingRatio + BigInt(100),
          usdUsageRatio + BigInt(100),
          boostLowerPriceSell + BigInt(100),
          boostUpperPriceBuy + BigInt(100)
        )).to.emit(solidlyV3AMO, "ParamsSet")
          .withArgs(
            boostMultiplier + BigInt(100),
            validRangeWidth + BigInt(100),
            validRemovingRatio + BigInt(100),
            usdUsageRatio + BigInt(100),
            boostLowerPriceSell + BigInt(100),
            boostUpperPriceBuy + BigInt(100)
          );
        expect(await solidlyV3AMO.boostMultiplier()).to.equal(boostMultiplier + BigInt(100));
        expect(await solidlyV3AMO.validRangeWidth()).to.equal(validRangeWidth + BigInt(100));
        expect(await solidlyV3AMO.validRemovingRatio()).to.equal(validRemovingRatio + BigInt(100));
        expect(await solidlyV3AMO.usdUsageRatio()).to.equal(usdUsageRatio + BigInt(100));
        expect(await solidlyV3AMO.boostLowerPriceSell()).to.equal(boostLowerPriceSell + BigInt(100));
        expect(await solidlyV3AMO.boostUpperPriceBuy()).to.equal(boostUpperPriceBuy + BigInt(100));
      });

      it("Should revert when called by non-setter", async function() {
        await expect(solidlyV3AMO.connect(user).setParams(
          boostMultiplier + BigInt(100),
          validRangeWidth + BigInt(100),
          validRemovingRatio + BigInt(100),
          usdUsageRatio + BigInt(100),
          boostLowerPriceSell + BigInt(100),
          boostUpperPriceBuy + BigInt(100)
        ))
          .to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${SETTER_ROLE}`);
      });

      it("Should revert when value is out of range", async function() {
        await expect(solidlyV3AMO.connect(setter).setParams(
          boostMultiplier + BigInt(100),
          ethers.parseUnits("1.1", 6),
          validRemovingRatio + BigInt(100),
          usdUsageRatio + BigInt(100),
          boostLowerPriceSell + BigInt(100),
          boostUpperPriceBuy + BigInt(100)
        )).to.be.revertedWithCustomError(solidlyV3AMO, "InvalidRatioValue");

        await expect(solidlyV3AMO.connect(setter).setParams(
          boostMultiplier + BigInt(100),
          validRangeWidth + BigInt(100),
          ethers.parseUnits("0.99", 6),
          usdUsageRatio + BigInt(100),
          boostLowerPriceSell + BigInt(100),
          boostUpperPriceBuy + BigInt(100)
        )).to.be.revertedWithCustomError(solidlyV3AMO, "InvalidRatioValue");

        await expect(solidlyV3AMO.connect(setter).setParams(
          boostMultiplier + BigInt(100),
          validRangeWidth + BigInt(100),
          validRemovingRatio + BigInt(100),
          ethers.parseUnits("1.1", 6),
          boostLowerPriceSell + BigInt(100),
          boostUpperPriceBuy + BigInt(100)
        )).to.be.revertedWithCustomError(solidlyV3AMO, "InvalidRatioValue");
      });
    });
  });

  describe("AMO Role Actions", function() {
    // Note: These internal functions are tested indirectly through public functions

    describe("mintAndSellBoost", function() {
      it("Should execute mintAndSellBoost successfully", async function() {
        let limitSqrtPriceX96: bigint;
        const zeroForOne = usd2boost;
        if (zeroForOne) {
          limitSqrtPriceX96 = MIN_SQRT_RATIO + BigInt(10);
        } else {
          limitSqrtPriceX96 = MAX_SQRT_RATIO - BigInt(10);
        }
        const usdToBuy = ethers.parseUnits("1000000", 6);
        await testUSD.connect(admin).mint(user.address, usdToBuy);
        await testUSD.connect(user).approve(poolAddress, usdToBuy);
        await pool.connect(user).swap(
          user.address,
          zeroForOne,
          usdToBuy,
          limitSqrtPriceX96,
          1,
          deadline
        );

        const boostAmount = ethers.parseUnits("990000", 18);
        const usdAmount = ethers.parseUnits("980000", 6);

        expect(await solidlyV3AMO.boostPrice()).to.be.gt(ethers.parseUnits("1.1", 6));
        await expect(solidlyV3AMO.connect(amo).mintAndSellBoost(
          boostAmount,
          usdAmount,
          deadline
        )).to.emit(solidlyV3AMO, "MintSell");
        expect(await solidlyV3AMO.boostPrice()).to.be.approximately(ethers.parseUnits(price, 6), 10);
        expect(await boost.balanceOf(amoAddress)).to.be.equal(0);
      });

      it("Should revert mintAndSellBoost when called by non-amo", async function() {
        const boostAmount = ethers.parseUnits("990000", 18);
        const usdAmount = ethers.parseUnits("980000", 6);
        await expect(solidlyV3AMO.connect(user).mintAndSellBoost(
          boostAmount,
          usdAmount,
          deadline
        )).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`);
      });
    });

    describe("addLiquidity", function() {
      it("Should execute addLiquidity successfully", async function() {
        let limitSqrtPriceX96: bigint;
        const zeroForOne = usd2boost;
        if (zeroForOne) {
          limitSqrtPriceX96 = MIN_SQRT_RATIO + BigInt(10);
        } else {
          limitSqrtPriceX96 = MAX_SQRT_RATIO - BigInt(10);
        }
        const usdToBuy = ethers.parseUnits("1000000", 6);
        await testUSD.connect(admin).mint(user.address, usdToBuy);
        await testUSD.connect(user).approve(poolAddress, usdToBuy);
        await pool.connect(user).swap(
          user.address,
          zeroForOne,
          usdToBuy,
          limitSqrtPriceX96,
          1,
          deadline
        );

        const boostAmount = ethers.parseUnits("990000", 18);
        const usdAmount = ethers.parseUnits("980000", 6);

        await expect(solidlyV3AMO.connect(amo).mintAndSellBoost(
          boostAmount,
          usdAmount,
          deadline
        )).to.emit(solidlyV3AMO, "MintSell");

        const usdBalance = await testUSD.balanceOf(amoAddress);

        await expect(solidlyV3AMO.connect(amo).addLiquidity(
          usdBalance,
          1,
          1,
          deadline
        )).to.emit(solidlyV3AMO, "AddLiquidity");
        expect(await testUSD.balanceOf(amoAddress)).to.be.lt(Math.floor(Number(usdBalance) * errorTolerance));
      });

      it("Should revert addLiquidity when called by non-amo", async function() {
        const usdBalance = ethers.parseUnits("980000", 6);
        await expect(solidlyV3AMO.connect(user).addLiquidity(
          usdBalance,
          1,
          1,
          deadline
        )).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`);
      });
    });

    describe("mintSellFarm", function() {
      it("Should execute mintSellFarm successfully", async function() {
        let limitSqrtPriceX96: bigint;
        const zeroForOne = usd2boost;
        if (zeroForOne) {
          limitSqrtPriceX96 = MIN_SQRT_RATIO + BigInt(10);
        } else {
          limitSqrtPriceX96 = MAX_SQRT_RATIO - BigInt(10);
        }
        const usdToBuy = ethers.parseUnits("1000000", 6);
        await testUSD.connect(admin).mint(user.address, usdToBuy);
        await testUSD.connect(user).approve(poolAddress, usdToBuy);
        await pool.connect(user).swap(
          user.address,
          zeroForOne,
          usdToBuy,
          limitSqrtPriceX96,
          1,
          deadline
        );

        const boostAmount = ethers.parseUnits("990000", 18);
        const usdAmount = ethers.parseUnits("980000", 6);

        expect(await solidlyV3AMO.boostPrice()).to.be.gt(ethers.parseUnits("1.1", 6));
        const tx = await solidlyV3AMO.connect(amo).mintSellFarm(
          boostAmount,
          usdAmount,
          1,
          1,
          deadline
        );
        const receipt = await tx.wait();
        expect(tx).to.emit(solidlyV3AMO, "MintSell");
        expect(tx).to.emit(solidlyV3AMO, "AddLiquidity");
        expect(await solidlyV3AMO.boostPrice()).to.be.approximately(ethers.parseUnits(price, 6), 10);
        expect(await boost.balanceOf(amoAddress)).to.be.equal(0);
        expect(await testUSD.balanceOf(amoAddress)).to.be.lt(Math.floor(Number(usdAmount) * errorTolerance));
        ;
      });

      it("Should revert mintSellFarm when called by non-amo", async function() {
        const boostAmount = ethers.parseUnits("990000", 18);
        const usdAmount = ethers.parseUnits("980000", 6);
        await expect(solidlyV3AMO.connect(user).mintSellFarm(
          boostAmount,
          usdAmount,
          1,
          1,
          deadline
        )).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`);
      });
    });

    describe("unfarmBuyBurn", function() {
      it("Should execute unfarmBuyBurn successfully", async function() {
        let limitSqrtPriceX96: bigint;
        const zeroForOne = boost2usd;
        if (zeroForOne) {
          limitSqrtPriceX96 = MIN_SQRT_RATIO + BigInt(10);
        } else {
          limitSqrtPriceX96 = MAX_SQRT_RATIO - BigInt(10);
        }
        const boostToBuy = ethers.parseUnits("1000000", 18);
        await boost.connect(boostMinter).mint(user.address, boostToBuy);
        await boost.connect(user).approve(poolAddress, boostToBuy);
        await pool.connect(user).swap(
          user.address,
          zeroForOne,
          boostToBuy,
          limitSqrtPriceX96,
          1,
          deadline
        );

        const boostInPool = await boost.balanceOf(poolAddress);
        const totalLiqudity = await pool.liquidity();
        const liqudityToBeRemoved = (boostToBuy * totalLiqudity) / boostInPool;

        expect(await solidlyV3AMO.boostPrice()).to.be.lt(ethers.parseUnits("0.9", 6));
        await expect(solidlyV3AMO.connect(amo).unfarmBuyBurn(
          liqudityToBeRemoved,
          1,
          1,
          1,
          deadline
        )).to.emit(solidlyV3AMO, "UnfarmBuyBurn");
        expect(await solidlyV3AMO.boostPrice()).to.be.approximately(ethers.parseUnits(price, 6), 10);
        expect(await boost.balanceOf(amoAddress)).to.be.equal(0);
        expect(await testUSD.balanceOf(amoAddress)).to.be.equal(0);
      });

      it("Should revert unfarmBuyBurn when called by non-amo", async function() {
        const boostAmount = ethers.parseUnits("990000", 18);
        const boostInPool = await boost.balanceOf(poolAddress);
        const totalLiqudity = await pool.liquidity();
        const liqudityToBeRemoved = (boostAmount * totalLiqudity) / boostInPool;
        await expect(solidlyV3AMO.connect(user).unfarmBuyBurn(
          liqudityToBeRemoved,
          1,
          1,
          1,
          deadline
        )).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`);
      });
    });
  });

  describe("Public AMO Functions", function() {
    describe("mintSellFarm", function() {
      it("Should execute mintSellFarm successfully when price is above 1", async function() {
        let limitSqrtPriceX96: bigint;
        const zeroForOne = usd2boost;
        if (zeroForOne) {
          limitSqrtPriceX96 = MIN_SQRT_RATIO + BigInt(10);
        } else {
          limitSqrtPriceX96 = MAX_SQRT_RATIO - BigInt(10);
        }
        const usdToBuy = ethers.parseUnits("1000000", 6);
        await testUSD.connect(admin).mint(user.address, usdToBuy);
        await testUSD.connect(user).approve(poolAddress, usdToBuy);
        await pool.connect(user).swap(
          user.address,
          zeroForOne,
          usdToBuy,
          limitSqrtPriceX96,
          1,
          deadline
        );

        expect(await solidlyV3AMO.boostPrice()).to.be.gt(ethers.parseUnits("1.1", 6));
        await expect(solidlyV3AMO.connect(amo).mintSellFarm()).to.emit(solidlyV3AMO, "PublicMintSellFarmExecuted");
        expect(await solidlyV3AMO.boostPrice()).to.be.approximately(ethers.parseUnits(price, 6), 10);
        expect(await boost.balanceOf(amoAddress)).to.be.equal(0);
        expect(await testUSD.balanceOf(amoAddress)).to.be.lt(Math.floor(Number(usdToBuy) * errorTolerance));
      });

      it("Should revert mintSellFarm when price is 1", async function() {
        await expect(solidlyV3AMO.connect(amo).mintSellFarm()).to.be.reverted;
      });
    });

    describe("unfarmBuyBurn", function() {
      it("Should execute unfarmBuyBurn successfully when price is above 1", async function() {
        let limitSqrtPriceX96: bigint;
        const zeroForOne = boost2usd;
        if (zeroForOne) {
          limitSqrtPriceX96 = MIN_SQRT_RATIO + BigInt(10);
        } else {
          limitSqrtPriceX96 = MAX_SQRT_RATIO - BigInt(10);
        }
        const boostToBuy = ethers.parseUnits("1000000", 18);
        await boost.connect(boostMinter).mint(user.address, boostToBuy);
        await boost.connect(user).approve(poolAddress, boostToBuy);
        await pool.connect(user).swap(
          user.address,
          zeroForOne,
          boostToBuy,
          limitSqrtPriceX96,
          1,
          deadline
        );

        expect(await solidlyV3AMO.boostPrice()).to.be.lt(ethers.parseUnits("0.9", 6));
        await expect(solidlyV3AMO.connect(amo).unfarmBuyBurn()).to.emit(solidlyV3AMO, "PublicUnfarmBuyBurnExecuted");
        expect(await solidlyV3AMO.boostPrice()).to.be.approximately(ethers.parseUnits(price, 6), 10);
        expect(await boost.balanceOf(amoAddress)).to.be.equal(0);
        expect(await testUSD.balanceOf(amoAddress)).to.be.lt(
          Math.floor(Number(boostToBuy) * (10 ** 6 - Number(usdUsageRatio)) / 10 ** 18));
      });

      it("Should revert unfarmBuyBurn when price is 1", async function() {
        await expect(solidlyV3AMO.connect(amo).unfarmBuyBurn()).to.be.reverted;
      });
    });

    describe("MasterAMO DAO Functions", function() {
      describe("pause", function() {
        it("should allow pauser to pause the contract", async function() {
          await expect(solidlyV3AMO.connect(pauser).pause()).to.not.be.reverted;
          expect(await solidlyV3AMO.paused()).to.equal(true);
        });

        it("should not allow non-pauser to pause the contract", async function() {
          const reverteMessage = `AccessControl: account ${user.address.toLowerCase()} is missing role ${PAUSER_ROLE}`;
          await expect(solidlyV3AMO.connect(user).pause()).to.be.revertedWith(reverteMessage);
        });

        it("should not allow mintAndSellBoost when paused", async function() {
          const boostAmount = ethers.parseUnits("990000", 18);
          const usdAmount = ethers.parseUnits("980000", 6);
          await solidlyV3AMO.connect(pauser).pause();

          await expect(solidlyV3AMO.connect(amo).mintAndSellBoost(
            boostAmount,
            usdAmount,
            deadline
          )).to.be.revertedWith("Pausable: paused");
        });

        it("should not allow addLiquidity when paused", async function() {
          const usdBalance = await testUSD.balanceOf(amoAddress);
          await solidlyV3AMO.connect(pauser).pause();

          await expect(solidlyV3AMO.connect(amo).addLiquidity(
            usdBalance,
            1,
            1,
            deadline
          )).to.be.revertedWith("Pausable: paused");
        });

        it("should not allow mintSellFarm when paused", async function() {
          const boostAmount = ethers.parseUnits("990000", 18);
          const usdAmount = ethers.parseUnits("980000", 6);
          await solidlyV3AMO.connect(pauser).pause();

          await expect(solidlyV3AMO.connect(amo).mintSellFarm(
            boostAmount,
            usdAmount,
            1,
            1,
            deadline
          )).to.be.revertedWith("Pausable: paused");
        });

        it("should not allow unfarmBuyBurn when paused", async function() {
          const liqudityToBeRemoved = "1";
          await solidlyV3AMO.connect(pauser).pause();

          await expect(solidlyV3AMO.connect(amo).unfarmBuyBurn(
            liqudityToBeRemoved,
            1,
            1,
            1,
            deadline
          )).to.be.revertedWith("Pausable: paused");
        });

        it("should not allow public mintSellFarm when paused", async function() {
          await solidlyV3AMO.connect(pauser).pause();
          await expect(solidlyV3AMO.connect(amo).mintSellFarm()).to.be.revertedWith("Pausable: paused");
        });

        it("should not allow public unfarmBuyBurn when paused", async function() {
          await solidlyV3AMO.connect(pauser).pause();
          await expect(solidlyV3AMO.connect(amo).unfarmBuyBurn()).to.be.revertedWith("Pausable: paused");
        });
      });

      describe("unpause", function() {
        it("should allow unpauser to unpause the contract", async function() {
          await solidlyV3AMO.connect(pauser).pause();
          expect(await solidlyV3AMO.paused()).to.equal(true);

          await expect(solidlyV3AMO.connect(unpauser).unpause()).to.not.be.reverted;
          expect(await solidlyV3AMO.paused()).to.equal(false);
        });

        it("should not allow non-unpauser to unpause the contract", async function() {
          await solidlyV3AMO.connect(pauser).pause();
          expect(await solidlyV3AMO.paused()).to.equal(true);

          const reverteMessage = `AccessControl: account ${user.address.toLowerCase()} is missing role ${UNPAUSER_ROLE}`;
          await expect(solidlyV3AMO.connect(user).unpause()).to.be.revertedWith(reverteMessage);
        });
      });

      describe("withdrawERC20", function() {
        it("should allow withdrawer to withdraw ERC20 tokens", async function() {
          const withdrawAmount = ethers.parseUnits("500", 18);
          await testUSD.mint(amoAddress, withdrawAmount);

          await expect(
            solidlyV3AMO.connect(withdrawer).withdrawERC20(usdAddress, withdrawAmount, ethers.ZeroAddress)
          ).to.be.revertedWithCustomError(solidlyV3AMO, "ZeroAddress");

          await expect(
            solidlyV3AMO.connect(withdrawer).withdrawERC20(usdAddress, withdrawAmount, user.address)
          ).to.not.be.reverted;

          const finalBalance = await testUSD.balanceOf(user.address);
          expect(finalBalance).to.equal(withdrawAmount);
        });

        it("should not allow non-withdrawer to withdraw ERC20 tokens", async function() {
          const withdrawAmount = ethers.parseUnits("500", 18);
          const reverteMessage = `AccessControl: account ${user.address.toLowerCase()} is missing role ${WITHDRAWER_ROLE}`;
          await expect(
            solidlyV3AMO.connect(user).withdrawERC20(usdAddress, withdrawAmount, user.address)
          ).to.be.revertedWith(reverteMessage);
        });
      });
    });
  });
});