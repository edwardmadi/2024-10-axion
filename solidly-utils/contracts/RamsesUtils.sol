// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import "./interfaces/IRamsesVoter.sol";
import "./MasterUtils.sol";

contract RamsesUtils is MasterUtils {
    event RewardsClaimed(address[] gauges, address[][] tokens);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function claimRewards(
        address[] calldata gauges,
        address[][] calldata tokens
    ) external nonReentrant onlyRole(OPERATOR_ROLE) {
        IRamsesVoter(voter).claimRewards(gauges, tokens);
        emit RewardsClaimed(gauges, tokens);
    }
}
