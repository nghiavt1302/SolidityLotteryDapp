import React from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract } from "wagmi";
import { formatEther } from "ethers";
import "./App.css";

import Home from "./pages/Home";
import Exchange from "./pages/Exchange";
import Admin from "./pages/Admin";

import MyTokenABI from "./artifacts/HustToken.json";
import LotteryABI from "./artifacts/Lottery.json";

export const TOKEN_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const EXCHANGER_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
export const LOTTERY_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

function Navbar() {
  const { address, isConnected } = useAccount();
  const location = useLocation();

  // 1. Đọc số dư HST
  const { data: hstBalance } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: MyTokenABI.abi,
    functionName: "balanceOf",
    args: [address],
    query: { refetchInterval: 2000 }
  });

  // 2. [MỚI] Đọc chủ sở hữu (Owner) từ Lottery Contract để check quyền Admin
  const { data: ownerAddress } = useReadContract({
    address: LOTTERY_ADDRESS,
    abi: LotteryABI.abi,
    functionName: "owner"
  });

  // Kiểm tra xem người dùng hiện tại có phải là Admin không
  // (So sánh không phân biệt hoa thường)
  const isAdmin = isConnected && address && ownerAddress && address.toLowerCase() === ownerAddress.toLowerCase();

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="nav-brand">🎰 HUST Lottery</div>
        <div className="nav-links">
          <Link to="/" className={location.pathname === "/" ? "active" : ""}>Trang chủ</Link>
          <Link to="/exchange" className={location.pathname === "/exchange" ? "active" : ""}>Ngân hàng</Link>

          {/* [MỚI] Chỉ hiện nút Admin nếu đúng là Admin */}
          {isAdmin && (
            <Link to="/admin" className={location.pathname === "/admin" ? "active" : ""} style={{ color: '#f59e0b' }}>
              Admin
            </Link>
          )}
        </div>
        <div className="nav-right">
          {isConnected && (
            <div className="balance-badge">
              💰 {hstBalance ? Number(formatEther(hstBalance)).toFixed(2) : "0"} HST
            </div>
          )}
          <ConnectButton showBalance={true} chainStatus="icon" />
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <div className="app-container">
        <Navbar />
        <div className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/exchange" element={<Exchange />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;