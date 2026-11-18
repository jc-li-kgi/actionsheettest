# ActionSheetFlow（Angular 版）

**▶ [點這裡看互動（線上）](https://jc-li-kgi.github.io/actionsheettest/action-sheet-flow.html)**　點「確認證件資料」，再點表單裡任一個下拉。

底部彈窗流程：**表單 → 選項列表 → 回到表單**。表單裡點下拉時，表單先往下收起，再展開選項列表；點選項後列表收起，表單再展開並帶入選的值。同一個遮罩全程不動，表單的捲動位置會保留。

對應 Figma：銀證雙開＿External「確認證件資料」→「產品類型」選項列表。

## 檔案

| 檔案 | 說明 |
|---|---|
| `action-sheet-flow.component.ts` | 原始碼（單一檔案）。`KgiSheetFlow` + `KgiSheet`（通用元件）、`KgiIcon`、`IdConfirmDemoComponent`（確認證件資料範例） |
| `action-sheet-flow.html` | 上面那份原始碼編譯後的單一 html（CSS、JS、icon 都內嵌），雙擊就能開，不用伺服器。**是編譯成品，不要直接編輯** |
| `index.html` | `action-sheet-flow.html` 的完整複本，讓 GitHub Pages 的根網址直接開到互動頁面。更新 html 時兩個檔案要一起換 |

## 直接看效果

雙擊 `action-sheet-flow.html`。點「確認證件資料」，再點表單裡任一個下拉。
只有 Google Fonts 字體需要連網；沒網路會改用系統字體，版面相同。

## 用在 Angular 專案

- 需求：Angular 17.2 以上（signal input / output、`contentChildren`、`viewChild`、`@if` / `@for`）。已用 Angular 22.2 嚴格模式（`strictTemplates`）編譯檢查通過。
- 樣式：元件只管結構與行為，樣式沿用 ui-kit 的全域 CSS（這個 repo 不包含）。專案要載入 ui-kit 的 Guideline token 與 `styles/`（`tokens.css`、`hover.generated.css`、`typography-auto.css`、`typography.css`、`base.css`、`components.css`），並把 `assets/icons/` 的 `close.svg`、`check.svg`、`pull.svg` 放到專案的 `assets/icons/`。
- 動畫由 CSS 做（`slide-up` / `slide-down`）。`EXIT_MS = 250` 要和 CSS 的 0.25s 一致。

```html
<kgi-sheet-flow [open]="open()" [view]="view()" (closed)="open.set(false)">
  <ng-template kgiSheet="form" sheetTitle="確認證件資料" sheetFullHeight>…表單…</ng-template>
  <ng-template kgiSheet="list" [sheetTitle]="標題">…選項列表…</ng-template>
</kgi-sheet-flow>
```

狀態放在呼叫端：`view` 是現在要看的彈窗（對應 `kgiSheet` 的名稱）。點下拉就把 `view` 改成 `'list'`，選完把值寫回並改回 `'form'`。

## 機制

核心是 `KgiSheetFlow` 的 `switchTo()`：換彈窗時先讓目前的彈窗加上 `sheet--leaving`（CSS 往下收起），`setTimeout(EXIT_MS)` 之後才換成新的（CSS `slide-up` 往上展開）。兩個 `effect()` 分別盯著 `open` 與 `view` 輸入。

## 已知限制

- 彈窗用 `position: fixed`。祖先元素有 `transform` 時會被限制在祖先裡面，要解的話改用 `@angular/cdk/overlay`。
- 單一 html 的雙擊開啟（`file://`）我在內建瀏覽器測過互動，但該瀏覽器是以 `data:` 來源顯示，沒有直接用 `file://` 測試。
