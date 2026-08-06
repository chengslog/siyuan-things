/**
 * 图片上传：经思源 /api/file/putFile 存入工作空间 assets 目录，
 * 返回 md 引用路径（assets/siyuan-things/xxx），渲染时由思源按静态资源伺服。
 */
export async function uploadImage(file: File): Promise<string | null> {
  try {
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot) : ".png";
    const name = `siyuan-things/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const path = `/data/assets/${name}`;

    const form = new FormData();
    form.append("path", path);
    form.append("file", file);
    form.append("isDir", "false");

    const res = await fetch("/api/file/putFile", { method: "POST", body: form });
    const json = await res.json();
    if (json && json.code === 0) {
      return `assets/${name}`;
    }
    console.error("[Things] uploadImage failed:", json);
    return null;
  } catch (e) {
    console.error("[Things] uploadImage error:", e);
    return null;
  }
}
