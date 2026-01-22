const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);

    // 1. Deploy HustToken
    const HustToken = await ethers.getContractFactory("HustToken");
    const token = await HustToken.deploy();
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log("HustToken deployed to:", tokenAddress);

    // 2. Deploy TokenExchanger
    const TokenExchanger = await ethers.getContractFactory("TokenExchanger");
    const exchanger = await TokenExchanger.deploy(tokenAddress);
    await exchanger.waitForDeployment();
    const exchangerAddress = await exchanger.getAddress();
    console.log("TokenExchanger deployed to:", exchangerAddress);

    // 3. Deploy Lottery
    const Lottery = await ethers.getContractFactory("Lottery");
    const lottery = await Lottery.deploy(tokenAddress);
    await lottery.waitForDeployment();
    const lotteryAddress = await lottery.getAddress();
    console.log("Lottery deployed to:", lotteryAddress);

    console.log("--- Setting up Roles ---");
    const MINTER_ROLE = await token.MINTER_ROLE();

    await token.grantRole(MINTER_ROLE, exchangerAddress);
    console.log("Granted MINTER_ROLE to Exchanger");

    await token.renounceRole(MINTER_ROLE, deployer.address);
    console.log("Admin renounced MINTER_ROLE (SECURED)");

    console.log("--- Adding Liquidity ---");
    await exchanger.depositLiquidity({ value: ethers.parseEther("1.0") });
    console.log("Deposited 10 ETH liquidity to Exchanger");

    console.log("--- DEPLOYMENT COMPLETE ---");
    console.log("Copy these addresses to your Frontend:");
    console.log({
        TOKEN_ADDRESS: tokenAddress,
        EXCHANGER_ADDRESS: exchangerAddress,
        LOTTERY_ADDRESS: lotteryAddress
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});