import { lexer } from 'marked';
import type { NotesCodec } from '../../src/storage/nativeNotes.ts';

let serial = 0;
export const nextId = () => `20261028000000-${(++serial).toString(36).padStart(7, '0')}`;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescape = (value: string) => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export const nodeId = (dom: string) => dom.match(/data-node-id="([^"]+)"/)![1];
export function splitRoots(dom: string): string[] {
  const result: string[] = [];
  let depth = 0, start = 0;
  for (const match of dom.matchAll(/<\/?div\b[^>]*>/g)) {
    if (match[0].startsWith('</')) { if (--depth === 0) result.push(dom.slice(start, match.index! + match[0].length)); }
    else { if (depth++ === 0) start = match.index!; }
  }
  return result;
}
function element(type: string, body: string, attrs = ''): string {
  return `<div data-node-id="${nextId()}" data-type="${type}"${attrs}>${body}</div>`;
}
const text = (value: string) => `<span contenteditable="true">${escape(value)}</span>`;
function render(token: any): string {
  if (token.type === 'space') return '';
  if (token.type === 'list') return element('NodeList', token.items.map((item: any) => element('NodeListItem', element('NodeParagraph', text(item.text)))).join(''), ` data-subtype="${token.ordered ? 'o' : 'u'}"`);
  if (token.type === 'code') return element('NodeCodeBlock', text(`${token.lang || ''}\n${token.text}`));
  if (token.type === 'blockquote') return element('NodeBlockquote', token.tokens.map(render).join(''));
  return element(token.type === 'heading' ? 'NodeHeading' : 'NodeParagraph', text(token.text ?? token.raw));
}
export const memoryCodec: NotesCodec = {
  Md2BlockDOM(markdown) { return lexer(markdown).map(render).join(''); },
  BlockDOM2Md(dom) { return memoryCodec.BlockDOM2StdMd(dom); },
  BlockDOM2StdMd(dom) {
    const convert = (root: string): string => {
      const type = root.match(/data-type="([^"]+)"/)?.[1];
      const body = root.slice(root.indexOf('>') + 1, root.lastIndexOf('</div>'));
      const raw = unescape(body.match(/<span contenteditable="true">([\s\S]*?)<\/span>/)?.[1] || '');
      if (type === 'NodeList') return splitRoots(body).map(item => `- ${convert(item)}`).join('\n');
      if (type === 'NodeListItem') return splitRoots(body).map(convert).join('\n\n');
      if (type === 'NodeBlockquote') return splitRoots(body).map(convert).join('\n\n').split('\n').map(line => `> ${line}`).join('\n');
      if (type === 'NodeCodeBlock') return `\`\`\`${raw}\n\`\`\``;
      if (type === 'NodeHeading') return `# ${raw}`;
      return raw;
    };
    return splitRoots(dom).map(convert).join('\n\n') + '\n';
  },
};

export function memoryNativeDocuments(documents = new Map<string, string>()) {
  const attrs = new Map<string, Record<string, string>>(), doms = new Map<string, string>(), observed = new Map<string, string>();
  const sync = (id: string) => {
    if (!documents.has(id)) throw new Error('Missing notes document');
    if (!doms.has(id) || observed.get(id) !== documents.get(id)) {
      const before = splitRoots(doms.get(id) || ''), after = splitRoots(memoryCodec.Md2BlockDOM(documents.get(id)!));
      doms.set(id, after.map((node, index) => before[index] ? node.replace(nodeId(node), nodeId(before[index])) : node).join(''));
      observed.set(id, documents.get(id)!);
    }
    return doms.get(id)!;
  };
  const request = async (path: string, body: any): Promise<any> => {
    if (path === '/api/attr/getBlockAttrs') return { ...(attrs.get(body.id) || {}) };
    if (path === '/api/attr/setBlockAttrs') { attrs.set(body.id, { ...(attrs.get(body.id) || {}), ...body.attrs }); return null; }
    if (path === '/api/block/getBlockDOM') return { id: body.id, dom: sync(body.id) };
    if (path === '/api/block/checkBlocksExist') return Object.fromEntries(body.ids.map((id: string) => [id, [...documents.keys()].some(doc => doc === id || sync(doc).includes(`data-node-id="${id}"`))]));
    if (path === '/api/sqlite/flushTransaction') return null;
    if (path === '/api/transactions') {
      for (const tx of body.transactions) for (const op of tx.doOperations) {
        const docId = [...documents.keys()].find(id => id === op.parentID || sync(id).includes(op.id || op.previousID || op.nextID || '<absent>'));
        if (!docId) throw new Error('Operation has no document');
        const roots = splitRoots(sync(docId));
        const index = roots.findIndex(root => nodeId(root) === op.id);
        if (op.action === 'update') { if (index < 0) throw new Error('Unknown block'); roots[index] = op.data; }
        if (op.action === 'delete') roots.splice(index, 1);
        if (op.action === 'move') {
          const [moved] = roots.splice(index, 1);
          roots.splice(op.previousID ? roots.findIndex(root => nodeId(root) === op.previousID) + 1 : 0, 0, moved);
        }
        if (op.action === 'insert') {
          const target = op.nextID ? roots.findIndex(root => nodeId(root) === op.nextID) : op.previousID ? roots.findIndex(root => nodeId(root) === op.previousID) + 1 : roots.length;
          roots.splice(target, 0, op.data);
        }
        doms.set(docId, roots.join(''));
        const markdown = memoryCodec.BlockDOM2StdMd(roots.join('')).trimEnd();
        documents.set(docId, markdown); observed.set(docId, markdown);
      }
      return [];
    }
    throw new Error(`Unexpected memory notes request ${path}`);
  };
  return { request, documents, attrs, doms, sync };
}
