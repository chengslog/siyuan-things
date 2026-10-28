import type { NotesCodec } from './nativeNotes.ts';
import { lexer } from 'marked';

type Cell = Record<string, any>;
export interface RichNotesAlias { source: string; fingerprint: string }
interface ImageMarker { id: string; href: string; raw: string; label: string }
interface PendingPair { text: string; assets: string; source: string }
export interface RichNotesState { version: 1; aliases: RichNotesAlias[]; images?: ImageMarker[]; pending?: { before: PendingPair; after: PendingPair } }
export interface RichNotesPlan { cell: Cell; assets: Cell; state: RichNotesState }
const BLOCKS = new Set(['NodeParagraph', 'NodeHeading', 'NodeList', 'NodeListItem', 'NodeBlockquote', 'NodeCodeBlock', 'NodeMathBlock']);
const EXECUTABLE = new Set(['abc', 'echarts', 'flowchart', 'graphviz', 'infographic', 'mermaid', 'plantuml']);

export class RichNotesUnsupportedError extends Error {
  constructor(detail = '') { super(`此备注包含思源数据库富文本暂不支持的内容${detail ? `（${detail}）` : ''}，未保存；请保留原内容`); this.name = 'RichNotesUnsupportedError'; }
}

function hostCodec(): NotesCodec {
  const host = globalThis as any, factory = host.Lute || host.window?.Lute;
  if (!factory?.New) throw new Error('思源 Markdown 引擎尚未就绪，无法安全读写富文本备注');
  const codec = factory.New();
  // Match the fixed grammar of kernel/av/value.go:newValueTextRichLute.
  const enabled = ['SetTextMark', 'SetProtyleWYSIWYG', 'SetBlockRef', 'SetFileAnnotationRef', 'SetKramdownIAL',
    'SetHTMLTag2TextMark', 'SetSuperBlock', 'SetCustomBlock', 'SetImgPathAllowSpace', 'SetGitConflict',
    'SetInlineAsterisk', 'SetInlineUnderscore', 'SetSup', 'SetSub', 'SetTag', 'SetInlineMath',
    'SetGFMStrikethrough', 'SetFullWidthStrikethrough', 'SetMark', 'SetInlineMathAllowDigitAfterOpenMarker',
    'SetParagraphBeginningSpace', 'SetSanitize', 'SetCallout', 'SetDataTask', 'SetArbitraryTaskListItemMarker', 'SetEnsureListItemParagraph'];
  const disabled = ['SetEmoji', 'SetGFMStrikethrough1', 'SetFootnotes', 'SetToC', 'SetIndentCodeBlock',
    'SetAutoSpace', 'SetHeadingID', 'SetSetext', 'SetYamlFrontMatter', 'SetLinkRef', 'SetCodeSyntaxHighlight', 'SetExportNormalizeTaskListMarker'];
  for (const method of enabled) codec[method]?.(true);
  for (const method of disabled) codec[method]?.(false);
  codec.SetUnorderedListMarker?.('-');
  return codec;
}

/** Rewrite only parsed inline nodes. Code spans/fences and literal HTML are never searched as images. */
function transform(source: string, rewrite: (token: any) => string | undefined): string {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (tokens: any[], start: number, end: number) => {
    let cursor = start;
    for (const token of tokens) {
      if (!token.raw) continue;
      const at = source.indexOf(token.raw, cursor);
      if (at < 0 || at + token.raw.length > end) {
        // Quoted multiline token raw values may omit their line prefixes. Refuse ambiguous
        // image placement instead of accidentally rewriting an earlier code example.
        if (JSON.stringify(token).includes('"type":"image"')) throw new RichNotesUnsupportedError('图片的嵌套 Markdown 位置无法确认');
        continue;
      }
      cursor = at + token.raw.length;
      const replacement = rewrite(token);
      if (replacement !== undefined) { edits.push({ start: at, end: cursor, text: replacement }); continue; }
      if (['code', 'codespan', 'html'].includes(token.type)) continue;
      if (Array.isArray(token.items)) visit(token.items, at, cursor);
      else if (Array.isArray(token.tokens)) visit(token.tokens, at, cursor);
    }
  };
  visit(lexer(source), 0, source.length);
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

const escapeLabel = (value: string) => value.replace(/[\\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ');
const destination = (value: string) => `<${value.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/[\r\n]/g, '')}>`;
function imageId(raw: string, index: number): string {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(raw)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return `${hash.toString(36)}-${index}`;
}
function assetsValue(cell?: Cell): any[] {
  const items = cell?.mAsset ?? [];
  if (!Array.isArray(items) || items.some(item => !item || !['image', 'file'].includes(item.type) || typeof item.content !== 'string' || (item.name !== undefined && typeof item.name !== 'string'))) throw new Error('数据库备注图片字段损坏');
  return items.map(item => ({ type: item.type, content: item.content, name: item.name || '' }));
}

/** Database rich text is authoritative. Aliases retain original Markdown formatting only while
 * the parsed rich source still matches; a native edit (including style-only edits) invalidates it. */
export class RichNotes {
  private readonly makeCodec: () => NotesCodec;
  constructor(makeCodec: () => NotesCodec = hostCodec) { this.makeCodec = makeCodec; }

  private dom(source: string): { codec: NotesCodec; dom: string } {
    const codec = this.makeCodec();
    if (!codec.BlockDOM2Md) throw new Error('思源 Markdown 引擎不支持富文本备注');
    return { codec, dom: codec.Md2BlockDOM(source) };
  }

  private validateText(source: string): void {
    const { dom } = this.dom(source);
    for (const match of dom.matchAll(/data-type="(Node[^"]+)"/g)) if (!BLOCKS.has(match[1])) throw new RichNotesUnsupportedError(match[1]);
    // AV rich cells intentionally exclude images (ordinary table rich cells use a different grammar).
    if (/<img\b|data-type="(?:img|iframe|audio|video)"/i.test(dom)) throw new RichNotesUnsupportedError('图片或嵌入媒体');
    for (const match of source.matchAll(/^\s*(`{3,}|~{3,})\s*([^\s`]*)/gm)) if (EXECUTABLE.has(match[2].toLowerCase())) throw new RichNotesUnsupportedError('可执行图表');
    if (/data-href="(?:javascript|data|file):/i.test(dom)) throw new RichNotesUnsupportedError('链接格式');
  }

  private split(source: string): { text: string; assets: any[]; images: ImageMarker[]; links: Set<string> } {
    const assets: any[] = [], images: ImageMarker[] = [], links = new Set<string>();
    const text = transform(source, token => {
      if (token.type === 'link') links.add(token.href);
      if (token.type !== 'image') return undefined;
      const id = imageId(token.raw, images.length), href = token.href;
      if (typeof href !== 'string' || !href || /^(?:javascript|data|file):/i.test(href) || /[\\\x00-\x1f]/.test(href)) throw new RichNotesUnsupportedError('图片地址');
      images.push({ id, href, raw: token.raw, label: `🖼 ${token.text || '图片'}` });
      if (!assets.some(item => item.content === href)) assets.push({ type: 'image', content: href, name: token.text || '图片' });
      return `[🖼 ${escapeLabel(token.text || '图片')}](${destination(href)} "things-image:${id}")`;
    });
    this.validateText(text);
    return { text, assets, images, links };
  }

  validate(source: string): void { this.split(source); }

  fingerprint(source: string): string {
    // Block identities are document-local and are not retained as database block identities.
    // All content and inline styling remain in the canonical Kramdown used for comparison.
    let next = source, previous = '';
    for (let pass = 0; pass < 4; pass++) {
      const { codec, dom } = this.dom(next);
      next = codec.BlockDOM2Md!(dom.replace(/\s(?:data-node-id|data-node-index|updated)="[^"]*"/g, '')).trim();
      if (next === previous) return next;
      previous = next;
    }
    throw new RichNotesUnsupportedError('富文本规范化未收敛');
  }

  private encodeText(source: string): Cell {
    return source ? { type: 'text', text: { content: '', rich: { spec: 1, format: 'kramdown', content: source } } }
      : { type: 'text', text: { content: '', rich: null } };
  }

  raw(cell: Cell | undefined): string {
    const rich = cell?.text?.rich;
    if (rich != null) {
      if (rich.spec !== 1 || rich.format !== 'kramdown' || typeof rich.content !== 'string') throw new Error('数据库富文本备注格式不受支持');
      return rich.content;
    }
    return cell?.text?.content ?? '';
  }

  private textFingerprint(cell: Cell | undefined): string {
    const raw = this.raw(cell);
    return JSON.stringify([raw ? !!cell?.text?.rich : false, this.fingerprint(raw)]);
  }

  private combinedFingerprint(cell: Cell | undefined, assets?: Cell): string {
    return JSON.stringify([this.textFingerprint(cell), assetsValue(assets)]);
  }

  read(cell: Cell | undefined, assets?: Cell, state?: RichNotesState, allowPending = false): string {
    const raw = this.raw(cell);
    if (state !== undefined && (state?.version !== 1 || !Array.isArray(state.aliases) || state.aliases.length > 2 ||
      state.aliases.some(alias => typeof alias.source !== 'string' || typeof alias.fingerprint !== 'string') ||
      (state.images !== undefined && (!Array.isArray(state.images) || state.images.some(image => !image || ['id', 'href', 'raw', 'label'].some(key => typeof (image as any)[key] !== 'string')))))) throw new Error('富文本备注格式记录损坏');
    if (state?.pending) {
      const { before, after } = state.pending;
      if (![before, after].every(pair => pair && ['text', 'assets', 'source'].every(key => typeof (pair as any)[key] === 'string'))) throw new Error('富文本备注恢复记录损坏');
      const text = this.textFingerprint(cell), imageList = JSON.stringify(assetsValue(assets));
      if (![before.text, after.text].includes(text) || ![before.assets, after.assets].includes(imageList)) throw new Error('富文本备注写入期间发生原生编辑，请保留恢复记录并检查');
      if (text !== after.text || imageList !== after.assets) {
        if (!allowPending) throw new Error('Things 富文本备注写入尚未完成，请重试原操作或恢复迁移');
        return before.source;
      }
    }
    const fingerprint = this.combinedFingerprint(cell, assets);
    const alias = state?.aliases.find(item => item.fingerprint === fingerprint);
    if (alias) {
      const expected = this.split(alias.source);
      expected.assets.push(...assetsValue(assets).filter(item => item.type === 'file' && expected.links.has(item.content)));
      if (this.combinedFingerprint(this.encodeText(expected.text), { mAsset: expected.assets }) === fingerprint) return alias.source;
    }
    const items = assetsValue(assets), consumed = new Set<string>();
    // Kernel normalizes links to text-mark spans; the standard export exposes their marker titles.
    const codec = this.makeCodec();
    const markdown = cell?.text?.rich ? codec.BlockDOM2StdMd(codec.Md2BlockDOM(raw)).trimEnd() : raw;
    let result = transform(markdown, token => {
      if (token.type !== 'link' || !token.title?.startsWith('things-image:')) return undefined;
      const marker = state?.images?.find(item => `things-image:${item.id}` === token.title && item.href === token.href);
      if (!marker) return undefined;
      if (!items.some(item => item.type === 'image' && item.content === marker.href)) return '';
      consumed.add(marker.href);
      return token.text === marker.label ? marker.raw : `![${escapeLabel(token.text.replace(/^🖼\s*/, ''))}](${destination(marker.href)})`;
    });
    for (const item of items) if (!consumed.has(item.content)) {
      const link = `${item.type === 'image' ? '!' : ''}[${escapeLabel(item.name || (item.type === 'image' ? '图片' : '附件'))}](${destination(item.content)})`;
      result += `${result ? '\n\n' : ''}${link}`;
      consumed.add(item.content);
    }
    return result;
  }

  prepare(source: string, previousCell?: Cell, previousAssets?: Cell, previousState?: RichNotesState): RichNotesPlan {
    const split = this.split(source), cell = this.encodeText(split.text);
    // A native file attachment is surfaced as an ordinary link. Keep its attachment cell while
    // that link remains, and allow removing it by deleting the link from the note.
    split.assets.push(...assetsValue(previousAssets).filter(item => item.type === 'file' && split.links.has(item.content)));
    const assets = { type: 'mAsset', mAsset: split.assets };
    const aliases: RichNotesAlias[] = [{ source, fingerprint: this.combinedFingerprint(cell, assets) }];
    if (previousCell) {
      const previous = this.read(previousCell, previousAssets, previousState, true), fingerprint = this.combinedFingerprint(previousCell, previousAssets);
      if (fingerprint !== aliases[0].fingerprint) aliases.push({ source: previous, fingerprint });
    }
    const images = [...split.images];
    const previousRaw = this.raw(previousCell);
    for (const marker of previousState?.images || []) if (previousRaw.includes(`things-image:${marker.id}`) && !images.some(item => item.id === marker.id)) images.push(marker);
    return { cell, assets, state: { version: 1, aliases, images } };
  }

  same(left: Cell | undefined, right: Cell | undefined): boolean {
    return this.textFingerprint(left) === this.textFingerprint(right);
  }

  reservation(plan: RichNotesPlan, previousCell?: Cell, previousAssets?: Cell, previousState?: RichNotesState): RichNotesState {
    const pair = (cell: Cell | undefined, assets: Cell | undefined, source: string): PendingPair => ({ text: this.textFingerprint(cell), assets: JSON.stringify(assetsValue(assets)), source });
    return { ...plan.state, pending: {
      before: pair(previousCell, previousAssets, this.read(previousCell, previousAssets, previousState, true)),
      after: pair(plan.cell, plan.assets, plan.state.aliases[0].source),
    } };
  }
}
