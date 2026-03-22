export function getPlatformExeName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base;
}
