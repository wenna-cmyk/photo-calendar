# 拍照加入行事曆

拍下回診單或檢查通知單，自動辨識日期、時間、科別、醫師、看診號，整理成活動後加入手機行事曆。
文字辨識（PaddleOCR）完全在手機上執行，照片不會上傳，也不需要任何 API 金鑰。

## 上線步驟（GitHub Pages，免費）

1. 到 github.com 註冊或登入。
2. 右上角「+」→「New repository」，名稱填 `photo-calendar`，選 **Public**，按「Create repository」。
3. 在新的 repository 頁面點「uploading an existing file」，把這個資料夾裡的**全部檔案和資料夾**拖進去，按「Commit changes」。
   - 資料夾要保持原樣：`vendor/`、`models/`、`icons/` 裡的檔案都要上傳。
4. 進入「Settings」→ 左側「Pages」→「Branch」選 `main`、資料夾選 `/ (root)`，按「Save」。
5. 等 1～2 分鐘，網址會是：`https://你的帳號.github.io/photo-calendar/`
6. 把網址傳給要使用的人。

## 加到主畫面

- **iPhone**：用 Safari 開啟網址 → 下方「分享」→「加入主畫面」。
- **Android**：用 Chrome 開啟網址 → 右上角「⋮」→「加到主畫面」（或「安裝應用程式」）。

第一次開啟會下載約 27 MB 的辨識模組，之後會存在手機裡，沒有網路也能辨識。

## 加入行事曆的方式

| 手機 | 方式 | 提醒 |
|---|---|---|
| iPhone | 產生 .ics，直接跳出「加入行事曆」畫面 | 依 App 內設定（預設 1 小時前） |
| Android | 開啟手機內建行事曆的新增畫面 | 依行事曆 App 的預設 |
| Android（設定改成 .ics） | 下載 .ics 檔匯入（三星行事曆等） | 依 App 內設定 |

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `index.html` | 主畫面與流程 |
| `parser.js` | 回診單 / 檢查通知單解析規則 |
| `ocr-core.js`、`ocr-worker.js` | 文字辨識（PaddleOCR PP-OCRv4） |
| `s2t.js` | 簡繁轉換對照（辨識結果統一成繁體） |
| `sw.js`、`manifest.webmanifest` | 加到主畫面、離線使用 |
| `vendor/` | ONNX Runtime Web 1.20.1（MIT） |
| `models/` | PaddleOCR PP-OCRv4 模型（Apache 2.0） |

## 更新程式後

修改任何檔案後，把 `sw.js` 第 2 行的 `VERSION = 'v1'` 改成 `'v2'`（每次加 1），使用者下次開啟才會拿到新版。

## 系統需求

iOS 16.4 以上、Android Chrome 近兩年的版本。
