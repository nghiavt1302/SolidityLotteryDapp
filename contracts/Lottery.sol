pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Lottery is Ownable {
    IERC20 public token;
    uint256 public ticketPrice;
    uint256 public lotteryId;
    address[] public players;
    uint256 public jackpotPool;
    uint256 public endTime;
    uint256 public constant LOTTERY_DURATION = 2 minutes; 

    uint256 public uniquePlayersCount;
    mapping(uint256 => mapping(address => bool)) public hasPlayedInRound;

    // CONFIG JACKPOT
    // 100% = 10000
    uint256 public constant BASE_JACKPOT_CHANCE = 10;
    // Thêm 100 HST trong pool jackpot => + 0.01% xác suất
    uint256 public constant CHANCE_DIVISOR = 100 * 10**18; 

    struct WinnerHistory {
        uint256 round;
        address winner;
        uint256 amount;
        bool isJackpotHit;
        uint256 time;
    }
    WinnerHistory[] public history;

    event TicketPurchased(address indexed player, uint256 amount);
    event WinnerPicked(address indexed winner, uint256 amount, bool isJackpotHit);
    event RoundEndedEmpty(uint256 round); 

    constructor(address _tokenAddress) Ownable(msg.sender) {
        token = IERC20(_tokenAddress);
        ticketPrice = 10 * 10 ** 18;
        lotteryId = 1;
        endTime = block.timestamp + LOTTERY_DURATION;
    }

    // Tính xác suất nổ hũ jackpot hiện tại
    function getCurrentJackpotChance() public view returns (uint256) {
        uint256 bonusChance = jackpotPool / CHANCE_DIVISOR;
        uint256 totalChance = BASE_JACKPOT_CHANCE + bonusChance;
        
        // Xác suất max là 10%
        if (totalChance > 1000) {
            return 1000;
        }
        return totalChance;
    }

    function buyTickets(uint256 _quantity, address _referrer) external {
        require(block.timestamp < endTime, "Vong choi da ket thuc");
        uint256 totalCost = ticketPrice * _quantity;
        token.transferFrom(msg.sender, address(this), totalCost);

        if (!hasPlayedInRound[lotteryId][msg.sender]) {
            hasPlayedInRound[lotteryId][msg.sender] = true;
            uniquePlayersCount++;
        }

        for (uint256 i = 0; i < _quantity; i++) {
            players.push(msg.sender);
        }

        if (_referrer != address(0) && _referrer != msg.sender) {
            token.transfer(_referrer, (totalCost * 10) / 100);
        }

        emit TicketPurchased(msg.sender, _quantity);
    }

    function pickWinner() external {
        require(block.timestamp >= endTime, "Chua het gio");

        // Nếu không ai chơi vòng này
        if (players.length == 0) {
            history.push(WinnerHistory(lotteryId, address(0), 0, false, block.timestamp));
            emit RoundEndedEmpty(lotteryId);
            _resetGame();
            return;
        }

        // Quay số chọn người thắng vòng
        uint256 randomIndex = uint256(keccak256(abi.encodePacked(block.timestamp, players.length, block.prevrandao))) % players.length;
        address winner = players[randomIndex];

        uint256 currentBalance = token.balanceOf(address(this));
        uint256 adminFee = currentBalance / 1000; // Admin ăn 0,1% mỗi vòng
        uint256 prize = 0;
        bool jackpotHit = false;

        // Quay jackpot
        if (uniquePlayersCount > 1) {
             // Đóng góp vào jackpot pool 20%
             uint256 toJackpot = (currentBalance * 20) / 100;
             jackpotPool += toJackpot;

             uint256 chance = getCurrentJackpotChance();
             uint256 jackpotRoll = uint256(keccak256(abi.encodePacked(block.timestamp, winner, jackpotPool))) % 10000;
             
             if (jackpotRoll < chance) {
                 // Nổ hũ jackpot
                 jackpotHit = true;
                 prize = (currentBalance - adminFee - toJackpot) + jackpotPool;
                 jackpotPool = 0;
             } else {
                 prize = currentBalance - adminFee - toJackpot;
             }
        } else {
            prize = currentBalance - adminFee; 
        }
        
        token.transfer(owner(), adminFee);
        token.transfer(winner, prize);

        history.push(WinnerHistory(lotteryId, winner, prize, jackpotHit, block.timestamp));
        emit WinnerPicked(winner, prize, jackpotHit);

        _resetGame();
    }

    function _resetGame() private {
        delete players;
        uniquePlayersCount = 0;
        lotteryId++;
        endTime = block.timestamp + LOTTERY_DURATION;
    }

    function getPlayers() external view returns (address[] memory) {
        return players;
    }

    function getHistory() external view returns (WinnerHistory[] memory) {
        return history;
    }
}