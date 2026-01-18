pragma solidity ^0.8.0;

library RandomLib {
    function generateRandomNumber(uint256 length) internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, length)));
    }
}