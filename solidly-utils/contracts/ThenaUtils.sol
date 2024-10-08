// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import "./interfaces/IThenaVoter.sol";
import "./MasterUtils.sol";

contract ThenaUtils is MasterUtils {
    event RewardsClaimed(address[] gauges);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function claimRewards(address[] calldata gauges) external nonReentrant onlyRole(OPERATOR_ROLE) {
        IThenaVoter(voter).claimRewards(gauges);
        emit RewardsClaimed(gauges);
    }
}
