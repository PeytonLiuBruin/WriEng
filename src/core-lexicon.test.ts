import { describe, expect, it } from 'vitest';
import {
  coreLexiconData, coreLexiconMetadata, coreWords, findLearningWord, findWord,
  isCoreWord, isCuratedWord, isLearnableWord, learningContentStats, learningWords,
  searchLearningWords, validateCoreLexicon, words, wordsForLearningRoute,
} from './content';
import { adaptCoreLexicon, type CoreLexiconPackage } from './core-lexicon';

describe('the usable source lexicon', () => {
  it('ships more than five thousand usable entries while keeping all curated cards and IDs', () => {
    expect(coreLexiconData).not.toBeNull();
    expect(coreWords.length).toBeGreaterThanOrEqual(5_000);
    expect(words).toHaveLength(172);
    expect(learningWords.length).toBe(words.length + coreWords.length);
    expect(learningContentStats.total).toBe(learningWords.length);
    expect(new Set(learningWords.map(word => word.id)).size).toBe(learningWords.length);
    expect(new Set(learningWords.map(word => word.term.toLowerCase())).size).toBe(learningWords.length);
    expect(findWord('analyze-verb-1')?.term).toBe('analyze');
    for (const word of words) {
      expect(word.kind).toBe('curated');
      expect(findLearningWord(word.id)).toBe(word);
    }
  });

  it('passes source contracts and preserves exact per-entry joins', () => {
    expect(validateCoreLexicon(coreLexiconData!)).toEqual([]);
    const records = new Map(coreLexiconData!.entries.map(entry => [entry.id, entry]));
    for (const word of coreWords) {
      const entry = records.get(word.id)!;
      expect(word.definitionEn).toBe(entry.definitionEn);
      expect(word.translationZh).toBe(entry.translationZh);
      expect(word.meaningZh).toBe(entry.translationZh);
      expect(word.pronunciation.arpabet).toBe(entry.arpabet);
      expect(word.pronunciationVariants).toBe(entry.pronunciationVariants);
      expect(word.sourceSenseId).toBe(entry.sourceSenseId);
      expect(word.sourceRecords).toBe(entry.sourceRecords);
      expect(word.sourceExamples).toBe(entry.examples);
      expect(word.synonyms).toBe(entry.synonyms);
      expect(word.sourceTags).toBe(entry.sourceTags);
      expect(word.frequency.rawZipf).toBe(entry.frequencyZipf);
      expect(word.provenance.definitionEn?.license).toBe(coreLexiconMetadata!.sources.wordnet.license);
      expect(word.provenance.translationZh?.license).toBe(coreLexiconMetadata!.sources.cow.license);
      expect(word.provenance['pronunciation.arpabet']?.license).toBe(coreLexiconMetadata!.sources.cmudict.license);
      expect(word.provenance.frequency?.license).toBe('CC-BY-SA-4.0');
    }
  });

  it('does not manufacture missing teaching fields or disguise synonyms as collocations', () => {
    for (const word of coreWords) {
      expect(word.example).toBeNull();
      expect(word.transferExample).toBeNull();
      expect(word.mnemonicZh).toBeNull();
      expect(word.collocations).toEqual([]);
      expect(word.pronunciation.ipaUs).toBeNull();
      expect(word.pronunciation.tipZh).toBeNull();
      expect(word.pronunciation.syllables).toEqual([]);
      expect(word.pronunciation.stressedSyllable).toBeNull();
      expect(word.provenance.example).toBeUndefined();
      expect(word.examFrequency).toBeNull();
      expect(word.frequency.interpretation).toBe('general usage estimate; not exam or US-spoken rank');
    }
  });

  it('maps only real community applicability tags to exam routes', () => {
    const tags = { ielts: 'ielts', toefl: 'toefl', cet6: 'cet6', gre: 'gre' } as const;
    for (const word of coreWords) for (const route of word.routes) {
      if (route !== 'daily') expect(word.sourceTags, `${word.term}: ${route}`).toContain(tags[route]);
    }
    expect(learningContentStats.verifiedExamFrequencyEntries).toBe(0);
    expect(learningContentStats.professionalReview).toBe(false);
  });

  it('keeps candidates outside all learning queues and requires a definition plus actual pronunciation', () => {
    expect(isLearnableWord({ kind: 'candidate', term: 'unadmitted', reason: 'No verified pronunciation available' })).toBe(false);
    expect(learningWords.every(isLearnableWord)).toBe(true);
    expect(isCuratedWord(words[0])).toBe(true);
    expect(isCoreWord(coreWords[0])).toBe(true);
    const draft = structuredClone(coreLexiconData!) as CoreLexiconPackage;
    draft.entries = draft.entries.slice(0, 2);
    draft.metadata.count = 2;
    draft.entries[0].definitionEn = '';
    draft.entries[1].arpabet = '';
    expect(validateCoreLexicon(draft)).toEqual(expect.arrayContaining([
      expect.stringContaining('missing source definition'), expect.stringContaining('pronunciation evidence'),
    ]));
    expect(adaptCoreLexicon(draft, words)).toEqual([]);
  });

  it('does not silently relabel missing dictionary IPA or fabricated frequency as source data', () => {
    const draft = structuredClone(coreLexiconData!) as CoreLexiconPackage;
    draft.entries = draft.entries.slice(0, 1);
    draft.metadata.count = 1;
    (draft.entries[0] as unknown as { ipaDictionary: string }).ipaDictionary = '/unverified/';
    draft.entries[0].frequencyZipf = Number.NaN;
    expect(validateCoreLexicon(draft)).toEqual(expect.arrayContaining([
      expect.stringContaining('unsupported dictionary IPA'), expect.stringContaining('real frequency'),
    ]));
  });

  it('rejects Chinese and English records joined to different source senses', () => {
    const draft = structuredClone(coreLexiconData!) as CoreLexiconPackage;
    draft.entries = draft.entries.slice(0, 1);
    draft.metadata.count = 1;
    draft.entries[0].sourceRecords.cowSynsetId = '00000000-n';
    expect(validateCoreLexicon(draft)).toContain(`${draft.entries[0].term}: mismatched source sense join`);
  });

  it('reuses indexed references, bounded searches, route buckets, and shared provenance', () => {
    const entry = coreWords.at(-1)!;
    expect(findLearningWord(entry.id)).toBe(entry);
    expect(findLearningWord('unknown-learning-id')).toBeUndefined();
    expect(coreWords[0].provenance).toBe(coreWords.at(-1)!.provenance);
    expect(wordsForLearningRoute('daily')).toBe(wordsForLearningRoute('daily'));
    expect(searchLearningWords('', { limit: 5 })).toHaveLength(5);
    expect(searchLearningWords('', { limit: 5, tier: 'core' }).every(isCoreWord)).toBe(true);
    expect(searchLearningWords('', { limit: 10_000 })).toHaveLength(200);
    expect(searchLearningWords('', { limit: 0 })).toEqual([]);
    expect(searchLearningWords('', { limit: Number.NaN })).toHaveLength(30);
    expect(searchLearningWords('do', { tier: 'core', limit: 1 })[0]?.term).toBe('do');
    expect(searchLearningWords(entry.term, { tier: 'core', limit: 200 })).toContain(entry);
  });
});
