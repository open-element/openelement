/** @jsxImportSource @openelement/element */
import { element, OpenElement, property } from '@openelement/element';
import { addSource, listSources, syncSource } from '../app/api.ts';
import { loadSettings, saveSettings } from '../app/storage.ts';
import { pdfMaxWidth } from '../app/pdf-measure.ts';
import type { ReaderSettings, ReaderSource } from '../app/types.ts';

function applyTheme(theme: string): void {
  if (theme === 'dark' || theme === 'sepia') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function applyFontSize(size: number): void {
  document.documentElement.style.setProperty('--reader-font-size', `${size}px`);
}

function applyLineHeight(lh: number): void {
  document.documentElement.style.setProperty('--reader-line-height', String(lh));
}

function applyMeasure(chars: number): void {
  document.documentElement.style.setProperty('--reader-measure', `${chars}ch`);
  document.documentElement.style.setProperty(
    '--reader-pdf-max-width',
    `${pdfMaxWidth(chars)}px`,
  );
}

export interface SettingsData extends ReaderSettings {
  sources: ReaderSource[];
}

export async function loader(): Promise<SettingsData> {
  return { ...loadSettings(), sources: await listSources() };
}

async function addAndSyncSource(
  formData: FormData,
): Promise<{ source: ReaderSource; synced: number }> {
  const kind = String(formData.get('kind') ?? 'local');
  const label = String(formData.get('label') ?? '').trim();
  const root = String(formData.get('root') ?? '').trim();
  const repo = String(formData.get('repo') ?? '').trim();
  const branch = String(formData.get('branch') ?? 'main').trim();
  const path = String(formData.get('path') ?? '').trim();
  const source = await addSource({
    kind: kind === 'github' ? 'github' : 'local',
    label,
    root: root || undefined,
    repo: repo || undefined,
    branch: branch || undefined,
    path: path || undefined,
  });
  const result = await syncSource(source.id);
  return { source, synced: result.books.length };
}

export async function action(
  ctx: { formData?: FormData },
): Promise<{ added?: string; synced?: number; error?: string }> {
  try {
    const { source, synced } = await addAndSyncSource(ctx.formData ?? new FormData());
    return { added: source.id, synced };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export const tagName = 'reader-settings';

@element('reader-settings', { root: 'shadow-open' })
export default class SettingsPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  folderPickerError = '';

  async pickLocalFolder(): Promise<void> {
    this.folderPickerError = '';
    try {
      const res = await fetch('/api/dialog/directory', { method: 'POST' });
      const body = await res.json() as { path?: string; error?: string };
      if (!res.ok || !body.path) {
        this.folderPickerError = body.error || '没有选择文件夹。';
        return;
      }
      const rootInput = this.shadowRoot?.querySelector<HTMLInputElement>('input[name="root"]');
      const kindSelect = this.shadowRoot?.querySelector<HTMLSelectElement>('select[name="kind"]');
      const labelInput = this.shadowRoot?.querySelector<HTMLInputElement>('input[name="label"]');
      if (kindSelect) kindSelect.value = 'local';
      if (rootInput) rootInput.value = body.path;
      if (labelInput && !labelInput.value.trim()) {
        labelInput.value = body.path.split('/').filter(Boolean).at(-1) || '本地书源';
      }
    } catch (err) {
      this.folderPickerError = err instanceof Error ? err.message : String(err);
    }
  }

  render() {
    const current = (this as unknown) as SettingsPage & SettingsData;
    const actionData = (this as unknown as {
      actionData?: { added?: string; synced?: number; error?: string };
    })
      .actionData;

    if (current.theme) applyTheme(current.theme);
    if (current.fontSize) applyFontSize(current.fontSize);
    if (current.lineHeight) applyLineHeight(current.lineHeight);
    if (current.measure) applyMeasure(current.measure);

    return (
      <main class='reader-main'>
        <div class='page-header'>
          <div class='page-header-text'>
            <h1>设置</h1>
            <p>管理阅读偏好和书源</p>
          </div>
        </div>

        {actionData?.added && (
          <p class='toast-inline'>
            书源已添加并同步：{actionData.added}
            {typeof actionData.synced === 'number' ? ` · ${actionData.synced} 本` : ''}
          </p>
        )}
        {actionData?.error && <p class='form-error'>{actionData.error}</p>}
        {this.folderPickerError && <p class='form-error'>{this.folderPickerError}</p>}

        <section class='settings-section'>
          <h3>书源管理</h3>
          <div class='source-list'>
            {(current.sources || []).map((source) => (
              <div class='source-row' key={source.id}>
                <div>
                  <strong>{source.label}</strong>
                  <small>
                    {source.kind}
                    {source.repo ? ` · ${source.repo}` : ''}
                    {source.root ? ` · ${source.root}` : ''}
                  </small>
                </div>
                <sync-status-island source-id={source.id} />
              </div>
            ))}
          </div>
          <form class='source-form'>
            <label>
              类型
              <select name='kind' class='settings-select'>
                <option value='local'>本地文件夹</option>
                <option value='github'>GitHub 仓库</option>
              </select>
            </label>
            <label>
              名称
              <input name='label' placeholder='研究论文' />
            </label>
            <label>
              本地路径
              <input name='root' placeholder='/Users/me/Documents/papers' />
              <small class='field-hint'>提交后会递归读取该文件夹内的 PDF。</small>
            </label>
            <div class='source-form-tools'>
              <span class='field-label'>本地文件夹</span>
              <open-button
                type='button'
                class='source-pick-button'
                variant='ghost'
                onClick={this.pickLocalFolder}
              >
                选择文件夹
              </open-button>
            </div>
            <label>
              GitHub 仓库
              <input name='repo' placeholder='owner/repo' />
            </label>
            <label>
              分支
              <input name='branch' value='main' />
            </label>
            <label>
              仓库路径
              <input name='path' placeholder='books' />
            </label>
            <open-button type='submit' class='source-submit' variant='primary'>
              添加书源
            </open-button>
          </form>
        </section>

        <div class='settings-grid'>
          <section class='settings-section'>
            <h3>主题</h3>
            <div class='theme-options'>
              {(['light', 'dark', 'sepia'] as const).map((theme) => (
                <button
                  type='button'
                  class={`theme-option ${current.theme === theme ? 'active' : ''}`}
                  key={theme}
                  onClick={() => {
                    applyTheme(theme);
                    const s: ReaderSettings = { ...loadSettings(), theme };
                    saveSettings(s);
                  }}
                >
                  <span class={`theme-option-swatch ${theme}`} />
                  {theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '护眼'}
                </button>
              ))}
            </div>
          </section>

          <section class='settings-section'>
            <h3>字号</h3>
            <div class='settings-row'>
              <input
                type='range'
                min='12'
                max='24'
                step='1'
                value={String(current.fontSize)}
                class='settings-slider'
                onInput={(e: Event) => {
                  const value = parseInt((e.target as HTMLInputElement).value, 10);
                  applyFontSize(value);
                  const display = (e.target as HTMLInputElement).nextElementSibling;
                  if (display) display.textContent = String(value);
                  const s: ReaderSettings = { ...loadSettings(), fontSize: value };
                  saveSettings(s);
                }}
              />
              <span class='settings-value'>{current.fontSize}px</span>
            </div>
          </section>

          <section class='settings-section'>
            <h3>行高</h3>
            <select
              class='settings-select'
              onChange={(e: Event) => {
                const value = parseFloat((e.target as HTMLSelectElement).value);
                applyLineHeight(value);
                const s: ReaderSettings = { ...loadSettings(), lineHeight: value };
                saveSettings(s);
              }}
            >
              {[1.4, 1.6, 1.8].map((lh) => (
                <option
                  key={lh}
                  value={String(lh)}
                  selected={current.lineHeight === lh}
                >
                  {lh}
                </option>
              ))}
            </select>
          </section>

          <section class='settings-section'>
            <h3>阅读宽度</h3>
            <select
              class='settings-select'
              onChange={(e: Event) => {
                const value = parseInt((e.target as HTMLSelectElement).value, 10);
                applyMeasure(value);
                const s: ReaderSettings = { ...loadSettings(), measure: value };
                saveSettings(s);
              }}
            >
              {[55, 65, 75].map((chars) => (
                <option
                  key={chars}
                  value={String(chars)}
                  selected={current.measure === chars}
                >
                  {chars} 字符
                </option>
              ))}
            </select>
          </section>
        </div>
      </main>
    );
  }
}
