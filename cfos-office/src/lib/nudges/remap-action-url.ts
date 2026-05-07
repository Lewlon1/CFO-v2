/**
 * Remaps legacy nudge action_urls to the new /(office) route structure.
 *
 * Nudges in the database were created with old routes (e.g. /chat?nudge=..., /bills, /goals).
 * This utility translates them at render time so existing data doesn't need migration.
 */

interface NavigateAction {
  type: 'navigate'
  target: string
}

interface ChatAction {
  type: 'chat'
  chatType: string
  metadata?: Record<string, string>
}

export type RemappedAction = NavigateAction | ChatAction

export function remapActionUrl(url: string | null): RemappedAction {
  if (!url) return { type: 'navigate', target: '/office' }

  // /chat?nudge=X → open chat sheet with nudge context
  if (url.startsWith('/chat') && url.includes('nudge=')) {
    const params = new URLSearchParams(url.split('?')[1] ?? '')
    return {
      type: 'chat',
      chatType: 'nudge_initiated',
      metadata: Object.fromEntries(params),
    }
  }

  // /chat?type=monthly_review → open chat sheet with monthly review
  if (url.startsWith('/chat') && url.includes('type=')) {
    const params = new URLSearchParams(url.split('?')[1] ?? '')
    return {
      type: 'chat',
      chatType: params.get('type') ?? 'general',
    }
  }

  // Direct route remappings
  const routeMap: Record<string, string> = {
    '/bills': '/office/cash-flow/bills',
    '/goals': '/office',
    '/dashboard': '/office',
    '/transactions': '/office/cash-flow/transactions',
    '/chat': '/office',
  }

  for (const [oldRoute, newRoute] of Object.entries(routeMap)) {
    if (url === oldRoute) {
      return { type: 'navigate', target: newRoute }
    }
  }

  // If it's already an /office route, pass through
  if (url.startsWith('/office')) {
    return { type: 'navigate', target: url }
  }

  // Default: navigate to the URL as-is
  return { type: 'navigate', target: url }
}
