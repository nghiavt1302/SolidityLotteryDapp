import React, { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { parseEther } from "ethers";
import LotteryABI from "../artifacts/Lottery.json";
import ExchangerABI from "../artifacts/TokenExchanger.json";
import { LOTTERY_ADDRESS, EXCHANGER_ADDRESS } from "../App";

export default function Admin() {
    const { address } = useAccount();
    const { writeContract } = useWriteContract();

    const { data: owner } = useReadContract({ address: LOTTERY_ADDRESS, abi: LotteryABI.abi, functionName: "owner" });

    const [newDuration, setNewDuration] = useState("");
    const [depositAmt, setDepositAmt] = useState("");
    const [withdrawAmt, setWithdrawAmt] = useState("");

    if (!address || !owner || address.toLowerCase() !== owner.toLowerCase()) {
        return <div className="center-msg">Bạn không phải Admin.</div>;
    }

    return (
        <div className="main-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="card" style={{ border: '1px solid #f59e0b' }}>
                <h2 style={{ color: '#f59e0b' }}>⚙️ Admin Dashboard</h2>

                <div className="admin-section">
                    <h4>1. Cài đặt Game</h4>
                    <div className="input-group">
                        <input placeholder="Thời gian vòng (giây)" value={newDuration} onChange={e => setNewDuration(e.target.value)} />
                        <button onClick={() => writeContract({ address: LOTTERY_ADDRESS, abi: LotteryABI.abi, functionName: "setLotteryDuration", args: [BigInt(newDuration)] })}>Cập nhật</button>
                    </div>
                </div>

                <div className="admin-section">
                    <h4>2. Quản lý Vốn Exchanger</h4>
                    <div className="input-group">
                        <input placeholder="Số ETH nạp vào (Vốn mồi)" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} />
                        <button onClick={() => writeContract({ address: EXCHANGER_ADDRESS, abi: ExchangerABI.abi, functionName: "depositLiquidity", value: parseEther(depositAmt) })} className="btn-success">Nạp Vốn</button>
                    </div>
                    <div className="input-group" style={{ marginTop: '10px' }}>
                        <input placeholder="Số ETH muốn rút (Lãi)" value={withdrawAmt} onChange={e => setWithdrawAmt(e.target.value)} />
                        <button onClick={() => writeContract({ address: EXCHANGER_ADDRESS, abi: ExchangerABI.abi, functionName: "withdrawETH", args: [parseEther(withdrawAmt)] })} className="btn-danger">Rút Lãi</button>
                    </div>
                </div>
            </div>
        </div>
    );
}