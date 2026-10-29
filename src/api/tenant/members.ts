import { get, post, put, del } from '@/utils/request'

// TenantRole mirrors internal/types/tenant_member.go's four-role enum.
// Keep the string values aligned with the Go constants.
export type TenantRole = 'owner' | 'admin' | 'contributor' | 'viewer'

export type TenantMemberStatus = 'active' | 'invited' | 'suspended'

// TenantMember is the API projection of a (user, tenant) membership row,
// already joined with the user's email/username/avatar by the backend.
export interface TenantMember {
  user_id: string
  email: string
  username: string
  avatar?: string
  role: TenantRole
  status: TenantMemberStatus
  invited_by?: string | null
  joined_at: string
}

export interface ListMembersResponse {
  success: boolean
  data?: {
    members: TenantMember[]
    total: number
    page?: number
    page_size?: number
  }
  message?: string
}

export interface ListMembersParams {
  page?: number
  page_size?: number
  /** 按邮箱/用户名筛选（服务端模糊匹配） */
  q?: string
}

function buildMembersQuery(params: ListMembersParams | undefined): string {
  if (!params) return ''
  const u = new URLSearchParams()
  if (params.page != null && params.page > 0) u.set('page', String(params.page))
  if (params.page_size != null && params.page_size > 0) u.set('page_size', String(params.page_size))
  const q = params.q?.trim()
  if (q) u.set('q', q)
  const qs = u.toString()
  return qs ? `?${qs}` : ''
}

export interface AddMemberRequest {
  email: string
  role: TenantRole
}

export interface AddMemberResponse {
  success: boolean
  data?: TenantMember
  message?: string
}

export interface CreateMemberRequest {
  username: string
  email: string
  role: TenantRole
  /** 缺省时服务端生成随机初始密码，仅在响应中返回一次 */
  password?: string
}

export interface CreateMemberResponse {
  success: boolean
  data?: {
    member: TenantMember
    /** true = 本次新建了账号；false = 绑定已有账号（密码不受影响） */
    user_created: boolean
    /** 仅当新建账号且密码由服务端生成时返回一次 */
    generated_password?: string
  }
  message?: string
}

export interface SimpleResponse {
  success: boolean
  message?: string
}

/**
 * 分页列出组织成员。
 * Backend: GET /api/v1/tenants/:id/members (Viewer+)。查询参数：`q`、`page`、`page_size`。
 */
export async function listMembers(
  tenantId: number,
  params: ListMembersParams = {},
): Promise<ListMembersResponse> {
  const qs = buildMembersQuery(params)
  return (await get(
    `/api/v1/tenants/${tenantId}/members${qs}`,
  )) as unknown as ListMembersResponse
}

/**
 * 遍历分页拉取组织的全部成员（每页最大 100，最多 500 页兜底）。
 * 用于「退出组织」等对全量成员的轻量校验；普通表格请直接使用 {@link listMembers} 分页接口。
 */
export async function fetchAllTenantMembers(tenantId: number): Promise<TenantMember[]> {
  const pageSize = 100
  let page = 1
  const out: TenantMember[] = []
  let total = Number.POSITIVE_INFINITY
  for (let guard = 0; guard < 500 && out.length < total; guard++) {
    const resp = await listMembers(tenantId, { page, page_size: pageSize })
    if (!resp.success || !resp.data) break
    total = resp.data.total
    const batch = resp.data.members || []
    if (batch.length === 0 && page >= 2) break
    out.push(...batch)
    if (batch.length < pageSize) break
    page++
  }
  return out
}

/**
 * Invite an existing user (by email) to the tenant with the given role.
 * Backend: POST /api/v1/tenants/:id/members (Owner+).
 *
 * Returns 404 when the email does not match any registered user — the
 * caller should ask the invitee to register first. PR 3 does not yet
 * support email-based invites for users who don't have an account.
 */
export async function addMember(
  tenantId: number,
  body: AddMemberRequest,
): Promise<AddMemberResponse> {
  return (await post(`/api/v1/tenants/${tenantId}/members`, body)) as unknown as AddMemberResponse
}

/**
 * 直接创建用户账号（邮箱未注册时）并立即绑定为空间成员，替代邮箱邀请流程。
 * Backend: POST /api/v1/tenants/:id/members/create (Owner+, JWT-only).
 *
 * 邮箱已存在时不改写其密码，直接绑定角色（user_created=false）；
 * 密码缺省时服务端生成随机初始密码，通过 generated_password 返回一次。
 * 409 三种情形（error.details 标签区分前两种）：
 * - "username_taken"：邮箱未注册，但用户名已被其他账号占用；
 * - "identity_conflict"：邮箱已注册，但所指账号与用户名对不上；
 * - 无标签：该用户已是本空间成员。
 */
export async function createMember(
  tenantId: number,
  body: CreateMemberRequest,
): Promise<CreateMemberResponse> {
  return (await post(`/api/v1/tenants/${tenantId}/members/create`, body)) as unknown as CreateMemberResponse
}

/**
 * Change an existing member's role.
 * Backend: PUT /api/v1/tenants/:id/members/:user_id (Owner+).
 *
 * Returns 409 when this would demote the last active Owner of the tenant.
 */
export async function updateMemberRole(
  tenantId: number,
  userId: string,
  role: TenantRole,
): Promise<SimpleResponse> {
  return (await put(`/api/v1/tenants/${tenantId}/members/${userId}`, { role })) as unknown as SimpleResponse
}

/**
 * Remove a member from the tenant.
 * Backend: DELETE /api/v1/tenants/:id/members/:user_id (Owner+).
 *
 * Returns 409 when this would remove the last active Owner.
 */
export async function removeMember(
  tenantId: number,
  userId: string,
): Promise<SimpleResponse> {
  return (await del(`/api/v1/tenants/${tenantId}/members/${userId}`)) as unknown as SimpleResponse
}

/**
 * Quit the tenant on your own. Same last-Owner invariant as
 * removeMember, but does NOT require Owner+ — any active member can
 * call it.
 * Backend: POST /api/v1/tenants/:id/leave (Viewer+).
 */
export async function leaveTenant(tenantId: number): Promise<SimpleResponse> {
  return (await post(`/api/v1/tenants/${tenantId}/leave`)) as unknown as SimpleResponse
}
