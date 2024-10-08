import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
// @ts-ignore
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Minter,
  BoostStablecoin,
  MockERC20,
  SolidlyV2AMO,
  IV2Voter,
  IFactory,
  MockRouter,
  IGauge,
  IERC20
} from "../typechain-types";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

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

describe("SolidlyV2AMO", function() {
  let solidlyV2AMO: SolidlyV2AMO;
  let boost: BoostStablecoin;
  let testUSD: MockERC20;
  let minter: Minter;
  let router: MockRouter;
  let v2Voter: IV2Voter;
  let factory: IFactory;
  let gauge: IGauge;
  let pool: IERC20;
  let admin: SignerWithAddress;
  let rewardVault: SignerWithAddress;
  let setter: SignerWithAddress;
  let amoBot: SignerWithAddress;
  let withdrawer: SignerWithAddress;
  let pauser: SignerWithAddress;
  let unpauser: SignerWithAddress;
  let rewardCollector: SignerWithAddress;
  let boostMinter: SignerWithAddress;
  let user: SignerWithAddress;

  let SETTER_ROLE: string;
  let AMO_ROLE: string;
  let WITHDRAWER_ROLE: string;
  let PAUSER_ROLE: string;
  let UNPAUSER_ROLE: string;
  let REWARD_COLLECTOR_ROLE: string;

  const V2_VOTER = "0xE3D1A117dF7DCaC2eB0AC8219341bAd92f18dAC1"; // Equalizer DEX Voter
  const V2_FACTORY = "0xc6366EFD0AF1d09171fe0EBF32c7943BB310832a"; // Equalizer DEX PairFactory
  const WETH = "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83"; // Wrapped FTM
  const boostDesired = ethers.parseUnits("11000000", 18); // 11M
  const usdDesired = ethers.parseUnits("11000000", 6); // 11M
  const boostMin4Liquidity = ethers.parseUnits("9990000", 18); // 9.99M
  const usdMin4Liquidity = ethers.parseUnits("9990000", 6); // 9.99M

  let boostAddress: string;
  let usdAddress: string;
  let minterAddress: string;
  let routerAddress: string;
  let poolAddress: string;
  let gaugeAddress: string;
  let amoAddress: string;
  const deadline = Math.floor(Date.now() / 1000) + 60 * 100;
  const delta = ethers.parseUnits("0.001", 6);
  const params = [
    ethers.parseUnits("1.1", 6), // boostMultiplier
    ethers.parseUnits("0.01", 6), // validRangeWidth
    ethers.parseUnits("1.01", 6), // validRemovingRatio
    ethers.parseUnits("0.99", 6), // boostLowerPriceSell
    ethers.parseUnits("1.01", 6), // boostUpperPriceBuy
    ethers.parseUnits("0.8", 6), // boostSellRatio
    ethers.parseUnits("0.8", 6) // usdBuyRatio
  ];

  beforeEach(async function() {
    [
      admin, rewardVault, setter, amoBot, withdrawer, pauser, unpauser, boostMinter, user, rewardCollector
    ] = await ethers.getSigners();

    // Deploy the actual contracts using deployProxy
    const BoostFactory = await ethers.getContractFactory("BoostStablecoin");
    boost = await upgrades.deployProxy(BoostFactory, [admin.address]);
    await boost.waitForDeployment();
    boostAddress = await boost.getAddress();

    const MockErc20Factory = await ethers.getContractFactory("MockERC20");
    testUSD = await MockErc20Factory.deploy("USD", "USD", 6);
    await testUSD.waitForDeployment();
    usdAddress = await testUSD.getAddress();

    const MinterFactory = await ethers.getContractFactory("Minter");
    minter = await upgrades.deployProxy(MinterFactory, [boostAddress, usdAddress, admin.address]);
    await minter.waitForDeployment();
    minterAddress = await minter.getAddress();

    // Mint Boost and TestUSD
    await boost.grantRole(await boost.MINTER_ROLE(), minterAddress);
    await boost.grantRole(await boost.MINTER_ROLE(), boostMinter.address);
    await boost.connect(boostMinter).mint(admin.address, boostDesired);
    await testUSD.connect(boostMinter).mint(admin.address, usdDesired);

    // Create Pool
    factory = await ethers.getContractAt("IFactory", V2_FACTORY);
    await factory.connect(admin).createPair(boostAddress, usdAddress, true);

    // Get poolAddress
    poolAddress = await factory.getPair(boostAddress, usdAddress, true);

    // create Gauge
    v2Voter = await ethers.getContractAt("IV2Voter", V2_VOTER);
    const governor = await v2Voter.governor();
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [governor]
    });
    const governorSigner = await ethers.getSigner(governor);
    await v2Voter.connect(governorSigner).createGauge(poolAddress);
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [governor]
    });
    gaugeAddress = await v2Voter.gauges(poolAddress);

    //  deploy router
    const RouterFactory = await ethers.getContractFactory("MockRouter", admin);
    router = await RouterFactory.deploy(V2_FACTORY, WETH);
    await router.waitForDeployment();
    routerAddress = await router.getAddress();

    // Deploy SolidlyV3AMO using upgrades.deployProxy
    const SolidlyV2LiquidityAMOFactory = await ethers.getContractFactory("SolidlyV2AMO");
    const args = [
      admin.address,
      boostAddress,
      usdAddress,
      minterAddress,
      routerAddress,
      gaugeAddress,
      rewardVault.address,
      0, //tokenId_
      false //useTokenId_
    ].concat(params);
    solidlyV2AMO = await upgrades.deployProxy(SolidlyV2LiquidityAMOFactory, args, {
      initializer: "initialize(address,address,address,address,address,address,address,uint256,bool,uint256,uint24,uint24,uint256,uint256,uint256,uint256)"
    });
    await solidlyV2AMO.waitForDeployment();
    amoAddress = await solidlyV2AMO.getAddress();

    // provide liquidity
    await boost.approve(routerAddress, boostDesired);
    await testUSD.approve(routerAddress, usdDesired);

    await router.connect(admin).addLiquidity(
      usdAddress,
      boostAddress,
      true,
      usdDesired,
      boostDesired,
      usdMin4Liquidity,
      boostMin4Liquidity,
      amoAddress,
      deadline
    );

    // Deposit LP
    pool = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", poolAddress);
    let lpBalance = await pool.balanceOf(amoAddress);
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [amoAddress]
    });
    await setBalance(amoAddress, ethers.parseEther("1"));
    const amoSigner = await ethers.getSigner(amoAddress);
    await pool.connect(amoSigner).approve(gaugeAddress, lpBalance);
    gauge = await ethers.getContractAt("IGauge", gaugeAddress);
    await gauge.connect(amoSigner)["deposit(uint256)"](lpBalance);
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [amoAddress]
    });

    // Grant Roles
    SETTER_ROLE = await solidlyV2AMO.SETTER_ROLE();
    AMO_ROLE = await solidlyV2AMO.AMO_ROLE();
    WITHDRAWER_ROLE = await solidlyV2AMO.WITHDRAWER_ROLE();
    PAUSER_ROLE = await solidlyV2AMO.PAUSER_ROLE();
    UNPAUSER_ROLE = await solidlyV2AMO.UNPAUSER_ROLE();
    REWARD_COLLECTOR_ROLE = await solidlyV2AMO.REWARD_COLLECTOR_ROLE();

    await solidlyV2AMO.grantRole(SETTER_ROLE, setter.address);
    await solidlyV2AMO.grantRole(AMO_ROLE, amoBot.address);
    await solidlyV2AMO.grantRole(WITHDRAWER_ROLE, withdrawer.address);
    await solidlyV2AMO.grantRole(PAUSER_ROLE, pauser.address);
    await solidlyV2AMO.grantRole(UNPAUSER_ROLE, unpauser.address);
    await solidlyV2AMO.grantRole(REWARD_COLLECTOR_ROLE, rewardCollector.address);
    await minter.grantRole(await minter.AMO_ROLE(), amoAddress);
  });

  it("should initialize with correct parameters", async function() {
    expect(await solidlyV2AMO.boost()).to.equal(boostAddress);
    expect(await solidlyV2AMO.usd()).to.equal(usdAddress);
    expect(await solidlyV2AMO.boostMinter()).to.equal(minterAddress);
  });


  it("should only allow SETTER_ROLE to call setParams", async function() {
    // Try calling setParams without SETTER_ROLE
    await expect(
      solidlyV2AMO.connect(user).setParams(...params)
    ).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${SETTER_ROLE}`);

    // Call setParams with SETTER_ROLE
    await expect(
      solidlyV2AMO.connect(setter).setParams(...params)
    ).to.emit(solidlyV2AMO, "ParamsSet");
  });

  it("should only allow AMO_ROLE to call mintAndSellBoost", async function() {
    const usdToBuy = ethers.parseUnits("1000000", 6);
    const minBoostReceive = ethers.parseUnits("990000", 18);
    const routeBuyBoost = [{
      from: usdAddress,
      to: boostAddress,
      stable: true
    }];

    await testUSD.connect(admin).mint(user.address, usdToBuy);
    await testUSD.connect(user).approve(routerAddress, usdToBuy);
    await router.connect(user).swapExactTokensForTokens(
      usdToBuy,
      minBoostReceive,
      routeBuyBoost,
      user.address,
      deadline
    );

    const boostAmount = ethers.parseUnits("990000", 18);
    const usdAmount = ethers.parseUnits("990000", 6);

    await expect(
      solidlyV2AMO.connect(user).mintAndSellBoost(
        boostAmount,
        usdAmount,
        deadline
      )
    ).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`);

    await expect(
      solidlyV2AMO.connect(amoBot).mintAndSellBoost(
        boostAmount,
        usdAmount,
        deadline
      )
    ).to.emit(solidlyV2AMO, "MintSell");
    expect(await solidlyV2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
  });


  it("should only allow AMO_ROLE to call addLiquidity", async function() {
    const usdAmountToAdd = ethers.parseUnits("1000", 6);
    const boostMinAmount = ethers.parseUnits("900", 18);
    const usdMinAmount = ethers.parseUnits("900", 6);
    await testUSD.connect(admin).mint(amoAddress, usdAmountToAdd);

    await expect(
      solidlyV2AMO.connect(user).addLiquidity(
        usdAmountToAdd,
        boostMinAmount,
        usdMinAmount,
        deadline
      )
    ).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`);

    await solidlyV2AMO.connect(setter).setTokenId(1, true);
    await expect(solidlyV2AMO.connect(amoBot).addLiquidity(
      usdAmountToAdd,
      boostMinAmount,
      usdMinAmount,
      deadline
    )).to.be.revertedWithoutReason();
    await solidlyV2AMO.connect(setter).setTokenId(0, false);

    await expect(
      solidlyV2AMO.connect(amoBot).addLiquidity(
        usdAmountToAdd,
        boostMinAmount,
        usdMinAmount,
        deadline
      )
    ).to.emit(solidlyV2AMO, "AddLiquidityAndDeposit");
  });


  it("should only allow PAUSER_ROLE to pause and UNPAUSER_ROLE to unpause", async function() {
    await expect(solidlyV2AMO.connect(pauser).pause()).to.emit(solidlyV2AMO, "Paused").withArgs(pauser.address);

    await expect(
      solidlyV2AMO.connect(amoBot).mintAndSellBoost(
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("950", 6),
        deadline
      )
    ).to.be.revertedWith("Pausable: paused");

    await expect(solidlyV2AMO.connect(unpauser).unpause()).to.emit(solidlyV2AMO, "Unpaused").withArgs(unpauser.address);
  });

  it("should allow WITHDRAWER_ROLE to withdraw ERC20 tokens", async function() {
    // Transfer some tokens to the contract
    await testUSD.connect(user).mint(amoAddress, ethers.parseUnits("1000", 6));

    // Try withdrawing tokens without WITHDRAWER_ROLE
    await expect(
      solidlyV2AMO.connect(user).withdrawERC20(usdAddress, ethers.parseUnits("1000", 6), user.address)
    ).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${WITHDRAWER_ROLE}`);

    // Withdraw tokens with WITHDRAWER_ROLE
    await solidlyV2AMO.connect(withdrawer).withdrawERC20(usdAddress, ethers.parseUnits("1000", 6), user.address);
    const usdBalanceOfUser = await testUSD.balanceOf(await user.getAddress());
    expect(usdBalanceOfUser).to.be.equal(ethers.parseUnits("1000", 6));
  });

  it("should execute public mintSellFarm when price above 1", async function() {
    const usdToBuy = ethers.parseUnits("1000000", 6);
    const minBoostReceive = ethers.parseUnits("990000", 18);
    const routeBuyBoost = [{
      from: usdAddress,
      to: boostAddress,
      stable: true
    }];
    await testUSD.connect(admin).mint(user.address, usdToBuy);
    await testUSD.connect(user).approve(routerAddress, usdToBuy);
    await router.connect(user).swapExactTokensForTokens(
      usdToBuy,
      minBoostReceive,
      routeBuyBoost,
      user.address,
      deadline
    );

    expect(await solidlyV2AMO.boostPrice()).to.be.gt(ethers.parseUnits("1", 6));

    await expect(solidlyV2AMO.connect(user).mintSellFarm()).to.be.emit(solidlyV2AMO, "PublicMintSellFarmExecuted");
    expect(await solidlyV2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
  });

  it("should correctly return boostPrice", async function() {
    expect(await solidlyV2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
  });

  it("should execute public unfarmBuyBurn when price below 1", async function() {
    const boostToBuy = ethers.parseUnits("1000000", 18);
    const minUsdReceive = ethers.parseUnits("990000", 6);
    const routeSellBoost = [{
      from: boostAddress,
      to: usdAddress,
      stable: true
    }];
    await boost.connect(boostMinter).mint(user.address, boostToBuy);
    await boost.connect(user).approve(routerAddress, boostToBuy);
    await router.connect(user).swapExactTokensForTokens(
      boostToBuy,
      minUsdReceive,
      routeSellBoost,
      user.address,
      deadline
    );

    expect(await solidlyV2AMO.boostPrice()).to.be.lt(ethers.parseUnits("1", 6));

    await expect(solidlyV2AMO.connect(user).unfarmBuyBurn()).to.be.emit(solidlyV2AMO, "PublicUnfarmBuyBurnExecuted");
    expect(await solidlyV2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
  });

  it("should correctly return boostPrice", async function() {
    expect(await solidlyV2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
  });

  describe("should revert when invalid parameters are set", function() {
    for (const i of [1]) {
      it(`param on index ${i}`, async function() {
        let tempParams = [...params];
        tempParams[i] = ethers.parseUnits("1.00001", 6);
        await expect(solidlyV2AMO.connect(setter).setParams(...tempParams)
        ).to.be.revertedWithCustomError(solidlyV2AMO, "InvalidRatioValue");
      });
    }

    for (const i of [2]) {
      it(`param on index ${i}`, async function() {
        let tempParams = [...params];
        tempParams[i] = ethers.parseUnits("0.99999", 6);
        await expect(solidlyV2AMO.connect(setter).setParams(...tempParams)
        ).to.be.revertedWithCustomError(solidlyV2AMO, "InvalidRatioValue");
      });
    }
  });
  describe("get reward", async function() {
    const tokens = [];
    it("should revert when token is not whitelisted", async function() {

    });
    it("should revert for non-setter", async function() {
      await expect(solidlyV2AMO.connect(user).setWhitelistedTokens(tokens, true)).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role ${SETTER_ROLE}`);
    });
    it("should whitelist tokens", async function() {
      await expect(solidlyV2AMO.connect(setter).setWhitelistedTokens(tokens, true)).to.emit(solidlyV2AMO, "RewardTokensSet");
    });
    it("should revert for non-reward_collector", async function() {
      await expect(solidlyV2AMO.connect(user).getReward(tokens, true)).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role ${REWARD_COLLECTOR_ROLE}`);
    });
    it("should get reward", async function() {
      await expect(solidlyV2AMO.connect(rewardCollector).getReward(tokens, true)).to.emit(solidlyV2AMO, "GetReward");
    });
  });
});
