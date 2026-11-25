const API = 'https://api.openalex.org/works';

export function extractDoi(text) {
  const match = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return match ? match[0].replace(/[.,;:)\]]+$/, '').toLowerCase() : null;
}

export function citationQuery(text) {
  const doi = extractDoi(text);
  if (doi) return { doi, query: doi };
  const title = text.match(/["“]([^"”]{12,})["”]/)?.[1];
  const cleaned = (title || text).replace(/^\s*\[\d+(?:\s*[-,]\s*\d+)*\]\s*/, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (cleaned.length < 5 || /^\d+$/.test(cleaned)) throw new Error('Select the full bibliography entry or paper title, not just a reference number');
  return { doi: null, query: cleaned };
}

function parseWork(item) {
  const id = item.id?.match(/^https:\/\/openalex\.org\/(W\d+)$/)?.[1];
  if (!id) return null;
  const pdfUrls = [...new Set([item.best_oa_location, ...(item.locations || [])]
    .filter(location => location?.is_oa && location.pdf_url?.startsWith('https://'))
    .map(location => location.pdf_url))].slice(0, 4);
  return {
    id, source: 'OPENALEX', title: item.title || 'Untitled paper',
    authors: (item.authorships || []).map(author => author.author?.display_name).filter(Boolean).join(', '),
    year: item.publication_year || '',
    doi: item.doi?.replace(/^https:\/\/doi\.org\//i, '') || null,
    openAccess: pdfUrls.length > 0, pdfUrls
  };
}

export async function searchCitation(text, fetchImpl = fetch) {
  const { doi, query } = citationQuery(text);
  const url = doi ? `${API}/https://doi.org/${encodeURIComponent(doi)}` : `${API}?${new URLSearchParams({ search: query, 'per-page': '8' })}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(25000) });
  if (response.status === 404 && doi) return { candidates: [], confident: null };
  if (!response.ok) throw new Error(`Citation search failed (HTTP ${response.status})`);
  const data = await response.json();
  const candidates = (doi ? [data] : data.results || []).map(parseWork).filter(Boolean);
  const exact = doi ? candidates.filter(item => item.doi?.toLowerCase() === doi) : [];
  return { candidates, confident: exact.length === 1 ? exact[0] : null };
}

export async function getCandidate(source, id, fetchImpl = fetch) {
  if (source !== 'OPENALEX' || !/^W\d+$/.test(id)) throw new Error('Invalid paper identifier');
  const response = await fetchImpl(`${API}/${id}`, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Citation lookup failed (HTTP ${response.status})`);
  const data = await response.json();
  const item = parseWork(data);
  if (!item || item.id !== id) throw new Error('Paper not found in the citation index');
  return item;
}
