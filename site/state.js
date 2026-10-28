/** Browser-local review state. No network or framework dependency. */
export const PROJECT_ID = 'joias-leopoldina';
export const SCHEMA_VERSION = 1;
export const CATALOG_VERSION = 1;
export const REVIEW_FORMAT = 'leopoldina-client-review';
export const STORAGE_KEY = 'leopoldina-review:joias-leopoldina:v1';
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_COMMENT_LENGTH = 10000;

const DECISIONS = new Set(['keep', 'adjust', 'discard']);
const DIRECTIONS = new Set(['A', 'B', 'mix']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_RECORDS = 2000;
const LABELS = { keep: 'Quero usar', adjust: 'Quero ajustar', discard: 'Prefiro não usar' };
const now = () => new Date().toISOString();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export class ReviewValidationError extends Error {
  constructor(message, code = 'INVALID_REVIEW') {
    super(message);
    this.name = 'ReviewValidationError';
    this.code = code;
  }
}

function fail(message, code) { throw new ReviewValidationError(message, code); }

function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} deve ser um objeto.`, 'INVALID_OBJECT');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} possui um formato inválido.`, 'INVALID_OBJECT');
  }
  if (Object.keys(value).some(key => FORBIDDEN_KEYS.has(key))) {
    fail(`${label} contém uma propriedade não permitida.`, 'UNSAFE_KEY');
  }
  return value;
}

function string(value, label, maximum = MAX_COMMENT_LENGTH) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail(`${label} deve ser um texto.`, 'INVALID_TEXT');
  if (value.length > maximum) fail(`${label} excede ${maximum} caracteres.`, 'TEXT_TOO_LONG');
  return value;
}

function timestamp(value, label, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(`${label} possui uma data inválida.`, 'INVALID_DATE');
  }
  return new Date(value).toISOString();
}

function itemId(value) {
  if (typeof value !== 'string' || !/^[A-Z][A-Za-z0-9_-]{0,63}$/.test(value) || FORBIDDEN_KEYS.has(value)) {
    fail('Código de peça inválido.', 'INVALID_ITEM_ID');
  }
  return value;
}

function projectId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(value)) {
    fail('Identificação do projeto inválida.', 'INVALID_PROJECT');
  }
  return value;
}

function overview(input = {}) {
  plain(input, 'Preferências gerais');
  const direction = input.direction ?? null;
  if (direction !== null && !DIRECTIONS.has(direction)) {
    fail('A preferência de direção deve ser A, B ou mix.', 'INVALID_DIRECTION');
  }
  return { direction, comment: string(input.comment, 'Comentário geral') };
}

function reviewer(input = {}) {
  plain(input, 'Avaliadora');
  return { name: string(input.name, 'Nome', 200) };
}

export function createSession(id = PROJECT_ID) {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: projectId(id),
    catalogVersion: CATALOG_VERSION,
    reviewer: { name: '' },
    overview: { direction: null, comment: '' },
    items: {},
    updatedAt: now(),
  };
}

/** Empty entries are allowed. A missing rating is different from a low rating. */
export function normalizeEntry(input = {}) {
  plain(input, 'Avaliação da peça');
  const rating = input.rating ?? null;
  if (rating !== null && (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 1 || rating > 5 || !Number.isInteger(rating * 2))) {
    fail('A nota deve ser de 1 a 5, em intervalos de meia estrela.', 'INVALID_RATING');
  }
  const decision = input.decision ?? null;
  if (decision !== null && !DECISIONS.has(decision)) {
    fail('A escolha da peça é inválida.', 'INVALID_DECISION');
  }
  return {
    rating,
    decision,
    comment: string(input.comment, 'Comentário da peça'),
    updatedAt: timestamp(input.updatedAt, 'Data da avaliação'),
  };
}

export function hasFeedback(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return entry.rating !== null && entry.rating !== undefined
    || entry.decision !== null && entry.decision !== undefined
    || typeof entry.comment === 'string' && entry.comment.trim().length > 0;
}

function normalizeSession(input, expectedProjectId = PROJECT_ID) {
  plain(input, 'Avaliação');
  if (input.schemaVersion !== SCHEMA_VERSION) fail('Esta versão de avaliação não é compatível.', 'UNSUPPORTED_VERSION');
  if (input.projectId !== expectedProjectId) fail('Este arquivo pertence a outro projeto.', 'PROJECT_MISMATCH');
  if (input.catalogVersion !== CATALOG_VERSION) fail('Esta versão do catálogo não é compatível.', 'CATALOG_MISMATCH');
  const result = createSession(expectedProjectId);
  result.reviewer = reviewer(input.reviewer ?? {});
  result.overview = overview(input.overview ?? {});
  const records = plain(input.items ?? {}, 'Peças');
  if (Object.keys(records).length > MAX_RECORDS) fail('O arquivo possui peças demais.', 'TOO_MANY_ITEMS');
  for (const [id, value] of Object.entries(records)) result.items[itemId(id)] = normalizeEntry(value);
  result.updatedAt = timestamp(input.updatedAt, 'Data geral', now());
  return result;
}

export function updateEntry(session, id, patch) {
  itemId(id);
  plain(patch, 'Alteração da peça');
  const result = normalizeSession(session, session.projectId);
  const previous = result.items[id] ?? normalizeEntry();
  const next = { ...previous };
  for (const field of ['rating', 'decision', 'comment']) {
    if (own(patch, field) && patch[field] !== undefined) next[field] = patch[field];
  }
  next.updatedAt = now();
  result.items[id] = normalizeEntry(next);
  result.updatedAt = next.updatedAt;
  return result;
}

export function updateOverview(session, patch) {
  plain(patch, 'Alteração das preferências');
  const result = normalizeSession(session, session.projectId);
  const next = { ...result.overview };
  for (const field of ['direction', 'comment']) if (own(patch, field) && patch[field] !== undefined) next[field] = patch[field];
  result.overview = overview(next);
  result.updatedAt = now();
  return result;
}

export function updateReviewer(session, patch) {
  plain(patch, 'Alteração da avaliadora');
  const result = normalizeSession(session, session.projectId);
  result.reviewer = reviewer({ name: own(patch, 'name') ? patch.name : result.reviewer.name });
  result.updatedAt = now();
  return result;
}

function emptySummary() {
  return { total: 0, reviewed: 0, unreviewed: 0, rated: 0, commented: 0, keep: 0, adjust: 0, discard: 0, averageRating: null };
}

export function summarize(session, items) {
  const result = emptySummary();
  result.byDirection = { A: emptySummary(), B: emptySummary() };
  let totalStars = 0;
  const directionStars = { A: 0, B: 0 };
  for (const item of items) {
    const entry = session.items?.[item.id];
    const direction = item.direction === 'B' ? 'B' : 'A';
    const sums = [result, result.byDirection[direction]];
    for (const sum of sums) {
      sum.total += 1;
      if (hasFeedback(entry)) sum.reviewed += 1;
      else sum.unreviewed += 1;
      if (entry?.rating !== null && entry?.rating !== undefined) sum.rated += 1;
      if (entry?.comment?.trim()) sum.commented += 1;
      if (DECISIONS.has(entry?.decision)) sum[entry.decision] += 1;
    }
    if (entry?.rating !== null && entry?.rating !== undefined) {
      totalStars += entry.rating;
      directionStars[direction] += entry.rating;
    }
  }
  if (result.rated) result.averageRating = Math.round(totalStars / result.rated * 100) / 100;
  for (const direction of ['A', 'B']) {
    const sum = result.byDirection[direction];
    if (sum.rated) sum.averageRating = Math.round(directionStars[direction] / sum.rated * 100) / 100;
  }
  return result;
}

/** The export includes unanswered pieces as null, not as dislikes or zero stars. */
export function exportReview(session, items) {
  const clean = normalizeSession(session, session.projectId);
  return {
    format: REVIEW_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    project: { id: clean.projectId, title: 'Joias Leopoldina', catalogVersion: CATALOG_VERSION },
    exportedAt: now(),
    updatedAt: clean.updatedAt,
    reviewer: clean.reviewer,
    overview: clean.overview,
    summary: summarize(clean, items),
    items: items.map(item => {
      const entry = normalizeEntry(clean.items[item.id] ?? {});
      return {
        id: item.id,
        title: item.title,
        direction: item.direction,
        category: item.category,
        type: item.type,
        asset: item.src,
        ...entry,
        decisionLabel: entry.decision === null ? null : LABELS[entry.decision],
        reviewed: hasFeedback(entry),
      };
    }),
  };
}

/** Parse only our review format. Imported titles/URLs/summary are never trusted. */
export function parseReview(input, items, options = {}) {
  const expectedProjectId = options.projectId ?? PROJECT_ID;
  let data;
  let serialized;
  try {
    serialized = typeof input === 'string' ? input : JSON.stringify(input);
  } catch {
    fail('Não foi possível ler este JSON.', 'INVALID_JSON');
  }
  if (typeof serialized !== 'string') fail('Selecione um arquivo JSON de avaliação.', 'INVALID_JSON');
  if (new TextEncoder().encode(serialized).byteLength > MAX_IMPORT_BYTES) fail('O JSON deve ter no máximo 4 MB.', 'FILE_TOO_LARGE');
  try { data = typeof input === 'string' ? JSON.parse(serialized) : input; }
  catch { fail('O arquivo não contém um JSON válido.', 'INVALID_JSON'); }
  plain(data, 'Arquivo');
  if (data.format !== REVIEW_FORMAT) fail('Este arquivo não é uma avaliação exportada por este site.', 'FORMAT_MISMATCH');
  if (data.schemaVersion !== SCHEMA_VERSION) fail('Esta versão de avaliação não é compatível.', 'UNSUPPORTED_VERSION');
  const project = plain(data.project, 'Projeto');
  if (project.id !== expectedProjectId) fail('Este arquivo pertence a outro projeto.', 'PROJECT_MISMATCH');
  if (project.catalogVersion !== CATALOG_VERSION) fail('Esta versão do catálogo não é compatível.', 'CATALOG_MISMATCH');
  if (!Array.isArray(data.items)) fail('A lista de peças está ausente ou inválida.', 'INVALID_ITEMS');
  if (data.items.length > MAX_RECORDS) fail('O arquivo possui peças demais.', 'TOO_MANY_ITEMS');
  const known = new Set(items.map(item => item.id));
  const seen = new Set();
  const session = createSession(expectedProjectId);
  session.reviewer = reviewer(data.reviewer ?? {});
  session.overview = overview(data.overview ?? {});
  session.updatedAt = timestamp(data.updatedAt ?? data.exportedAt, 'Data da avaliação', now());
  const unknownIds = [];
  for (const record of data.items) {
    plain(record, 'Peça importada');
    const id = itemId(record.id);
    if (seen.has(id)) fail(`A peça ${id} aparece mais de uma vez no arquivo.`, 'DUPLICATE_ID');
    seen.add(id);
    const entry = normalizeEntry(record);
    if (!known.has(id)) { unknownIds.push(id); continue; }
    if (hasFeedback(entry) || entry.updatedAt !== null) session.items[id] = entry;
  }
  const warnings = unknownIds.length ? [`${unknownIds.length} código(s) não pertencem ao catálogo atual e foram ignorados.`] : [];
  return { session, unknownIds, warnings };
}

/** Merge existing answers with imported answers. Incoming entries win as a whole.
 * Empty, untouched exported rows do not erase an existing answer.
 * `replace: true` intentionally restores the complete imported session instead.
 */
export function mergeSessions(current, incoming, options = {}) {
  const left = normalizeSession(current, current.projectId);
  const right = normalizeSession(incoming, current.projectId);
  if (options.replace) return right;
  for (const [id, entry] of Object.entries(right.items)) left.items[id] = { ...entry };
  if (right.reviewer.name.trim()) left.reviewer = { ...right.reviewer };
  if (right.overview.direction !== null) left.overview.direction = right.overview.direction;
  if (right.overview.comment.trim()) left.overview.comment = right.overview.comment;
  left.updatedAt = now();
  return left;
}

function readStored(raw) {
  if (typeof raw !== 'string') fail('Conteúdo salvo inválido.', 'INVALID_STORAGE');
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) fail('Conteúdo salvo muito grande.', 'FILE_TOO_LARGE');
  let value;
  try { value = JSON.parse(raw); }
  catch { fail('Conteúdo salvo inválido.', 'INVALID_JSON'); }
  return normalizeSession(value);
}

/** Storage failures are explicit; corrupt primary data is never overwritten here. */
export function loadSession(storage, key = STORAGE_KEY) {
  let raw;
  try { raw = storage.getItem(key); }
  catch {
    return { ok: false, status: 'unavailable', session: createSession(), writeBlocked: false, warning: 'Este navegador não permitiu ler os dados salvos. Baixe um JSON para guardar sua avaliação.' };
  }
  if (raw === null) return { ok: true, status: 'empty', session: createSession(), writeBlocked: false, warning: null };
  try { return { ok: true, status: 'saved', session: readStored(raw), writeBlocked: false, warning: null }; }
  catch {
    let recovered = null;
    try {
      const backup = storage.getItem(`${key}:backup`);
      if (backup !== null) recovered = readStored(backup);
    } catch { /* Preserve the unreadable original even when its backup is unavailable. */ }
    return {
      ok: false,
      status: recovered ? 'recovered' : 'corrupt',
      session: recovered ?? createSession(),
      writeBlocked: true,
      warning: recovered
        ? 'Os dados principais não puderam ser lidos. Recuperamos a cópia anterior. Baixe o JSON recuperado antes de limpar os dados deste navegador.'
        : 'Os dados salvos não puderam ser lidos e foram preservados. Importe uma cópia JSON ou limpe os dados para começar novamente.',
    };
  }
}

export function saveSession(storage, key = STORAGE_KEY, session) {
  let clean;
  try { clean = normalizeSession(session); }
  catch (error) { return { ok: false, status: 'invalid', warning: error.message, writeBlocked: false }; }
  let previous;
  try { previous = storage.getItem(key); }
  catch {
    return { ok: false, status: 'unavailable', writeBlocked: false, warning: 'Não foi possível salvar neste navegador. Baixe o JSON para guardar suas alterações.' };
  }
  if (previous !== null) {
    try { readStored(previous); }
    catch {
      return { ok: false, status: 'corrupt', writeBlocked: true, warning: 'O conteúdo antigo está ilegível e foi preservado. Exporte sua avaliação atual antes de limpar o armazenamento.' };
    }
  }
  let warning = null;
  if (previous !== null) {
    try { storage.setItem(`${key}:backup`, previous); }
    catch { warning = 'Sua avaliação foi salva, mas o navegador não permitiu atualizar a cópia de segurança. Baixe um JSON.'; }
  }
  try { storage.setItem(key, JSON.stringify(clean)); }
  catch {
    return { ok: false, status: 'unavailable', writeBlocked: false, warning: 'Não foi possível salvar as alterações neste navegador. Mantenha esta página aberta e baixe o JSON.' };
  }
  return { ok: true, status: 'saved', session: clean, warning, writeBlocked: false };
}

/** Call only after an explicit reset/recovery confirmation in the interface. */
export function clearSession(storage, key = STORAGE_KEY) {
  try {
    storage.removeItem(key);
    storage.removeItem(`${key}:backup`);
    return { ok: true, status: 'cleared', warning: null };
  } catch {
    return { ok: false, status: 'unavailable', warning: 'Não foi possível limpar completamente os dados deste navegador.' };
  }
}
