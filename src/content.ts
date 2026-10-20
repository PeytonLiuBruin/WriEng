import cmuPronunciations from './content/cmudict-subset.json';
import pronunciationSelections from './content/frequency-cmu-selection.json';
import pronunciationStressVariants from './content/frequency-cmu-stress-exceptions.json';
import { compareByGeneralFrequency, frequencyMetadata, frequencyRawTable, generalFrequencyFor, type GeneralFrequency } from './content/frequency';
import { adaptCoreLexicon, createLearningIndex, type CandidateWord, type CoreLexiconManifest, type CoreLexiconPackage, type LearningWord } from './core-lexicon';
export { compareByGeneralFrequency, frequencyMetadata, generalFrequencyFor } from './content/frequency';
export type { GeneralFrequency } from './content/frequency';
export { contentTierLabels, isCoreWord, isCuratedWord, isLearnableWord, validateCoreLexicon } from './core-lexicon';
export type { CandidateWord, ContentTier, CoreContentField, CoreLexiconEntry, CoreLexiconManifest, CoreLexiconMetadata, CoreLexiconPackage, CorePronunciationVariant, CoreWord, LearningWord } from './core-lexicon';

export type RouteId = 'ielts' | 'toefl' | 'cet6' | 'gre' | 'daily';
export interface Route {
  id: RouteId;
  label: string;
  subtitle: string;
  description: string;
  icon: string;
  color: string;
}
export interface Example { en: string; zh: string }
export interface Pronunciation {
  ipaUs: string;
  /** Learner-facing syllable chunks, not a formal syllabification standard. */
  syllables: string[];
  /** Zero-based index of primary stress. */
  stressedSyllable: number;
  tipZh: string;
  /** One pinned North American CMUdict variant. Not a pronunciation score. */
  arpabet: string | null;
}
export interface Seed {
  term: string;
  partOfSpeech: string;
  meaningZh: string;
  definitionEn: string;
  example: Example;
  transferExample: Example;
  collocations: string[];
  mnemonicZh: string;
  pronunciation: Omit<Pronunciation, 'arpabet'>;
  routes: RouteId[];
}
export const contentFields = [
  'term', 'partOfSpeech', 'meaningZh', 'definitionEn', 'example',
  'transferExample', 'collocations', 'mnemonicZh', 'pronunciation.ipaUs',
  'pronunciation.syllables', 'pronunciation.stressedSyllable',
  'pronunciation.tipZh', 'pronunciation.arpabet', 'routes', 'frequency', 'examFrequency',
] as const;
export type ContentField = typeof contentFields[number];
export interface FieldProvenance {
  source: string;
  sourceUrl: string;
  version: string;
  license: string;
  adaptation: string;
  review: 'machine-validated; professional-review-pending';
  date: string;
}
export interface Word extends Omit<Seed, 'pronunciation'> {
  kind: 'curated';
  id: string;
  pronunciation: Pronunciation;
  /** General mixed-corpus estimate, independent from teaching sense and exam tags. */
  frequency: GeneralFrequency;
  /** No verified exam corpus has been imported. */
  examFrequency: null;
  provenance: Record<ContentField, FieldProvenance>;
}

export const routes: Route[] = [
  { id: 'ielts', label: 'IELTS', subtitle: '表达观点 · 社会与环境', description: '用情境与搭配练习议题表达。学习路线由项目选编，并非官方必考或频率榜。', icon: '🌍', color: '#c36b42' },
  { id: 'toefl', label: 'TOEFL', subtitle: '校园学术 · 研究与科学', description: '练习学术讨论中可迁移的词义。学习路线由项目选编，并非官方必考或频率榜。', icon: '🔬', color: '#588d83' },
  { id: 'cet6', label: '六级', subtitle: '阅读写作 · 学业与社会', description: '积累阅读与写作可用的核心表达。学习路线由项目选编，并非官方必考或频率榜。', icon: '📚', color: '#a88b4a' },
  { id: 'gre', label: 'GRE', subtitle: '精准辨义 · 论证与态度', description: '练习细微语义与论证词。学习路线由项目选编，并非官方必考或频率榜。', icon: '💡', color: '#8772a8' },
  { id: 'daily', label: '美国日常', subtitle: '租房就医 · 出行与消费', description: '用真实生活场景练习常用表达；词义与地区用法会随情境变化。', icon: '☕', color: '#d2866a' },
];

const version = 'wrieng-original-2026-10-17-v2';
const original: FieldProvenance = {
  source: 'WriEng original learning content (AI-assisted draft)',
  sourceUrl: 'docs/CONTENT-SOURCES.md',
  version,
  license: 'CC0-1.0',
  adaptation: 'Written for WriEng; not copied from exam books, dictionaries, or proprietary frequency lists.',
  review: 'machine-validated; professional-review-pending',
  date: '2026-10-17',
};
const cmu: FieldProvenance = {
  ...original,
  source: 'Carnegie Mellon University CMU Pronouncing Dictionary',
  sourceUrl: 'https://github.com/cmusphinx/cmudict/tree/74790861f652b15e4ac49015a90074ad62a27690',
  version: '74790861f652b15e4ac49015a90074ad62a27690',
  license: 'BSD-2-Clause (CMUdict notice retained)',
  adaptation: 'Exact pinned dictionary phonemes selected by headword; sense-specific variant overrides are recorded in frequency-cmu-selection.json and frequency-import-manifest.json. North American ARPABET only.',
};
const pronunciationMap = cmuPronunciations as Record<string, string | null>;
const pronunciationSelectionMap = pronunciationSelections as Record<string, string | null>;
const pronunciationStressVariantMap = pronunciationStressVariants as Record<string, { teachingStressIndex: number; reason: string; referenceUrl: string }>;
const frequencyProvenance: FieldProvenance = {
  ...original,
  source: 'wordfreq general-English mixed-corpus estimate; Robyn Speer and credited underlying corpus authors',
  sourceUrl: frequencyMetadata.sourceUrl,
  version: frequencyMetadata.sourceVersion,
  license: frequencyMetadata.dataLicense,
  adaptation: frequencyMetadata.adaptation,
  date: frequencyMetadata.importedOn,
};

// New literal Seed[] modules are picked up automatically by Vite and the importer.
// Keep the original groups in their established order; append extension modules.
const initialModuleOrder = ['academic.ts', 'science.ts', 'society.ts', 'gre-draft.ts', 'daily-draft.ts'];
const seedModules = import.meta.glob<Record<string, unknown>>('./content/*.ts', { eager: true });
const moduleOrder = (path: string) => {
  const index = initialModuleOrder.indexOf(path.split('/').at(-1)!);
  return index < 0 ? initialModuleOrder.length : index;
};
const seedGroups = Object.entries(seedModules)
  .sort(([a], [b]) => moduleOrder(a) - moduleOrder(b) || (a < b ? -1 : a > b ? 1 : 0))
  .flatMap(([path, module]) => Object.entries(module)
    .filter(([name, entries]) => name.endsWith('Seeds') && Array.isArray(entries))
    .map(([, entries]) => ({ path: path.replace('./', 'src/'), seeds: entries as Seed[] })));

export const words: Word[] = seedGroups.flatMap(({ path, seeds }) => seeds.map(seed => {
  const cmuAvailable = pronunciationMap[seed.term] !== undefined && pronunciationMap[seed.term] !== null;
  const stressVariant = pronunciationStressVariantMap[seed.term];
  const provenance = Object.fromEntries(contentFields.map(field => [field, {
    ...original,
    sourceUrl: `${path}#${seed.term}`,
    ...(field === 'pronunciation.arpabet' ? (cmuAvailable ? cmu : {
      source: 'WriEng availability audit against pinned CMUdict',
      sourceUrl: 'src/content/frequency-cmu-selection.json',
      license: 'Not applicable: CMUdict entry unavailable; no phoneme string supplied',
      adaptation: 'Explicitly absent in the pinned dictionary. Value remains null; original IPA/stress aid is pending professional review.',
    }) : {}),
    ...(field === 'frequency' ? frequencyProvenance : {}),
    ...(field === 'examFrequency' ? { adaptation: 'Unknown: no verified exam frequency evidence. Value deliberately null.' } : {}),
    ...(field === 'routes' ? { adaptation: 'Original editorial route selection based on learning context; not an official exam syllabus or frequency claim.' } : {}),
    ...(['pronunciation.ipaUs', 'pronunciation.syllables', 'pronunciation.stressedSyllable', 'pronunciation.tipZh'].includes(field)
      ? { adaptation: stressVariant ? `${stressVariant.reason} Factual stress reference: ${stressVariant.referenceUrl}` : cmuAvailable
        ? 'Original learner aid checked against CMUdict primary-stress phonemes; IPA and chunks are editorial, not copied dictionary text. Accent variants exist.'
        : 'Original learner aid; this headword has no entry in the pinned CMUdict. Independent professional review pending; no source phonemes invented.' } : {}),
  }])) as Record<ContentField, FieldProvenance>;
  return {
    ...seed,
    kind: 'curated',
    id: `${seed.term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${seed.partOfSpeech.replace(/[^a-z]+/g, '')}-1`,
    pronunciation: { ...seed.pronunciation, arpabet: pronunciationMap[seed.term] ?? null },
    frequency: generalFrequencyFor(seed.term),
    examFrequency: null,
    provenance,
  };
}));

const curatedById = new Map(words.map(word => [word.id, word]));
export const findWord = (id: string) => curatedById.get(id);

// A single bundled source package is cached by the PWA with the application.
// glob avoids inferring a gigantic literal TypeScript type from thousands of JSON rows.
const corePackages = import.meta.glob<{ default: CoreLexiconPackage }>('./content/core-lexicon.json', { eager: true });
export const coreLexiconData = corePackages['./content/core-lexicon.json']?.default ?? null;
export const coreLexiconMetadata = coreLexiconData?.metadata ?? null;
const coreManifests = import.meta.glob<{ default: CoreLexiconManifest }>('./content/core-lexicon-manifest.json', { eager: true });
export const coreLexiconManifest = coreManifests['./content/core-lexicon-manifest.json']?.default ?? null;
/** Audit samples only. These source candidates are deliberately absent from learningWords. */
export const coreCandidateSamples: CandidateWord[] = (coreLexiconManifest?.candidateExamples ?? []).map(candidate => ({
  kind: 'candidate', term: candidate.term, sourceSenseId: candidate.sourceSenseId, reason: candidate.missing.join('; '),
}));
export const coreWords = coreLexiconData ? adaptCoreLexicon(coreLexiconData, words) : [];
/** Original curated order/IDs remain stable; core follows the importer's actual-frequency ordering. */
export const learningWords: LearningWord[] = [...words, ...coreWords];
const learningIndex = createLearningIndex(learningWords);
export const findLearningWord = learningIndex.find;
export const wordsForLearningRoute = learningIndex.forRoute;
export const searchLearningWords = learningIndex.search;
export const learningContentStats = {
  total: learningWords.length,
  curated: words.length,
  core: coreWords.length,
  /** Candidates are tracked in the import manifest; they are not loaded as usable cards. */
  candidate: coreLexiconManifest?.candidateCount ?? null,
  eligibleNotSelected: coreLexiconManifest?.eligibleNotSelectedCount ?? null,
  version: coreLexiconMetadata?.version ?? version,
  routeCounts: Object.fromEntries(routes.map(route => [route.id, wordsForLearningRoute(route.id).length])) as Record<RouteId, number>,
  coreRouteCounts: Object.fromEntries(routes.map(route => [route.id, coreWords.filter(word => word.routes.includes(route.id)).length])) as Record<RouteId, number>,
  verifiedPronunciationEntries: learningWords.filter(word => word.pronunciation.arpabet !== null).length,
  verifiedFrequencyEntries: learningWords.filter(word => word.frequency.zipf !== null).length,
  verifiedExamFrequencyEntries: 0,
  professionalReview: false,
};
export const sortByGeneralFrequency = (entries: readonly Word[] = words): Word[] => [...entries].sort(compareByGeneralFrequency);
export const contentStats = {
  total: words.length,
  senses: words.length,
  version,
  routeCounts: Object.fromEntries(routes.map(route => [route.id, words.filter(word => word.routes.includes(route.id)).length])) as Record<RouteId, number>,
  verifiedFrequencyEntries: words.filter(word => word.frequency.zipf !== null).length,
  verifiedExamFrequencyEntries: 0,
  frequencySourceVersion: frequencyMetadata.sourceVersion,
  frequencyScope: frequencyMetadata.scope,
  professionalReview: false,
  pronunciationSource: 'CMUdict North American ARPABET + original IPA teaching notes',
  cmudictEntries: words.filter(word => word.pronunciation.arpabet !== null).length,
};

/** Pure structural checks. These do not certify linguistic correctness. */
export function validateContent(entries: readonly Word[] = words): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  const seenSenses = new Set<string>();
  const validRoutes = new Set(routes.map(route => route.id));
  for (const word of entries) {
    if (seen.has(word.id)) issues.push(`${word.id}: duplicate id`);
    seen.add(word.id);
    const sense = `${word.term.toLowerCase()}:${word.partOfSpeech}:${word.meaningZh}`;
    if (seenSenses.has(sense)) issues.push(`${word.id}: duplicate sense`);
    seenSenses.add(sense);
    for (const field of ['term', 'partOfSpeech', 'meaningZh', 'definitionEn', 'mnemonicZh'] as const) {
      if (!word[field]?.trim()) issues.push(`${word.id}: empty ${field}`);
    }
    if (word.examFrequency !== null) issues.push(`${word.id}: unsupported exam frequency claim`);
    const expectedFrequency = generalFrequencyFor(word.term);
    if (frequencyRawTable[word.term] === undefined) issues.push(`${word.id}: general frequency import missing`);
    if (word.frequency.rawZipf !== expectedFrequency.rawZipf || word.frequency.zipf !== expectedFrequency.zipf
      || word.frequency.scope !== expectedFrequency.scope || word.frequency.sourceVersion !== expectedFrequency.sourceVersion
      || word.frequency.license !== expectedFrequency.license || word.frequency.language !== 'en' || word.frequency.wordlist !== 'best') issues.push(`${word.id}: general frequency provenance/value mismatch`);
    if (!word.routes.length || word.routes.some(route => !validRoutes.has(route))) issues.push(`${word.id}: invalid route`);
    if (new Set(word.routes).size !== word.routes.length) issues.push(`${word.id}: duplicate route`);
    if (word.collocations.length < 2 || word.collocations.some(item => !item.trim())) issues.push(`${word.id}: insufficient collocations`);
    if (!word.example.en.trim() || !word.example.zh.trim() || !word.transferExample.en.trim() || !word.transferExample.zh.trim()) issues.push(`${word.id}: incomplete examples`);
    if (word.example.en === word.transferExample.en) issues.push(`${word.id}: transfer example repeats study example`);
    const { ipaUs, syllables, stressedSyllable, tipZh, arpabet } = word.pronunciation;
    if (!ipaUs.startsWith('/') || !ipaUs.endsWith('/')) issues.push(`${word.id}: IPA delimiters`);
    if (!syllables.length || !Number.isInteger(stressedSyllable) || stressedSyllable < 0 || stressedSyllable >= syllables.length) issues.push(`${word.id}: invalid stress index`);
    if (!tipZh.trim() || (!arpabet?.trim() && pronunciationSelectionMap[word.term] !== null)) issues.push(`${word.id}: pronunciation evidence missing`);
    if (arpabet && !arpabet.split(' ').some(phone => /1$/.test(phone))) issues.push(`${word.id}: no primary stress phoneme`);
    if (arpabet) {
      const primaryIndices = arpabet.split(' ').filter(phone => /[012]$/.test(phone))
        .flatMap((phone, index) => phone.endsWith('1') ? [index] : []);
      const variant = pronunciationStressVariantMap[word.term];
      const vowelPhones = arpabet.split(' ').filter(phone => /[012]$/.test(phone));
      const documentedVariant = variant && variant.teachingStressIndex === stressedSyllable && vowelPhones[stressedSyllable]?.endsWith('2');
      if (!primaryIndices.includes(stressedSyllable) && !documentedVariant) issues.push(`${word.id}: stress conflicts with selected pronunciation evidence`);
    }
    for (const field of contentFields) {
      const evidence = word.provenance[field];
      if (!evidence || ['source', 'sourceUrl', 'version', 'license', 'adaptation', 'review', 'date'].some(key => !evidence[key as keyof FieldProvenance]?.trim())) issues.push(`${word.id}: incomplete provenance ${field}`);
    }
  }
  return issues;
}
