// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Lottery is Ownable {
    using SafeERC20 for IERC20;
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
    event RoundResult(
        uint256 roundId,
        address winner,
        uint256 prize,
        uint256 totalTickets,
        uint256 totalFund,
        uint256 jackpotContribution,
        bool isJackpotHit
    );
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
        token.safeTransferFrom(msg.sender, address(this), totalCost);

        if (!hasPlayedInRound[lotteryId][msg.sender]) {
            hasPlayedInRound[lotteryId][msg.sender] = true;
            uniquePlayersCount++;
        }

        for (uint256 i = 0; i < _quantity; i++) {
            players.push(msg.sender);
        }

        if (_referrer != address(0) && _referrer != msg.sender) {
            token.safeTransfer(_referrer, (totalCost * 1) / 100);
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

        bytes32 bHash = blockhash(block.number - 1);
        if (block.number > 256 && bHash == bytes32(0)) {
            bHash = bytes32(block.prevrandao);
        }

        bytes32 entropy = keccak256(abi.encodePacked(
            bHash, block.prevrandao, block.timestamp, players.length, uniquePlayersCount, msg.sender
        ));
        
        uint256 randomIndex = uint256(entropy) % players.length;
        address winner = players[randomIndex];

        uint256 currentBalance = token.balanceOf(address(this));
        require(currentBalance >= jackpotPool, "Failed: Thieu quy cho jackpot");

        uint256 roundRevenue = currentBalance - jackpotPool;
        uint256 totalTickets = players.length; // Tổng số vé của vòng
        uint256 totalFund = roundRevenue;      // Tổng quỹ của vòng
        
        uint256 adminFee = roundRevenue / 1000; // 0.1% doanh thu
        uint256 callerReward = 0;
        uint256 prize = 0; // Giải cho người thắng
        uint256 toJackpot = (roundRevenue * 10) / 100; // 10% vòng trích vào quỹ JP
        bool jackpotHit = false;

        // Check Max Jackpot Cap
        if (jackpotPool + toJackpot > MAX_JACKPOT) {
            uint256 actualAdd = MAX_JACKPOT - jackpotPool; 
            jackpotPool = MAX_JACKPOT;
            toJackpot = actualAdd; // Actual added amount
        } else {
            jackpotPool += toJackpot;
        }

        prize = roundRevenue - adminFee - toJackpot;

        if (uniquePlayersCount >= MIN_PLAYERS_FOR_JACKPOT) {
             uint256 chance = getCurrentJackpotChance();
             bytes32 jackpotEntropy = keccak256(abi.encodePacked(entropy, winner, jackpotPool));
             uint256 jackpotRoll = uint256(jackpotEntropy) % 10000;
             
             if (jackpotRoll < chance) {
                 jackpotHit = true;
                 prize = prize + jackpotPool;
                 jackpotPool = 0; 
             }
        }
        
        callerReward = (prize * CALLER_REWARD_PERCENT) / 100;
        prize = prize - callerReward;
        
        token.safeTransfer(owner(), adminFee);
        token.safeTransfer(msg.sender, callerReward);
        token.safeTransfer(winner, prize);

        history.push(WinnerHistory(lotteryId, winner, prize, jackpotHit, block.timestamp));
        emit WinnerPicked(winner, prize, jackpotHit);
        emit RoundResult(lotteryId, winner, prize, totalTickets, totalFund, toJackpot, jackpotHit);

        _resetGame();
    }

    function _resetGame() private {
        players = new address[](0);
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