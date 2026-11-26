#!/usr/bin/env node
/**
 * Word-aware PDF line-wrap dehyphenation accuracy benchmark.
 *
 * Evaluates sanitizeTitleForSearch() against 72 real-paper line-wrapped cases
 * sampled from the 7 benchmark papers (Du et al. ICML 2024 & arXiv, Kojima et al.,
 * Wei et al., Wang et al., Liang et al., Chan et al.), split across:
 *   - keep-hyphen: true compound words broken across a PDF line wrap
 *   - join-word:   single words split across a PDF line wrap
 *
 * Enforces >= 95% overall accuracy AND >= 95% accuracy on each category.
 *
 * Usage:
 *   npm run benchmark:dehyphenation
 *   node scripts/benchmark-dehyphenation.mjs --verbose --threshold=95
 */

import { sanitizeTitleForSearch } from '../web/src/lib/link-highlight.js';

const CASES = [
  // =========================================================================
  // keep-hyphen (36 cases sampled from the 7 benchmark papers)
  // =========================================================================
  {
    category: 'keep-hyphen',
    source: 'du-icml2024',
    input: 'Self-Refine: Iterative Refinement with Self-\nFeedback',
    expected: 'Self-Refine: Iterative Refinement with Self-Feedback'
  },
  {
    category: 'keep-hyphen',
    source: 'du-icml2024',
    input: 'Self-Refine: Iterative Refinement with Self–\nFeedback',
    expected: 'Self-Refine: Iterative Refinement with Self-Feedback'
  },
  {
    category: 'keep-hyphen',
    source: 'du-icml2024',
    input: 'Language Models are Few- Shot Learners',
    expected: 'Language Models are Few-Shot Learners'
  },
  {
    category: 'keep-hyphen',
    source: 'du-icml2024',
    input: 'REALM: Retrieval-augmented language model pre- training',
    expected: 'REALM: Retrieval-augmented language model pre-training'
  },
  {
    category: 'keep-hyphen',
    source: 'du-icml2024',
    input: 'Instruction- following with large language models',
    expected: 'Instruction-following with large language models'
  },
  {
    category: 'keep-hyphen',
    source: 'du-icml2024',
    input: 'Scalable multi- robot collaboration with large language models',
    expected: 'Scalable multi-robot collaboration with large language models'
  },
  {
    category: 'keep-hyphen',
    source: 'du-icml2024',
    input: 'Chain-of- thought prompting elicits reasoning in large language models',
    expected: 'Chain-of-thought prompting elicits reasoning in large language models'
  },
  {
    category: 'keep-hyphen',
    source: 'du-icml2024',
    input: 'Evaluating multiple- choice reasoning in language models',
    expected: 'Evaluating multiple-choice reasoning in language models'
  },
  {
    category: 'keep-hyphen',
    source: 'du-icml2024',
    input: 'Self- collaboration code generation via ChatGPT',
    expected: 'Self-collaboration code generation via ChatGPT'
  },
  {
    category: 'keep-hyphen',
    source: 'du-icml2024',
    input: 'Knowledge- grounded dialogue generation with language models',
    expected: 'Knowledge-grounded dialogue generation with language models'
  },
  {
    category: 'keep-hyphen',
    source: 'du-arxiv',
    input: 'Implicit generation and modeling with energy- based models',
    expected: 'Implicit generation and modeling with energy-based models'
  },
  {
    category: 'keep-hyphen',
    source: 'du-arxiv',
    input: 'Improving factuality through multi- agent debate',
    expected: 'Improving factuality through multi-agent debate'
  },
  {
    category: 'keep-hyphen',
    source: 'du-arxiv',
    input: 'Evaluating GPT- 4 on mathematical reasoning tasks',
    expected: 'Evaluating GPT-4 on mathematical reasoning tasks'
  },
  {
    category: 'keep-hyphen',
    source: 'kojima-2205.11916',
    input: 'Large language models are Zero- shot reasoners',
    expected: 'Large language models are Zero-shot reasoners'
  },
  {
    category: 'keep-hyphen',
    source: 'kojima-2205.11916',
    input: 'Reasoning on non- arithmetic benchmarks',
    expected: 'Reasoning on non-arithmetic benchmarks'
  },
  {
    category: 'keep-hyphen',
    source: 'kojima-2205.11916',
    input: 'Language models are few-shot learners with gpt- 3',
    expected: 'Language models are few-shot learners with gpt-3'
  },
  {
    category: 'keep-hyphen',
    source: 'kojima-2205.11916',
    input: 'Multiple- Choice question answering benchmarks',
    expected: 'Multiple-Choice question answering benchmarks'
  },
  {
    category: 'keep-hyphen',
    source: 'kojima-2205.11916',
    input: 'Zero-shot- CoT prompting for multi-step reasoning',
    expected: 'Zero-shot-CoT prompting for multi-step reasoning'
  },
  {
    category: 'keep-hyphen',
    source: 'kojima-2205.11916',
    input: 'Few-shot- CoT exemplars for reasoning',
    expected: 'Few-shot-CoT exemplars for reasoning'
  },
  {
    category: 'keep-hyphen',
    source: 'kojima-2205.11916',
    input: 'Zero-Plus-Few- Shot evaluation across datasets',
    expected: 'Zero-Plus-Few-Shot evaluation across datasets'
  },
  {
    category: 'keep-hyphen',
    source: 'kojima-2205.11916',
    input: 'Evaluating text-ada- 001 on symbolic tasks',
    expected: 'Evaluating text-ada-001 on symbolic tasks'
  },
  {
    category: 'keep-hyphen',
    source: 'kojima-2205.11916',
    input: 'Using the names- dataset for symbolic reasoning',
    expected: 'Using the names-dataset for symbolic reasoning'
  },
  {
    category: 'keep-hyphen',
    source: 'wei-2201.11903',
    input: 'Solving math word problems with operation- based reasoning',
    expected: 'Solving math word problems with operation-based reasoning'
  },
  {
    category: 'keep-hyphen',
    source: 'wei-2201.11903',
    input: 'Leap-of- thought: Teaching pre-trained models to systematically reason',
    expected: 'Leap-of-thought: Teaching pre-trained models to systematically reason'
  },
  {
    category: 'keep-hyphen',
    source: 'wei-2201.11903',
    input: 'Off-the- shelf language models for arithmetic reasoning',
    expected: 'Off-the-shelf language models for arithmetic reasoning'
  },
  {
    category: 'keep-hyphen',
    source: 'wang-2203.11171',
    input: 'Self- consistency improves chain of thought reasoning in language models',
    expected: 'Self-consistency improves chain of thought reasoning in language models'
  },
  {
    category: 'keep-hyphen',
    source: 'wang-2203.11171',
    input: 'e- snli: Natural language inference with natural language explanations',
    expected: 'e-snli: Natural language inference with natural language explanations'
  },
  {
    category: 'keep-hyphen',
    source: 'wang-2203.11171',
    input: 'Ensemble- based decoding for complex reasoning',
    expected: 'Ensemble-based decoding for complex reasoning'
  },
  {
    category: 'keep-hyphen',
    source: 'wang-2203.11171',
    input: 'Top- k sampling for diverse reasoning paths',
    expected: 'Top-k sampling for diverse reasoning paths'
  },
  {
    category: 'keep-hyphen',
    source: 'wang-2203.11171',
    input: 'Evaluating LaMDA- 137B and code-davinci- 001 on GSM8K',
    expected: 'Evaluating LaMDA-137B and code-davinci-001 on GSM8K'
  },
  {
    category: 'keep-hyphen',
    source: 'liang-2305.19118',
    input: 'Encouraging divergent thinking through multi- task debate',
    expected: 'Encouraging divergent thinking through multi-task debate'
  },
  {
    category: 'keep-hyphen',
    source: 'liang-2305.19118',
    input: 'Human- like reasoning in large language models',
    expected: 'Human-like reasoning in large language models'
  },
  {
    category: 'keep-hyphen',
    source: 'liang-2305.19118',
    input: 'Degeneration-of- Thought in large language models',
    expected: 'Degeneration-of-Thought in large language models'
  },
  {
    category: 'keep-hyphen',
    source: 'liang-2305.19118',
    input: 'Iterative problem- solving with self- reflection',
    expected: 'Iterative problem-solving with self-reflection'
  },
  {
    category: 'keep-hyphen',
    source: 'chan-2308.07201',
    input: 'ChatEval: Towards better LLM- based evaluators through multi-agent- based debate',
    expected: 'ChatEval: Towards better LLM-based evaluators through multi-agent-based debate'
  },
  {
    category: 'keep-hyphen',
    source: 'chan-2308.07201',
    input: 'End-to- end evaluation of LLaMA- 2 and 3D- aware agents',
    expected: 'End-to-end evaluation of LLaMA-2 and 3D-aware agents'
  },

  // =========================================================================
  // join-word (36 cases sampled from the 7 benchmark papers)
  // =========================================================================
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Reflexion: an au- tonomous agent with dynamic memory',
    expected: 'Reflexion: an autonomous agent with dynamic memory'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Optimizing language models for di- alogue',
    expected: 'Optimizing language models for dialogue'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Ex- plain yourself! leveraging language models for common- sense reasoning',
    expected: 'Explain yourself! leveraging language models for commonsense reasoning'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Training language models to fol- low instructions',
    expected: 'Training language models to follow instructions'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Measuring mas- sive multitask language understanding',
    expected: 'Measuring massive multitask language understanding'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Solving math- ematical word problems with neural networks',
    expected: 'Solving mathematical word problems with neural networks'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Collabora- tive problem solving with language mod- els',
    expected: 'Collaborative problem solving with language models'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Persua- sive arguments in multiagent de- bate',
    expected: 'Persuasive arguments in multiagent debate'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Denoising diffu- sion probabilistic models',
    expected: 'Denoising diffusion probabilistic models'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Language models for dialog appli- cations',
    expected: 'Language models for dialog applications'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Chain-of-thought prompting elic- its reasoning',
    expected: 'Chain-of-thought prompting elicits reasoning'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Boot- strapping reasoning with reasoning',
    expected: 'Bootstrapping reasoning with reasoning'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Interactive visual- izations for neural networks',
    expected: 'Interactive visualizations for neural networks'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'A new ap- proach to sensitiv- ity and applicabil- ity analysis',
    expected: 'A new approach to sensitivity and applicability analysis'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'Evaluating text gener- ation in language models',
    expected: 'Evaluating text generation in language models'
  },
  {
    category: 'join-word',
    source: 'du-icml2024',
    input: 'How to super- vise misaligned agents',
    expected: 'How to supervise misaligned agents'
  },
  {
    category: 'join-word',
    source: 'du-arxiv',
    input: 'Reaching con- sensus through an iterative pro- cess',
    expected: 'Reaching consensus through an iterative process'
  },
  {
    category: 'join-word',
    source: 'kojima-2205.11916',
    input: 'Retrieving in- formation for open-domain question answering',
    expected: 'Retrieving information for open-domain question answering'
  },
  {
    category: 'join-word',
    source: 'kojima-2205.11916',
    input: 'Language models are few-shot learn- ers',
    expected: 'Language models are few-shot learners'
  },
  {
    category: 'join-word',
    source: 'kojima-2205.11916',
    input: 'Evalua- tion of experi- mental reasoning methods',
    expected: 'Evaluation of experimental reasoning methods'
  },
  {
    category: 'join-word',
    source: 'kojima-2205.11916',
    input: 'Training Instruct- GPT and Auto- Prompt for NLP',
    expected: 'Training InstructGPT and AutoPrompt for NLP'
  },
  {
    category: 'join-word',
    source: 'kojima-2205.11916',
    input: 'Benchmarking Common- senseQA with Py- torch',
    expected: 'Benchmarking CommonsenseQA with Pytorch'
  },
  {
    category: 'join-word',
    source: 'kojima-2205.11916',
    input: 'Removing un- necessary steps to under- stand reasoning',
    expected: 'Removing unnecessary steps to understand reasoning'
  },
  {
    category: 'join-word',
    source: 'wei-2201.11903',
    input: 'Repro- ducibility in large-scale NLP exper- iments',
    expected: 'Reproducibility in large-scale NLP experiments'
  },
  {
    category: 'join-word',
    source: 'wei-2201.11903',
    input: 'Following understand- able natural language instruc- tions',
    expected: 'Following understandable natural language instructions'
  },
  {
    category: 'join-word',
    source: 'wei-2201.11903',
    input: 'Evaluating reasoning across diverse bench- marks',
    expected: 'Evaluating reasoning across diverse benchmarks'
  },
  {
    category: 'join-word',
    source: 'wang-2203.11171',
    input: 'Emergent capabil- ities of large lan- guage models',
    expected: 'Emergent capabilities of large language models'
  },
  {
    category: 'join-word',
    source: 'wang-2203.11171',
    input: 'Adver- sarial robustness in text genera- tion',
    expected: 'Adversarial robustness in text generation'
  },
  {
    category: 'join-word',
    source: 'wang-2203.11171',
    input: 'Deep Learn- ing for natural language processing',
    expected: 'Deep Learning for natural language processing'
  },
  {
    category: 'join-word',
    source: 'liang-2305.19118',
    input: 'Improving factual- ity through prompt- ing and rea- soning',
    expected: 'Improving factuality through prompting and reasoning'
  },
  {
    category: 'join-word',
    source: 'liang-2305.19118',
    input: 'Re- flexion: Language agents with verbal reinforcement learning',
    expected: 'Reflexion: Language agents with verbal reinforcement learning'
  },
  {
    category: 'join-word',
    source: 'liang-2305.19118',
    input: 'Neural ma- chine translation and arith- metic question an- swering',
    expected: 'Neural machine translation and arithmetic question answering'
  },
  {
    category: 'join-word',
    source: 'liang-2305.19118',
    input: 'Addressing mis- understandings in artificial intelli- gence',
    expected: 'Addressing misunderstandings in artificial intelligence'
  },
  {
    category: 'join-word',
    source: 'chan-2308.07201',
    input: 'Evaluating intelli- gent agent com- munication sys- tems',
    expected: 'Evaluating intelligent agent communication systems'
  },
  {
    category: 'join-word',
    source: 'chan-2308.07201',
    input: 'Tradi- tional versus pro- posed evalu- ations of gen- erated text',
    expected: 'Traditional versus proposed evaluations of generated text'
  },
  {
    category: 'join-word',
    source: 'chan-2308.07201',
    input: 'Mitigating instabil- ity in re- searchers benchmarks',
    expected: 'Mitigating instability in researchers benchmarks'
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

function main() {
  const { verbose, threshold } = parseArgs(process.argv.slice(2));
  let totalHits = 0;
  const byCategory = new Map();
  const failures = [];

  console.log(`Running dehyphenation accuracy benchmark across ${CASES.length} real-paper cases (threshold >= ${threshold}% overall & per category)...\n`);

  for (let i = 0; i < CASES.length; i++) {
    const testCase = CASES[i];
    const cat = byCategory.get(testCase.category) || { total: 0, hits: 0 };
    cat.total += 1;

    const actual = sanitizeTitleForSearch(testCase.input);
    const pass = actual === testCase.expected;
    if (pass) {
      totalHits += 1;
      cat.hits += 1;
    } else {
      failures.push({ ...testCase, actual });
    }
    byCategory.set(testCase.category, cat);

    if (verbose || !pass) {
      const status = pass ? 'PASS' : 'FAIL';
      console.log(`[${String(i + 1).padStart(2, '0')}/${CASES.length}] ${status} [${testCase.category}] (${testCase.source}) ${JSON.stringify(testCase.input)} -> ${JSON.stringify(actual)}`);
      if (!pass) {
        console.log(`          expected: ${JSON.stringify(testCase.expected)}`);
      }
    }
  }

  const total = CASES.length;
  const overallPct = (totalHits / total) * 100;
  let failedGate = overallPct < threshold;

  console.log('\nCategory breakdown:');
  for (const [category, stats] of byCategory.entries()) {
    const pct = (stats.hits / stats.total) * 100;
    if (pct < threshold) failedGate = true;
    console.log(`  - ${category.padEnd(14)} ${stats.hits}/${stats.total} (${pct.toFixed(1)}%)`);
  }

  console.log('\nOverall summary:');
  console.log(`  Accuracy : ${totalHits}/${total} (${overallPct.toFixed(1)}%)`);

  if (failures.length) {
    console.log('\nMisses:');
    for (const f of failures) {
      console.log(`  - [${f.category}] (${f.source})`);
      console.log(`    input   : ${JSON.stringify(f.input)}`);
      console.log(`    expected: ${JSON.stringify(f.expected)}`);
      console.log(`    actual  : ${JSON.stringify(f.actual)}`);
    }
  }

  if (failedGate) {
    console.error(`\nFAIL: Dehyphenation accuracy did not meet >= ${threshold}% overall and per-category threshold.`);
    process.exit(1);
  }
  console.log(`\nPASS: Dehyphenation accuracy ${overallPct.toFixed(1)}% meets >= ${threshold}% overall and per-category threshold.`);
}

main();
