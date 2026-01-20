import React, { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, parseEther } from "ethers";
import ExchangerABI from "../artifacts/TokenExchanger.json";
import MyTokenABI from "../artifacts/HustToken.json";
import { EXCHANGER_ADDRESS, TOKEN_ADDRESS } from "../App";
import { createPublicClient, http, parseAbiItem } from 'viem';
import { hardhat } from 'viem/chains';

const RATE = 100000;

export default function Exchange() {
    const { address } = useAccount();
    const [tab, setTab] = useState("BUY");
    const [amount, setAmount] = useState("");
    const [history, setHistory] = useState([]);

    const { writeContract, data: hash } = useWriteContract();
    const { isSuccess, isLoading } = useWaitForTransactionReceipt({ hash });

    const { data: allowance, refetch: refetchAllowance } = useReadContract({
        address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "allowance", args: [address, EXCHANGER_ADDRESS]
    });

    const fetchHistory = async () => {
        if (!address) return;
        const client = createPublicClient({ chain: hardhat, transport: http() });

        const buyLogs = await client.getLogs({
            address: EXCHANGER_ADDRESS,
            event: parseAbiItem('event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 tokenAmount)'),
            args: { buyer: address },
            fromBlock: 'earliest'
        });

        const sellLogs = await client.getLogs({
            address: EXCHANGER_ADDRESS,
            event: parseAbiItem('event TokensSold(address indexed seller, uint256 tokenAmount, uint256 ethAmount, uint256 fee)'),
            args: { seller: address },
            fromBlock: 'earliest'
        });

        const formattedHistory = [
            ...buyLogs.map(l => ({ type: 'NẠP', amountHST: formatEther(l.args.tokenAmount), amountETH: formatEther(l.args.ethAmount), hash: l.transactionHash })),
            ...sellLogs.map(l => ({ type: 'RÚT', amountHST: formatEther(l.args.tokenAmount), amountETH: formatEther(l.args.ethAmount), hash: l.transactionHash }))
        ].sort((a, b) => b.blockNumber - a.blockNumber); // Cần có logic sort block chuẩn hơn trong thực tế

        setHistory(formattedHistory);
    };

    useEffect(() => { fetchHistory(); if (isSuccess) refetchAllowance(); }, [address, isSuccess]);

    const handleExecute = () => {
        if (!amount) return;
        if (tab === "BUY") {
            writeContract({
                address: EXCHANGER_ADDRESS, abi: ExchangerABI.abi, functionName: "buyHST", value: parseEther(amount)
            });
        } else {
            const weiAmount = parseEther(amount);
            if (!allowance || allowance < weiAmount) {
                writeContract({ address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "approve", args: [EXCHANGER_ADDRESS, parseEther("100000000")] });
            } else {
                writeContract({ address: EXCHANGER_ADDRESS, abi: ExchangerABI.abi, functionName: "sellHST", args: [weiAmount] });
            }
        }
    };

    const receivedVal = tab === "BUY"
        ? (amount ? Number(amount) * RATE : 0)
        : (amount ? (Number(amount) / RATE) * 0.967 : 0);

    // ... (Phần logic trên giữ nguyên)

    return (
        <div className="exchange-container">
            <div className="card exchange-card">
                <h2 style={{ marginTop: 0, marginBottom: '20px', textAlign: 'center' }}>
                    {tab === "BUY" ? "NẠP ETH ➝ HST" : "RÚT HST ➝ ETH"}
                </h2>

                <div className="tabs">
                    <button className={tab === "BUY" ? "active" : ""} onClick={() => setTab("BUY")}>NẠP (MUA)</button>
                    <button className={tab === "SELL" ? "active" : ""} onClick={() => setTab("SELL")}>RÚT (BÁN)</button>
                </div>

                <div className="exchange-form">
                    <label style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                        {tab === "BUY" ? "Nhập số ETH:" : "Nhập số HST:"}
                    </label>

                    {/* [GIAO DIỆN MỚI] Ô nhập to đẹp */}
                    <div className="qty-control" style={{ marginTop: '10px' }}>
                        <input
                            type="number"
                            className="fancy-input" // Class mới trong CSS
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            placeholder="0.0"
                        />
                        <span style={{ paddingRight: '15px', fontWeight: 'bold', color: '#64748b' }}>
                            {tab === "BUY" ? "ETH" : "HST"}
                        </span>
                    </div>

                    <div className="conversion-arrow">⬇️</div>

                    <div className="result-preview">
                        <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Bạn sẽ nhận về:</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: tab === "BUY" ? '#22c55e' : '#38bdf8' }}>
                            {receivedVal.toLocaleString()} {tab === "BUY" ? "HST" : "ETH"}
                        </div>
                        {tab === "SELL" && <div className="fee-note">(Đã trừ phí rút 3.3%)</div>}
                    </div>

                    <button onClick={handleExecute} className="btn-primary" disabled={isLoading}>
                        {isLoading ? "Đang xử lý..." : (tab === "SELL" && (!allowance || allowance < parseEther(amount || "0")) ? "🔓 1. CẤP QUYỀN VÍ (APPROVE)" : (tab === "BUY" ? "NẠP NGAY" : "RÚT VỀ VÍ"))}
                    </button>
                </div>
            </div>

            <div className="card history-card">
                <h3>📜 Lịch sử giao dịch</h3>
                <div className="scroll-box">
                    <table>
                        <thead><tr><th>Loại</th><th>HST</th><th>ETH</th><th>Tx</th></tr></thead>
                        <tbody>
                            {history.map((h, i) => (
                                <tr key={i}>
                                    <td style={{ color: h.type === 'NẠP' ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>{h.type}</td>
                                    <td>{Number(h.amountHST).toFixed(2)}</td>
                                    <td>{Number(h.amountETH).toFixed(5)}</td>
                                    <td><a href={`https://sepolia.etherscan.io/tx/${h.hash}`} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'none' }}>Xem</a></td>
                                </tr>
                            ))}
                            {history.length === 0 && <tr><td colSpan="4" align="center" style={{ color: '#64748b' }}>Chưa có giao dịch nào</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}