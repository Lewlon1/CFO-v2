export type AlertSeverity = 'critical' | 'warning' | 'info'

export interface AlertPayload {
  severity: AlertSeverity
  event: string
  user_id?: string
  details: string
  metadata?: Record<string, unknown>
}

function formatAlert(p: AlertPayload): string {
  const emoji =
    p.severity === 'critical' ? '🔴' : p.severity === 'warning' ? '🟡' : 'ℹ️'
  const lines = [
    `${emoji} **${p.event}**`,
    p.details,
    p.user_id ? `User: ${p.user_id.slice(0, 8)}...` : '',
    p.metadata
      ? `\`\`\`json\n${JSON.stringify(p.metadata, null, 2)}\n\`\`\``
      : '',
    `Time: ${new Date().toISOString()}`,
  ].filter(Boolean)
  return lines.join('\n')
}

export async function sendAlert(payload: AlertPayload): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL
  const resendKey = process.env.RESEND_API_KEY
  const alertEmail = process.env.ALERT_EMAIL

  if (!webhookUrl && !resendKey) {
    console.error('[ALERT — NO CHANNEL]', JSON.stringify(payload))
    return
  }

  const message = formatAlert(payload)

  try {
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message, text: message }),
      })
    } else if (resendKey && alertEmail) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: 'alerts@thecfosoffice.com',
          to: alertEmail,
          subject: `[${payload.severity.toUpperCase()}] ${payload.event}`,
          text: message,
        }),
      })
    }
  } catch (err) {
    console.error('[ALERT SEND FAILED]', err, JSON.stringify(payload))
  }
}

/**
 * Wraps every tool in a toolbox so that when `execute` throws or returns
 * `{ error: ... }`, we fire-and-forget an alert.  The original return value
 * (including errors) is always passed through unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapToolsWithAlerts<T extends Record<string, any>>(
  toolbox: T,
  userId: string,
): T {
  const wrapped = {} as Record<string, unknown>
  for (const [name, tool] of Object.entries(toolbox)) {
    if (!tool || typeof tool.execute !== 'function') {
      wrapped[name] = tool
      continue
    }
    const origExecute = tool.execute
    wrapped[name] = {
      ...tool,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (...args: any[]) => {
        try {
          const result = await origExecute(...args)
          // Tools signal errors via { error: string } — alert on those too
          if (
            result &&
            typeof result === 'object' &&
            'error' in result &&
            typeof (result as Record<string, unknown>).error === 'string'
          ) {
            sendAlert({
              severity: 'warning',
              event: 'tool_execution_error',
              user_id: userId,
              details: `Tool "${name}" returned an error.`,
              metadata: {
                toolName: name,
                error: (result as { error: string }).error,
              },
            }).catch(() => {})
          }
          return result
        } catch (err) {
          sendAlert({
            severity: 'critical',
            event: 'tool_execution_crashed',
            user_id: userId,
            details: `Tool "${name}" threw an unhandled exception.`,
            metadata: {
              toolName: name,
              error: err instanceof Error ? err.message : String(err),
            },
          }).catch(() => {})
          throw err
        }
      },
    }
  }
  return wrapped as T
}
