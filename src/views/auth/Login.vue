<template>
  <div class="login-layout">
    <!-- Right Form Section -->
    <div class="form-section">
      <div class="form-panel">
        <!-- Login Card -->
        <div class="form-card">
          <div class="form-header">
            <h2 class="form-title">MindBuilder</h2>
          </div>

          <div class="form-content">
            <t-form ref="formRef" :data="formData" :rules="formRules" @submit="handleLogin" layout="vertical"
              label-align="top">
              <t-form-item :label="$t('auth.email')" name="email">
                <t-input v-model="formData.email" :placeholder="$t('auth.emailPlaceholder')" type="text"
                  autocomplete="email" size="large" :disabled="loading" />
              </t-form-item>

              <t-form-item :label="$t('auth.password')" name="password">
                <t-input v-model="formData.password" :placeholder="$t('auth.passwordPlaceholder')" type="password"
                  autocomplete="current-password" size="large" :disabled="loading" @enter="handleLogin" />
              </t-form-item>

              <div class="remember-row">
                <t-checkbox v-model="remember">{{ $t('auth.rememberMe') }}</t-checkbox>
              </div>

              <t-button type="submit" theme="primary" size="large" block :loading="loading" class="submit-button">
                {{ loading ? $t('auth.loggingIn') : $t('auth.login') }}
              </t-button>

              <div v-if="oidcEnabled" class="oidc-divider">
                <span>{{ $t('auth.orContinueWith') }}</span>
              </div>

              <t-button v-if="oidcEnabled" theme="default" size="large" block :loading="oidcLoading" :disabled="loading"
                class="oidc-button" @click="handleOIDCLogin">
                {{ oidcLoading ? $t('auth.redirectingToOIDC') : oidcLoginText }}
              </t-button>
            </t-form>

           
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, nextTick, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { useRoleLabel } from '@/composables/useRoleLabel'
import { notifyLoginSuccess } from '@/utils/loginNotify'
import {
  login,
  getOIDCAuthorizationURL,
  getOIDCConfig,
  autoSetup,
  userInfoFromApi,
  getInvitationByToken,
  type InviteLookup,
} from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { t, tm, locale } = useI18n()
const { formatRole, roleIcon } = useRoleLabel()

// Form references
const formRef = ref()

// State management
const loading = ref(false)
const oidcLoading = ref(false)
const showLanguageMenu = ref(false)
const oidcEnabled = ref(false)
const oidcProviderName = ref('')

// invite-link state. When the URL carries ?token=xxx we resolve it to
// the originating tenant + role for the banner, and an already-logged-in
// user is auto-joined to the tenant. Accounts are only created by admins
// in the backend, so this page has no self-service registration.
const inviteToken = ref('')
const inviteLookup = ref<InviteLookup | null>(null)
const inviteLookupError = ref('')
const inviteLookupLoading = ref(false)

// Language options
const languageOptions = [
  { value: 'zh-CN', label: '简体中文', shortLabel: '中文', flag: '🇨🇳' },
  { value: 'zh-TW', label: '繁體中文', shortLabel: '繁中', flag: '繁' },
  { value: 'en-US', label: 'English', shortLabel: 'EN', flag: '🇺🇸' },
  { value: 'ja-JP', label: '日本語', shortLabel: '日本語', flag: '🇯🇵' }
]

const currentLanguage = computed(() => locale.value)
const oidcLoginText = computed(() => {
  if (oidcProviderName.value) {
    return t('auth.oidcLoginWithProvider', { provider: oidcProviderName.value })
  }
  return t('auth.oidcLogin')
})
const currentLangOption = computed(() => languageOptions.find(l => l.value === currentLanguage.value))

// Login form data
const formData = reactive<{ [key: string]: any }>({
  email: '',
  password: '',
})

// 记住密码：登录成功后把凭据存到 localStorage，下次进入自动回填。
// 参考 llm-studio LoginPage 的 btoa/atob 方案，外加 encodeURIComponent 包裹，
// 避免非 Latin-1 字符（如中文密码）让 btoa 抛异常。
const REMEMBER_KEY = 'weknora_login_remember'
const remember = ref(false)

const loadRemembered = () => {
  const raw = localStorage.getItem(REMEMBER_KEY)
  if (!raw) return
  try {
    const decoded = JSON.parse(decodeURIComponent(escape(atob(raw))))
    if (decoded.email) formData.email = decoded.email
    if (decoded.password) formData.password = decoded.password
    remember.value = true
  } catch {
    localStorage.removeItem(REMEMBER_KEY)
  }
}

const saveRemembered = () => {
  if (remember.value) {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({
      email: formData.email,
      password: formData.password,
    }))))
    localStorage.setItem(REMEMBER_KEY, encoded)
  } else {
    localStorage.removeItem(REMEMBER_KEY)
  }
}

// Login form validation rules
const formRules = computed(() => ({
  email: [
    { required: true, message: t('auth.emailRequired'), type: 'error' },
    { email: true, message: t('auth.emailInvalid'), type: 'error' }
  ],
  password: [
    { required: true, message: t('auth.passwordRequired'), type: 'error' },
    { min: 8, message: t('auth.passwordMinLength'), type: 'error' },
    { max: 32, message: t('auth.passwordMaxLength'), type: 'error' }
  ],
}))

// Toggle language menu
const toggleLanguageMenu = () => {
  showLanguageMenu.value = !showLanguageMenu.value
}

// Select language
const selectLanguage = (lang: string) => {
  locale.value = lang
  localStorage.setItem('locale', lang)
  showLanguageMenu.value = false
  MessagePlugin.success(t('language.languageSaved'))
}

// Close language menu when clicking outside
const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (!target.closest('.language-switch')) {
    showLanguageMenu.value = false
  }
}

// Add click outside listener
onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})

const persistLoginResponse = async (response: any) => {
  // Backend renamed `tenant` to `active_tenant` and added `memberships`
  // when tenant-level RBAC landed (issue #1303). The two are otherwise
  // identical — `active_tenant` is the tenant whose ID is encoded in the
  // JWT, defaulting to the user's home tenant on a fresh login.
  const activeTenant = response.active_tenant || response.tenant
  if (response.user && response.token) {
    // user.tenant_id must be the user's HOME tenant (the immutable row
    // on the users table); useHomeTenant() and the home-badge logic both
    // assume so. The ACTIVE tenant (which can differ from home when the
    // server honoured a remembered last-active-tenant preference) is
    // expressed separately via setSelectedTenant below.
    const homeTenantIdRaw = response.user.tenant_id ?? activeTenant?.id ?? ''
    authStore.setUser(userInfoFromApi(response.user, homeTenantIdRaw))
    authStore.setToken(response.token)
    if (response.refresh_token) {
      authStore.setRefreshToken(response.refresh_token)
    }
    if (activeTenant) {
      authStore.setTenant({
        id: String(activeTenant.id) || '',
        name: activeTenant.name || '',
        owner_id: response.user.id || '',
        created_at: activeTenant.created_at || new Date().toISOString(),
        updated_at: activeTenant.updated_at || new Date().toISOString()
      })
    } else {
      authStore.setTenant(null)
    }
    if (Array.isArray(response.memberships)) {
      authStore.setMemberships(response.memberships)
    }
    // If the backend dropped us into a non-home tenant (honoured a
    // remembered "last active tenant" preference), set the override so
    // subsequent requests carry X-Tenant-ID and the UI stays consistent.
    // Otherwise clear any stale override left in localStorage by a
    // previous session for a different account.
    const activeIdNum = Number(activeTenant?.id)
    const homeIdNum = Number(homeTenantIdRaw)
    if (Number.isFinite(activeIdNum) && Number.isFinite(homeIdNum) && activeIdNum !== homeIdNum) {
      authStore.setSelectedTenant(activeIdNum, activeTenant?.name || null)
    } else {
      authStore.setSelectedTenant(null, null)
    }
  }

  // Kick off the /auth/me capability sync but DON'T await it: the login
  // response already carries user/token/tenant/memberships, which is
  // enough to render the platform. /auth/me only tops up capabilities
  // (can_create_tenant / auto_accept_invitation), and canCreateTenant
  // defaults fail-closed (false) so the "create workspace" button simply
  // appears a moment later instead of flashing. Awaiting this call was
  // making the post-login redirect wait a full extra round trip — several
  // seconds on a slow backend — after the login API had already succeed.
  // The request is sequenced/shared (authMeRequest), so any ensureAuthMe
  // caller on the landing page reuses this in-flight request rather than
  // firing a duplicate.
  void authStore.refreshFromAuthMe()
  await nextTick()
  router.replace(authStore.hasValidTenant ? '/platform/knowledge-bases' : '/onboarding/workspace')
}

const getBackendOIDCRedirectURI = () => `${window.location.origin}/api/v1/auth/oidc/callback`

const loadOIDCConfig = async () => {
  try {
    const response = await getOIDCConfig()
    oidcEnabled.value = !!response.success && !!response.enabled
    oidcProviderName.value = response.provider_display_name || ''
  } catch {
    oidcEnabled.value = false
    oidcProviderName.value = ''
  }
}

const handleOIDCLogin = async () => {
  try {
    oidcLoading.value = true
    const response = await getOIDCAuthorizationURL(getBackendOIDCRedirectURI())
    const authorizationURL = response.authorization_url

    if (!response.success || !authorizationURL) {
      MessagePlugin.error(response.message || t('auth.oidcLoginFailed'))
      return
    }

    // 跳转 IdP 会丢失 URL 中的 token，暂存到 sessionStorage，回调后由 App.vue 兑换。
    if (inviteToken.value) {
      sessionStorage.setItem('weknora_pending_invite_token', inviteToken.value)
    }
    window.location.href = authorizationURL
  } catch (error: any) {
    console.error('OIDC 登录跳转失败:', error)
    MessagePlugin.error(error.message || t('auth.oidcLoginFailed'))
  } finally {
    oidcLoading.value = false
  }
}

// 用 token 加入组织并进入应用。会话此时已有效，故即便 token 失效也照常进入（避免困在登录页）。
const acceptAndEnter = async (token: string) => {
  loading.value = true
  try {
    const result = await authStore.acceptInvitationByTokenAndRefresh(token)
    if (result.ok) {
      MessagePlugin.success(t('inviteRegister.joined'))
    } else {
      MessagePlugin.warning(t('inviteRegister.invalidBody'))
    }
  } catch {
    MessagePlugin.warning(t('inviteRegister.invalidBody'))
  } finally {
    loading.value = false
    await nextTick()
    router.replace('/platform/knowledge-bases')
  }
}

// Handle login
const handleLogin = async () => {
  try {
    const valid = await formRef.value?.validate()
    if (valid !== true) return

    loading.value = true

    const response = await login({
      email: formData.email,
      password: formData.password,
    })

    if (response.success) {
      saveRemembered()
      await persistLoginResponse(response)
      notifyLoginSuccess(response, t, tm, formatRole, roleIcon)
    } else {
      MessagePlugin.error(response.message || t('auth.loginError'))
    }
  } catch (error: any) {
    console.error('登录错误:', error)
    MessagePlugin.error(error.message || t('auth.loginErrorRetry'))
  } finally {
    loading.value = false
  }
}

// Check if already logged in; for lite edition, attempt transparent auto-setup
onMounted(async () => {
  // 回填上次记住的凭据（若存在），先于其他自动流程执行。
  loadRemembered()
  // Share-link landing: ?token=xxx resolves the invitation for the
  // banner and auto-joins an already-logged-in user. We check this
  // BEFORE the isLoggedIn redirect so an existing session doesn't
  // bounce the user to /platform (and possibly back to /login if the
  // session is stale), dropping the invite token along the way.
  // 账号只能由后台创建，未登录用户停留在登录表单，无自助注册。
  const tokenFromQuery = String(route.query.token || '').trim()
  if (tokenFromQuery) {
    inviteToken.value = tokenFromQuery
    inviteLookupLoading.value = true
    // 1. 先校验 token：无效/过期则停在登录页报错，仅保留登录入口。
    try {
      const resp = await getInvitationByToken(tokenFromQuery)
      if (resp.success && resp.data) {
        inviteLookup.value = resp.data
      } else {
        inviteLookupError.value = resp.message || t('inviteRegister.invalidBody')
      }
    } catch {
      inviteLookupError.value = t('inviteRegister.invalidBody')
    } finally {
      inviteLookupLoading.value = false
    }

    // 2. 已登录则直接兑换 token 进入组织；未登录则停留在登录表单。
    if (authStore.isLoggedIn && (await authStore.refreshFromAuthMe())) {
      await acceptAndEnter(tokenFromQuery)
      return
    }

    loadOIDCConfig()
    return
  }

  if (authStore.isLoggedIn) {
    router.replace('/platform/knowledge-bases')
    return
  }

  localStorage.removeItem('weknora_auto_setup_failed')
  try {
    const response = await autoSetup()
    if (response.success) {
      authStore.setLiteMode(true)
      await persistLoginResponse(response)
      return
    }
  } catch {
    // Auto-setup may be unavailable outside the native Lite shell.
  }

  loadOIDCConfig()
})
</script>

<style lang="less" scoped>
.login-layout {
  display: flex;
  width: 100%;
  min-height: 100%;
  overflow: hidden;
  position: relative;
  background-image: url('@/assets/img/19201080.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: radial-gradient(circle at 20% 50%, rgba(255, 255, 255, 0.06) 0%, transparent 50%),
      radial-gradient(circle at 80% 50%, rgba(255, 255, 255, 0.04) 0%, transparent 50%);
    pointer-events: none;
  }
}

.animated-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
  contain: strict;
}

.knowledge-node {
  position: absolute;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  border: 2px solid rgba(255, 255, 255, 0.3);
  box-shadow:
    0 0 15px rgba(255, 255, 255, 0.35),
    0 0 30px rgba(16, 185, 129, 0.2),
    inset 0 0 8px rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: nodePulse 5s infinite ease-in-out;
  will-change: transform, opacity;
}

.node-icon {
  width: 20px;
  height: 20px;
  color: rgba(255, 255, 255, 0.9);
}

.node-1 {
  top: 15%;
  left: 20%;
  animation-delay: 0s;
}

.node-2 {
  top: 25%;
  left: 35%;
  animation-delay: 0.5s;
}

.node-3 {
  top: 20%;
  left: 55%;
  animation-delay: 1s;
}

.node-4 {
  top: 30%;
  left: 75%;
  animation-delay: 1.5s;
}

.node-5 {
  top: 45%;
  left: 25%;
  animation-delay: 2s;
}

.node-6 {
  top: 50%;
  left: 45%;
  animation-delay: 2.5s;
}

.node-7 {
  top: 48%;
  left: 65%;
  animation-delay: 3s;
}

.node-8 {
  top: 60%;
  left: 20%;
  animation-delay: 0.3s;
}

.node-9 {
  top: 12%;
  right: 15%;
  animation-delay: 1.8s;
}

.node-10 {
  top: 38%;
  right: 10%;
  animation-delay: 2.3s;
}

.node-11 {
  top: 70%;
  left: 40%;
  animation-delay: 0.8s;
}

.node-12 {
  top: 65%;
  left: 80%;
  animation-delay: 1.3s;
}

@keyframes nodePulse {

  0%,
  100% {
    transform: scale(1);
    opacity: 0.65;
  }

  50% {
    transform: scale(1.08);
    opacity: 0.9;
  }
}

.knowledge-lines {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0.35;
}

.connection-line {
  stroke: rgba(255, 255, 255, 0.5);
  stroke-width: 1.5;
  stroke-dasharray: 6, 3;
  stroke-linecap: round;
  animation: lineFlow 10s infinite linear;
  will-change: stroke-dashoffset;
}

.line-1 {
  animation-delay: 0s;
}

.line-2 {
  animation-delay: 0.5s;
}

.line-3 {
  animation-delay: 1s;
}

.line-4 {
  animation-delay: 0.3s;
}

.line-5 {
  animation-delay: 0.8s;
}

.line-6 {
  animation-delay: 1.3s;
}

.line-7 {
  animation-delay: 1.8s;
}

.line-8 {
  animation-delay: 2.3s;
}

.line-9 {
  animation-delay: 0.2s;
}

.line-10 {
  animation-delay: 0.7s;
}

.line-11 {
  animation-delay: 0.9s;
}

.line-12 {
  animation-delay: 1.5s;
}

@keyframes lineFlow {
  0% {
    stroke-dashoffset: 0;
  }

  100% {
    stroke-dashoffset: 18;
  }
}

@media (prefers-reduced-motion: reduce) {
  .knowledge-node {
    animation: none;
    opacity: 0.65;
  }

  .connection-line {
    animation: none;
  }
}

/* Left Showcase Section */
.showcase-section {
  flex: 0 0 52%;
  display: flex;
  align-items: flex-end;
  padding: 100px 30px 100px 50px;
  box-sizing: border-box;
  position: relative;
}

.showcase-content {
  width: 100%;
  max-width: 600px;
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  margin-bottom: 60px;
}

.showcase-subtitle {
  margin-top: 0;
  font-size: 22px;
  color: rgba(255, 255, 255, 0.95);
  margin: 0 0 8px 0;
  font-family: var(--app-font-family);
  line-height: 1.4;
  font-weight: 500;
}

.showcase-description {
  font-size: var(--app-text-lg);
  color: rgba(255, 255, 255, 0.8);
  margin: 0 0 28px 0;
  font-family: var(--app-font-family);
  line-height: 1.5;
}

.feature-tags {
  display: flex;
  gap: 12px;
  margin-bottom: 40px;
  flex-wrap: wrap;
}

.tag {
  display: inline-block;
  padding: 8px 20px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  color: var(--td-text-color-anti);
  font-size: var(--app-text-base);
  font-weight: 500;
  font-family: var(--app-font-family);
}

/* Right Form Section */
.form-section {
  flex: 0 0 160%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 112px 50px 100px 30px;
  box-sizing: border-box;
  position: relative;
}

.form-panel {
  width: 100%;
  max-width: 480px;
  margin-bottom: 0;
  position: relative;
  z-index: 2;
}

.header-links {
  position: fixed;
  top: 28px;
  right: 28px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 100;
}

.header-link {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 15px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: var(--td-text-color-anti);
  text-decoration: none;
  font-size: var(--app-text-md);
  font-weight: 600;
  font-family: var(--app-font-family);
  letter-spacing: 0.2px;
  cursor: pointer;
  position: relative;

  svg {
    flex-shrink: 0;
  }

  .link-text {
    line-height: 1;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.3);
    border-color: rgba(255, 255, 255, 0.4);
    color: var(--td-text-color-anti);
  }
}

.language-switch {
  position: relative;

  button {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: var(--td-text-color-anti);

    .lang-flag-icon {
      font-size: var(--app-text-xl);
      line-height: 1;
      flex-shrink: 0;
    }

    &:hover {
      background: rgba(255, 255, 255, 0.3);
      border-color: rgba(255, 255, 255, 0.4);
    }

    svg:last-child {
      margin-left: 2px;
      flex-shrink: 0;
    }
  }
}

.language-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 160px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--app-radius-md);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  z-index: 1000;
}

.language-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: var(--app-text-md);
  font-family: var(--app-font-family);
  color: var(--td-text-color-primary);

  .lang-flag {
    font-size: var(--app-text-xl);
    flex-shrink: 0;
  }

  .lang-label {
    flex: 1;
  }

  .check-icon {
    color: var(--td-success-color);
    font-weight: 700;
    font-size: var(--app-text-base);
    flex-shrink: 0;
  }

  &:hover {
    background: var(--td-bg-color-secondarycontainer);
  }

  &.active {
    background: var(--td-success-color-light);
    color: var(--td-brand-color-active);
  }
}

.form-card {
  background: rgba(255, 255, 255, 0.97);
  border-radius: 16px;
  padding: 40px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
  border: none;
  width: 100%;
}

/* Share-link invitation banner. Sits above the login form when the
 * user arrived via an invite link (?token=xxx); gives them confirmation
 * of who invited them. Subtle, neutral card — the page background is
 * heavily brand-coloured already, so a loud tinted banner clashes; we
 * lean on the form's own surface tokens. */
.invite-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  margin-bottom: 20px;
  border-radius: var(--app-radius-lg);
  background: var(--td-bg-color-container-hover);
  border: 1px solid var(--td-component-stroke);
  color: var(--td-text-color-primary);
}

.invite-banner__icon {
  margin-top: 2px;
  font-size: var(--app-text-2xl);
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
}

.invite-banner__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.invite-banner__title {
  font-size: var(--app-text-base);
  font-weight: 600;
  line-height: 1.4;
  color: var(--td-text-color-primary);
}

.invite-banner__hint {
  font-size: var(--app-text-sm);
  color: var(--td-text-color-secondary);
  line-height: 1.5;
}

.invite-banner--error {
  background: var(--td-error-color-1);
  border-color: var(--td-error-color-3);
  color: var(--td-error-color);
  font-size: var(--app-text-md);
}

.form-header {
  text-align: center;
  margin-bottom: 32px;
}

.form-title {
  font-size: 34px;
  line-height: 1.15;
  font-weight: 800;
  letter-spacing: -0.05em;
  margin: 0 0 8px 0;
  font-family: 'Roboto', 'NotoSans', sans-serif;
  background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.12);
}

.form-welcome {
  font-size: var(--app-text-md);
  color: var(--td-text-color-secondary);
  margin: 0;
  font-family: var(--app-font-family);
}

.form-hint {
  margin: 10px 0 0;
  padding: 8px 12px;
  border-radius: var(--app-radius-md);
  background: var(--td-success-color-light);
  color: var(--td-brand-color-active);
  font-size: 12.5px;
  line-height: 1.5;
  font-family: var(--app-font-family);
}

.form-subtitle {
  font-size: var(--app-text-md);
  color: var(--td-text-color-secondary);
  margin: 0;
  font-family: var(--app-font-family);
}

.form-content {
  :deep(.t-form-item__label) {
    font-size: var(--app-text-base);
    color: var(--td-text-color-primary);
    font-weight: 500;
    margin-bottom: 8px;
    font-family: var(--app-font-family);
    display: block;
    text-align: left;
  }

  :deep(.t-input) {
    border: 1px solid var(--td-component-stroke);
    border-radius: var(--app-radius-md);
    background: var(--td-bg-color-container);
    transition: all var(--app-motion-base);

    &:focus-within {
      border-color: var(--td-brand-color);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--td-brand-color) 10%, transparent);
    }

    &:hover {
      border-color: var(--td-brand-color);
    }

    .t-input__inner {
      border: none !important;
      box-shadow: none !important;
      outline: none !important;
      background: transparent;
      font-size: var(--app-text-lg);
      font-family: var(--app-font-family);

      &:focus {
        border: none !important;
        box-shadow: none !important;
        outline: none !important;
      }
    }

    .t-input__wrap {
      border: none !important;
      box-shadow: none !important;
    }
  }

  :deep(.t-form-item) {
    margin-bottom: 18px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(.t-form-item__control) {
    width: 100%;
  }
}

.remember-row {
  margin: 10px 0 8px;
}

.submit-button {
  height: 46px;
  border-radius: var(--app-radius-md);
  font-size: var(--app-text-xl);
  font-weight: 500;
  font-family: var(--app-font-family);
  margin: 20px 0 16px 0;
}

.oidc-divider {
  position: relative;
  margin: 4px 0 6px;
  text-align: center;
  color: var(--td-text-color-placeholder);
  font-size: var(--app-text-sm);

  span {
    position: relative;
    z-index: 1;
    padding: 0 12px;
    background: rgba(255, 255, 255, 0.95);
  }

  &::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    border-top: 1px solid var(--td-component-stroke);
  }
}

.oidc-button {
  height: 46px;
  border-radius: var(--app-radius-md);
  font-size: var(--app-text-lg);
  font-weight: 500;
}

.form-footer {
  text-align: center;
  font-size: var(--app-text-base);
  color: var(--td-text-color-secondary);
  font-family: var(--app-font-family);
  margin-top: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--td-component-stroke);

  .link-button {
    color: var(--td-brand-color);
    text-decoration: none;
    margin-left: 4px;
    font-weight: 500;
    transition: all var(--app-motion-base);

    &:hover {
      color: var(--td-brand-color);
      text-decoration: underline;
    }
  }
}

.login-form-footer {
  border-bottom: none;
  padding-bottom: 8px;
  margin-top: 12px;
}

.login-features {
  margin-top: 20px;
  padding: 0;

  .feature-item {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
    font-size: var(--app-text-md);
    color: var(--td-text-color-secondary);
    font-family: var(--app-font-family);

    &:last-child {
      margin-bottom: 0;
    }

    .feature-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--td-success-color-light);
      color: var(--td-brand-color-active);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--app-text-sm);
      font-weight: 700;
      margin-right: 10px;
      flex-shrink: 0;
    }

    .feature-text {
      line-height: 1.4;
    }
  }
}

/* Responsive Design */
@media (max-width: 1024px) {
  .knowledge-node:nth-of-type(n + 13) {
    display: none;
  }

  .connection-line:nth-of-type(n + 13) {
    display: none;
  }

  .showcase-subtitle {
    font-size: var(--app-text-2xl);
  }

  .brand-wordmark {
    top: 26px;
    left: 40px;
    font-size: 24px;
  }

  .header-links {
    top: 22px;
    right: 22px;
    gap: 8px;

    .link-text {
      display: none;
    }

    .header-link {
      padding: 10px;
      gap: 0;
    }
  }
}

@media (max-width: 768px) {
  .login-layout {
    flex-direction: column;
  }

  .knowledge-node:nth-of-type(n + 9) {
    display: none;
  }

  .connection-line:nth-of-type(n + 9) {
    display: none;
  }

  .showcase-section {
    flex: 0 0 auto;
    min-height: 50vh;
    padding: 40px 24px;
  }

  .showcase-content {
    max-width: 100%;
  }

  .brand-wordmark {
    top: 22px;
    left: 30px;
    font-size: 22px;
  }

  .showcase-subtitle {
    font-size: var(--app-text-xl);
    margin-bottom: 24px;
  }

  .feature-tags {
    margin-bottom: 24px;
  }

  .carousel-container {
    margin-top: 24px;
  }

  .form-section {
    flex: 0 0 auto;
    padding: 24px;
  }

  .header-links {
    top: 18px;
    right: 18px;
    gap: 8px;

    .link-text {
      display: inline;
    }

    .header-link {
      padding: 8px 12px;
      font-size: var(--app-text-sm);
    }
  }

  .form-card {
    padding: 32px 24px;
  }

  .form-title {
    font-size: 22px;
  }
}

@media (max-width: 480px) {
  .animated-bg {
    display: none;
  }

  .showcase-section {
    padding: 32px 20px;
  }

  .brand-wordmark {
    top: 18px;
    left: 20px;
    font-size: 20px;
  }

  .showcase-subtitle {
    font-size: var(--app-text-base);
  }

  .tag {
    font-size: var(--app-text-sm);
    padding: 6px 16px;
  }

  .form-section {
    padding: 20px;
  }

  .header-links {
    top: 14px;
    right: 14px;
    gap: 6px;
    flex-wrap: wrap;

    .header-link {
      padding: 7px 10px;
      font-size: var(--app-text-xs);
    }
  }

  .form-card {
    padding: 28px 20px;
  }

  .form-header {
    margin-bottom: 24px;
  }
}

@media (prefers-reduced-motion: reduce) {

  .knowledge-node,
  .connection-line {
    animation: none !important;
    transition: none !important;
  }

  .animated-bg {
    display: none;
  }
}
</style>

<style lang="less">
html[theme-mode="dark"] {
  .login-layout {
    background-image: url('/home/gangqiangsun/MYPROJECT/FRONTEND/llm-studio/src/assets/images/19201080.png');
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
  }

  .knowledge-node {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.15);
  }

  .connection-line {
    stroke: rgba(255, 255, 255, 0.25);
  }

  .header-link {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.15);

    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  }

  .language-switch button {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.15);

    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  }

  .language-dropdown {
    background: rgba(36, 36, 36, 0.97) !important;
    border-color: var(--td-component-stroke) !important;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
  }

  .tag {
    background: rgba(255, 255, 255, 0.12);
  }

  .form-card {
    background: rgba(36, 36, 36, 0.97) !important;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4) !important;
  }

  .form-content .t-input {
    background: var(--td-bg-color-page) !important;
    border-color: rgba(255, 255, 255, 0.1) !important;

    &:hover {
      border-color: var(--td-brand-color) !important;
    }

    &:focus-within {
      border-color: var(--td-brand-color) !important;
    }
  }

  .login-features .feature-icon {
    background: rgba(6, 176, 77, 0.15);
  }
}
</style>
