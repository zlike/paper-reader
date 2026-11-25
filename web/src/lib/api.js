export async function apiFetch(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

export function fetchPapers() {
  return apiFetch('/api/papers');
}

export function searchCitations(text) {
  return apiFetch('/api/citations/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
}

export function downloadCitation(source, id) {
  return apiFetch('/api/citations/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, id })
  });
}

export function savePaperProgress(paperId, payload, { keepalive = false } = {}) {
  const url = `/api/papers/${encodeURIComponent(paperId)}/progress`;
  const body = JSON.stringify(payload);
  if (keepalive && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      if (navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
    } catch {
      // Fall through to keepalive fetch.
    }
  }
  fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive
  }).catch(() => {});
}
