const axios = require('axios');

const RPC_URLS = [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://1rpc.io/sepolia",
    "https://sepolia.drpc.org",
    "https://rpc.sepolia.org" // flaky one
];

const CURRENT_BLOCK = 10100361; // Approximate current block

async function testRpc(url) {
    const fromBlock = "0x" + (CURRENT_BLOCK - 100).toString(16);
    const toBlock = "0x" + CURRENT_BLOCK.toString(16);

    console.log(`\nTesting ${url}...`);

    try {
        const response = await axios.post(url, {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getLogs",
            params: [{
                fromBlock: fromBlock,
                toBlock: toBlock,
                address: "0xE57a9959bED0051d2e3D720548091555Ab4012d7"
            }]
        }, { timeout: 5000 });

        if (response.data.error) {
            console.error(`❌ Failed:`, response.data.error);
        } else if (response.data.result) {
            console.log(`✅ Success! Found ${response.data.result.length} logs.`);
            return true;
        } else {
            console.error(`❌ Unexpected response:`, response.data);
        }
    } catch (error) {
        console.error(`❌ Network/HTTP Error:`, error.message);
    }
    return false;
}

async function main() {
    for (const url of RPC_URLS) {
        const success = await testRpc(url);
        if (success) {
            console.log(`\n🎉 Found working RPC: ${url}`);
            break;
        }
    }
}

main();
