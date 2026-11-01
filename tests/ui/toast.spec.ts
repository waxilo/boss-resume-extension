import { afterEach, describe, expect, it } from "vitest";
import { clearToasts, toast, toasts } from "../../src/ui/toast";

afterEach(() => clearToasts());

describe("toast timeout", () => {
  it("默认 3 秒自动关闭", () => {
    toast({ title: "已保存" });
    expect(toasts.value[0].timeout).toBe(3000);
  });

  it("带链接、多行内容也是 3 秒", () => {
    toast({
      title: "已上传",
      tone: "ok",
      lines: ["一", "二", "三"],
      actions: [{ label: "去查看", href: "https://example.com" }],
    });
    expect(toasts.value[0].timeout).toBe(3000);
  });

  it("显式传 0 时保持常驻", () => {
    toast({ title: "需要手动关闭", timeout: 0 });
    expect(toasts.value[0].timeout).toBe(0);
  });
});
