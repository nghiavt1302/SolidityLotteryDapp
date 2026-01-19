import React, { useState, useEffect, useMemo } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, parseEther } from "ethers";
import "./App.css";

import MyTokenABI from "./artifacts/HustToken.json";
import LotteryABI from "./artifacts/Lottery.json";

const TOKEN_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const LOTTERY_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

const shortenAddress = (addr) => {
  if (!addr) return "";
  return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
};

function App() {
  const { address, isConnected } = useAccount();

  const { data: hash, writeContract, isPending: isWritePending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const [ticketQty, setTicketQty] = useState(1);
  const [referrer, setReferrer] = useState("");

  const [winnerModal, setWinnerModal] = useState(null);
  const [errorModal, setErrorModal] = useState(null);
  const [actionType, setActionType] = useState(null);

  const readConfig = { address: LOTTERY_ADDRESS, abi: LotteryABI.abi, query: { refetchInterval: 2000 } };

  const { data: lotteryId } = useReadContract({ ...readConfig, functionName: "lotteryId" });
  const { data: jackpotPool } = useReadContract({ ...readConfig, functionName: "jackpotPool" });
  const { data: endTime } = useReadContract({ ...readConfig, functionName: "endTime" });
  const { data: players, refetch: refetchPlayers } = useReadContract({ ...readConfig, functionName: "getPlayers" });
  const { data: history, refetch: refetchHistory } = useReadContract({ ...readConfig, functionName: "getHistory" });
  const { data: uniqueCount } = useReadContract({ ...readConfig, functionName: "uniquePlayersCount" });

  const { data: jackpotChance } = useReadContract({ ...readConfig, functionName: "getCurrentJackpotChance" });

  const { data: userBalance, refetch: refetchUserBalance } = useReadContract({ address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "balanceOf", args: [address], query: { refetchInterval: 1000 } });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({ address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "allowance", args: [address, LOTTERY_ADDRESS], query: { refetchInterval: 1000 } });

  const groupedPlayers = useMemo(() => {
    if (!players || players.length === 0) return [];
    const counts = {};
    players.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
    return Object.keys(counts).map(addr => ({ address: addr, count: counts[addr] }));
  }, [players]);

  const fetchNewestHistory = async (retryCount = 0) => {
    if (retryCount > 5) { setActionType(null); return; }

    const { data: latestHistory } = await refetchHistory();
    if (latestHistory && latestHistory.length > 0) {
      const lastItem = latestHistory[latestHistory.length - 1];
      const isNoPlayerRound = lastItem.winner === "0x0000000000000000000000000000000000000000";

      setWinnerModal({
        round: lastItem.round.toString(),
        winner: lastItem.winner,
        amount: lastItem.amount,
        isJackpotHit: lastItem.isJackpotHit,
        isEmpty: isNoPlayerRound
      });

      refetchPlayers(); refetchUserBalance(); refetchAllowance();
      setActionType(null);
    } else {
      setTimeout(() => fetchNewestHistory(retryCount + 1), 1000);
    }
  };

  useEffect(() => {
    if (isConfirmed) {
      if (actionType === 'BUY') {
        refetchPlayers(); refetchUserBalance(); refetchAllowance();
        setActionType(null);
      } else if (actionType === 'PICK') {
        setTimeout(() => fetchNewestHistory(), 1000);
      }
    }
  }, [isConfirmed]);

  const [timeLeft, setTimeLeft] = useState(0);
  useEffect(() => {
    if (!endTime) return;
    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const end = Number(endTime);
      setTimeLeft(end - now > 0 ? end - now : 0);
    }, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  const TICKET_PRICE = 10;
  const totalCost = ticketQty ? parseEther((Number(ticketQty) * TICKET_PRICE).toString()) : 0n;
  const isAllowanceSufficient = allowance ? allowance >= totalCost : false;
  const isGlobalLoading = isWritePending || isConfirming;
  const isBuying = isGlobalLoading && actionType === 'BUY';
  const isPicking = (isGlobalLoading && actionType === 'PICK') || (actionType === 'PICK' && isConfirmed);

  const chanceDisplay = jackpotChance ? (Number(jackpotChance) / 100).toFixed(2) : "0.10";

  const handleIncreaseQty = () => setTicketQty(prev => Number(prev) + 1);
  const handleDecreaseQty = () => setTicketQty(prev => (Number(prev) > 1 ? Number(prev) - 1 : 1));

  const handleBuy = () => {
    if (timeLeft === 0) {
      setErrorModal({ title: "Đã hết giờ", message: "Vòng chơi này đã đóng cổng bán vé." });
      return;
    }
    if (!ticketQty || ticketQty <= 0) return;
    if (userBalance !== undefined && userBalance < totalCost) {
      setErrorModal({ title: "Hết tiền", message: "Bạn không đủ HST." });
      return;
    }
    setActionType('BUY');

    // Referrer rỗng thì gửi address là 0
    const refAddress = referrer && referrer.length > 0 ? referrer : "0x0000000000000000000000000000000000000000";

    if (!isAllowanceSufficient) {
      writeContract({ address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "approve", args: [LOTTERY_ADDRESS, parseEther("100000")] });
    } else {
      writeContract({ address: LOTTERY_ADDRESS, abi: LotteryABI.abi, functionName: "buyTickets", args: [BigInt(ticketQty), refAddress] });
    }
  };

  const handlePickWinner = () => {
    setActionType('PICK');
    writeContract({ address: LOTTERY_ADDRESS, abi: LotteryABI.abi, functionName: "pickWinner" });
  };

  const handleFaucet = () => {
    writeContract({ address: TOKEN_ADDRESS, abi: MyTokenABI.abi, functionName: "faucet" });
  };

  return (
    <div className="container">
      <div className="header">
        <h1>HUST 🎰 Lottery</h1>
        <div style={{ color: '#94a3b8', marginBottom: '10px' }}>
          Vòng chơi hiện tại: <span style={{ color: '#f59e0b', fontSize: '1.5rem', fontWeight: 'bold' }}>#{lotteryId ? lotteryId.toString() : "..."}</span>
        </div>
        <div className="connect-btn-wrapper"><ConnectButton showBalance={false} /></div>
      </div>

      {isConnected && (
        <div className="main-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="card">
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
              <div style={{ background: '#334155', marginTop: '10px', padding: '5px', borderRadius: '5px', textAlign: 'center', color: '#38bdf8', fontSize: '0.9rem' }}>
                🔥 Xác suất Nổ Hũ hiện tại: <strong>{chanceDisplay}%</strong>
              </div>

              <div style={{ borderTop: '1px solid #334155', margin: '15px 0' }}></div>

              <div className="stats-row" style={{ alignItems: 'center' }}>
                <div style={{ flex: 1 }}>Ví: <span style={{ color: '#22c55e', fontWeight: 'bold' }}>{userBalance ? formatEther(userBalance) : "0.0"} HST</span></div>
                <button onClick={handleFaucet} style={{ width: 'auto', padding: '5px 15px', background: '#334155', fontSize: '0.8rem' }}>+ Faucet</button>
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: '15px' }}>Mua Vé (10 HST/vé)</h3>
              <div className="qty-control">
                <button className="qty-btn" onClick={handleDecreaseQty}>-</button>
                <input type="number" className="qty-input" value={ticketQty} onChange={(e) => setTicketQty(e.target.value)} />
                <button className="qty-btn" onClick={handleIncreaseQty}>+</button>
              </div>

              {/* NHẬP MÃ GIỚI THIỆU */}
              <div style={{ marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Nhập ví giới thiệu (Nếu có)..."
                  value={referrer}
                  onChange={(e) => setReferrer(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #475569',
                    background: '#0f172a',
                    color: 'white',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button
                onClick={handleBuy}
                className="btn-primary"
                disabled={isBuying}
                style={{ marginTop: '5px', opacity: isBuying ? 0.7 : 1 }}
              >
                {isBuying ? "Đang giao dịch..." : (!isAllowanceSufficient ? "Cấp quyền mua vé" : `Mua Vé: (${Number(ticketQty) * 10} HST)`)}
              </button>
            </div>

            {timeLeft === 0 && (
              <div className="card" style={{ border: '2px solid #ef4444' }}>
                <h3 style={{ color: '#ef4444', marginTop: 0 }}>Kết thúc vòng chơi</h3>
                <p style={{ textAlign: 'center' }}>
                  {players && players.length === 0 ?
                    "Vòng này không có người chơi. Bấm nút dưới để chuyển sang vòng mới." :
                    `Đã có ${players ? players.length : 0} vé tham gia.`
                  }
                </p>
                <button onClick={handlePickWinner} className="btn-danger" disabled={isPicking}>
                  {isPicking ? "Đang xử lý..." : "KẾT THÚC VÒNG & QUAY SỐ"}
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="card">
              <h3>👥 Người chơi ({uniqueCount ? uniqueCount.toString() : 0} ví)</h3>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>STT</th>
                      <th>Địa chỉ ví</th>
                      <th style={{ textAlign: 'right' }}>Số vé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedPlayers.map((p, i) => (
                      <tr key={i}>
                        <td>#{i + 1}</td>
                        <td className="address-col">{shortenAddress(p.address)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#f59e0b' }}>{p.count}</td>
                      </tr>
                    ))}
                    {groupedPlayers.length === 0 && <tr><td colSpan="3" align="center" style={{ color: '#666' }}>Chưa có ai</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <h3>Lịch sử các vòng trước</h3>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Vòng</th><th>Người thắng</th><th>Giải</th></tr></thead>
                  <tbody>
                    {[...(history || [])].reverse().map((h, i) => (
                      <tr key={i}>
                        <td>#{h.round.toString()}</td>
                        <td>
                          {h.winner === "0x0000000000000000000000000000000000000000" ?
                            <span style={{ color: '#64748b', fontStyle: 'italic' }}>Không có người chơi</span> :
                            <span className="address-col" title={h.winner}>{shortenAddress(h.winner)}</span>
                          }
                        </td>
                        <td style={{ color: h.isJackpotHit ? '#f59e0b' : '#22c55e', fontWeight: h.isJackpotHit ? 'bold' : 'normal' }}>
                          {h.isJackpotHit ? "💥 " : ""}{formatEther(h.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {winnerModal && (
        <div className="modal-overlay" onClick={() => setWinnerModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            {winnerModal.isEmpty ? (
              <>
                <h1 style={{ fontSize: '3rem', margin: 0 }}>🤷‍♂️</h1>
                <h2 style={{ color: '#94a3b8' }}>VÒNG #{winnerModal.round} KHÔNG CÓ NGƯỜI CHƠI</h2>
                <p>Đã tự động chuyển sang vòng tiếp theo.</p>
              </>
            ) : (
              <>
                {winnerModal.isJackpotHit && <h1 className="rainbow-text" style={{ fontSize: '2.5rem', margin: 0 }}>💥 JACKPOT 💥</h1>}
                {!winnerModal.isJackpotHit && <h1>🎉 KẾT QUẢ VÒNG #{winnerModal.round} 🎉</h1>}

                <div style={{ border: '1px dashed #666', padding: '20px', borderRadius: '10px', margin: '20px 0' }}>
                  <p>Người chiến thắng:</p>
                  <h3 style={{ color: '#f59e0b', wordBreak: 'break-all' }}>{shortenAddress(winnerModal.winner)}</h3>

                  {address && winnerModal.winner.toLowerCase() === address.toLowerCase() && (
                    <div style={{ background: '#22c55e', color: 'black', display: 'inline-block', padding: '5px 10px', borderRadius: '5px', fontWeight: 'bold', marginTop: '5px' }}>CHÍNH LÀ BẠN</div>
                  )}

                  <h1 style={{ color: winnerModal.isJackpotHit ? '#f59e0b' : '#22c55e', fontSize: '2.5rem', marginTop: '15px' }}>+{formatEther(winnerModal.amount)} HST</h1>
                  {winnerModal.isJackpotHit && <p style={{ color: '#f59e0b', fontWeight: 'bold' }}>Đã nổ hũ thành công!</p>}
                </div>
              </>
            )}
            <button onClick={() => setWinnerModal(null)} className="btn-primary">Đóng</button>
          </div>
        </div>
      )}

      {errorModal && (
        <div className="modal-overlay" onClick={() => setErrorModal(null)}>
          <div className="modal-content" style={{ border: '2px solid #ef4444' }}>
            <h2 style={{ color: '#ef4444' }}>{errorModal.title}</h2>
            <p>{errorModal.message}</p>
            <button onClick={() => setErrorModal(null)} style={{ background: '#334155' }}>Đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;