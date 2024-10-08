// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title The interface for a Solidly V3 Pool
/// @notice A Solidly pool facilitates swapping and automated market making between any two assets that strictly conform
/// to the ERC20 specification
interface ISolidlyV3Pool {
    /// @notice The 0th storage slot in the pool stores many values, and is exposed as a single method to save gas
    /// when accessed externally.
    /// @return sqrtPriceX96 The current price of the pool as a sqrt(token1/token0) Q64.96 value
    /// tick The current tick of the pool, i.e. according to the last tick transition that was run.
    /// This value may not always be equal to SqrtTickMath.getTickAtSqrtRatio(sqrtPriceX96) if the price is on a tick
    /// boundary.
    /// fee The pool's current fee in hundredths of a bip, i.e. 1e-6
    /// unlocked Whether the pool is currently locked to reentrancy
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint24 fee, bool unlocked);

    /// @notice The currently in range liquidity available to the pool
    /// @dev This value has no relationship to the total liquidity across all ticks
    function liquidity() external view returns (uint128);

    /// @notice Returns the information about a position by the position's key
    /// @param key The position's key is a hash of a preimage composed by the owner, tickLower and tickUpper
    /// @return _liquidity The amount of liquidity in the position,
    /// Returns tokensOwed0 the computed amount of token0 owed to the position as of the last mint/burn/poke,
    /// Returns tokensOwed1 the computed amount of token1 owed to the position as of the last mint/burn/poke
    function positions(
        bytes32 key
    ) external view returns (uint128 _liquidity, uint128 tokensOwed0, uint128 tokensOwed1);

    /// @notice Sets the initial price for the pool
    /// @dev Price is represented as a sqrt(amountToken1/amountToken0) Q64.96 value
    /// @param sqrtPriceX96 the initial sqrt price of the pool as a Q64.96
    function initialize(uint160 sqrtPriceX96) external;

    /// @notice Adds liquidity for the given recipient/tickLower/tickUpper position
    /// No callback; includes additional slippage/deadline protection
    /// @param recipient The address for which the liquidity will be created
    /// @param tickLower The lower tick of the position in which to add liquidity
    /// @param tickUpper The upper tick of the position in which to add liquidity
    /// @param amount The amount of liquidity to mint
    /// @param amount0Min The minimum amount of token0 to spend, which serves as a slippage check
    /// @param amount1Min The minimum amount of token1 to spend, which serves as a slippage check
    /// @param deadline A constraint on the time by which the mint transaction must mined
    /// @return amount0 The amount of token0 that was paid to mint the given amount of liquidity
    /// @return amount1 The amount of token1 that was paid to mint the given amount of liquidity
    function mint(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external returns (uint256 amount0, uint256 amount1);

    /// @notice Convenience method to burn liquidity and then collect owed tokens in one go
    /// Includes additional slippage/deadline protection
    /// @param recipient The address which should receive the tokens collected
    /// @param tickLower The lower tick of the position for which to collect tokens
    /// @param tickUpper The upper tick of the position for which to collect tokens
    /// @param amountToBurn How much liquidity to burn
    /// @param amount0FromBurnMin The minimum amount of token0 that should be accounted for the burned liquidity
    /// @param amount1FromBurnMin The minimum amount of token1 that should be accounted for the burned liquidity
    /// @param amount0ToCollect How much token0 should be withdrawn from the tokens owed
    /// @param amount1ToCollect How much token1 should be withdrawn from the tokens owed
    /// @param deadline A constraint on the time by which the burn transaction must mined
    /// @return amount0FromBurn The amount of token0 accrued to the position from the burn
    /// @return amount1FromBurn The amount of token1 accrued to the position from the burn
    /// @return amount0Collected The amount of token0 collected from the positions
    /// @return amount1Collected The amount of token1 collected from the positions
    function burnAndCollect(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amountToBurn,
        uint256 amount0FromBurnMin,
        uint256 amount1FromBurnMin,
        uint128 amount0ToCollect,
        uint128 amount1ToCollect,
        uint256 deadline
    )
        external
        returns (uint256 amount0FromBurn, uint256 amount1FromBurn, uint128 amount0Collected, uint128 amount1Collected);

    /// @notice Returns the amounts in/out and resulting pool state for a swap without executing the swap
    /// @param zeroForOne The direction of the swap, true for token0 to token1, false for token1 to token0
    /// @param amountSpecified The amount of the swap, which implicitly configures the swap as exact input (positive), or exact output (negative)
    /// @param sqrtPriceLimitX96 The Q64.96 sqrt price limit. If zero for one, the price cannot be less than this
    /// value after the swap. If one for zero, the price cannot be greater than this value after the swap
    /// @return amount0 The delta of the pool's balance of token0 that will result from the swap (exact when negative, minimum when positive)
    /// @return amount1 The delta of the pool's balance of token1 that will result from the swap (exact when negative, minimum when positive)
    /// @return sqrtPriceX96After The value the pool's sqrtPriceX96 will have after the swap
    /// @return tickAfter The value the pool's tick will have after the swap
    /// @return liquidityAfter The value the pool's liquidity will have after the swap
    function quoteSwap(
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96
    )
        external
        view
        returns (int256 amount0, int256 amount1, uint160 sqrtPriceX96After, int24 tickAfter, uint128 liquidityAfter);

    /// @notice Swap token0 for token1, or token1 for token0
    /// Has additional slippage/deadline protection; no callback or referrer tracking
    /// @param recipient The address to receive the output of the swap
    /// @param zeroForOne The direction of the swap, true for token0 to token1, false for token1 to token0
    /// @param amountSpecified The amount of the swap, which implicitly configures the swap as exact input (positive), or exact output (negative)
    /// @param sqrtPriceLimitX96 The Q64.96 sqrt price limit. If zero for one, the price cannot be less than this
    /// value after the swap. If one for zero, the price cannot be greater than this value after the swap
    /// @param amountLimit A constraint on the minimum amount out received (for exact input swaps) or maxium amount spent (exact output swaps)
    /// @param deadline A constraint on the time by which the swap transaction must mined
    /// @return amount0 The delta of the balance of token0 of the pool, exact when negative, minimum when positive
    /// @return amount1 The delta of the balance of token1 of the pool, exact when negative, minimum when positive
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        uint256 amountLimit,
        uint256 deadline
    ) external returns (int256 amount0, int256 amount1);
}
