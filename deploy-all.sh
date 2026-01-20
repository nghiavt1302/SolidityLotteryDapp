#!/bin/bash

# Màu sắc cho output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Hàm in thông báo
print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Hàm cleanup khi script bị dừng
cleanup() {
    print_warning "Đang dọn dẹp..."
    if [ ! -z "$HARDHAT_PID" ]; then
        kill $HARDHAT_PID 2>/dev/null
    fi
    exit 1
}

trap cleanup SIGINT SIGTERM

# Bước 1: Kiểm tra và dừng các process đang chạy
print_step "Bước 1: Kiểm tra và dừng các process cũ..."

# Dừng Hardhat node cũ
HARDHAT_PIDS=$(lsof -ti:8545 2>/dev/null)
if [ ! -z "$HARDHAT_PIDS" ]; then
    print_warning "Đang dừng Hardhat node cũ (port 8545)..."
    kill -9 $HARDHAT_PIDS 2>/dev/null
    sleep 2
fi

# Dừng frontend dev server cũ
FRONTEND_PIDS=$(lsof -ti:5173 2>/dev/null)
if [ ! -z "$FRONTEND_PIDS" ]; then
    print_warning "Đang dừng frontend dev server cũ (port 5173)..."
    kill -9 $FRONTEND_PIDS 2>/dev/null
    sleep 2
fi

print_success "Đã dọn dẹp các process cũ"

# Bước 2: Khởi động Hardhat node
print_step "Bước 2: Khởi động Hardhat node..."

npx hardhat node > hardhat-log.txt 2>&1 &
HARDHAT_PID=$!

print_success "Hardhat node đã khởi động (PID: $HARDHAT_PID)"
print_step "Đang chờ Hardhat node sẵn sàng..."

# Đợi Hardhat node sẵn sàng (tối đa 30 giây)
for i in {1..30}; do
    if lsof -ti:8545 > /dev/null 2>&1; then
        print_success "Hardhat node đã sẵn sàng!"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        print_error "Timeout: Hardhat node không khởi động được"
        cleanup
    fi
done

sleep 2

# Bước 3: Deploy contracts
print_step "Bước 3: Deploy các smart contracts..."

DEPLOY_OUTPUT=$(npx hardhat run scripts/deploy.js --network localhost 2>&1)
DEPLOY_STATUS=$?

if [ $DEPLOY_STATUS -ne 0 ]; then
    print_error "Deploy thất bại!"
    echo "$DEPLOY_OUTPUT"
    cleanup
fi

echo "$DEPLOY_OUTPUT"

# Parse địa chỉ contracts từ output
TOKEN_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "HustToken deployed to:" | awk '{print $4}')
EXCHANGER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "TokenExchanger deployed to:" | awk '{print $4}')
LOTTERY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "Lottery deployed to:" | awk '{print $4}')

if [ -z "$TOKEN_ADDRESS" ] || [ -z "$EXCHANGER_ADDRESS" ] || [ -z "$LOTTERY_ADDRESS" ]; then
    print_error "Không thể lấy địa chỉ contracts từ output!"
    print_error "TOKEN_ADDRESS: $TOKEN_ADDRESS"
    print_error "EXCHANGER_ADDRESS: $EXCHANGER_ADDRESS"
    print_error "LOTTERY_ADDRESS: $LOTTERY_ADDRESS"
    cleanup
fi

print_success "Contracts đã được deploy:"
echo "  - HustToken: $TOKEN_ADDRESS"
echo "  - TokenExchanger: $EXCHANGER_ADDRESS"
echo "  - Lottery: $LOTTERY_ADDRESS"

# Bước 4: Copy ABI files
print_step "Bước 4: Copy các file ABI vào frontend..."

# Tạo thư mục artifacts nếu chưa có
mkdir -p frontend/src/artifacts

# Copy ABI files
cp artifacts/contracts/HustToken.sol/HustToken.json frontend/src/artifacts/
cp artifacts/contracts/TokenExchanger.sol/TokenExchanger.json frontend/src/artifacts/
cp artifacts/contracts/Lottery.sol/Lottery.json frontend/src/artifacts/

print_success "Đã copy các file ABI"

# Bước 5: Cập nhật địa chỉ contracts trong App.jsx
print_step "Bước 5: Cập nhật địa chỉ contracts trong App.jsx..."

APP_FILE="frontend/src/App.jsx"

# Backup file gốc
cp "$APP_FILE" "$APP_FILE.backup"

# Cập nhật địa chỉ contracts
sed -i.tmp "s|export const TOKEN_ADDRESS = \"0x[a-fA-F0-9]*\";|export const TOKEN_ADDRESS = \"$TOKEN_ADDRESS\";|g" "$APP_FILE"
sed -i.tmp "s|export const EXCHANGER_ADDRESS = \"0x[a-fA-F0-9]*\";|export const EXCHANGER_ADDRESS = \"$EXCHANGER_ADDRESS\";|g" "$APP_FILE"
sed -i.tmp "s|export const LOTTERY_ADDRESS = \"0x[a-fA-F0-9]*\";|export const LOTTERY_ADDRESS = \"$LOTTERY_ADDRESS\";|g" "$APP_FILE"

# Xóa file backup tạm
rm -f "$APP_FILE.tmp"

print_success "Đã cập nhật địa chỉ contracts trong App.jsx"

# Bước 6: Khởi động frontend
print_step "Bước 6: Khởi động frontend development server..."

cd frontend

# Cài đặt dependencies nếu cần
if [ ! -d "node_modules" ]; then
    print_step "Đang cài đặt dependencies..."
    npm install
fi

print_success "Khởi động frontend..."
print_success ""
print_success "=========================================="
print_success "  DEPLOYMENT HOÀN TẤT!"
print_success "=========================================="
echo ""
echo -e "${GREEN}Contract Addresses:${NC}"
echo "  - HustToken:      $TOKEN_ADDRESS"
echo "  - TokenExchanger: $EXCHANGER_ADDRESS"
echo "  - Lottery:        $LOTTERY_ADDRESS"
echo ""
echo -e "${GREEN}Services:${NC}"
echo "  - Hardhat Node:   http://localhost:8545 (PID: $HARDHAT_PID)"
echo "  - Frontend:       http://localhost:5173"
echo ""
echo -e "${YELLOW}Lưu ý:${NC}"
echo "  - Hardhat node đang chạy trong background"
echo "  - Frontend sẽ khởi động ngay bây giờ"
echo "  - Nhấn Ctrl+C để dừng frontend"
echo "  - Để dừng Hardhat node: kill $HARDHAT_PID"
echo ""
print_success "Đang khởi động frontend..."
echo ""

# Khởi động frontend (blocking)
npm run dev
