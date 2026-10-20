# WriEng content review — 2026-10-17

This is an AI-assisted editorial and structural review, with an independent second-agent sample check. It is **not professional linguistic, medical, exam-board, or human editorial certification**. Every entry retains `machine-validated; professional-review-pending`.

## Scope and selection

The original 100 headwords were read for sense focus, definition/example agreement, practical use, and route fit. They form a useful introductory core, but their source-file distribution gives only 20 entries specifically to daily situations; another 6 society entries also carry the daily route. The original three broad academic/science/society modules each contain 20 entries, and the GRE module contains 20. This is a starting selection, not a complete IELTS, TOEFL, CET-6, GRE, or daily-life syllabus.

The update adds **72 distinct headwords and selected senses** rather than alternate spellings, generated inflections, or near-duplicate example cards:

| New module | Entries | Selection purpose |
| --- | ---: | --- |
| `src/content/daily-expanded.ts` | 32 | Housing, maintenance, bills, communicating at a clinic or pharmacy, shopping, food storage, and work schedules/pay |
| `src/content/academic-expanded.ts` | 40 | Reading arguments, study design, interpreting quantitative claims, and precise academic/GRE distinctions |

The resulting library has **172 entries with 344 bilingual example pairs**. Route membership overlaps: IELTS 97, TOEFL 90, CET-6 112, GRE 67, daily 58. These counts describe editorial practice routes. They are not counts of official exam requirements or verified exam-frequency entries.

The new daily entries fill specific gaps left by the first release:

- Housing and maintenance: `landlord`, `tenant`, `maintenance`, `leak`, `plumber`, `utilities`, `thermostat`, `laundry`, `renewal`.
- Bills and insurance communication: `invoice`, `overdue`, `balance`, `installment`, `copay`, `coverage`.
- Clinic and pharmacy language: `referral`, `symptom`, `allergy`, `generic`, `dosage`. The examples describe asking, reading, and reporting; they give no diagnosis, treatment recommendation, medicine choice, or numerical dosage.
- Shopping and meals: `aisle`, `coupon`, `checkout`, `cashier`, `curbside`, `leftovers`, `pantry`.
- Work: `shift`, `paycheck`, `overtime`, `availability`, `deadline`.

The academic expansion deliberately includes distinctions that make reading and writing more precise: `infer` versus `imply`; correlation versus causal attribution; `qualitative` versus `quantitative`; `interval` versus `duration`; evidence that `substantiates` or `corroborates` versus an argument it `undermines`, `contradicts`, or `refutes`. More specialized items such as `equivocal`, `disparate`, and the model-selection sense of `parsimonious` are assigned narrowly rather than to every exam route.

## Review of the original 100

All 100 original headwords were retained. They cover transferable academic operations (`analyze`, `evaluate`, `synthesize`), research/ecology (`hypothesis`, `habitat`, `variable`), social policy (`equitable`, `allocate`, `incentive`), argument/attitude (`plausible`, `skeptical`, `concede`), and useful service encounters (`receipt`, `lease`, `outlet`). No term was removed or renamed, so existing learning IDs remain stable.

Two specific corrections were made:

1. `variable`: the study example now identifies light level as **the variable being changed**, while temperature remains constant. It no longer implies that a study has only one variable in every sense, including its measured outcome.
2. `grocery`: the entry now consistently teaches the store sense, usually encountered in `grocery store`. Its former second example taught the plural purchases sense `groceries`, which belongs in a separate sense entry if added later. The definition, transfer example, third collocation, and mnemonic now match the chosen store sense. The term and part of speech remain unchanged.

Some retained entries intentionally use a learner-level umbrella sense, such as `available` (ready/free for use) and `concede` (reluctant admission, including admission of defeat). Their examples remain related uses rather than extra separately counted entries. The biological description of `species` is an introductory simplification; it does not cover every taxonomic species concept. Such limits remain part of the professional-review backlog rather than being presented as expert certification.

## What each added entry supplies

Each of the 72 additions has an original Simplified Chinese meaning, an English definition, two different natural example situations with Chinese translations, three collocations, a light humorous memory aid, a US-oriented IPA teaching draft, learner-facing rhythm chunks, a primary-stress index, a concrete articulation/stress note, and deliberately selected routes. Medical and insurance entries teach language rather than coverage guarantees or advice. Humor supports recall without replacing the meaning or mocking people with health conditions.

The original text is released as an AI-assisted CC0 draft, separately from source data. It was not copied from proprietary exam books or dictionary definitions. All content fields continue to carry source/version/license/adaptation/review metadata through the aggregator; see [CONTENT-SOURCES.md](CONTENT-SOURCES.md) for the data and license inventory.

## Pronunciation evidence and its limits

CMUdict evidence is selected for the intended word class: adjective `abstract`, verb `attribute`, verb `contrast`, and noun `survey` use explicitly selected variants. `obsolete` likewise uses its documented final-primary variant. The imported CMU string is preserved rather than rewritten to resemble the teaching aid.

There are two especially visible exceptions:

- `copay` is absent from the pinned CMUdict revision. Its original IPA/stress draft remains available, while ARPABET is explicitly missing. The app must not borrow `copayment` phonemes and label them as `copay` evidence.
- `undermine` uses a documented final-primary teaching variant, while the pinned CMU entry has initial primary and final secondary stress. The exception and a dictionary verification link are recorded separately in `frequency-cmu-stress-exceptions.json`.

`overdue` has two primary-stress markers in the pinned source; the teaching note emphasizes `due`. The validator should allow an evidenced primary index without changing that source string. Weak-vowel and regional differences require linguistic review: examples include the teaching `/ɑ/` versus selected CMU `AO2` in `coupon`, a teaching weak `/ə/` versus `IH0` in `quantitative`, and initial teaching `/ɪ/` versus `EH0` in `extrapolate`. This review did not professionally confirm those variants. Matching the primary-stress index does not establish complete IPA agreement or pronunciation quality. Rhythm chunks are teaching aids, not a claim of formal syllabification. TTS pronunciation and accent also depend on the installed voice.

## Frequency interpretation

The reproducible importer and generated manifest are maintained separately from the seed text in `scripts/import-frequency.py` and `src/content/frequency-import-manifest.json`. The importer queries actual `wordfreq` data for the headword and pins its environment, API arguments, source version, hashes, and retained notices. See [CONTENT-SOURCES.md](CONTENT-SOURCES.md) for the precise source and license scope.

General English Zipf frequency is an auxiliary signal for selection and display. It is not a measurement of the selected sense alone, an exam-frequency claim, an American-speech frequency rank, or proof that these 172 are the highest-frequency words. Inflected forms, part-of-speech ambiguity, and multiple senses can share a headword-level value. Selection also considers the value of a scene-specific expression: for example, `thermostat` or `copay` may be valuable in a real encounter even when general frequency is modest.

## Validation record

- Enumerated all seven seed modules: 172 headwords, no duplicate headword, 32 new daily entries, and 40 new academic entries.
- Checked every addition for a definition, two distinct example fields, three collocations, a mnemonic, pronunciation teaching fields, and nonempty editorial routes.
- Read all 100 original definitions/examples/collocations and made the two sense-precision corrections above.
- Independent second-agent checks covered 12 daily entries and 12 academic entries. No definite meaning, bilingual-example, collocation, part-of-speech, or primary-stress error was found in those 24 entries. A wording issue in the `quantitative` articulation note was corrected: it no longer assigns the `/nt/` sequence to a particular teaching chunk.
- The independent daily sample was `landlord`, `leak`, `thermostat`, `invoice`, `installment`, `referral`, `generic`, `coupon`, `curbside`, `shift`, `availability`, and `deadline`. The academic sample was `contrast`, `distinguish`, `attribute`, `survey`, `qualitative`, `quantitative`, `duration`, `refute`, `equivocal`, `parsimonious`, `corroborate`, and `extrapolate`. The selected part-of-speech variants were confirmed. `duration` has source primary markers at indices 0 and 1; the teaching aid selects index 1.
- The independent reviewer called `wordfreq` 3.1.1 using `zipf_frequency(term, 'en', wordlist='best')`: the 24 sampled values, followed by all 172 headword values, matched the generated frequency table exactly. The checked table SHA-256 was `dd2b51c38377d44090e41580b0f9e1b7dd860bb6bf582d288a8754bee498689b`. This checks data reproduction, not exam or sense-specific frequency.
- `npm test -- src/content.test.ts`: **13/13 passed** after the seed additions and corrections. This verifies the implemented content rules, not expert language quality. Root-level build, scheduler, offline, layout, and browser tests are reported separately.

This remains a compact curated learning library. Further expansion should add reviewed senses and real scenes, preserve headword/field provenance, and keep general frequency distinct from exam or US conversational evidence. A larger total alone is not an acceptance criterion.
