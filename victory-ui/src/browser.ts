/**
 * Browser navigation side effects, in one place so tests can spy on them
 * (jsdom does not implement navigation or window.open).
 */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
  open(url: string, target: string, features?: string): Window | null {
    return window.open(url, target, features);
  },
  replaceUrl(url: string): void {
    window.history.replaceState(null, '', url);
  },
  /** Save text as a file through a temporary object URL (CSV exports). */
  download(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
