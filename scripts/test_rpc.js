const axios = require('axios');

const RPC_URL = "https://eth-sepolia.g.alchemy.com/v2/tJvgPJHVTMrzQEZFq1Oxc";
const CURRENT_BLOCK = 10100361; // Approximate current block

async function testGetLogs(range) {
    const fromBlock = "0x" + (CURRENT_BLOCK - range).toString(16);
    const toBlock = "0x" + CURRENT_BLOCK.toString(16);

    console.log(`Testing range: ${range} blocks (from ${fromBlock} to ${toBlock})...`);

    try {
        const response = await axios.post(RPC_URL, {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getLogs",
            params: [{
                fromBlock: fromBlock,
                toBlock: toBlock,
                address: "0xE57a9959bED0051d2e3D720548091555Ab4012d7" // Lottery address
            }]
        });

        if (response.data.error) {
            console.error(`❌ Failed:`, response.data.error);
        } else {
            console.log(`✅ Success! Found ${response.data.result.length} logs.`);
        }
    } catch (error) {
        console.error(`❌ Network/HTTP Error:`, error.message);
    }
}

async function main() {
    await testGetLogs(10);
    await testGetLogs(100);
    await testGetLogs(1000);
    await testGetLogs(10000);
}

main();
