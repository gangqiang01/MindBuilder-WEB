import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createI18n } from 'vue-i18n'

import type { AuditLog } from '../../api/tenant/audit-log.ts'
import { auditActionLabel } from '../../i18n/auditActionLabel.ts'
import { AUDIT_ACTION_I18N_ROOTS } from '../../i18n/auditActionRegistry.ts'
import enUS from '../../i18n/locales/en-US.ts'
import zhCN from '../../i18n/locales/zh-CN.ts'
import { fixture, flush } from '../../test-utils/vueFixture.ts'

const settingKeys = [
  'asynq.core_concurrency',
  'asynq.enrichment_concurrency',
  'asynq.postprocess_concurrency',
  'asynq.maintenance_concurrency',
  'asynq.shared_concurrency',
  'asynq.wiki_concurrency',
  'model.max_concurrency',
  'ssrf.whitelist',
  'sandbox.docker_enabled',
  'email.enabled',
  'email.smtp_host',
  'email.smtp_port',
  'email.smtp_encryption',
  'email.smtp_username',
  'email.smtp_password',
  'email.from_address',
  'email.site_url',
]

function settingRow(key: string, id = 1): AuditLog {
  return {
    id,
    tenant_id: 0,
    actor_user_id: '',
    actor_role: 'system_admin',
    action: 'system.setting_changed',
    scope_type: '',
    scope_id: '',
    target_user_id: '',
    target_type: 'system_setting',
    target_id: key,
    outcome: 'success',
    request_method: 'PUT',
    request_path: `/api/v1/system/admin/settings/${key}`,
    details: { key, old_value: 1, new_value: 2 },
    created_at: '2026-11-04T01:00:00Z',
  }
}

function setup(t: TestContext, rows: AuditLog[]) {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    fallbackLocale: 'en-US',
    messages: { 'zh-CN': zhCN, 'en-US': enUS },
  })
  const { vm } = fixture(t).component(new URL('./SystemAuditLog.vue', import.meta.url), {
    'vue-i18n': { useI18n: () => i18n.global },
    '@/api/system': {
      listSystemAuditLog: async () => ({ success: true, data: rows, next_cursor: 0 }),
    },
    '@/i18n/auditActionRegistry': { AUDIT_ACTION_I18N_ROOTS },
    '@/i18n/auditActionLabel': { auditActionLabel },
    '@/stores/auth': { useAuthStore: () => ({ user: null }) },
  })
  return { vm, i18n: i18n.global }
}

test('all runtime, security and email keys are localized in the audit list and drawer', async t => {
  const { vm, i18n } = setup(t, settingKeys.map(settingRow))
  await flush()
  assert.equal(vm.auditEntries.length, settingKeys.length)

  for (const locale of ['zh-CN', 'en-US'] as const) {
    i18n.locale.value = locale
    await flush()
    for (const row of vm.auditEntries as AuditLog[]) {
      const path = `system.globalSettings.keyLabels.${row.target_id}`
      assert.equal(i18n.te(path), true, `${locale}: ${row.target_id}`)
      const expected = i18n.t(path)
      assert.notEqual(expected, row.target_id)
      assert.equal(vm.auditTargetKey(row), expected)
      vm.openAuditDetail({ row })
      assert.equal(vm.auditSummaryFields(vm.selectedAuditEntry)
        .find((field: { key: string }) => field.key === 'target')?.value, expected)
      assert.equal(vm.auditIdentifierFields(row)
        .find((field: { key: string }) => field.key === 'targetId')?.value, row.target_id)
      assert.equal(JSON.parse(vm.auditDetailsJSON(row)).key, row.target_id)
      assert.equal(vm.auditTargetDiff(row), '1 → 2')
    }
  }
})

test('setting labels handle legacy target IDs and preserve unknown and non-setting targets', t => {
  const { vm, i18n } = setup(t, [])
  const legacy = { ...settingRow('email.smtp_host'), details: null }
  assert.equal(vm.auditTargetKey(legacy), i18n.t('system.globalSettings.keyLabels.email.smtp_host'))
  const preferredKey = settingRow('email.smtp_port')
  preferredKey.target_id = 'email.smtp_host'
  assert.equal(vm.auditTargetKey(preferredKey), i18n.t('system.globalSettings.keyLabels.email.smtp_port'))
  assert.equal(vm.auditTargetKey(settingRow('future.unknown_setting')), 'future.unknown_setting')
  assert.equal(vm.auditTargetKey({ ...legacy, target_id: '' }), 'system_setting')
  assert.equal(vm.auditTargetKey({ ...legacy, target_id: '', target_type: '' }), '')
  assert.equal(vm.auditTargetKey({ ...legacy, target_type: 'tenant_storage_quota' }),
    i18n.t('system.globalSettings.audit.target.bulkQuota'))
  assert.equal(vm.auditTargetKey({
    ...legacy, action: 'system.queue_task_deleted', target_id: 'task-123',
    details: { queue: 'core', task_id: 'task-123' },
  }), 'core:task-123')
})
