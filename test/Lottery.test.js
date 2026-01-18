const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Lottery Contract", function () {
    let lottery;
    let hustToken;
    let owner;
    let player1;
    let player2;
    let player3;
    let referrer;

    const TICKET_PRICE = ethers.parseEther("10");
    const LOTTERY_DURATION = 15 * 60; // 15 minutes in seconds

    beforeEach(async function () {
        // Get signers
        [owner, player1, player2, player3, referrer] = await ethers.getSigners();

        // Deploy HustToken
        const HustToken = await ethers.getContractFactory("HustToken");
        hustToken = await HustToken.deploy();
        await hustToken.waitForDeployment();

        // Deploy Lottery contract
        const Lottery = await ethers.getContractFactory("Lottery");
        lottery = await Lottery.deploy(await hustToken.getAddress());
        await lottery.waitForDeployment();

        // Distribute tokens to players using faucet
        await hustToken.connect(player1).faucet();
        await hustToken.connect(player2).faucet();
        await hustToken.connect(player3).faucet();
        await hustToken.connect(referrer).faucet();

        // Approve lottery contract to spend tokens
        await hustToken.connect(player1).approve(await lottery.getAddress(), ethers.parseEther("1000"));
        await hustToken.connect(player2).approve(await lottery.getAddress(), ethers.parseEther("1000"));
        await hustToken.connect(player3).approve(await lottery.getAddress(), ethers.parseEther("1000"));
    });

    describe("Deployment", function () {
        it("Should set the correct owner", async function () {
            expect(await lottery.owner()).to.equal(owner.address);
        });

        it("Should set the correct payment token", async function () {
            expect(await lottery.paymentToken()).to.equal(await hustToken.getAddress());
        });

        it("Should set the correct ticket price", async function () {
            expect(await lottery.ticketPrice()).to.equal(TICKET_PRICE);
        });

        it("Should initialize lottery ID to 1", async function () {
            expect(await lottery.lotteryId()).to.equal(1);
        });

        it("Should set end time correctly", async function () {
            const endTime = await lottery.endTime();
            const currentTime = await time.latest();
            expect(endTime).to.be.closeTo(currentTime + LOTTERY_DURATION, 10);
        });
    });

    describe("Buying Tickets", function () {
        it("Should allow players to buy tickets", async function () {
            await expect(lottery.connect(player1).buyTickets(1, ethers.ZeroAddress))
                .to.emit(lottery, "TicketsPurchased")
                .withArgs(player1.address, ethers.ZeroAddress, 1);

            const players = await lottery.getPlayers();
            expect(players.length).to.equal(1);
            expect(players[0]).to.equal(player1.address);
        });

        it("Should allow buying multiple tickets", async function () {
            await lottery.connect(player1).buyTickets(5, ethers.ZeroAddress);

            const players = await lottery.getPlayers();
            expect(players.length).to.equal(5);

            // All entries should be the same player
            for (let i = 0; i < 5; i++) {
                expect(players[i]).to.equal(player1.address);
            }
        });

        it("Should revert if quantity is 0", async function () {
            await expect(
                lottery.connect(player1).buyTickets(0, ethers.ZeroAddress)
            ).to.be.revertedWith("Phai mua it nhat 1 ve");
        });

        it("Should revert if player tries to self-refer", async function () {
            await expect(
                lottery.connect(player1).buyTickets(1, player1.address)
            ).to.be.revertedWith("Khong duoc tu ref");
        });

        it("Should revert if lottery has ended", async function () {
            // Fast forward time past lottery end
            await time.increase(LOTTERY_DURATION + 1);

            await expect(
                lottery.connect(player1).buyTickets(1, ethers.ZeroAddress)
            ).to.be.revertedWith("Vong choi da ket thuc");
        });

        it("Should transfer correct amount of tokens", async function () {
            const initialBalance = await hustToken.balanceOf(player1.address);

            await lottery.connect(player1).buyTickets(2, ethers.ZeroAddress);

            const finalBalance = await hustToken.balanceOf(player1.address);
            const expectedCost = TICKET_PRICE * 2n;

            expect(initialBalance - finalBalance).to.equal(expectedCost);
        });

        it("Should revert if player hasn't approved enough tokens", async function () {
            // Use a fresh signer that hasn't been used
            const signers = await ethers.getSigners();
            const newPlayer = signers[5];
            await hustToken.connect(newPlayer).faucet();

            await expect(
                lottery.connect(newPlayer).buyTickets(1, ethers.ZeroAddress)
            ).to.be.reverted; // ERC20 will revert with custom error
        });
    });

    describe("Referral System", function () {
        it("Should save referrer on first purchase", async function () {
            await lottery.connect(player1).buyTickets(1, referrer.address);

            expect(await lottery.referrers(player1.address)).to.equal(referrer.address);
        });

        it("Should pay referral commission", async function () {
            const initialReferrerBalance = await hustToken.balanceOf(referrer.address);
            const ticketQuantity = 2;
            const totalCost = TICKET_PRICE * BigInt(ticketQuantity);
            const expectedCommission = (totalCost * 5n) / 100n; // 5% commission

            await expect(lottery.connect(player1).buyTickets(ticketQuantity, referrer.address))
                .to.emit(lottery, "ReferralPaid")
                .withArgs(referrer.address, player1.address, expectedCommission);

            const finalReferrerBalance = await hustToken.balanceOf(referrer.address);
            expect(finalReferrerBalance - initialReferrerBalance).to.equal(expectedCommission);
        });

        it("Should not change referrer on subsequent purchases", async function () {
            // First purchase with referrer1
            await lottery.connect(player1).buyTickets(1, referrer.address);
            expect(await lottery.referrers(player1.address)).to.equal(referrer.address);

            // Second purchase with different referrer
            await lottery.connect(player1).buyTickets(1, player2.address);

            // Referrer should still be the original one
            expect(await lottery.referrers(player1.address)).to.equal(referrer.address);
        });

        it("Should not pay commission if no referrer", async function () {
            const tx = await lottery.connect(player1).buyTickets(1, ethers.ZeroAddress);
            const receipt = await tx.wait();

            // Check that ReferralPaid event was not emitted
            const referralPaidEvents = receipt.logs.filter(
                log => log.fragment && log.fragment.name === "ReferralPaid"
            );
            expect(referralPaidEvents.length).to.equal(0);
        });
    });

    describe("Winner Selection", function () {
        beforeEach(async function () {
            // Setup: Multiple players buy tickets
            await lottery.connect(player1).buyTickets(3, ethers.ZeroAddress);
            await lottery.connect(player2).buyTickets(2, ethers.ZeroAddress);
            await lottery.connect(player3).buyTickets(1, ethers.ZeroAddress);
        });

        it("Should revert if no players", async function () {
            // Deploy new lottery without players
            const Lottery = await ethers.getContractFactory("Lottery");
            const emptyLottery = await Lottery.deploy(await hustToken.getAddress());

            await time.increase(LOTTERY_DURATION + 1);

            await expect(
                emptyLottery.pickWinner()
            ).to.be.revertedWith("Khong co nguoi choi");
        });

        it("Should revert if lottery hasn't ended", async function () {
            await expect(
                lottery.pickWinner()
            ).to.be.revertedWith("Chua den gio");
        });

        it("Should pick a winner and distribute prize", async function () {
            await time.increase(LOTTERY_DURATION + 1);

            const tx = await lottery.pickWinner();
            const receipt = await tx.wait();

            // Check WinnersPicked event was emitted
            const winnersPickedEvent = receipt.logs.find(
                log => log.fragment && log.fragment.name === "WinnersPicked"
            );
            expect(winnersPickedEvent).to.not.be.undefined;
        });

        it("Should pay admin commission", async function () {
            const initialOwnerBalance = await hustToken.balanceOf(owner.address);

            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            const finalOwnerBalance = await hustToken.balanceOf(owner.address);
            expect(finalOwnerBalance).to.be.gt(initialOwnerBalance);
        });

        it("Should contribute to jackpot pool", async function () {
            const initialJackpot = await lottery.jackpotPool();

            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            const finalJackpot = await lottery.jackpotPool();
            expect(finalJackpot).to.be.gt(initialJackpot);
        });

        it("Should reset players array after picking winner", async function () {
            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            const players = await lottery.getPlayers();
            expect(players.length).to.equal(0);
        });

        it("Should increment lottery ID", async function () {
            const initialId = await lottery.lotteryId();

            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            const finalId = await lottery.lotteryId();
            expect(finalId).to.equal(initialId + 1n);
        });

        it("Should set new end time", async function () {
            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            const newEndTime = await lottery.endTime();
            const currentTime = await time.latest();
            expect(newEndTime).to.be.closeTo(currentTime + LOTTERY_DURATION, 5);
        });

        it("Should save lottery result to history", async function () {
            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            const result = await lottery.history(0);
            expect(result.id).to.equal(1);
            // Check that winners array exists and has at least one winner
            expect(result[1]).to.not.be.undefined; // winners is at index 1 in the struct
            expect(result.winPrize).to.be.gt(0);
        });
    });

    describe("Jackpot Mechanics", function () {
        it("Should accumulate jackpot over multiple rounds", async function () {
            // Round 1
            await lottery.connect(player1).buyTickets(2, ethers.ZeroAddress);
            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            const jackpotAfterRound1 = await lottery.jackpotPool();
            expect(jackpotAfterRound1).to.be.gt(0);

            // Round 2
            await lottery.connect(player2).buyTickets(2, ethers.ZeroAddress);
            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            const jackpotAfterRound2 = await lottery.jackpotPool();
            expect(jackpotAfterRound2).to.be.gt(jackpotAfterRound1);
        });

        it("Should reset jackpot to 0 when hit", async function () {
            // Keep playing rounds until jackpot is hit
            // Note: This test might take multiple attempts due to randomness
            // In a real scenario, you might want to mock the random function

            // Give player more tokens for multiple rounds
            await hustToken.transfer(player1.address, ethers.parseEther("500"));
            await hustToken.connect(player1).approve(await lottery.getAddress(), ethers.parseEther("1000"));

            let jackpotHit = false;
            let attempts = 0;
            const maxAttempts = 30; // Limit attempts to prevent running out of tokens

            while (!jackpotHit && attempts < maxAttempts) {
                await lottery.connect(player1).buyTickets(1, ethers.ZeroAddress);
                await time.increase(LOTTERY_DURATION + 1);

                const tx = await lottery.pickWinner();
                const receipt = await tx.wait();

                // Check if JackpotHit event was emitted
                const jackpotEvent = receipt.logs.find(
                    log => log.fragment && log.fragment.name === "JackpotHit"
                );

                if (jackpotEvent) {
                    jackpotHit = true;
                    const finalJackpot = await lottery.jackpotPool();
                    expect(finalJackpot).to.equal(0);
                }

                attempts++;
            }

            // Note: This test might occasionally fail due to randomness (5% chance per round)
            // With 30 attempts, there's a ~78% chance of hitting at least once
        });
    });

    describe("View Functions", function () {
        it("Should return correct players array", async function () {
            await lottery.connect(player1).buyTickets(2, ethers.ZeroAddress);
            await lottery.connect(player2).buyTickets(1, ethers.ZeroAddress);

            const players = await lottery.getPlayers();
            expect(players.length).to.equal(3);
            expect(players[0]).to.equal(player1.address);
            expect(players[1]).to.equal(player1.address);
            expect(players[2]).to.equal(player2.address);
        });

        it("Should calculate winning chance correctly", async function () {
            await lottery.connect(player1).buyTickets(3, ethers.ZeroAddress);
            await lottery.connect(player2).buyTickets(1, ethers.ZeroAddress);

            const player1Chance = await lottery.getWinningChance(player1.address);
            const player2Chance = await lottery.getWinningChance(player2.address);

            expect(player1Chance).to.equal(75); // 3/4 = 75%
            expect(player2Chance).to.equal(25); // 1/4 = 25%
        });

        it("Should return 0 chance if no tickets bought", async function () {
            await lottery.connect(player1).buyTickets(2, ethers.ZeroAddress);

            const player2Chance = await lottery.getWinningChance(player2.address);
            expect(player2Chance).to.equal(0);
        });

        it("Should return 0 chance if no players", async function () {
            const chance = await lottery.getWinningChance(player1.address);
            expect(chance).to.equal(0);
        });
    });

    describe("HustToken Faucet", function () {
        it("Should mint 100 tokens when faucet is called", async function () {
            const [newUser] = await ethers.getSigners();
            const initialBalance = await hustToken.balanceOf(newUser.address);

            await hustToken.connect(newUser).faucet();

            const finalBalance = await hustToken.balanceOf(newUser.address);
            expect(finalBalance - initialBalance).to.equal(ethers.parseEther("100"));
        });

        it("Should allow multiple faucet calls", async function () {
            const signers = await ethers.getSigners();
            const newUser = signers[6]; // Use a fresh signer

            const initialBalance = await hustToken.balanceOf(newUser.address);
            await hustToken.connect(newUser).faucet();
            await hustToken.connect(newUser).faucet();

            const balance = await hustToken.balanceOf(newUser.address);
            expect(balance - initialBalance).to.equal(ethers.parseEther("200"));
        });
    });

    describe("Edge Cases", function () {
        it("Should handle single player lottery", async function () {
            await lottery.connect(player1).buyTickets(1, ethers.ZeroAddress);

            await time.increase(LOTTERY_DURATION + 1);

            const initialBalance = await hustToken.balanceOf(player1.address);
            await lottery.pickWinner();
            const finalBalance = await hustToken.balanceOf(player1.address);

            // Player should win their own money back (minus fees)
            expect(finalBalance).to.be.gt(initialBalance);
        });

        it("Should handle large number of tickets", async function () {
            await hustToken.connect(player1).approve(await lottery.getAddress(), ethers.parseEther("10000"));
            await hustToken.transfer(player1.address, ethers.parseEther("5000"));

            await lottery.connect(player1).buyTickets(50, ethers.ZeroAddress);

            const players = await lottery.getPlayers();
            expect(players.length).to.equal(50);
        });

        it("Should handle multiple rounds correctly", async function () {
            // Round 1
            await lottery.connect(player1).buyTickets(1, ethers.ZeroAddress);
            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            // Round 2
            await lottery.connect(player2).buyTickets(1, ethers.ZeroAddress);
            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            // Round 3
            await lottery.connect(player3).buyTickets(1, ethers.ZeroAddress);
            await time.increase(LOTTERY_DURATION + 1);
            await lottery.pickWinner();

            expect(await lottery.lotteryId()).to.equal(4);
            expect((await lottery.getPlayers()).length).to.equal(0);
        });
    });
});
