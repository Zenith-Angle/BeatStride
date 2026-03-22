export function msToSec(ms: number): number {
  return Number((ms / 1000).toFixed(6));
}

export function secToMs(sec: number): number {
  return Math.round(sec * 1000);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatMs(ms: number, locale = 'zh-CN'): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = new Intl.NumberFormat(locale, {
    minimumIntegerDigits: 2,
    useGrouping: false
  }).format(Math.floor(total / 60));
  const sec = new Intl.NumberFormat(locale, {
    minimumIntegerDigits: 2,
    useGrouping: false
  }).format(total % 60);
  const fraction = Math.floor((ms % 1000) / 10)
    .toString()
    .padStart(2, '0');
  return `${min}:${sec}.${fraction}`;
}

export function formatFileSize(bytes: number, locale = 'zh-CN'): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`;
}
