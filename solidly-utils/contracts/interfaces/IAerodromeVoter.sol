// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

interface IAerodromeVoter {
    function claimRewards(address[] calldata gauges) external;

    /// @notice Address of Protocol Voting Escrow
    function ve() external view returns (address);
}
