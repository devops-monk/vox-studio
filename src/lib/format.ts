export function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  return `${Math.round(n / 1e3)} KB`
}

export function languageName(tag: string) {
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}
