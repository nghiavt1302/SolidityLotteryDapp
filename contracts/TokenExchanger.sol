// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./HustToken.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TokenExchanger is Ownable {
    HustToken public token;
    
    uint256 public constant RATE = 100000; // 1 ETH = 100k HST
    
    // Phí 3.3%
    uint256 public constant SELL_FEE_NUMERATOR = 33;
    uint256 public constant FEE_DENOMINATOR = 1000;

    event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 tokenAmount);
    event TokensSold(address indexed seller, uint256 tokenAmount, uint256 ethAmount, uint256 fee);
    event LiquidityAdded(uint256 ethAmount);
    event FeesWithdrawn(uint256 ethAmount);

    constructor(address _tokenAddress) Ownable(msg.sender) {
        token = HustToken(_tokenAddress);
    }

    // Nạp ETH -> HST
    function buyHST() external payable {
        require(msg.value > 0, "Phai gui ETH");
        uint256 tokenAmount = msg.value * RATE;
        token.mint(msg.sender, tokenAmount);
        emit TokensPurchased(msg.sender, msg.value, tokenAmount);
    }

    function sellHST(uint256 _tokenAmount) external {
        require(_tokenAmount > 0, "So luong > 0");
        
        uint256 rawEth = _tokenAmount / RATE;
        uint256 fee = (rawEth * SELL_FEE_NUMERATOR) / FEE_DENOMINATOR;
        uint256 ethToTransfer = rawEth - fee;

        require(address(this).balance >= ethToTransfer, "Exchanger khong du ETH thanh khoan");

        token.burnFrom(msg.sender, _tokenAmount);

        (bool success, ) = payable(msg.sender).call{value: ethToTransfer}("");
        require(success, "Rut ETH that bai");

        emit TokensSold(msg.sender, _tokenAmount, ethToTransfer, fee);
    }

    // Admin nạp/rút vốn
    function depositLiquidity() external payable onlyOwner {
        emit LiquidityAdded(msg.value);
    }

    function withdrawETH(uint256 _amount) external onlyOwner {
        require(address(this).balance >= _amount, "Khong du so du");

        uint256 currentSupply = token.totalSupply();
        uint256 requiredReserve = currentSupply / RATE; 

        uint256 balanceAfterWithdraw = address(this).balance - _amount;
        require(balanceAfterWithdraw >= requiredReserve, "Phai giu lai du von bao chung!");

        (bool success, ) = payable(owner()).call{value: _amount}("");
        require(success, "Rut ETH that bai");

        emit FeesWithdrawn(_amount);
    }

    receive() external payable {}
}