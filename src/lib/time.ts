const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })

/** "just now", "3 min ago", "yesterday" from a unix timestamp in seconds. */
export function timeAgo(unixSeconds: number, now = Date.now()) {
  const s = Math.round(unixSeconds - now / 1000)
  const abs = Math.abs(s)
  if (abs < 45) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}
