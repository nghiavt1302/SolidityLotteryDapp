import React, { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useBalance } from "wagmi";
import { parseEther, formatEther, Interface } from "ethers";
import LotteryABI from "../artifacts/Lottery.json";
import ExchangerABI from "../artifacts/TokenExchanger.json";
import TokenABI from "../artifacts/HustToken.json";
import { LOTTERY_ADDRESS, EXCHANGER_ADDRESS, TOKEN_ADDRESS, START_BLOCK } from "../App";
import { createPublicClient, http, parseAbiItem } from 'viem';
import { sepolia } from 'viem/chains';

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

export default function Admin() {
    const { address } = useAccount();
    const { writeContract, data: hash, error: writeError } = useWriteContract();
    const { isSuccess, isError, error: txError, data: receipt } = useWaitForTransactionReceipt({ hash });

    const { data: owner } = useReadContract({ address: LOTTERY_ADDRESS, abi: LotteryABI.abi, functionName: "owner" });

    // Đọc số lượng HST lưu hành (Total Supply)
    const { data: circulatingHST } = useReadContract({
        address: TOKEN_ADDRESS,
        abi: TokenABI.abi,
        functionName: "totalSupply",
        query: { refetchInterval: 2000 }
    });

    // Đọc số dư ETH trong Exchanger contract
    const { data: exchangerETHBalance } = useBalance({
        address: EXCHANGER_ADDRESS,
        query: { refetchInterval: 2000 }
    });

    // Đọc số dư ETH của admin
    const { data: adminETHBalance } = useBalance({
        address: address,
        query: { refetchInterval: 2000 }
    });


    const [newDuration, setNewDuration] = useState("");
    const [depositAmt, setDepositAmt] = useState("");
    const [withdrawAmt, setWithdrawAmt] = useState("");
    const [history, setHistory] = useState([]);
    const [adminPopup, setAdminPopup] = useState(null);
    const [pendingAction, setPendingAction] = useState(null);

    const fetchHistory = async () => {
        if (!address) return;
        const client = createPublicClient({
            chain: sepolia,
            transport: http("https://ethereum-sepolia-rpc.publicnode.com")
        });

        try {
            const liquidityLogs = await client.getLogs({
                address: EXCHANGER_ADDRESS,
                event: parseAbiItem('event LiquidityAdded(uint256 ethAmount)'),
                fromBlock: START_BLOCK
            });

            const withdrawLogs = await client.getLogs({
                address: EXCHANGER_ADDRESS,
                event: parseAbiItem('event FeesWithdrawn(uint256 ethAmount)'),
                fromBlock: START_BLOCK
            });

            let durationLogs = [];
            try {
                durationLogs = await client.getLogs({
                    address: LOTTERY_ADDRESS,
                    event: parseAbiItem('event DurationUpdated(uint256 newDuration)'),
                    fromBlock: START_BLOCK
                });
            } catch (e) {
                console.log("DurationUpdated event not found");
            }

            const formattedHistory = [
                ...liquidityLogs.map(l => ({
                    type: 'NẠP VỐN',
                    amount: formatEther(l.args.ethAmount),
                    unit: 'ETH',
                    hash: l.transactionHash,
                    blockNumber: l.blockNumber
                })),
                ...withdrawLogs.map(l => ({
                    type: 'RÚT LÃI',
                    amount: formatEther(l.args.ethAmount),
                    unit: 'ETH',
                    hash: l.transactionHash,
                    blockNumber: l.blockNumber
                })),
                ...durationLogs.map(l => ({
                    type: 'ĐỔI THỜI GIAN',
                    amount: l.args.newDuration.toString(),
                    unit: 'giây',
                    hash: l.transactionHash,
                    blockNumber: l.blockNumber
                }))
            ].sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1));

            setHistory(formattedHistory);
        } catch (error) {
            console.error("Error fetching admin history:", error);
        }
    };

    useEffect(() => {
        fetchHistory();
    }, [address, isSuccess]);

    useEffect(() => {
        if (isSuccess && receipt && pendingAction) {
            const iface = pendingAction.type === 'duration'
                ? new Interface(LotteryABI.abi)
                : new Interface(ExchangerABI.abi);

            let eventFound = false;
            for (const log of receipt.logs) {
                const targetAddress = pendingAction.type === 'duration' ? LOTTERY_ADDRESS : EXCHANGER_ADDRESS;
                if (log.address.toLowerCase() === targetAddress.toLowerCase()) {
                    try {
                        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
                        if (parsed) {
                            if (parsed.name === 'DurationUpdated') {
                                setAdminPopup({
                                    success: true,
                                    type: 'duration',
                                    message: `Đã cập nhật thời gian vòng chơi thành ${parsed.args.newDuration.toString()} giây`
                                });
                                setNewDuration("");
                                eventFound = true;
                            } else if (parsed.name === 'LiquidityAdded') {
                                setAdminPopup({
                                    success: true,
                                    type: 'deposit',
                                    message: `Đã nạp thành công ${formatEther(parsed.args.ethAmount)} ETH vào Exchanger`
                                });
                                setDepositAmt("");
                                eventFound = true;
                            } else if (parsed.name === 'FeesWithdrawn') {
                                setAdminPopup({
                                    success: true,
                                    type: 'withdraw',
                                    message: `Đã rút thành công ${formatEther(parsed.args.ethAmount)} ETH từ Exchanger`
                                });
                                setWithdrawAmt("");
                                eventFound = true;
                            }
                            if (eventFound) break;
                        }
                    } catch (e) { }
                }
            }
            setPendingAction(null);
        } else if (isError && pendingAction) {
            const errorMsg = txError?.message || writeError?.message || 'Giao dịch thất bại';
            setAdminPopup({
                success: false,
                type: pendingAction.type,
                message: `Lỗi: ${errorMsg.substring(0, 100)}...`
            });
            setPendingAction(null);
        }
    }, [isSuccess, isError, receipt, pendingAction]);

    const handleSetDuration = () => {
        if (!newDuration || isNaN(newDuration) || Number(newDuration) < 60) {
            return alert("Vui lòng nhập thời gian tối thiểu 60 giây!");
        }
        setPendingAction({ type: 'duration', value: newDuration });
        writeContract({ address: LOTTERY_ADDRESS, abi: LotteryABI.abi, functionName: "setLotteryDuration", args: [BigInt(newDuration)] });
    }

    const handleDeposit = () => {
        if (!depositAmt || isNaN(depositAmt) || Number(depositAmt) <= 0) {
            return alert("Vui lòng nhập số ETH hợp lệ!");
        }
        setPendingAction({ type: 'deposit', value: depositAmt });
        writeContract({ address: EXCHANGER_ADDRESS, abi: ExchangerABI.abi, functionName: "depositLiquidity", value: parseEther(depositAmt) });
    }

    const handleWithdraw = () => {
        if (!withdrawAmt || isNaN(withdrawAmt) || Number(withdrawAmt) <= 0) {
            return alert("Vui lòng nhập số ETH hợp lệ!");
        }

        // Kiểm tra số dư ETH trong Exchanger
        const availableETH = exchangerETHBalance ? Number(formatEther(exchangerETHBalance.value)) : 0;
        const withdrawAmount = Number(withdrawAmt);

        if (withdrawAmount > availableETH) {
            setAdminPopup({
                success: false,
                type: 'withdraw',
                message: `Số tiền rút (${withdrawAmount} ETH) vượt quá vốn thanh khoản hiện có (${availableETH.toFixed(4)} ETH)`
            });
            return;
        }

        // Kiểm tra reserve requirement
        const totalSupply = circulatingHST ? Number(formatEther(circulatingHST)) : 0;
        const requiredReserve = totalSupply / 100000; // RATE = 100000
        const balanceAfterWithdraw = availableETH - withdrawAmount;

        if (balanceAfterWithdraw < requiredReserve) {
            setAdminPopup({
                success: false,
                type: 'withdraw',
                message: `Không thể rút! Phải giữ lại tối thiểu ${requiredReserve.toFixed(4)} ETH để bảo chứng cho ${totalSupply.toLocaleString()} HST đang lưu hành. Sau khi rút còn ${balanceAfterWithdraw.toFixed(4)} ETH.`
            });
            return;
        }

        setPendingAction({ type: 'withdraw', value: withdrawAmt });
        writeContract({ address: EXCHANGER_ADDRESS, abi: ExchangerABI.abi, functionName: "withdrawETH", args: [parseEther(withdrawAmt)] });
    }

    if (!address || !owner || address.toLowerCase() !== owner.toLowerCase()) {
        return <div className="center-msg">Bạn không phải Admin.</div>;
    }

    return (
        <div className="main-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="card" style={{ border: '1px solid #f59e0b' }}>
                <h2 style={{ color: '#f59e0b' }}>Admin Dashboard</h2>

                <div className="admin-section" style={{ background: '#f0f9ff', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
                    <h4 style={{ color: '#0284c7', marginTop: 0 }}>Thông Tin Exchanger</h4>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: '14px', color: '#64748b' }}>Vốn thanh khoản (ETH):</span>
                        <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981' }}>
                            {exchangerETHBalance ? Number(formatEther(exchangerETHBalance.value)).toFixed(4) : "0"} ETH
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid #e0f2fe' }}>
                        <span style={{ fontSize: '14px', color: '#64748b' }}>HST đang lưu hành:</span>
                        <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#0284c7' }}>
                            {circulatingHST ? Number(formatEther(circulatingHST)).toLocaleString() : "0"} HST
                        </span>
                    </div>
                </div>

                <div className="admin-section" style={{ background: '#fef3c7', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
                    <h4 style={{ color: '#d97706', marginTop: 0 }}>Ví Admin</h4>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '14px', color: '#78716c' }}>Số dư ETH:</span>
                        <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#d97706' }}>
                            {adminETHBalance ? Number(formatEther(adminETHBalance.value)).toFixed(2) : "0"} ETH
                        </span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#78716c', marginTop: '5px', fontStyle: 'italic' }}>
                        Hardhat test account ban đầu có 10,000 ETH
                    </div>
                </div>


                <div className="admin-section">
                    <h4>Cài đặt Game</h4>
                    <div className="qty-control" style={{ marginBottom: '10px' }}>
                        <input
                            type="number"
                            className="fancy-input"
                            placeholder="Thời gian vòng (giây)"
                            value={newDuration}
                            onChange={e => setNewDuration(e.target.value)}
                        />
                        <span style={{ paddingRight: '15px', fontWeight: 'bold', color: '#64748b' }}>giây</span>
                    </div>
                    <button onClick={handleSetDuration} className="btn-primary">
                        Cập nhật
                    </button>
                </div>

                <div className="admin-section">
                    <h4>Quản lý Vốn Exchanger</h4>
                    <div className="qty-control" style={{ marginBottom: '10px' }}>
                        <input
                            type="number"
                            className="fancy-input"
                            placeholder="Số ETH nạp vào (Vốn mồi)"
                            value={depositAmt}
                            onChange={e => setDepositAmt(e.target.value)}
                        />
                        <span style={{ paddingRight: '15px', fontWeight: 'bold', color: '#64748b' }}>ETH</span>
                    </div>
                    <button onClick={handleDeposit} className="btn-primary" style={{ background: '#22c55e', marginBottom: '15px' }}>
                        Nạp Vốn
                    </button>

                    <div className="qty-control" style={{ marginBottom: '10px' }}>
                        <input
                            type="number"
                            className="fancy-input"
                            placeholder="Số ETH muốn rút (Lãi)"
                            value={withdrawAmt}
                            onChange={e => setWithdrawAmt(e.target.value)}
                        />
                        <span style={{ paddingRight: '15px', fontWeight: 'bold', color: '#64748b' }}>ETH</span>
                    </div>
                    <button onClick={handleWithdraw} className="btn-danger">
                        Rút Lãi
                    </button>
                </div>
            </div>

            <div className="card" style={{ border: '1px solid #f59e0b' }}>
                <h3 style={{ color: '#f59e0b' }}>Lịch sử hoạt động Admin</h3>
                <div className="scroll-box" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                    <table>
                        <thead><tr><th>Loại</th><th>Số lượng</th><th>Tx</th></tr></thead>
                        <tbody>
                            {history.map((h, i) => (
                                <tr key={i}>
                                    <td style={{ color: h.type === 'NẠP VỐN' ? '#22c55e' : h.type === 'RÚT LÃI' ? '#ef4444' : '#f59e0b', fontWeight: 'bold', fontSize: '0.85rem' }}>{h.type}</td>
                                    <td style={{ fontSize: '0.9rem' }}>{h.type === 'ĐỔI THỜI GIAN' ? h.amount : Number(h.amount).toFixed(4)} {h.unit}</td>
                                    <td><a href={`https://sepolia.etherscan.io/tx/${h.hash}`} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'none', fontSize: '0.85rem' }}>Xem</a></td>
                                </tr>
                            ))}
                            {history.length === 0 && <tr><td colSpan="3" align="center" style={{ color: '#64748b', padding: '20px' }}>Chưa có hoạt động nào</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            <Modal show={adminPopup} onClose={() => setAdminPopup(null)}>
                <div style={{ textAlign: 'center' }}>
                    {adminPopup?.success ? (
                        <>
                            <div style={{ fontSize: '3rem', marginBottom: '10px' }}>✅</div>
                            <h2 style={{ color: '#22c55e', marginBottom: '15px' }}>Thành công!</h2>
                            <p style={{ fontSize: '1.1rem', color: '#e2e8f0' }}>{adminPopup?.message}</p>
                        </>
                    ) : (
                        <>
                            <div style={{ fontSize: '3rem', marginBottom: '10px' }}>❌</div>
                            <h2 style={{ color: '#ef4444', marginBottom: '15px' }}>Thất bại!</h2>
                            <p style={{ fontSize: '0.95rem', color: '#e2e8f0', wordBreak: 'break-word' }}>{adminPopup?.message}</p>
                        </>
                    )}
                    <button onClick={() => setAdminPopup(null)} className="btn-primary" style={{ marginTop: '20px', width: '50%' }}>
                        OK
                    </button>
                </div>
            </Modal>
        </div>
    );
}