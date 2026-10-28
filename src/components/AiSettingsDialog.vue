<script setup lang="ts">
import { ref } from "vue";
import { AiError, pingAi } from "../ai/deepseek";
import { DEFAULT_AI_SETTINGS, ensureHostPermission, normalizeBaseUrl, type AiSettings } from "../ai/settings";

const props = defineProps<{ settings: AiSettings }>();
const emit = defineEmits<{ save: [settings: AiSettings]; close: [] }>();

const form = ref<AiSettings>({ ...props.settings });
const showKey = ref(false);
const busy = ref(false);
const error = ref("");
const okText = ref("");

/** 校验表单并申请接口域名权限；失败返回 undefined 并写入错误提示。 */
async function prepare(): Promise<AiSettings | undefined> {
  error.value = "";
  okText.value = "";
  const baseUrl = normalizeBaseUrl(form.value.baseUrl);
  if (!form.value.apiKey.trim()) error.value = "请填写 API Key";
  else if (!baseUrl) error.value = "接口地址必须以 http:// 或 https:// 开头";
  else if (!form.value.model.trim()) error.value = "请填写模型名称";
  if (error.value || !baseUrl) return undefined;
  if (!(await ensureHostPermission(baseUrl))) {
    error.value = "没有获得访问该接口地址的权限";
    return undefined;
  }
  return { apiKey: form.value.apiKey.trim(), baseUrl, model: form.value.model.trim() };
}

async function test(): Promise<void> {
  const settings = await prepare();
  if (!settings) return;
  busy.value = true;
  try {
    await pingAi(settings);
    okText.value = "连接成功";
  } catch (cause) {
    error.value = cause instanceof AiError ? cause.message : "连接失败，请检查配置";
  } finally {
    busy.value = false;
  }
}

async function save(): Promise<void> {
  const settings = await prepare();
  if (settings) emit("save", settings);
}

function resetDefaults(): void {
  form.value = { ...DEFAULT_AI_SETTINGS, apiKey: form.value.apiKey };
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
      <button class="dialog-close" type="button" aria-label="关闭对话框" @click="emit('close')">×</button>
      <p class="eyebrow">AI SETTINGS</p>
      <h2 id="ai-settings-title">AI 写作设置</h2>
      <p>默认接入 DeepSeek，也可以换成其他兼容 OpenAI 格式的接口。配置只保存在本机浏览器里。</p>
      <div class="ai-settings-form">
        <label class="field">API Key
          <span class="ai-key-row">
            <input v-model="form.apiKey" :type="showKey ? 'text' : 'password'" autocomplete="off" spellcheck="false" placeholder="sk-..." />
            <button class="button button--quiet" type="button" @click="showKey = !showKey">{{ showKey ? "隐藏" : "显示" }}</button>
          </span>
          <span class="field-hint">在 platform.deepseek.com 的 API Keys 页面创建。</span>
        </label>
        <label class="field">接口地址<input v-model="form.baseUrl" spellcheck="false" placeholder="https://api.deepseek.com" /></label>
        <label class="field">模型<input v-model="form.model" spellcheck="false" placeholder="deepseek-flash" /></label>
      </div>
      <p v-if="error" class="save-error" role="alert">{{ error }}</p>
      <p v-if="okText" class="ai-ok" role="status">{{ okText }}</p>
      <div class="dialog-actions">
        <button class="button button--quiet" type="button" @click="resetDefaults">恢复默认</button>
        <button class="button button--outline" type="button" :disabled="busy" @click="test">{{ busy ? "测试中…" : "测试连接" }}</button>
        <button class="button button--accent" type="button" :disabled="busy" @click="save">保存</button>
      </div>
    </section>
  </div>
</template>
