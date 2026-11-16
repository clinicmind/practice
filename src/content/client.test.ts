import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ContentLoadError, loadModels, loadModule, loadStage, loadStages, resetContentCache } from './client';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetContentCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

describe('content client', () => {
  test('loadStage fetches the index once and caches it', async () => {
    fetchMock.mockImplementation(() => json({ stage: 'foundations', title: 'F', modules: [] }));
    await loadStage();
    await loadStage();
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toMatch(/content\/en\/foundations\/index\.json$/);
  });
  test('loadModule does not touch models.json', async () => {
    fetchMock.mockImplementation(() => json({ meta: { slug: 'intake', title: 'T', version: '1.0.0', intro: 'i', skills: ['a', 'b'], reflection_prompts: [{ id: 'r1', text: 't' }] }, sessions: [], drills: [] }));
    await loadModule('intake');
    expect(urls().some((u) => u.includes('models.json'))).toBe(false);
    expect(urls()[0]).toMatch(/foundations\/intake\/module\.json$/);
  });
  test('loadModels requests models.json only when called, and caches', async () => {
    fetchMock.mockImplementation(() => json({ 'intake-e01': { model_response: 'm', why: 'w', avoid: 'a' } }));
    expect(fetchMock).not.toHaveBeenCalled();
    await loadModels('intake');
    await loadModels('intake');
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toMatch(/foundations\/intake\/models\.json$/);
  });
  test('HTTP failure throws ContentLoadError and a later call retries', async () => {
    fetchMock.mockImplementationOnce(() => json({}, 500));
    await expect(loadModels('intake')).rejects.toBeInstanceOf(ContentLoadError);
    fetchMock.mockImplementationOnce(() => json({ a: { model_response: 'm', why: 'w', avoid: 'a' } }));
    await expect(loadModels('intake')).resolves.toHaveProperty('a');
  });
  test('network failure and malformed JSON throw ContentLoadError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(loadStage()).rejects.toBeInstanceOf(ContentLoadError);
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('<html>', { status: 200 })));
    await expect(loadStage()).rejects.toBeInstanceOf(ContentLoadError);
  });
  test('wrong shape throws ContentLoadError', async () => {
    fetchMock.mockImplementationOnce(() => json({ nope: true }));
    await expect(loadModule('intake')).rejects.toBeInstanceOf(ContentLoadError);
  });
  test('slug is not allowed to escape the content path', async () => {
    await expect(loadModule('../x')).rejects.toBeInstanceOf(ContentLoadError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a stage argument selects the stage folder; the default is foundations', async () => {
    fetchMock.mockImplementation(() => json({ stage: 'demo', title: 'D', modules: [] }));
    await loadStage('en', 'demo');
    await loadStage('zh-Hant', 'demo');
    expect(urls()[0]).toMatch(/content\/en\/demo\/index\.json$/);
    expect(urls()[1]).toMatch(/content\/zh-Hant\/demo\/index\.json$/);
  });
  test('loadModule and loadModels take the stage too, and are cached per stage', async () => {
    fetchMock.mockImplementation(() => json({ 'x-e01': { model_response: 'm', why: 'w', avoid: 'a' } }));
    await loadModels('demo-intro', 'en', 'demo');
    await loadModels('demo-intro', 'en', 'demo');
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toMatch(/content\/en\/demo\/demo-intro\/models\.json$/);
  });
  test('loadStages reads stages.json', async () => {
    fetchMock.mockImplementation(() => json([{ stage: 'foundations', title: 'F' }, { stage: 'demo', title: 'D' }]));
    await expect(loadStages('en')).resolves.toHaveLength(2);
    expect(urls()[0]).toMatch(/content\/en\/stages\.json$/);
  });
  test('a stage name that is not a plain slug is refused before any request', async () => {
    await expect(loadStage('en', '../x')).rejects.toBeInstanceOf(ContentLoadError);
    await expect(loadModule('intake', 'en', 'a/b')).rejects.toBeInstanceOf(ContentLoadError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
