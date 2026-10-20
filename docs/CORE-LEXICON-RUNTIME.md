# Core lexicon runtime contract

`src/content.ts` preserves `words`, `findWord`, and `contentStats` for the original 172 complete teaching entries. Their IDs, sense text, examples, and FSRS history remain intact. Each now has `kind: 'curated'`.

The expanded learning API is `learningWords`, `findLearningWord(id)`, `wordsForLearningRoute(route)`, `searchLearningWords(query, options)`, and `learningContentStats`. A learning word is a discriminated union of the original rich `Word` and a `CoreWord` with `kind: 'core'`. `CandidateWord` is a separate type that cannot enter a learning queue.

## Truthful missing fields

The core package supplies a selected WordNet sense, its English definition, aligned Chinese Open Wordnet lexical translations, actual CMUdict ARPABET, actual wordfreq general-English Zipf output, and source joins. `meaningZh` is a compatibility alias of `translationZh`: the interface labels it **中文译词**, not an authored Chinese definition.

Core entries keep `example`, `transferExample`, and `mnemonicZh` as `null`, and `collocations` as an empty array. Source-provided WordNet examples live in `sourceExamples`; they have no invented Chinese translation. Source synonyms live in `synonyms` and must not be labeled collocations. Missing American IPA, syllabification, and articulation guidance remain `null` or empty. Exact North American ARPABET is displayed as phonemes, not mislabeled IPA or speech evaluation. `pronunciationVariants` preserves all source alternatives; a dictionary headword match alone does not certify the selected variant for every part of speech or sense. Audited variant overrides and remaining limits are recorded by the importer.

The data importer excludes entries without a real definition, aligned translation, or actual CMU evidence. Candidate/exclusion totals belong to the import manifest; candidates are not usable cards hidden behind an optimistic total. The adapter also refuses to turn missing definition or pronunciation into a core card, and requires a valid CMU phoneme sequence with a primary-stressed vowel. This caught unit abbreviations whose homographic CMU entries were merely non-vocalic hesitation sounds. `coreCandidateSamples` supplies a small audit sample with reasons; the actual learner total comes from `learningContentStats`, not a raw source-row count.

## Identity and sources

The data importer provides IDs of the form `core-wn30-<term>-<part>-<offset>`. A different selected source sense has a different ID, preventing saved recall history from silently attaching to another meaning. Curated headwords take precedence over imported equivalents; the original IDs remain the identifiers for those 172 entries.

Core source metadata is shared by reference to avoid duplicating long provenance paragraphs thousands of times. Each card retains `sourceSenseId` and `sourceRecords` with its WordNet offset/data file, Chinese Open Wordnet synset, exact CMU key, and optional community-tag source row. Join those keys to the pinned source files/hashes in the generated import metadata to trace a field. Sharing a source object does not remove the per-entry join.

General-English frequency is not an exam frequency, sense-specific frequency, or American conversational frequency. Community exam-applicability tags retain their original source identity and map only to their corresponding routes. A daily route is an editorial general-English selection. `examFrequency` remains `null` for all tiers.

## Runtime budget

The bundled JSON is included with the application and its offline cache; studying does not fetch a dictionary service. The runtime adapts core rows once and reuses their text/example/synonym arrays. It builds ID/headword maps, route buckets, and normalized search text once. Saved queues resolve IDs with a map lookup. Search ranks an exact headword before prefix and definition/translation matches, returns 30 cards by default, and caps the result at 200, so a view need not render the entire dictionary. The UI can request smaller batches.

The adapter does not rewrite or migrate the IndexedDB schema. Existing FSRS records use the same stable word IDs. Importer reproducibility/source tests, runtime contract tests, scheduler tests, and production browser/offline checks cover different claims; passing a structural test does not establish professional language review.

## Verified snapshot — 2026-10-18

The frozen source package contains **6,000 distinct core headwords**. Together with the original 172 curated entries, `learningWords` contains **6,172 usable cards**. All 6,000 core entries have an actual English source definition, aligned Chinese lexical translations, valid CMU phonemes with a primary-stressed vowel, and an actual nonzero general-English wordfreq result. The original `copay` curated entry remains the explicit CMU exception; its original teaching draft is not relabeled as source phonemes.

Of the core entries, 3,259 have source examples, totaling 5,113 actual English example sentences; 2,741 have no source example and keep that field empty. The manifest separately records 50,617 source candidates and 6,894 eligible headwords outside the selected limit. Neither number is included in the learner total.

The combined editorial/community-reference route counts are daily 6,058; IELTS 2,366; TOEFL 2,583; CET-6 2,785; GRE 1,619. Routes overlap and remain distinct from exam-frequency evidence.

Source JSON SHA-256: `89e2a15820e84f34bb9725fcdbfbcec14c45513716995f227f97f2d9df3451e1` (4,613,098 UTF-8 bytes). `npm test -- src/content.test.ts src/core-lexicon.test.ts` passed **21/21**; `npm run typecheck` passed. These checks include preserving old IDs, exact source joins, rejecting missing or invalid pronunciation, keeping absent teaching fields absent, source-tag route boundaries, excluding candidates, and bounded/indexed search.
