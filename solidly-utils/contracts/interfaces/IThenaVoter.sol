// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

interface IThenaVoter {
    function claimRewards(address[] calldata gauges) external;
}
