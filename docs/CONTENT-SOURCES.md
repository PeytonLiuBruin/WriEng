# WriEng content sources and review record

Content version: `wrieng-original-2026-10-17-v2`
Prepared and checked: **2026-10-17**

This page documents the separate **172 original teaching entries**. The current application also includes **6,000 real bilingual core headwords**, bringing the combined distinct learning pool to **6,172**. See [CORE-LEXICON-SOURCES.md](CORE-LEXICON-SOURCES.md) for that core's WordNet/COW/CMUdict sources, candidate exclusions, standalone notices and reproducible import. The smaller counts below refer to the original teaching source group rather than the complete current library.

## What is actually shipped

This local edition contains **172 distinct headwords / independent learning senses**, **344 original bilingual example pairs** (one study example and one different transfer example per sense), at least two collocations per sense, original Chinese memory cues, and American pronunciation aids. These are a compact, curated starting library, not a comprehensive IELTS, TOEFL, CET-6 or GRE curriculum. Every headword has an actual imported general-English wordfreq estimate; this is separate from exam frequency, which remains unknown.

| Learning route | Available senses | What the label means |
| --- | ---: | --- |
| IELTS | 97 | Editorial selection for social, environmental, and argument topics |
| TOEFL | 90 | Editorial selection for campus, science, and research contexts |
| CET-6 / 六级 | 112 | Editorial selection for general reading and writing |
| GRE | 67 | Editorial selection for precise meanings and reasoning |
| American daily life | 58 | Shopping, transport, rentals, appointments, and other practical contexts |

Routes overlap. These counts do not add up to 172. No imported exam paper corpus or licensed exam-frequency dataset supports an exam ranking in this edition. **Every `examFrequency` value is `null`**, and `verifiedExamFrequencyEntries` is zero. The independent `frequency` object contains a general-English mixed-corpus Zipf estimate from wordfreq 3.1.1. Neither route membership nor that general estimate is a claim of official inclusion, exam frequency, rank, or guaranteed appearance on an exam. The app must not market this edition as an official exam word list or a validated exam-frequency ranking.

The route counts are available programmatically as `contentStats.routeCounts` in `src/content.ts`. They are tested against the underlying entries so that the documentation can be updated when the library changes.

The v2 content pass adds 72 selected senses in `daily-expanded.ts` and `academic-expanded.ts`; every new sense has a study example and a distinct transfer example, with both Chinese translations. Two original entries were focused without changing their headword, part of speech or stable id: `variable` now specifies the light level as the variable being changed while temperature is held constant, rather than claiming that no other variable exists; `grocery` now consistently teaches the store sense, including the transfer sentence “The new grocery store stays open until ten.” Its earlier groceries/shopping-item sense is no longer mixed into that one record. Further spot-review scope is documented by the content-review record; spot checks do not replace professional linguistic review.

## Field-level provenance

Each `Word` has a `provenance` record for all sixteen content fields:

`term`, `partOfSpeech`, `meaningZh`, `definitionEn`, `example`, `transferExample`, `collocations`, `mnemonicZh`, `pronunciation.ipaUs`, `pronunciation.syllables`, `pronunciation.stressedSyllable`, `pronunciation.tipZh`, `pronunciation.arpabet`, `routes`, `frequency`, and `examFrequency`.

Each field record stores **source, sourceUrl, version, license, adaptation, review, and date**. Original-content source locators include the actual source file and headword (for example `src/content/academic.ts#analyze`); the headword is a lookup key within the named source file, not a generated HTML anchor. The word id disambiguates the learning sense. The CMUdict field points to an immutable upstream revision. The data records, rather than a generic site credit alone, carry these source details.

| Field group | Source and version | License / adaptation | Review status |
| --- | --- | --- | --- |
| Word choice, selected sense, English definition, Chinese explanation | WriEng original AI-assisted draft; `wrieng-original-2026-10-17-v2` | Original wording dedicated to CC0-1.0; no copied proprietary dictionary definitions | Structural checks passed; professional linguistic review pending |
| English examples and Chinese translations | Same original version; literal Seed modules in `src/content/` | Original examples and translations, CC0-1.0; study and transfer examples use different situations | Distinctness, completeness and headword-context checks passed; professional review pending |
| Collocations and humorous memory cues | Same original version | Original teaching selections and wording, CC0-1.0; jokes are mnemonic stories, not etymology | Completeness checked; professional review pending |
| US IPA, learner chunks, stress display and articulation tips | Original WriEng learner aids; primary stress checked against pinned CMUdict where available, with the documented undermine stress variant | CC0-1.0 for original aids; these are editorial aids, not copied IPA dictionary entries | Primary-stress consistency or explicit exceptions checked by test; full phonetic/professional review pending |
| North American ARPABET | Carnegie Mellon University CMUdict; revision `74790861f652b15e4ac49015a90074ad62a27690` | CMUdict BSD-2-Clause notice, conditions and disclaimer retained in `src/content/CMUdict-LICENSE.txt` | Exact upstream strings retained; CMUdict itself warns that errors and omissions may remain |
| Routes | WriEng editorial context selection; original version | CC0-1.0; not an official syllabus or frequency list | Membership and minimum route size checked; exam-corpus review pending |
| General frequency | Actual `zipf_frequency(term, 'en', wordlist='best')` output from wordfreq 3.1.1 | CC-BY-SA-4.0 derived table, separate from CC0 teaching content; raw output retained | Wheel/data hashes and regeneration checked; corpus/word-sense/exam scope not inferred |
| Exam frequency | No verified exam source imported | Unknown, deliberately `null`; no invented statistic | Validator rejects non-null values in this edition |

Common words, spellings, sound facts and collocations are factual language material. The CC0 dedication applies to WriEng's original teaching wording and selections to the extent applicable; it does not relicense third-party material or imply ownership of the English language. See the [CC0 1.0 Universal public-domain dedication](https://creativecommons.org/publicdomain/zero/1.0/).

No claim of review by a certified teacher, exam board, native speaker panel, or professional phonetician is made. The explicit machine-readable status is `machine-validated; professional-review-pending`. Automated structural checks do not certify linguistic correctness.

## CMUdict acquisition and attribution

Official upstream: [CMUdict maintained by CMUSphinx](https://github.com/cmusphinx/cmudict). Read-only raw text was obtained from this pinned commit; no upstream script or executable was run:

- [Dictionary text at the pinned revision](https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690/cmudict.dict)
- [Upstream license at the pinned revision](https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690/LICENSE)
- [Upstream project README at the pinned revision](https://github.com/cmusphinx/cmudict/blob/74790861f652b15e4ac49015a90074ad62a27690/README)

Copyright (C) 1993–2015 Carnegie Mellon University. All rights reserved. The complete upstream copyright, two redistribution conditions, acknowledgments, and warranty disclaimer are retained verbatim in `src/content/CMUdict-LICENSE.txt`. Include that notice with source and binary distributions; do not remove it from release artifacts. WriEng adds no endorsement claim.

Checksums of downloaded upstream files, SHA-256:

```text
cmudict.dict  81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22
LICENSE       bd4ce8e44170a5f9f481310ca85c51de3c4f851a65e679b40e603b143bd3542a
```

Only the **171 available phoneme strings for 172 headwords** are shipped in `src/content/cmudict-subset.json`; the full upstream dictionary is not bundled. Selection is by exact lowercase headword. The explicit overrides are **`abstract(2)`** (adjective), **`attribute(2)`** (verb), **`contrast(2)`** (verb), **`survey(2)`** (noun), **`obsolete(2)`** (final primary stress), **`refund(2)`** (noun), and **`detour(2)`** (noun). Other entries use the unnumbered variant, including verb `impact`, noun `refill`, and verbs `correlate` and `replicate` with their final /eɪt/ form. The actual selected keys are recorded in `frequency-import-manifest.json`; overrides are in `frequency-cmu-selection.json`.

`copay` has no entry in this pinned CMUdict, so its ARPABET remains explicitly **null**. Its IPA and stress are original learner aids pending professional review; `copayment` is not silently substituted or cropped. For `undermine`, the source entry gives initial primary and final secondary stress while the original teaching aid uses final primary stress. Both patterns are listed by [Merriam-Webster's official entry](https://www.merriam-webster.com/dictionary/undermine), checked 2026-10-17. This factual stress check is recorded in `frequency-cmu-stress-exceptions.json`; no dictionary definitions, examples or audio were copied. The CMUdict string remains unchanged. The validator accepts this documented variant rather than falsely claiming complete IPA agreement. `overdue` has two primary stress marks in the original CMUdict string; the display may emphasize the final syllable without altering that string.

ARPABET encodes a sound sequence and vowel stress (`0` unstressed, `1` primary, `2` secondary). It is evidence for the displayed stress, not a recording, automated pronunciation evaluation, or a learner score. Learner-facing syllable chunks are spelling aids and not a formal phonological syllabification standard. Natural accents differ, and some weak vowels or vowel-plus-r sequences can be pronounced with different degrees of compression. The IPA convention uses `/ɛ/` for the DRESS vowel; it is an editorial learner transcription rather than a claim that all Americans pronounce every vowel identically.

Browser speech synthesis, if available, is supplied by the user's browser and operating system. Voice selection and voice availability are outside this content package. There is no bundled native-speaker audio collection, and no professional pronunciation scoring service is connected.

## Quality checks and remaining editorial work

`src/content.test.ts` tests thirteen content behaviors, including:

1. At least 172 unique senses and at least 50 choices for every route.
2. Complete field-level provenance, examples, definitions, collocations and pronunciation aids.
3. Primary stress matching selected CMUdict evidence where available, or an explicit source-unavailable / documented pronunciation-variant record. This does not test full phoneme or IPA equivalence.
4. Distinct study and transfer examples; a headword stem in the study sentence; valid Unicode.
5. Unknown exam frequency staying null, with no invented expert-review count.
6. Validator rejection of duplicate senses/ids, unsupported exam-frequency values, altered imported general-frequency data, missing license fields, repeated transfer examples, invalid route names and impossible or unrecorded stress indices.

The additional frequency tests check table-to-headword parity, pinned source version and hashes, independent data/content licenses, actual reference API outputs, missing-list sentinel handling, and stable descending frequency sorting without mutating the source array.

Run from the project root:

```powershell
npm.cmd test -- src/content.test.ts
npm.cmd run typecheck
```

Both commands passed during the 2026-10-17 implementation check. This is evidence of the specified checks, not a claim of complete language accuracy.

Before making exam-specific frequency claims, obtain a clearly licensed relevant exam corpus or validated word list, record its revision and reuse conditions, define its coverage limits, and add independent linguistic review. Any frequency claims should name the corpus, unit of counting, denominator, period, preprocessing and sense limitations. Preserve unknown values when evidence is missing. Do not scrape proprietary dictionary entries, memorize a commercial exam-book list into the repository, or treat an open-access page as an automatic redistribution license.

## Actual general-English frequency layer

The official [PyPI release wordfreq 3.1.1](https://pypi.org/project/wordfreq/3.1.1/) was uploaded **2023-11-21**, as verified through its release metadata. It is a fixed historical data/package version, not a 2026 live corpus. This integration actually calls `wordfreq.zipf_frequency(term, 'en', wordlist='best')` for every literal seed headword. For English, `best` resolves to the bundled `large_en.msgpack.gz`. The result is a logarithmic estimate of general usage in a mixture of text domains. It is **not an exam frequency, a sense-specific count, a lemmatized family count, a percentage, or a measurement of US speech**. A headword's estimate includes uses across its senses and parts of speech, not only the sense taught here.

The shipped 172 raw API results range from **2.00 to 5.34**, with no missing-list sentinel results in this edition. Example actual results are `community = 5.34` and `available = 5.28`. Larger Zipf values indicate more frequent general use. The raw value **0** is wordfreq's missing-word/list-cutoff sentinel; the application maps it to `zipf: null` while keeping `rawZipf: 0`, rather than interpreting it as proof that a word never occurs. A headword absent from the imported table also remains unknown and is rejected by the release content validator.

`Word.frequency` includes the normalized and raw Zipf values, scope, source/version/URL, language `en`, wordlist `best`, data license, import date and an explicit interpretation limit. `Word.examFrequency` remains null. `sortByGeneralFrequency(entries)` returns a new descending array, places unknown estimates last and resolves ties by headword. Route membership remains editorial context selection. General-frequency sorting does not turn route membership into an official exam ranking.

### License separation and downloadable evidence

wordfreq's Python **code** is Apache-2.0. Its **data** is redistributable under CC-BY-SA-4.0 according to the package's own licensing statement. The derived frequency table is independently marked **CC-BY-SA-4.0**; the original teaching text remains in a separate **CC0-1.0** source group and CMUdict strings keep their BSD notice. Source licenses are never replaced by the package's code license.

- `src/content/frequency-table.json`: raw estimates plus source metadata.
- `public/data/frequency-table.json`: identical downloadable data artifact, also included in offline builds.
- `src/content/frequency-import-manifest.json`: headword/source list, selected CMUdict variants, dependency versions, and output hashes.
- `public/licenses/WriEng-frequency-NOTICE.txt`: adaptation, attribution, source separation and scope notice.
- `public/licenses/wordfreq-3.1.1-UPSTREAM-NOTICE.txt`: complete licensing/citation sections extracted unchanged from the verified official wheel's METADATA, including Google Books, OpenSubtitles, and SUBTLEX authors and the notice that SUBTLEX remains freely available. The wheel has no separate upstream NOTICE file; the extraction is clearly labeled.
- `public/licenses/wordfreq-3.1.1-CODE-LICENSE.txt`: upstream code copyright/license notice.
- `public/licenses/CC-BY-SA-4.0.txt`: the complete official Creative Commons data license.

The WriEng notice credits Robyn Speer and the underlying corpus authors and points to the complete upstream credits. It describes the extraction and JSON arrangement and makes no endorsement claim. Keep the attribution, modifications notice, license and share-alike terms with redistributed or adapted frequency tables.

Verified SHA-256 values:

```text
wordfreq-3.1.1-py3-none-any.whl   4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473
large_en.msgpack.gz              dffae8066b78dce0a6667cf5f58e567054f902674667090a7ac8a8a44628b05c
upstream wheel METADATA          fab1698966706a4b5fbfc9e50f7b4eafd96d78b21f75d491235b477bc26081e1
frequency-table.json             dd2b51c38377d44090e41580b0f9e1b7dd860bb6bf582d288a8754bee498689b
cmudict-subset.json              be383f89844c183a96b5d6cc9546e761635f675298c08844d6796bf5695fb139
CC-BY-SA-4.0.txt                 28a9529c7d0bb4dc51f4bf5c116a3d16ef247a052f7591466768ddf563fd1cf5
```

### Reproduce the import on this Windows project

The importer runs in a project-local `.venv` on **CPython 3.12, Windows x64**. `.tools` holds downloaded wheels and pinned raw CMUdict text. Both directories are excluded from version control; no system-wide package installation is required. The requirements lock pins every dependency version and the exact downloaded official PyPI wheel hash. The importer never executes the TypeScript seed modules or any downloaded GitHub script. It reads literal `Seed[]` terms, verifies the package wheel, English data, installed lookup code and CMUdict input hashes, then calls the actual API. It refuses unknown pronunciation variants until an explicit editorial record exists.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip download --index-url https://pypi.org/simple --only-binary=:all: --require-hashes --no-cache-dir --dest .tools\wordfreq-wheels -r scripts\import-frequency-requirements.txt
.\.venv\Scripts\python.exe -m pip install --no-index --find-links .tools\wordfreq-wheels --only-binary=:all: --require-hashes -r scripts\import-frequency-requirements.txt
.\.venv\Scripts\python.exe scripts\import-frequency.py --download-cmudict --as-of 2026-10-17
.\.venv\Scripts\python.exe scripts\import-frequency.py --as-of 2026-10-17 --check
npm.cmd test -- src/content.test.ts
```

The first import may download only the known pinned raw CMUdict text if it is absent, then validates its hash. Subsequent `--check` runs require no network and change no files. Keep `--as-of 2026-10-17` to reproduce this revision's metadata byte for byte. New literal seed modules exporting a name ending in `Seeds` are discovered by both the app and importer; regenerate before building. Reusing a headword for multiple senses requires a sense-aware importer update rather than silently duplicating a frequency row.

The 172-entry import and its read-only regeneration check succeeded on 2026-10-17. `pip check` reported no broken requirements. The release content tests verify source/table parity, while independent spot checks compare actual installed API outputs and raw file hashes. These checks establish reproducibility for this fixed dataset; they do not establish exam relevance, current frequency, linguistic perfection or professional review.
