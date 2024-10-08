// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

interface IEqualizerVoter {
    function claimRewards(address[] calldata gauges, address[][] calldata tokens) external;
}
