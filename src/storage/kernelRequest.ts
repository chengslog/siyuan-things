import type { ApiRequest } from './avClient.ts';

type KernelPost = (path: string, body?: any, headers?: Record<string, string>, process?: boolean) => Promise<any>;

/** SiYuan 3.8.8+ supports process=false, although the SDK declaration omits it.
 * Keep error ownership here: the host otherwise displays code=1 before our
 * lifecycle handlers can distinguish shutdown from a failed user operation.
 */
export function createKernelRequest(post: KernelPost): ApiRequest {
  return async (path, body) => {
    const response = await post(path, body, undefined, false);
    if (!response || response.code !== 0) {
      throw new Error(`思源数据库请求失败：${response?.msg || path}`);
    }
    return response.data;
  };
}
