import { describe, expect, it } from 'vitest';
import { compareByGeneralFrequency, contentFields, contentStats, findWord, generalFrequencyFor, routes, sortByGeneralFrequency, validateContent, words, type Word } from './content';
import { frequencyMetadata, frequencyRawTable, normalizeZipfEstimate } from './content/frequency';
import importManifest from './content/frequency-import-manifest.json';
import pronunciationSelections from './content/frequency-cmu-selection.json';
import pronunciationStressVariants from './content/frequency-cmu-stress-exceptions.json';

const copy = (): Word => structuredClone(words[0]);

describe('the shipped learning content', () => {
  it('has at least 172 independent senses and at least 50 choices per route', () => {
    expect(words.length).toBeGreaterThanOrEqual(172);
    expect(new Set(words.map(word => word.id)).size).toBe(words.length);
    expect(new Set(words.map(word => `${word.term}:${word.partOfSpeech}:${word.meaningZh}`)).size).toBe(words.length);
    for (const route of routes) {
      expect(words.filter(word => word.routes.includes(route.id)).length, route.id).toBeGreaterThanOrEqual(50);
      expect(contentStats.routeCounts[route.id]).toBe(words.filter(word => word.routes.includes(route.id)).length);
    }
  });

  it('passes content rules, with complete source details for every displayed field', () => {
    expect(validateContent()).toEqual([]);
    for (const word of words) {
      expect(Object.keys(word.provenance)).toEqual([...contentFields]);
      if (word.pronunciation.arpabet !== null) expect(word.provenance['pronunciation.arpabet'].license).toContain('BSD-2-Clause');
      else expect(word.provenance['pronunciation.arpabet'].license).toContain('Not applicable');
      expect(word.provenance.example.license).toBe('CC0-1.0');
      expect(word.provenance.example.review).toContain('professional-review-pending');
    }
  });

  it('keeps primary stress consistent with the pinned North American phoneme evidence', () => {
    for (const word of words) {
      if (word.pronunciation.arpabet === null) {
        expect((pronunciationSelections as Record<string, string | null>)[word.term]).toBeNull();
        expect(word.provenance['pronunciation.ipaUs'].adaptation).toContain('professional review pending');
        continue;
      }
      const vowels = word.pronunciation.arpabet!.split(' ').filter(phone => /[012]$/.test(phone));
      const stressIndices = vowels.flatMap((phone, index) => phone.endsWith('1') ? [index] : []);
      const variant = (pronunciationStressVariants as Record<string, { teachingStressIndex: number }>)[word.term];
      if (variant) {
        expect(word.pronunciation.stressedSyllable).toBe(variant.teachingStressIndex);
        expect(vowels[variant.teachingStressIndex]).toMatch(/2$/);
        expect(word.provenance['pronunciation.ipaUs'].adaptation).toContain('documented pronunciation variant');
        continue;
      }
      expect(stressIndices, `${word.term}: ${vowels.join(' ')}`).toContain(word.pronunciation.stressedSyllable);
    }
  });

  it('keeps examples distinct, uses the term in context, and has no broken Unicode', () => {
    for (const word of words) {
      expect(word.example.en).not.toBe(word.transferExample.en);
      // Morphological variants such as declined, findings and groceries are useful in context.
      const stem = word.term.endsWith('e') || /[^aeiou]y$/.test(word.term) ? word.term.slice(0, -1) : word.term;
      expect(word.example.en.toLowerCase()).toContain(stem);
      expect(JSON.stringify(word)).not.toContain('\uFFFD');
      expect(word.collocations.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps exam frequency unknown and never invents independent professional review', () => {
    expect(words.every(word => word.examFrequency === null)).toBe(true);
    expect(contentStats.verifiedExamFrequencyEntries).toBe(0);
    expect(contentStats.professionalReview).toBe(false);
    expect(findWord(words[0].id)?.term).toBe(words[0].term);
    expect(findWord('not-a-word-id')).toBeUndefined();
  });
});

describe('content validation rejects corrupt imports or edits', () => {
  it('reports duplicate ids and independent sense duplicates', () => {
    expect(validateContent([copy(), copy()])).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate id'), expect.stringContaining('duplicate sense'),
    ]));
  });

  it('rejects unsupported exam-frequency evidence and incomplete provenance', () => {
    const word = copy();
    (word as unknown as { examFrequency: number }).examFrequency = 98;
    word.provenance.example.license = '';
    expect(validateContent([word])).toEqual(expect.arrayContaining([
      expect.stringContaining('unsupported exam frequency claim'),
      expect.stringContaining('incomplete provenance example'),
    ]));
  });

  it('rejects a repeated transfer example, unknown route, and impossible stress', () => {
    const word = copy();
    word.transferExample.en = word.example.en;
    word.routes = ['made-up-route'] as unknown as Word['routes'];
    word.pronunciation.stressedSyllable = 10;
    expect(validateContent([word])).toEqual(expect.arrayContaining([
      expect.stringContaining('transfer example repeats'),
      expect.stringContaining('invalid route'),
      expect.stringContaining('invalid stress index'),
    ]));
  });

  it('rejects a possible but incorrect primary-stress position', () => {
    const word = copy();
    word.pronunciation.stressedSyllable = 1;
    expect(validateContent([word])).toContain(`${word.id}: stress conflicts with selected pronunciation evidence`);
  });
});

describe('licensed general-English frequency import', () => {
  it('has one unchanged API result per actual headword and source metadata', () => {
    const terms = [...new Set(words.map(word => word.term))].sort();
    expect(Object.keys(frequencyRawTable).sort()).toEqual(terms);
    expect(importManifest.terms).toEqual(terms);
    expect(frequencyMetadata.termCount).toBe(terms.length);
    expect(frequencyMetadata.sourceVersion).toBe('3.1.1');
    expect(frequencyMetadata.dataLicense).toBe('CC-BY-SA-4.0');
    expect(frequencyMetadata.codeLicense).toBe('Apache-2.0');
    expect(frequencyMetadata.wheelSha256).toBe('4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473');
    expect(frequencyMetadata.englishDataSha256).toBe('dffae8066b78dce0a6667cf5f58e567054f902674667090a7ac8a8a44628b05c');
    for (const word of words) {
      expect(word.frequency.rawZipf, word.term).toBe(frequencyRawTable[word.term]);
      expect(word.frequency.zipf).toBe(normalizeZipfEstimate(frequencyRawTable[word.term]));
      expect(word.provenance.frequency.license).toBe('CC-BY-SA-4.0');
      expect(word.provenance.example.license).toBe('CC0-1.0');
      expect(word.frequency.scope).toBe('general-english-mixed-corpus');
      expect(word.frequency.interpretation).toBe('general usage estimate; not exam or US-spoken rank');
    }
    expect(contentStats.verifiedFrequencyEntries).toBe(words.filter(word => word.frequency.zipf !== null).length);
  });

  it('retains actual 3.1.1 estimates and treats the missing-list sentinel as unknown', () => {
    expect(generalFrequencyFor('community').rawZipf).toBe(5.34);
    expect(generalFrequencyFor('available').rawZipf).toBe(5.28);
    expect(generalFrequencyFor('wrieng-not-an-imported-headword').zipf).toBeNull();
    expect(normalizeZipfEstimate(0)).toBeNull();
    expect(normalizeZipfEstimate(null)).toBeNull();
    expect(normalizeZipfEstimate(Number.NaN)).toBeNull();
    expect(normalizeZipfEstimate(5.34)).toBe(5.34);
  });

  it('sorts by general usage without changing the source array, with stable unknowns/ties', () => {
    const source = [words.find(word => word.term === 'available')!, words.find(word => word.term === 'community')!];
    const order = source.map(word => word.id);
    expect(sortByGeneralFrequency(source).map(word => word.term)).toEqual(['community', 'available']);
    expect(source.map(word => word.id)).toEqual(order);
    expect([
      { term: 'zulu', frequency: { zipf: null } },
      { term: 'beta', frequency: { zipf: 3 } },
      { term: 'alpha', frequency: { zipf: 3 } },
      { term: 'absent', frequency: { zipf: null } },
    ].sort(compareByGeneralFrequency).map(item => item.term)).toEqual(['alpha', 'beta', 'absent', 'zulu']);
  });

  it('rejects fabricated values or a false scope/version even when the numeric range is plausible', () => {
    const word = copy();
    word.frequency.zipf = 8;
    expect(validateContent([word])).toContain(`${word.id}: general frequency provenance/value mismatch`);
    word.frequency = generalFrequencyFor(word.term);
    word.frequency.sourceVersion = 'unverified-new-version';
    expect(validateContent([word])).toContain(`${word.id}: general frequency provenance/value mismatch`);
  });
});
