/**
 * Browser navigation side effects, in one place so tests can spy on them
 * (jsdom does not implement navigation or window.open).
 */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
  open(url: string, target: string): Window | null {
    return window.open(url, target);
  },
  replaceUrl(url: string): void {
    window.history.replaceState(null, '', url);
  },
};
