export type AreaKey =
  | 'today'
  | 'ukg'
  | 'money'
  | 'business'
  | 'home'
  | 'admin'
  | 'wishlist'
  | 'someday'

export type Priority = 'low' | 'normal' | 'high'
export type TaskStatus = 'active' | 'done' | 'cleared'

export type DashboardTask = {
  id: string
  dashboard_id?: string | null
  user_id?: string | null
  title: string
  notes?: string | null
  area: AreaKey
  priority: Priority
  status: TaskStatus
  due_at?: string | null
  reminder_minutes?: number | null
  cost_estimate?: number | null
  saved_amount?: number | null
  created_at: string
  updated_at: string
}

export type NewTaskInput = {
  title: string
  area?: AreaKey
  notes?: string
  priority?: Priority
  due_at?: string | null
  reminder_minutes?: number | null
  cost_estimate?: number | null
  saved_amount?: number | null
}

export type StoreMode = 'local' | 'supabase'
