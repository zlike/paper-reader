import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDoi,
  extractArxivId,
  citationQuery,
  searchCitation,
  getCandidate,
  clearSearchCache,
  resetOpenAlexCooldown
} from '../src/citations.js';

function jsonResponse(body, status = 200, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => lower[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function xmlResponse(xml, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => xml
  };
}

function arxivFeed(entries) {
  const body = entries.map(e => `
    <entry>
      <id>http://arxiv.org/abs/${e.id}</id>
      <published>${e.year || 2023}-03-20T00:00:00Z</published>
      <title>${e.title}</title>
      <summary>${e.summary || ''}</summary>
      ${(e.authors || []).map(a => `<author><name>${a}</name></author>`).join('')}
      ${e.doi ? `<arxiv:doi>${e.doi}</arxiv:doi>` : ''}
    </entry>
  `).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${body}</feed>`;
}

test('extractDoi and extractArxivId handle modern, legacy, URL, and DOI forms', () => {
  assert.equal(extractDoi('DOI: 10.1145/3292500.3330701.'), '10.1145/3292500.3330701');
  assert.equal(extractDoi('No identifier here'), null);

  assert.equal(extractArxivId('arXiv:2303.11366v4'), '2303.11366v4');
  assert.equal(extractArxivId('See https://arxiv.org/abs/2303.11366 for details'), '2303.11366');
  assert.equal(extractArxivId('https://arxiv.org/pdf/2303.11366.pdf'), '2303.11366');
  assert.equal(extractArxivId('10.48550/arXiv.2303.11366'), '2303.11366');
  assert.equal(extractArxivId('2303.11366'), '2303.11366');
  assert.equal(extractArxivId('arXiv:cs/0123456'), 'cs/0123456');
  assert.equal(extractArxivId('https://arxiv.org/abs/math.GT/0309136v1'), 'math.GT/0309136v1');
  assert.equal(extractArxivId('Attention Is All You Need (2017)'), null);
});

test('citationQuery extracts DOI, arXiv ID, year, subtitle prefix, and rejects bare numbers', () => {
  assert.equal(citationQuery('arXiv:2303.11366').arxivId, '2303.11366');
  const q = citationQuery('Reflexion: an autonomous agent with dynamic memory and self-reflection');
  assert.equal(q.doi, null);
  assert.equal(q.arxivId, null);
  assert.deepEqual(q.subtitle, {
    prefix: 'Reflexion',
    rest: 'an autonomous agent with dynamic memory and self-reflection'
  });
  const bib = citationQuery('[14] Vaswani et al. (2017). "Attention Is All You Need". NeurIPS.');
  assert.equal(bib.year, 2017);
  assert.equal(bib.query, 'Attention Is All You Need');
  assert.throws(() => citationQuery('[42]'), /bibliography entry/);
});

test('citationQuery applies word-aware dehyphenation to pasted line-wrapped titles and references', () => {
  const selfRefine = citationQuery('Self-Refine: Iterative Refinement with Self-\nFeedback');
  assert.equal(selfRefine.query, 'Self-Refine Iterative Refinement with Self-Feedback');
  assert.deepEqual(selfRefine.subtitle, {
    prefix: 'Self-Refine',
    rest: 'Iterative Refinement with Self-Feedback'
  });

  const enDash = citationQuery('Self-Refine: Iterative Refinement with Self–\nFeedback');
  assert.equal(enDash.query, 'Self-Refine Iterative Refinement with Self-Feedback');

  const splitWord = citationQuery('Reflexion: an au-\ntonomous agent with dynamic in-\nformation memory');
  assert.equal(splitWord.query, 'Reflexion an autonomous agent with dynamic information memory');

  const wrappedBib = citationQuery('[1] Madaan, A. et al. (2023). Self-Refine: Iterative Refinement with Self-\nFeedback. NeurIPS.');
  assert.equal(wrappedBib.bibTitle, 'Self-Refine Iterative Refinement with Self-Feedback');
});

test('direct arXiv ID fast-path returns confident match with direct OA PDF', async () => {
  const fetchImpl = async url => {
    assert.match(url, /export\.arxiv\.org\/api\/query\?id_list=2303\.11366/);
    return xmlResponse(arxivFeed([{
      id: '2303.11366v4',
      title: 'Reflexion: Language Agents with Verbal Reinforcement Learning',
      authors: ['Noah Shinn', 'Federico Cassano'],
      year: 2023
    }]));
  };
  const result = await searchCitation('arXiv:2303.11366', fetchImpl);
  assert.equal(result.confident.source, 'ARXIV');
  assert.equal(result.confident.id, '2303.11366');
  assert.deepEqual(result.confident.pdfUrls, ['https://arxiv.org/pdf/2303.11366.pdf']);
  assert.equal(result.candidates.length, 1);

  // Falls back to OpenAlex arXiv-DOI when arXiv rate-limits with HTTP 429
  const rateLimitedFetch = async url => {
    if (url.includes('export.arxiv.org')) return xmlResponse('', 429);
    if (url.includes('10.48550%2Farxiv.2303.11366')) {
      return jsonResponse({
        id: 'https://openalex.org/W7133222210',
        title: 'Reflexion: Language Agents with Verbal Reinforcement Learning',
        authorships: [{ author: { display_name: 'Noah Shinn' } }],
        publication_year: 2023,
        doi: 'https://doi.org/10.48550/arxiv.2303.11366',
        locations: []
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const fallback = await searchCitation('arXiv:2303.11366', rateLimitedFetch);
  assert.equal(fallback.confident.source, 'ARXIV');
  assert.equal(fallback.confident.id, '2303.11366');
  assert.deepEqual(fallback.confident.pdfUrls, ['https://arxiv.org/pdf/2303.11366.pdf']);
});

test('direct DOI fast-path falls back to Crossref when OpenAlex returns 404', async () => {
  const fetchImpl = async url => {
    if (url.includes('api.openalex.org')) return jsonResponse({}, 404);
    if (url.includes('api.crossref.org')) {
      return jsonResponse({
        message: {
          DOI: '10.1038/s41586-021-03819-2',
          title: ['Highly accurate protein structure prediction with AlphaFold'],
          author: [{ given: 'John', family: 'Jumper' }],
          issued: { 'date-parts': [[2021]] },
          link: [{ URL: 'https://www.nature.com/articles/s41586-021-03819-2.pdf', 'content-type': 'application/pdf' }]
        }
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await searchCitation('10.1038/s41586-021-03819-2', fetchImpl);
  assert.equal(result.confident.source, 'CROSSREF');
  assert.equal(result.confident.doi, '10.1038/s41586-021-03819-2');
  assert.equal(result.confident.openAccess, true);
});

test('federated search merges duplicates across OpenAlex, arXiv, and Crossref and survives partial failures', async () => {
  const fetchImpl = async url => {
    if (url.includes('api.crossref.org')) {
      return jsonResponse({
        message: {
          items: [{
            DOI: '10.48550/arxiv.1706.03762',
            title: ['Attention Is All You Need'],
            author: [{ given: 'Ashish', family: 'Vaswani' }],
            issued: { 'date-parts': [[2017]] },
            'is-referenced-by-count': 50000
          }]
        }
      });
    }
    if (url.includes('export.arxiv.org')) {
      return xmlResponse(arxivFeed([{
        id: '1706.03762v7',
        title: 'Attention Is All You Need',
        authors: ['Ashish Vaswani', 'Noam Shazeer'],
        year: 2017
      }]));
    }
    if (url.includes('api.openalex.org')) {
      // Simulate OpenAlex outage to verify partial-failure resilience
      return jsonResponse({}, 503);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await searchCitation('Vaswani et al. 2017 Attention Is All You Need', fetchImpl);
  assert.equal(result.confident, null);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source, 'ARXIV');
  assert.equal(result.candidates[0].id, '1706.03762');
  assert.equal(result.candidates[0].openAccess, true);
  assert.deepEqual(result.candidates[0].pdfUrls, ['https://arxiv.org/pdf/1706.03762.pdf']);
});

test('federated search throws only when all engines fail', async () => {
  const fetchImpl = async () => jsonResponse({}, 502);
  await assert.rejects(
    () => searchCitation('Some paper title that fails everywhere', fetchImpl),
    /Citation search failed/
  );
});

test('subtitle / renamed-preprint fallback surfaces Reflexion at rank #1', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes('api.openalex.org') && url.includes('title.search%3AReflexion')) {
      return jsonResponse({
        results: [{
          id: 'https://openalex.org/W7133222210',
          title: 'Reflexion: Language Agents with Verbal Reinforcement Learning',
          authorships: [{ author: { display_name: 'Noah Shinn' } }],
          publication_year: 2023,
          cited_by_count: 2500,
          locations: [{ is_oa: true, pdf_url: 'https://arxiv.org/pdf/2303.11366.pdf' }]
        }]
      });
    }
    if (url.includes('export.arxiv.org') && url.includes('ti%3Areflexion')) {
      return xmlResponse(arxivFeed([
        {
          id: '2509.03990v2',
          title: 'Meta-Policy Reflexion: Reusable Reflective Memory for LLM Agent',
          authors: ['Other Author'],
          year: 2025,
          summary: 'A meta-policy approach to reflective memory.'
        },
        {
          id: '2303.11366v4',
          title: 'Reflexion: Language Agents with Verbal Reinforcement Learning',
          authors: ['Noah Shinn', 'Federico Cassano'],
          year: 2023,
          summary: 'Autonomous language agents with dynamic memory and self-reflection.'
        }
      ]));
    }
    if (url.includes('export.arxiv.org')) return xmlResponse(arxivFeed([]));
    if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [] } });
    return jsonResponse({ results: [] });
  };

  const result = await searchCitation(
    'Reflexion: an autonomous agent with dynamic memory and self-reflection',
    fetchImpl
  );
  assert.equal(result.confident, null);
  assert.ok(result.candidates.length >= 1);
  assert.equal(result.candidates[0].title, 'Reflexion: Language Agents with Verbal Reinforcement Learning');
  assert.equal(result.candidates[0].openAccess, true);
  assert.ok(result.candidates[0].pdfUrls.includes('https://arxiv.org/pdf/2303.11366.pdf'));
  assert.ok(calls.some(u => u.includes('ti%3Areflexion') || u.includes('ti:reflexion')));
});

test('Semantic Scholar is queried when S2_API_KEY is set and gracefully skips HTTP 429', async t => {
  const prevKey = process.env.S2_API_KEY;
  process.env.S2_API_KEY = 'test-key';
  t.after(() => {
    if (prevKey === undefined) delete process.env.S2_API_KEY;
    else process.env.S2_API_KEY = prevKey;
  });

  let sawS2 = false;
  const fetchImpl = async url => {
    if (url.includes('api.semanticscholar.org')) {
      sawS2 = true;
      return jsonResponse({}, 429);
    }
    if (url.includes('export.arxiv.org')) return xmlResponse(arxivFeed([]));
    if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [] } });
    return jsonResponse({
      results: [{
        id: 'https://openalex.org/W42',
        title: 'Chain-of-Thought Prompting Elicits Reasoning in Large Language Models',
        authorships: [{ author: { display_name: 'Jason Wei' } }],
        publication_year: 2022,
        locations: [{ is_oa: true, pdf_url: 'https://arxiv.org/pdf/2201.11903.pdf' }]
      }]
    });
  };

  const result = await searchCitation('Chain-of-Thought Prompting Elicits Reasoning in Large Language Models', fetchImpl);
  assert.equal(sawS2, true);
  assert.equal(result.candidates[0].id, 'W42');
});

test('arXiv search falls back to DataCite arXiv DOI registry on HTTP 429', async t => {
  t.after(() => resetOpenAlexCooldown());
  const fetchImpl = async url => {
    if (url.includes('export.arxiv.org')) return xmlResponse('', 429);
    if (url.includes('api.datacite.org')) {
      return jsonResponse({
        data: [{
          id: '10.48550/arxiv.2103.00020',
          attributes: {
            titles: [{ title: 'Learning Transferable Visual Models From Natural Language Supervision' }],
            creators: [{ givenName: 'Alec', familyName: 'Radford' }],
            publicationYear: 2021
          }
        }]
      });
    }
    if (url.includes('api.openalex.org')) return jsonResponse({}, 429);
    if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [] } });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await searchCitation(
    'Learning Transferable Visual Models From Natural Language Supervision',
    fetchImpl
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source, 'ARXIV');
  assert.equal(result.candidates[0].id, '2103.00020');
  assert.deepEqual(result.candidates[0].pdfUrls, ['https://arxiv.org/pdf/2103.00020.pdf']);
  assert.ok(Array.isArray(result.providers));
  assert.equal(result.providers.find(p => p.id === 'ARXIV')?.status, 'ok');
  const oaProvider = result.providers.find(p => p.id === 'OPENALEX');
  assert.equal(oaProvider?.status, 'error');
  assert.equal(oaProvider?.error, 'Rate limited (HTTP 429)');
  const crProvider = result.providers.find(p => p.id === 'CROSSREF');
  assert.equal(crProvider?.status, 'empty');
  assert.equal(crProvider?.reason, 'No matches');
});

test('multi-line Kadavath et al. citation resolves with arXiv ID, wrapped arXiv ID, and without arXiv ID', async () => {
  const exactKadavath =
    'Kadavath, S., Conerly, T., Askell, A., Henighan, T., Drain,\n' +
    'D., Perez, E., Schiefer, N., Dodds, Z. H., DasSarma, N.,\n' +
    'Tran-Johnson, E., et al. Language models (mostly) know\n' +
    'what they know. arXiv preprint arXiv:2207.05221, 2022.';

  const wrappedKadavath =
    'Kadavath, S., Conerly, T., Askell, A., et al. Language models (mostly) know\n' +
    'what they know. arXiv preprint arXiv:2207.\n05221, 2022.';

  const noArxivKadavath =
    'Kadavath, S., Conerly, T., Askell, A., Henighan, T., Drain,\n' +
    'D., Perez, E., Schiefer, N., Dodds, Z. H., DasSarma, N.,\n' +
    'Tran-Johnson, E., et al. Language models (mostly) know\n' +
    'what they know. arXiv preprint, 2022.';

  assert.equal(citationQuery(exactKadavath).arxivId, '2207.05221');
  assert.equal(citationQuery(wrappedKadavath).arxivId, '2207.05221');
  assert.equal(citationQuery(noArxivKadavath).bibTitle, 'Language models mostly know what they know');

  const fetchImpl = async url => {
    if (url.includes('export.arxiv.org/api/query?id_list=2207.05221')) {
      return xmlResponse(arxivFeed([{
        id: '2207.05221v4',
        title: 'Language Models (Mostly) Know What They Know',
        authors: ['Saurav Kadavath', 'Tom Conerly', 'Amanda Askell'],
        year: 2022
      }]));
    }
    if (url.includes('export.arxiv.org')) return xmlResponse(arxivFeed([]));
    if (url.includes('api.datacite.org/dois/10.48550/arxiv.2207.05221')) {
      return jsonResponse({
        data: {
          id: '10.48550/arxiv.2207.05221',
          attributes: {
            titles: [{ title: 'Language Models (Mostly) Know What They Know' }],
            creators: [{ givenName: 'Saurav', familyName: 'Kadavath' }],
            publicationYear: 2022
          }
        }
      });
    }
    if (url.includes('api.datacite.org/dois?')) {
      return jsonResponse({
        data: [{
          id: '10.48550/arxiv.2207.05221',
          attributes: {
            titles: [{ title: 'Language Models (Mostly) Know What They Know' }],
            creators: [{ givenName: 'Saurav', familyName: 'Kadavath' }],
            publicationYear: 2022
          }
        }]
      });
    }
    if (url.includes('api.openalex.org')) return jsonResponse({ results: [] });
    if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [] } });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const exactRes = await searchCitation(exactKadavath, fetchImpl);
  assert.equal(exactRes.confident?.id, '2207.05221');
  assert.equal(exactRes.candidates[0].title, 'Language Models (Mostly) Know What They Know');
  assert.equal(exactRes.providers.find(p => p.id === 'ARXIV')?.status, 'ok');

  const noIdRes = await searchCitation(noArxivKadavath, fetchImpl);
  assert.equal(noIdRes.candidates[0]?.id, '2207.05221');
  assert.equal(noIdRes.candidates[0]?.title, 'Language Models (Mostly) Know What They Know');
  assert.equal(noIdRes.providers.find(p => p.id === 'ARXIV')?.status, 'ok');
});

test('getCandidate validates and securely re-resolves every supported source', async () => {
  const s2Id = 'a'.repeat(40);
  const fetchImpl = async url => {
    if (url.includes('export.arxiv.org/api/query?id_list=2303.11366')) {
      return xmlResponse(arxivFeed([{
        id: '2303.11366v4',
        title: 'Reflexion',
        authors: ['Noah Shinn'],
        year: 2023
      }]));
    }
    if (url.includes('export.arxiv.org/api/query?id_list=cs%2F0123456')) {
      return xmlResponse(arxivFeed([{
        id: 'cs/0123456v1',
        title: 'Legacy Paper',
        authors: ['Jane Doe'],
        year: 2001
      }]));
    }
    if (url.includes('api.crossref.org/works/10.1234%2Ftest')) {
      return jsonResponse({
        message: {
          DOI: '10.1234/test',
          title: ['Crossref Enriched Paper'],
          author: [{ given: 'Ada', family: 'Lovelace' }],
          issued: { 'date-parts': [[2024]] }
        }
      });
    }
    if (url.includes('api.openalex.org/works/https://doi.org/10.1234%2Ftest')) {
      return jsonResponse({
        id: 'https://openalex.org/W999',
        title: 'Crossref Enriched Paper',
        doi: 'https://doi.org/10.1234/test',
        locations: [{ is_oa: true, pdf_url: 'https://oa.example.org/enriched.pdf' }]
      });
    }
    if (url.includes(`api.semanticscholar.org/graph/v1/paper/${s2Id}`)) {
      return jsonResponse({
        paperId: s2Id,
        title: 'S2 Paper',
        authors: [{ name: 'Grace Hopper' }],
        year: 2024,
        externalIds: { ArXiv: '2401.00001' },
        openAccessPdf: { url: 'https://example.org/s2.pdf' }
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  // ARXIV modern & legacy
  const arxivModern = await getCandidate('ARXIV', '2303.11366', fetchImpl);
  assert.equal(arxivModern.source, 'ARXIV');
  assert.deepEqual(arxivModern.pdfUrls, ['https://arxiv.org/pdf/2303.11366.pdf']);

  const arxivLegacy = await getCandidate('ARXIV', 'cs/0123456', fetchImpl);
  assert.equal(arxivLegacy.id, 'cs/0123456');
  assert.deepEqual(arxivLegacy.pdfUrls, ['https://arxiv.org/pdf/cs/0123456.pdf']);

  // CROSSREF with OpenAlex OA enrichment
  const crossref = await getCandidate('CROSSREF', '10.1234/test', fetchImpl);
  assert.equal(crossref.source, 'CROSSREF');
  assert.equal(crossref.openAccess, true);
  assert.deepEqual(crossref.pdfUrls, ['https://oa.example.org/enriched.pdf']);

  // SEMANTIC_SCHOLAR
  const s2 = await getCandidate('SEMANTIC_SCHOLAR', s2Id, fetchImpl);
  assert.equal(s2.source, 'SEMANTIC_SCHOLAR');
  assert.ok(s2.pdfUrls.includes('https://arxiv.org/pdf/2401.00001.pdf'));
  assert.ok(s2.pdfUrls.includes('https://example.org/s2.pdf'));

  // Reject malicious / invalid identifiers for every source
  for (const [source, id] of [
    ['OPENALEX', 'W123/../../etc'],
    ['ARXIV', '../etc/passwd'],
    ['ARXIV', 'https://evil.example/a.pdf'],
    ['CROSSREF', 'not-a-doi'],
    ['CROSSREF', 'https://evil.example/10.1234/x'],
    ['SEMANTIC_SCHOLAR', 'not-40-hex'],
    ['UNKNOWN', 'W123'],
    [null, 'W123']
  ]) {
    await assert.rejects(() => getCandidate(source, id, fetchImpl), /Invalid paper identifier/);
  }
});

test('OPENALEX_API_KEY sends Bearer auth header, TTL cache avoids repeat calls, and 429 cooldown skips network', async t => {
  const prevKey = process.env.OPENALEX_API_KEY;
  process.env.OPENALEX_API_KEY = 'oa-secret-key';
  t.after(() => {
    if (prevKey === undefined) delete process.env.OPENALEX_API_KEY;
    else process.env.OPENALEX_API_KEY = prevKey;
    clearSearchCache();
    resetOpenAlexCooldown();
  });

  // 1. Bearer auth + TTL cache hit
  let calls = 0;
  let sawAuthHeader = null;
  const okFetch = async (url, init) => {
    calls += 1;
    if (url.includes('api.openalex.org')) {
      sawAuthHeader = init?.headers?.Authorization || null;
      return jsonResponse({
        results: [{
          id: 'https://openalex.org/W555',
          title: 'Attention Is All You Need',
          authorships: [{ author: { display_name: 'Ashish Vaswani' } }],
          publication_year: 2017,
          locations: [{ is_oa: true, pdf_url: 'https://arxiv.org/pdf/1706.03762.pdf' }]
        }]
      });
    }
    if (url.includes('export.arxiv.org')) return xmlResponse(arxivFeed([]));
    if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [] } });
    return jsonResponse({});
  };

  const first = await searchCitation('Attention Is All You Need', okFetch, { useCache: true });
  const callsAfterFirst = calls;
  const second = await searchCitation('  attention  is all you need ', okFetch, { useCache: true });
  assert.equal(sawAuthHeader, 'Bearer oa-secret-key');
  assert.equal(calls, callsAfterFirst, 'second identical query should hit TTL cache');
  assert.equal(second.candidates[0].id, first.candidates[0].id);

  // 2. OpenAlex 429 daily_budget triggers cooldown and skips subsequent OpenAlex calls
  clearSearchCache();
  let oaCalls = 0;
  const rateLimitFetch = async url => {
    if (url.includes('api.openalex.org')) {
      oaCalls += 1;
      return jsonResponse({ error: 'Rate limit exceeded', reason: 'daily_budget', retryAfter: 3600 }, 429);
    }
    if (url.includes('export.arxiv.org')) return xmlResponse(arxivFeed([{
      id: '2305.14325v1',
      title: 'Improving Factuality and Reasoning in Language Models through Multiagent Debate',
      authors: ['Yilun Du'],
      year: 2023
    }]));
    if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [] } });
    return jsonResponse({});
  };

  const r1 = await searchCitation('Improving Factuality and Reasoning in Language Models through Multiagent Debate', rateLimitFetch);
  assert.equal(oaCalls, 1);
  assert.match(r1.providers.find(p => p.id === 'OPENALEX')?.error || '', /^Daily limit reached \(resets at \d{2}:\d{2} UTC\)$/);

  const r2 = await searchCitation('Another Distinct Paper Title For Cooldown Check', rateLimitFetch);
  assert.equal(oaCalls, 1, 'OpenAlex must not be called while in cooldown');
  assert.match(r2.providers.find(p => p.id === 'OPENALEX')?.error || '', /^Daily limit reached \(resets at \d{2}:\d{2} UTC\)$/);
});
