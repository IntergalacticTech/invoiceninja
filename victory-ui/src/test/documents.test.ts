import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { loadTaskDocument, loadTaskImage, taskDocumentPath } from '../api/documents';
import { server } from './server';
import { TOKEN_KEY } from '../config';

describe('authenticated task documents', () => {
  it('loads the protected binary route with the current token and accepts a raster screenshot', async () => {
    window.localStorage.setItem(TOKEN_KEY, 'fixture-token');
    let token = '';
    server.use(http.get('*/api/v1/documents/abc123/download', ({ request }) => {
      token = request.headers.get('X-API-TOKEN') ?? '';
      return new HttpResponse(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]), { headers: { 'Content-Type': 'application/octet-stream' } });
    }));
    const url = `${window.location.origin}/api/v1/documents/abc123/download`;
    const image = await loadTaskImage(url);
    expect(image.type).toBe('image/png');
    expect(token).toBe('fixture-token');
  });

  it('never sends the session token to an attachment provider or an arbitrary API route', async () => {
    expect(taskDocumentPath('https://external.example/api/v1/documents/abc123/download')).toBeUndefined();
    expect(taskDocumentPath(`${window.location.origin}/api/v1/invoices/abc123`)).toBeUndefined();
    await expect(loadTaskDocument('https://external.example/image.png')).rejects.toThrow('not a task document');
  });

  it('refuses to preview active content even when it is presented as an image', async () => {
    server.use(http.get('*/api/v1/documents/abc123/download', () => new HttpResponse('<svg onload="alert(1)"></svg>', { headers: { 'Content-Type': 'image/svg+xml' } })));
    await expect(loadTaskImage(`${window.location.origin}/api/v1/documents/abc123/download`)).rejects.toThrow('cannot be previewed');
  });
});
