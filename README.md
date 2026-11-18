# 響應式彈窗（Angular 版）

**▶ [點這裡看互動（線上）](https://jc-li-kgi.github.io/actionsheettest/action-sheet-flow.html)**　點「確認證件資料」，再點表單裡任一個下拉。

一個元件、一組寫法，依視窗寬度自己決定呈現方式（RWD）。對應 Figma：銀證雙開＿External「確認證件資料」→「產品類型」選項列表。

| | 手機（≤ 768px） | 桌面（> 768px） |
|---|---|---|
| `kgi-modal` | 底部彈窗（貼底、往上展開） | 置中 Dialog（最大寬 480、最大高 90vh，標題與「下一步」固定、中間可捲動） |
| `kgi-select`（點下拉） | 表單往下收起 → 展開選項列表 → 選完收起、表單展開並帶入值。同一個遮罩全程不動，表單捲動位置保留 | 表單不動，在欄位正下方展開選項（空間不夠往上展開），選完收起並填入值 |
| 鍵盤 | — | ↑↓、Home / End、Enter / 空白鍵選取；Esc 先關選單、再按才關 Dialog；Tab 關選單；關閉後焦點回到原本的欄位／按鈕 |

縮放視窗時即時切換（手機的選項列表開著時縮放成桌面，會回到主畫面）。範例頁上方有「自動 / 手機 / 桌面」按鈕，可以在任何視窗大小切換預覽。桌面版的外觀（Dialog 寬度、選項高度）是依 ui-kit 的 Dialog 樣式推估，沒有對照桌面版設計稿。

## 寫法（工程師只寫一份表單，不分手機 / 桌面）

```html
<kgi-modal [open]="open()" title="確認證件資料" fullHeight (closed)="open.set(false)">
  <kgi-select label="出生國家" [options]="['中華民國', '日本']" [(value)]="country" />
  …其他欄位…
  <button kgiModalFooter class="btn-primary t-subtitle-bold">下一步</button>
</kgi-modal>
```

- `fullHeight`：手機版固定 90% 高（表單）；桌面版高度依內容。
- `kgi-select` 不放在 `kgi-modal` 裡也能用：手機自己開一個底部選項彈窗，桌面是欄位旁的下拉。
- 不需要管「現在看哪個彈窗」的狀態；值用 `[(value)]` 綁在你自己的 signal 上。

## 檔案

| 檔案 | 說明 |
|---|---|
| `action-sheet-flow.component.ts` | 原始碼（單一檔案）：`KgiViewport`（手機 / 桌面的唯一判斷來源）、`KgiModal`、`KgiSelect`、`KgiIcon`、`IdConfirmDemoComponent`（確認證件資料範例） |
| `action-sheet-flow.html` | 上面那份原始碼編譯後的單一 html（CSS、JS、icon 都內嵌），雙擊就能開，不用伺服器。**是編譯成品，不要直接編輯** |
| `index.html` | `action-sheet-flow.html` 的完整複本，讓 GitHub Pages 的根網址直接開到互動頁面。更新 html 時兩個檔案要一起換 |

## 用在 Angular 專案

- 需求：Angular 17.2 以上（signal input / output / model、`viewChild`、`@if` / `@for`）。已用 Angular 22.2 嚴格模式（`strictTemplates`）編譯檢查通過。
- 樣式：彈窗、Dialog、下拉的版面寫在元件裡，顏色、間距、字級、圓角、陰影全部用 ui-kit 的 Guideline token。專案要載入 ui-kit 的 Guideline token 與 `styles/`（`tokens.css`、`hover.generated.css`、`typography-auto.css`、`typography.css`、`base.css`、`components.css`；會用到 `.field`、`.field__picker`、`.sheet__option` 等全域 class），並把 `assets/icons/` 的 `close.svg`、`check.svg`、`pull.svg` 放到專案的 `assets/icons/`。
- 斷點只在 `KgiViewport` 一處（`(min-width: 769px)`，與 ui-kit 字級切換一致）。要改斷點改這一個常數。
- 動畫由元件內的 CSS 做；`EXIT_MS = 250` 要和 CSS 的 0.25s 一致。

## 機制

- **手機換畫面**：`KgiModal` 內部有「主畫面」與「第二層」。`KgiSelect` 在手機版呼叫 `modal.push(選項列表)`，`KgiModal` 先讓主畫面加上 `panel--out`（CSS 往下收起），`setTimeout(EXIT_MS)` 之後才換成第二層（`slide-up` 往上展開）；選完 `modal.pop()` 反向做一次。兩個 `effect()` 分別盯著 `open` 與目前要看的畫面。
- **桌面下拉**：`KgiSelect` 自己用 `position: fixed` 畫選單，位置在開啟時依欄位算。Dialog 內容捲動、視窗縮放時選單直接關閉。
- **KgiSelect 怎麼知道自己在不在 KgiModal 裡**：`inject(KgiModal, { optional: true })`。

## 已知限制

- 沒做：輸入文字跳到符合的選項（type-ahead）、完整的焦點鎖定（Tab 可能跑到彈窗後面）。正式專案建議改用 Reka UI 的 `Dialog` / `Select`，或 Angular CDK。
- 彈窗與下拉用 `position: fixed`。祖先元素有 `transform` 時會被限制在祖先裡面，要解的話改用 `@angular/cdk/overlay`。
- 沒測：觸控操作與螢幕閱讀器。
- 單一 html 的雙擊開啟（`file://`）我在內建瀏覽器測過互動，但該瀏覽器是以 `data:` 來源顯示，沒有直接用 `file://` 測試。
