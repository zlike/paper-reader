const OPENALEX_API = 'https://api.openalex.org/works';
const ARXIV_API = 'https://export.arxiv.org/api/query';
const DATACITE_API = 'https://api.datacite.org/dois';
const CROSSREF_API = 'https://api.crossref.org/works';
const S2_API = 'https://api.semanticscholar.org/graph/v1/paper';

const ENGINE_TIMEOUT_MS = 12000;
const LOOKUP_TIMEOUT_MS = 20000;

const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
const STRICT_DOI_RE = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;
const MODERN_ARXIV_RE = /^\d{4}\.\d{4,5}(?:v\d+)?$/;
const LEGACY_ARXIV_RE = /^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?$/;
const ARXIV_IN_TEXT_RE = /(?:arxiv(?:\.org\/(?:abs|pdf))?[:/]\s*|10\.48550\/arxiv\.)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)(?:\.pdf)?(?=$|[\s.,;:)\]}>"'])/i;
const BARE_ARXIV_RE = /^\s*\[?\s*(\d{4}\.\d{4,5}(?:v\d+)?)\s*\]?\s*$/;
const S2_ID_RE = /^[0-9a-f]{40}$/i;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'its', 'of', 'on', 'or', 'our', 'that', 'the', 'their', 'this',
  'to', 'using', 'via', 'with', 'without', 'towards', 'toward', 'based', 'over',
  'under', 'through', 'between', 'within', 'among', 'about', 'paper', 'study'
]);

const REQUEST_HEADERS = {
  'User-Agent': 'paper-reader/1.0 (https://github.com/zlike/paper-reader; mailto:paper-reader@users.noreply.github.com)'
};

function isValidArxivId(id) {
  return typeof id === 'string' && (MODERN_ARXIV_RE.test(id) || LEGACY_ARXIV_RE.test(id));
}

function normalizeArxivId(raw) {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\.pdf$/i, '');
  if (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(trimmed)) {
    return trimmed.replace(/V(\d+)$/, 'v$1');
  }
  const legacy = trimmed.match(/^([a-z-]+)(?:\.([a-z]{2}))?\/(\d{7})(v\d+)?$/i);
  if (legacy) {
    const archive = legacy[1].toLowerCase();
    const subcat = legacy[2] ? `.${legacy[2].toUpperCase()}` : '';
    const ver = legacy[4] ? legacy[4].toLowerCase() : '';
    return `${archive}${subcat}/${legacy[3]}${ver}`;
  }
  return null;
}

function stripArxivVersion(id) {
  return id ? id.replace(/v\d+$/i, '') : null;
}

export function extractDoi(text) {
  const match = text.match(DOI_RE);
  return match ? match[0].replace(/[.,;:)\]]+$/, '').toLowerCase() : null;
}

export function extractArxivId(text) {
  const explicit = text.match(ARXIV_IN_TEXT_RE);
  if (explicit) return normalizeArxivId(explicit[1]);
  const bare = text.match(BARE_ARXIV_RE);
  if (bare) return normalizeArxivId(bare[1]);
  return null;
}

function extractSubtitlePrefix(text) {
  const withoutRef = text.replace(/^\s*\[\d+(?:\s*[-,]\s*\d+)*\]\s*/, '').trim();
  const quoted = withoutRef.match(/["“]([^"”]{12,})["”]/)?.[1];
  const candidate = (quoted || withoutRef).trim();
  const colonIdx = candidate.indexOf(':');
  if (colonIdx <= 0) return null;
  const prefix = candidate.slice(0, colonIdx).replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const rest = candidate.slice(colonIdx + 1).replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const prefixWords = prefix.split(/\s+/).filter(Boolean);
  const restWords = rest.split(/\s+/).filter(Boolean);
  if (prefix.length < 4 || prefixWords.length === 0 || prefixWords.length > 6 || restWords.length < 2) {
    return null;
  }
  // Avoid treating "In Proceedings of: ..." or author prefixes with years as a main title prefix
  if (/^(in\s+)?proceedings|^\d{4}$/i.test(prefix)) return null;
  return { prefix, rest };
}

function extractBibTitle(text) {
  const withoutRef = text.replace(/^\s*\[\d+(?:\s*[-,]\s*\d+)*\]\s*/, '').trim();
  // Match "(YYYY). Title." or "(YYYY) Title"
  const afterYear = withoutRef.match(/\(\s*(?:19\d{2}|20[0-3]\d)[a-z]?\s*\)\s*[.,:]?\s*(.+)$/);
  if (!afterYear) return null;
  const remainder = afterYear[1].trim();
  // Take up to the first sentence-ending period (ignoring abbreviations like "et al." or single-letter initials)
  const firstSentence = remainder.split(/\.(?:\s+|$)/)[0].trim();
  const cleaned = firstSentence.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 250);
  return cleaned.length >= 5 ? cleaned : null;
}

export function citationQuery(text) {
  const doi = extractDoi(text);
  const arxivId = extractArxivId(text);
  if (doi) return { doi, arxivId, query: doi, bibTitle: null, year: null, subtitle: null };
  if (arxivId) return { doi: null, arxivId, query: arxivId, bibTitle: null, year: null, subtitle: null };
  const title = text.match(/["“]([^"”]{12,})["”]/)?.[1];
  const yearMatch = text.match(/\b(19\d{2}|20[0-3]\d)\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const bibTitle = title ? null : extractBibTitle(text);
  const subtitle = extractSubtitlePrefix(bibTitle || text);
  const cleaned = (title || text).replace(/^\s*\[\d+(?:\s*[-,]\s*\d+)*\]\s*/, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (cleaned.length < 5 || /^\d+$/.test(cleaned)) {
    throw new Error('Select the full bibliography entry or paper title, not just a reference number');
  }
  return { doi: null, arxivId: null, query: cleaned, bibTitle, year, subtitle };
}

function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function stripTags(str) {
  return decodeXmlEntities(String(str || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizeText(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(str, removeStopWords = false) {
  const words = normalizeText(str).split(' ').filter(Boolean);
  if (!removeStopWords) return words;
  const filtered = words.filter(w => w.length > 1 && !STOP_WORDS.has(w));
  return filtered.length ? filtered : words;
}

function extractArxivFromOpenAlex(item) {
  const doi = item.doi?.replace(/^https?:\/\/doi\.org\//i, '') || '';
  const fromDoi = extractArxivId(doi);
  if (fromDoi) return stripArxivVersion(fromDoi);
  const candidates = [
    item.ids?.arxiv,
    item.best_oa_location?.landing_page_url,
    item.best_oa_location?.pdf_url,
    ...(item.locations || []).flatMap(loc => [loc?.landing_page_url, loc?.pdf_url])
  ];
  for (const value of candidates) {
    if (typeof value === 'string') {
      const found = extractArxivId(value);
      if (found) return stripArxivVersion(found);
    }
  }
  return null;
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (Number.isInteger(pos) && pos >= 0 && pos < 500) words[pos] = word;
    }
  }
  return words.filter(Boolean).join(' ');
}

function parseOpenAlexWork(item) {
  const id = item?.id?.match(/^https:\/\/openalex\.org\/(W\d+)$/)?.[1];
  if (!id) return null;
  const arxivId = extractArxivFromOpenAlex(item);
  const rawPdfUrls = [item.best_oa_location, ...(item.locations || [])]
    .filter(location => location?.is_oa && location.pdf_url?.startsWith('https://'))
    .map(location => location.pdf_url);
  if (arxivId && rawPdfUrls.length > 0) {
    rawPdfUrls.push(`https://arxiv.org/pdf/${arxivId}.pdf`);
  }
  const pdfUrls = [...new Set(rawPdfUrls)].slice(0, 4);
  return {
    id,
    source: 'OPENALEX',
    title: item.title || 'Untitled paper',
    authors: (item.authorships || []).map(author => author.author?.display_name).filter(Boolean).join(', '),
    year: item.publication_year || '',
    doi: item.doi?.replace(/^https:\/\/doi\.org\//i, '').toLowerCase() || null,
    openAccess: pdfUrls.length > 0,
    pdfUrls,
    _arxivId: arxivId,
    _citationCount: Number(item.cited_by_count) || 0,
    _abstract: reconstructAbstract(item.abstract_inverted_index)
  };
}

function parseArxivFeed(xml) {
  if (typeof xml !== 'string' || !xml.includes('<entry>')) return [];
  const results = [];
  const entries = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
  for (const match of entries) {
    const entry = match[1];
    const idUrl = entry.match(/<id>([^<]+)<\/id>/)?.[1]?.trim();
    const rawArxivId = idUrl ? extractArxivId(idUrl) : null;
    if (!rawArxivId) continue;
    const baseId = stripArxivVersion(rawArxivId);
    const titleRaw = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1];
    const title = stripTags(titleRaw) || 'Untitled paper';
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
      .map(m => stripTags(m[1]))
      .filter(Boolean)
      .join(', ');
    const published = entry.match(/<published>(\d{4})/)?.[1];
    const year = published ? Number(published) : '';
    const doiRaw = entry.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/)?.[1]?.trim();
    const doi = doiRaw ? extractDoi(doiRaw) : null;
    const summary = stripTags(entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] || '');
    const pdfUrl = `https://arxiv.org/pdf/${baseId}.pdf`;
    results.push({
      id: baseId,
      source: 'ARXIV',
      title,
      authors,
      year,
      doi,
      openAccess: true,
      pdfUrls: [pdfUrl],
      _arxivId: baseId,
      _citationCount: 0,
      _abstract: summary
    });
  }
  return results;
}

function parseCrossrefWork(item) {
  const doi = typeof item?.DOI === 'string' ? item.DOI.trim().toLowerCase() : null;
  if (!doi || !STRICT_DOI_RE.test(doi)) return null;
  const rawTitle = Array.isArray(item.title) ? item.title[0] : item.title;
  const title = stripTags(rawTitle) || 'Untitled paper';
  const authors = (item.author || [])
    .map(a => [a.given, a.family].filter(Boolean).join(' ') || a.name || '')
    .filter(Boolean)
    .join(', ');
  const year = item['published-print']?.['date-parts']?.[0]?.[0]
    || item['published-online']?.['date-parts']?.[0]?.[0]
    || item.issued?.['date-parts']?.[0]?.[0]
    || item.created?.['date-parts']?.[0]?.[0]
    || '';
  const arxivId = extractArxivId(doi) ? stripArxivVersion(extractArxivId(doi)) : null;
  const pdfUrls = [];
  if (arxivId) pdfUrls.push(`https://arxiv.org/pdf/${arxivId}.pdf`);
  for (const link of item.link || []) {
    if (
      typeof link?.URL === 'string' &&
      link.URL.startsWith('https://') &&
      (link['content-type'] === 'application/pdf' || /\.pdf(?:$|\?)/i.test(link.URL))
    ) {
      pdfUrls.push(link.URL);
    }
  }
  const uniquePdfUrls = [...new Set(pdfUrls)].slice(0, 4);
  return {
    id: doi,
    source: 'CROSSREF',
    title,
    authors,
    year,
    doi,
    openAccess: uniquePdfUrls.length > 0,
    pdfUrls: uniquePdfUrls,
    _arxivId: arxivId,
    _citationCount: Number(item['is-referenced-by-count']) || 0,
    _abstract: stripTags(item.abstract || '')
  };
}

function parseDataciteArxivWork(item) {
  const doi = typeof item?.id === 'string' ? item.id.trim().toLowerCase() : null;
  const rawArxiv = doi ? extractArxivId(doi) : null;
  if (!rawArxiv) return null;
  const baseId = stripArxivVersion(rawArxiv);
  const attrs = item.attributes || {};
  const title = stripTags(attrs.titles?.[0]?.title) || 'Untitled paper';
  const authors = (attrs.creators || [])
    .map(c => [c.givenName, c.familyName].filter(Boolean).join(' ') || c.name || '')
    .filter(Boolean)
    .join(', ');
  const year = attrs.publicationYear || '';
  const abstract = stripTags(attrs.descriptions?.[0]?.description || '');
  return {
    id: baseId,
    source: 'ARXIV',
    title,
    authors,
    year,
    doi,
    openAccess: true,
    pdfUrls: [`https://arxiv.org/pdf/${baseId}.pdf`],
    _arxivId: baseId,
    _citationCount: 0,
    _abstract: abstract
  };
}

function parseSemanticScholarWork(item) {
  const id = typeof item?.paperId === 'string' ? item.paperId.trim() : null;
  if (!id || !S2_ID_RE.test(id)) return null;
  const doi = item.externalIds?.DOI ? extractDoi(String(item.externalIds.DOI)) : null;
  const rawArxiv = item.externalIds?.ArXiv ? normalizeArxivId(String(item.externalIds.ArXiv)) : null;
  const arxivId = rawArxiv ? stripArxivVersion(rawArxiv) : null;
  const pdfUrls = [];
  if (arxivId) pdfUrls.push(`https://arxiv.org/pdf/${arxivId}.pdf`);
  if (typeof item.openAccessPdf?.url === 'string' && item.openAccessPdf.url.startsWith('https://')) {
    pdfUrls.push(item.openAccessPdf.url);
  }
  const uniquePdfUrls = [...new Set(pdfUrls)].slice(0, 4);
  return {
    id,
    source: 'SEMANTIC_SCHOLAR',
    title: item.title || 'Untitled paper',
    authors: (item.authors || []).map(a => a.name).filter(Boolean).join(', '),
    year: item.year || '',
    doi,
    openAccess: uniquePdfUrls.length > 0,
    pdfUrls: uniquePdfUrls,
    _arxivId: arxivId,
    _citationCount: Number(item.citationCount) || 0,
    _abstract: item.abstract || ''
  };
}

function stripInternal(candidate) {
  const { _arxivId, _citationCount, _abstract, _score, ...pub } = candidate;
  return pub;
}

function dedupeAndMerge(candidates) {
  const merged = [];
  const byDoi = new Map();
  const byArxiv = new Map();
  const byTitle = new Map();

  for (const item of candidates) {
    if (!item) continue;
    const normTitle = normalizeText(item.title);
    const existing = (item.doi && byDoi.get(item.doi))
      || (item._arxivId && byArxiv.get(item._arxivId))
      || (normTitle.length >= 12 && byTitle.get(normTitle))
      || null;

    if (!existing) {
      const copy = { ...item, pdfUrls: [...item.pdfUrls] };
      merged.push(copy);
      if (copy.doi) byDoi.set(copy.doi, copy);
      if (copy._arxivId) byArxiv.set(copy._arxivId, copy);
      if (normTitle.length >= 12) byTitle.set(normTitle, copy);
      continue;
    }

    // Merge fields into existing record
    const combinedPdfs = [...new Set([
      ...(item.source === 'ARXIV' ? item.pdfUrls : []),
      ...existing.pdfUrls,
      ...item.pdfUrls
    ])].slice(0, 4);
    existing.pdfUrls = combinedPdfs;
    existing.openAccess = combinedPdfs.length > 0;
    if (!existing.doi && item.doi) {
      existing.doi = item.doi;
      byDoi.set(item.doi, existing);
    }
    if (!existing._arxivId && item._arxivId) {
      existing._arxivId = item._arxivId;
      byArxiv.set(item._arxivId, existing);
    }
    if ((!existing.authors || item.authors.length > existing.authors.length) && item.authors) {
      existing.authors = item.authors;
    }
    if (!existing.year && item.year) existing.year = item.year;
    if (item._citationCount > existing._citationCount) existing._citationCount = item._citationCount;
    if (item._abstract && item._abstract.length > (existing._abstract?.length || 0)) {
      existing._abstract = item._abstract;
    }

    // Prefer a re-resolvable source that yields an OA PDF:
    // ARXIV always resolves to a direct PDF; OPENALEX resolves OA PDFs when openAccess is true.
    const existingHasReliableOa = existing.source === 'ARXIV'
      || (existing.source === 'OPENALEX' && existing.pdfUrls.length > 0);
    const incomingHasReliableOa = item.source === 'ARXIV'
      || (item.source === 'OPENALEX' && item.pdfUrls.length > 0);
    if (!existingHasReliableOa && incomingHasReliableOa) {
      existing.source = item.source;
      existing.id = item.id;
    } else if (existing.source === 'CROSSREF' && (item.source === 'OPENALEX' || item.source === 'ARXIV')) {
      existing.source = item.source;
      existing.id = item.id;
    }
  }
  return merged;
}

function titleSimilarity(queryStr, titleStr) {
  const normQuery = normalizeText(queryStr);
  const normTitle = normalizeText(titleStr);
  if (!normQuery || !normTitle) return 0;
  if (normQuery === normTitle) return 1;

  const qTokens = tokenize(queryStr, true);
  const tTokens = tokenize(titleStr, true);
  if (!qTokens.length || !tTokens.length) return 0;

  const qSet = new Set(qTokens);
  const tSet = new Set(tTokens);
  let overlap = 0;
  for (const tok of tSet) {
    if (qSet.has(tok)) overlap += 1;
  }

  const dice = (2 * overlap) / (qSet.size + tSet.size);
  const titleRecall = (overlap / tSet.size) * Math.min(1, tSet.size / 4);
  let score = Math.max(dice, titleRecall * 0.92);

  // Full bibliography queries often contain the exact paper title as a substring
  if (normTitle.length >= 12 && normQuery.includes(normTitle)) {
    score = Math.max(score, 0.96);
  } else if (normQuery.length >= 12 && normTitle.includes(normQuery)) {
    score = Math.max(score, 0.88);
  }
  return score;
}

function scoreCandidate(candidate, parsedQuery, rawText) {
  let sim = titleSimilarity(parsedQuery.query, candidate.title);
  if (parsedQuery.bibTitle) {
    sim = Math.max(sim, titleSimilarity(parsedQuery.bibTitle, candidate.title));
  }
  let score = sim;

  // Main-title prefix matching for renamed preprints (e.g. "Reflexion: old subtitle" -> "Reflexion: new subtitle")
  if (parsedQuery.subtitle) {
    const normQueryPrefix = normalizeText(parsedQuery.subtitle.prefix);
    const candColon = candidate.title.indexOf(':');
    const candPrefix = candColon > 0 ? normalizeText(candidate.title.slice(0, candColon)) : '';
    const normCandTitle = normalizeText(candidate.title);
    if (candPrefix && candPrefix === normQueryPrefix) {
      const subTokens = tokenize(parsedQuery.subtitle.rest, true);
      const haystack = new Set(tokenize(`${candidate.title} ${candidate._abstract || ''}`, true));
      const matched = subTokens.filter(t => haystack.has(t)).length;
      const subRatio = subTokens.length ? matched / subTokens.length : 0;
      score = Math.max(score, 0.58 + subRatio * 0.3);
    } else if (normQueryPrefix.length >= 5 && normCandTitle.startsWith(`${normQueryPrefix} `)) {
      score += 0.15;
    }
  }

  // Year agreement
  if (parsedQuery.year && Number(candidate.year) === parsedQuery.year) {
    score += 0.12;
  }

  // Author last-name agreement (helpful for full bibliography citations)
  if (candidate.authors) {
    const rawNorm = normalizeText(rawText);
    const authorLastNames = candidate.authors
      .split(',')
      .map(a => normalizeText(a).split(' ').pop())
      .filter(name => name && name.length >= 4);
    if (authorLastNames.length) {
      const matchedAuthors = authorLastNames.filter(name => rawNorm.includes(name)).length;
      if (matchedAuthors > 0) {
        score += Math.min(0.18, matchedAuthors * 0.09);
      }
    }
  }

  // Prefer open-access PDFs and higher-cited canonical papers as tie-breakers
  if (candidate.openAccess) score += 0.04;
  if (candidate._citationCount > 0) {
    score += Math.min(0.12, Math.log10(1 + candidate._citationCount) * 0.025);
  }

  return score;
}

async function fetchJson(url, fetchImpl, timeoutMs = ENGINE_TIMEOUT_MS, extraHeaders = {}, retryOn429 = false) {
  const opts = {
    headers: { ...REQUEST_HEADERS, ...extraHeaders },
    signal: AbortSignal.timeout(timeoutMs)
  };
  let response = await fetchImpl(url, opts);
  if (retryOn429 && response.status === 429) {
    await new Promise(resolve => setTimeout(resolve, 800));
    response = await fetchImpl(url, {
      headers: { ...REQUEST_HEADERS, ...extraHeaders },
      signal: AbortSignal.timeout(timeoutMs)
    });
  }
  return response;
}

async function searchOpenAlex(query, fetchImpl, { titleOnly = false, sortByCitations = false } = {}) {
  const params = new URLSearchParams({ 'per-page': '8' });
  if (titleOnly) {
    params.set('filter', `title.search:${query}`);
    if (sortByCitations) params.set('sort', 'cited_by_count:desc');
  } else {
    params.set('search', query);
  }
  const headers = process.env.OPENALEX_API_KEY
    ? { Authorization: `Bearer ${process.env.OPENALEX_API_KEY}` }
    : {};
  const response = await fetchJson(`${OPENALEX_API}?${params}`, fetchImpl, ENGINE_TIMEOUT_MS, headers);
  if (!response.ok) throw new Error(`OpenAlex search failed (HTTP ${response.status})`);
  const data = await response.json();
  return (data.results || []).map(parseOpenAlexWork).filter(Boolean);
}

async function searchDataciteArxiv(query, fetchImpl, { titlePrefix = null } = {}) {
  const sourceText = (titlePrefix || query).replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!sourceText) return [];
  const runQuery = async dcQuery => {
    const params = new URLSearchParams({
      prefix: '10.48550',
      'page[size]': '8',
      query: dcQuery
    });
    const response = await fetchJson(`${DATACITE_API}?${params}`, fetchImpl);
    if (!response.ok) throw new Error(`DataCite search failed (HTTP ${response.status})`);
    const data = await response.json();
    return (data.data || []).map(parseDataciteArxivWork).filter(Boolean);
  };

  if (!titlePrefix && sourceText.split(/\s+/).length >= 3) {
    const exact = await runQuery(`titles.title:"${sourceText}"`);
    if (exact.length > 0) return exact;
  }
  const tokens = tokenize(sourceText, !titlePrefix).slice(0, 7);
  if (!tokens.length) return [];
  const dcQuery = tokens.length === 1
    ? `titles.title:${tokens[0]}`
    : `titles.title:(${tokens.join(' AND ')})`;
  return runQuery(dcQuery);
}

async function searchArxiv(searchQuery, fetchImpl, maxResults = 8, fallbackQuery = null) {
  const url = `${ARXIV_API}?search_query=${searchQuery}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;
  const response = await fetchJson(url, fetchImpl);
  if (response.status === 429 && fallbackQuery) {
    return searchDataciteArxiv(fallbackQuery.query, fetchImpl, { titlePrefix: fallbackQuery.titlePrefix });
  }
  if (!response.ok) throw new Error(`arXiv search failed (HTTP ${response.status})`);
  const xml = await response.text();
  return parseArxivFeed(xml);
}

async function searchCrossref(query, fetchImpl) {
  const params = new URLSearchParams({ 'query.bibliographic': query, rows: '8' });
  const response = await fetchJson(`${CROSSREF_API}?${params}`, fetchImpl, ENGINE_TIMEOUT_MS, {}, true);
  if (!response.ok) throw new Error(`Crossref search failed (HTTP ${response.status})`);
  const data = await response.json();
  return (data.message?.items || []).map(parseCrossrefWork).filter(Boolean);
}

async function searchSemanticScholar(query, fetchImpl) {
  const apiKey = process.env.S2_API_KEY;
  if (!apiKey) return [];
  const params = new URLSearchParams({
    query,
    limit: '6',
    fields: 'paperId,title,authors,year,externalIds,openAccessPdf,citationCount,abstract'
  });
  const response = await fetchJson(`${S2_API}/search?${params}`, fetchImpl, ENGINE_TIMEOUT_MS, { 'x-api-key': apiKey });
  if (response.status === 429) return [];
  if (!response.ok) throw new Error(`Semantic Scholar search failed (HTTP ${response.status})`);
  const data = await response.json();
  return (data.data || []).map(parseSemanticScholarWork).filter(Boolean);
}

function buildArxivQuery(query) {
  const tokens = tokenize(query, true).slice(0, 8);
  if (!tokens.length) return null;
  return tokens.map(t => `all:${encodeURIComponent(t)}`).join('+AND+');
}

function buildArxivPrefixQuery(subtitle) {
  const prefixTokens = tokenize(subtitle.prefix, false).slice(0, 4);
  const restTokens = tokenize(subtitle.rest, true).slice(0, 6);
  if (!prefixTokens.length) return null;
  const tiClause = prefixTokens.length === 1
    ? `ti:${encodeURIComponent(prefixTokens[0])}`
    : `(${prefixTokens.map(t => `ti:${encodeURIComponent(t)}`).join('+AND+')})`;
  if (!restTokens.length) return tiClause;
  const restClause = `(${restTokens.map(t => `all:${encodeURIComponent(t)}`).join('+OR+')})`;
  return `${tiClause}+AND+${restClause}`;
}

async function lookupOpenAlexByDoi(doi, fetchImpl, timeoutMs = LOOKUP_TIMEOUT_MS) {
  const response = await fetchJson(`${OPENALEX_API}/https://doi.org/${encodeURIComponent(doi)}`, fetchImpl, timeoutMs);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Citation search failed (HTTP ${response.status})`);
  const data = await response.json();
  return parseOpenAlexWork(data);
}

async function lookupCrossrefByDoi(doi, fetchImpl, timeoutMs = LOOKUP_TIMEOUT_MS) {
  const response = await fetchJson(`${CROSSREF_API}/${encodeURIComponent(doi)}`, fetchImpl, timeoutMs);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Crossref lookup failed (HTTP ${response.status})`);
  const data = await response.json();
  return parseCrossrefWork(data.message);
}

async function lookupDataciteArxivById(arxivId, fetchImpl, timeoutMs = LOOKUP_TIMEOUT_MS) {
  const baseId = stripArxivVersion(arxivId);
  const response = await fetchJson(`${DATACITE_API}/10.48550/arxiv.${encodeURIComponent(baseId)}`, fetchImpl, timeoutMs);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`DataCite lookup failed (HTTP ${response.status})`);
  const data = await response.json();
  return parseDataciteArxivWork(data.data);
}

async function lookupArxivById(arxivId, fetchImpl, timeoutMs = LOOKUP_TIMEOUT_MS) {
  const response = await fetchJson(`${ARXIV_API}?id_list=${encodeURIComponent(arxivId)}`, fetchImpl, timeoutMs);
  if (!response.ok) throw new Error(`arXiv lookup failed (HTTP ${response.status})`);
  const xml = await response.text();
  const entries = parseArxivFeed(xml);
  const targetBase = stripArxivVersion(arxivId);
  return entries.find(entry => stripArxivVersion(entry.id) === targetBase) || null;
}

export async function searchCitation(text, fetchImpl = fetch) {
  const parsed = citationQuery(text);

  // Fast-path 1: Direct DOI lookup (OpenAlex primary, Crossref + arXiv fallback)
  if (parsed.doi) {
    const found = [];
    let openAlexError = null;
    try {
      const oa = await lookupOpenAlexByDoi(parsed.doi, fetchImpl);
      if (oa) found.push(oa);
    } catch (error) {
      openAlexError = error;
    }

    if (!found.length || !found[0].openAccess) {
      const fallbacks = [lookupCrossrefByDoi(parsed.doi, fetchImpl)];
      if (parsed.arxivId) fallbacks.push(lookupArxivById(parsed.arxivId, fetchImpl));
      const settled = await Promise.allSettled(fallbacks);
      for (const res of settled) {
        if (res.status === 'fulfilled' && res.value) found.push(res.value);
      }
      if (!found.length && openAlexError) throw openAlexError;
    }

    const candidates = dedupeAndMerge(found).map(stripInternal);
    const exact = candidates.filter(item => item.doi?.toLowerCase() === parsed.doi);
    return { candidates, confident: exact.length === 1 ? exact[0] : null };
  }

  // Fast-path 2: Direct arXiv ID lookup (arXiv Atom API primary, OpenAlex arXiv-DOI fallback on 429/error)
  if (parsed.arxivId) {
    const baseId = stripArxivVersion(parsed.arxivId);
    let entry = null;
    let arxivError = null;
    try {
      entry = await lookupArxivById(parsed.arxivId, fetchImpl);
    } catch (error) {
      arxivError = error;
    }
    if (!entry) {
      const fallbacks = [
        lookupDataciteArxivById(baseId, fetchImpl),
        lookupOpenAlexByDoi(`10.48550/arxiv.${baseId}`, fetchImpl)
      ];
      const settled = await Promise.allSettled(fallbacks);
      for (const res of settled) {
        if (res.status === 'fulfilled' && res.value) {
          const item = res.value;
          entry = {
            ...item,
            source: 'ARXIV',
            id: baseId,
            openAccess: true,
            pdfUrls: [...new Set([`https://arxiv.org/pdf/${baseId}.pdf`, ...item.pdfUrls])].slice(0, 4)
          };
          break;
        }
      }
    }
    if (!entry) {
      if (arxivError) throw arxivError;
      return { candidates: [], confident: null };
    }
    const candidate = stripInternal(entry);
    return { candidates: [candidate], confident: candidate };
  }

  // Federated parallel search across OpenAlex, arXiv (with DataCite arXiv fallback), Crossref, and optional Semantic Scholar
  const titleQuery = parsed.bibTitle || parsed.query;
  const isShortTitle = titleQuery.split(/\s+/).filter(Boolean).length <= 3;
  const engineCalls = [
    searchOpenAlex(titleQuery, fetchImpl, { titleOnly: true, sortByCitations: isShortTitle }),
    searchCrossref(parsed.query, fetchImpl)
  ];
  if (parsed.bibTitle) {
    engineCalls.push(searchOpenAlex(parsed.query, fetchImpl));
  }
  const arxivQuery = buildArxivQuery(titleQuery);
  if (arxivQuery) {
    engineCalls.push(searchArxiv(arxivQuery, fetchImpl, 8, { query: titleQuery }));
  }
  if (process.env.S2_API_KEY) engineCalls.push(searchSemanticScholar(titleQuery, fetchImpl));

  const settled = await Promise.allSettled(engineCalls);
  const pool = [];
  let succeeded = 0;
  let firstError = null;
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      succeeded += 1;
      pool.push(...result.value);
    } else if (!firstError) {
      firstError = result.reason;
    }
  }
  if (succeeded === 0 && firstError) {
    throw new Error(`Citation search failed (${firstError.message})`);
  }

  let merged = dedupeAndMerge(pool);
  const bestSim = merged.reduce((max, item) => Math.max(max, titleSimilarity(titleQuery, item.title)), 0);

  // Broad & subtitle/renamed-preprint fallback when initial queries don't find a strong title match
  if (bestSim < 0.72) {
    const fallbackCalls = [];
    if (!parsed.bibTitle) {
      fallbackCalls.push(searchOpenAlex(parsed.query, fetchImpl));
    }
    if (parsed.subtitle) {
      fallbackCalls.push(
        searchOpenAlex(parsed.subtitle.prefix, fetchImpl, { titleOnly: true, sortByCitations: true })
      );
      const arxivPrefixQuery = buildArxivPrefixQuery(parsed.subtitle);
      if (arxivPrefixQuery) {
        fallbackCalls.push(searchArxiv(arxivPrefixQuery, fetchImpl, 8, {
          query: parsed.subtitle.prefix,
          titlePrefix: parsed.subtitle.prefix
        }));
      }
    }
    if (fallbackCalls.length) {
      const fallbackSettled = await Promise.allSettled(fallbackCalls);
      for (const result of fallbackSettled) {
        if (result.status === 'fulfilled') pool.push(...result.value);
      }
      merged = dedupeAndMerge(pool);
    }
  }

  const ranked = merged
    .map(item => ({ item, score: scoreCandidate(item, parsed, text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ item }) => stripInternal(item));

  return { candidates: ranked, confident: null };
}

export async function getCandidate(source, id, fetchImpl = fetch) {
  if (typeof source !== 'string' || typeof id !== 'string') {
    throw new Error('Invalid paper identifier');
  }

  if (source === 'OPENALEX') {
    if (!/^W\d+$/.test(id)) throw new Error('Invalid paper identifier');
    const response = await fetchJson(`${OPENALEX_API}/${id}`, fetchImpl, LOOKUP_TIMEOUT_MS);
    if (!response.ok) throw new Error(`Citation lookup failed (HTTP ${response.status})`);
    const data = await response.json();
    const item = parseOpenAlexWork(data);
    if (!item || item.id !== id) throw new Error('Paper not found in the citation index');
    return stripInternal(item);
  }

  if (source === 'ARXIV') {
    if (!isValidArxivId(id)) throw new Error('Invalid paper identifier');
    const baseId = stripArxivVersion(id);
    let entry = null;
    try {
      entry = await lookupArxivById(id, fetchImpl, LOOKUP_TIMEOUT_MS);
    } catch {
      // Fallback to OpenAlex arXiv-DOI if arXiv rate-limits with HTTP 429
    }
    if (!entry) {
      const settled = await Promise.allSettled([
        lookupDataciteArxivById(baseId, fetchImpl, LOOKUP_TIMEOUT_MS),
        lookupOpenAlexByDoi(`10.48550/arxiv.${baseId}`, fetchImpl, LOOKUP_TIMEOUT_MS)
      ]);
      for (const res of settled) {
        if (res.status === 'fulfilled' && res.value) {
          entry = res.value;
          break;
        }
      }
    }
    if (!entry) throw new Error('Paper not found in arXiv');
    const item = stripInternal(entry);
    item.source = 'ARXIV';
    item.id = id;
    item.openAccess = true;
    item.pdfUrls = [`https://arxiv.org/pdf/${id}.pdf`];
    return item;
  }

  if (source === 'CROSSREF') {
    if (!STRICT_DOI_RE.test(id)) throw new Error('Invalid paper identifier');
    const normalizedDoi = id.toLowerCase();
    const item = await lookupCrossrefByDoi(normalizedDoi, fetchImpl, LOOKUP_TIMEOUT_MS);
    if (!item) throw new Error('Paper not found in Crossref');
    if (!item.openAccess) {
      // Enrich OA PDF URLs from OpenAlex or arXiv without trusting any client-provided URL
      const enrichers = [lookupOpenAlexByDoi(normalizedDoi, fetchImpl, ENGINE_TIMEOUT_MS)];
      if (item._arxivId) enrichers.push(lookupArxivById(item._arxivId, fetchImpl, ENGINE_TIMEOUT_MS));
      const settled = await Promise.allSettled(enrichers);
      const extraPdfs = [];
      for (const res of settled) {
        if (res.status === 'fulfilled' && res.value?.pdfUrls?.length) {
          extraPdfs.push(...res.value.pdfUrls);
        }
      }
      item.pdfUrls = [...new Set([...item.pdfUrls, ...extraPdfs])].slice(0, 4);
      item.openAccess = item.pdfUrls.length > 0;
    }
    return stripInternal(item);
  }

  if (source === 'SEMANTIC_SCHOLAR') {
    if (!S2_ID_RE.test(id)) throw new Error('Invalid paper identifier');
    const headers = process.env.S2_API_KEY ? { 'x-api-key': process.env.S2_API_KEY } : {};
    const fields = 'paperId,title,authors,year,externalIds,openAccessPdf,citationCount';
    const response = await fetchJson(`${S2_API}/${id}?fields=${fields}`, fetchImpl, LOOKUP_TIMEOUT_MS, headers);
    if (!response.ok) throw new Error(`Citation lookup failed (HTTP ${response.status})`);
    const data = await response.json();
    const item = parseSemanticScholarWork(data);
    if (!item || item.id.toLowerCase() !== id.toLowerCase()) {
      throw new Error('Paper not found in Semantic Scholar');
    }
    return stripInternal(item);
  }

  throw new Error('Invalid paper identifier');
}
