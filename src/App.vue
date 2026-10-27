<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from "vue";
import {
  copyResume,
  createBlankResume,
  type BossResumeDocument,
  type ResumeIndexItem,
  validateResume,
  createResumeFromBossImport,
  refreshResumeFromBossImport,
  hasUnwrittenBossChanges,
  isBossBoundResume,
  type BossImportReport,
  type BossImportResult,
} from "./domain";
import { ResumeRepository } from "./repository";
import { fetchBossResume } from "./boss/client";
import type { BossFetchError } from "./boss/types";
import StringList from "./components/StringList.vue";

type SaveState = "saved" | "saving" | "error" | "unsaved";
type SectionId =
  | "profile"
  | "advantage"
  | "intent"
  | "work"
  | "projects"
  | "education"
  | "certificates"
  | "social"
  | "volunteer"
  | "status";

const repository = new ResumeRepository();
const resumes = ref<ResumeIndexItem[]>([]);
const current = ref<BossResumeDocument>();
const view = ref<"list" | "editor">("list");
const saveState = ref<SaveState>("saved");
const saveError = ref("");
const showWriteGate = ref(false);
/** 待确认删除的简历；undefined 表示未打开删除确认框。 */
const pendingRemoval = ref<{ localId: string; title: string }>();
const removeError = ref("");
const activeSection = ref<SectionId>("profile");
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let suspendAutoSave = false;
let ignoreNextChange = false;
const BOSS_RESUME_URL = "https://cv.zhipin.com/my-resumes/";

type FetchDialog = "none" | "choose" | "conflict";
const fetching = ref(false);
const fetchError = ref<BossFetchError>();
// 读取结果只整体替换、不做深层响应，避免 structuredClone 遇到 Proxy 报错。
const pendingImport = shallowRef<BossImportResult>();
const structureSample = shallowRef<unknown>();
const fetchDialog = ref<FetchDialog>("none");
const importReport = shallowRef<BossImportReport>();

/** 当前打开且已绑定 BOSS 的简历才可作为“刷新”目标。 */
const refreshTarget = computed(() => (view.value === "editor" && current.value && isBossBoundResume(current.value) ? current.value : undefined));

async function startBossFetch(): Promise<void> {
  if (fetching.value) return;
  fetching.value = true;
  fetchError.value = undefined;
  try {
    const outcome = await fetchBossResume();
    structureSample.value = outcome.structureSample;
    if (!outcome.adapted.ok) {
      fetchError.value = outcome.adapted.error;
      return;
    }
    pendingImport.value = outcome.adapted.result;
    if (refreshTarget.value) fetchDialog.value = "choose";
    else await importAsNew();
  } catch (error) {
    fetchError.value = { code: "PAGE_UNAVAILABLE", message: "读取失败，请重新加载扩展后重试", detail: error instanceof Error ? error.message : String(error) };
  } finally {
    fetching.value = false;
  }
}

async function importAsNew(): Promise<void> {
  const result = pendingImport.value;
  if (!result) return;
  closeFetchDialog();
  if (view.value === "editor") await saveNow();
  const resume = createResumeFromBossImport(result);
  await repository.save(resume);
  await loadList();
  await openResume(resume.localId);
  importReport.value = result.report;
}

function requestRefresh(): void {
  if (!refreshTarget.value) return;
  if (hasUnwrittenBossChanges(refreshTarget.value)) fetchDialog.value = "conflict";
  else void refreshCurrent(false);
}

async function refreshCurrent(keepCopy: boolean): Promise<void> {
  const result = pendingImport.value;
  const target = refreshTarget.value;
  if (!result || !target) return;
  closeFetchDialog();
  if (saveTimer) clearTimeout(saveTimer);
  try {
    const snapshot = structuredClone(toRaw(target));
    if (keepCopy) await repository.save(copyResume(snapshot));
    const refreshed = refreshResumeFromBossImport(snapshot, result);
    await repository.save(refreshed);
    await loadList();
    await openResume(refreshed.localId);
    importReport.value = result.report;
  } catch (error) {
    fetchError.value = { code: "PAGE_UNAVAILABLE", message: "刷新后保存到本地失败，当前简历未被修改", detail: error instanceof Error ? error.message : String(error) };
  }
}

function closeFetchDialog(): void {
  fetchDialog.value = "none";
}

/** 下载只含字段结构的样本（无姓名、手机号等内容），用于校准适配器字段映射。 */
function downloadStructureSample(): void {
  if (!structureSample.value) return;
  const blob = new Blob([JSON.stringify(structureSample.value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `boss-resume-structure-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

const sections: Array<{ id: SectionId; label: string; hint: string }> = [
  { id: "profile", label: "基本资料", hint: "姓名、身份与个人信息" },
  { id: "advantage", label: "个人优势", hint: "一句话说明你的竞争力" },
  { id: "intent", label: "求职意向", hint: "岗位、城市与薪酬期望" },
  { id: "work", label: "工作经历", hint: "公司、职责与成果" },
  { id: "projects", label: "项目经历", hint: "项目角色与产出" },
  { id: "education", label: "教育经历", hint: "学校、专业与校园经历" },
  { id: "certificates", label: "资格证书", hint: "证书与凭证信息" },
  { id: "social", label: "社交主页", hint: "公开职业主页链接" },
  { id: "volunteer", label: "志愿者服务", hint: "组织、角色与服务内容" },
  { id: "status", label: "求职状态", hint: "到岗与联系偏好" },
];

const sourceLabel: Record<BossResumeDocument["source"], string> = {
  "boss-import": "BOSS 导入",
  manual: "手动创建",
  copy: "复制",
};
const syncLabel: Record<BossResumeDocument["syncState"], string> = {
  unbound: "未绑定",
  synced: "已同步",
  "local-dirty": "本地已修改",
  "write-failed": "写回失败",
  unsupported: "暂不支持写回",
};

const saveText = computed(() => ({
  saved: "已保存到本地",
  saving: "正在保存…",
  error: "保存失败",
  unsaved: "等待自动保存",
})[saveState.value]);

const validationIssues = computed(() => current.value ? validateResume(current.value).issues : []);

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function itemId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function addWork(): void {
  current.value?.workExperiences.push({ localId: itemId("work"), companyName: "", positionName: "", startDate: "", skills: [] });
}
function addProject(): void {
  current.value?.projects.push({ localId: itemId("project"), projectName: "", startDate: "" });
}
function addEducation(): void {
  current.value?.educations.push({ localId: itemId("education"), schoolName: "" });
}
function addCertificate(): void {
  current.value?.certificates.push({ localId: itemId("certificate"), name: "" });
}
function addSocial(): void {
  current.value?.socialProfiles.push({ localId: itemId("social"), platform: "", url: "" });
}
function addVolunteer(): void {
  current.value?.volunteerExperiences.push({ localId: itemId("volunteer"), organizationName: "" });
}

async function loadList(): Promise<void> {
  resumes.value = await repository.list();
}

async function openResume(id: string): Promise<void> {
  const resume = await repository.get(id);
  if (!resume) return;
  if (saveTimer) clearTimeout(saveTimer);
  suspendAutoSave = true;
  current.value = resume;
  activeSection.value = "profile";
  saveState.value = "saved";
  importReport.value = undefined;
  view.value = "editor";
  // 等待 deep watch 处理完这次整体替换，再恢复自动保存，避免“打开即视为编辑”。
  await nextTick();
  suspendAutoSave = false;
  hasUserEdits = false;
  await repository.saveSettings({ lastSelectedResumeId: id });
}

async function createResume(): Promise<void> {
  const resume = createBlankResume();
  await repository.save(resume);
  await loadList();
  await openResume(resume.localId);
}

async function duplicateResume(id = current.value?.localId): Promise<void> {
  if (!id) return;
  const source = await repository.get(id);
  if (!source) return;
  const copy = copyResume(source);
  await repository.save(copy);
  await loadList();
  await openResume(copy.localId);
}

function requestRemove(resume: { localId: string; title: string }): void {
  removeError.value = "";
  pendingRemoval.value = { localId: resume.localId, title: resume.title };
}

async function confirmRemove(): Promise<void> {
  const target = pendingRemoval.value;
  if (!target) return;
  try {
    if (current.value?.localId === target.localId) {
      // 删除正在编辑的简历：先停掉待执行的自动保存，避免删除后又被写回。
      if (saveTimer) clearTimeout(saveTimer);
      suspendAutoSave = true;
      current.value = undefined;
      importReport.value = undefined;
      view.value = "list";
      await nextTick();
      suspendAutoSave = false;
    }
    await repository.remove(target.localId);
    pendingRemoval.value = undefined;
    await loadList();
  } catch (error) {
    removeError.value = error instanceof Error ? error.message : "浏览器本地存储不可用，请稍后重试。";
  }
}

/** 只有用户真实编辑过才把“已同步”降级为“本地已修改”，单纯打开/离开不改变同步状态。 */
let hasUserEdits = false;

async function saveNow(): Promise<void> {
  if (!current.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveState.value = "saving";
  saveError.value = "";
  const document = structuredClone(toRaw(current.value));
  document.updatedAt = new Date().toISOString();
  if (hasUserEdits && document.syncState === "synced") document.syncState = "local-dirty";
  try {
    await repository.save(document);
    hasUserEdits = false;
    if (current.value?.localId === document.localId) {
      ignoreNextChange = true;
      current.value = document;
    }
    saveState.value = "saved";
    await loadList();
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "浏览器本地存储不可用，请稍后重试。";
    saveState.value = "error";
  }
}

function scheduleSave(): void {
  if (ignoreNextChange) {
    ignoreNextChange = false;
    return;
  }
  if (!current.value || suspendAutoSave) return;
  hasUserEdits = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveState.value = "unsaved";
  saveTimer = setTimeout(() => void saveNow(), 800);
}

function goList(): void {
  if (saveState.value === "unsaved" || saveState.value === "error") void saveNow();
  importReport.value = undefined;
  view.value = "list";
}

watch(current, scheduleSave, { deep: true });
onMounted(() => void loadList());
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
  void saveNow();
});
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <button v-if="view === 'editor'" class="back-link" type="button" @click="goList">← 所有档案</button>
      <div class="brand" :class="{ 'brand--list': view === 'list' }">
        <span class="brand-mark" aria-hidden="true">R</span>
        <div><strong>求职档案</strong><small>LOCAL RESUME STUDIO</small></div>
      </div>
      <div v-if="view === 'editor'" class="header-actions">
        <span class="save-state" :class="`save-state--${saveState}`" aria-live="polite">{{ saveText }}</span>
        <button class="button button--quiet" type="button" @click="duplicateResume()">复制</button>
        <button v-if="current" class="button button--quiet button--danger" type="button" @click="requestRemove(current)">删除</button>
        <a class="button button--quiet" :href="BOSS_RESUME_URL" target="_blank" rel="noopener noreferrer">前往 BOSS 简历 ↗</a>
        <button class="button button--outline" type="button" :disabled="fetching" @click="startBossFetch">{{ fetching ? "读取中…" : "从 BOSS 获取" }}</button>
        <button class="button button--accent" type="button" :disabled="saveState === 'saving'" @click="saveNow">立即保存</button>
      </div>
    </header>

    <section v-if="fetchError" class="notice notice--error" role="alert">
      <div><strong>{{ fetchError.message }}</strong><p v-if="fetchError.detail">{{ fetchError.detail }}</p></div>
      <div class="notice-actions">
        <button v-if="structureSample" class="text-button" type="button" @click="downloadStructureSample">下载脱敏结构样本</button>
        <button class="text-button" type="button" @click="fetchError = undefined">关闭</button>
      </div>
    </section>
    <section v-if="importReport && view === 'editor'" class="notice" :class="importReport.recognized ? 'notice--ok' : 'notice--warn'" role="status">
      <div>
        <strong>{{ importReport.recognized ? "已从 BOSS 读取" : "BOSS 响应无法识别，需更新适配器" }} · {{ formatDate(importReport.fetchedAt) }}</strong>
        <p v-if="importReport.readGroups.length">已读取：{{ importReport.readGroups.map((g) => `${g.label}${g.count > 1 ? ` ${g.count} 条` : ""}`).join("、") }}</p>
        <p v-if="importReport.missingGroups.length">未读取到：{{ importReport.missingGroups.join("、") }}（这些分组可能不在当前读取接口中，请对照 BOSS 页面手动补充）</p>
        <p v-for="warning in importReport.warnings" :key="warning">{{ warning }}</p>
      </div>
      <div class="notice-actions">
        <button v-if="structureSample" class="text-button" type="button" @click="downloadStructureSample">下载脱敏结构样本</button>
        <button class="text-button" type="button" @click="importReport = undefined">关闭</button>
      </div>
    </section>

    <section v-if="view === 'list'" class="list-view" aria-labelledby="page-title">
      <div class="list-hero">
        <div><p class="eyebrow">YOUR LOCAL VERSIONS</p><h1 id="page-title">管理每一份<br><em>求职档案</em></h1><p>本地编辑，按你的节奏准备下一次机会。</p></div>
        <div class="hero-actions"><button class="button button--accent button--large" type="button" @click="createResume">+ 创建空白简历</button><button class="button button--outline" type="button" :disabled="fetching" @click="startBossFetch">{{ fetching ? "正在读取 BOSS…" : "从 BOSS 获取" }}</button><a class="button button--quiet" :href="BOSS_RESUME_URL" target="_blank" rel="noopener noreferrer">前往 BOSS 简历 ↗</a></div>
      </div>
      <div class="list-toolbar"><span>{{ resumes.length }} 份本地简历</span><span>不会自动写回 BOSS</span></div>
      <div v-if="resumes.length" class="resume-list" role="list">
        <article v-for="resume in resumes" :key="resume.localId" class="resume-row" role="listitem">
          <div class="resume-title"><span class="source-dot" :class="`source-dot--${resume.source}`"></span><div><h2>{{ resume.title || "未命名简历" }}</h2><p>{{ sourceLabel[resume.source] }}</p></div></div>
          <dl><div><dt>本地保存</dt><dd>{{ formatDate(resume.updatedAt) }}</dd></div><div><dt>BOSS 写回</dt><dd>{{ formatDate(resume.lastBossWrittenAt) }}</dd></div></dl>
          <span class="status-badge" :class="`status-badge--${resume.syncState}`">{{ syncLabel[resume.syncState] }}</span>
          <div class="row-actions"><button class="text-button" type="button" @click="duplicateResume(resume.localId)">复制</button><button class="text-button text-button--danger" type="button" :aria-label="`删除「${resume.title}」`" @click="requestRemove(resume)">删除</button><button class="button button--dark" type="button" @click="openResume(resume.localId)">编辑</button></div>
        </article>
      </div>
      <div v-else class="empty-state"><span aria-hidden="true">⌁</span><h2>从一张空白页开始</h2><p>创建本地简历后，可以随时编辑和复制不同版本。</p><button class="button button--accent" type="button" @click="createResume">创建空白简历</button></div>
    </section>

    <section v-else-if="current" class="editor-view" aria-label="简历编辑器">
      <aside class="editor-nav" aria-label="简历分组">
        <p class="eyebrow">RESUME EDITOR</p><h1>{{ current.title || "未命名简历" }}</h1>
        <nav><button v-for="(section, index) in sections" :key="section.id" type="button" :class="{ active: activeSection === section.id }" @click="activeSection = section.id"><span>0{{ index + 1 }}</span>{{ section.label }}</button></nav>
        <div class="nav-footer"><p>本地保存时间</p><strong>{{ formatDate(current.updatedAt) }}</strong></div>
      </aside>

      <div class="editor-content">
        <section v-if="activeSection === 'profile'" class="form-section"><div class="section-heading"><p class="eyebrow">01 / CORE PROFILE</p><h2>基本资料</h2><p>这些信息用于识别你的职业身份。</p></div><div class="form-grid"><label class="field field--wide">简历名称<input v-model="current.title" maxlength="80" placeholder="例如：产品经理 · 增长方向" /></label><label class="field">姓名<input v-model="current.profile.name" maxlength="40" placeholder="你的姓名" /></label><label class="field">性别<select v-model="current.profile.gender"><option :value="undefined">未填写</option><option value="male">男</option><option value="female">女</option><option value="unknown">不便透露</option></select></label><label class="field">求职身份<input v-model="current.profile.jobIdentity" placeholder="例如：在职，考虑机会" /></label><label class="field">参加工作时间<input v-model="current.profile.workStartDate" type="month" /></label><label class="field">出生年月<input v-model="current.profile.birthDate" type="month" /></label><label class="field field--wide">头像链接<input v-model="current.profile.avatar" type="url" placeholder="https://" /></label></div></section>

        <section v-if="activeSection === 'advantage'" class="form-section"><div class="section-heading"><p class="eyebrow">02 / ADVANTAGE</p><h2>个人优势</h2><p>用具体能力、经验和成果说明你的价值。</p></div><label class="field field--wide"><span class="visually-hidden">个人优势</span><textarea v-model="current.advantage" rows="10" maxlength="2000" placeholder="例如：5 年消费互联网产品经验，主导过从 0 到 1 的增长产品…" /></label><p class="field-hint">{{ current.advantage.length }}/2000。最终以 BOSS 服务端的字段限制为准。</p></section>

        <section v-if="activeSection === 'intent'" class="form-section"><div class="section-heading"><p class="eyebrow">03 / JOB INTENT</p><h2>求职意向</h2><p>添加你希望寻找的岗位和工作地点。</p></div><div class="form-grid"><label class="field">工作类型<input v-model="current.jobIntent.jobType" placeholder="全职 / 实习 / 兼职" /></label><label class="field">薪资期望<input v-model="current.jobIntent.salary" placeholder="例如：25-35K·14薪" /></label><label class="field field--wide">求职偏好<textarea v-model="current.jobIntent.jobPreference" rows="3" placeholder="行业、团队或工作方式偏好" /></label></div><div class="chip-groups"><StringList label="期望城市" :items="current.jobIntent.cities" /><StringList label="期望职位" :items="current.jobIntent.positions" /><StringList label="目标行业" :items="current.jobIntent.industries" /></div></section>

        <section v-if="activeSection === 'work'" class="form-section"><div class="section-heading section-heading--action"><div><p class="eyebrow">04 / WORK EXPERIENCE</p><h2>工作经历</h2><p>按时间倒序整理你的工作和成果。</p></div><button class="button button--outline" type="button" @click="addWork">+ 新增经历</button></div><div v-if="!current.workExperiences.length" class="section-empty">尚未添加工作经历。</div><article v-for="(item, index) in current.workExperiences" :key="item.localId" class="entry-card"><div class="entry-card__top"><strong>工作经历 {{ index + 1 }}</strong><button class="text-button text-button--danger" type="button" @click="current.workExperiences.splice(index, 1)">删除</button></div><div class="form-grid"><label class="field"><span>公司名称 *</span><input v-model="item.companyName" /></label><label class="field"><span>职位名称 *</span><input v-model="item.positionName" /></label><label class="field"><span>所属行业</span><input v-model="item.industry" /></label><label class="field"><span>所属部门</span><input v-model="item.department" /></label><label class="field"><span>开始时间 *</span><input v-model="item.startDate" type="month" /></label><label class="field"><span>结束时间</span><input v-model="item.endDate" type="month" :disabled="item.isCurrent" /></label><label class="check-field"><input v-model="item.isCurrent" type="checkbox" />仍在职</label><label class="field field--wide"><span>工作职责</span><textarea v-model="item.responsibilities" rows="4" /></label><label class="field field--wide"><span>工作成果</span><textarea v-model="item.achievements" rows="4" /></label></div><StringList label="技能" :items="item.skills" /></article></section>

        <section v-if="activeSection === 'projects'" class="form-section"><div class="section-heading section-heading--action"><div><p class="eyebrow">05 / PROJECTS</p><h2>项目经历</h2><p>描述你实际负责的项目和可量化结果。</p></div><button class="button button--outline" type="button" @click="addProject">+ 新增项目</button></div><div v-if="!current.projects.length" class="section-empty">尚未添加项目经历。</div><article v-for="(item, index) in current.projects" :key="item.localId" class="entry-card"><div class="entry-card__top"><strong>项目经历 {{ index + 1 }}</strong><button class="text-button text-button--danger" type="button" @click="current.projects.splice(index, 1)">删除</button></div><div class="form-grid"><label class="field"><span>项目名称 *</span><input v-model="item.projectName" /></label><label class="field"><span>担任角色</span><input v-model="item.role" /></label><label class="field"><span>开始时间 *</span><input v-model="item.startDate" type="month" /></label><label class="field"><span>结束时间</span><input v-model="item.endDate" type="month" /></label><label class="field field--wide"><span>项目描述</span><textarea v-model="item.description" rows="4" /></label><label class="field field--wide"><span>项目成果</span><textarea v-model="item.achievements" rows="4" /></label><label class="field field--wide"><span>项目链接</span><input v-model="item.link" type="url" placeholder="https://" /></label></div></article></section>

        <section v-if="activeSection === 'education'" class="form-section"><div class="section-heading section-heading--action"><div><p class="eyebrow">06 / EDUCATION</p><h2>教育经历</h2><p>补充学历、专业与校园成果。</p></div><button class="button button--outline" type="button" @click="addEducation">+ 新增教育</button></div><div v-if="!current.educations.length" class="section-empty">尚未添加教育经历。</div><article v-for="(item, index) in current.educations" :key="item.localId" class="entry-card"><div class="entry-card__top"><strong>教育经历 {{ index + 1 }}</strong><button class="text-button text-button--danger" type="button" @click="current.educations.splice(index, 1)">删除</button></div><div class="form-grid"><label class="field"><span>学校名称 *</span><input v-model="item.schoolName" /></label><label class="field"><span>学历</span><input v-model="item.degree" placeholder="本科 / 硕士" /></label><label class="field"><span>专业</span><input v-model="item.major" /></label><label class="field"><span>开始时间</span><input v-model="item.startDate" type="month" /></label><label class="field"><span>结束时间</span><input v-model="item.endDate" type="month" /></label><label class="field field--wide"><span>校园经历</span><textarea v-model="item.campusExperience" rows="3" /></label><label class="field field--wide"><span>论文 / 研究课题</span><textarea v-model="item.thesis" rows="3" /></label></div></article></section>

        <section v-if="activeSection === 'certificates'" class="form-section"><div class="section-heading section-heading--action"><div><p class="eyebrow">07 / CERTIFICATES</p><h2>资格证书</h2><p>添加对目标岗位有帮助的专业证书。</p></div><button class="button button--outline" type="button" @click="addCertificate">+ 新增证书</button></div><div v-if="!current.certificates.length" class="section-empty">尚未添加资格证书。</div><article v-for="(item, index) in current.certificates" :key="item.localId" class="entry-card"><div class="entry-card__top"><strong>资格证书 {{ index + 1 }}</strong><button class="text-button text-button--danger" type="button" @click="current.certificates.splice(index, 1)">删除</button></div><div class="form-grid"><label class="field"><span>证书名称 *</span><input v-model="item.name" /></label><label class="field"><span>颁发机构</span><input v-model="item.issuer" /></label><label class="field"><span>证书编号</span><input v-model="item.credentialId" /></label><label class="field"><span>获得日期</span><input v-model="item.issueDate" type="month" /></label><label class="field"><span>到期日期</span><input v-model="item.expiryDate" type="month" /></label><label class="field field--wide"><span>说明</span><textarea v-model="item.description" rows="3" /></label></div></article></section>

        <section v-if="activeSection === 'social'" class="form-section"><div class="section-heading section-heading--action"><div><p class="eyebrow">08 / SOCIAL PROFILES</p><h2>社交主页</h2><p>只添加公开且与职业相关的链接。</p></div><button class="button button--outline" type="button" @click="addSocial">+ 新增主页</button></div><div v-if="!current.socialProfiles.length" class="section-empty">尚未添加社交主页。</div><article v-for="(item, index) in current.socialProfiles" :key="item.localId" class="entry-card"><div class="entry-card__top"><strong>社交主页 {{ index + 1 }}</strong><button class="text-button text-button--danger" type="button" @click="current.socialProfiles.splice(index, 1)">删除</button></div><div class="form-grid"><label class="field"><span>平台 *</span><input v-model="item.platform" placeholder="例如：GitHub、个人网站" /></label><label class="field"><span>显示名称</span><input v-model="item.label" /></label><label class="field field--wide"><span>链接 *</span><input v-model="item.url" type="url" placeholder="https://" /></label></div></article></section>

        <section v-if="activeSection === 'volunteer'" class="form-section"><div class="section-heading section-heading--action"><div><p class="eyebrow">09 / VOLUNTEER</p><h2>志愿者服务</h2><p>记录组织服务、公益项目或社群贡献。</p></div><button class="button button--outline" type="button" @click="addVolunteer">+ 新增服务</button></div><div v-if="!current.volunteerExperiences.length" class="section-empty">尚未添加志愿者服务。</div><article v-for="(item, index) in current.volunteerExperiences" :key="item.localId" class="entry-card"><div class="entry-card__top"><strong>志愿者服务 {{ index + 1 }}</strong><button class="text-button text-button--danger" type="button" @click="current.volunteerExperiences.splice(index, 1)">删除</button></div><div class="form-grid"><label class="field"><span>组织名称 *</span><input v-model="item.organizationName" /></label><label class="field"><span>服务角色</span><input v-model="item.role" /></label><label class="field"><span>开始时间</span><input v-model="item.startDate" type="month" /></label><label class="field"><span>结束时间</span><input v-model="item.endDate" type="month" /></label><label class="field field--wide"><span>服务说明</span><textarea v-model="item.description" rows="4" /></label></div></article></section>

        <section v-if="activeSection === 'status'" class="form-section"><div class="section-heading"><p class="eyebrow">10 / JOB SEARCH STATUS</p><h2>求职状态</h2><p>帮助招聘方在合适的时间联系你。</p></div><div class="form-grid"><label class="field"><span>当前状态</span><input v-model="current.jobSearchStatus.status" placeholder="例如：积极寻找机会" /></label><label class="field"><span>可到岗时间</span><input v-model="current.jobSearchStatus.availableDate" type="date" /></label><label class="field field--wide"><span>偏好联系时间</span><input v-model="current.jobSearchStatus.preferredContactTime" placeholder="例如：工作日 19:00 后" /></label><label class="field field--wide"><span>备注</span><textarea v-model="current.jobSearchStatus.note" rows="5" /></label></div></section>

        <p v-if="saveState === 'error'" class="save-error" role="alert">{{ saveError }}</p>
        <p v-if="validationIssues.length" class="validation-hint" role="status">当前有 {{ validationIssues.length }} 项字段待完善；本地草稿仍会保存，写回 BOSS 前必须全部通过校验。</p>
        <footer class="editor-footer"><div><strong>写回 BOSS（接口尚未验证）</strong><p>接口和字段映射完成验证前，所有内容仅保存到本地。</p></div><div><button class="button button--disabled" type="button" disabled aria-disabled="true">写回 BOSS（接口尚未验证）</button><button class="text-button" type="button" @click="showWriteGate = true">了解原因</button></div></footer>
      </div>
    </section>

    <div v-if="showWriteGate" class="dialog-backdrop" @click.self="showWriteGate = false"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="gate-title"><button class="dialog-close" type="button" aria-label="关闭对话框" @click="showWriteGate = false">×</button><p class="eyebrow">SAFETY GATE</p><h2 id="gate-title">写回 BOSS 目前不可用</h2><p>当前阶段尚未验证 BOSS 写回接口、请求字段及确认流程。为避免覆盖你的在线简历，“写回 BOSS”保持禁用，不会发起任何网络请求。</p><p>本页的编辑内容会按 800ms 防抖保存到浏览器本地存储，你也可以使用“立即保存”。</p><button class="button button--accent" type="button" @click="showWriteGate = false">我知道了</button></section></div>
    <div v-if="fetchDialog === 'choose'" class="dialog-backdrop" @click.self="closeFetchDialog">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="fetch-choose-title">
        <button class="dialog-close" type="button" aria-label="关闭对话框" @click="closeFetchDialog">×</button>
        <p class="eyebrow">BOSS IMPORT</p>
        <h2 id="fetch-choose-title">如何使用这次读取结果？</h2>
        <p>已读取 BOSS 在线简历。你可以新建一份本地副本，或用它刷新当前已绑定的「{{ refreshTarget?.title }}」。</p>
        <div class="dialog-actions">
          <button class="button button--quiet" type="button" autofocus @click="closeFetchDialog">取消</button>
          <button class="button button--outline" type="button" @click="requestRefresh">刷新当前简历</button>
          <button class="button button--accent" type="button" @click="importAsNew">新建为本地副本</button>
        </div>
      </section>
    </div>

    <div v-if="fetchDialog === 'conflict'" class="dialog-backdrop" @click.self="closeFetchDialog">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="fetch-conflict-title">
        <button class="dialog-close" type="button" aria-label="关闭对话框" @click="closeFetchDialog">×</button>
        <p class="eyebrow">UNWRITTEN CHANGES</p>
        <h2 id="fetch-conflict-title">当前简历有未写回 BOSS 的修改</h2>
        <p>用 BOSS 数据刷新会覆盖这些本地修改。</p>
        <div class="dialog-actions">
          <button class="button button--quiet" type="button" autofocus @click="closeFetchDialog">取消</button>
          <button class="button button--outline" type="button" @click="refreshCurrent(false)">放弃本地修改并刷新</button>
          <button class="button button--accent" type="button" @click="refreshCurrent(true)">先复制当前版本，再刷新</button>
        </div>
      </section>
    </div>
    <div v-if="pendingRemoval" class="dialog-backdrop" @click.self="pendingRemoval = undefined">
      <section class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-title" aria-describedby="remove-desc">
        <button class="dialog-close" type="button" aria-label="关闭对话框" @click="pendingRemoval = undefined">×</button>
        <p class="eyebrow">DELETE LOCAL RESUME</p>
        <h2 id="remove-title">删除「{{ pendingRemoval.title }}」？</h2>
        <p id="remove-desc">只删除这份本地简历，BOSS 在线简历不受影响。删除后无法恢复。</p>
        <p v-if="removeError" class="save-error" role="alert">{{ removeError }}</p>
        <div class="dialog-actions">
          <button class="button button--quiet" type="button" autofocus @click="pendingRemoval = undefined">取消</button>
          <button class="button button--danger-solid" type="button" @click="confirmRemove">删除</button>
        </div>
      </section>
    </div>
  </main>
</template>

