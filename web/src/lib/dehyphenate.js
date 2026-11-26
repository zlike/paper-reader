/**
 * Word-aware PDF line-wrap dehyphenation shared between frontend title
 * sanitization and backend citation query normalization.
 */

// Common closed words (especially English & CS/ML terms) that may be split
// across PDF line wraps into two substrings that individually look like words
// (e.g. "in- formation", "common- sense", "for- mat", "under- stand", "de- bate").
const CLOSED_WORDS = new Set([
  // Issue / benchmark core CS/ML & English closed words
  'adversarial', 'after', 'algorithm', 'algorithms', 'alphacode', 'altogether',
  'american', 'analyses', 'analysis', 'answer', 'answering', 'answers',
  'applicability', 'application', 'applications', 'approach', 'approaches',
  'architecture', 'architectures', 'arithmetic', 'artificial', 'attention',
  'authority', 'automated', 'automatic', 'autonomous', 'autoprompt', 'average',
  'backpropagation', 'baseline', 'baselines', 'benchmark', 'benchmarks',
  'bidirectional', 'bootstrapping', 'capabilities', 'capability', 'character',
  'chatgpt', 'cheesecakes', 'children', 'classification', 'collaborative',
  'commonsense', 'commonsenseqa', 'communication', 'communicative', 'compared',
  'comparison', 'comprehensive', 'computation', 'computational', 'computers',
  'concatenate', 'concentrate', 'conference', 'consensus', 'consider',
  'consistency', 'consistent', 'conversation', 'conversational', 'countryside',
  'dataset', 'datasets', 'debate', 'debating', 'decentralized', 'decomposition',
  'degeneration', 'demonstration', 'demonstrations', 'dialogue', 'diffusion',
  'discomfort', 'distillation', 'distribution', 'distributive', 'doing',
  'dollars', 'effective', 'efficient', 'elicits', 'embodied', 'emergent',
  'empirical', 'encoding', 'enrolled', 'entirely', 'environment', 'environments',
  'evaluated', 'evaluation', 'evaluations', 'example', 'examples', 'exemplars',
  'exercise', 'experiment', 'experimental', 'experiments', 'explain',
  'explainable', 'explanation', 'explanations', 'exploration', 'extraction',
  'factuality', 'feedback', 'figure', 'finally', 'findings', 'flowers',
  'follow', 'following', 'forecasting', 'forest', 'format', 'formatting',
  'foundation', 'framework', 'frameworks', 'generalization', 'generate',
  'generated', 'generating', 'generation', 'generative', 'hallucination',
  'hallucinations', 'hierarchical', 'holding', 'hospital', 'hyperparameter',
  'hyperparameters', 'hypothetically', 'identification', 'illustrate',
  'imagenet', 'implementation', 'improve', 'improved', 'improvement',
  'improvements', 'improves', 'improving', 'increased', 'increasing',
  'inference', 'information', 'instructgpt', 'instruction', 'instructions',
  'integer', 'intelligence', 'intelligent', 'interaction', 'interactions',
  'interactive', 'international', 'interpretation', 'introduction', 'iterative',
  'judgements', 'judgments', 'knowledge', 'language', 'languages', 'learner',
  'learners', 'learning', 'leveraging', 'lightyear', 'linguistic', 'linguistics',
  'listing', 'located', 'machine', 'machines', 'massive', 'mathematical',
  'mathematics', 'mechanism', 'mechanisms', 'methodology', 'misunderstandings',
  'model', 'modeling', 'modelling', 'models', 'morning',
  'natural', 'necessary', 'neighborhood', 'nesting', 'network',
  'networks', 'neural', 'numerals', 'objective', 'office', 'openbookqa',
  'optimization', 'optimizing', 'outcome', 'outcomes', 'output', 'outputs',
  'overfitting', 'overview', 'papers', 'parameter', 'parameters', 'paraphrased',
  'patient', 'performance', 'persuasive', 'planning', 'pondering', 'prediction',
  'predictions', 'preference', 'preferences', 'preprint', 'probability',
  'probabilistic', 'problem', 'problems', 'proceedings', 'process', 'processing',
  'program', 'programming', 'programs', 'prompt', 'prompting', 'prompts',
  'purchase', 'pytorch', 'question', 'questions', 'reading', 'reasoning',
  'recognition', 'recommendation', 'reference', 'references', 'refinement',
  'reflection', 'reflexion', 'reinforcement', 'representation',
  'representations', 'reproducibility', 'requires', 'research', 'residual',
  'response', 'responses', 'retrieval', 'reward', 'rewards', 'robot', 'robotics',
  'robots', 'satisfy', 'scalable', 'scaling', 'second', 'selection', 'semantic',
  'semantics', 'sensitivity', 'sentence', 'sentences', 'sequence', 'sequences',
  'setting', 'settings', 'significantly', 'simulation', 'sitting', 'society',
  'software', 'solution', 'solutions', 'spaceship', 'strategy', 'strategyqa',
  'structure', 'structured', 'summarization', 'summary', 'superman', 'supervise',
  'supervised', 'supervision', 'survey', 'symbolic', 'synergizing', 'synthesis',
  'system', 'systems', 'table', 'technical', 'technique', 'techniques',
  'technology', 'therefore', 'thought', 'thoughts', 'tokenization', 'total',
  'training', 'transferable', 'transformer', 'transformers', 'translation',
  'traveled', 'understand', 'understandable', 'understanding', 'unnecessary',
  'unsupervised', 'vacation', 'validation', 'verification', 'visited', 'visual',
  'visualization', 'visualizations', 'volume', 'workflow', 'workflows'
]);

// Bound morphological suffixes that are almost always continuations of a
// single split word rather than the right half of a hyphenated compound.
const BOUND_SUFFIXES = new Set([
  'able', 'ably', 'al', 'als', 'ance', 'ances', 'ant', 'ants', 'ary', 'ated',
  'ating', 'ation', 'ations', 'ative', 'ator', 'ators', 'dom', 'ed', 'els',
  'ence', 'ences', 'ent', 'ents', 'er', 'ern', 'ers', 'est', 'ful', 'graphy',
  'hood', 'ible', 'ibly', 'ical', 'ically', 'ied', 'ier', 'ies', 'iest', 'ing',
  'ings', 'isation', 'isations', 'ise', 'ised', 'ises', 'ising', 'ish', 'ism',
  'ist', 'ists', 'ities', 'its', 'ity', 'ive', 'ives', 'ization', 'izations',
  'ize', 'ized', 'izes', 'izing', 'less', 'let', 'ling', 'logy', 'ly', 'ment',
  'ments', 'metry', 'ness', 'ory', 'ous', 'ously', 'ship', 'sion', 'sions',
  'tion', 'tions', 'ual', 'ually', 'ular', 'ural', 'ward', 'wards'
]);

// Productive prefixes and left-hand compound words commonly joined by a hyphen
// in academic and CS/ML paper titles.
const COMPOUND_LEFT = new Set([
  'action', 'active', 'agent', 'ai', 'all', 'anti', 'attention', 'audio', 'auto',
  'back', 'batch', 'bi', 'bio', 'black', 'bottom', 'brute', 'by', 'case',
  'causal', 'chain', 'character', 'check', 'class', 'client', 'closed', 'co',
  'coarse', 'code', 'color', 'concept', 'context', 'contra', 'cost', 'counter',
  'cross', 'crowd', 'data', 'day', 'decision', 'decoder', 'deep', 'degeneration',
  'derivative', 'dialogue', 'dialog', 'direct', 'distribution', 'document',
  'domain', 'double', 'down', 'dual', 'edge', 'encoder', 'end', 'energy',
  'ensemble', 'entity', 'error', 'event', 'example', 'extra', 'face', 'fact', 'false',
  'fast', 'feature', 'feedback', 'few', 'fine', 'first', 'fixed', 'follow',
  'force', 'forward', 'frame', 'free', 'full', 'general', 'goal', 'gpt',
  'gradient', 'graph', 'grid', 'ground', 'group', 'half', 'hand', 'hard',
  'hardware', 'head', 'high', 'human', 'hyper', 'image', 'in', 'index',
  'inference', 'info', 'information', 'input', 'instance', 'instruction',
  'inter', 'intra', 'io', 'item', 'joint', 'key', 'knowledge', 'label',
  'language', 'large', 'layer', 'leap', 'left', 'length', 'level', 'light',
  'line', 'linear', 'link', 'list', 'llama', 'llm', 'local', 'logic', 'long',
  'loss', 'low', 'machine', 'macro', 'many', 'markov', 'max', 'memory', 'meta',
  'micro', 'mid', 'min', 'mini', 'mixed', 'modal', 'model', 'mono', 'monte',
  'motion', 'multi', 'multiple', 'name', 'names', 'natural', 'near', 'neo',
  'net', 'network', 'neural', 'neuro', 'next', 'node', 'noise', 'non', 'object',
  'of', 'off', 'omni', 'on', 'one', 'open', 'operation', 'order', 'out',
  'output', 'over', 'pair', 'para', 'part', 'path', 'peer', 'per', 'person',
  'phrase', 'physics', 'pixel', 'plan', 'plug', 'point', 'policy', 'poly',
  'position', 'post', 'power', 'pre', 'preference', 'privacy', 'problem',
  'process', 'program', 'prompt', 'proof', 'proto', 'pseudo', 'quad', 'quality',
  'query', 'question', 'quick', 'rank', 'rate', 'raw', 're', 'read', 'real',
  'reason', 'reasoning', 'reference', 'region', 'relation', 'retrieval',
  'reward', 'right', 'risk', 'rna', 'robot', 'role', 'round', 'row', 'rule',
  'run', 'safety', 'sample', 'scale', 'scene', 'score', 'search', 'second',
  'self', 'semi', 'sentence', 'seq', 'sequence', 'server', 'set', 'shape',
  'shared', 'short', 'shot', 'side', 'sign', 'single', 'site', 'size', 'skill',
  'slow', 'small', 'smart', 'socio', 'soft', 'sound', 'source', 'space',
  'sparse', 'spatial', 'speech', 'speed', 'split', 'stage', 'state', 'static',
  'step', 'stream', 'string', 'structure', 'style', 'sub', 'super', 'surface',
  'symbol', 'syntax', 'system', 'table', 'target', 'task', 'team', 'temporal',
  'term', 'test', 'text', 'the', 'third', 'thought', 'three', 'time', 'to',
  'token', 'tool', 'top', 'touch', 'track', 'trade', 'train', 'training',
  'trans', 'tree', 'tri', 'triple', 'true', 'turn', 'two', 'type', 'ultra',
  'un', 'under', 'uni', 'unit', 'up', 'user', 'value', 'vector', 'video',
  'view', 'vision', 'visual', 'voice', 'warm', 'web', 'weight', 'well', 'white',
  'wide', 'window', 'word', 'work', 'world', 'write', 'zero'
]);

// Standalone words and productive compound tails that commonly appear on the
// right-hand side of a hyphenated compound in paper titles.
const COMPOUND_RIGHT = new Set([
  'action', 'adapted', 'adaptive', 'agent', 'agents', 'ai', 'aligned',
  'alignment', 'all', 'analysis', 'annotated', 'answer', 'answering',
  'arithmetic', 'art', 'assisted', 'attention', 'attribute', 'audio', 'augmented',
  'aware', 'awareness', 'back', 'balanced', 'based', 'batch', 'benchmark',
  'benchmarks', 'bias', 'biased', 'bit', 'book', 'bound', 'bounded', 'box',
  'by', 'calibrated', 'carlo', 'case', 'causal', 'centered', 'centric', 'chain',
  'checking', 'choice', 'class', 'classification', 'client', 'cloud', 'code',
  'coded', 'coding', 'collaboration', 'collaborative', 'comparison',
  'compatible', 'conditioned', 'conditioning', 'consistent', 'consistency',
  'constrained', 'context', 'contextual', 'contrastive', 'control', 'controlled',
  'corrected', 'correcting', 'correction', 'cost', 'cot', 'crafted', 'critic',
  'critical', 'critique', 'cross', 'data', 'dataset', 'datasets', 'debate',
  'decision', 'decoder', 'decoding', 'deep', 'dependent', 'depth', 'derived',
  'design', 'detection', 'dialogue', 'dialog', 'dimensional', 'directed',
  'discovery', 'distance', 'distillation', 'distributed', 'distribution',
  'diverse', 'document', 'domain', 'down', 'driven', 'dynamic', 'edited',
  'editing', 'efficient', 'embedded', 'embedding', 'encoder', 'encoding', 'end',
  'ended', 'energy', 'enhanced', 'ensemble', 'entity', 'entropy', 'environment',
  'environments', 'error', 'estimated', 'estimation', 'eval', 'evaluation',
  'evolution', 'example', 'execution', 'expert', 'explainable', 'explanation',
  'exploration', 'extracted', 'extraction', 'fact', 'factual', 'factuality',
  'fair', 'fast', 'feature', 'features', 'fed', 'feedback', 'few', 'field',
  'filtering', 'fine', 'first', 'fit', 'fitting', 'flow', 'focused', 'fold',
  'follow', 'following', 'force', 'form', 'formal', 'format', 'formed',
  'forward', 'frame', 'framework', 'free', 'friendly', 'full', 'function',
  'fusion', 'game', 'gated', 'gen', 'general', 'generalization', 'generated',
  'generating', 'generation', 'generative', 'goal', 'goals', 'gpt', 'grade',
  'gradient', 'grained', 'gram', 'graph', 'graphs', 'grid', 'grounded',
  'grounding', 'group', 'guided', 'guidance', 'hand', 'hard', 'head', 'headed',
  'heavy', 'help', 'hidden', 'hierarchical', 'high', 'hoc', 'hop', 'horizon',
  'human', 'hybrid', 'id', 'image', 'images', 'implicit', 'improved',
  'improvement', 'improving', 'in', 'indexed', 'indexing', 'induced',
  'inference', 'informed', 'input', 'inspired', 'instance', 'instructed',
  'instruction', 'integrated', 'intensive', 'interaction', 'interactive',
  'invariant', 'item', 'iterative', 'joint', 'k', 'key', 'knowledge', 'known',
  'label', 'labeled', 'labeling', 'labelled', 'language', 'languages', 'large',
  'latent', 'layer', 'layered', 'layout', 'learn', 'learned', 'learner',
  'learners', 'learning', 'left', 'length', 'level', 'like', 'limited', 'line',
  'linear', 'lingual', 'link', 'linked', 'list', 'llama', 'llm', 'llms',
  'local', 'logic', 'long', 'loop', 'loss', 'low', 'machine', 'made', 'making',
  'map', 'mapping', 'margin', 'mask', 'masked', 'masking', 'match', 'matched',
  'matching', 'math', 'matrix', 'max', 'means', 'measure', 'memory', 'merged',
  'meta', 'metric', 'mile', 'min', 'mixed', 'modal', 'modality', 'mode',
  'model', 'modeled', 'modeling', 'models', 'modular', 'module', 'motion',
  'multi', 'name', 'named', 'natural', 'negative', 'net', 'network', 'networks',
  'neural', 'next', 'node', 'noise', 'noisy', 'norm', 'normal', 'normalized',
  'object', 'objective', 'objects', 'of', 'off', 'on', 'one', 'online', 'only',
  'open', 'operation', 'optimal', 'optimization', 'optimized', 'or', 'order',
  'ordered', 'oriented', 'out', 'output', 'over', 'pair', 'paired', 'pairs',
  'parallel', 'parametric', 'parsing', 'part', 'pass', 'patch', 'path',
  'pattern', 'peer', 'perception', 'phase', 'phrase', 'physics', 'pixel',
  'plan', 'planned', 'planner', 'planning', 'play', 'playing', 'plus', 'point',
  'points', 'policy', 'pool', 'pooling', 'position', 'positive', 'post',
  'powered', 'pre', 'predict', 'predicted', 'prediction', 'predictive',
  'preference', 'preserving', 'pretrain', 'pretrained', 'pretraining', 'prior',
  'privacy', 'probabilistic', 'problem', 'process', 'processing', 'program',
  'programmed', 'programming', 'prompt', 'prompted', 'prompting', 'prompts',
  'proof', 'propagation', 'pruning', 'qa', 'quality', 'quantization', 'query',
  'question', 'questions', 'rag', 'random', 'range', 'rank', 'ranked', 'ranking',
  'rate', 'ratio', 'rational', 'ray', 'read', 'reader', 'reading', 'ready',
  'real', 'reason', 'reasoner', 'reasoners', 'reasoning', 'recall', 'recognition',
  'reconstruction', 'recurrent', 'recursive', 'reference', 'refine', 'refined',
  'refinement', 'reflection', 'reflective', 'region', 'regression', 'regularized',
  'reinforcement', 'related', 'relation', 'relational', 'relative', 'relevant',
  'representation', 'representations', 'residual', 'resolution', 'resource',
  'response', 'retrieval', 'retrieved', 'return', 'reward', 'rich', 'right',
  'risk', 'rl', 'rna', 'robot', 'robotics', 'robots', 'robust', 'role', 'round',
  'routing', 'rule', 'rules', 'run', 'safe', 'safety', 'sample', 'sampled',
  'sampling', 'scale', 'scaled', 'scaling', 'scene', 'schema', 'score', 'scored',
  'scoring', 'search', 'second', 'segment', 'segmentation', 'selected',
  'selection', 'selective', 'self', 'semantic', 'semantics', 'sensitive',
  'sentence', 'sentences', 'seq', 'sequence', 'sequential', 'server', 'set',
  'setting', 'shape', 'shaped', 'shared', 'sharing', 'shelf', 'shift', 'short',
  'shot', 'side', 'signal', 'similarity', 'simple', 'simulation', 'single',
  'size', 'sized', 'skill', 'skills', 'skip', 'slice', 'small', 'smart', 'sne',
  'snli', 'social', 'soft', 'solver', 'solving', 'sort', 'source', 'sourced',
  'space', 'span', 'sparse', 'spatial', 'specific', 'spectral', 'speech',
  'speed', 'split', 'stage', 'standard', 'state', 'static', 'step', 'steps',
  'stochastic', 'stop', 'strategy', 'stream', 'streaming', 'strength', 'string',
  'strong', 'structure', 'structured', 'style', 'sub', 'supervised',
  'supervision', 'support', 'surface', 'switching', 'symbolic', 'sync',
  'syntax', 'synthesis', 'synthetic', 'system', 'systems', 'table', 'tables',
  'tag', 'tagging', 'tail', 'target', 'targeted', 'task', 'tasks', 'teacher',
  'team', 'technical', 'temporal', 'tensor', 'term', 'test', 'testing', 'text',
  'the', 'theory', 'thinking', 'thought', 'thoughts', 'three', 'threshold',
  'time', 'to', 'token', 'tokenized', 'tokens', 'tool', 'tools', 'top', 'topic',
  'touch', 'track', 'tracking', 'trade', 'train', 'trained', 'training',
  'trajectory', 'transfer', 'transform', 'transformation', 'transformer',
  'transformers', 'translation', 'tree', 'trees', 'trigger', 'triple', 'true',
  'trust', 'tune', 'tuned', 'tuning', 'turn', 'turns', 'two', 'type', 'typed',
  'unbiased', 'uncertainty', 'understanding', 'unified', 'unit', 'universal',
  'unlabeled', 'unsupervised', 'up', 'update', 'usage', 'use', 'user', 'users',
  'using', 'utility', 'value', 'valued', 'values', 'variable', 'variant',
  'variation', 'vector', 'vectors', 'verification', 'verified', 'verifier',
  'version', 'video', 'view', 'views', 'vision', 'visual', 'vocabulary', 'voice',
  'walk', 'warm', 'wave', 'weak', 'web', 'weight', 'weighted', 'weighting',
  'wide', 'width', 'window', 'wise', 'with', 'word', 'words', 'work', 'workflow',
  'world', 'write', 'writing', 'zero'
]);

const LINE_WRAP_HYPHEN_RE = /([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)([\-\u2010\u2011\u2012\u2013\u2014])\s+([\p{L}\p{N}]+)/u;

/**
 * Decide whether a line-wrap dash between `left` and `right` represents a true
 * compound hyphen that should be preserved (`true`) or an editorial line-break
 * hyphen that should be removed to rejoin a split word (`false`).
 */
export function shouldPreserveHyphen(left, right) {
  if (!left || !right) return false;

  const lastPart = left.includes('-') ? left.slice(left.lastIndexOf('-') + 1) : left;
  const lastLower = lastPart.toLowerCase();
  const rightLower = right.toLowerCase();
  const joinedLower = lastLower + rightLower;

  // 1. Known closed word (e.g. "in- formation" -> "information", "common- sense" -> "commonsense")
  if (CLOSED_WORDS.has(joinedLower)) return false;

  // 2. Chained compounds (e.g. "Chain-of- thought", "End-to- end", "Zero-shot- CoT", "off-the- shelf")
  if (left.includes('-')) return true;

  // 3. Numeric or version compounds (e.g. "GPT- 4", "LLaMA- 2", "3D- aware", "12- mile")
  if (/\d/.test(left) || /\d/.test(right)) return true;

  // 4. Single-letter prefixes (LaTeX \lefthyphenmin=2 never breaks after 1 letter: "e- snli", "n- gram")
  if (left.length === 1 && /^\p{L}$/u.test(left)) return true;

  // 5. Bound morphological suffix on right (e.g. "prompt- ing", "learn- ers", "visual- izations")
  if (BOUND_SUFFIXES.has(rightLower) && !COMPOUND_RIGHT.has(rightLower)) return false;

  // 6. Both halves are valid compound parts / words (e.g. "self- feedback", "few- shot", "multi- robot")
  const leftValid = COMPOUND_LEFT.has(lastLower) || CLOSED_WORDS.has(lastLower);
  const rightValid = COMPOUND_RIGHT.has(rightLower) || CLOSED_WORDS.has(rightLower);
  if (leftValid && rightValid) return true;

  // 7. Capitalized compound right half when left is a known word (e.g. "Multiple- Choice", "Human- AI")
  if (leftValid && /^[A-Z]/.test(right) && right.length >= 2 && !/^[A-Z]+$/.test(left)) {
    return true;
  }

  return false;
}

/**
 * Resolve PDF line-wrap hyphens and soft hyphens in `text` while preserving
 * compound hyphens and leaving punctuation/structure intact.
 */
export function dehyphenateLineWraps(text) {
  if (!text || typeof text !== 'string') return '';
  let result = text.replace(/\u00AD\s*/g, '');

  // Iteratively resolve line-wrap hyphens so chained wraps (e.g. "Chain- of- thought")
  // accumulate the full left-hand compound token.
  let safety = 0;
  while (safety++ < 200) {
    let changed = false;
    result = result.replace(LINE_WRAP_HYPHEN_RE, (_match, left, _dash, right) => {
      changed = true;
      return shouldPreserveHyphen(left, right) ? `${left}-${right}` : `${left}${right}`;
    });
    if (!changed) break;
  }

  return result;
}

/**
 * Clean a raw PDF-extracted title for academic search queries.
 * Preserves compound hyphens across line wraps, joins split words, removes soft
 * hyphens, normalizes standalone/separator en- and em-dashes to spaces, and
 * collapses whitespace.
 */
export function sanitizeTitleForSearch(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  return dehyphenateLineWraps(rawTitle)
    // Normalize remaining en-dashes and em-dashes (e.g. separators) to spaces
    .replace(/[\u2013\u2014]+/g, ' ')
    // Collapse and trim whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
