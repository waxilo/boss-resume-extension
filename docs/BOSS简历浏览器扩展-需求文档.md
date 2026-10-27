# BOSS 简历浏览器扩展需求文档

- 文档版本：v1.0
- 产品形态：Chrome / Edge 浏览器扩展（Manifest V3）
- 数据基准：BOSS 直聘在线简历
- 存储方式：浏览器本地存储，不部署网页、不建设后端、不使用数据库

## 1. 背景与目标

现有简历项目包含网页、后端、账号、模板、导出、MCP 和桌面端等能力，维护面较大。本项目重构为仅服务于 BOSS 直聘在线简历的浏览器扩展。

用户在 BOSS 网页保持登录后，可从扩展中读取在线简历，创建本地简历版本，编辑后写回 BOSS。扩展本地可以保留多份简历草稿，但 BOSS 端始终只有一份在线简历。

### 1.1 产品目标

1. 以 BOSS 在线简历字段为唯一业务模型，不再维护通用简历模型、模板模型和自定义模块。
2. 不依赖任何自建服务，所有本地数据保存在 `chrome.storage.local`。
3. 支持从 BOSS 获取简历、创建本地简历、复制本地简历、编辑保存、显式写回 BOSS。
4. 写回前展示变更确认，避免误覆盖 BOSS 在线简历。
5. 所有与 BOSS 的通信均通过用户当前已登录的 BOSS 页面会话完成，不读取、上传或持久化 Cookie。

### 1.2 非目标

首个版本明确不做以下能力：

- 自建网页、后端、账号系统、云同步、在线分享。
- Tauri 桌面端、MCP、AI 改写、模板中心、模板设计器、PDF/HTML 导出、打印预览。
- 自定义模块、模块排序、模块显隐、独立样式配置。
- 多个 BOSS 账号同时管理。
- 自动投递、自动聊天、自动批量操作。
- 修改时实时、无确认地自动写回 BOSS。

> 本地修改可以自动保存；写回 BOSS 必须由用户点击“写回 BOSS”并确认差异后执行。

## 2. 核心概念与规则

| 概念 | 定义 |
|---|---|
| BOSS 在线简历 | 当前登录 BOSS 账号对应的唯一远程简历，是远程数据源。 |
| 本地简历 | 扩展内保存的一份可编辑版本，可由 BOSS 导入、手动创建或复制生成。 |
| 已绑定简历 | 曾从 BOSS 导入或成功写回 BOSS 的本地简历，会记录最近一次远程快照。 |
| 未绑定草稿 | 手动新建或复制得到的本地简历，尚未与 BOSS 建立同步记录。 |
| 保存 | 只保存到浏览器本地。编辑后防抖自动保存，也提供“立即保存”按钮。 |
| 写回 BOSS | 将当前本地简历的可映射字段提交到 BOSS，成功后更新本地远程快照。 |

### 2.1 多份本地简历与唯一 BOSS 简历

- 扩展可保存多份本地简历，用于不同求职方向或岗位版本。
- BOSS 端只有一份在线简历。任何本地简历都可以被用户选择写回 BOSS。
- 写回 BOSS 不会删除其他本地简历。
- 复制会得到一份新的本地草稿，复制后与原简历互不影响。
- 创建新简历只创建本地草稿，不会自动创建或覆盖 BOSS 在线简历。

### 2.2 保存与冲突规则

1. 表单输入停止 800ms 后自动本地保存。
2. 用户离开编辑页、切换简历或点击“立即保存”时立即落盘。
3. “从 BOSS 获取”会先读取远程简历，再由用户选择：
   - 新建为本地副本。
   - 刷新当前已绑定简历。
4. 若当前简历存在未写回 BOSS 的修改，刷新前必须提示：
   - 取消。
   - 先复制当前本地版本，再用 BOSS 数据刷新当前简历。
   - 放弃本地未写回修改并刷新。
5. 写回前生成字段级差异，只有用户确认后才提交。
6. 写回失败时不得覆盖本地数据，保留失败原因和待写回状态。

## 3. 功能需求

### 3.1 简历列表

扩展打开后显示本地简历列表。

每项展示：

- 简历名称。
- 来源：BOSS 导入、手动创建、复制。
- 最近本地保存时间。
- 最近成功写回 BOSS 时间。
- 同步状态：未绑定、本地已修改、已同步、写回失败。

操作：

- `从 BOSS 获取`
- `创建新简历`
- `复制`
- `编辑`

首版不提供删除入口，避免误删本地版本。后续如增加删除，必须提供二次确认和可恢复机制。

### 3.2 从 BOSS 获取简历

前置条件：用户已在浏览器中登录 BOSS 直聘，且打开了 BOSS 求职者页面。

流程：

1. 用户点击“从 BOSS 获取”。
2. 扩展检查当前浏览器是否存在受支持的 BOSS 页面标签页。
3. 扩展通过该页面会话调用 BOSS 简历读取接口。
4. 将读取结果转换为 `BossResumeDocument`，同时保留未映射字段的原始快照。
5. 默认创建一份新的本地简历，名称为“BOSS 简历 - YYYY-MM-DD HH:mm”。
6. 读取成功后进入编辑页，并显示读取时间与字段完整性提示。

异常提示：

- 未登录：提示用户在 BOSS 页面完成登录后重试。
- 找不到 BOSS 标签页：提示打开支持的 BOSS 求职者页面。
- 接口响应字段无法识别：保留原始快照，提示“需更新适配器”，不允许写回。
- 网络或风控错误：展示 BOSS 原始错误摘要，不自动重试。

### 3.3 创建新简历

创建一份空白的本地草稿，默认名称为“未命名简历”。

- 新简历使用完整 BOSS 字段结构，但所有字段为空或空数组。
- 用户可修改名称和简历内容。
- 不自动绑定 BOSS，不自动写回。
- 第一次写回 BOSS 时必须额外提示“将覆盖当前 BOSS 在线简历”。

### 3.4 复制简历

在列表页或编辑页复制当前简历。

- 深拷贝全部结构化字段、未映射字段和本地编辑状态。
- 新简历生成新的本地 ID。
- 名称自动追加“副本”。
- 副本不继承 BOSS 绑定关系和远程版本标识，状态为“未绑定草稿”。
- 副本不会影响原简历或 BOSS 在线简历。

### 3.5 编辑与本地保存

编辑器按 BOSS 在线简历原有业务分组展示，不提供模板式排版功能。

支持的分组：

1. 基本信息。
2. 个人优势。
3. 求职期望。
4. 工作经历。
5. 项目经历。
6. 教育经历。
7. 资格证书。
8. 社交主页。
9. 志愿者服务。
10. 求职状态。

每个分组要求：

- 与 BOSS 字段一一对应或可逆映射。
- 可新增、编辑、删除对应条目。
- 本地校验必填项、日期范围、数值格式和已知字数限制。
- 展示 BOSS 可能的字段限制提示，但最终以 BOSS 服务端校验为准。
- 支持立即保存，显示“已保存到本地 / 保存中 / 保存失败”。

### 3.6 写回 BOSS

“写回 BOSS”是明确的高风险动作，必须采用以下流程：

1. 对当前编辑状态执行完整本地校验。
2. 与最近一次 BOSS 原始快照比较，生成字段级变更列表。
3. 弹出确认框，明确显示：
   - 当前写回的本地简历名称。
   - 将覆盖的 BOSS 在线简历。
   - 新增、修改、删除的分组和条目数量。
   - 对于不支持写回的字段，明确列为“仅本地保留，不会提交”。
4. 用户点击“确认写回”后才调用接口。
5. 成功后保存服务端返回结果、更新时间及新的远程快照；状态改为“已同步”。
6. 失败后保留当前编辑内容，状态改为“写回失败”，显示可读错误和“重试”入口。

写回约束：

- 一次写回只提交实际发生变化的模块或字段，禁止每次编辑发送全量请求。
- 单次操作只对应用户的一次显式确认，禁止循环重试或批量写入。
- 未验证的保存接口、字段或令牌机制不可上线，不得猜测请求参数拼接调用。

## 4. BOSS 基准数据模型

BOSS 官方隐私说明列出的在线简历字段包括：头像、姓名、性别、求职身份、参加工作时间、出生年月、个人优势、工作经历、项目经历、教育经历、资格证书、社交主页、志愿者服务、求职期望与求职状态。

扩展内部类型以 BOSS 领域模型命名，不再使用 `basics`、`summary`、`section`、`template` 等通用简历概念。

```ts
export interface BossResumeDocument {
  localId: string;
  title: string;
  source: "boss-import" | "manual" | "copy";
  createdAt: string;
  updatedAt: string;
  lastBossFetchedAt?: string;
  lastBossWrittenAt?: string;
  syncState: "unbound" | "synced" | "local-dirty" | "write-failed" | "unsupported";

  profile: BossProfile;
  advantage: string;
  jobIntent: BossJobIntent;
  workExperiences: BossWorkExperience[];
  projects: BossProject[];
  educations: BossEducation[];
  certificates: BossCertificate[];
  socialProfiles: BossSocialProfile[];
  volunteerExperiences: BossVolunteerExperience[];
  jobSearchStatus: BossJobSearchStatus;

  // 最近一次读取/写回后保存的服务端原始数据，只用于适配、差异比较和兼容字段保留。
  remoteSnapshot?: BossRemoteSnapshot;
  // 当前版本暂不能编辑或写回、但导入时必须保留的 BOSS 字段。
  unmappedFields?: Record<string, unknown>;
}

export interface BossProfile {
  avatar?: string;
  name: string;
  gender?: "male" | "female" | "unknown";
  jobIdentity?: string;
  workStartDate?: string;
  birthDate?: string;
}

export interface BossJobIntent {
  jobType?: string;
  cities: string[];
  positions: string[];
  jobPreference?: string;
  salary?: string;
  industries: string[];
}

export interface BossWorkExperience {
  localId: string;
  companyName: string;
  industry?: string;
  department?: string;
  positionName: string;
  startDate: string;
  endDate?: string;
  isCurrent?: boolean;
  responsibilities?: string;
  skills: string[];
  achievements?: string;
}

export interface BossProject {
  localId: string;
  projectName: string;
  role?: string;
  startDate: string;
  endDate?: string;
  description?: string;
  achievements?: string;
  link?: string;
}

export interface BossEducation {
  localId: string;
  schoolName: string;
  degree?: string;
  major?: string;
  startDate?: string;
  endDate?: string;
  campusExperience?: string;
  thesis?: string;
}
```

### 4.1 映射原则

1. `BossResumeAdapter` 是唯一可以接触 BOSS 接口请求、响应和字段名的模块。
2. 编辑器、存储层和 UI 只能依赖上述领域类型，禁止出现 BOSS 接口的原始字段名。
3. 读取时无法识别的字段必须放入 `unmappedFields`，不得丢弃。
4. 写回时只有具备“已验证双向映射”的字段可以提交。
5. 每次 BOSS 页面改版，只允许调整适配层和适配层测试，不扩散修改到 UI 或存储层。

## 5. 技术方案

### 5.1 工程结构

```text
boss-resume-extension/
├── src/
│   ├── background/             # MV3 service worker、消息路由
│   ├── content/                # 注入 BOSS 页面的桥接脚本
│   ├── boss/                   # BOSS 页面适配、API 调用、请求/响应映射
│   ├── domain/                 # BossResumeDocument、校验、差异计算
│   ├── repository/             # chrome.storage.local 持久化
│   ├── views/                  # 简历列表与编辑器页面
│   ├── components/             # 通用表单组件
│   └── styles/
├── public/
│   └── manifest.json
├── tests/
│   ├── fixtures/               # 脱敏 BOSS 接口样本
│   ├── boss-adapter/
│   └── domain/
└── README.md
```

推荐技术栈：Vue 3、TypeScript、Vite、Element Plus、Vitest。保留 Vue 现有基础栈即可，不再保留 Pinia、axios、Tauri、服务端 SDK 等未使用依赖。

### 5.2 扩展架构

```text
扩展编辑页
  ├─ ResumeRepository ──────── chrome.storage.local
  ├─ 差异比较 / 校验
  └─ chrome.runtime.sendMessage
                    │
              Service Worker
                    │
          Content Script Bridge
                    │
       BOSS 页面 Main World fetch
                    │
              BOSS 简历接口
```

设计要求：

- 通过 BOSS 页面主世界中的 `fetch` 发起读取与写回请求，使请求使用用户已经登录的页面会话。
- Content Script 与主世界脚本之间使用随机 nonce 的 `CustomEvent` / `postMessage` 通信，并严格校验来源、操作名和 nonce。
- 不向扩展页面暴露 Cookie、令牌或完整请求头。
- 扩展不收集或上传个人信息，所有简历内容只进入 `chrome.storage.local`。
- 仅申请最小权限。预计权限：`storage`、`tabs`、`scripting`、`activeTab`，以及 `https://www.zhipin.com/*` host permission。最终权限以真实实现为准。

### 5.3 本地存储

使用 `chrome.storage.local`，禁止使用 `storage.sync`：简历数据和原始快照可能超过同步存储配额，且不应跨账号自动同步。

建议键结构：

```ts
"resume:index" => ResumeIndexItem[]
"resume:{localId}" => BossResumeDocument
"settings" => { lastSelectedResumeId?: string }
```

要求：

- 每次写入前保留内存中的旧值，写入失败后 UI 保持可编辑状态。
- 读取失败或存储空间不足时明确提示，禁止伪造“已保存”。
- 不将 Cookie、token、账号密码写入任何本地存储或日志。

## 6. BOSS 接口适配与实施前置条件

已查到的读取接口参考：

- `GET /wapi/zpgeek/resume/baseinfo/query.json`
- `GET /wapi/zpgeek/resume/expect/query.json`

开源实现显示，请求会话依赖用户在 BOSS 页面已登录，且会使用 `bst` cookie 派生的 `zp_token` 请求头。接口、字段、令牌和行为均可能变动，不能视为稳定公开 API。

### 6.1 实施门禁

在编写 BOSS 写回功能前，必须由账号所有者完成一次手工抓包并提供脱敏 HAR：

1. 打开 BOSS 在线简历编辑页面。
2. 依次修改并保存基本信息、个人优势、求职期望、工作经历、项目经历、教育经历中的任意一项。
3. 导出对应请求的 HAR，删除 Cookie、手机号、姓名、地址等敏感信息后提供。
4. 确认每个模块的读取接口、保存接口、请求方法、请求体、响应体、失败码和必要请求头。
5. 以该样本生成脱敏 fixture 和适配器单元测试。

在门禁完成前：

- 可以实现本地草稿、复制、编辑、本地保存及读取适配器。
- “写回 BOSS”按钮必须显示“接口尚未验证”，不可调用猜测接口。
- 禁止通过伪造、逆向或绕过 BOSS 安全校验来补齐写回能力。

## 7. 页面与交互

### 7.1 扩展入口

- 点击扩展图标打开简历列表页。
- 复杂编辑操作在扩展独立标签页完成，避免 Popup 高度与生命周期限制。
- BOSS 页面无需常驻悬浮窗，不改动页面 UI。

### 7.2 编辑页布局

```text
顶部：返回列表 | 简历名称 | 本地保存状态 | 保存 | 写回 BOSS
左侧：基本信息 / 个人优势 / 求职期望 / 工作经历 / 项目经历 / 教育经历 / 其他
右侧：当前分组的表单编辑区
底部：最近一次 BOSS 获取/写回时间、同步状态、错误信息
```

### 7.3 写回确认弹窗

确认弹窗必须包含：

- 醒目提示：“此操作会更新当前 BOSS 在线简历”。
- 当前本地简历名称与最近一次 BOSS 同步时间。
- 可展开的字段差异清单。
- 仅本地字段说明。
- “取消”和“确认写回”按钮；默认焦点放在“取消”。

## 8. 验收标准

### 8.1 本地功能

- [ ] 可以创建一份空白本地简历。
- [ ] 可以复制任意本地简历，副本与原简历互不影响。
- [ ] 修改字段后在 800ms 内自动保存到 `chrome.storage.local`。
- [ ] 刷新扩展页面后，已保存的数据完整恢复。
- [ ] 存在多个本地简历时，可正确切换，数据不串写。
- [ ] 不存在模板、导出、分享、账号、后端 API、MCP、Tauri 相关入口和代码依赖。

### 8.2 BOSS 读取

- [ ] 用户登录 BOSS 并打开支持页面后，可读取基础信息和求职期望。
- [ ] 读取内容被正确转换为领域模型，未映射字段不会丢失。
- [ ] 未登录、接口字段变更、网络错误均给出明确提示。
- [ ] 扩展不展示、不保存 Cookie 或令牌。

### 8.3 BOSS 写回

- [ ] 没有脱敏 HAR fixture 和适配器测试时，写回操作不可用。
- [ ] 写回前能显示新增、修改、删除差异。
- [ ] 用户取消后不发送任何网络请求。
- [ ] 用户确认后只发送经过验证的模块请求。
- [ ] 成功后更新同步状态和远程快照。
- [ ] 失败后本地编辑内容不丢失，允许修复后重试。

## 9. 实施顺序

### 阶段 A：工程初始化与本地能力

1. 新建 Manifest V3 扩展工程。
2. 定义 `BossResumeDocument`、校验器、差异计算器。
3. 实现 `ResumeRepository` 和 `chrome.storage.local` 存储。
4. 完成列表、创建、复制、编辑、自动保存。
5. 编写领域模型与本地存储测试。

### 阶段 B：读取适配

1. 实现 BOSS 标签页检测和页面桥接。
2. 根据脱敏读取样本实现 `BossResumeAdapter.fetchResume()`。
3. 处理字段映射、原始快照与异常状态。
4. 编写读取适配器 fixture 测试。

### 阶段 C：写回适配

1. 基于每个模块的真实脱敏 HAR 实现写回请求。
2. 建立请求体生成和响应解析测试。
3. 实现字段级差异确认和失败恢复。
4. 仅在手工验证通过后启用写回入口。

### 阶段 D：发布前验证

1. 在 Chrome 和 Edge 的开发者模式加载扩展。
2. 覆盖登录失效、字段校验、重复写回、刷新冲突和网络失败场景。
3. 检查 manifest 权限最小化。
4. 检查构建产物中不包含 Cookie、HAR、真实简历或测试账号信息。

## 10. 风险与边界

- BOSS 接口并非面向第三方的稳定公开 API，页面和接口变更可能导致扩展失效。
- 频繁请求或频繁修改可能触发 BOSS 限流、风控或内容审核，因此不实现自动高频写回。
- 该扩展仅应操作用户本人已登录且有权管理的 BOSS 账号。
- 浏览器本地存储会随浏览器配置清理、扩展卸载或用户手动清除而丢失；首版不提供云备份。
- BOSS 服务端字段校验拥有最终决定权，本地校验仅用于提前提示。
