import { resumeContentFingerprint } from "./diff";
import type { BossResumeDocument } from "./types";

/** 把当前内容记为与 BOSS 对齐的基线。从 BOSS 导入/刷新、上传成功后调用。 */
export function markContentSynced(document: BossResumeDocument): BossResumeDocument {
  document.syncState = "synced";
  document.syncedContentFingerprint = resumeContentFingerprint(document);
  return document;
}

/**
 * 保存时校正同步状态：只有内容与基线真的不同才算「本地已修改」。
 *
 * 之前的实现是「任何一次响应式变更都算用户编辑」，打开简历时补字段、同步在线快照、
 * AI 返回同样内容都会误标为已修改；改回原样也不会恢复。
 * 这里改成和基线指纹比对，内容一致就是已同步，不一致才是本地已修改。
 */
export function reconcileSyncState(document: BossResumeDocument): BossResumeDocument {
  if (document.syncState === "unbound") return document;
  const fingerprint = resumeContentFingerprint(document);

  if (!document.syncedContentFingerprint) {
    // 旧档案没有基线：已同步的以当前内容为准补一条；已修改的保持原状，避免掩盖真实差异。
    if (document.syncState === "synced") document.syncedContentFingerprint = fingerprint;
    return document;
  }

  document.syncState = fingerprint === document.syncedContentFingerprint ? "synced" : "local-dirty";
  return document;
}

/** 打开旧档案时补基线：状态是「已同步」的内容本身就是基线。 */
export function ensureSyncBaseline(document: BossResumeDocument): BossResumeDocument {
  if (document.syncState === "synced" && !document.syncedContentFingerprint) {
    document.syncedContentFingerprint = resumeContentFingerprint(document);
  }
  return document;
}
