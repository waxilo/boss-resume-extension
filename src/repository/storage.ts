export type StorageValues = Record<string, unknown>;

export interface LocalStorageArea {
  get(keys?: string | string[] | null): Promise<StorageValues>;
  set(items: StorageValues): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface ChromeStorageArea {
  get(
    keys?: string | string[] | null,
    callback?: (items: StorageValues) => void,
  ): Promise<StorageValues> | void;
  set(items: StorageValues, callback?: () => void): Promise<void> | void;
  remove(keys: string | string[], callback?: () => void): Promise<void> | void;
}

interface ChromeLike {
  runtime?: { lastError?: { message?: string } };
  storage?: { local?: ChromeStorageArea };
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function readChromeError(chrome: ChromeLike): Error | undefined {
  const message = chrome.runtime?.lastError?.message;
  return message ? new Error(message) : undefined;
}

class ChromeLocalStorageArea implements LocalStorageArea {
  public constructor(
    private readonly chrome: ChromeLike,
    private readonly area: ChromeStorageArea,
  ) {}

  public async get(keys?: string | string[] | null): Promise<StorageValues> {
    return new Promise<StorageValues>((resolve, reject) => {
      const callback = (items: StorageValues): void => {
        const error = readChromeError(this.chrome);
        if (error) {
          reject(error);
          return;
        }
        resolve(items);
      };
      const result = this.area.get(keys, callback);
      if (result && typeof (result as Promise<StorageValues>).then === "function") {
        (result as Promise<StorageValues>).then(resolve, reject);
      }
    });
  }

  public async set(items: StorageValues): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const callback = (): void => {
        const error = readChromeError(this.chrome);
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };
      const result = this.area.set(items, callback);
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).then(resolve, reject);
      }
    });
  }

  public async remove(keys: string | string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const callback = (): void => {
        const error = readChromeError(this.chrome);
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };
      const result = this.area.remove(keys, callback);
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).then(resolve, reject);
      }
    });
  }
}

/** 供非扩展运行环境和测试使用的进程内存储。 */
export class MemoryLocalStorageArea implements LocalStorageArea {
  private readonly values = new Map<string, unknown>();

  public async get(keys?: string | string[] | null): Promise<StorageValues> {
    const requestedKeys =
      keys === undefined || keys === null
        ? [...this.values.keys()]
        : typeof keys === "string"
          ? [keys]
          : keys;

    return requestedKeys.reduce<StorageValues>((result, key) => {
      if (this.values.has(key)) {
        result[key] = clone(this.values.get(key));
      }
      return result;
    }, {});
  }

  public async set(items: StorageValues): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.values.set(key, clone(value));
    }
  }

  public async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) this.values.delete(key);
  }
}

export function createDefaultLocalStorage(): LocalStorageArea {
  const chrome = (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome;
  const area = chrome?.storage?.local;

  return chrome && area ? new ChromeLocalStorageArea(chrome, area) : new MemoryLocalStorageArea();
}
