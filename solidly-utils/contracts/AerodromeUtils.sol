// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import "./interfaces/IAerodromeVoter.sol";
import "./interfaces/IveAERO.sol";
import "./MasterUtils.sol";

contract AerodromeUtils is MasterUtils {
    event RewardsClaimed(address[] gauges);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function claimRewards(address[] calldata gauges) external nonReentrant onlyRole(OPERATOR_ROLE) {
        IAerodromeVoter(voter).claimRewards(gauges);
        emit RewardsClaimed(gauges);
    }

    function checkIncreaseUnlockTime(uint256 tokenId, uint256 lockDuration) public view override returns (bool) {
        IveAERO.LockedBalance memory currentLocked = IveAERO(ve).locked(tokenId);
        uint256 unlockTime = ((block.timestamp + lockDuration) / 1 weeks) * 1 weeks;
        return unlockTime > currentLocked.end;
    }

    function _increaseUnlockTime(uint256 tokenId, uint256 lockDuration) internal override {
        IveAERO(ve).increaseUnlockTime(tokenId, lockDuration);
    }

    function increaseAmount(uint256 tokenId, uint256 value) external override nonReentrant onlyRole(OPERATOR_ROLE) {
        IveAERO(ve).increaseAmount(tokenId, value);
    }

    function getVoterVe(address voter_) public view override returns (address) {
        return IAerodromeVoter(voter_).ve();
    }
}
