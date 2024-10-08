// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

interface IBribe {
    function notifyRewardAmount(address rewardsToken, uint256 reward) external;
}
