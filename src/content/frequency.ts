import table from './frequency-table.json';

export interface GeneralFrequency {
  /** Raw wordfreq Zipf result above its missing-word sentinel; not a sense rank. */
  zipf: number | null;
  /** Unmodified API output. Zero means not covered by the selected list. */
  rawZipf: number | null;
  scope: 'general-english-mixed-corpus';
  source: 'wordfreq';
  sourceVersion: string;
  sourceUrl: string;
  wordlist: 'best';
  language: 'en';
  license: 'CC-BY-SA-4.0';
  importedOn: string;
  interpretation: 'general usage estimate; not exam or US-spoken rank';
}

export const frequencyMetadata = table.metadata;
export const frequencyRawTable: Readonly<Record<string, number>> = table.terms;

/** Zero is wordfreq's missing-list sentinel, not evidence of zero real use. */
export const normalizeZipfEstimate = (raw: number | null): number | null =>
  raw !== null && Number.isFinite(raw) && raw > 0 ? raw : null;

export function generalFrequencyFor(term: string): GeneralFrequency {
  const raw = frequencyRawTable[term.toLowerCase()] ?? null;
  return {
    zipf: normalizeZipfEstimate(raw),
    rawZipf: raw,
    scope: 'general-english-mixed-corpus',
    source: 'wordfreq',
    sourceVersion: frequencyMetadata.sourceVersion,
    sourceUrl: frequencyMetadata.sourceUrl,
    wordlist: 'best',
    language: 'en',
    license: 'CC-BY-SA-4.0',
    importedOn: frequencyMetadata.importedOn,
    interpretation: 'general usage estimate; not exam or US-spoken rank',
  };
}

export interface FrequencySortable {
  term: string;
  frequency: Pick<GeneralFrequency, 'zipf'>;
}

/** Higher general usage estimate first; unknown last; ties by headword. */
export function compareByGeneralFrequency(a: FrequencySortable, b: FrequencySortable): number {
  const left = a.frequency.zipf;
  const right = b.frequency.zipf;
  if (left !== right) {
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  }
  return a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
}
