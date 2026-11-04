import type { DeploymentCapabilityKey } from './deploymentCapabilities'

export type IntegrationTab = 'im' | 'embed' | 'mcpserver'

export const INTEGRATION_TABS: IntegrationTab[] = ['im', 'embed', 'mcpserver']

export type IntegrationTabRole = 'viewer' | 'contributor' | 'admin' | 'owner'

// No integration tab currently requires a role above viewer; keep the hook so a
// future tab can opt into owner/admin gating without touching Settings.vue.
export const INTEGRATION_TAB_MIN_ROLE: Partial<Record<IntegrationTab, IntegrationTabRole>> = {}

export const INTEGRATION_TAB_CAPABILITY: Partial<Record<IntegrationTab, DeploymentCapabilityKey>> = {
  im: 'integrations.im',
  embed: 'integrations.embed',
  mcpserver: 'integrations.mcpserver',
}

export type IntegrationPreviewIcon =
  | { type: 'icon'; name: string }
  | { type: 'emoji'; value: string }

/** Sidebar hover preview + Integrations modal nav — add new entries here. */
export const INTEGRATION_PREVIEW_ITEMS: Array<{
  key: IntegrationTab
  icon: IntegrationPreviewIcon
}> = [
  { key: 'im', icon: { type: 'icon', name: 'chat-message' } },
  { key: 'embed', icon: { type: 'icon', name: 'code' } },
  { key: 'mcpserver', icon: { type: 'icon', name: 'tools' } },
]
