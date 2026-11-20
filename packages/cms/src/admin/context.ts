import { createContext, useContext } from 'react'

import type { CmsConfig } from '../define'
import type { AdminApi } from './api'

/** What field inputs need beyond their own value, e.g. a relation's target collection. */
export interface AdminContextValue {
  api: AdminApi
  config: CmsConfig
}

export const AdminContext = createContext<AdminContextValue | null>(null)

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext)
  if (!value) throw new Error('useAdmin needs <AdminContext.Provider> (Vefstjorn sets it)')
  return value
}
