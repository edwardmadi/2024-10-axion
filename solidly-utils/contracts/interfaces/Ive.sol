// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

interface Ive {
    struct LockedBalance {
        int128 amount;
        uint end;
    }

    function locked(uint256 _tokenId) external view returns (LockedBalance memory);

    function increase_unlock_time(uint256 _tokenId, uint256 _lock_duration) external;

    function increase_amount(uint256 _tokenId, uint256 _value) external;

    function merge(uint256 _from, uint256 _to) external;
}
