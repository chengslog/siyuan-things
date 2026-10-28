export type ApiRequest = (path: string, body: Record<string, unknown>) => Promise<any>;
export interface CellPatch { itemID: string; keyID: string; value: Record<string, unknown> }

export function newSiyuanId(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const random = crypto.getRandomValues(new Uint8Array(7));
  return `${timestamp}-${Array.from(random, (value) => (value % 36).toString(36)).join('')}`;
}

/** The request function must reject nonzero kernel responses, including HTTP-200 failures. */
export class SiYuanAVClient {
  readonly request: ApiRequest;
  constructor(request: ApiRequest) { this.request = request; }

  async getAV(avId: string): Promise<any> {
    const data = await this.request('/api/av/getAttributeView', { id: avId });
    const av = data?.av;
    if (!av || av.id !== avId || !Array.isArray(av.keyValues)) {
      throw new Error(`Things 数据库不可读取或格式无效：${avId}`);
    }
    return av;
  }

  async addRow(avId: string, itemId: string, title: string): Promise<void> {
    // The caller persists itemId before insertion. A lost response can be retried without duplicating the item.
    const av = await this.getAV(avId);
    const primary = av.keyValues.find((entry: any) => entry.key?.type === 'block');
    const existing = primary?.values?.find((value: any) => value.blockID === itemId);
    if (existing) {
      if (existing.isDetached !== true) throw new Error('Things 条目 ID 已被绑定记录占用');
      return;
    }
    await this.request('/api/av/addAttributeViewBlocks', {
      avID: avId,
      srcs: [{ id: itemId, itemID: itemId, isDetached: true, content: title }],
      ignoreDefaultFill: true,
    });
    const added = await this.getAV(avId);
    if (!added.keyValues.find((entry: any) => entry.key?.type === 'block')?.values?.some((value: any) => value.blockID === itemId)) {
      throw new Error('Things 数据库新增条目后校验失败');
    }
  }

  async setCells(avId: string, cells: CellPatch[]): Promise<void> {
    if (!cells.length) return;
    await this.request('/api/av/batchSetAttributeViewBlockAttrs', { avID: avId, values: cells });
  }

  async removeRows(avId: string, itemIds: string[]): Promise<void> {
    if (!itemIds.length) return;
    await this.request('/api/av/removeAttributeViewBlocks', { avID: avId, srcIDs: itemIds });
  }

  async transaction(operations: Record<string, unknown>[]): Promise<void> {
    if (!operations.length) return;
    const timestamp = Date.now();
    await this.request('/api/transactions', {
      app: 'siyuan-things', session: 'things-storage', reqId: timestamp,
      transactions: [{ timestamp, doOperations: operations, undoOperations: [] }],
    });
  }
}
