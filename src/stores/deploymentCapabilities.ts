import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getDeploymentCapabilities } from '@/api/system'
import {
  isDeploymentCapabilitySupported,
  type DeploymentCapabilityKey,
  type DeploymentCapabilityMap,
} from '@/config/deploymentCapabilities'

export const useDeploymentCapabilitiesStore = defineStore('deploymentCapabilities', () => {
  const edition = ref('')
  const capabilities = ref<DeploymentCapabilityMap>({})
  const loaded = ref(false)
  const loadError = ref('')
  let loadingPromise: Promise<void> | null = null

  const ensureLoaded = async (force = false): Promise<void> => {
    if (loaded.value && !force) return
    if (loadingPromise) return loadingPromise

    loadingPromise = (async () => {
      let ok = false
      try {
        const response = await getDeploymentCapabilities()
        edition.value = response.data?.edition || ''
        capabilities.value = response.data?.capabilities || {}
        loadError.value = ''
        ok = true
      } catch (error) {
        // 能力探测失败（如启动预热时尚未登录 → 401）不缓存失败结果：
        // fail-closed 能力位（settings.sandbox.remote/docker/host 等）在空 map 上
        // 会被判为不支持，导致登录后沙箱设置页仍弹"当前部署不支持此功能"。
        // 留 loaded=false，登录后路由守卫再次 ensureLoaded() 会带 token 重试。
        capabilities.value = {}
        loadError.value = error instanceof Error ? error.message : String(error)
      } finally {
        if (ok) loaded.value = true
        loadingPromise = null
      }
    })()

    return loadingPromise
  }

  const isSupported = (key?: DeploymentCapabilityKey) =>
    isDeploymentCapabilitySupported(capabilities.value, key)

  return {
    edition,
    capabilities,
    loaded,
    loadError,
    ensureLoaded,
    isSupported,
  }
})
