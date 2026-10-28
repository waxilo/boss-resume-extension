import { createDefaultLocalStorage, type LocalStorageArea } from "../repository/storage";

/** OpenAI 兼容接口的接入配置，默认指向 DeepSeek。 */
export interface AiSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const AI_SETTINGS_KEY = "ai:settings";

export const DEFAULT_AI_SETTINGS: Readonly<AiSettings> = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
};

export function isAiReady(settings: AiSettings | undefined): settings is AiSettings {
  return Boolean(settings?.apiKey && settings.baseUrl && settings.model);
}

/** 接口地址必须是 http(s)；返回去掉末尾斜杠的地址，非法时返回 undefined。 */
export function normalizeBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export class AiSettingsStore {
  public constructor(private readonly storage: LocalStorageArea = createDefaultLocalStorage()) {}

  public async load(): Promise<AiSettings> {
    const stored = (await this.storage.get(AI_SETTINGS_KEY))[AI_SETTINGS_KEY];
    const value = (stored && typeof stored === "object" ? stored : {}) as Partial<AiSettings>;
    return {
      apiKey: typeof value.apiKey === "string" ? value.apiKey : DEFAULT_AI_SETTINGS.apiKey,
      baseUrl: typeof value.baseUrl === "string" && value.baseUrl ? value.baseUrl : DEFAULT_AI_SETTINGS.baseUrl,
      model: typeof value.model === "string" && value.model ? value.model : DEFAULT_AI_SETTINGS.model,
    };
  }

  public async save(settings: AiSettings): Promise<void> {
    await this.storage.set({ [AI_SETTINGS_KEY]: { ...settings } });
  }
}

/**
 * 扩展页跨域请求需要对应域名的主机权限。DeepSeek 已在 manifest 里声明；
 * 换成其他兼容接口时按需申请（必须在用户点击的同一调用栈里先调用）。
 */
export async function ensureHostPermission(baseUrl: string): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions) return true;
  const origins = [`${new URL(baseUrl).origin}/*`];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}
