import React, { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, parseEther } from "ethers";
import ExchangerABI from "../artifacts/TokenExchanger.json";
import MyTokenABI from "../artifacts/HustToken.json";
import LotteryABI from "../artifacts/Lottery.json";
import { EXCHANGER_ADDRESS, TOKEN_ADDRESS, LOTTERY_ADDRESS } from "../App";
import { createPublicClient, http, parseAbiItem } from 'viem';
import { hardhat } from 'viem/chains';
import { Interface } from "ethers";

const Modal = ({ show, onClose, children }) => {
    if (!show) return null;
    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
            <div style={{
                background: '#1e293b', padding: '30px', borderRadius: '15px', maxWidth: '500px', width: '90%',
                position: 'relative', border: '2px solid #38bdf8', boxShadow: '0 0 20px rgba(56, 189, 248, 0.3)'
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

const RATE = 100000;

export default function Exchange() {
    const { address, isConnected } = useAccount();
    const [tab, setTab] = useState("BUY");
    const [amount, setAmount] = useState("");
    const [history, setHistory] = useState([]);
    const [exchangePopup, setExchangePopup] = useState(null);
    const [preTxBalanceHST, setPreTxBalanceHST] = useState("0");
    const [hstHistory, setHstHistory] = useState([]);

    const { writeContract, data: hash } = useWriteContract();
    const { isSuccess, isLoading, data: receipt } = useWaitForTransactionReceipt({ hash });

    // HST Balance of user
    const { data: userHST, refetch: refetchUserHST } = useReadContract({
        address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "balanceOf", args: [address], query: { refetchInterval: 2000 }
    });

    // ETH Balance? We can use wagmi hook if needed, but for popup we need HST mainly for "Buy" case.
    // For "Sell" case: we need ETH balance? Request says "Thực nhận {Đ} ETH". We can calculate this from event logs (amount - fee).

    useEffect(() => {
        if (isSuccess && receipt) {
            fetchHistory(); refetchAllowance();
            refetchUserHST().then((res) => {
                const newBal = res.data ? formatEther(res.data) : "0";
                const oldBal = preTxBalanceHST;

                // Parse logs to find details
                const iface = new Interface(ExchangerABI.abi);
                for (const log of receipt.logs) {
                    if (log.address.toLowerCase() === EXCHANGER_ADDRESS.toLowerCase()) {
                        try {
                            const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
                            if (parsed) {
                                if (parsed.name === "TokensPurchased" && parsed.args.buyer.toLowerCase() === address.toLowerCase()) {
                                    setExchangePopup({
                                        type: "BUY",
                                        ethAmount: formatEther(parsed.args.ethAmount),
                                        hstAmount: formatEther(parsed.args.tokenAmount),
                                        initialHST: oldBal,
                                        finalHST: newBal
                                    });
                                    setAmount("");
                                } else if (parsed.name === "TokensSold" && parsed.args.seller.toLowerCase() === address.toLowerCase()) {
                                    setExchangePopup({
                                        type: "SELL",
                                        hstAmount: formatEther(parsed.args.tokenAmount),
                                        ethEquivalent: formatEther(parsed.args.ethAmount + parsed.args.fee), // ethAmount is net received?
                                        fee: formatEther(parsed.args.fee),
                                        netReceived: formatEther(parsed.args.ethAmount)
                                    });
                                    setAmount("");
                                }
                            }
                        } catch (e) { }
                    }
                }
            });
        }
    }, [isSuccess, receipt]);

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
        ].sort((a, b) => b.blockNumber - a.blockNumber);

        setHistory(formattedHistory);
    };

    const fetchHSTHistory = async () => {
        if (!address) return;
        const client = createPublicClient({ chain: hardhat, transport: http() });

        const [mintLogs, burnLogs, ticketLogs, adminLogs, callerLogs, prizeLogs, referralLogs] = await Promise.all([
            client.getLogs({ address: EXCHANGER_ADDRESS, event: parseAbiItem('event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 tokenAmount)'), args: { buyer: address }, fromBlock: 'earliest' }),
            client.getLogs({ address: EXCHANGER_ADDRESS, event: parseAbiItem('event TokensSold(address indexed seller, uint256 tokenAmount, uint256 ethAmount, uint256 fee)'), args: { seller: address }, fromBlock: 'earliest' }),
            client.getLogs({
                address: LOTTERY_ADDRESS,
                event: parseAbiItem('event TicketPurchased(address indexed player, uint256 amount, uint256 roundId)'),
                args: { player: address },
                fromBlock: 'earliest'
            }), client.getLogs({ address: LOTTERY_ADDRESS, event: parseAbiItem('event AdminFeeTransferred(address indexed admin, uint256 amount, uint256 roundId)'), args: { admin: address }, fromBlock: 'earliest' }),
            client.getLogs({ address: LOTTERY_ADDRESS, event: parseAbiItem('event CallerRewardTransferred(address indexed caller, uint256 amount, uint256 roundId)'), args: { caller: address }, fromBlock: 'earliest' }),
            client.getLogs({ address: LOTTERY_ADDRESS, event: parseAbiItem('event PrizeTransferred(address indexed winner, uint256 amount, uint256 roundId, bool isJackpotHit)'), args: { winner: address }, fromBlock: 'earliest' }),
            client.getLogs({
                address: LOTTERY_ADDRESS,
                event: parseAbiItem('event ReferralBonusTransferred(address indexed referrer, uint256 amount, address indexed buyer, uint256 roundId)'),
                args: { referrer: address },
                fromBlock: 'earliest'
            })
        ]);

        const allEvents = [];
        for (const log of mintLogs) {
            const block = await client.getBlock({ blockNumber: log.blockNumber });
            allEvents.push({ type: 'Mua HST', amount: `+${formatEther(log.args.tokenAmount)}`, from: 'Mint', to: 'Bạn', timestamp: new Date(Number(block.timestamp) * 1000).toLocaleString(), round: null, isIncoming: true, blockNumber: log.blockNumber, hash: log.transactionHash });
        }
        for (const log of burnLogs) {
            const block = await client.getBlock({ blockNumber: log.blockNumber });
            allEvents.push({ type: 'Bán HST', amount: `-${formatEther(log.args.tokenAmount)}`, from: 'Bạn', to: 'Burn', timestamp: new Date(Number(block.timestamp) * 1000).toLocaleString(), round: null, isIncoming: false, blockNumber: log.blockNumber, hash: log.transactionHash });
        }
        for (const log of ticketLogs) {
            const block = await client.getBlock({ blockNumber: log.blockNumber });
            const ticketCost = BigInt(log.args.amount) * BigInt(10) * BigInt(10 ** 18);
            allEvents.push({ type: 'Mua vé', amount: `-${formatEther(ticketCost)}`, from: 'Bạn', to: 'Lottery', timestamp: new Date(Number(block.timestamp) * 1000).toLocaleString(), round: `#${log.args.roundId}`, isIncoming: false, blockNumber: log.blockNumber, hash: log.transactionHash });
        }
        for (const log of adminLogs) {
            const block = await client.getBlock({ blockNumber: log.blockNumber });
            allEvents.push({ type: 'Phí admin', amount: `+${formatEther(log.args.amount)}`, from: 'Lottery', to: 'Bạn', timestamp: new Date(Number(block.timestamp) * 1000).toLocaleString(), round: `#${log.args.roundId}`, isIncoming: true, blockNumber: log.blockNumber, hash: log.transactionHash });
        }
        for (const log of callerLogs) {
            const block = await client.getBlock({ blockNumber: log.blockNumber });
            allEvents.push({ type: 'Thưởng pickWinner', amount: `+${formatEther(log.args.amount)}`, from: 'Lottery', to: 'Bạn', timestamp: new Date(Number(block.timestamp) * 1000).toLocaleString(), round: `#${log.args.roundId}`, isIncoming: true, blockNumber: log.blockNumber, hash: log.transactionHash });
        }
        for (const log of prizeLogs) {
            const block = await client.getBlock({ blockNumber: log.blockNumber });
            allEvents.push({ type: log.args.isJackpotHit ? 'Thắng giải + Jackpot' : 'Thắng giải', amount: `+${formatEther(log.args.amount)}`, from: 'Lottery', to: 'Bạn', timestamp: new Date(Number(block.timestamp) * 1000).toLocaleString(), round: `#${log.args.roundId}`, isIncoming: true, blockNumber: log.blockNumber, hash: log.transactionHash });
        }
        for (const log of referralLogs) {
            const block = await client.getBlock({ blockNumber: log.blockNumber });
            allEvents.push({ type: 'Hoa hồng', amount: `+${formatEther(log.args.amount)}`, from: 'Lottery', to: 'Bạn', timestamp: new Date(Number(block.timestamp) * 1000).toLocaleString(), round: `#${log.args.roundId}`, isIncoming: true, blockNumber: log.blockNumber, hash: log.transactionHash });
        }
        setHstHistory(allEvents.sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber)));
    };

    useEffect(() => {
        fetchHistory();
        fetchHSTHistory();
        if (isSuccess) refetchAllowance();
    }, [address, isSuccess]);

    const handleExecute = () => {
        if (!amount) return;

        // Capture current HST balance
        setPreTxBalanceHST(userHST ? formatEther(userHST) : "0");

        if (tab === "BUY") {
            writeContract({
                address: EXCHANGER_ADDRESS, abi: ExchangerABI.abi, functionName: "buyHST", value: parseEther(amount)
            });
        } else {
            // Validate HST balance for SELL
            const currentHSTBalance = userHST ? Number(formatEther(userHST)) : 0;
            const sellAmount = Number(amount);

            if (sellAmount > currentHSTBalance) {
                setExchangePopup({
                    success: false,
                    message: `Số dư HST không đủ! Bạn đang có ${currentHSTBalance.toLocaleString()} HST, không thể rút ${sellAmount.toLocaleString()} HST.`
                });
                return;
            }

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

    if (!isConnected) return <div className="center-msg">Vui lòng kết nối ví để chơi!</div>;

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

                    <div className="qty-control" style={{ marginTop: '10px' }}>
                        <input
                            type="number"
                            className="fancy-input"
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
                            {receivedVal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 })} {tab === "BUY" ? "HST" : "ETH"}
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

            <div className="card history-card" style={{ marginTop: '20px' }}>
                <h3>💰 Lịch sử biến động HST</h3>
                <div className="scroll-box">
                    <table>
                        <thead><tr><th>Loại</th><th>Số tiền</th><th>Từ</th><th>Đến</th><th>Vòng</th><th>Thời gian</th><th>Tx</th></tr></thead>
                        <tbody>
                            {hstHistory.map((h, i) => (
                                <tr key={i}>
                                    <td style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{h.type}</td>
                                    <td style={{ color: h.isIncoming ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>{h.amount}</td>
                                    <td style={{ fontSize: '0.8rem' }}>{h.from}</td>
                                    <td style={{ fontSize: '0.8rem' }}>{h.to}</td>
                                    <td style={{ fontSize: '0.8rem', color: '#f59e0b' }}>{h.round || '-'}</td>
                                    <td style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{h.timestamp}</td>
                                    <td><a href={`https://sepolia.etherscan.io/tx/${h.hash}`} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'none', fontSize: '0.85rem' }}>Xem</a></td>
                                </tr>
                            ))}
                            {hstHistory.length === 0 && <tr><td colSpan="7" align="center" style={{ color: '#64748b', padding: '20px' }}>Chưa có giao dịch nào</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            <Modal show={exchangePopup} onClose={() => setExchangePopup(null)}>
                <div style={{ textAlign: 'center' }}>
                    {exchangePopup?.success === false ? (
                        <>
                            <div style={{ fontSize: '3rem', marginBottom: '10px' }}>❌</div>
                            <h2 style={{ color: '#ef4444', marginBottom: '15px' }}>Lỗi!</h2>
                            <p style={{ fontSize: '1rem', color: '#e2e8f0' }}>{exchangePopup?.message}</p>
                            <button onClick={() => setExchangePopup(null)} className="btn-primary" style={{ marginTop: '20px', width: '50%' }}>
                                OK
                            </button>
                        </>
                    ) : exchangePopup?.type === "BUY" ? (
                        <>
                            <div style={{ fontSize: '3rem', marginBottom: '10px' }}>💎</div>
                            <h2 style={{ color: '#22c55e', marginBottom: '15px' }}>Nạp ETH thành công!</h2>
                            <p>Bạn đã nạp <strong style={{ color: '#38bdf8' }}>{exchangePopup?.ethAmount} ETH</strong></p>
                            <div style={{ background: '#0f172a', padding: '15px', borderRadius: '8px', marginTop: '15px', textAlign: 'left' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                    <span style={{ color: '#94a3b8' }}>Số dư cũ:</span>
                                    <span>{Number(exchangePopup?.initialHST).toLocaleString()} HST</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #334155', paddingTop: '5px' }}>
                                    <span style={{ color: '#22c55e', fontWeight: 'bold' }}>Số dư mới:</span>
                                    <span style={{ color: '#22c55e', fontWeight: 'bold' }}>{Number(exchangePopup?.finalHST).toLocaleString()} HST</span>
                                </div>
                            </div>
                            <button onClick={() => setExchangePopup(null)} className="btn-primary" style={{ marginTop: '20px', width: '50%' }}>OK</button>
                        </>
                    ) : (
                        <>
                            <div style={{ fontSize: '3rem', marginBottom: '10px' }}>💸</div>
                            <h2 style={{ color: '#38bdf8', marginBottom: '15px' }}>Rút HST thành công!</h2>
                            <div style={{ background: '#0f172a', padding: '15px', borderRadius: '8px', marginTop: '15px', textAlign: 'left' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                    <span style={{ color: '#94a3b8' }}>Đã quy đổi:</span>
                                    <span>{Number(exchangePopup?.hstAmount).toLocaleString()} HST</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                    <span style={{ color: '#94a3b8' }}>Giá trị tương đương:</span>
                                    <span>{Number(exchangePopup?.ethEquivalent).toFixed(6)} ETH</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                    <span style={{ color: '#ef4444' }}>Phí quy đổi (3.3%):</span>
                                    <span>-{Number(exchangePopup?.fee).toFixed(6)} ETH</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #334155', paddingTop: '5px' }}>
                                    <span style={{ color: '#22c55e', fontWeight: 'bold' }}>Thực nhận:</span>
                                    <span style={{ color: '#22c55e', fontWeight: 'bold' }}>{Number(exchangePopup?.netReceived).toFixed(6)} ETH</span>
                                </div>
                            </div>
                            <button onClick={() => setExchangePopup(null)} className="btn-primary" style={{ marginTop: '20px', width: '50%' }}>OK</button>
                        </>
                    )}
                </div>
            </Modal>
        </div>
    );
}