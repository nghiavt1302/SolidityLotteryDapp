# Báo Cáo Kỹ Thuật Chi Tiết Dự Án: HUST Lottery Dapp

## 1. Tổng Quan Dự Án (Project Overview)
**HUST Lottery Dapp** là một hệ sinh thái xổ số phi tập trung (Decentralized Lottery Ecosystem) được xây dựng trên nền tảng Ethereum (tương thích EVM). Dự án kết hợp giữa trò chơi may rủi minh bạch và mô hình kinh tế token (Tokenomics) tự động hóa, loại bỏ hoàn toàn sự can thiệp của bên thứ ba vào kết quả trò chơi.

**Mục tiêu:** Tạo ra một sân chơi công bằng, minh bạch tuyệt đối về dòng tiền và quy trình quay thưởng, đồng thời tích hợp các cơ chế khuyến khích cộng đồng (Referral, Caller Reward).

---

## 2. Kiến Trúc Kỹ Thuật (System Architecture)

Hệ thống hoạt động dựa trên sự tương tác giữa 3 Smart Contracts chính và một Frontend Application.

### A. Smart Contracts (Solidity ^0.8.0)
Hệ thống bao gồm 3 Hợp đồng thông minh cốt lõi:

#### 1. HustToken (HST) - ERC20 Standard
- **Vai trò:** Tiền tệ chính thức của hệ thống.
- **Tiêu chuẩn:** ERC-20 (OpenZeppelin).
- **Tính năng:**
    - `mint`: Tạo token mới (chỉ Admin/Exchanger được quyền).
    - `burn`: Đốt token (chỉ Admin/Exchanger được quyền).
    - `transfer/approve`: Chuyển nhận token tiêu chuẩn.

#### 2. TokenExchanger (Sàn quy đổi AMM đơn giản)
- **Vai trò:** Cung cấp thanh khoản, cho phép người dùng Nạp/Rút giữa ETH và HST.
- **Cơ chế Tỷ giá & Phí:**
    - **Tỷ giá Mua (Buy Rate):** Cố định **1 ETH = 100,000 HST** (`RATE = 100000`).
    - **Phí Bán (Sell Fee):** **3.3%** trên tổng giá trị quy đổi (`SELL_FEE_NUMERATOR = 33`, `FEE_DENOMINATOR = 1000`).
    - **Công thức rút ETH:**
      $$ ETH_{nhận} = \frac{HST_{bán}}{RATE} \times (1 - 0.033) $$
- **Cơ chế Bảo chứng (Reserve Logic):**
    - Hàm `withdrawETH` (Rút vốn của Admin) có cơ chế bảo vệ thanh khoản. Admin chỉ được rút số ETH dư thừa, đảm bảo hợp đồng luôn giữ đủ ETH để bảo chứng cho toàn bộ lượng HST đang lưu thông theo tỷ giá gốc.
    - Điều kiện rút: `Balance_{contract} - Amount_{withdraw} >= TotalSupply_{HST} / RATE`

#### 3. Lottery (Logic Xổ số)
- **Vai trò:** Quản lý vòng chơi, bán vé, quay thưởng, chia giải.
- **Thông số cấu hình:**
    - `ticketPrice`: **10 HST** / vé.
    - `lotteryDuration`: Thời gian mỗi vòng (mặc định 7 phút, Admin có thể chỉnh).
    - `lotteryId`: Bộ đếm số vòng chơi (Round ID).
    - `MAX_JACKPOT`: Giới hạn tối đa của quỹ Hũ (**10,000 HST**).
    - `MIN_PLAYERS_FOR_JACKPOT`: Tối thiểu **3 người chơi** khác nhau mới được tính nổ hũ.

---

## 3. Cơ Chế Vận Hành & Toán Học (Mechanics & Math)

### A. Quy trình Mua vé (Buy Tickets)
1.  **Thanh toán:** Người dùng chuyển HST vào contract Lottery.
2.  **Hoa hồng (Referral Bonus):**
    - Nếu người mua nhập mã giới thiệu hợp lệ: **1%** giá trị vé chuyển ngay lập tức cho người giới thiệu.
    - `transfer(referrer, totalCost * 1 / 100)`
3.  **Ghi nhận:**
    - Địa chỉ người chơi được thêm vào mảng `players` (mua n vé được thêm n lần -> tăng xác suất).
    - Cập nhật biến `uniquePlayersCount` để đếm số người chơi thực tế.

### B. Quy trình Quay thưởng (Pick Winner)
Hàm `pickWinner` là trái tim của hệ thống, thực hiện các bước sau:

#### Bước 1: Sinh số ngẫu nhiên (Randomness Generation)
Sử dụng các biến on-chain để tạo entropy (độ ngẫu nhiên giả lập):
```solidity
bytes32 entropy = keccak256(abi.encodePacked(
    blockhash(block.number - 1), // Hash block trước
    block.prevrandao,            // Giá trị ngẫu nhiên từ Beacon Chain
    block.timestamp,             // Thời gian thực
    players.length,              // Tổng vé
    uniquePlayersCount,          // Tổng người chơi
    msg.sender                   // Người gọi hàm
));
```
*Ghi chú: Mặc dù on-chain randomness có thể bị thao túng bởi miner/validator trong các trường hợp cực đoan, nhưng với giá trị giải thưởng nhỏ/trung bình, phương pháp này đủ an toàn và tiết kiệm gas hơn Chainlink VRF.*

#### Bước 2: Chọn Người thắng (Winner Selection)
```solidity
uint256 randomIndex = uint256(entropy) % players.length;
address winner = players[randomIndex];
```

#### Bước 3: Phân bổ Doanh thu (Revenue Distribution)
Giả sử `Doanh Thu Vòng (R)` = `Số dư HST hiện tại` - `Quỹ Jackpot cũ`.

1.  **Phí Admin (System Fee):** **0.1%** doanh thu.
    - `fee = R / 1000`
2.  **Đóng góp Jackpot (Jackpot Contribution):**
    - Nếu `uniquePlayersCount > 1`: Trích **10%** doanh thu (`R * 10 / 100`) đưa vào `jackpotPool`.
    - **Cơ chế Cap:** Nếu cộng thêm vào mà vượt quá `MAX_JACKPOT` (10,000 HST), phần dư sẽ trả lại vào giải thưởng vòng, quỹ Jackpot giữ ở mức Max.
3.  **Giải Thưởng Cơ Sở (Base Prize):**
    - `BasePrize = R - Fee - JackpotContribution`.

#### Bước 4: Xét duyệt Nổ Hũ (Jackpot Logic)
- **Điều kiện cần:** `uniquePlayersCount >= 3`.
- **Tỷ lệ trúng (Chance):**
    - Tỷ lệ gốc: **0.1%** (10/10000).
    - Tỷ lệ cộng thêm: Cứ mỗi **100 HST** trong quỹ Jackpot sẽ tăng thêm **0.01%** cơ hội.
    - Công thức code:
      `bonusChance = jackpotPool / (100 * 10^18)`
      `totalChance = 10 + bonusChance` (Max 1000 tương đương 10%).
- **Quay số Jackpot:**
    - Sinh số ngẫu nhiên thứ 2: `jackpotRoll = keccak256(...) % 10000`.
    - Nếu `jackpotRoll < totalChance` => **NỔ HŨ!**
    - **Hệ quả:** `FinalPrize = BasePrize + jackpotPool`. Reset `jackpotPool = 0`.

#### Bước 5: Thưởng Người Gọi Hàm (Caller Reward)
- **Động lực:** Khuyến khích cộng đồng kích hoạt hàm `pickWinner` khi hết giờ.
- **Phần thưởng:** **2%** trên tổng giải thưởng cuối cùng (FinalPrize).
- **Thực nhận của Winner:** 98% còn lại.

---

## 4. Công Nghệ & Thư Viện (Tech Stack Setup)

### Frontend Environment
- **Core:** React v19.2.0.
- **Build Tool:** Vite v7.2.4 (Siêu tốc).
- **Language:** JavaScript (ES6+), CSS3 (Modern, Variables, Glassmorphism).

### Blockchain Integration Libraries
- **Wagmi (v2.19.5):** Một bộ React Hooks mạnh mẽ để quản lý trạng thái ví, kết nối, và transaction lifecycle.
- **Viem (v2.44.4):** Library thay thế Ethers.js ở tầng thấp (low-level), tương tác trực tiếp chuẩn xác với JSON-RPC.
- **Ethers.js (v6.16.0):** Sử dụng các tiện ích tính toán (`formatEther`, `parseEther`, `Interface`).
- **RainbowKit (v2.2.10):** UI/UX kết nối ví chuyên nghiệp, hỗ trợ nhiều ví (MetaMask, WalletConnect, v.v.).

### Development & Testing
- **Hardhat:** Môi trường phát triển Smart Contract cục bộ.
- **Local Network:** Chạy node Ethereum giả lập tại `127.0.0.1:8545`.

---

## 5. Dữ Liệu & Sự Kiện (Events & Logs)
Hệ thống sử dụng Event-driven architecture để Frontend cập nhật dữ liệu Real-time mà không cần polling liên tục.

### Lottery Events
| Tên Event | Tham số chính | Ý nghĩa |
| :--- | :--- | :--- |
| `TicketPurchased` | `player`, `amount`, `roundId` | Xác nhận mua vé thành công. |
| `WinnerPicked` | `winner`, `amount`, `isJackpotHit` | Công bố người thắng khi kết thúc vòng. |
| `RoundResult` | `roundId`, `totalFund`, `jackpotContribution` | Số liệu thống kê chi tiết sau mỗi vòng để lưu lịch sử. |
| `AdminFeeTransferred` | `admin`, `amount`, `roundId` | Minh bạch hóa khoản phí hệ thống thu. |
| `ReferralBonusTransferred`| `referrer`, `amount`, `buyer`, `roundId` | Ghi nhận hoa hồng giới thiệu. |

### Exchanger Events
| Tên Event | Tham số chính | Ý nghĩa |
| :--- | :--- | :--- |
| `TokensPurchased` | `buyer`, `ethAmount`, `tokenAmount` | Lịch sử mua HST. |
| `TokensSold` | `seller`, `tokenAmount`, `fee` | Lịch sử bán HST, minh bạch phí 3.3%. |

---

## 6. Bảo Mật & An Toàn (Security Considerations)
1.  **Reentrancy Guard:** Mặc dù logic đơn giản, việc sử dụng `SafeERC20` và tuân thủ mẫu Checking-Effects-Interactions giúp tránh lỗi tấn công tái nhập.
2.  **Liquidity Safety:** Contract `TokenExchanger` khóa chặt điều kiện rút vốn của Admin, ngăn chặn hành vi "Rug pull" (rút cạn thanh khoản), đảm bảo người dùng luôn có thể bán lại HST lấy ETH.
3.  **Ownership:** Các hàm nhạy cảm (`setDuration`, `withdraw`, `deposit`) được bảo vệ bởi modifier `onlyOwner`.
4.  **Data Integrity:** Sử dụng `SafeMath` (mặc định trong Solidity 0.8+) chống tràn số (overflow/underflow).

---
*Báo cáo kỹ thuật HUST Lottery Dapp - Phiên bản chi tiết v2.0 - Ngày 21/01/2026*
