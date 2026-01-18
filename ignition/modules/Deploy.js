const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("LotteryModule", (m) => {
    const token = m.contract("HustToken");
    const lottery = m.contract("Lottery", [token]);
    return { token, lottery };
});