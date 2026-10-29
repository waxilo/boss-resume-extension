/**
 * 让扩展页能安全直连 OpenAI 兼容接口。
 *
 * 浏览器给扩展页发出的跨域请求带 `Origin: chrome-extension://<扩展 ID>`，
 * 部分网关（例如只放行 http/https 来源的本地转发）会因此直接返回
 * 403 "Cross-origin requests are not allowed."。这里用声明式规则把发往该接口的
 * `Origin` 头去掉，让请求回到「无来源」的形态，网关就会按普通 API 调用处理。
 *
 * 规则只对已授权的接口来源生效（manifest 里的 declarativeNetRequestWithHostAccess
 * 依赖主机权限），换接口地址时同步换掉，不会影响其它站点。
 */
const RULE_ID = 12001;

/** 规则匹配串：只覆盖该接口来源下的请求。 */
function urlFilterOf(baseUrl: string): string | undefined {
  try {
    return `|${new URL(baseUrl).origin}/`;
  } catch {
    return undefined;
  }
}

/**
 * 按当前接口地址同步「去 Origin」规则。可反复调用：先删旧规则再加新的。
 * 没有 DNR 权限（例如在普通网页里跑）时静默跳过。
 */
export async function syncAiOriginRule(baseUrl: string): Promise<void> {
  const urlFilter = urlFilterOf(baseUrl);
  const api = globalThis.chrome?.declarativeNetRequest;
  if (!urlFilter || !api) return;
  const { HeaderOperation, ResourceType, RuleActionType } = globalThis.chrome.declarativeNetRequest;
  const rule: chrome.declarativeNetRequest.Rule = {
    id: RULE_ID,
    priority: 1,
    action: {
      type: RuleActionType.MODIFY_HEADERS,
      requestHeaders: [{ header: "Origin", operation: HeaderOperation.REMOVE }],
    },
    condition: { urlFilter, resourceTypes: [ResourceType.XMLHTTPREQUEST] },
  };
  await api.updateDynamicRules({ removeRuleIds: [RULE_ID], addRules: [rule] }).catch(() => undefined);
}
