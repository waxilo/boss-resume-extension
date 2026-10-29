import { describe, expect, it } from "vitest";
import {
  MATERIAL_LIMITS,
  buildMaterialsBlock,
  mergeMaterials,
  readMaterialFiles,
  stripHtml,
  tidy,
  totalMaterialChars,
  type ResumeMaterial,
} from "../../src/ai/materials";

function material(name: string, text: string): ResumeMaterial {
  return { id: name, name, chars: text.length, truncated: false, text };
}

describe("readMaterialFiles", () => {
  it("读取纯文本，跳过不支持的格式", async () => {
    const result = await readMaterialFiles([
      new File(["Java 后端\n5 年经验"], "旧简历.txt"),
      new File(["# 项目笔记"], "notes.md"),
      new File([new Uint8Array([1, 2, 3])], "简历.pdf"),
    ]);
    expect(result.materials.map((item) => item.name)).toEqual(["旧简历.txt", "notes.md"]);
    expect(result.materials[0].text).toBe("Java 后端\n5 年经验");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].name).toBe("简历.pdf");
  });

  it("从文件夹导入时忽略依赖和隐藏目录", async () => {
    const deep = new File(["x"], "a.txt");
    Object.defineProperty(deep, "webkitRelativePath", { value: "资料/node_modules/a.txt" });
    const normal = new File(["x"], "b.txt");
    Object.defineProperty(normal, "webkitRelativePath", { value: "资料/b.txt" });
    const result = await readMaterialFiles([deep, normal]);
    expect(result.materials.map((item) => item.name)).toEqual(["资料/b.txt"]);
    expect(result.skipped).toHaveLength(0);
  });

  it("超长内容按单文件上限截断", async () => {
    const long = "字".repeat(MATERIAL_LIMITS.perFileChars + 500);
    const result = await readMaterialFiles([new File([long], "长文.md")]);
    expect(result.materials[0].truncated).toBe(true);
    expect(result.materials[0].text).toContain("未送入");
    expect(result.materials[0].chars).toBeLessThan(long.length);
  });

  it("空白文件按没有文字跳过", async () => {
    const result = await readMaterialFiles([new File(["   \n\n"], "空.txt")]);
    expect(result.materials).toHaveLength(0);
    expect(result.skipped[0].reason).toBe("没有读到文字");
  });
});

describe("mergeMaterials", () => {
  it("同路径覆盖旧的", () => {
    const merged = mergeMaterials([material("a.md", "旧内容")], [material("a.md", "新内容")]);
    expect(merged.materials).toHaveLength(1);
    expect(merged.materials[0].text).toBe("新内容");
    expect(merged.dropped).toEqual([]);
  });

  it("超过份数上限的不加入", () => {
    const full = Array.from({ length: MATERIAL_LIMITS.files }, (_, index) => material(`f${index}.txt`, "x"));
    const merged = mergeMaterials(full, [material("extra.txt", "x")]);
    expect(merged.materials).toHaveLength(MATERIAL_LIMITS.files);
    expect(merged.dropped).toEqual(["extra.txt"]);
  });

  it("超过合计字数上限的不加入", () => {
    const big = "字".repeat(MATERIAL_LIMITS.perFileChars);
    const existing = [material("a.txt", big), material("b.txt", big), material("c.txt", big)];
    const merged = mergeMaterials(existing, [material("d.txt", "字".repeat(8000))]);
    expect(merged.dropped).toEqual(["d.txt"]);
    expect(totalMaterialChars(merged.materials)).toBeLessThanOrEqual(MATERIAL_LIMITS.totalChars);
  });
});

describe("文本清洗", () => {
  it("html 只留正文", () => {
    const text = stripHtml("<style>p{color:red}</style><p>第一段&nbsp;文字</p><script>x()</script><li>技能</li>");
    expect(text).not.toContain("color");
    expect(text).not.toContain("x()");
    expect(text).toContain("第一段 文字");
    expect(text).toContain("技能");
  });

  it("压掉多余空行和行尾空格", () => {
    expect(tidy("a   \r\n\r\n\r\n\r\nb\t")).toBe("a\n\nb");
  });
});

describe("buildMaterialsBlock", () => {
  it("没有材料时为空串", () => {
    expect(buildMaterialsBlock([])).toBe("");
  });

  it("带上文件名和正文", () => {
    const block = buildMaterialsBlock([material("JD.md", "岗位职责：负责后端开发")]);
    expect(block).toContain("【JD.md】");
    expect(block).toContain("负责后端开发");
    expect(block).toContain("事实来源");
  });
});
