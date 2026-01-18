// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./utils/Random.sol";

contract Lottery is Ownable {
    IERC20 public paymentToken;
    uint256 public ticketPrice;
    uint256 public constant LOTTERY_DURATION = 15 minutes;
    
    uint256 public constant REF_FEE = 5;      
    uint256 public constant ADMIN_FEE = 5;    
    uint256 public constant JACKPOT_ALLOC = 20; 

    address[] public players;
    uint256 public lotteryId;
    uint256 public endTime;
    uint256 public jackpotPool;

    struct LotteryResult {
        uint256 id;
        address[] winners;
        uint256 winPrize;
        bool jackpotHit;
        uint256 jackpotPrize;
        uint256 timestamp;
    }
    LotteryResult[] public history;

    mapping(address => address) public referrers;

    event TicketsPurchased(address indexed player, address indexed referrer, uint256 quantity);
    event ReferralPaid(address indexed referrer, address indexed player, uint256 amount);
    event WinnersPicked(uint256 lotteryId, address[] winners, uint256 prize);
    event JackpotHit(address winner, uint256 amount);

    constructor(address _tokenAddress) Ownable(msg.sender) {
        paymentToken = IERC20(_tokenAddress);
        ticketPrice = 10 * 10 ** 18; 
        lotteryId = 1;
        endTime = block.timestamp + LOTTERY_DURATION;
    }

    function buyTickets(uint256 _quantity, address _referrer) external {
        require(block.timestamp < endTime, "Vong choi da ket thuc");
        require(_quantity > 0, "Phai mua it nhat 1 ve");
        require(_referrer != msg.sender, "Khong duoc tu ref");
        
        uint256 totalPrice = ticketPrice * _quantity;

        // 2. Xử lý Referral (Lưu người giới thiệu nếu là lần đầu)
        if (referrers[msg.sender] == address(0) && _referrer != address(0)) {
            referrers[msg.sender] = _referrer;
        }

        // 3. Trừ tiền của người chơi (Trừ 1 cục to luôn cho tiết kiệm gas)
        bool success = paymentToken.transferFrom(msg.sender, address(this), totalPrice);
        require(success, "Transfer failed. Hay Approve du so tien");

        // 4. Trả hoa hồng Referral (Tính trên tổng tiền)
        address validReferrer = referrers[msg.sender];
        if (validReferrer != address(0)) {
            uint256 commission = (totalPrice * REF_FEE) / 100;
            paymentToken.transfer(validReferrer, commission);
            emit ReferralPaid(validReferrer, msg.sender, commission);
        }

        // 5. Thêm người chơi vào mảng (Vòng lặp)
        // Mua bao nhiêu vé thì push bấy nhiêu lần -> Tăng tỉ lệ trúng
        for (uint256 i = 0; i < _quantity; i++) {
            players.push(msg.sender);
        }

        emit TicketsPurchased(msg.sender, validReferrer, _quantity);
    }

    // --- LOGIC QUAY SỐ (GIỮ NGUYÊN) ---
    function pickWinner() external {
        require(players.length > 0, "Khong co nguoi choi");
        require(block.timestamp >= endTime, "Chua den gio");

        uint256 currentBalance = paymentToken.balanceOf(address(this));
        uint256 roundRevenue = currentBalance - jackpotPool; 
        
        uint256 adminCommission = (roundRevenue * ADMIN_FEE) / 100;
        paymentToken.transfer(owner(), adminCommission);

        uint256 jackpotContribution = (roundRevenue * JACKPOT_ALLOC) / 100;
        jackpotPool += jackpotContribution;

        uint256 currentPot = roundRevenue - adminCommission - jackpotContribution;

        uint256 randomSeed = RandomLib.generateRandomNumber(players.length);
        bool isJackpotHit = (randomSeed % 20 == 0); // 5% cơ hội
        uint256 jackpotWinAmount = 0;
        address jackpotWinner = address(0);

        uint256 winnerIndex = randomSeed % players.length;
        address roundWinner = players[winnerIndex];

        paymentToken.transfer(roundWinner, currentPot);

        if (isJackpotHit) {
            jackpotWinAmount = jackpotPool;
            jackpotWinner = roundWinner; 
            paymentToken.transfer(jackpotWinner, jackpotWinAmount);
            emit JackpotHit(jackpotWinner, jackpotWinAmount);
            jackpotPool = 0;
        }

        address[] memory winnersList = new address[](1);
        winnersList[0] = roundWinner;

        history.push(LotteryResult({
            id: lotteryId,
            winners: winnersList,
            winPrize: currentPot,
            jackpotHit: isJackpotHit,
            jackpotPrize: jackpotWinAmount,
            timestamp: block.timestamp
        }));

        emit WinnersPicked(lotteryId, winnersList, currentPot);

        delete players;
        lotteryId++;
        endTime = block.timestamp + LOTTERY_DURATION;
    }

    function getPlayers() external view returns (address[] memory) {
        return players;
    }
    
    function getWinningChance(address _player) external view returns (uint256) {
        if (players.length == 0) return 0;
        uint256 count = 0;
        for(uint256 i = 0; i < players.length; i++) {
            if (players[i] == _player) {
                count++;
            }
        }
        return (count * 100) / players.length;
    }
}