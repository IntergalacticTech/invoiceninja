import { api } from './client';
import { API_BASE } from '../config';

/** Never send the session token to a source attachment provider or another host. */
export function taskDocumentPath(value: string): string | undefined {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || !/^\/api\/v1\/documents\/[A-Za-z0-9]+\/download$/.test(url.pathname)) return undefined;
    return url.pathname.slice(API_BASE.length);
  } catch { return undefined; }
}

export function loadTaskDocument(value: string, signal?: AbortSignal): Promise<Blob> {
  const path = taskDocumentPath(value);
  if (!path) return Promise.reject(new Error('This is not a task document on this server.'));
  return api<Blob>(path, { responseType: 'blob', signal });
}

/** Preview raster images only; active HTML/SVG must never execute on the app's blob origin. */
export async function loadTaskImage(value: string, signal?: AbortSignal): Promise<Blob> {
  const blob = await loadTaskDocument(value, signal);
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Could not read the screenshot.'));
    reader.readAsArrayBuffer(blob.slice(0, 12));
  });
  const bytes = new Uint8Array(buffer);
  let type = '';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) type = 'image/png';
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = 'image/jpeg';
  else if (String.fromCharCode(...bytes.slice(0, 4)) === 'GIF8') type = 'image/gif';
  else if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') type = 'image/webp';
  if (!type) throw new Error('This attachment can be downloaded but cannot be previewed as an image.');
  return new Blob([blob], { type });
}

export async function downloadTaskDocument(value: string, name: string): Promise<void> {
  const blob = await loadTaskDocument(value);
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
