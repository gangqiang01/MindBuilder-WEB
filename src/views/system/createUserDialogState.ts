/**
 * Pure helpers for the SystemAdmin create-user dialog.
 */

import type { CreateSystemUserResult } from "@/api/system"

export type CreateUserIdentity = {
  username: string
  email: string
}

export type CreateUserReveal = CreateUserIdentity & {
  generatedPassword: string
  /** True when the password was server-minted; false when the admin supplied it. */
  passwordGenerated: boolean
  /** Best-effort credential-mail outcome. Undefined when the backend did not report one. */
  emailStatus?: string
  emailError?: string
}

export type CreateUserView =
  | ({ kind: 'reveal' } & CreateUserReveal)
  | { kind: 'created' }
  | { kind: 'idempotent' }
  | { kind: 'missingPassword' }

export type CreateUserNotice = 'reveal' | 'created' | 'idempotent' | 'missingPassword'

/**
 * Map the create-user response into the view to render.
 *
 * The reveal is shown whenever a usable credential is in hand:
 *   - a server-minted random password (generated_password present), or
 *   - a caller-supplied password on a fresh create.
 * Surfacing the manually-set password too satisfies the "show the created
 * password after creation" requirement unambiguously and gives the admin a
 * single copy-to-clipboard surface. `manualPassword` is the plaintext the
 * admin typed (only meaningful when autoGenerate is false).
 */
export function resolveCreateUserView(
  response: Omit<CreateSystemUserResult, 'user'>,
  identity: CreateUserIdentity,
  autoGenerate: boolean,
  manualPassword = '',
): CreateUserView {
  const generated = response.generated_password ?? ''
  if (generated) {
    return {
      kind: 'reveal',
      username: identity.username,
      email: identity.email,
      generatedPassword: generated,
      passwordGenerated: true,
      emailStatus: response.email_status,
      emailError: response.email_error,
    }
  }
  if (!response.created) {
    return { kind: 'idempotent' }
  }
  if (autoGenerate) {
    // Server should have returned a generated password; if it didn't, the
    // credential is irretrievable and the admin must reset it.
    return { kind: 'missingPassword' }
  }
  if (manualPassword) {
    return {
      kind: 'reveal',
      username: identity.username,
      email: identity.email,
      generatedPassword: manualPassword,
      passwordGenerated: false,
      emailStatus: response.email_status,
      emailError: response.email_error,
    }
  }
  return { kind: 'created' }
}

export function applyCreateUserResponse(
  current: CreateUserReveal | null,
  view: CreateUserView,
): { success: CreateUserReveal | null; close: boolean; notice: CreateUserNotice | null } {
  // A later 200/500-shaped success must not dismiss a one-time password
  // that is already on screen (double-submit race).
  if (current) {
    return { success: current, close: false, notice: null }
  }
  switch (view.kind) {
    case 'reveal':
      return {
        success: {
          username: view.username,
          email: view.email,
          generatedPassword: view.generatedPassword,
          passwordGenerated: view.passwordGenerated,
          emailStatus: view.emailStatus,
          emailError: view.emailError,
        },
        close: false,
        notice: 'reveal',
      }
    case 'created':
      return { success: null, close: true, notice: 'created' }
    case 'idempotent':
      return { success: null, close: true, notice: 'idempotent' }
    case 'missingPassword':
      return { success: null, close: false, notice: 'missingPassword' }
  }
}

export function shouldAcceptCreateUserSubmit(submitting: boolean, revealing: boolean): boolean {
  return !submitting && !revealing
}

export function captureLockedEscape(
  dialogVisible: boolean,
  locked: boolean,
  event: { key?: string; code?: string; stopImmediatePropagation: () => void },
): boolean {
  if (!dialogVisible || !locked) return false
  if (event.key !== 'Escape' && event.code !== 'Escape') return false
  event.stopImmediatePropagation()
  return true
}

export function formatCreateUserCredentials(
  reveal: CreateUserReveal,
  labels: { username: string; email: string; password: string },
): string {
  return [
    `${labels.username}: ${reveal.username}`,
    `${labels.email}: ${reveal.email}`,
    `${labels.password}: ${reveal.generatedPassword}`,
  ].join('\n')
}
