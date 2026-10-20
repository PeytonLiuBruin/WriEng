import type { ContentField, FieldProvenance, RouteId, Word } from './content';
import { frequencyMetadata, normalizeZipfEstimate, type GeneralFrequency } from './content/frequency';

export type ContentTier = 'curated' | 'core' | 'candidate';
export interface CoreSource {
  name: string;
  url: string;
  version: string;
  license: string;
  [key: string]: unknown;
}
export interface CoreSourceRecords {
  wordnetOffset: string | number;
  wordnetDataFile: string;
  cowSynsetId: string;
  cmudictKey: string;
  ecdictRow: number | null;
  [key: string]: unknown;
}
export interface CorePronunciationVariant { key: string; arpabet: string }
export interface CoreLexiconEntry {
  id: string;
  term: string;
  partOfSpeech: 'noun' | 'verb' | 'adjective' | 'adverb';
  definitionEn: string;
  /** Chinese Open Wordnet lexical translations for the selected synset, not a Chinese definition. */
  translationZh: string;
  ipaDictionary: null;
  arpabet: string;
  pronunciationVariants: CorePronunciationVariant[];
  sourceSenseId: string;
  synonyms: string[];
  /** Verbatim source examples, when the source actually supplies them. No invented translations. */
  examples: string[];
  sourceTags: string[];
  routes: RouteId[];
  frequencyZipf: number;
  sourceRecords: CoreSourceRecords;
}
export interface CoreLexiconMetadata {
  schemaVersion: 1;
  version: string;
  count: number;
  importedOn?: string;
  sources: Record<string, CoreSource>;
  fieldSources: Record<string, string | string[]>;
  selection: Record<string, unknown>;
  routePolicy: unknown;
  [key: string]: unknown;
}
export interface CoreLexiconPackage {
  metadata: CoreLexiconMetadata;
  entries: CoreLexiconEntry[];
}
export interface CoreLexiconManifest {
  schemaVersion: 1;
  version: string;
  count: number;
  learnableCount: number;
  candidateCount: number;
  eligibleNotSelectedCount: number;
  candidateExamples: { term: string; sourceSenseId: string; missing: string[] }[];
  [key: string]: unknown;
}
export type CoreContentField = ContentField | 'translationZh' | 'sourceSenseId' | 'synonyms' | 'sourceExamples' | 'sourceTags' | 'pronunciationVariants';
export interface CoreWord {
  kind: 'core';
  id: string;
  term: string;
  partOfSpeech: CoreLexiconEntry['partOfSpeech'];
  meaningZh: string;
  translationZh: string;
  definitionEn: string;
  example: null;
  transferExample: null;
  collocations: [];
  mnemonicZh: null;
  pronunciation: {
    ipaUs: null;
    arpabet: string;
    syllables: [];
    stressedSyllable: null;
    tipZh: null;
  };
  pronunciationVariants: CorePronunciationVariant[];
  sourceExamples: string[];
  synonyms: string[];
  sourceTags: string[];
  sourceSenseId: string;
  sourceRecords: CoreSourceRecords;
  routes: RouteId[];
  frequency: GeneralFrequency;
  examFrequency: null;
  /** Shared source records; join sourceRecords to the original source row/synset/CMU key. */
  provenance: Readonly<Partial<Record<CoreContentField, FieldProvenance>>>;
}
/** A candidate never enters a learning queue until actual definition and pronunciation are available. */
export interface CandidateWord {
  kind: 'candidate';
  term: string;
  reason: string;
  sourceSenseId?: string;
}
export type LearningWord = Word | CoreWord;

export const contentTierLabels: Readonly<Record<ContentTier, string>> = {
  curated: '完整教学', core: '来源底库', candidate: '待补资料，不进入学习',
};
export const isCuratedWord = (word: LearningWord): word is Word => word.kind === 'curated';
export const isCoreWord = (word: LearningWord): word is CoreWord => word.kind === 'core';
export const isLearnableWord = (word: LearningWord | CandidateWord): word is LearningWord => word.kind !== 'candidate';

const supportedRoutes = new Set<RouteId>(['ielts', 'toefl', 'cet6', 'gre', 'daily']);
const supportedParts = new Set(['noun', 'verb', 'adjective', 'adverb']);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const arpabetPhone = /^(?:(?:AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)[012]|B|CH|D|DH|F|G|HH|JH|K|L|M|N|NG|P|R|S|SH|T|TH|V|W|Y|Z|ZH)$/;
const hasPrimaryStress = (value: unknown): value is string => nonempty(value)
  && value.split(' ').every(phone => arpabetPhone.test(phone))
  && value.split(' ').some(phone => /1$/.test(phone));

/** Checks bundled data contracts; the importer and retained hashes establish upstream traceability. */
export function validateCoreLexicon(data: CoreLexiconPackage): string[] {
  const issues: string[] = [];
  if (data.metadata.schemaVersion !== 1 || !nonempty(data.metadata.version)) issues.push('unsupported core lexicon schema/version');
  if (data.metadata.count !== data.entries.length) issues.push('core metadata count does not match entries');
  for (const key of ['wordnet', 'cow', 'cmudict', 'wordfreq']) {
    const source = data.metadata.sources[key];
    if (!source || !['name', 'url', 'version', 'license'].every(field => nonempty(source[field]))) issues.push(`missing core source metadata: ${key}`);
  }
  const ids = new Set<string>();
  const terms = new Set<string>();
  for (const entry of data.entries) {
    const context = entry.term || entry.id || 'unknown';
    if (!nonempty(entry.id) || !entry.id.startsWith('core-wn30-')) issues.push(`${context}: invalid stable core id`);
    if (ids.has(entry.id)) issues.push(`${context}: duplicate core id`);
    ids.add(entry.id);
    if (!/^[a-z]+$/.test(entry.term)) issues.push(`${context}: invalid core headword`);
    if (terms.has(entry.term)) issues.push(`${context}: duplicate core headword`);
    terms.add(entry.term);
    if (!supportedParts.has(entry.partOfSpeech)) issues.push(`${context}: unknown source part of speech`);
    if (!nonempty(entry.definitionEn) || !nonempty(entry.translationZh)) issues.push(`${context}: missing source definition or translation`);
    if (!hasPrimaryStress(entry.arpabet)) issues.push(`${context}: missing pinned pronunciation evidence`);
    if (!Array.isArray(entry.pronunciationVariants) || !entry.pronunciationVariants.length
      || entry.pronunciationVariants.some(variant => !nonempty(variant.key) || !nonempty(variant.arpabet)
        || variant.arpabet.split(' ').some(phone => !arpabetPhone.test(phone)))) issues.push(`${context}: missing or invalid original pronunciation variants`);
    if (entry.ipaDictionary !== null) issues.push(`${context}: unsupported dictionary IPA claim`);
    if (!/^\d{8}-[nvars]$/.test(entry.sourceSenseId)) issues.push(`${context}: invalid WordNet sense reference`);
    if (!Array.isArray(entry.synonyms) || entry.synonyms.some(value => !nonempty(value))) issues.push(`${context}: invalid source synonyms`);
    if (!Array.isArray(entry.examples) || entry.examples.some(value => !nonempty(value))) issues.push(`${context}: invalid source examples`);
    if (!Array.isArray(entry.sourceTags) || entry.sourceTags.some(value => !nonempty(value))) issues.push(`${context}: invalid source tags`);
    if (!Array.isArray(entry.routes) || entry.routes.some(route => !supportedRoutes.has(route)) || new Set(entry.routes).size !== entry.routes.length) issues.push(`${context}: invalid core routes`);
    if (!Number.isFinite(entry.frequencyZipf) || entry.frequencyZipf <= 0 || entry.frequencyZipf > 9) issues.push(`${context}: invalid real frequency estimate`);
    const record = entry.sourceRecords;
    if (!record || !nonempty(record.wordnetDataFile) || !nonempty(record.cowSynsetId) || !nonempty(record.cmudictKey)
      || (typeof record.wordnetOffset !== 'string' && typeof record.wordnetOffset !== 'number')
      || (record.ecdictRow !== null && (!Number.isInteger(record.ecdictRow) || record.ecdictRow < 1))) issues.push(`${context}: missing source join record`);
    if (record && (record.cowSynsetId !== entry.sourceSenseId || String(record.wordnetOffset).padStart(8, '0') !== entry.sourceSenseId.split('-')[0])) issues.push(`${context}: mismatched source sense join`);
  }
  return issues;
}

function sourceEvidence(metadata: CoreLexiconMetadata, key: string, adaptation: string): FieldProvenance {
  const source = metadata.sources[key];
  return {
    source: source.name,
    sourceUrl: source.url,
    version: source.version,
    license: source.license,
    adaptation,
    review: 'machine-validated; professional-review-pending',
    date: metadata.importedOn ?? metadata.version.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '2026-10-18',
  };
}

/** Shared source objects avoid copying sixteen long provenance descriptions per core headword. */
function coreProvenance(metadata: CoreLexiconMetadata): CoreWord['provenance'] {
  const wn = sourceEvidence(metadata, 'wordnet', 'Selected source synset. Exact source join keys are retained in sourceSenseId/sourceRecords; definitions and supplied examples are not invented.');
  const cow = sourceEvidence(metadata, 'cow', 'Chinese lexical translations aligned to the selected WordNet synset. These are source translations, not an authored Chinese definition or translated examples.');
  const cmu = sourceEvidence(metadata, 'cmudict', 'Exact pinned North American ARPABET at sourceRecords.cmudictKey. No IPA, syllabification, articulation lesson, or pronunciation score is inferred.');
  const freq = sourceEvidence(metadata, 'wordfreq', 'Actual headword-level wordfreq Zipf API output. General mixed-corpus usage; not exam, sense-specific, or US-conversation frequency.');
  const tagSource = metadata.sources.ecdictTags ? sourceEvidence(metadata, 'ecdictTags', 'Original community dictionary applicability tags, joined by sourceRecords.ecdictRow. Not an official exam syllabus, guaranteed coverage, or measured exam frequency.') : wn;
  const routing = { ...tagSource, adaptation: 'Community exam tags map only to their corresponding practice routes. The daily route is editorial general-English selection, not evidence of US-spoken frequency. Route policy is retained in the import metadata.' };
  return Object.freeze({
    term: wn, partOfSpeech: wn, definitionEn: wn, sourceSenseId: wn, synonyms: wn, sourceExamples: wn,
    meaningZh: cow, translationZh: cow, 'pronunciation.arpabet': cmu, pronunciationVariants: cmu,
    frequency: freq, routes: routing, sourceTags: tagSource,
  });
}

export function adaptCoreLexicon(data: CoreLexiconPackage, curated: readonly Word[]): CoreWord[] {
  const curatedTerms = new Set(curated.map(word => word.term.toLowerCase()));
  const provenance = coreProvenance(data.metadata);
  const wordfreqSource = data.metadata.sources.wordfreq;
  const importedOn = data.metadata.importedOn ?? data.metadata.version.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? frequencyMetadata.importedOn;
  const core: CoreWord[] = [];
  for (const entry of data.entries) {
    if (curatedTerms.has(entry.term.toLowerCase())) continue;
    // Missing material remains missing; admission requires real definition and CMU evidence.
    if (!nonempty(entry.definitionEn) || !nonempty(entry.translationZh) || !hasPrimaryStress(entry.arpabet)) continue;
    core.push({
      kind: 'core', id: entry.id, term: entry.term, partOfSpeech: entry.partOfSpeech,
      definitionEn: entry.definitionEn, translationZh: entry.translationZh, meaningZh: entry.translationZh,
      pronunciation: { ipaUs: null, arpabet: entry.arpabet, syllables: [], stressedSyllable: null, tipZh: null },
      pronunciationVariants: entry.pronunciationVariants,
      example: null, transferExample: null, collocations: [], mnemonicZh: null,
      sourceExamples: entry.examples, synonyms: entry.synonyms, sourceTags: entry.sourceTags,
      sourceSenseId: entry.sourceSenseId, sourceRecords: entry.sourceRecords, routes: entry.routes,
      frequency: {
        zipf: normalizeZipfEstimate(entry.frequencyZipf), rawZipf: entry.frequencyZipf,
        scope: 'general-english-mixed-corpus', source: 'wordfreq', sourceVersion: wordfreqSource.version,
        sourceUrl: wordfreqSource.url, wordlist: 'best', language: 'en', license: 'CC-BY-SA-4.0',
        importedOn, interpretation: 'general usage estimate; not exam or US-spoken rank',
      },
      examFrequency: null, provenance,
    });
  }
  return core;
}

export interface LearningIndex {
  readonly words: readonly LearningWord[];
  find(id: string): LearningWord | undefined;
  forRoute(route: RouteId): readonly LearningWord[];
  search(query: string, options?: { route?: RouteId; tier?: 'curated' | 'core'; limit?: number }): LearningWord[];
}

/** Build once. Queues resolve IDs in O(1); route buckets and normalized search text are reused. */
export function createLearningIndex(entries: readonly LearningWord[]): LearningIndex {
  const byId = new Map(entries.map(word => [word.id, word]));
  const byTerm = new Map(entries.map(word => [word.term.toLowerCase(), word]));
  const byRoute = new Map<RouteId, LearningWord[]>([...supportedRoutes].map(route => [route, []]));
  const searchable = entries.map(word => ({ word, text: `${word.term}\n${word.meaningZh}\n${word.definitionEn}`.toLowerCase() }));
  for (const word of entries) for (const route of word.routes) byRoute.get(route)?.push(word);
  return {
    words: entries,
    find: id => byId.get(id),
    forRoute: route => byRoute.get(route) ?? [],
    search(query, options = {}) {
      const needle = query.trim().toLowerCase();
      const requestedLimit = options.limit ?? 30;
      const limit = Number.isNaN(requestedLimit) ? 30 : Math.max(0, Math.min(200, Math.floor(requestedLimit)));
      if (!limit) return [];
      const found: LearningWord[] = [];
      const seen = new Set<string>();
      const matchesFilters = (word: LearningWord) => (!options.route || word.routes.includes(options.route))
        && (!options.tier || word.kind === options.tier);
      const append = (word: LearningWord) => { found.push(word); seen.add(word.id); };
      if (needle) {
        const exact = byTerm.get(needle);
        if (exact && matchesFilters(exact)) append(exact);
        if (found.length === limit) return found;
        for (const { word } of searchable) {
          if (!seen.has(word.id) && word.term.toLowerCase().startsWith(needle) && matchesFilters(word)) append(word);
          if (found.length === limit) return found;
        }
      }
      for (const { word, text } of searchable) {
        if (seen.has(word.id) || !matchesFilters(word)) continue;
        if (needle && !text.includes(needle)) continue;
        append(word);
        if (found.length === limit) break;
      }
      return found;
    },
  };
}
