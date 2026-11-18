/**
 * 響應式（RWD）彈窗：一個元件、一組寫法，依視窗寬度自己決定呈現方式
 * 對應 Figma：銀證雙開＿External「確認證件資料」→「產品類型」選項列表 → 回到表單
 *
 *                 手機（≤ 768px）                              桌面（> 768px）
 *   KgiModal      底部彈窗（貼底，往上展開）                      置中 Dialog（最大寬 480、最大高 90vh）
 *   KgiSelect     點下拉：表單收起 → 展開選項列表 → 選完收起、      點下拉：表單不動，在欄位正下方展開選項
 *                 表單展開並帶入值（同一個遮罩、表單捲動位置保留）    （空間不夠往上展開），選完收起並填入值
 *
 * 用法（不用自己管手機 / 桌面，也不用管「現在看哪個彈窗」的狀態）：
 *   <kgi-modal [open]="open()" title="確認證件資料" fullHeight (closed)="open.set(false)">
 *     <kgi-select label="出生國家" [options]="['中華民國', '日本']" [(value)]="country" />
 *     …其他欄位…
 *     <button kgiModalFooter class="btn-primary t-subtitle-bold">下一步</button>
 *   </kgi-modal>
 *   fullHeight：手機版固定 90% 高（表單）；桌面版高度依內容。
 *   KgiSelect 不放在 KgiModal 裡也能用：手機自己開一個底部選項彈窗，桌面是欄位旁的下拉。
 *
 * 判斷手機 / 桌面只有一個地方：KgiViewport（matchMedia，斷點與 ui-kit 字級切換一致，> 768px）。
 * 縮放視窗時即時切換；KgiViewport.override 可以強制預覽成手機或桌面。
 *
 * 需求：Angular 17.2 以上（signal input / output / model、viewChild、@if / @for）。
 * 樣式：版面（彈窗、Dialog、下拉）寫在元件裡，顏色、間距、字級、圓角、陰影全部用 ui-kit 的 Guideline token；
 *   請在專案全域樣式載入 ui-kit/styles/ 的 tokens.css、hover.generated.css、typography-auto.css、typography.css、
 *   base.css、components.css（會用到 .field / .field__picker / .sheet__option / .icon-tint 等全域 class），
 *   並把 ui-kit/assets/icons/ 放到專案的 assets/icons/（close.svg、check.svg、pull.svg；用檔案裡的 KgiIcon 載入）。
 *
 * 限制：彈窗與下拉用 position: fixed。祖先元素有 transform 時會被限制在祖先裡面（Preact 版用 Portal 解決），
 *       Angular 要解的話改用 @angular/cdk/overlay；一般頁面不需要。
 *       沒做：輸入文字跳到符合的選項（type-ahead）、完整的焦點鎖定。正式專案建議改用 Reka UI 的 Dialog / Select 或 Angular CDK。
 */
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Injectable,
  InjectionToken,
  OnDestroy,
  TemplateRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

/** 收起動畫時間：彈窗往下收起、遮罩淡出（0.25s），要和元件裡 CSS 的動畫時間一致 */
const EXIT_MS = 250;
/** 桌面斷點：與 ui-kit 的字級（typography-auto.css）切換一致，畫面 > 768px */
const DESKTOP_QUERY = '(min-width: 769px)';

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

/* ==================== 手機 / 桌面：唯一的判斷來源 ==================== */
@Injectable({ providedIn: 'root' })
export class KgiViewport {
  /** 強制預覽成手機或桌面（null = 依視窗寬度）。正式專案通常不會用到 */
  readonly override = signal<'mobile' | 'desktop' | null>(null);
  private readonly wide = signal(false);
  readonly isDesktop = computed(() => {
    const o = this.override();
    return o === null ? this.wide() : o === 'desktop';
  });

  constructor() {
    const mq = window.matchMedia(DESKTOP_QUERY);
    this.wide.set(mq.matches);
    mq.addEventListener('change', (e) => this.wide.set(e.matches));
  }
}

/* ==================== 彈窗：手機底部彈窗 / 桌面置中 Dialog ==================== */
/** 手機版的「第二層」：主畫面收起，展開這一層（例如選項列表）；pop() 再換回主畫面 */
export interface KgiModalLayer {
  title: string;
  template: TemplateRef<unknown>;
}
type View = 'main' | 'layer';

@Component({
  selector: 'kgi-modal',
  standalone: true,
  imports: [KgiIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .mask {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: flex-end; /* 手機：貼底 */
      justify-content: center;
      background: var(--color-surface-blue-75);
      -webkit-backdrop-filter: blur(var(--overlay-blur));
      backdrop-filter: blur(var(--overlay-blur));
      animation: kgi-fade-in 0.2s ease;
    }
    .mask.desktop { align-items: center; padding: 0 var(--spacing-24); } /* 桌面：置中 */
    .mask--leaving { animation: kgi-fade-out 0.25s ease forwards; pointer-events: none; }

    .panel {
      width: 100%;
      max-width: var(--app-max-width);
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      background: var(--color-container-card-white);
      box-shadow: var(--shadow-popover);
      text-align: left;
      outline: none;
      animation: kgi-slide-up 0.25s ease;
    }
    .panel--full { height: 90vh; }
    .panel--out { animation: kgi-slide-down 0.25s ease forwards; }
    .desktop .panel { max-width: 480px; height: auto; border-radius: var(--radius-small); animation: none; }
    .desktop .panel--out { animation: none; }

    .head { flex: none; display: flex; align-items: center; gap: var(--spacing-8); padding: var(--spacing-32) var(--spacing-16) var(--spacing-8); }
    .desktop .head { padding: var(--spacing-24) var(--spacing-24) var(--spacing-8); }
    .title { flex: 1; }

    .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--spacing-24) var(--spacing-16) var(--spacing-16); }
    .desktop .body { padding: var(--spacing-8) var(--spacing-24) var(--spacing-24); }
    /* flush：選項列表，內容自己有左右邊距，只留底部 */
    .body--flush { padding: 0 0 calc(var(--spacing-32) + env(safe-area-inset-bottom)); }
    .desktop .body--flush { padding: 0 0 var(--spacing-8); }

    .foot { flex: none; padding: var(--spacing-12) var(--spacing-16) calc(var(--spacing-12) + env(safe-area-inset-bottom)); border-top: 1px solid var(--color-container-general-divider); }
    .desktop .foot { padding: var(--spacing-16) var(--spacing-24); }
    .foot:empty { display: none; }

    @keyframes kgi-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes kgi-fade-out { from { opacity: 1; } to { opacity: 0; } }
    @keyframes kgi-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
    @keyframes kgi-slide-down { from { transform: translateY(0); } to { transform: translateY(100%); } }
  `,
  template: `
    @if (mounted()) {
      <div class="mask" [class.desktop]="desktop()" [class.mask--leaving]="leaving()" (click)="dismiss()" (keydown)="onKey($event)">
        <!-- track 用畫面名稱：換畫面時整個節點重建，手機的 slide-up 才會重播 -->
        @for (v of current(); track v) {
          <div
            #panel
            class="panel"
            [class.panel--full]="fullHeight() && v === 'main'"
            [class.panel--out]="leaving() || out()"
            role="dialog"
            aria-modal="true"
            tabindex="-1"
            [attr.aria-label]="heading()"
            (click)="$event.stopPropagation()"
          >
            <div class="head">
              <p class="title t-body-regular c-content-general-secondary">{{ heading() }}</p>
              <button type="button" class="icon-btn" aria-label="關閉" (click)="dismiss()"><kgi-icon name="close.svg" /></button>
            </div>
            @if (v === 'main') {
              <div #body class="body" [class.body--flush]="flush()"><ng-content /></div>
              <div class="foot"><ng-content select="[kgiModalFooter]" /></div>
            } @else {
              @if (lastLayer(); as l) {
                <div #body class="body body--flush"><ng-container *ngTemplateOutlet="l.template" /></div>
              }
            }
          </div>
        }
      </div>
    }
  `,
})
export class KgiModal implements OnDestroy {
  readonly open = input(false);
  readonly title = input.required<string>();
  /** 手機版固定 90% 高（表單、搜尋類）；沒給就依內容高度。桌面版一律依內容 */
  readonly fullHeight = input(false, { transform: booleanAttribute });
  /** 內容是選項列表（自己有左右邊距）：不加預設內距 */
  readonly flush = input(false, { transform: booleanAttribute });
  /** 點遮罩、✕ 或按 Esc */
  readonly closed = output<void>();

  private readonly viewport = inject(KgiViewport);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  protected readonly desktop = this.viewport.isDesktop;
  protected readonly mounted = signal(false); // 有沒有在畫面上（關閉後多留 0.25 秒播收起動畫）
  protected readonly leaving = signal(false); // 整個彈窗收起中
  protected readonly out = signal(false); // 換畫面：目前這個正在往下收起
  protected readonly shown = signal<View>('main'); // 畫面上的是主畫面還是第二層
  protected readonly current = computed<View[]>(() => [this.shown()]);
  protected readonly lastLayer = signal<KgiModalLayer | null>(null); // 收起動畫期間還要畫著，所以和 layer 分開存
  protected readonly heading = computed(() => (this.shown() === 'layer' ? this.lastLayer()?.title ?? '' : this.title()));

  private readonly layer = signal<KgiModalLayer | null>(null); // 要看的第二層（null = 主畫面）
  private readonly scroll = new Map<View, number>(); // 每個畫面收起前的捲動位置
  private opener: HTMLElement | null = null; // 開啟前的焦點：關閉後還給它
  private exitTimer?: ReturnType<typeof setTimeout>;
  private swapTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const open = this.open();
      untracked(() => (open ? this.show() : this.hide()));
    });
    effect(() => {
      const target: View = this.layer() ? 'layer' : 'main';
      untracked(() => this.switchTo(target));
    });
    effect(() => {
      // 手機轉成桌面（縮放視窗）：回到主畫面，桌面版沒有第二層
      if (this.viewport.isDesktop()) untracked(() => this.layer.set(null));
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.exitTimer);
    clearTimeout(this.swapTimer);
  }

  /** 手機版：主畫面往下收起，展開第二層（KgiSelect 用來顯示選項列表） */
  push(layer: KgiModalLayer): void {
    this.lastLayer.set(layer);
    this.layer.set(layer);
  }

  /** 手機版：第二層收起，主畫面再展開 */
  pop(): void {
    this.layer.set(null);
  }

  protected dismiss(): void {
    if (!this.leaving()) this.closed.emit();
  }

  /** Esc：第二層開著就回主畫面，否則關閉。KgiSelect 的桌面下拉開著時，Esc 由它先處理（stopPropagation） */
  protected onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (this.shown() === 'layer') this.pop();
    else this.dismiss();
  }

  private show(): void {
    clearTimeout(this.exitTimer);
    this.leaving.set(false);
    if (this.mounted()) return; // 收起途中又打開：接著用現在的畫面
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.scroll.clear();
    this.out.set(false);
    this.layer.set(null);
    this.shown.set('main');
    this.mounted.set(true);
    setTimeout(() => this.panel()?.nativeElement.focus()); // 焦點進到彈窗，Esc 才收得到
  }

  private hide(): void {
    if (!this.mounted()) return;
    clearTimeout(this.swapTimer);
    this.leaving.set(true);
    this.exitTimer = setTimeout(() => {
      this.mounted.set(false);
      this.leaving.set(false);
      this.out.set(false);
      this.opener?.focus();
      this.opener = null;
    }, EXIT_MS);
  }

  /** 換畫面：先把目前的往下收起，收完（EXIT_MS）才換成新的，並還原新畫面上次的捲動位置 */
  private switchTo(target: View): void {
    if (!this.open() || !this.mounted() || target === this.shown()) return;
    const b = this.body()?.nativeElement;
    if (b) this.scroll.set(this.shown(), b.scrollTop);
    this.out.set(true);
    clearTimeout(this.swapTimer);
    this.swapTimer = setTimeout(() => {
      this.shown.set(target);
      this.out.set(false);
      this.cdr.detectChanges(); // 先讓新畫面畫出來，才能設定捲動位置
      const nb = this.body()?.nativeElement;
      if (nb) nb.scrollTop = this.scroll.get(target) ?? 0;
      this.panel()?.nativeElement.focus();
    }, EXIT_MS);
  }
}

/* ==================== 下拉選擇：手機 = 換成選項列表；桌面 = 欄位旁的下拉選單 ==================== */
// 桌面：點欄位 → 在欄位正下方展開（空間不夠往上）→ 點選項收起並填入值。
//   鍵盤：↑↓、Home / End 移動，Enter / 空白鍵選取，Esc 只關選單（不關 Dialog），Tab 關閉。
// 手機：放在 KgiModal 裡 → 主畫面收起、展開選項列表（modal.push）；不在 KgiModal 裡 → 自己開一個底部選項彈窗。
const MENU_MAX = 280; // 桌面選單最高 280px，超過可捲動
const ROW_H = 48; // 一列選項高度（估算往上或往下展開用：上下 12 + 文字 24）
let nextSelectId = 0;

@Component({
  selector: 'kgi-select',
  standalone: true,
  imports: [KgiIcon, KgiModal, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:resize)': 'close(false)' },
  styles: `
    button:focus-visible { outline: 2px solid var(--color-content-general-active); outline-offset: 2px; }
    .menu {
      position: fixed;
      z-index: 70; /* 高過彈窗的遮罩（50） */
      overflow-y: auto;
      padding: var(--spacing-4) 0;
      background: var(--color-container-card-white);
      border-radius: var(--radius-small);
      box-shadow: var(--shadow-popover);
      outline: none;
    }
    .opt { display: flex; align-items: center; gap: var(--spacing-8); padding: var(--spacing-12) var(--spacing-16); cursor: pointer; }
    .opt span:first-child { flex: 1; min-width: 0; }
    .opt--active { background: var(--color-container-card-white-hover); }
    .opt--selected { background: var(--color-container-general-option-selected-blue); }
    .check { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--color-content-general-active); }
  `,
  template: `
    <div class="field">
      @if (label()) {
        <p class="t-body-bold c-content-general-primary">{{ label() }}</p>
      }
      <button
        #trigger
        type="button"
        class="field__picker"
        aria-haspopup="listbox"
        [attr.aria-expanded]="isOpen()"
        (click)="toggle()"
        (keydown)="onTriggerKey($event)"
      >
        <span [class]="'t-subtitle-regular ' + (value() ? 'c-content-general-primary' : 'c-content-general-tertiary')">{{ value() || placeholder() }}</span>
        <kgi-icon name="pull.svg" level="subtitle" />
      </button>
      <span class="field__line"></span>
    </div>

    <!-- 桌面：欄位旁的下拉選單 -->
    @if (isOpen()) {
      <div
        #menu
        class="menu"
        role="listbox"
        tabindex="-1"
        [attr.aria-label]="label() || placeholder()"
        [attr.aria-activedescendant]="uid + '-' + active()"
        [style.left.px]="pos().left"
        [style.width.px]="pos().width"
        [style.top.px]="pos().top ?? null"
        [style.bottom.px]="pos().bottom ?? null"
        [style.max-height.px]="pos().maxHeight"
        (keydown)="onMenuKey($event)"
      >
        @for (o of options(); track o; let i = $index) {
          <div
            class="opt"
            role="option"
            [id]="uid + '-' + i"
            [class.opt--active]="i === active()"
            [class.opt--selected]="o === value()"
            [attr.aria-selected]="o === value()"
            (click)="choose(o)"
            (mousemove)="active.set(i)"
          >
            <span class="t-subtitle-regular c-content-general-primary">{{ o }}</span>
            @if (o === value()) {
              <span class="check"><kgi-icon name="check.svg" [size]="17" /></span>
            }
          </div>
        }
      </div>
    }

    <!-- 手機：選項列表（選中項淡藍底 + 右側 ✓）。放在 KgiModal 裡由它顯示；不在 KgiModal 裡就用下面自己的底部彈窗 -->
    <ng-template #optionList>
      <div class="sheet__options" role="listbox">
        @for (o of options(); track o) {
          <button
            type="button"
            class="sheet__option sheet__option--check"
            [class.sheet__option--selected]="o === value()"
            role="option"
            [attr.aria-selected]="o === value()"
            (click)="choose(o)"
          >
            <span class="sheet__option-text">
              <span class="t-subtitle-regular c-content-general-primary">{{ o }}</span>
            </span>
            @if (o === value()) {
              <span class="sheet__option-check"><kgi-icon name="check.svg" [size]="17" /></span>
            }
          </button>
        }
      </div>
    </ng-template>
    @if (!parentModal && !desktop()) {
      <kgi-modal flush [open]="soloOpen()" [title]="label() || placeholder()" (closed)="soloOpen.set(false)">
        <ng-container *ngTemplateOutlet="optionList" />
      </kgi-modal>
    }
  `,
})
export class KgiSelect implements OnDestroy {
  readonly label = input('');
  readonly options = input.required<readonly string[]>();
  readonly placeholder = input('請選擇');
  /** 目前的值。用法：[(value)]="…" 或 [value]="…" (valueChange)="…" */
  readonly value = model('');

  protected readonly isOpen = signal(false); // 桌面下拉是否展開
  protected readonly soloOpen = signal(false); // 手機、不在 KgiModal 裡：自己的底部選項彈窗
  protected readonly active = signal(0); // 桌面下拉：目前標示（滑鼠移過或鍵盤選到）的那一列
  protected readonly pos = signal<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number }>({ left: 0, width: 0, maxHeight: MENU_MAX });
  protected readonly uid = `kgi-select-${nextSelectId++}`;

  private readonly viewport = inject(KgiViewport);
  protected readonly desktop = this.viewport.isDesktop;
  protected readonly parentModal = inject(KgiModal, { optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  private readonly optionList = viewChild.required<TemplateRef<unknown>>('optionList');

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.onScroll, true);
    document.removeEventListener('click', this.onOutsideClick, true);
  }

  protected toggle(): void {
    if (this.desktop()) {
      if (this.isOpen()) this.close(true);
      else this.openMenu();
    } else if (this.parentModal) {
      this.parentModal.push({ title: this.label() || this.placeholder(), template: this.optionList() }); // 表單收起 → 展開選項列表
    } else {
      this.soloOpen.set(true);
    }
  }

  private openMenu(): void {
    const t = this.trigger()?.nativeElement;
    if (!t) return;
    // 選單用 position: fixed（不會被彈窗的捲動區裁掉），位置依欄位算；下方放不下、上方比較寬就往上展開
    const r = t.getBoundingClientRect();
    const want = Math.min(this.options().length * ROW_H + 8, MENU_MAX);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < want && above > below;
    this.pos.set({
      left: r.left,
      width: r.width,
      top: up ? undefined : r.bottom + 6,
      bottom: up ? window.innerHeight - r.top + 6 : undefined,
      maxHeight: Math.max(120, Math.min(MENU_MAX, up ? above : below)),
    });
    const i = this.options().indexOf(this.value());
    this.active.set(i >= 0 ? i : 0);
    this.isOpen.set(true);
    document.addEventListener('scroll', this.onScroll, true); // 彈窗內容捲動時選單位置會錯開，直接關閉
    document.addEventListener('click', this.onOutsideClick, true); // 用捕獲階段：彈窗面板會 stopPropagation，冒泡階段收不到
    setTimeout(() => {
      this.menu()?.nativeElement.focus();
      this.reveal(this.active());
    });
  }

  protected close(refocus: boolean): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    document.removeEventListener('scroll', this.onScroll, true);
    document.removeEventListener('click', this.onOutsideClick, true);
    if (refocus) this.trigger()?.nativeElement.focus(); // 焦點回到欄位
  }

  /** 選一個：桌面收起下拉；手機收起選項列表、換回表單（值已經寫進去了） */
  protected choose(o: string): void {
    this.value.set(o);
    if (this.desktop()) this.close(true);
    else if (this.parentModal) this.parentModal.pop();
    else this.soloOpen.set(false);
  }

  protected onTriggerKey(e: KeyboardEvent): void {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && this.desktop() && !this.isOpen()) {
      e.preventDefault();
      this.openMenu();
    }
  }

  protected onMenuKey(e: KeyboardEvent): void {
    const last = this.options().length - 1;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); this.setActive(Math.min(last, this.active() + 1)); break;
      case 'ArrowUp': e.preventDefault(); this.setActive(Math.max(0, this.active() - 1)); break;
      case 'Home': e.preventDefault(); this.setActive(0); break;
      case 'End': e.preventDefault(); this.setActive(last); break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const o = this.options()[this.active()];
        if (o !== undefined) this.choose(o);
        break;
      }
      case 'Escape': e.preventDefault(); e.stopPropagation(); this.close(true); break; // 只關選單，不連彈窗一起關
      case 'Tab': this.close(false); break;
    }
  }

  private setActive(i: number): void {
    this.active.set(i);
    this.reveal(i);
  }

  private reveal(i: number): void {
    document.getElementById(`${this.uid}-${i}`)?.scrollIntoView({ block: 'nearest' });
  }

  private readonly onOutsideClick = (e: Event): void => {
    if (!this.host.nativeElement.contains(e.target as Node)) this.close(false);
  };

  private readonly onScroll = (e: Event): void => {
    if (!this.menu()?.nativeElement.contains(e.target as Node)) this.close(false);
  };
}

/* ==================== 範例：確認證件資料（一份表單，手機與桌面自動切換） ==================== */
const CITY = ['北市', '新北市', '桃市', '中市', '南市', '高市'];
const DISTRICT = ['內湖區', '大安區', '信義區', '中山區', '松山區', '士林區'];
const COUNTRY = ['中華民國', '日本', '美國', '新加坡', '其他'];
const BIRTH_CITY = ['台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市'];
const ID_TYPE = ['初發', '補發', '換發'];

const MODES = [
  { key: null, label: '自動（依視窗寬度）' },
  { key: 'mobile', label: '手機' },
  { key: 'desktop', label: '桌面' },
] as const;

@Component({
  selector: 'kgi-id-confirm-demo',
  standalone: true,
  imports: [KgiModal, KgiSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .stack { display: flex; flex-direction: column; gap: var(--spacing-16); align-items: flex-start; }
    .mode { display: flex; flex-wrap: wrap; gap: var(--spacing-8); }
    .mode button { padding: var(--spacing-4) var(--spacing-12); border: 1px solid var(--color-container-general-input-line); border-radius: var(--radius-full); background: var(--color-container-card-white); }
    .mode button[aria-pressed='true'] { background: var(--color-container-general-option-selected-blue); border-color: var(--color-content-general-active); color: var(--color-content-general-active); }
    .form { display: flex; flex-direction: column; gap: var(--spacing-24); }
    .group { display: flex; flex-direction: column; gap: var(--spacing-8); }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-24); }
  `,
  template: `
    <div class="stack">
      <!-- 預覽用：在任何視窗大小切換手機 / 桌面。正式專案不需要這一塊 -->
      <div class="mode" role="group" aria-label="預覽模式">
        @for (m of modes; track m.label) {
          <button type="button" class="t-body-regular" [attr.aria-pressed]="viewport.override() === m.key" (click)="viewport.override.set(m.key)">{{ m.label }}</button>
        }
      </div>
      <p class="t-caption-regular c-content-general-secondary">
        目前：{{ viewport.isDesktop() ? '桌面版：置中 Dialog，點下拉在欄位下方展開選項' : '手機版：底部彈窗，點下拉換成選項列表' }}
      </p>
      <button type="button" class="btn-capsule t-body-regular" (click)="open.set(true)">確認證件資料</button>
    </div>

    <!-- 這就是工程師要寫的全部：一份表單，不分手機 / 桌面 -->
    <kgi-modal [open]="open()" title="確認證件資料" fullHeight (closed)="open.set(false)">
      <div class="form">
        <div class="group">
          <p class="t-body-bold c-content-general-primary">戶籍地址</p>
          <div class="pair">
            <kgi-select [options]="cities" [(value)]="city" />
            <kgi-select [options]="districts" [(value)]="district" />
          </div>
          <div class="field">
            <p class="t-subtitle-regular c-content-general-primary">葫蘆里1鄰民權東路六段238巷165弄218號</p>
            <span class="field__line"></span>
          </div>
        </div>
        <kgi-select label="出生國家" [options]="countries" [(value)]="country" />
        <kgi-select label="出生城市" [options]="birthCities" [(value)]="birthCity" />
        <div class="field">
          <p class="t-body-bold c-content-general-primary">發證日期</p>
          <p class="t-subtitle-regular c-content-general-primary">2025/10/10</p>
          <span class="field__line"></span>
        </div>
        <kgi-select label="發證地點" [options]="cities" [(value)]="place" />
        <kgi-select label="發證類型" [options]="idTypes" [(value)]="idType" />
      </div>
      <button kgiModalFooter type="button" class="btn-primary t-subtitle-bold" (click)="open.set(false)">下一步</button>
    </kgi-modal>
  `,
})
export class IdConfirmDemoComponent {
  protected readonly viewport = inject(KgiViewport);
  protected readonly modes = MODES;
  protected readonly open = signal(false);

  protected readonly cities = CITY;
  protected readonly districts = DISTRICT;
  protected readonly countries = COUNTRY;
  protected readonly birthCities = BIRTH_CITY;
  protected readonly idTypes = ID_TYPE;

  protected readonly city = signal('北市');
  protected readonly district = signal('內湖區');
  protected readonly country = signal('中華民國');
  protected readonly birthCity = signal('台北市');
  protected readonly place = signal('北市');
  protected readonly idType = signal(''); // 一開始沒有值，選完才看得出「帶入」
}
