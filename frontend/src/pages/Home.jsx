import React, { useState, useEffect, useMemo } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useWatchContractEvent } from "wagmi";
import { formatEther, parseEther, isAddress, Interface } from "ethers";
import LotteryABI from "../artifacts/Lottery.json";
import MyTokenABI from "../artifacts/HustToken.json";
import { LOTTERY_ADDRESS, TOKEN_ADDRESS } from "../App";

const shortenAddress = (addr) => addr ? `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}` : "";

const Modal = ({ show, onClose, children }) => {
    if (!show) return null;
    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
            <div style={{
                background: '#1e293b', padding: '30px', borderRadius: '15px', maxWidth: '500px', width: '90%',
                position: 'relative', border: '2px solid #f59e0b', boxShadow: '0 0 20px rgba(245, 158, 11, 0.3)'
            }}>
                <button onClick={onClose} style={{
                    position: 'absolute', top: '10px', right: '15px', background: 'none', border: 'none',
                    color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer'
                }}>×</button>
                {children}
            </div>
        </div>
    );
};

export default function Home() {
    const { address, isConnected } = useAccount();
    const { writeContract, data: hash } = useWriteContract();
    const { isSuccess: isConfirmed, isLoading: isConfirming, data: receipt } = useWaitForTransactionReceipt({ hash });

    const [ticketQty, setTicketQty] = useState(1);
    const [referrer, setReferrer] = useState("");
    const [winnerPopup, setWinnerPopup] = useState(null);
    const [buySuccessPopup, setBuySuccessPopup] = useState(null);

    const readConfig = { address: LOTTERY_ADDRESS, abi: LotteryABI.abi, query: { refetchInterval: 2000 } };
    const { data: jackpotPool, refetch: refetchJackpot } = useReadContract({ ...readConfig, functionName: "jackpotPool" });
    const { data: endTime } = useReadContract({ ...readConfig, functionName: "endTime" });
    const { data: players, refetch: refetchPlayers } = useReadContract({ ...readConfig, functionName: "getPlayers" });
    const { data: history, refetch: refetchHistory } = useReadContract({ ...readConfig, functionName: "getHistory" });
    const { data: uniqueCount, refetch: refetchUniqueCount } = useReadContract({ ...readConfig, functionName: "uniquePlayersCount" });
    const { data: jackpotChance } = useReadContract({ ...readConfig, functionName: "getCurrentJackpotChance" });

    // Listen for TicketPurchased events
    useWatchContractEvent({
        address: LOTTERY_ADDRESS,
        abi: LotteryABI.abi,
        eventName: 'TicketPurchased',
        onLogs(logs) {
            console.log('Ticket Purchased!', logs);
            refetchPlayers();
            refetchLotteryBalance();
            refetchJackpot();
            refetchUniqueCount();
        },
    });

    const { data: allowance, refetch: refetchAllowance } = useReadContract({
        address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "allowance", args: [address, LOTTERY_ADDRESS], query: { refetchInterval: 1000 }
    });

    // Lấy số dư HST của contract Lottery để tính quỹ vòng
    const { data: lotteryTokenBalance, refetch: refetchLotteryBalance } = useReadContract({
        address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "balanceOf", args: [LOTTERY_ADDRESS], query: { refetchInterval: 2000 }
    });

    const currentRoundFund = useMemo(() => {
        if (lotteryTokenBalance !== undefined && jackpotPool !== undefined) {
            const balance = BigInt(lotteryTokenBalance);
            const pool = BigInt(jackpotPool);
            return balance > pool ? balance - pool : BigInt(0);
        }
        return BigInt(0);
    }, [lotteryTokenBalance, jackpotPool]);

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
        if (isConfirmed && receipt) {
            refetchPlayers(); refetchAllowance(); refetchHistory(); refetchLotteryBalance();
            const lotteryLogs = receipt.logs.filter(l => l.address.toLowerCase() === LOTTERY_ADDRESS.toLowerCase());

            // Check if it's a Buy ticket transaction (TicketPurchased)
            // Since we don't have easy decode, checking if log count > 0 is a hint, OR assume successful tx + input involved.
            // Better: Parse logs. TicketPurchased topic0.
            const iface = new Interface(LotteryABI.abi);
            for (const log of receipt.logs) {
                if (log.address.toLowerCase() === LOTTERY_ADDRESS.toLowerCase()) {
                    try {
                        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
                        if (parsed && parsed.name === "TicketPurchased" && parsed.args.player.toLowerCase() === address.toLowerCase()) {
                            // Found our buy event
                            const boughtQty = parsed.args.amount.toString();

                            // Calculate total owned. Using `players` data which should be updated or we use the local knowledge + optimistic
                            // Refetch might not be fast enough.
                            // But we can count from players list if available (players might be stale).
                            // Let's assume refetchPlayers was called. But React update is async.
                            // We can manually counting from existing `players` + boughtQty IF players isn't updated?
                            // Or just wait? 
                            // Wait, refetch is async.
                            // Let's rely on `players` data? No, it might not be updated yet in this render cycle.
                            // Best approach: Optimistic calc.

                            let currentOwned = 0;
                            if (players) {
                                players.forEach(p => { if (p.toLowerCase() === address.toLowerCase()) currentOwned++; });
                            }
                            // Note: `players` here is STALE (from previous render). 
                            // So new total = currentOwned + Number(boughtQty).

                            setBuySuccessPopup({
                                bought: boughtQty,
                                total: currentOwned + Number(boughtQty)
                            });
                            break;
                        }
                    } catch (e) { }
                }
            }
        }
    }, [isConfirmed, receipt]);

    useEffect(() => {
        if (isConfirmed && receipt) {
            refetchPlayers(); refetchAllowance(); refetchHistory(); refetchLotteryBalance();

            const iface = new Interface(LotteryABI.abi);

            for (const log of receipt.logs) {
                if (log.address.toLowerCase() === LOTTERY_ADDRESS.toLowerCase()) {
                    try {
                        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
                        if (parsed && parsed.name === "RoundResult") {
                            setWinnerPopup({
                                roundId: parsed.args.roundId.toString(),
                                winner: parsed.args.winner,
                                prize: parsed.args.prize,
                                totalTickets: parsed.args.totalTickets,
                                totalFund: parsed.args.totalFund,
                                jackpotContribution: parsed.args.jackpotContribution,
                                isJackpotHit: parsed.args.isJackpotHit,
                                isMe: address && parsed.args.winner.toLowerCase() === address.toLowerCase()
                            });
                            break;
                        }
                    } catch (e) {
                        // ignore other events
                    }
                }
            }
        }
    }, [isConfirmed, receipt, address]);

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
                            <div className="stat-label">Quỹ Vòng 💰</div>
                            <div className="stat-value" style={{ color: '#38bdf8' }}>
                                {formatEther(currentRoundFund)}
                            </div>
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

            <Modal show={winnerPopup} onClose={() => setWinnerPopup(null)}>
                <div style={{ textAlign: 'center' }}>
                    <h2 style={{ color: '#f59e0b', fontSize: '2rem', marginBottom: '10px' }}>
                        {winnerPopup?.isJackpotHit ? "💥 JACKPOT HIT! 💥" : "🎉 KẾT QUẢ VÒNG QUAY 🎉"}
                    </h2>

                    {winnerPopup?.isMe && (
                        <div style={{
                            background: 'linear-gradient(45deg, #f59e0b, #ec4899)',
                            padding: '10px', borderRadius: '8px',
                            color: 'white', fontWeight: 'bold', marginBottom: '20px',
                            animation: 'pulse 1s infinite'
                        }}>
                            🏆 CHÚC MỪNG! BẠN LÀ NGƯỜI CHIẾN THẮNG! 🏆
                        </div>
                    )}

                    <div style={{ margin: '20px 0', fontSize: '1.2rem' }}>
                        <div style={{ marginBottom: '10px' }}>
                            <span style={{ color: '#94a3b8' }}>Người thắng:</span><br />
                            <span style={{ color: '#38bdf8', fontWeight: 'bold', fontSize: '1.4rem' }}>
                                {winnerPopup ? shortenAddress(winnerPopup.winner) : ""}
                            </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', background: '#0f172a', padding: '15px', borderRadius: '10px' }}>
                            <div>
                                <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Tổng quỹ vòng</div>
                                <div style={{ fontSize: '1.1rem', color: '#22c55e' }}>{winnerPopup ? formatEther(winnerPopup.totalFund) : 0} HST</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Số vé bán ra</div>
                                <div style={{ fontSize: '1.1rem', color: '#f59e0b' }}>{winnerPopup ? winnerPopup.totalTickets.toString() : 0}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Góp Jackpot</div>
                                <div style={{ fontSize: '1.1rem', color: '#ec4899' }}>{winnerPopup ? formatEther(winnerPopup.jackpotContribution) : 0} HST</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Giải thưởng</div>
                                <div style={{ fontSize: '1.3rem', color: '#22c55e', fontWeight: 'bold' }}>{winnerPopup ? formatEther(winnerPopup.prize) : 0} HST</div>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>

            <Modal show={buySuccessPopup} onClose={() => setBuySuccessPopup(null)}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🎟️</div>
                    <h2 style={{ color: '#22c55e', marginBottom: '15px' }}>Mua vé thành công!</h2>
                    <p style={{ fontSize: '1.1rem', marginBottom: '5px' }}>
                        Bạn đã mua thành công <strong style={{ color: '#f59e0b', fontSize: '1.2rem' }}>{buySuccessPopup?.bought}</strong> vé.
                    </p>
                    <p style={{ fontSize: '1.1rem' }}>
                        Vòng này bạn đang sở hữu tổng <strong style={{ color: '#f59e0b', fontSize: '1.2rem' }}>{buySuccessPopup?.total}</strong> vé.
                    </p>
                    <button onClick={() => setBuySuccessPopup(null)} className="btn-primary" style={{ marginTop: '20px', width: '50%' }}>
                        OK
                    </button>
                </div>
            </Modal>
        </div>
    );

}