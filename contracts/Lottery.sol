// SPDX-License-Identifier: MIT
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
    uint256 public lotteryDuration = 7 minutes; 

    uint256 public uniquePlayersCount;
    mapping(uint256 => mapping(address => bool)) public hasPlayedInRound;

    uint256 public constant BASE_JACKPOT_CHANCE = 10;
    uint256 public constant CHANCE_DIVISOR = 100 * 10**18; 
    uint256 public constant CALLER_REWARD_PERCENT = 2; // 2% cho người quay số
    
    uint256 public constant MAX_JACKPOT = 10000 * 10**18; // Max 10,000 HST jackpot
    uint256 public constant MIN_PLAYERS_FOR_JACKPOT = 3;

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
    event DurationUpdated(uint256 newDuration);

    constructor(address _tokenAddress) Ownable(msg.sender) {
        token = IERC20(_tokenAddress);
        ticketPrice = 10 * 10 ** 18;
        lotteryId = 1;
        endTime = block.timestamp + lotteryDuration;
    }

    function setLotteryDuration(uint256 _seconds) external onlyOwner {
        require(_seconds >= 1 minutes, "Thoi gian qua ngan"); 
        lotteryDuration = _seconds;
        emit DurationUpdated(_seconds);
    }

    function getCurrentJackpotChance() public view returns (uint256) {
        uint256 bonusChance = jackpotPool / CHANCE_DIVISOR;
        uint256 totalChance = BASE_JACKPOT_CHANCE + bonusChance;
        if (totalChance > 1000) return 1000;
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
            // Hoa hồng 1% tiền mua vé cho người giới thiệu
            token.transfer(_referrer, (totalCost * 1) / 100);
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

        bytes32 entropy = keccak256(abi.encodePacked(
            blockhash(block.number - 1),
            block.prevrandao,
            block.timestamp,
            players.length,
            uniquePlayersCount,
            msg.sender
        ));
        
        uint256 randomIndex = uint256(entropy) % players.length;
        address winner = players[randomIndex];

        uint256 currentBalance = token.balanceOf(address(this));
        uint256 adminFee = currentBalance / 1000;
        uint256 prize = 0;
        uint256 callerReward = 0;
        bool jackpotHit = false;

        if (uniquePlayersCount >= MIN_PLAYERS_FOR_JACKPOT) {
             uint256 toJackpot = (currentBalance * 10) / 100;
             if (jackpotPool + toJackpot > MAX_JACKPOT) {
                 uint256 actualAdd = MAX_JACKPOT - jackpotPool; 
                 jackpotPool = MAX_JACKPOT;
                 toJackpot = actualAdd; 
             } else {
                 jackpotPool += toJackpot;
             }

             uint256 chance = getCurrentJackpotChance();
             
             bytes32 jackpotEntropy = keccak256(abi.encodePacked(
                 entropy,
                 winner,
                 jackpotPool,
                 block.number
             ));
             
             uint256 jackpotRoll = uint256(jackpotEntropy) % 10000;
             
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
        
        callerReward = (prize * CALLER_REWARD_PERCENT) / 100;
        prize = prize - callerReward;
        
        token.transfer(owner(), adminFee);
        token.transfer(msg.sender, callerReward);
        token.transfer(winner, prize);

        history.push(WinnerHistory(lotteryId, winner, prize, jackpotHit, block.timestamp));
        emit WinnerPicked(winner, prize, jackpotHit);

        _resetGame();
    }

    function _resetGame() private {
        delete players;
        uniquePlayersCount = 0;
        lotteryId++;
        endTime = block.timestamp + lotteryDuration;
    }

    function getPlayers() external view returns (address[] memory) {
        return players;
    }

    function getHistory() external view returns (WinnerHistory[] memory) {
        return history;
    }
}