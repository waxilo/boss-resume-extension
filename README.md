# BOSS 简历浏览器扩展

基于 Manifest V3、Vue 3、TypeScript 和 Vite 的本地简历管理扩展。

## 已实现

- 使用 `chrome.storage.local` 保存多个本地 BOSS 简历版本。
- 创建、复制、编辑和 800ms 防抖自动保存。
- 覆盖基本信息、个人优势、求职期望、工作/项目/教育经历、证书、社交主页、志愿服务、求职状态。
- 提供领域模型、字段校验和字段级差异计算。
- 扩展图标打开独立编辑页。
- BOSS 写回保持禁用，直到提供脱敏 HAR 样本并完成适配器测试。

## 本地开发

```bash
npm install
npm run build
npm test
```

构建产物位于 `dist/`。

## 加载扩展

1. 打开 Chrome 或 Edge 的扩展管理页。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择本项目的 `dist/` 目录。

## 从 BOSS 获取（只读）

1. 在同一浏览器中登录 BOSS 求职者账号。
2. 在扩展页点击“从 BOSS 获取”。

实现方式：被动捕获，扩展自身不发起任何 BOSS 接口请求。

- `src/content/networkCapture.ts` 以内容脚本（`world: "MAIN"`, `document_start`）注入 `*.zhipin.com`，记录页面自己发出的 `/wapi/` JSON 响应（只留 origin + pathname，丢弃查询串；不读 Cookie，不改请求）。
- 点击“从 BOSS 获取”时，Service Worker 先在已打开的 BOSS 在线简历页（`www.zhipin.com/web/geek/resume`）读取捕获结果；没有可用页面时，后台临时打开该页，等页面请求静默后读取，读完关闭。
- `cv.zhipin.com/my-resumes/` 是「直聘简历」模板工具，只返回模板简历列表（`zpcvresume/myresume/querylist.json`），不是在线简历，不作为读取来源。
- 扩展加载前就已打开的 BOSS 页面没有注入捕获脚本，需要刷新一次。

错误码（`37` 登录失效、`121/122` 安全拦截、`9` 限流）参考开源项目 jackwener/boss-cli。失败时不自动重试。

### 字段映射校准

`zpData` 内部字段名没有公开资料，`src/boss/resumeAdapter.ts` 中的候选键是推测值。识别不了的字段原样保存在 `unmappedFields`，不会丢失；完全无法识别时简历标记为“暂不支持写回”。

读取后可点击“下载脱敏结构样本”：样本包含捕获到的接口路径，响应体只保留字段名、字符串长度和 0–999 的枚举码，不含姓名、手机号等内容。用它收敛候选键，并替换 `tests/boss-adapter/` 中的合成样本。

## 写回 BOSS 门禁

写回保持禁用。启用前必须由账号所有者提供脱敏 HAR，确认各模块保存接口、请求体、响应体、错误码与必要请求头，并补充双向映射 fixture 测试。
