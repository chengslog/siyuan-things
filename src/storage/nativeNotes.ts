import { newSiyuanId, type ApiRequest } from './avClient.ts';

export interface NotesCodec {
  Md2BlockDOM(markdown: string): string;
  BlockDOM2StdMd(dom: string): string;
  BlockDOM2Md?(dom: string): string;
}
type Element = { tag: string; attrs: Record<string, string>; children: Array<Element | string> };
type Operation = { action: string; id?: string; data?: string | Record<string, unknown>; parentID?: string; previousID?: string; nextID?: string };
export interface NotesIntent { desired: string; operations: Operation[]; states: string[] }
interface NotesState { version: 1; original: string; fingerprint: string; intent?: NotesIntent }
export interface NotesRead { text: string; fingerprint: string; pending: boolean }
const STATE = 'custom-things-notes-v1';
const BLOCK_ID = /^\d{14}-[a-z0-9]{7}$/;
const SUPPORTED = new Set(['NodeParagraph', 'NodeHeading', 'NodeList', 'NodeListItem', 'NodeBlockquote', 'NodeCodeBlock', 'NodeMathBlock', 'NodeThematicBreak']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescape = (value: string): string => value.replace(/&(?:amp|quot|lt|gt|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
  const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&apos;': "'" };
  return named[entity.toLowerCase()] ?? String.fromCodePoint(entity[2]?.toLowerCase() === 'x' ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10));
});
const block = (node: Element | string): boolean => typeof node !== 'string' && !!node.attrs['data-node-id'];
const blocks = (node: Element): Element[] => node.children.filter((child): child is Element => typeof child !== 'string' && block(child));
const idOf = (node: Element): string => node.attrs['data-node-id'];

export class NotesConflictError extends Error {
  constructor(detail = '') { super(`备注已在其他位置改变，请刷新后重试${detail ? `（${detail}）` : ''}`); this.name = 'NotesConflictError'; }
}
export class NativeNotesUnsupportedError extends Error {
  constructor() { super('该备注包含无法安全映射的原生结构，请在思源备注文档中编辑，以保留块引用和属性'); this.name = 'NativeNotesUnsupportedError'; }
}

/** Parse only Lute/kernel-generated block DOM. Never execute it or attach it to the application DOM. */
function parse(dom: string): Element[] {
  const root: Element = { tag: '', attrs: {}, children: [] }, stack = [root];
  const tokens = dom.match(/<!--[\s\S]*?-->|<\/?[A-Za-z](?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+|</g) || [];
  for (const token of tokens) {
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('</')) {
      const tag = token.slice(2).match(/^[\w:-]+/)?.[0].toLowerCase();
      if (stack.length === 1 || stack[stack.length - 1].tag !== tag) throw new Error('备注块 DOM 结构无效');
      stack.pop(); continue;
    }
    const match = token.match(/^<([\w:-]+)\b([\s\S]*?)\/?\s*>$/);
    if (!match) { stack[stack.length - 1].children.push(token); continue; }
    const node: Element = { tag: match[1].toLowerCase(), attrs: {}, children: [] };
    for (const attr of match[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.attrs[attr[1]] = unescape(attr[2] ?? attr[3] ?? attr[4] ?? '');
    stack[stack.length - 1].children.push(node);
    if (!VOID.has(node.tag) && !token.endsWith('/>')) stack.push(node);
  }
  if (stack.length !== 1 || root.children.some((node) => typeof node === 'string' ? !!node.trim() : !block(node))) throw new Error('备注块 DOM 结构无效');
  return blocks(root);
}

function html(node: Element | string): string {
  if (typeof node === 'string') return node;
  const open = `<${node.tag}${Object.entries(node.attrs).map(([name, value]) => ` ${name}="${escape(value)}"`).join('')}>`;
  return VOID.has(node.tag) ? open : `${open}${node.children.map(html).join('')}</${node.tag}>`;
}

function walk(node: Element, visit: (node: Element) => void): void {
  visit(node); for (const child of node.children) if (typeof child !== 'string') walk(child, visit);
}

function codecFromHost(): NotesCodec {
  const host = globalThis as any;
  const factory = host.Lute || host.window?.Lute;
  if (!factory?.New) throw new Error('思源 Markdown 引擎尚未就绪，无法安全读写复杂备注，请稍后重试');
  const codec = factory.New();
  for (const method of ['SetBlockRef', 'SetKramdownIAL', 'SetTag', 'SetMark', 'SetInlineMath', 'SetHTMLTag2TextMark']) codec[method]?.(true);
  return codec;
}

function stateFrom(attrs: any): NotesState | undefined {
  if (!attrs?.[STATE]) return undefined;
  let state: NotesState;
  try {
    const value = attrs[STATE];
    const decoded = value.startsWith('b64:') ? new TextDecoder().decode(Uint8Array.from(atob(value.slice(4)), (char) => char.charCodeAt(0))) : value;
    state = JSON.parse(decoded);
  } catch { throw new Error('备注恢复记录损坏'); }
  if (state.version !== 1 || typeof state.original !== 'string' || typeof state.fingerprint !== 'string' ||
    (state.intent && (typeof state.intent.desired !== 'string' || !Array.isArray(state.intent.operations) || !Array.isArray(state.intent.states) || state.intent.states.length !== state.intent.operations.length + 1))) {
    throw new Error('备注恢复记录格式无效');
  }
  return state;
}

/** Native documents are the source of truth. The exact source text is a formatting alias,
 * valid only while the native content/IDs/attributes still match its recorded fingerprint. */
export class NativeNotes {
  private readonly request: ApiRequest;
  private readonly makeCodec: () => NotesCodec;
  constructor(request: ApiRequest, makeCodec: () => NotesCodec = codecFromHost) { this.request = request; this.makeCodec = makeCodec; }

  /** createDocWithMd retains explicit IAL IDs, so a copied note must receive new block identities. */
  async prepareCreateMarkdown(original: string): Promise<string> {
    const codec = this.makeCodec();
    if (!codec.BlockDOM2Md) throw new Error('思源 Markdown 引擎不支持保留属性的安全备注导入');
    const nodes = parse(codec.Md2BlockDOM(original)), ids: string[] = [];
    for (const root of nodes) walk(root, node => {
      if (block(node)) { const id = newSiyuanId(); node.attrs['data-node-id'] = id; ids.push(id); }
    });
    if (ids.length) {
      const found = await this.request('/api/block/checkBlocksExist', { ids });
      if (!found || typeof found !== 'object' || ids.some(id => found[id] !== false)) throw new NotesConflictError('新建备注块身份已被占用');
    }
    return codec.BlockDOM2Md(nodes.map(html).join(''));
  }

  private fingerprint(nodes: Element[], codec: NotesCodec): string {
    const structure = (node: Element | string): any => typeof node === 'string' ? unescape(node) : {
      tag: node.tag,
      attrs: Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !['updated', 'data-node-index'].includes(key)).sort(([a], [b]) => a.localeCompare(b))),
      children: node.children.map(structure),
    };
    const value = (node: Element): any => ({
      attrs: Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !['updated', 'data-node-index'].includes(key)).sort(([a], [b]) => a.localeCompare(b))),
      markdown: codec.BlockDOM2StdMd(html(node)).trimEnd(), structure: structure(node),
    });
    return JSON.stringify(nodes.map(value));
  }

  private async inspect(docId: string): Promise<{ nodes: Element[]; fingerprint: string; text: string; attrs: any; state?: NotesState }> {
    if (!BLOCK_ID.test(docId)) throw new Error('Things 备注文档 ID 无效');
    const codec = this.makeCodec();
    const attrs = await this.request('/api/attr/getBlockAttrs', { id: docId });
    const result = await this.request('/api/block/getBlockDOM', { id: docId });
    if (typeof result?.dom !== 'string') throw new Error('备注文档读取失败，不能替换为空备注');
    const nodes = parse(result.dom);
    const fingerprint = this.fingerprint(nodes, codec);
    return { nodes, fingerprint, text: codec.BlockDOM2StdMd(result.dom).trimEnd(), attrs, state: stateFrom(attrs) };
  }

  async read(docId: string, allowPending = false): Promise<NotesRead> {
    const current = await this.inspect(docId), { state } = current;
    if (state?.intent) {
      const index = state.intent.states.indexOf(current.fingerprint);
      if (index < 0) throw new NotesConflictError('未完成操作与原文冲突');
      if (!allowPending) throw new Error('备注写入尚未完成，请重试原操作');
      return { text: index === state.intent.operations.length ? state.intent.desired : state.original, fingerprint: current.fingerprint, pending: true };
    }
    return { text: state?.fingerprint === current.fingerprint ? state.original : current.text, fingerprint: current.fingerprint, pending: false };
  }

  /** Adopt a document just created from a persisted import intent; no user content is rewritten. */
  async initialize(docId: string, original: string, owner: string, record: string): Promise<void> {
    const current = await this.inspect(docId), codec = this.makeCodec();
    this.assertOwner(current.attrs, owner, record);
    if (current.state) {
      const read = await this.read(docId, true);
      if (read.text !== original || read.pending) throw new NotesConflictError('导入备注');
      return;
    }
    const expected = codec.BlockDOM2StdMd(codec.Md2BlockDOM(original)).trimEnd();
    if (current.text !== expected) throw new NotesConflictError('导入正文校验');
    await this.persist(docId, { version: 1, original, fingerprint: current.fingerprint });
    if ((await this.inspect(docId)).fingerprint !== current.fingerprint) throw new NotesConflictError('初始化时原文改变');
  }

  /** Compare the real native body to the source; this intentionally ignores the original-text alias. */
  async verifyCanonical(docId: string, original: string): Promise<void> {
    const current = await this.inspect(docId), codec = this.makeCodec();
    if (current.text !== codec.BlockDOM2StdMd(codec.Md2BlockDOM(original)).trimEnd()) throw new NotesConflictError('原生正文与源文本不一致');
  }

  private assertOwner(attrs: any, owner: string, record: string): void {
    if (attrs?.['custom-things-owner'] !== owner || attrs?.['custom-things-record'] !== record) throw new Error('备注文档不属于此 Things 记录，请在思源原文中编辑');
  }

  private async persist(docId: string, state: NotesState): Promise<void> {
    // Kernel attribute APIs HTML-decode values. Encoding prevents literal Markdown/DOM entities
    // (and the exact original whitespace) from changing inside a persisted recovery operation.
    const bytes = new TextEncoder().encode(JSON.stringify(state));
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.slice(offset, offset + 16384));
    const serialized = `b64:${btoa(binary)}`;
    await this.request('/api/attr/setBlockAttrs', { id: docId, attrs: { [STATE]: serialized } });
    const attrs = await this.request('/api/attr/getBlockAttrs', { id: docId });
    if (attrs?.[STATE] !== serialized) throw new Error('备注恢复记录保存后校验失败');
  }

  /** Match unchanged blocks globally (including moves), then changed blocks by type and order. */
  private preserve(before: Element[], after: Element[], codec: NotesCodec): Element[] {
    const used = new Set<number>(), matches = new Map<number, number>();
    const signature = (node: Element) => `${node.attrs['data-type']}:${codec.BlockDOM2StdMd(html(node)).trimEnd()}`;
    for (let j = 0; j < after.length; j++) {
      const i = before.findIndex((node, index) => !used.has(index) && signature(node) === signature(after[j]));
      if (i >= 0) { matches.set(j, i); used.add(i); }
    }
    for (let j = 0; j < after.length; j++) if (!matches.has(j)) {
      const i = before.findIndex((node, index) => !used.has(index) && node.attrs['data-type'] === after[j].attrs['data-type']);
      if (i >= 0) { matches.set(j, i); used.add(i); }
    }
    const remainingOld = before.map((_, index) => index).filter(index => !used.has(index));
    const remainingNew = after.map((_, index) => index).filter(index => !matches.has(index));
    // An explicit one-for-one conversion (e.g. paragraph -> heading) is still the same block.
    // Unequal unmatched runs stay insertion/deletion operations because their mapping is ambiguous.
    if (remainingOld.length === remainingNew.length) remainingNew.forEach((index, position) => matches.set(index, remainingOld[position]));
    return after.map((node, index) => {
      const old = before[matches.get(index) ?? -1];
      if (!old) return clone(node);
      if (signature(old) === signature(node)) return clone(old);
      const next = clone(node), mapped = this.preserve(blocks(old), blocks(next), codec);
      let childIndex = 0;
      next.children = next.children.map((child) => block(child) ? mapped[childIndex++] : child);
      next.attrs = { ...old.attrs, ...next.attrs, 'data-node-id': idOf(old) };
      for (const [field, value] of Object.entries(old.attrs)) {
        if (field.startsWith('custom-') || ['style', 'fold', 'name', 'alias', 'memo', 'bookmark'].includes(field)) next.attrs[field] = value;
      }
      // These attributes encode user-requested structure; all custom attributes stay on the old ID.
      for (const field of ['data-subtype', 'data-marker', 'data-content']) {
        if (node.attrs[field] !== undefined) next.attrs[field] = node.attrs[field]; else delete next.attrs[field];
      }
      return next;
    });
  }

  private plan(docId: string, before: Element[], markdown: string): NotesIntent {
    const codec = this.makeCodec();
    let requested = parse(codec.Md2BlockDOM(markdown));
    if (!requested.length) requested = [{ tag: 'div', attrs: { 'data-node-id': newSiyuanId(), 'data-type': 'NodeParagraph', class: 'p' },
      children: [{ tag: 'div', attrs: { contenteditable: 'true', spellcheck: 'false' }, children: [] }, { tag: 'div', attrs: { class: 'protyle-attr', contenteditable: 'false' }, children: ['\u200b'] }] }];
    // Pasted Markdown may carry somebody else's IAL IDs. Only IDs matched to this document
    // may survive; all genuinely new blocks receive fresh IDs before the intent is persisted.
    for (const root of requested) walk(root, node => { if (block(node)) node.attrs['data-node-id'] = newSiyuanId(); });
    for (const root of [...before, ...requested]) walk(root, (node) => {
      if (block(node) && (!SUPPORTED.has(node.attrs['data-type']) || !BLOCK_ID.test(idOf(node)))) throw new NativeNotesUnsupportedError();
      // Markdown cannot faithfully represent arbitrary native inline formatting/annotations.
      if (!block(node) && (Object.keys(node.attrs).some((key) => key.startsWith('custom-')) ||
        (node.attrs.style && !(node.attrs.contenteditable === 'true' && node.attrs.style.replace(/\s/g, '') === 'flex:1')))) throw new NativeNotesUnsupportedError();
    });
    const desired = this.preserve(before, requested, codec), working = clone(before);
    const operations: Operation[] = [], states = [this.fingerprint(working, codec)];
    const add = (operation: Operation) => { operations.push(operation); states.push(this.fingerprint(working, codec)); };
    for (let index = 0; index < desired.length; index++) {
      const wanted = desired[index], id = idOf(wanted);
      let currentIndex = working.findIndex((node) => idOf(node) === id);
      if (currentIndex < 0) {
        const nextID = working[index] && idOf(working[index]);
        working.splice(index, 0, wanted);
        add({ action: 'insert', data: html(wanted), ...(nextID ? { nextID } : index ? { previousID: idOf(working[index - 1]) } : { parentID: docId }) });
      } else {
        if (currentIndex !== index) {
          const [moved] = working.splice(currentIndex, 1); working.splice(index, 0, moved);
          add({ action: 'move', id, parentID: docId, previousID: index ? idOf(working[index - 1]) : '' });
          currentIndex = index;
        }
        if (this.fingerprint([working[currentIndex]], codec) !== this.fingerprint([wanted], codec)) {
          working[currentIndex] = wanted;
          add({ action: 'update', id, data: html(wanted) });
        }
      }
    }
    for (let index = working.length - 1; index >= desired.length; index--) {
      const [removed] = working.splice(index, 1);
      add({ action: 'delete', id: idOf(removed), data: { createEmptyParagraph: false } });
    }
    const expected = codec.BlockDOM2StdMd(codec.Md2BlockDOM(markdown)).trimEnd();
    if (codec.BlockDOM2StdMd(working.map(html).join('')).trimEnd() !== expected) throw new NativeNotesUnsupportedError();
    return { desired: markdown, operations, states };
  }

  async preflight(docId: string, wanted: string): Promise<void> {
    const current = await this.inspect(docId);
    if (!current.state?.intent) this.plan(docId, current.nodes, wanted);
    else if (current.state.intent.desired !== wanted) throw new NotesConflictError('待恢复操作不同');
  }

  private async validateOperation(docId: string, current: Element[], operation: Operation): Promise<void> {
    const allowed = new Set(['action', 'id', 'data', 'parentID', 'previousID', 'nextID']);
    if (!operation || Object.keys(operation).some(key => !allowed.has(key)) || !['update', 'insert', 'delete', 'move'].includes(operation.action)) throw new Error('备注恢复操作格式无效');
    const existing = new Set<string>(), target = current.find(node => idOf(node) === operation.id);
    for (const root of current) walk(root, node => { if (block(node)) existing.add(idOf(node)); });
    if (operation.action !== 'insert' && !target) throw new NotesConflictError('恢复操作越出当前文档');
    if (operation.parentID && operation.parentID !== docId) throw new NotesConflictError('恢复操作越出当前文档');
    for (const sibling of [operation.nextID, operation.previousID]) if (sibling && !current.some(node => idOf(node) === sibling)) throw new NotesConflictError('恢复位置越出当前文档');
    if (operation.action === 'insert' || operation.action === 'update') {
      if (typeof operation.data !== 'string') throw new Error('备注恢复操作格式无效');
      const nodes = parse(operation.data);
      if (nodes.length !== 1 || (target && idOf(nodes[0]) !== idOf(target))) throw new Error('备注恢复块身份无效');
      const targetIds = new Set<string>();
      if (target) walk(target, node => { if (block(node)) targetIds.add(idOf(node)); });
      const newIds: string[] = [], seen = new Set<string>();
      walk(nodes[0], node => {
        if (!block(node)) return;
        const id = idOf(node);
        if (!BLOCK_ID.test(id) || !SUPPORTED.has(node.attrs['data-type']) || seen.has(id)) throw new Error('备注恢复块结构无效');
        seen.add(id);
        if (existing.has(id) && !targetIds.has(id)) throw new NotesConflictError('恢复块身份冲突');
        if (!existing.has(id)) newIds.push(id);
      });
      if (newIds.length) {
        const found = await this.request('/api/block/checkBlocksExist', { ids: newIds });
        if (!found || typeof found !== 'object' || newIds.some(id => found[id] !== false)) throw new NotesConflictError('新增块身份已被其他内容使用');
      }
    }
  }

  async write(docId: string, wanted: string, expected: string, owner: string, record: string): Promise<void> {
    let current = await this.inspect(docId);
    this.assertOwner(current.attrs, owner, record);
    let state = current.state;
    if (state?.intent) {
      if (state.intent.desired !== wanted) throw new NotesConflictError('待恢复操作不同');
    } else {
      const actual = state?.fingerprint === current.fingerprint ? state.original : current.text;
      if (actual !== expected && actual !== wanted) throw new NotesConflictError();
      if (actual === wanted) return;
      const intent = this.plan(docId, current.nodes, wanted);
      state = { version: 1, original: actual, fingerprint: current.fingerprint, intent };
      await this.persist(docId, state);
    }
    const intent = state.intent!;
    current = await this.inspect(docId);
    let index = intent.states.indexOf(current.fingerprint);
    if (index < 0) throw new NotesConflictError('操作前原文改变');
    while (index < intent.operations.length) {
      await this.validateOperation(docId, current.nodes, intent.operations[index]);
      current = await this.inspect(docId);
      if (current.fingerprint !== intent.states[index]) throw new NotesConflictError('执行前原文改变');
      const attrs = current.attrs;
      this.assertOwner(attrs, owner, record);
      if (JSON.stringify(stateFrom(attrs)) !== JSON.stringify(state)) throw new NotesConflictError('恢复记录改变');
      const timestamp = Date.now();
      // Direct editor transactions honor explicitly mapped descendant IDs. updateBlock on 3.8.8
      // re-pins descendant IDs by position, which breaks references after inserting a list item.
      await this.request('/api/transactions', { app: 'siyuan-things', session: 'things-notes', reqId: timestamp,
        transactions: [{ timestamp, doOperations: [intent.operations[index]], undoOperations: [] }] });
      await this.request('/api/sqlite/flushTransaction', {});
      current = await this.inspect(docId);
      if (current.fingerprint !== intent.states[index + 1]) throw new NotesConflictError('块操作读回不一致');
      index++;
    }
    const codec = this.makeCodec();
    if (current.text !== codec.BlockDOM2StdMd(codec.Md2BlockDOM(wanted)).trimEnd()) throw new NotesConflictError('最终正文与草稿不一致');
    await this.persist(docId, { version: 1, original: wanted, fingerprint: current.fingerprint });
    if ((await this.inspect(docId)).fingerprint !== current.fingerprint) throw new NotesConflictError('完成时原文改变');
  }
}
