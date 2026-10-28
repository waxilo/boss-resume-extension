# BOSS 简历浏览器扩展

基于 Manifest V3、Vue 3、TypeScript 和 Vite 的本地简历管理扩展。

## 已实现

- 使用 `chrome.storage.local` 保存多个本地 BOSS 简历版本。
- 创建、复制、编辑和 800ms 防抖自动保存。
- 覆盖基本信息、个人优势、求职期望、工作/项目/教育经历、证书、社交主页、志愿服务、求职状态。
- 提供领域模型、字段校验和字段级差异计算。
- 扩展图标打开独立编辑页。
- 上传到 BOSS：在直聘简历新建一份简历并填入本地内容，不覆盖已有简历。

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

## 从 BOSS 获取（只读，来源：直聘简历）

1. 在同一浏览器中登录 BOSS 求职者账号。
2. 在扩展页点击“从 BOSS 获取”，在弹出的列表里选一份直聘简历。

实现方式（`src/background/serviceWorker.ts#runInCvPage`）：优先使用已打开的 `cv.zhipin.com` 标签，没有就后台临时打开 `cv.zhipin.com/my-resumes/`，读完关闭。在页面主世界先注入 `src/boss/cvPageApi.ts`（请求头、traceId、错误码，读取与上传共用），再执行 `src/boss/pageFetch.ts`：

1. `myresume/querylist.json`：列出全部简历（名称、样式模板、更新时间）供选择。
2. `myresume/query.json`（参数 `cvId`）：读取选中简历的详情，由 `src/boss/resumeAdapter.ts` 按录制到的真实字段名转换。

只读，不写任何数据。本地简历会记下来源 `bossCvId` 和样式模板 `bossTemplateId`；上传时沿用这个模板，所以拉取后再上传，样式不变。复制出的副本解除 `bossCvId` 绑定，保留模板。

字段映射：`profileVO` 的姓名、性别（1 男 / 0 女）、出生年月、参加工作时间、期望城市与职位、薪资、求职状态；个人优势；工作、项目、教育经历（教育只有年份，本地按 9 月入学、6 月毕业补月份）。没有映射的 `profileVO` 字段（如手机号）原样保存在 `unmappedFields`。

错误码（`37` 登录失效、`121/122` 安全拦截、`9` 限流）参考开源项目 jackwener/boss-cli。失败时不自动重试。

## 上传到 BOSS（直聘简历）

上传是新增操作：在 `cv.zhipin.com` 的直聘简历里新建一份简历并填入本地内容，不修改、不覆盖已有简历，也不改 BOSS 在线简历。

流程（`src/background/serviceWorker.ts#uploadResume` 后台打开 `cv.zhipin.com/my-resumes/`，在页面主世界执行 `src/boss/pageUpload.ts`）：

1. `myresume/querylist.json`：已有份数 ≥ `maxCount` 时直接报“份数已满”，不新建。
2. 样式模板：本地简历记下的 `bossTemplateId` 优先；没有时取 `querylist.json` 里最近编辑过的那份简历的样式模板 `templateId`（没有已有简历时用直聘默认模板 `7d133318365793281g~~`）→ `myresume/syncfrombosszp.json` 按该样式新建，得到 `cvId` → `myresume/query.json` 读初始内容。
3. `updatecvname` → `profile/save` → `advantage/save` → `workexp` / `projectexp` / `eduexp` 的 `save`：先覆盖模板自带的条目，不够的新增（`id` 为空），多余的调 `delete.json` 删除。
4. 再读一次 `query.json`，条数或姓名不一致时提示用户核对。

请求格式照搬直聘简历编辑器：`application/x-www-form-urlencoded`，数组展开为 `key[i]`；请求头 `x-requested-with`、`traceId`（复刻页面算法）、`zp_token`（取自 `bst` Cookie）。每次写操作间隔 300ms，失败立即停止、不重试；失败前已新建的简历会给出链接，方便去直聘简历处理。

字段转换（`src/boss/uploadPlan.ts`）：性别 男 1 / 女 0 / 未填 -1；学历码 209 初中及以下、208 中专/中技、206 高中、202 大专、203 本科、204 硕士、205 博士；“至今”为 `endDate=0`；城市、职位按名称查直聘简历字典（城市只匹配市级），查不到时提示。手机号、邮箱、微信、头像沿用 BOSS 账号里的值。资格证书、社交主页、志愿者、期望行业、求职状态暂不上传，确认弹窗会列出来。

依据：保存接口来自 2026-10-28 的真实录制；新增条目与 `delete.json` 的用法来自直聘简历前端包，未经录制验证。

### 录制直聘简历请求（接口排查）

上传弹窗底部“接口排查”里点“开始录制”，扩展会打开直聘简历页。在页面上手动新建并保存一份简历，然后回到扩展页点击“结束并下载样本”。

- `content/networkCapture.ts`（MAIN）只在录制开启时，把页面自己发出的 zhipin.com 请求（方法、URL、请求头名、请求体、响应）通过 `postMessage` 交给 `content/captureBridge.ts`（ISOLATED）。桥接脚本再转给 Service Worker。
- Service Worker（`background/recorder.ts`）先校验消息结构，再用 `boss/recording.ts#sanitizeRecord` 脱敏，结果写入 `chrome.storage.session`。结束录制后清空。
- 脱敏规则：字符串只留长度；日期、手机号这类数字串只留格式（`9999.99`）；1–3 位数字、0–999 的整数和布尔值保留原值（用作枚举）；路径里像 ID 的段替换为 `{id}`；请求头只留名字；接口返回的 `code` / `message` 原样保留。
