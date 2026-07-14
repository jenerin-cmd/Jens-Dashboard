import type { AreaKey } from './types'

const areaHints: Record<AreaKey, string[]> = {
  today: ['today', 'now', 'urgent', 'this morning', 'tonight'],
  ukg: ['ukg', 'payroll', 'timesheet', 'timecard', 'workday', 'hr ticket'],
  money: ['sell', 'sales', 'revenue', 'money', 'invoice', 'client', 'lead', 'pricing', 'launch', 'ad ', 'ads', 'advertising', 'market'],
  business: ['cleardesk', 'color app', 'colorsolve', 'app store', 'business', 'website', 'offer', 'customer', 'prospect'],
  home: ['office', 'jordan', 'room', 'closet', 'house', 'home', 'repair', 'paint', 'organize', 'install'],
  admin: ['refund', 'form', 'email', 'call', 'appointment', 'paperwork', 'renew', 'license', 'bill'],
  wishlist: ['buy', 'want', 'wishlist', 'save for', 'dream', 'upgrade'],
  someday: ['someday', 'later', 'maybe', 'idea'],
}

export function classifyTask(text: string): AreaKey {
  const normalized = text.toLowerCase()
  const match = Object.entries(areaHints).find(([, hints]) =>
    hints.some((hint) => normalized.includes(hint)),
  )

  return (match?.[0] as AreaKey | undefined) ?? 'today'
}
