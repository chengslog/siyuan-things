import { fetchSyncPost } from "siyuan";

/**
 * 思源属性视图数据库操作封装
 */
export class AttributeViewDB {
  private avId: string | null = null;
  private keyIds: Map<string, string> = new Map();

  constructor(private avName: string) {}

  /**
   * 初始化属性视图
   */
  async init(): Promise<void> {
    // 查找已存在的属性视图
    const existing = await this.findAVByName(this.avName);
    if (existing) {
      this.avId = existing;
      await this.loadKeyIds();
    } else {
      await this.createAV();
    }
  }

  /**
   * 查找属性视图
   */
  private async findAVByName(name: string): Promise<string | null> {
    try {
      const result = await fetchSyncPost("/api/av/getAttributeView", { id: "" });
      // 需要通过 SQL 查询
      const sqlResult = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT * FROM attributes WHERE name = 'custom-av-id' AND value IN (SELECT id FROM blocks WHERE content = '${name}')`
      });
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 创建属性视图
   */
  private async createAV(): Promise<void> {
    const result: any = await fetchSyncPost("/api/av/addAttributeView", {
      name: this.avName,
    });
    this.avId = result.data?.id || result.id;

    // 创建列
    await this.createColumns();
  }

  /**
   * 创建列
   */
  private async createColumns(): Promise<void> {
    const columns = [
      { name: "title", type: "text" },
      { name: "notes", type: "text" },
      { name: "status", type: "select", options: ["todo", "done", "canceled"] },
      { name: "priority", type: "select", options: ["none", "low", "medium", "high"] },
      { name: "startDate", type: "date" },
      { name: "deadline", type: "date" },
      { name: "completedDate", type: "date" },
      { name: "projectId", type: "text" },
      { name: "areaId", type: "text" },
      { name: "parentId", type: "text" },
      { name: "tags", type: "mSelect" },
      { name: "order", type: "number" },
      { name: "created", type: "date" },
      { name: "updated", type: "date" },
    ];

    for (const col of columns) {
      const result: any = await fetchSyncPost("/api/av/addAttributeViewKey", {
        avID: this.avId,
        name: col.name,
        type: col.type,
      });
      if (result.data?.id) {
        this.keyIds.set(col.name, result.data.id);
      }
    }
  }

  /**
   * 加载列 ID
   */
  private async loadKeyIds(): Promise<void> {
    if (!this.avId) return;

    const result: any = await fetchSyncPost("/api/av/getAttributeViewKeys", {
      avID: this.avId,
    });

    if (result.data) {
      for (const key of result.data) {
        this.keyIds.set(key.name, key.id);
      }
    }
  }

  /**
   * 添加记录
   */
  async addRow(data: Record<string, any>): Promise<string | null> {
    if (!this.avId) return null;

    const values = this.buildValues(data);
    const result: any = await fetchSyncPost("/api/av/addAttributeViewValues", {
      avID: this.avId,
      values,
    });

    return result.data?.blockID || null;
  }

  /**
   * 更新记录
   */
  async updateRow(blockId: string, data: Record<string, any>): Promise<void> {
    if (!this.avId) return;

    for (const [key, value] of Object.entries(data)) {
      const keyId = this.keyIds.get(key);
      if (!keyId) continue;

      await fetchSyncPost("/api/av/setAttributeViewBlockAttr", {
        avID: this.avId,
        keyID: keyId,
        blockID: blockId,
        value: this.formatValue(key, value),
      });
    }
  }

  /**
   * 删除记录
   */
  async deleteRow(blockId: string): Promise<void> {
    if (!this.avId) return;

    await fetchSyncPost("/api/av/removeAttributeViewValues", {
      avID: this.avId,
      blockIDs: [blockId],
    });
  }

  /**
   * 查询所有记录
   */
  async queryAll(): Promise<any[]> {
    if (!this.avId) return [];

    const result: any = await fetchSyncPost("/api/av/getAttributeView", {
      id: this.avId,
    });

    if (!result.data?.rows) return [];

    return result.data.rows.map((row: any) => this.parseRow(row));
  }

  /**
   * 解析行数据
   */
  private parseRow(row: any): any {
    const data: any = {
      id: row.blockID || row.id,
    };

    for (const cell of row.cells || []) {
      const keyName = this.getKeyNameById(cell.keyID);
      if (keyName) {
        data[keyName] = this.parseValue(keyName, cell.value);
      }
    }

    return data;
  }

  /**
   * 获取列名
   */
  private getKeyNameById(keyId: string): string | null {
    for (const [name, id] of this.keyIds.entries()) {
      if (id === keyId) return name;
    }
    return null;
  }

  /**
   * 构建值数组
   */
  private buildValues(data: Record<string, any>): any[] {
    const values: any[] = [];

    for (const [key, value] of Object.entries(data)) {
      const keyId = this.keyIds.get(key);
      if (!keyId) continue;

      values.push({
        keyID: keyId,
        value: this.formatValue(key, value),
        type: this.getColumnType(key),
      });
    }

    return values;
  }

  /**
   * 格式化值
   */
  private formatValue(key: string, value: any): any {
    const type = this.getColumnType(key);

    switch (type) {
      case "date":
        return value ? new Date(value).toISOString() : null;
      case "number":
        return value ?? 0;
      case "select":
      case "mSelect":
        return value;
      default:
        return String(value ?? "");
    }
  }

  /**
   * 解析值
   */
  private parseValue(key: string, value: any): any {
    const type = this.getColumnType(key);

    switch (type) {
      case "date":
        return value ? new Date(value).getTime() : undefined;
      case "number":
        return Number(value) || 0;
      case "mSelect":
        return Array.isArray(value) ? value : [];
      default:
        return value ?? "";
    }
  }

  /**
   * 获取列类型
   */
  private getColumnType(key: string): string {
    const typeMap: Record<string, string> = {
      title: "text",
      notes: "text",
      status: "select",
      priority: "select",
      startDate: "date",
      deadline: "date",
      completedDate: "date",
      projectId: "text",
      areaId: "text",
      parentId: "text",
      tags: "mSelect",
      order: "number",
      created: "date",
      updated: "date",
    };
    return typeMap[key] || "text";
  }
}
