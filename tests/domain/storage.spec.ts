import { afterEach, describe, expect, it } from "vitest";
import { createDefaultLocalStorage, MemoryLocalStorageArea } from "../../src/repository/storage";

describe("本地存储适配器", () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  afterEach(() => {
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
      return;
    }
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  });

  it("在没有 chrome.storage.local 时使用隔离的内存回退", async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    const storage = createDefaultLocalStorage();

    expect(storage).toBeInstanceOf(MemoryLocalStorageArea);
    await storage.set({ value: { nested: true } });
    const read = await storage.get("value");
    (read.value as { nested: boolean }).nested = false;

    expect(await storage.get("value")).toEqual({ value: { nested: true } });
  });

  it("使用 chrome.storage.local 的 Promise 接口", async () => {
    const values: Record<string, unknown> = {};
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: values[key] }),
          set: async (items: Record<string, unknown>) => {
            Object.assign(values, items);
          },
        },
      },
    };

    const storage = createDefaultLocalStorage();
    await storage.set({ name: "BOSS 简历" });

    expect(await storage.get("name")).toEqual({ name: "BOSS 简历" });
  });
});
