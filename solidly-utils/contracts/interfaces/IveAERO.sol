// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import "./Ive.sol";

interface IveAERO {
    struct LockedBalance {
        int128 amount;
        uint256 end;
        bool isPermanent;
    }

    function locked(uint256 _tokenId) external view returns (LockedBalance memory);

    function increaseUnlockTime(uint256 _tokenId, uint256 _lockDuration) external;

    function increaseAmount(uint256 _tokenId, uint256 _value) external;
}
