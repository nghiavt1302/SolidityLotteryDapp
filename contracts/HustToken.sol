pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract HustToken is ERC20 {
    constructor() ERC20("HustToken", "HST") {
        _mint(msg.sender, 1000000 * 10 ** 18);
    }

    function faucet() external {
        _mint(msg.sender, 100 * 10 ** 18);
    }
}