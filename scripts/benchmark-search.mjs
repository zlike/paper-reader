#!/usr/bin/env node
/**
 * Real-API paper search accuracy benchmark.
 *
 * Runs searchCitation() against a curated set of 40 diverse academic paper queries
 * (renamed/v1 preprints, standard arXiv preprints, top conference proceedings,
 * journal articles, direct DOIs, direct arXiv IDs, and full bibliography strings)
 * and verifies >= 95% accuracy (top-3 match rate).
 *
 * Usage:
 *   npm run benchmark:search
 *   node scripts/benchmark-search.mjs --verbose --threshold=95
 */

import { searchCitation } from '../src/citations.js';

const CASES = [
  // --- Renamed / v1 arXiv preprints ---
  {
    category: 'renamed-preprint',
    query: 'Reflexion: an autonomous agent with dynamic memory and self-reflection',
    expectedArxiv: '2303.11366',
    expectedTitle: 'Reflexion: Language Agents with Verbal Reinforcement Learning'
  },
  {
    category: 'renamed-preprint',
    query: 'AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation Framework',
    expectedArxiv: '2308.08155',
    expectedTitle: 'AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation'
  },
  {
    category: 'renamed-preprint',
    query: 'Toolformer: Language Models Can Teach Themselves to Use Tools',
    expectedArxiv: '2302.04761',
    expectedTitle: 'Toolformer: Language Models Can Teach Themselves to Use Tools'
  },
  {
    category: 'renamed-preprint',
    query: 'ReAct: Synergizing Reasoning and Acting in Language Models',
    expectedArxiv: '2210.03629',
    expectedTitle: 'ReAct: Synergizing Reasoning and Acting in Language Models'
  },
  {
    category: 'renamed-preprint',
    query: 'Voyager: An Open-Ended Embodied Agent with Large Language Models',
    expectedArxiv: '2305.16291',
    expectedTitle: 'Voyager: An Open-Ended Embodied Agent with Large Language Models'
  },

  // --- Standard arXiv ML/CS preprints ---
  {
    category: 'arxiv-preprint',
    query: 'Attention Is All You Need',
    expectedArxiv: '1706.03762',
    expectedTitle: 'Attention Is All You Need'
  },
  {
    category: 'arxiv-preprint',
    query: 'Chain-of-Thought Prompting Elicits Reasoning in Large Language Models',
    expectedArxiv: '2201.11903',
    expectedTitle: 'Chain-of-Thought Prompting Elicits Reasoning in Large Language Models'
  },
  {
    category: 'arxiv-preprint',
    query: 'Large Language Models are Zero-Shot Reasoners',
    expectedArxiv: '2205.11916',
    expectedTitle: 'Large Language Models are Zero-Shot Reasoners'
  },
  {
    category: 'arxiv-preprint',
    query: 'Self-Consistency Improves Chain of Thought Reasoning in Language Models',
    expectedArxiv: '2203.11171',
    expectedTitle: 'Self-Consistency Improves Chain of Thought Reasoning in Language Models'
  },
  {
    category: 'arxiv-preprint',
    query: 'Improving Factuality and Reasoning in Language Models through Multiagent Debate',
    expectedArxiv: '2305.14325',
    expectedTitle: 'Improving Factuality and Reasoning in Language Models through Multiagent Debate'
  },
  {
    category: 'arxiv-preprint',
    query: 'Direct Preference Optimization: Your Language Model is Secretly a Reward Model',
    expectedArxiv: '2305.18290',
    expectedTitle: 'Direct Preference Optimization: Your Language Model is Secretly a Reward Model'
  },
  {
    category: 'arxiv-preprint',
    query: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    expectedArxiv: '2005.11401',
    expectedTitle: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks'
  },
  {
    category: 'arxiv-preprint',
    query: 'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness',
    expectedArxiv: '2205.14135',
    expectedTitle: 'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness'
  },
  {
    category: 'arxiv-preprint',
    query: 'LoRA: Low-Rank Adaptation of Large Language Models',
    expectedArxiv: '2106.09685',
    expectedTitle: 'LoRA: Low-Rank Adaptation of Large Language Models'
  },
  {
    category: 'arxiv-preprint',
    query: 'LLaMA: Open and Efficient Foundation Language Models',
    expectedArxiv: '2302.13971',
    expectedTitle: 'LLaMA: Open and Efficient Foundation Language Models'
  },
  {
    category: 'arxiv-preprint',
    query: 'Tree of Thoughts: Deliberate Problem Solving with Large Language Models',
    expectedArxiv: '2305.10601',
    expectedTitle: 'Tree of Thoughts: Deliberate Problem Solving with Large Language Models'
  },
  {
    category: 'arxiv-preprint',
    query: 'Constitutional AI: Harmlessness from AI Feedback',
    expectedArxiv: '2212.08073',
    expectedTitle: 'Constitutional AI: Harmlessness from AI Feedback'
  },

  // --- Conference proceedings (NeurIPS / ICML / ICLR / ACL / CVPR) ---
  {
    category: 'proceedings',
    query: 'Deep Residual Learning for Image Recognition',
    expectedArxiv: '1512.03385',
    expectedDoi: '10.1109/cvpr.2016.90',
    expectedTitle: 'Deep Residual Learning for Image Recognition'
  },
  {
    category: 'proceedings',
    query: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    expectedArxiv: '1810.04805',
    expectedTitle: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding'
  },
  {
    category: 'proceedings',
    query: 'Denoising Diffusion Probabilistic Models',
    expectedArxiv: '2006.11239',
    expectedTitle: 'Denoising Diffusion Probabilistic Models'
  },
  {
    category: 'proceedings',
    query: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale',
    expectedArxiv: '2010.11929',
    expectedTitle: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale'
  },
  {
    category: 'proceedings',
    query: 'Learning Transferable Visual Models From Natural Language Supervision',
    expectedArxiv: '2103.00020',
    expectedTitle: 'Learning Transferable Visual Models From Natural Language Supervision'
  },
  {
    category: 'proceedings',
    query: 'Adam: A Method for Stochastic Optimization',
    expectedArxiv: '1412.6980',
    expectedTitle: 'Adam: A Method for Stochastic Optimization'
  },
  {
    category: 'proceedings',
    query: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting',
    expectedTitle: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting'
  },
  {
    category: 'proceedings',
    query: 'Generative Adversarial Nets',
    expectedArxiv: '1406.2661',
    expectedTitle: 'Generative Adversarial Nets'
  },

  // --- Journal articles ---
  {
    category: 'journal',
    query: 'Highly accurate protein structure prediction with AlphaFold',
    expectedDoi: '10.1038/s41586-021-03819-2',
    expectedTitle: 'Highly accurate protein structure prediction with AlphaFold'
  },
  {
    category: 'journal',
    query: 'Mastering the game of Go with deep neural networks and tree search',
    expectedDoi: '10.1038/nature16961',
    expectedTitle: 'Mastering the game of Go with deep neural networks and tree search'
  },
  {
    category: 'journal',
    query: 'Human-level control through deep reinforcement learning',
    expectedDoi: '10.1038/nature14236',
    expectedTitle: 'Human-level control through deep reinforcement learning'
  },
  {
    category: 'journal',
    query: 'A Programmable Dual-RNA-Guided DNA Endonuclease in Adaptive Bacterial Immunity',
    expectedDoi: '10.1126/science.1225829',
    expectedTitle: 'A Programmable Dual-RNA-Guided DNA Endonuclease in Adaptive Bacterial Immunity'
  },
  {
    category: 'journal',
    query: 'LeCun, Bengio, Hinton (2015) Deep learning',
    expectedDoi: '10.1038/nature14539',
    expectedTitle: 'Deep learning'
  },

  // --- Direct DOIs ---
  {
    category: 'doi',
    query: '10.1038/s41586-021-03819-2',
    expectedDoi: '10.1038/s41586-021-03819-2',
    expectedTitle: 'Highly accurate protein structure prediction with AlphaFold',
    expectConfident: true
  },
  {
    category: 'doi',
    query: 'https://doi.org/10.1038/nature16961',
    expectedDoi: '10.1038/nature16961',
    expectedTitle: 'Mastering the game of Go with deep neural networks and tree search',
    expectConfident: true
  },
  {
    category: 'doi',
    query: '10.1145/3292500.3330701',
    expectedDoi: '10.1145/3292500.3330701',
    expectedTitle: 'Optuna: A Next-generation Hyperparameter Optimization Framework',
    expectConfident: true
  },
  {
    category: 'doi',
    query: '10.1126/science.1225829',
    expectedDoi: '10.1126/science.1225829',
    expectedTitle: 'A Programmable Dual-RNA-Guided DNA Endonuclease in Adaptive Bacterial Immunity',
    expectConfident: true
  },

  // --- Direct arXiv IDs ---
  {
    category: 'arxiv-id',
    query: 'arXiv:2303.11366',
    expectedArxiv: '2303.11366',
    expectedTitle: 'Reflexion: Language Agents with Verbal Reinforcement Learning',
    expectConfident: true
  },
  {
    category: 'arxiv-id',
    query: 'https://arxiv.org/abs/1706.03762',
    expectedArxiv: '1706.03762',
    expectedTitle: 'Attention Is All You Need',
    expectConfident: true
  },
  {
    category: 'arxiv-id',
    query: '2201.11903',
    expectedArxiv: '2201.11903',
    expectedTitle: 'Chain-of-Thought Prompting Elicits Reasoning in Large Language Models',
    expectConfident: true
  },
  {
    category: 'arxiv-id',
    query: 'arXiv:2305.14325v1',
    expectedArxiv: '2305.14325',
    expectedTitle: 'Improving Factuality and Reasoning in Language Models through Multiagent Debate',
    expectConfident: true
  },

  // --- Full bibliography citation strings ---
  {
    category: 'bibliography',
    query: '[1] Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems.',
    expectedArxiv: '1706.03762',
    expectedTitle: 'Attention Is All You Need'
  },
  {
    category: 'bibliography',
    query: '[3] Brown, T. et al. (2020). "Language Models are Few-Shot Learners". NeurIPS 2020.',
    expectedArxiv: '2005.14165',
    expectedTitle: 'Language Models are Few-Shot Learners'
  },
  {
    category: 'bibliography',
    query: '[4] He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep Residual Learning for Image Recognition. CVPR.',
    expectedArxiv: '1512.03385',
    expectedDoi: '10.1109/cvpr.2016.90',
    expectedTitle: 'Deep Residual Learning for Image Recognition'
  },
  {
    category: 'bibliography',
    query: '[6] Schulman, J., Wolski, F., Dhariwal, P., Radford, A., & Klimov, O. (2017). Proximal Policy Optimization Algorithms.',
    expectedArxiv: '1707.06347',
    expectedTitle: 'Proximal Policy Optimization Algorithms'
  }
];

function parseArgs(argv) {
  let verbose = false;
  let threshold = Number(process.env.BENCHMARK_THRESHOLD || 95);
  for (const arg of argv) {
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg.startsWith('--threshold=')) {
      const parsed = Number(arg.slice('--threshold='.length));
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 100) {
        threshold = parsed;
      }
    }
  }
  return { verbose, threshold };
}

function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesExpected(candidate, testCase) {
  if (!candidate) return false;
  if (testCase.expectedDoi && candidate.doi?.toLowerCase() === testCase.expectedDoi.toLowerCase()) {
    return true;
  }
  if (testCase.expectedArxiv) {
    const expected = testCase.expectedArxiv.toLowerCase();
    if (candidate.source === 'ARXIV' && candidate.id.toLowerCase().replace(/v\d+$/, '') === expected) {
      return true;
    }
    if (candidate.doi?.toLowerCase().includes(`arxiv.${expected}`)) {
      return true;
    }
    if ((candidate.pdfUrls || []).some(url => url.toLowerCase().includes(expected))) {
      return true;
    }
  }
  if (testCase.expectedTitle) {
    const normExp = normalize(testCase.expectedTitle);
    const normTitle = normalize(candidate.title);
    if (normTitle === normExp) return true;
    if (normExp.length >= 16 && (normTitle.includes(normExp) || normExp.includes(normTitle))) {
      return true;
    }
  }
  return false;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runWithRetry(query, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await searchCitation(query);
      if (result.candidates.length > 0 || i === attempts - 1) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(600 * (i + 1));
  }
  throw lastError || new Error('Empty result after retries');
}

async function main() {
  const { verbose, threshold } = parseArgs(process.argv.slice(2));
  const start = Date.now();
  let top1Hits = 0;
  let top3Hits = 0;
  let anyHits = 0;
  let oaPdfHits = 0;
  const failures = [];
  const byCategory = new Map();

  console.log(`Running search accuracy benchmark across ${CASES.length} real academic papers (threshold >= ${threshold}%)...\n`);

  for (let i = 0; i < CASES.length; i++) {
    const testCase = CASES[i];
    const cat = byCategory.get(testCase.category) || { total: 0, top1: 0, top3: 0, oa: 0 };
    cat.total += 1;

    let rank = -1;
    let matchedCandidate = null;
    let confidentOk = true;
    let errorMsg = null;

    try {
      const result = await runWithRetry(testCase.query);
      rank = result.candidates.findIndex(c => matchesExpected(c, testCase));
      if (rank >= 0) matchedCandidate = result.candidates[rank];
      if (testCase.expectConfident && !matchesExpected(result.confident, testCase)) {
        confidentOk = false;
      }
      if (rank === 0) {
        top1Hits += 1;
        cat.top1 += 1;
      }
      if (rank >= 0 && rank < 3 && confidentOk) {
        top3Hits += 1;
        cat.top3 += 1;
      }
      if (rank >= 0) {
        anyHits += 1;
        if (matchedCandidate.openAccess) {
          oaPdfHits += 1;
          cat.oa += 1;
        }
      }
      if (rank < 0 || rank >= 3 || !confidentOk) {
        failures.push({
          query: testCase.query,
          category: testCase.category,
          rank,
          confidentOk,
          topTitles: result.candidates.slice(0, 3).map(c => `${c.source}:${c.id} "${c.title}"`)
        });
      }
    } catch (error) {
      errorMsg = error.message;
      failures.push({
        query: testCase.query,
        category: testCase.category,
        rank: -1,
        error: errorMsg
      });
    }

    byCategory.set(testCase.category, cat);

    if (verbose || rank < 0 || rank >= 3 || !confidentOk) {
      const status = errorMsg
        ? `ERR (${errorMsg})`
        : rank >= 0 && rank < 3 && confidentOk
          ? `PASS #${rank + 1}${matchedCandidate.openAccess ? ' [OA PDF]' : ''}`
          : `FAIL (rank=${rank + 1}, confidentOk=${confidentOk})`;
      console.log(`[${String(i + 1).padStart(2, '0')}/${CASES.length}] ${status.padEnd(18)} [${testCase.category}] ${testCase.query}`);
    }

    // Polite pacing between API queries
    if (i < CASES.length - 1) await sleep(500);
  }

  const total = CASES.length;
  const top1Pct = (top1Hits / total) * 100;
  const top3Pct = (top3Hits / total) * 100;
  const anyPct = (anyHits / total) * 100;
  const oaPct = (oaPdfHits / total) * 100;
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\nCategory breakdown:');
  for (const [category, stats] of byCategory.entries()) {
    const pct = ((stats.top3 / stats.total) * 100).toFixed(1);
    console.log(`  - ${category.padEnd(18)} top-1: ${stats.top1}/${stats.total}, top-3: ${stats.top3}/${stats.total} (${pct}%), OA PDF: ${stats.oa}/${stats.total}`);
  }

  console.log('\nOverall summary:');
  console.log(`  Top-1 accuracy : ${top1Hits}/${total} (${top1Pct.toFixed(1)}%)`);
  console.log(`  Top-3 accuracy : ${top3Hits}/${total} (${top3Pct.toFixed(1)}%)`);
  console.log(`  Any-rank hits  : ${anyHits}/${total} (${anyPct.toFixed(1)}%)`);
  console.log(`  OA PDF hit rate: ${oaPdfHits}/${total} (${oaPct.toFixed(1)}%)`);
  console.log(`  Elapsed time   : ${elapsedSec}s`);

  if (failures.length) {
    console.log('\nMisses:');
    for (const f of failures) {
      console.log(`  - [${f.category}] ${f.query}`);
      if (f.error) console.log(`    error: ${f.error}`);
      else console.log(`    top-3 returned: ${f.topTitles.join(' | ')}`);
    }
  }

  if (top3Pct < threshold) {
    console.error(`\nFAIL: Top-3 search accuracy ${top3Pct.toFixed(1)}% is below threshold ${threshold}%.`);
    process.exit(1);
  }
  console.log(`\nPASS: Top-3 search accuracy ${top3Pct.toFixed(1)}% meets threshold >= ${threshold}%.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
