# 交割現金對帳

檢查台灣證券帳戶中 BUY／SELL／DIVIDEND 與 DEPOSIT／WITHDRAWAL 是否對應，並在確認後逐筆新增缺少的資金 activity。

## 功能

- 依帳戶、幣別與成交日彙總交易現金流。
- BUY 預期對應 DEPOSIT；SELL 與現金 DIVIDEND 預期對應 WITHDRAWAL。依 Wealthfolio 3.8 契約，已有 `amount` 時直接採用含費稅的最終現金額，不再由數量、單價、費用與稅重算或重複扣加。
- 只有舊交易缺少 `amount` 時才在對帳邊界推導一次；明確的零值與缺值分開處理，推導結果仍會顯示供確認。
- `DIVIDEND_IN_KIND` 是以資產單位發放、沒有現金流，不會建立 WITHDRAWAL 建議。
- 畫面按日彙總，建立時逐筆新增，comment 會指出原始交易。
- metadata 保存原始 activity ID，避免重複建立並能發現金額變更或孤兒 activity。
- 已由本 addon 建立但金額過期的 activity，可在使用者勾選確認後更新為正確最終金額；多餘資金則提供可重複識別的反向調整建議。
- 只在使用者勾選並確認後呼叫 `saveMany`，不會背景自動寫入。

相容 Wealthfolio 3.8.0 以上。第一版採成交日，不推算台灣 T+2 交割日；金額容差預設為 1 元，可在頁面調整。升級前請先備份資料庫，升級後檢查 Activities → Needs review。

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev:server

# Build for production
npm run build

# Package addon
npm run bundle
```

## Features

- 交割現金對帳頁面
- 逐筆 DEPOSIT／WITHDRAWAL 建議與確認
- 每日最終現金與待補資金摘要

## License

MIT
