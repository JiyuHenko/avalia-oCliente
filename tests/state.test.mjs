import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_ID, REVIEW_FORMAT, STORAGE_KEY, MAX_IMPORT_BYTES,
  ReviewValidationError, createSession, normalizeEntry, hasFeedback,
  updateEntry, updateOverview, updateReviewer, summarize,
  exportReview, parseReview, mergeSessions, loadSession, saveSession, clearSession,
} from '../site/state.js';

const catalog = [
  { id: 'A01', title: 'Logo A', direction: 'A', category: 'Identidade', type: 'image', src: 'media/a01.webp' },
  { id: 'B01', title: 'Cartão B', direction: 'B', category: 'Cartões', type: 'image', src: 'media/b01.webp' },
  { id: 'V01', title: 'Vídeo', direction: 'A', category: 'Vídeos', type: 'video', src: 'media/v01.mp4' },
];
const storage = () => {
  const map = new Map();
  return { map, getItem(key) { return map.has(key) ? map.get(key) : null; }, setItem(key, value) { map.set(key, String(value)); }, removeItem(key) { map.delete(key); } };
};
function rated() {
  let session = updateEntry(createSession(), 'A01', { rating: 3.5, decision: 'adjust', comment: 'Usar marrom <sem perder> o símbolo.' });
  session = updateEntry(session, 'V01', { decision: 'keep' });
  session = updateOverview(session, { direction: 'mix', comment: 'Cores da B, embalagens da A.' });
  return updateReviewer(session, { name: 'Leopoldina' });
}
function validation(fn, code) {
  assert.throws(fn, error => error instanceof ReviewValidationError && (!code || error.code === code));
}

test('optional feedback is not treated as a rejection or a zero rating', () => {
  const session = createSession();
  assert.equal(hasFeedback(normalizeEntry()), false);
  assert.equal(hasFeedback({ comment: '   ' }), false);
  const summary = summarize(session, catalog);
  assert.equal(summary.reviewed, 0);
  assert.equal(summary.unreviewed, 3);
  assert.equal(summary.discard, 0);
  assert.equal(summary.averageRating, null);
  const exported = exportReview(session, catalog);
  assert.equal(exported.items.length, 3);
  assert.ok(exported.items.every(item => item.rating === null && item.decision === null && item.reviewed === false));
});

test('half stars are accepted; strings, out-of-range and arbitrary fractions are rejected', () => {
  for (let rating = 1; rating <= 5; rating += 0.5) assert.equal(normalizeEntry({ rating }).rating, rating);
  for (const rating of [0, 0.5, -0.5, 5.5, 3.2, NaN, Infinity, '3.5']) validation(() => normalizeEntry({ rating }), 'INVALID_RATING');
  validation(() => normalizeEntry({ decision: 'maybe' }), 'INVALID_DECISION');
});

test('updates are immutable and can explicitly clear an answer', () => {
  const original = createSession();
  const first = updateEntry(original, 'A01', { rating: 3.5, comment: 'Teste' });
  assert.deepEqual(original.items, {});
  const next = updateEntry(first, 'A01', { rating: null, comment: '' });
  assert.equal(first.items.A01.rating, 3.5);
  assert.equal(next.items.A01.rating, null);
  assert.equal(hasFeedback(next.items.A01), false);
  assert.ok(next.items.A01.updatedAt);
  const overview = updateOverview(first, { direction: 'B' });
  assert.equal(first.overview.direction, null);
  assert.equal(overview.overview.direction, 'B');
  validation(() => updateEntry(first, '__proto__', { rating: 5 }), 'INVALID_ITEM_ID');
});

test('summary counts ratings, comments, decisions and videos without requiring every item', () => {
  const sum = summarize(rated(), catalog);
  assert.equal(sum.total, 3);
  assert.equal(sum.reviewed, 2);
  assert.equal(sum.rated, 1);
  assert.equal(sum.commented, 1);
  assert.equal(sum.adjust, 1);
  assert.equal(sum.keep, 1);
  assert.equal(sum.averageRating, 3.5);
  assert.equal(sum.byDirection.A.reviewed, 2);
  assert.equal(sum.byDirection.B.unreviewed, 1);
});

test('export/import roundtrip preserves unicode, half stars, optional fields and videos', () => {
  const original = rated();
  const exported = exportReview(original, catalog);
  assert.equal(exported.format, REVIEW_FORMAT);
  assert.equal(exported.items[0].decisionLabel, 'Quero ajustar');
  const parsed = parseReview(JSON.stringify(exported), catalog);
  assert.deepEqual(parsed.session.items, original.items);
  assert.deepEqual(parsed.session.overview, original.overview);
  assert.deepEqual(parsed.session.reviewer, original.reviewer);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(exported.items[1].updatedAt, null);
  assert.equal(parsed.session.items.B01, undefined);
});

test('import rejects malformed JSON, mismatched projects, unsupported versions and duplicate IDs', () => {
  validation(() => parseReview('{oops', catalog), 'INVALID_JSON');
  const example = exportReview(rated(), catalog);
  validation(() => parseReview({ ...example, format: 'other' }, catalog), 'FORMAT_MISMATCH');
  validation(() => parseReview({ ...example, schemaVersion: 2 }, catalog), 'UNSUPPORTED_VERSION');
  validation(() => parseReview({ ...example, items: [{ id: 'A01', rating: 0.5 }] }, catalog), 'INVALID_RATING');
  validation(() => parseReview({ ...example, project: { ...example.project, id: 'another-client' } }, catalog), 'PROJECT_MISMATCH');
  validation(() => parseReview({ ...example, project: { ...example.project, catalogVersion: 2 } }, catalog), 'CATALOG_MISMATCH');
  validation(() => parseReview({ ...example, items: [example.items[0], example.items[0]] }, catalog), 'DUPLICATE_ID');
  validation(() => parseReview({ ...example, items: {} }, catalog), 'INVALID_ITEMS');
});

test('import limits size and fields, rejects unsafe keys, ignores unknown catalog IDs', () => {
  validation(() => parseReview(' '.repeat(MAX_IMPORT_BYTES + 1), catalog), 'FILE_TOO_LARGE');
  const example = exportReview(rated(), catalog);
  example.items[0].comment = 'a'.repeat(10001);
  validation(() => parseReview(example, catalog), 'TEXT_TOO_LONG');
  const safe = exportReview(rated(), catalog);
  safe.items.push({ id: 'A99', rating: 4.5, comment: 'Outra peça' });
  safe.items[0].asset = 'javascript:alert(1)';
  safe.items[0].title = '<img src=x onerror=alert(1)>';
  const result = parseReview(safe, catalog);
  assert.deepEqual(result.unknownIds, ['A99']);
  assert.equal(result.session.items.A99, undefined);
  assert.equal(result.session.items.A01.asset, undefined);
  assert.equal(exportReview(result.session, catalog).items[0].asset, 'media/a01.webp');
  assert.ok(result.warnings.length);
  const hostile = JSON.parse(JSON.stringify(exportReview(createSession(), catalog)));
  Object.defineProperty(hostile.reviewer, '__proto__', { enumerable: true, value: { polluted: true } });
  validation(() => parseReview(hostile, catalog), 'UNSAFE_KEY');
  assert.equal({}.polluted, undefined);
});

test('merge keeps existing unanswered imports and supports an explicit complete replacement', () => {
  const current = updateEntry(rated(), 'B01', { decision: 'keep', comment: 'Já escolhido' });
  const incoming = parseReview(exportReview(updateEntry(createSession(), 'A01', { rating: 4.5 }), catalog), catalog).session;
  const merged = mergeSessions(current, incoming);
  assert.equal(merged.items.A01.rating, 4.5);
  assert.equal(merged.items.B01.comment, 'Já escolhido');
  assert.equal(merged.reviewer.name, 'Leopoldina');
  assert.equal(current.items.A01.rating, 3.5);
  const replaced = mergeSessions(current, incoming, { replace: true });
  assert.equal(replaced.items.B01, undefined);
  assert.equal(replaced.reviewer.name, '');
  const cleared = updateEntry(incoming, 'A01', { rating: null, comment: '', decision: null });
  assert.equal(hasFeedback(mergeSessions(current, cleared).items.A01), false);
});

test('save/load persists a complete session and retains the previous valid backup', () => {
  const store = storage();
  assert.equal(loadSession(store).status, 'empty');
  const first = rated();
  assert.equal(saveSession(store, STORAGE_KEY, first).ok, true);
  const second = updateEntry(first, 'B01', { rating: 1 });
  assert.equal(saveSession(store, STORAGE_KEY, second).ok, true);
  assert.deepEqual(loadSession(store).session.items, second.items);
  assert.deepEqual(JSON.parse(store.getItem(`${STORAGE_KEY}:backup`)).items, first.items);
});

test('storage read/write failures never claim a successful save', () => {
  const unavailable = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadSession(unavailable).ok, false);
  assert.equal(saveSession(unavailable, STORAGE_KEY, rated()).ok, false);
  const quota = storage();
  quota.setItem = () => { throw new Error('quota'); };
  const result = saveSession(quota, STORAGE_KEY, rated());
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(quota.getItem(STORAGE_KEY), null);
});

test('corrupt storage recovers backup and preserves original until explicit clearing', () => {
  const store = storage();
  const original = rated();
  store.setItem(STORAGE_KEY, '{bad json');
  store.setItem(`${STORAGE_KEY}:backup`, JSON.stringify(original));
  const result = loadSession(store);
  assert.equal(result.status, 'recovered');
  assert.equal(result.writeBlocked, true);
  assert.deepEqual(result.session.items, original.items);
  assert.equal(saveSession(store, STORAGE_KEY, original).ok, false);
  assert.equal(store.getItem(STORAGE_KEY), '{bad json');
  assert.equal(clearSession(store).ok, true);
  assert.equal(store.getItem(`${STORAGE_KEY}:backup`), null);
  assert.equal(saveSession(store, STORAGE_KEY, original).ok, true);
});

test('unrecoverable corruption is reported without destroying the primary value', () => {
  const store = storage();
  store.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99 }));
  const before = store.getItem(STORAGE_KEY);
  const result = loadSession(store);
  assert.equal(result.status, 'corrupt');
  assert.equal(result.writeBlocked, true);
  assert.equal(result.session.projectId, PROJECT_ID);
  assert.equal(store.getItem(STORAGE_KEY), before);
});
