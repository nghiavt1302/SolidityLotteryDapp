import React, { useState, useEffect, useMemo } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, parseEther, isAddress } from "ethers";
import LotteryABI from "../artifacts/Lottery.json";
import MyTokenABI from "../artifacts/HustToken.json";
import { LOTTERY_ADDRESS, TOKEN_ADDRESS } from "../App";

const shortenAddress = (addr) => addr ? `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}` : "";

export default function Home() {
    const { address, isConnected } = useAccount();
    const { writeContract, data: hash } = useWriteContract();
    const { isSuccess: isConfirmed, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

    const [ticketQty, setTicketQty] = useState(1);
    const [referrer, setReferrer] = useState("");

    const readConfig = { address: LOTTERY_ADDRESS, abi: LotteryABI.abi, query: { refetchInterval: 2000 } };
    const { data: jackpotPool } = useReadContract({ ...readConfig, functionName: "jackpotPool" });
    const { data: endTime } = useReadContract({ ...readConfig, functionName: "endTime" });
    const { data: players, refetch: refetchPlayers } = useReadContract({ ...readConfig, functionName: "getPlayers" });
    const { data: history, refetch: refetchHistory } = useReadContract({ ...readConfig, functionName: "getHistory" });
    const { data: uniqueCount } = useReadContract({ ...readConfig, functionName: "uniquePlayersCount" });
    const { data: jackpotChance } = useReadContract({ ...readConfig, functionName: "getCurrentJackpotChance" });

    const { data: allowance, refetch: refetchAllowance } = useReadContract({
        address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "allowance", args: [address, LOTTERY_ADDRESS], query: { refetchInterval: 1000 }
    });

    const [timeLeft, setTimeLeft] = useState(0);
    useEffect(() => {
        if (!endTime) return;
        const interval = setInterval(() => {
            const now = Math.floor(Date.now() / 1000);
            const end = Number(endTime);
            const diff = end - now;
            setTimeLeft(diff > 0 ? diff : 0);
        }, 1000);
        return () => clearInterval(interval);
    }, [endTime]);

    const groupedPlayers = useMemo(() => {
        if (!players || players.length === 0) return [];
        const counts = {};
        players.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
        return Object.keys(counts).map(addr => ({ address: addr, count: counts[addr] }));
    }, [players]);

    useEffect(() => {
        if (isConfirmed) {
            refetchPlayers(); refetchAllowance(); refetchHistory();
        }
    }, [isConfirmed]);

    const handleBuy = () => {
        if (!ticketQty || ticketQty <= 0) return;
        const totalCost = parseEther((Number(ticketQty) * 10).toString());

        const refAddr = referrer && isAddress(referrer) ? referrer : "0x0000000000000000000000000000000000000000";

        if (!allowance || allowance < totalCost) {
            writeContract({ address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "approve", args: [LOTTERY_ADDRESS, parseEther("100000")] });
        } else {
            writeContract({ address: LOTTERY_ADDRESS, abi: LotteryABI.abi, functionName: "buyTickets", args: [BigInt(ticketQty), refAddr] });
        }
    };

    const handlePickWinner = () => {
        writeContract({ address: LOTTERY_ADDRESS, abi: LotteryABI.abi, functionName: "pickWinner" });
    };

    if (!isConnected) return <div className="center-msg">Vui lòng kết nối ví để chơi!</div>;

    return (
        <div className="main-grid">
            <div className="left-col">
                <div className="card highlight-card">
                    <div className="stats-row">
                        <div className="stat-box">
                            <div className="stat-label">Jackpot 🍯</div>
                            <div className="stat-value">{jackpotPool ? formatEther(jackpotPool) : "0"}</div>
                        </div>
                        <div className="stat-box">
                            <div className="stat-label">Thời gian ⏳</div>
                            <div className="stat-value" style={{ color: timeLeft === 0 ? '#ef4444' : '#22c55e' }}>
                                {timeLeft > 0 ? `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}` : "HẾT GIỜ"}
                            </div>
                        </div>
                    </div>
                    <div className="chance-badge">🔥 Tỷ lệ Nổ Hũ: {jackpotChance ? (Number(jackpotChance) / 100).toFixed(2) : "0.10"}%</div>
                </div>

                <div className="card">
                    <h3>Mua Vé (10 HST/vé)</h3>
                    <div className="qty-control">
                        <button className="qty-btn" onClick={() => setTicketQty(q => Math.max(1, Number(q) - 1))}>-</button>
                        <input
                            type="number"
                            className="qty-input"
                            value={ticketQty}
                            onChange={e => setTicketQty(Math.max(1, parseInt(e.target.value) || 1))}
                        />
                        <button className="qty-btn" onClick={() => setTicketQty(q => Number(q) + 1)}>+</button>
                    </div>

                    <div style={{ marginTop: '15px' }}>
                        <label style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Người giới thiệu (Tùy chọn):</label>
                        <input
                            type="text"
                            placeholder="Nhập địa chỉ ví (0x...)"
                            className="input-field"
                            value={referrer}
                            onChange={e => setReferrer(e.target.value)}
                        />
                    </div>

                    <button onClick={handleBuy} className="btn-primary" disabled={isConfirming} style={{ marginTop: '10px' }}>
                        {isConfirming ? "Đang xử lý..." : (!allowance || allowance < parseEther((Number(ticketQty) * 10).toString()) ? "1. Cấp quyền (Approve)" : "2. MUA VÉ NGAY")}
                    </button>
                </div>

                {timeLeft === 0 && (
                    <div className="card danger-border">
                        <h3>🛑 Kết thúc vòng chơi</h3>
                        <p style={{ textAlign: 'center' }}>Đã hết giờ! Hãy quay số để tìm người thắng cuộc và nhận 2% thưởng.</p>
                        <button onClick={handlePickWinner} className="btn-danger" disabled={isConfirming}>
                            🎰 QUAY SỐ & NHẬN THƯỞNG
                        </button>
                    </div>
                )}
            </div>

            <div className="right-col">
                <div className="card">
                    <h3>👥 Người chơi ({uniqueCount?.toString()})</h3>
                    <div className="scroll-box">
                        <table>
                            <thead><tr><th>Ví</th><th style={{ textAlign: 'right' }}>Vé</th></tr></thead>
                            <tbody>
                                {groupedPlayers.map((p, i) => (
                                    <tr key={i}><td>{shortenAddress(p.address)}</td><td align="right" style={{ color: '#f59e0b' }}>{p.count}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div className="card">
                    <h3>📜 Lịch sử thắng</h3>
                    <div className="scroll-box">
                        <table>
                            <thead><tr><th>Vòng</th><th>Người thắng</th><th>Giải</th></tr></thead>
                            <tbody>
                                {[...(history || [])].reverse().map((h, i) => (
                                    <tr key={i}>
                                        <td>#{h.round.toString()}</td>
                                        <td>{shortenAddress(h.winner)}</td>
                                        <td style={{ color: h.isJackpotHit ? '#f59e0b' : '#22c55e' }}>{h.isJackpotHit ? "💥 " : ""}{formatEther(h.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}