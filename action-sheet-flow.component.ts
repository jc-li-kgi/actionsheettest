/**
 * ActionSheetFlow（Angular 版，單一檔案）
 * 對應 Figma：銀證雙開＿External「確認證件資料」→「產品類型」選項列表 → 回到表單
 *
 * 機制：同一個遮罩不動，底部彈窗輪流「先收起、再展開」
 *   點下拉   → 表單往下收起 → 選項列表從下方展開
 *   點選項   → 選項列表收起 → 表單再展開，帶入剛選的值（表單的捲動位置保留）
 *   點遮罩或 ✕ → 整個流程收起關閉
 *
 * 需求：Angular 17.2 以上（signal input / output / contentChildren / viewChild、@if / @for）。
 * 樣式：沿用 ui-kit 的全域 CSS，這個檔案只管「結構與行為」（跟 Preact 版的分工一樣）：
 *   請在專案全域樣式載入 ui-kit/styles/ 的 tokens.css、hover.generated.css、typography-auto.css、typography.css、
 *   base.css、components.css（會用到 .sheet-mask / .sheet / .sheet__option / .field / .icon-tint 等 class），
 *   並把 ui-kit/assets/icons/ 放到專案的 assets/icons/（close.svg、check.svg、pull.svg；用檔案裡的 KgiIcon 載入）。
 *
 * 用法（通用元件 KgiSheetFlow + KgiSheet；表單與選項列表是你自己的 ng-template）：
 *   <kgi-sheet-flow [open]="open()" [view]="view()" (closed)="open.set(false)">
 *     <ng-template kgiSheet="form" sheetTitle="確認證件資料" sheetFullHeight>…表單…</ng-template>
 *     <ng-template kgiSheet="list" [sheetTitle]="標題">…選項列表…</ng-template>
 *   </kgi-sheet-flow>
 * 狀態放在呼叫端：view 是現在要看的那個彈窗（對應 kgiSheet 的名稱）。
 *
 * 限制：彈窗用 position: fixed。祖先元素有 transform 時會被限制在祖先裡面（React / Preact 版用 Portal 解決），
 *       Angular 要解的話改用 @angular/cdk/overlay；一般頁面不需要。
 */
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Directive,
  ElementRef,
  InjectionToken,
  OnDestroy,
  TemplateRef,
  booleanAttribute,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

/** 收起動畫時間：要和 components.css 的 slide-down / 遮罩淡出（0.25s）一致 */
const EXIT_MS = 250;

/** 可選：預先內嵌的 icon（檔名 → data URI）。單一 html 檔不能另外讀 assets/icons，就用這個；一般專案不用提供 */
export const KGI_ICON_URLS = new InjectionToken<Record<string, string>>('KGI_ICON_URLS', {
  providedIn: 'root',
  factory: () => ({}),
});

/* ==================== Icon（對應 ui-kit 的 Icon.js：用 CSS mask，顏色跟著文字色） ==================== */
// 為什麼要轉成完整網址：CSS 變數裡的相對路徑會以「CSS 檔」的位置解析（變成 /styles/assets/…），所以先用 document.baseURI 轉成絕對網址
@Component({
  selector: 'kgi-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'icon-tint',
    '[class.icon--subtitle]': "level() === 'subtitle'",
    '[style.width.px]': 'level() ? null : size()',
    '[style.height.px]': 'level() ? null : size()',
    '[style.--icon]': 'url()',
  },
  template: '',
})
export class KgiIcon {
  /** assets/icons/ 裡的檔名，例如 close.svg */
  readonly name = input.required<string>();
  readonly size = input(24);
  /** 跟著文字層級的尺寸（目前只有 subtitle；手機與電腦自動切換，見 ui-kit CLAUDE.md「Icon 尺寸」） */
  readonly level = input<'subtitle' | undefined>(undefined);
  private readonly inline = inject(KGI_ICON_URLS);
  protected readonly url = computed(() => {
    const name = this.name();
    return `url('${this.inline[name] ?? new URL(`assets/icons/${name}`, document.baseURI).href}')`;
  });
}

/* ==================== 一個彈窗：<ng-template kgiSheet="名稱" sheetTitle="標題"> ==================== */
@Directive({ selector: 'ng-template[kgiSheet]', standalone: true })
export class KgiSheet {
  /** 名稱：對應 <kgi-sheet-flow [view]> */
  readonly name = input.required<string>({ alias: 'kgiSheet' });
  readonly title = input.required<string>({ alias: 'sheetTitle' });
  /** 固定 90% 高（表單、搜尋類）；沒給就依內容高度 */
  readonly fullHeight = input(false, { alias: 'sheetFullHeight', transform: booleanAttribute });
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

/* ==================== 多層底部彈窗 ==================== */
@Component({
  selector: 'kgi-sheet-flow',
  standalone: true,
  imports: [NgTemplateOutlet, KgiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mounted()) {
      <div class="sheet-mask" [class.sheet-mask--leaving]="leaving()" (click)="dismiss()">
        <!-- track 用名稱：換彈窗時整個節點重建，CSS 的 slide-up 才會重播 -->
        @for (s of current(); track s.name()) {
          <div
            #panel
            class="sheet"
            [class.sheet--full-height]="s.fullHeight()"
            [class.sheet--leaving]="leaving() || out()"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="s.title()"
            (click)="$event.stopPropagation()"
          >
            <div class="sheet__header">
              <p class="sheet__title t-body-regular c-content-general-secondary">{{ s.title() }}</p>
              <button type="button" class="icon-btn" aria-label="關閉" (click)="dismiss()">
                <kgi-icon name="close.svg" />
              </button>
            </div>
            <ng-container [ngTemplateOutlet]="s.template" />
          </div>
        }
      </div>
    }
  `,
})
export class KgiSheetFlow implements OnDestroy {
  /** 整個流程開或關 */
  readonly open = input(false);
  /** 現在要看哪個彈窗（kgiSheet 的名稱）。改變時：目前的先收起，收完才展開新的 */
  readonly view = input.required<string>();
  /** 點遮罩或 ✕ */
  readonly closed = output<void>();

  protected readonly sheets = contentChildren(KgiSheet);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly mounted = signal(false); // 有沒有在畫面上（關閉後多留 0.25 秒播收起動畫）
  protected readonly leaving = signal(false); // 整個流程收起中
  protected readonly out = signal(false); // 換彈窗：目前這個正在往下收起
  private readonly shown = signal(''); // 畫面上的彈窗名稱
  protected readonly current = computed(() => this.sheets().filter((s) => s.name() === this.shown()));

  private readonly scroll = new Map<string, number>(); // 每個彈窗收起前的捲動位置
  private exitTimer?: ReturnType<typeof setTimeout>;
  private swapTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const open = this.open();
      untracked(() => (open ? this.show() : this.hide()));
    });
    effect(() => {
      const view = this.view();
      untracked(() => this.switchTo(view));
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.exitTimer);
    clearTimeout(this.swapTimer);
  }

  protected dismiss(): void {
    if (!this.leaving()) this.closed.emit();
  }

  private show(): void {
    clearTimeout(this.exitTimer);
    this.leaving.set(false);
    if (this.mounted()) return; // 收起途中又打開：接著用現在的畫面
    this.scroll.clear();
    this.out.set(false);
    this.shown.set(this.view());
    this.mounted.set(true);
  }

  private hide(): void {
    if (!this.mounted()) return;
    clearTimeout(this.swapTimer);
    this.leaving.set(true);
    this.exitTimer = setTimeout(() => {
      this.mounted.set(false);
      this.leaving.set(false);
      this.out.set(false);
    }, EXIT_MS);
  }

  /** 換彈窗：先把目前的往下收起，收完（EXIT_MS）才換成新的，並還原新彈窗上次的捲動位置 */
  private switchTo(view: string): void {
    if (!this.open() || !this.mounted() || view === this.shown()) return;
    const el = this.panel()?.nativeElement;
    if (el) this.scroll.set(this.shown(), el.scrollTop);
    this.out.set(true);
    clearTimeout(this.swapTimer);
    this.swapTimer = setTimeout(() => {
      this.shown.set(view);
      this.out.set(false);
      this.cdr.detectChanges(); // 先讓新彈窗畫出來，才能設定捲動位置
      const next = this.panel()?.nativeElement;
      if (next) next.scrollTop = this.scroll.get(view) ?? 0;
    }, EXIT_MS);
  }
}

/* ==================== 範例：確認證件資料 → 選項列表 → 回到表單 ==================== */
type FieldKey = 'city' | 'district' | 'country' | 'birthCity' | 'place' | 'type';

const CITY = ['北市', '新北市', '桃市', '中市', '南市', '高市'];
const FIELDS: Record<FieldKey, { title: string; options: string[] }> = {
  city: { title: '縣市', options: CITY },
  district: { title: '行政區', options: ['內湖區', '大安區', '信義區', '中山區', '松山區', '士林區'] },
  country: { title: '出生國家', options: ['中華民國', '日本', '美國', '新加坡', '其他'] },
  birthCity: { title: '出生城市', options: ['台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市'] },
  place: { title: '發證地點', options: CITY },
  type: { title: '發證類型', options: ['初發', '補發', '換發'] },
};

@Component({
  selector: 'kgi-id-confirm-demo',
  standalone: true,
  imports: [KgiSheetFlow, KgiSheet, KgiIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--spacing-24); padding: var(--spacing-24) var(--spacing-16) var(--spacing-16); }
    .group { display: flex; flex-direction: column; gap: var(--spacing-8); }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-24); }
    .footer {
      position: sticky;
      bottom: calc(-1 * (var(--spacing-32) + env(safe-area-inset-bottom)));
      padding: var(--spacing-12) var(--spacing-16);
      background: var(--color-container-card-white);
      border-top: 1px solid var(--color-container-general-divider);
    }
  `,
  template: `
    <!-- 一個下拉欄位（ui-kit 的 TextPicker）：點了就換到選項列表 -->
    <ng-template #picker let-key let-label="label">
      <div class="field">
        @if (label) {
          <p class="t-body-bold c-content-general-primary">{{ label }}</p>
        }
        <button type="button" class="field__picker" (click)="pick(key)">
          <span
            [class]="'t-subtitle-regular ' + (valueOf(key) ? 'c-content-general-primary' : 'c-content-general-tertiary')"
          >{{ valueOf(key) || '請選擇' }}</span>
          <kgi-icon name="pull.svg" level="subtitle" />
        </button>
        <span class="field__line"></span>
      </div>
    </ng-template>

    <button type="button" class="btn-capsule t-body-regular" (click)="start()">確認證件資料</button>

    <kgi-sheet-flow [open]="open()" [view]="view()" (closed)="close()">
      <!-- 彈窗 1：表單 -->
      <ng-template kgiSheet="form" sheetTitle="確認證件資料" sheetFullHeight>
        <div class="form">
          <div class="group">
            <p class="t-body-bold c-content-general-primary">戶籍地址</p>
            <div class="pair">
              <ng-container *ngTemplateOutlet="picker; context: { $implicit: 'city' }" />
              <ng-container *ngTemplateOutlet="picker; context: { $implicit: 'district' }" />
            </div>
            <div class="field">
              <p class="t-subtitle-regular c-content-general-primary">葫蘆里1鄰民權東路六段238巷165弄218號</p>
              <span class="field__line"></span>
            </div>
          </div>
          <ng-container *ngTemplateOutlet="picker; context: { $implicit: 'country', label: '出生國家' }" />
          <ng-container *ngTemplateOutlet="picker; context: { $implicit: 'birthCity', label: '出生城市' }" />
          <div class="field">
            <p class="t-body-bold c-content-general-primary">發證日期</p>
            <p class="t-subtitle-regular c-content-general-primary">2025/10/10</p>
            <span class="field__line"></span>
          </div>
          <ng-container *ngTemplateOutlet="picker; context: { $implicit: 'place', label: '發證地點' }" />
          <ng-container *ngTemplateOutlet="picker; context: { $implicit: 'type', label: '發證類型' }" />
        </div>
        <div class="footer">
          <button type="button" class="btn-primary t-subtitle-bold" (click)="submit()">下一步</button>
        </div>
      </ng-template>

      <!-- 彈窗 2：選項列表（選中項淡藍底 + 右側 ✓） -->
      <ng-template kgiSheet="list" [sheetTitle]="fields[field()].title">
        <div class="sheet__options" role="listbox">
          @for (o of fields[field()].options; track o) {
            <button
              type="button"
              class="sheet__option sheet__option--check"
              [class.sheet__option--selected]="o === values()[field()]"
              role="option"
              [attr.aria-selected]="o === values()[field()]"
              (click)="choose(o)"
            >
              <span class="sheet__option-text">
                <span class="t-subtitle-regular c-content-general-primary">{{ o }}</span>
              </span>
              @if (o === values()[field()]) {
                <span class="sheet__option-check">
                  <kgi-icon name="check.svg" [size]="17" />
                </span>
              }
            </button>
          }
        </div>
      </ng-template>
    </kgi-sheet-flow>
  `,
})
export class IdConfirmDemoComponent {
  protected readonly fields = FIELDS;
  protected readonly open = signal(false);
  protected readonly view = signal<'form' | 'list'>('form'); // 'form'：確認證件資料　'list'：選項列表
  protected readonly field = signal<FieldKey>('city'); // 正在選哪一欄
  protected readonly values = signal<Record<FieldKey, string>>({
    city: '北市',
    district: '內湖區',
    country: '中華民國',
    birthCity: '台北市',
    place: '北市',
    type: '', // 一開始沒有值，選完才看得出「帶入」
  });

  /** ng-template 的 let-key 沒有型別，用這個函式取值 */
  protected valueOf(key: FieldKey): string {
    return this.values()[key];
  }

  protected start(): void {
    this.view.set('form');
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
  }

  /** 點下拉：表單收起 → 選項列表展開 */
  protected pick(key: FieldKey): void {
    this.field.set(key);
    this.view.set('list');
  }

  /** 點選項：列表收起 → 表單展開（值已經在表單裡） */
  protected choose(value: string): void {
    this.values.update((v) => ({ ...v, [this.field()]: value }));
    this.view.set('form');
  }

  protected submit(): void {
    this.close();
    // 這裡接你的送出流程，例如 router.navigate(...)
  }
}
