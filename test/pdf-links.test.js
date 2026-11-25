import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinationPosition, isSafeExternalUrl, isSupportedLink, resolveDestination } from '../public/pdf-links.js';

test('only supported external link schemes and PDF link annotations are enabled', () => {
  for (const url of ['https://example.org/a', 'http://example.org', 'mailto:author@example.org']) {
    assert.equal(isSafeExternalUrl(url), true);
    assert.equal(isSupportedLink({ subtype: 'Link', url }), true);
  }
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.org/a', '//example.org', 'not a URL']) {
    assert.equal(isSafeExternalUrl(url), false);
    assert.equal(isSupportedLink({ subtype: 'Link', url }), false);
  }
  assert.equal(isSupportedLink({ subtype: 'Link', unsafeUrl: 'javascript:alert(1)' }), false);
  assert.equal(isSupportedLink({ subtype: 'Link', dest: 'references' }), true);
  assert.equal(isSupportedLink({ subtype: 'Link', action: 'NextPage' }), true);
  assert.equal(isSupportedLink({ subtype: 'Link', action: 'Launch' }), false);
  assert.equal(isSupportedLink({ subtype: 'Text', url: 'https://example.org' }), false);
});

test('named and explicit destinations resolve page references and reject invalid pages', async () => {
  const reference = { num: 25, gen: 0 };
  const explicit = [reference, { name: 'XYZ' }, 30, 400, null];
  const document = {
    numPages: 5,
    getDestination: async name => name === 'references' ? explicit : null,
    getPageIndex: async ref => { assert.equal(ref, reference); return 3; }
  };
  assert.deepEqual(await resolveDestination(document, 'references'), { pageNumber: 4, destination: explicit });
  assert.equal((await resolveDestination(document, [1, { name: 'Fit' }])).pageNumber, 2);
  await assert.rejects(resolveDestination(document, 'missing'), /not found/);
  await assert.rejects(resolveDestination(document, [5, { name: 'Fit' }]), /invalid page/);
});

test('destination coordinates use the destination page viewport', () => {
  const page = { view: [0, 0, 600, 800] };
  const viewport = {
    convertToViewportPoint: (x, y) => [x * 2, (800 - y) * 2],
    convertToViewportRectangle: ([x1, y1, x2, y2]) => [x1 * 2, (800 - y1) * 2, x2 * 2, (800 - y2) * 2]
  };
  assert.deepEqual(destinationPosition(page, viewport, [0, { name: 'XYZ' }, 30, 500, null]), { x: 60, y: 600 });
  assert.deepEqual(destinationPosition(page, viewport, [0, { name: 'FitH' }, 400]), { x: 0, y: 800 });
  assert.deepEqual(destinationPosition(page, viewport, [0, { name: 'FitV' }, 40]), { x: 80, y: 0 });
  assert.deepEqual(destinationPosition(page, viewport, [0, { name: 'FitR' }, 10, 200, 100, 600]), { x: 20, y: 400 });
  assert.deepEqual(destinationPosition(page, viewport, [0, { name: 'Fit' }]), { x: 0, y: 0 });
  assert.throws(() => destinationPosition(page, viewport, [0, { name: 'FitR' }, 0]), /Invalid/);
});
