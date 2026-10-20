# Bilingual core import: real data and field-level sources

Edition: `wn30-cow-cmu-wordfreq-2026-10-18-v1`. Import date: 2026-10-18.

The application now has **6,000 imported, actually learnable core headwords**, separate from its **172 original teaching entries**. A core entry must have a real English definition, a Chinese translation lemma aligned to the **same WordNet synset**, legal CMU phonemes with primary-stress evidence, and an actual nonzero wordfreq estimate. Missing or unresolved records are candidates and do not enter the learning pool. Distinct spellings are counted once; the original teaching headwords are excluded from the new core.

The authoritative current counts, route coverage, missing-field reasons and SHA-256 are in `src/content/core-lexicon-manifest.json`, mirrored at `/data/core-lexicon-manifest.json`. The complete data is `src/content/core-lexicon.json`, with a byte-identical standalone downloadable copy at `/data/core-lexicon.json`. These source records are a dictionary core, without invented lesson features.

## Sources actually used

| Field | Source / version | Permission and transformation |
| --- | --- | --- |
| Headword, POS, English definition, source sense, synonyms, original examples | Princeton WordNet **3.0**, official `WordNet-3.0.tar.gz` | WordNet database license expressly permits use/copy/modify/distribute, with full notice/disclaimer retained. English definition and optional examples are copied from the selected raw synset; adjective position markers `(a)/(p)/(ip)` are grammatical metadata removed from displayed spelling. |
| Chinese translation lemmas | Chinese Open Wordnet via official OMW revision **406bf83b3c507a3d1f26e88252d5d66893fd36bf** | Its own database license expressly permits redistribution with notice. Join by exact offset-POS synset id; display up to three original Chinese lemmas. Embedded morphological `+` joins are removed. Individually recorded wrong source lemmas are omitted without inventing replacement translations. |
| American/North American pronunciation evidence | CMUdict revision **74790861f652b15e4ac49015a90074ad62a27690** | Retained BSD notice. Exact phoneme portions of actual dictionary entries, with source keys and valid alternative readings retained; inline non-phonetic comments removed. |
| General spelling-level Zipf | **wordfreq 3.1.1**; actual `zipf_frequency(term, 'en', wordlist='best')` | Data CC-BY-SA-4.0, code Apache-2.0. Raw numeric outputs are not replaced with guesses. Mixed-domain general English, aggregated across a spelling's meanings/POS. |
| Exam-reference tags | **Only** `tag` facts from ECDICT revision **bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b** | Repository-declared MIT notice retained. Exact source CSV row and tags saved. `ielts`, `toefl`, `cet6`, `gre` map to learning routes as community references; no official frequency inference. |

Princeton's [official WordNet permission page](https://wordnet.princeton.edu/license-and-commercial-use) explicitly covers software **and database**. The [official OMW overview](https://omwn.org/omw1.html) includes Chinese Open Wordnet among redistributable data, and its [source-specific license](https://github.com/omwn/omw-data/blob/406bf83b3c507a3d1f26e88252d5d66893fd36bf/wns/cow/LICENSE) is retained verbatim. We use these source-specific records rather than assuming every item in a mixed third-party dictionary has the same original provenance.

The official ECDICT README says its `phonetic` field is primarily British, `definition` is English, `translation` is Chinese, `tag` holds exam-reference labels, and `bnc`/`frq` are corpus order fields. Its [official source discussion](https://github.com/skywind3000/ECDICT/wiki/%E5%8F%8C%E8%A7%A3%E9%87%8A%E4%B9%89) lists mixed upstream material without field-by-field attribution. Its repository [LICENSE](https://github.com/skywind3000/ECDICT/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/LICENSE) declares MIT, but that alone does not establish each original gloss or phonetic field's upstream rights. Therefore this import **does not copy ECDICT definitions, translations, IPA, audio, Collins/Oxford ratings, BNC or frq values**. Only its community exam-tag facts are used. No claim of official exam approval, current syllabus coverage or frequency is made.

## Selection and honest missing data

The initial intersection probe found 17,053 lowercase headwords with a WordNet sense, COW Chinese and CMU entry before choosing a representative sense. The final pipeline first chooses a sense using WordNet's own historical sense-use counts and deterministic ties, then requires aligned Chinese and all remaining necessary evidence. This prevents choosing an obscure translated meaning merely to fill the library. Three explicitly recorded sense choices prefer ordinary mobile/moving, articulate/put into words, and van/cargo-truck senses over less useful alternatives. The source sense ids, glosses and translations remain unchanged.

This is not a sense-frequency model. wordfreq's spelling-level frequency includes **all** meanings and parts of speech. Reviewed function-word homographs such as `at` as a Lao currency unit and `may` as hawthorn are excluded. So are unresolved unit/abbreviation readings such as `mm`/`hm`, selected inflected homographs such as `years` meaning old age, name-influenced cases such as adjective `august`, and marked register-review items. The original WordNet 3.0 `pants` entry has a women's-underpants sense and is excluded as a default American-trousers lesson. Candidate reasons and the explicit reviewed exclusions are machine-readable in the data/manifest.

The source COW labels can be broad or imperfect even with a structurally exact synset join. Independent checks found and excluded the `书库` lemma from the selected amount-sense `lot`, `灵魂` from the person-sense synset, and `小费` from fixed-charge `fee`. `cinema`'s source Chinese labels emphasize celluloid rather than the selected medium sense, so that entry remains a candidate. No new Chinese translations were generated to hide these defects. Independent spot checks do not certify all 6,000 translations.

Pronunciation admission checks legal ARPABET symbols and primary-stress evidence. A reviewed POS mapping corrects known differences such as live/read/lead, noun wind/wound, adjective aged/learned/perfect, verb present/conduct/graduate/associate and other recorded heteronyms. Every selected source key is in the entry's `sourceRecords`; every available valid source variant remains separate evidence. The mapping and source id are traceable, rather than treating the first CMU pronunciation as automatically suitable for every sense. Other entries remain pending professional sense-specific pronunciation review. No core dictionary IPA is imported or falsely labeled American. Browser speech, when available, comes from the user's system; no native-speaker recording library or pronunciation score is fabricated.

Only actual quoted WordNet examples are included, and only when the selected synset has them. Their Chinese translations are absent. Source synonyms are **not** relabeled collocations. Missing humor, mnemonics, articulation instructions and transfer examples are not replaced with repeated templates. The 172 separate original teaching entries retain their richer fields and original stable ids.

## Standalone redistribution and notices

The derived compilation/frequency layer is marked **CC-BY-SA-4.0**, while the field-specific original notices remain attached. The JSON's root `metadata.sources` embeds the complete WordNet, COW, CMUdict and ECDICT MIT copyright/permission/disclaimer texts **once each**, plus wordfreq author **Robyn Speer**, its complete upstream licensing/citation notice, and the official CC-BY-SA URL. A JSON copied away from this site therefore retains its notices. The manifest repeats the source metadata so its provenance does not depend solely on a running website.

Human-readable release material is in:

- `public/licenses/WriEng-core-NOTICE.txt`
- `public/licenses/WordNet-3.0-LICENSE.txt`
- `public/licenses/COW-LICENSE.txt` and `COW-citation.bib`
- `public/licenses/ECDICT-LICENSE.txt`
- Existing `public/CMUdict-LICENSE.txt`
- Existing wordfreq upstream notice, data-license text and separate code-license notice.

Credit: Princeton University; Francis Bond and Shan Wang for COW; Francis Bond and Ryan Foster for OMW; Carnegie Mellon University and contributors for CMUdict; Robyn Speer and the credited underlying corpus authors for wordfreq; Linwei/skywind3000 and contributors for ECDICT tag references. No source institution endorses WriEng.

## Reproduce without executing upstream scripts

Use the existing project-local CPython 3.12 virtual environment and pinned wordfreq wheels described in `CONTENT-SOURCES.md`. No new package is required. The importer is our own Python parser; it never executes a downloaded Python file, shell script, archive program or TypeScript seed module. It reads raw archive members without extracting paths to disk, reads COW TSV and ECDICT CSV as data, verifies pinned hashes, and queries the verified installed wordfreq API.

```powershell
.\.venv\Scripts\python.exe scripts\import-core-lexicon.py --download --as-of 2026-10-18
.\.venv\Scripts\python.exe scripts\import-core-lexicon.py --check --as-of 2026-10-18
npm.cmd test -- src/content.test.ts src/core-lexicon.test.ts
```

`--download` is only needed for missing, known pinned raw input files. Subsequent `--check` runs are read-only, require no network and compare every generated artifact byte for byte. The input SHA-256 values and official URLs are pinned in the importer and repeated in the output manifest. The current source archive checksums are:

```text
WordNet-3.0.tar.gz  640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52
wn-data-cmn.tab     379fd2e41d3e1395f9f27cf23a39c6181849ffb4020c14a07ed2a4d4dd651122
ecdict.csv          1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf
CMUdict raw        81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22
wordfreq wheel     4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473
```

The data is source-traceable and structurally checked. It remains a fixed historical dictionary combination, with broad source translations and incomplete teaching context; it is not a professionally reviewed new bilingual dictionary or an official exam-frequency product.
