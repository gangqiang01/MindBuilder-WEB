<template>
  <main class="models-page">
    <header class="models-header" style="--wails-draggable: drag">
      <h2 style="--wails-draggable: drag">
        <ResourceIcon type="models" :size="24" />
        {{ t('menu.models') }}
      </h2>
    </header>

    <div class="models-tabbar">
      <div class="models-tabs" role="tablist" :aria-label="t('menu.models')">
        <button v-for="tab in visibleTabs" :key="tab.key" type="button" role="tab" class="models-tab"
          :aria-selected="activeTab === tab.key" @click="select(tab.key)">
          <t-icon :name="tab.icon" size="16px" />
          <span>{{ tab.label() }}</span>
        </button>
      </div>
    </div>

    <section v-if="activeTab" class="models-main" role="tabpanel">
      <div class="models-panel">
        <ModelSettings v-if="activeTab === 'models'" />
        <OllamaSettings v-else-if="activeTab === 'ollama'" />
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { SETTINGS_SECTION_MIN_ROLE } from '@/config/settingsAccess'
import ResourceIcon from '@/components/icons/ResourceIcon.vue'
import ModelSettings from '@/views/settings/ModelSettings.vue'
import OllamaSettings from '@/views/settings/OllamaSettings.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const uiStore = useUIStore()

// 模型管理 / Ollama 从设置弹窗挪到本独立页，key 沿用原 settings section，
// 角色门槛与设置弹窗保持一致（SETTINGS_SECTION_MIN_ROLE）。
const tabs = [
  { key: 'models', icon: 'control-platform', label: () => t('settings.modelManagement') },
  { key: 'ollama', icon: 'server', label: () => 'Ollama' },
] as const

type ModelsTab = (typeof tabs)[number]['key']

const canSeeTab = (key: ModelsTab): boolean => {
  const min = SETTINGS_SECTION_MIN_ROLE[key] ?? 'viewer'
  if (authStore.canAccessAllTenants) return true
  return authStore.hasRole(min)
}

const visibleTabs = computed(() => tabs.filter((tab) => canSeeTab(tab.key)))
const requestedTab = computed<ModelsTab>(() => (route.query.tab === 'ollama' ? 'ollama' : 'models'))
const activeTab = computed<ModelsTab | null>(
  () => (visibleTabs.value.some((tab) => tab.key === requestedTab.value) ? requestedTab.value : null),
)

// 裸 URL 或角色降级后看不到的标签，回退到第一个可见标签。
watch([activeTab, visibleTabs], () => {
  if (activeTab.value) return
  const fallback = visibleTabs.value[0]
  if (!fallback) return
  const query = { ...route.query }
  delete query.tab
  void router.replace({ path: '/platform/models', query })
}, { immediate: true })

const select = (tab: ModelsTab) => {
  if (tab === requestedTab.value) return
  const query = { ...route.query }
  // models 是默认标签，不写进 URL；切标签时清掉模型类型深链。
  if (tab === 'models') delete query.tab
  else query.tab = tab
  delete query.modelType
  void router.replace({ path: '/platform/models', query })
}

// 从其它页面跳到指定模型类型（如「添加对话模型」）：写入
// settingsInitialSubSection，ModelSettings 的 immediate watch 会据此选中对应
// 类型过滤器。父组件 setup 先于子组件执行，这里写入保证 ModelSettings 首次
// 挂载即可读到。
const initialModelType = typeof route.query.modelType === 'string' ? route.query.modelType : ''
if (initialModelType) uiStore.settingsInitialSubSection = initialModelType
watch(
  () => route.query.modelType,
  (value) => {
    if (typeof value === 'string' && value) uiStore.settingsInitialSubSection = value
  },
)
</script>

<style scoped lang="less">
@import (reference) '@/components/css/resource-card.less';

.models-page {
  .resource-list-content();
  color: var(--td-text-color-primary);
}

.models-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  flex-shrink: 0;

  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-family: var(--app-font-family);
    font-size: var(--app-text-4xl);
    font-weight: 600;
    line-height: 32px;
  }
}

.models-tabbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--td-component-stroke);
}

.models-tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 24px;
  overflow-x: auto;
  scrollbar-width: none;
}

.models-tab {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--td-text-color-secondary);
  font: inherit;
  font-size: var(--app-text-base);
  font-weight: 500;
  cursor: pointer;
  transition: color var(--app-motion-fast) ease;

  &::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    border-radius: var(--app-radius-pill);
    background: transparent;
    transition: background var(--app-motion-fast) ease;
  }

  &:hover {
    color: var(--td-text-color-primary);
  }

  &[aria-selected='true'] {
    color: var(--td-text-color-primary);

    > .t-icon, > svg {
      color: var(--td-brand-color);
    }

    &::after {
      background: var(--td-brand-color);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--td-brand-color);
    outline-offset: -2px;
    border-radius: var(--app-radius-sm);
  }
}

.models-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--app-space-4) 0 var(--app-space-8);
}
</style>