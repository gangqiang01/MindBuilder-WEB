<template>
  <!-- A focused "Add Redmine MCP" shortcut: the user supplies only the Redmine
       base URL + API key (+ optional read-only). Everything else (HTTP-streamable
       transport, the container URL, the X-Redmine-API-Key header, usage guidance)
       is preset, producing a normal MCPService the backend wires to a managed
       mcp-redmine container. See plan home-sgq-myproject-python-github-mcp-re-jaunty-hennessy.md. -->
  <t-dialog
    v-model:visible="innerVisible"
    :header="t('mcpSettings.redmine.dialogTitle')"
    :confirm-btn="{ content: t('common.create'), loading }"
    :cancel-btn="{ content: t('common.cancel'), disabled: loading }"
    :close-on-overlay-click="!loading"
    :close-on-esc-keydown="!loading"
    :close-btn="false"
    width="540px"
    @confirm="handleSubmit"
  >
    <t-form ref="formRef" :data="form" :rules="rules" label-align="top">
      <t-form-item :label="t('mcpSettings.redmine.serviceName')" name="name">
        <t-input v-model="form.name" :placeholder="t('mcpSettings.redmine.serviceNamePlaceholder')" />
      </t-form-item>
      <t-form-item :label="t('mcpSettings.redmine.baseUrl')" name="redmine_base_url">
        <t-input v-model="form.redmine_base_url" :placeholder="t('mcpSettings.redmine.baseUrlPlaceholder')" />
      </t-form-item>
      <t-form-item :label="t('mcpSettings.redmine.apiKey')" name="api_key">
        <t-input v-model="form.api_key" type="password" :placeholder="t('mcpSettings.redmine.apiKeyPlaceholder')" />
      </t-form-item>
      <t-form-item :label="t('mcpSettings.redmine.readOnly')" name="read_only">
        <div class="redmine-readonly">
          <t-switch v-model="form.read_only" />
          <span class="redmine-readonly__hint">{{ t('mcpSettings.redmine.readOnlyHint') }}</span>
        </div>
      </t-form-item>
    </t-form>
    <p class="redmine-hint">{{ t('mcpSettings.redmine.hint') }}</p>
  </t-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { createMCPService, type MCPService } from '@/api/mcp-service'

// The containerized mcp-redmine HTTP endpoint. streamable-http mounts at /mcp
// (mcp-redmine README). The backend must share a Docker network with the
// mcp-redmine container to resolve this host name.
const REDMINE_MCP_URL = 'http://mcp-redmine:8000/mcp'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  'created': [service: MCPService]
}>()

const { t } = useI18n()
const formRef = ref()
const loading = ref(false)

const form = reactive({
  name: '',
  redmine_base_url: '',
  api_key: '',
  read_only: false,
})

const innerVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v),
})

// Reactive to locale changes.
const rules = computed(() => ({
  name: [{ required: true, message: t('mcpSettings.redmine.serviceNameRequired'), type: 'error' as const }],
  redmine_base_url: [
    { required: true, message: t('mcpSettings.redmine.baseUrlRequired'), type: 'error' as const },
    {
      // The backend forwards this verbatim to the managed container's REDMINE_URL
      // env. A value without a protocol (e.g. "172.21.73.80:8080") makes
      // mcp-redmine fail every request with "Request URL is missing an 'http://'
      // or 'https://' protocol", so reject it here before the service is created.
      validator: (val: string) => {
        const v = (val ?? '').trim()
        if (!v) return true
        if (!/^https?:\/\//i.test(v)) return false
        try {
          // eslint-disable-next-line no-new
          new URL(v)
          return true
        } catch {
          return false
        }
      },
      message: t('mcpSettings.redmine.baseUrlInvalid'),
      type: 'error' as const,
    },
  ],
  api_key: [{ required: true, message: t('mcpSettings.redmine.apiKeyRequired'), type: 'error' as const }],
}))

// Reset to defaults each time the dialog opens.
watch(
  () => props.visible,
  (v) => {
    if (!v) return
    form.name = t('mcpSettings.redmine.defaultName')
    form.redmine_base_url = ''
    form.api_key = ''
    form.read_only = false
  },
)

function buildPayload(): Partial<MCPService> {
  const baseUrl = form.redmine_base_url.trim().replace(/\/+$/, '')
  return {
    name: form.name.trim() || t('mcpSettings.redmine.defaultName'),
    description: t('mcpSettings.redmine.templateDesc'),
    enabled: true,
    transport_type: 'http-streamable',
    url: REDMINE_MCP_URL,
    auth_config: {
      auth_type: 'api_key',
      // mcp-redmine reads this header per request (server.py:81-85); each user
      // is attributed by their own key rather than a shared service account.
      api_key_header: 'X-Redmine-API-Key',
      // Create-mode carries the secret in the initial POST body; later edits
      // go through the /credentials subresource (see McpServiceDialog).
      api_key: form.api_key,
    },
    usage_instructions: t('mcpSettings.redmine.usagePrefill'),
    // The backend maps these to the managed mcp-redmine container env:
    // redmine_base_url → REDMINE_URL (required at container start),
    // read_only → REDMINE_READ_ONLY=1.
    template_config: {
      kind: 'redmine',
      redmine_base_url: baseUrl,
      read_only: form.read_only,
    },
  }
}

async function handleSubmit() {
  let valid = true
  try {
    const result = await formRef.value?.validate()
    valid = result === true
  } catch {
    valid = false
  }
  if (!valid) return
  loading.value = true
  try {
    const created = await createMCPService(buildPayload())
    MessagePlugin.success(t('mcpSettings.redmine.created'))
    emit('created', created)
    innerVisible.value = false
  } catch (e: any) {
    MessagePlugin.error(
      e?.response?.data?.error?.message || e?.message || t('mcpSettings.redmine.createFailed'),
    )
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="less">
.redmine-readonly {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.redmine-readonly__hint {
  font-size: var(--app-text-sm);
  color: var(--td-text-color-placeholder);
}

.redmine-hint {
  margin: 8px 0 0;
  font-size: var(--app-text-sm);
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}
</style>
