# 交割現金對帳

檢查台灣證券帳戶中 BUY／SELL／DIVIDEND 與 DEPOSIT／WITHDRAWAL 是否對應，並在確認後逐筆新增缺少的資金 activity。

## 功能

- 依帳戶、幣別與成交日彙總交易現金流。
- BUY 預期對應 DEPOSIT；SELL 與 DIVIDEND 預期對應 WITHDRAWAL。
- 手續費與稅會納入預期金額。
- DIVIDEND 會依 `amount - fee - tax` 建議轉出淨額；獨立的 TAX activity 尚未拆成另一筆轉出規則。
- 畫面按日彙總，建立時逐筆新增，comment 會指出原始交易。
- metadata 保存原始 activity ID，避免重複建立並能發現金額變更或孤兒 activity。
- 只在使用者勾選並確認後呼叫 `saveMany`，不會背景自動寫入。

第一版採成交日，不推算台灣 T+2 交割日；金額容差預設為 1 元，可在頁面調整。

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
- 每日毛額與待補資金摘要

## License

MIT
