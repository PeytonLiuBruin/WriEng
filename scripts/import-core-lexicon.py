"""Build a real bilingual core from licensed raw lexical data; run no upstream code.

English definitions and optional original examples: Princeton WordNet 3.0.
Chinese synonyms/translation lemmas: Chinese Open Wordnet, same synset.
North American phonemes: pinned CMUdict. General usage: actual wordfreq API.
ECDICT contributes only its community exam-reference tags, never glosses/IPA.
"""
from __future__ import annotations

import argparse
import collections
import csv
import hashlib
from importlib import metadata
import json
from pathlib import Path
import re
import sys
import tarfile
import urllib.request
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".tools" / "lexicon-sources"
CONTENT = ROOT / "src" / "content"
PUBLIC = ROOT / "public"
VERSION = "wn30-cow-cmu-wordfreq-2026-10-18-v1"
AS_OF = "2026-10-18"
ECDICT_REV = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"
OMW_REV = "406bf83b3c507a3d1f26e88252d5d66893fd36bf"
CMU_REV = "74790861f652b15e4ac49015a90074ad62a27690"
INPUTS = {
    "WordNet-3.0.tar.gz": ("https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz", "640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52"),
    "wn-data-cmn.tab": (f"https://raw.githubusercontent.com/omwn/omw-data/{OMW_REV}/wns/cow/wn-data-cmn.tab", "379fd2e41d3e1395f9f27cf23a39c6181849ffb4020c14a07ed2a4d4dd651122"),
    "COW-LICENSE.txt": (f"https://raw.githubusercontent.com/omwn/omw-data/{OMW_REV}/wns/cow/LICENSE", "81a3cb1f97e120581d67c71424f2de5dd96325d951f991e8a092147a2a4b2321"),
    "COW-citation.bib": (f"https://raw.githubusercontent.com/omwn/omw-data/{OMW_REV}/wns/cow/citation.bib", "28b6cca6bf00efec90953a983e9a5b7d42fc9f45798fdf62a6b214a64fec010d"),
    "ecdict.csv": (f"https://raw.githubusercontent.com/skywind3000/ECDICT/{ECDICT_REV}/ecdict.csv", "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf"),
    "ECDICT-LICENSE.txt": (f"https://raw.githubusercontent.com/skywind3000/ECDICT/{ECDICT_REV}/LICENSE", "f8552dd246f61a4e064569eae6194a01c6b3d63b03bf27c6ca863593c549ed0f"),
}
CMU_PATH = ROOT / ".tools" / f"cmudict-{CMU_REV}.dict"
CMU_HASH = "81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22"
WHEEL = ROOT / ".tools" / "wordfreq-wheels" / "wordfreq-3.1.1-py3-none-any.whl"
WHEEL_HASH = "4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473"
POS = {"n": "noun", "v": "verb", "a": "adjective", "r": "adverb"}
POS_ORDER = {"n": 0, "v": 1, "a": 2, "r": 3}
EXAM_TAGS = {"ielts": "ielts", "toefl": "toefl", "cet6": "cet6", "gre": "gre"}
FUNCTION_HOMOGRAPHS = {
    "am", "are", "is", "was", "were", "been", "has", "had", "does", "did",
    "at", "as", "he", "she", "it", "we", "you", "they", "us", "me", "him",
    "her", "them", "our", "your", "their", "his", "hers", "my", "this", "that",
    "these", "those", "the", "an", "in", "can", "may", "will", "must", "might",
    "shall", "should", "would", "could", "ought",
}
LEXICAL_PLURALS = {"people", "news", "clothes", "goods", "means", "headquarters", "pants", "jeans",
                   "scissors", "thanks", "stairs", "surroundings", "earnings", "savings", "belongings",
                   "glasses", "physics", "mathematics", "series", "wages", "sports", "congratulations"}
QUALITY_EXCLUSIONS = {
    "years": "WordNet's independent lemma is old age, while common spelling frequency mostly includes plural year",
    "being": "WordNet independent noun homograph of a frequent grammatical form; retain be instead",
    "going": "WordNet independent noun homograph of a frequent grammatical form; retain go instead",
    "despite": "Selected noun contempt is not the common preposition measured by the spelling frequency",
    "granger": "Farmer sense does not justify prioritizing the potentially name-influenced spelling frequency",
    "august": "Adjective noble has no matching final-stress CMU variant; spelling frequency includes the month",
    "cinema": "Aligned Chinese source lemmas emphasize celluloid material rather than the selected medium sense",
    "pants": "WordNet 3.0 only offers women's underpants for this spelling, inappropriate as a US trousers default",
    "henry": "Inductance-unit homograph may be confused with a common personal name",
    "anna": "Coin-unit homograph may be confused with a common personal name",
    "bitch": "Unmarked vulgar/derogatory register requires a separate teaching treatment",
    "asshole": "Unmarked vulgar register requires a separate teaching treatment",
    "fuck": "Vulgar register requires a separate teaching treatment",
    "shit": "Vulgar register requires a separate teaching treatment",
    "cunt": "Vulgar register requires a separate teaching treatment",
    "nigger": "Racial slur requires a separate teaching treatment",
    "faggot": "Derogatory homograph requires a separate teaching treatment",
}
SENSE_OVERRIDES = {
    "mobile": ("01522376-a", "Prefer moving/capable of moving over migratory for a general-learning sense"),
    "articulate": ("00980453-v", "Prefer putting into words over anatomical joint connection"),
    "van": ("04520170-n", "Prefer enclosed cargo truck over avant-garde homograph"),
}
CHINESE_LEMMA_EXCLUSIONS = {
    "13774404-n": {"书库"},
    "00007846-n": {"灵魂"},
    "13320168-n": {"小费"},
}
ARPABET_BASES = set("AA AE AH AO AW AY B CH D DH EH ER EY F G HH IH IY JH K L M N NG OW OY P R S SH T TH UH UW V W Y Z ZH".split())
# Exact available CMU entries, chosen only for the explicitly named POS.
# Other variants are retained, not silently treated as POS-specific evidence.
CMU_POS_OVERRIDES = {
    ("abstract", "a"): "abstract(2)", ("attribute", "v"): "attribute(2)",
    ("contrast", "v"): "contrast(2)", ("survey", "n"): "survey(2)",
    ("refund", "n"): "refund(2)", ("detour", "n"): "detour(2)",
    ("impact", "n"): "impact(2)", ("refill", "v"): "refill(2)",
    ("live", "v"): "live(2)", ("read", "v"): "read(2)", ("lead", "v"): "lead(2)",
    ("wind", "n"): "wind(2)", ("wound", "n"): "wound(2)",
    ("perfect", "a"): "perfect(2)", ("present", "v"): "present(2)",
    ("subject", "n"): "subject(2)", ("separate", "a"): "separate(2)",
    ("transfer", "n"): "transfer(2)", ("conduct", "v"): "conduct(2)",
    ("graduate", "v"): "graduate(2)", ("desert", "v"): "desert(2)",
    ("rebel", "v"): "rebel(2)", ("addict", "n"): "addict(2)", ("convict", "v"): "convict(2)",
    ("learned", "a"): "learned(2)", ("aged", "a"): "aged(2)",
    ("abuse", "v"): "abuse(2)", ("recall", "v"): "recall(2)",
    ("associate", "v"): "associate(2)", ("console", "v"): "console(2)",
    ("extract", "v"): "extract(2)", ("exploit", "v"): "exploit(2)",
    ("coordinate", "v"): "coordinate(2)", ("duplicate", "v"): "duplicate(2)",
    ("sow", "v"): "sow(2)", ("concrete", "n"): "concrete(2)",
    ("use", "v"): "use(2)", ("close", "v"): "close(2)",
    ("excuse", "v"): "excuse(2)", ("object", "v"): "object(2)",
    ("project", "v"): "project(2)", ("progress", "v"): "progress(2)",
    ("record", "n"): "record(2)", ("increase", "n"): "increase(2)",
    ("decrease", "n"): "decrease(2)", ("recess", "n"): "recess(2)",
    ("address", "v"): "address(2)", ("invalid", "a"): "invalid(3)",
    ("minute", "a"): "minute(2)", ("appropriate", "v"): "appropriate(2)",
    ("moderate", "v"): "moderate(2)", ("deliberate", "v"): "deliberate(2)",
    ("intimate", "v"): "intimate(2)", ("articulate", "a"): "articulate(2)",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object, compact: bool = False) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":") if compact else None,
                       indent=None if compact else 2) + "\n").encode("utf-8")


def inputs(download: bool) -> dict[str, bytes]:
    result = {}
    for name, (url, expected) in INPUTS.items():
        path = CACHE / name
        if not path.exists():
            if not download:
                raise ValueError(f"Missing {path}; use --download for pinned raw data only")
            data = urllib.request.urlopen(url, timeout=60).read()
            if digest(data) != expected:
                raise ValueError(f"Download checksum mismatch for {name}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        data = path.read_bytes()
        if digest(data) != expected:
            raise ValueError(f"Input checksum mismatch for {name}")
        result[name] = data
    if not CMU_PATH.exists() or digest(CMU_PATH.read_bytes()) != CMU_HASH:
        raise ValueError("Pinned CMUdict is missing or has the wrong hash; run the existing frequency importer first")
    if not WHEEL.exists() or digest(WHEEL.read_bytes()) != WHEEL_HASH:
        raise ValueError("Official wordfreq 3.1.1 wheel is missing or has the wrong hash")
    return result


def existing_curated_terms() -> set[str]:
    terms = set()
    for file in CONTENT.glob("*.ts"):
        text = file.read_text(encoding="utf-8")
        if re.search(r"export\s+const\s+\w*Seeds\s*:\s*Seed\[\]", text):
            terms.update(re.findall(r"\bterm\s*:\s*['\"]([a-z][a-z-]*)['\"]", text))
    return terms


def parse_wordnet() -> tuple[dict, dict, set[str], bytes]:
    synsets = {}
    uses = {}
    inflected_forms = set()
    with tarfile.open(CACHE / "WordNet-3.0.tar.gz", "r:gz") as archive:
        license_bytes = archive.extractfile("WordNet-3.0/LICENSE").read()
        for row in archive.extractfile("WordNet-3.0/dict/index.sense").read().decode("utf-8").splitlines():
            key, offset, sense_number, count = row.split()
            lemma, sense = key.split("%", 1)
            pos = {"1": "n", "2": "v", "3": "a", "4": "r", "5": "a"}[sense[0]]
            uses[(lemma, f"{offset}-{pos}")] = (int(count), int(sense_number), key)
        for file_pos in ["noun", "verb", "adj", "adv"]:
            data_file = f"data.{file_pos}"
            text = archive.extractfile(f"WordNet-3.0/dict/{data_file}").read().decode("utf-8")
            for line in text.splitlines():
                if not line or not line[0].isdigit():
                    continue
                header, gloss = line.split("|", 1)
                fields = header.split()
                pos = "a" if fields[2] == "s" else fields[2]
                sid = f"{fields[0]}-{pos}"
                # WordNet encodes adjective position as a trailing (a)/(p)/(ip),
                # which is grammatical metadata, not part of the actual spelling.
                lemmas = [re.sub(r"\((?:a|p|ip)\)$", "", fields[4 + 2 * i]) for i in range(int(fields[3], 16))]
                gloss_parts = re.split(r';\s*"', gloss.strip(), maxsplit=1)
                definition = gloss_parts[0].strip()
                examples = re.findall(r'"([^"\n]+)"', '"' + gloss_parts[1]) if len(gloss_parts) > 1 else []
                synsets[sid] = {"pos": pos, "lexFile": int(fields[1]), "lemmas": lemmas,
                                "definition": definition, "examples": examples,
                                "file": data_file, "offset": fields[0]}
            for row in archive.extractfile(f"WordNet-3.0/dict/{file_pos}.exc").read().decode("utf-8").splitlines():
                values = row.split()
                if values and values[0] not in values[1:]:
                    inflected_forms.add(values[0])
    return synsets, uses, inflected_forms, license_bytes


def parse_chinese(data: bytes) -> dict[str, list[str]]:
    result = collections.defaultdict(list)
    for row in data.decode("utf-8").splitlines():
        if row.startswith("#"):
            continue
        fields = row.split("\t")
        if len(fields) >= 3 and fields[1] == "cmn:lemma" and re.search(r"[\u4e00-\u9fff]", fields[2]):
            # COW uses embedded + as morphological join notation, e.g. 新+的.
            # Remove only a join between Chinese characters; do not translate it.
            lemma = re.sub(r"(?<=[\u4e00-\u9fff])\s*\+\s*(?=[\u4e00-\u9fff])", "", fields[2].strip())
            if lemma in CHINESE_LEMMA_EXCLUSIONS.get(fields[0], set()):
                continue
            if lemma not in result[fields[0]]:
                result[fields[0]].append(lemma)
    return result


def cmu_lookup() -> dict[str, list[dict[str, str]]]:
    result = collections.defaultdict(list)
    for line in CMU_PATH.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith(";;;"):
            key, phones = line.split(" ", 1)
            phones = phones.split(" #", 1)[0].strip()
            term = re.sub(r"\(\d+\)$", "", key)
            tokens = phones.split()
            if any(token.endswith("1") for token in tokens) and all(re.sub(r"[012]$", "", token) in ARPABET_BASES for token in tokens):
                result[term].append({"key": key, "arpabet": phones})
    return result


def import_data(limit: int, as_of: str, download: bool) -> tuple[dict[Path, bytes], dict]:
    raw = inputs(download)
    if metadata.version("wordfreq") != "3.1.1":
        raise ValueError("Expected the existing pinned project-local wordfreq 3.1.1 environment")
    from wordfreq import available_languages, zipf_frequency
    import wordfreq
    with ZipFile(WHEEL) as wheel:
        english_data = wheel.read("wordfreq/data/large_en.msgpack.gz")
        if digest(Path(available_languages("best")["en"]).read_bytes()) != digest(english_data):
            raise ValueError("Installed wordfreq English data differs from verified official wheel")
        if digest(Path(wordfreq.__file__).read_bytes()) != digest(wheel.read("wordfreq/__init__.py")):
            raise ValueError("Installed wordfreq lookup code differs from verified official wheel")
    synsets, sense_uses, inflected, wn_license = parse_wordnet()
    chinese = parse_chinese(raw["wn-data-cmn.tab"])
    pronunciations = cmu_lookup()
    excluded_curated = existing_curated_terms()
    choices = collections.defaultdict(list)
    for sid, synset in synsets.items():
        for term in synset["lemmas"]:
            # Exclude proper-name spellings, multiword phrases and opaque symbols.
            if re.fullmatch(r"[a-z]{2,24}", term):
                uses, sense_number, sense_key = sense_uses.get((term, sid), (0, 999, ""))
                choices[term].append((uses, sense_number, sid, sense_key))
    counts = collections.Counter()
    counts["wordnetLowercaseHeadwords"] = len(choices)
    scored = []
    candidates = []
    for term, senses in choices.items():
        # Prefer WN's own sense-use evidence BEFORE checking Chinese availability;
        # never pick a rare translated sense merely to inflate coverage.
        ordered = sorted(senses, key=lambda item: (-item[0], item[1], POS_ORDER[synsets[item[2]]["pos"]], item[2]))
        if term in SENSE_OVERRIDES:
            selected_sid, _ = SENSE_OVERRIDES[term]
            forced = next((item for item in ordered if item[2] == selected_sid), None)
            if not forced:
                raise ValueError(f"Reviewed sense override is absent in WordNet: {term} / {selected_sid}")
            ordered = [forced] + [item for item in ordered if item != forced]
        uses, sense_number, sid, sense_key = ordered[0]
        synset = synsets[sid]
        reasons = []
        if term in excluded_curated:
            counts["excludedExistingCurated"] += 1
            continue
        if not synset["definition"]:
            reasons.append("missing-definition")
        if sid not in chinese:
            reasons.append("missing-aligned-chinese")
        if term not in pronunciations:
            reasons.append("missing-cmu-pronunciation")
        # Inflected high-frequency function forms can have a different rare noun
        # homograph in WordNet (e.g. 'are' as a unit of area). Keep them candidates.
        if term in FUNCTION_HOMOGRAPHS:
            reasons.append("function-word-homograph-review")
        if term in QUALITY_EXCLUSIONS:
            reasons.append("manual-quality-review")
        if len(term) == 2 and synset["pos"] == "n" and term not in {"ax", "ox", "ad"}:
            reasons.append("short-unit-or-abbreviation-review")
        if term in inflected and term not in LEXICAL_PLURALS and synset["pos"] in {"n", "v"}:
            reasons.append("ambiguous-inflected-form")
        if re.search(r"\b(offensive|derogatory|obscene|racial slur|vulgar|pejorative)\b", synset["definition"], re.I):
            reasons.append("sensitive-gloss-review")
        zipf = zipf_frequency(term, "en", wordlist="best")
        if zipf >= 5.7 and uses == 0:
            reasons.append("high-frequency-term-unattested-sense")
        if zipf <= 0:
            reasons.append("missing-general-frequency")
        if reasons:
            counts.update(reasons)
            candidates.append({"term": term, "sourceSenseId": sid, "missing": reasons})
            continue
        scored.append((zipf, term, sid, uses, sense_number, sense_key))
    scored.sort(key=lambda item: (-item[0], item[1]))
    counts["eligibleBeforeSelection"] = len(scored)
    selected = scored[:limit]
    if len(selected) < 5000:
        raise ValueError(f"Only {len(selected)} fully evidenced entries; do not count candidates as learned content")
    selected_terms = {item[1] for item in selected}
    tag_rows = {}
    with (CACHE / "ecdict.csv").open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        if not {"word", "phonetic", "definition", "translation", "tag", "bnc", "frq"} <= set(reader.fieldnames or []):
            raise ValueError("Unexpected ECDICT field layout")
        for row_number, row in enumerate(reader, start=2):
            term = row["word"]
            if term in selected_terms and term not in tag_rows:
                # Do not retain mixed-provenance glosses, IPA, proprietary ratings,
                # BNC/frq rankings, audio URLs, or executable-looking content.
                tag_rows[term] = (row_number, row["tag"].split())
    entries = []
    for zipf, term, sid, uses, sense_number, sense_key in selected:
        synset = synsets[sid]
        row_number, tags = tag_rows.get(term, (None, []))
        variants = pronunciations[term]
        selected_key = CMU_POS_OVERRIDES.get((term, synset["pos"]), variants[0]["key"])
        chosen = next((item for item in variants if item["key"] == selected_key), None)
        if not chosen:
            raise ValueError(f"Absent manual CMU selection: {term} / {selected_key}")
        routes = ["daily"] + [route for tag, route in EXAM_TAGS.items() if tag in tags]
        synonyms = [lemma.replace("_", " ") for lemma in synset["lemmas"] if lemma.lower() != term]
        translations = chinese[sid][:3]
        entries.append({
            "id": f"core-wn30-{term}-{synset['pos']}-{synset['offset']}",
            "term": term,
            "partOfSpeech": POS[synset["pos"]],
            "definitionEn": synset["definition"],
            "translationZh": "；".join(translations),
            "ipaDictionary": None,
            "arpabet": chosen["arpabet"],
            "pronunciationVariants": variants,
            "sourceSenseId": sid,
            "synonyms": list(dict.fromkeys(synonyms))[:8],
            "examples": synset["examples"][:2],
            "sourceTags": tags,
            "routes": routes,
            "frequencyZipf": zipf,
            "sourceRecords": {"wordnetOffset": synset["offset"], "wordnetDataFile": synset["file"],
                              "wordnetSenseKey": sense_key, "wordnetSenseNumber": sense_number,
                              "wordnetSenseUseCount": uses, "wordnetLexicalFile": synset["lexFile"],
                              "cowSynsetId": sid, "cmudictKey": chosen["key"], "ecdictRow": row_number},
        })
    sources = {
        "wordnet": {"name": "Princeton WordNet", "url": INPUTS["WordNet-3.0.tar.gz"][0], "version": "3.0", "license": "WordNet-3.0 license", "sha256": INPUTS["WordNet-3.0.tar.gz"][1], "notice": "/licenses/WordNet-3.0-LICENSE.txt"},
        "cow": {"name": "Chinese Open Wordnet, via Open Multilingual Wordnet", "url": INPUTS["wn-data-cmn.tab"][0], "version": OMW_REV, "license": "Chinese Open Wordnet database license", "sha256": INPUTS["wn-data-cmn.tab"][1], "notice": "/licenses/COW-LICENSE.txt"},
        "cmudict": {"name": "CMU Pronouncing Dictionary", "url": f"https://github.com/cmusphinx/cmudict/tree/{CMU_REV}", "version": CMU_REV, "license": "BSD-2-Clause (CMUdict retained notice)", "sha256": CMU_HASH, "notice": "/CMUdict-LICENSE.txt"},
        "wordfreq": {"name": "wordfreq general-English mixed-corpus frequency", "url": "https://pypi.org/project/wordfreq/3.1.1/", "version": "3.1.1", "license": "CC-BY-SA-4.0", "codeLicense": "Apache-2.0", "sha256": WHEEL_HASH, "englishDataSha256": digest(english_data), "notice": "/licenses/WriEng-frequency-NOTICE.txt"},
        "ecdictTags": {"name": "ECDICT community exam-reference tags only", "url": f"https://github.com/skywind3000/ECDICT/tree/{ECDICT_REV}", "version": ECDICT_REV, "license": "MIT (repository declaration; only tag facts extracted)", "sha256": INPUTS["ecdict.csv"][1], "notice": "/licenses/ECDICT-LICENSE.txt"},
    }
    # Make the standalone downloadable JSON self-contained for attribution and
    # the database-copy requirements; include each notice once, not per entry.
    sources["wordnet"].update({"author": "Princeton University", "licenseText": wn_license.decode("utf-8")})
    sources["cow"].update({"author": "Francis Bond and Shan Wang", "licenseText": raw["COW-LICENSE.txt"].decode("utf-8"), "citation": raw["COW-citation.bib"].decode("utf-8")})
    sources["cmudict"].update({"author": "Carnegie Mellon University and contributors", "licenseText": (CONTENT / "CMUdict-LICENSE.txt").read_text(encoding="utf-8")})
    sources["ecdictTags"].update({"author": "Linwei / skywind3000 and ECDICT contributors", "licenseText": raw["ECDICT-LICENSE.txt"].decode("utf-8")})
    sources["wordfreq"].update({"author": "Robyn Speer", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/", "upstreamNotice": (PUBLIC / "licenses" / "wordfreq-3.1.1-UPSTREAM-NOTICE.txt").read_text(encoding="utf-8")})
    metadata_out = {
        "schemaVersion": 1, "version": VERSION, "count": len(entries), "importedOn": as_of,
        "scope": "General-English bilingual dictionary core; not a US-spoken or exam-frequency corpus",
        "license": "CC-BY-SA-4.0 compilation/frequency derivative; upstream WordNet, COW, CMUdict and MIT tag notices retained per field",
        "compilationLicenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "adaptation": "WriEng selected one evidenced WordNet sense per headword, joined source Chinese lemmas by exact synset, normalized only source grammatical markers, selected and retained real CMU phonemes, added unmodified wordfreq numeric estimates and inherited ECDICT tag facts, and arranged the compilation as JSON. All field-specific upstream notices remain attached. No invented examples, translations, collocations, expert reviews or exam-frequency statistics.",
        "sources": sources,
        "fieldSources": {"id": ["wordnet"], "term": ["wordnet"], "partOfSpeech": ["wordnet"],
                         "definitionEn": ["wordnet"], "translationZh": ["cow"], "sourceSenseId": ["wordnet", "cow"],
                         "synonyms": ["wordnet"], "examples": ["wordnet"], "arpabet": ["cmudict"],
                         "pronunciationVariants": ["cmudict"], "sourceTags": ["ecdictTags"],
                         "frequencyZipf": ["wordfreq"], "routes": ["ecdictTags", "wordfreq"]},
        "translationKind": "Up to three source Chinese lemmas aligned to the same WordNet synset; embedded morphological + joins removed. Explicitly reviewed inaccurate source lemmas omitted, never replaced by invented translations. Not newly authored full Chinese definitions.",
        "frequencyScope": "General English spelling/headword-level mixed-corpus estimate, aggregated across senses and POS; never a count or rank of the selected WordNet meaning",
        "selection": {"requestedLimit": limit, "uniqueHeadwords": len(entries), "excludedCuratedTerms": len(excluded_curated),
                      "minimumZipf": min(entry["frequencyZipf"] for entry in entries),
                      "maximumZipf": max(entry["frequencyZipf"] for entry in entries),
                      "policy": "Lowercase single words 2-24 letters. Choose the highest WordNet sense-use count, then sense number and POS deterministically, before requiring same-synset Chinese, real CMU phonemes and nonzero wordfreq. Exclude reviewed function-word homographs, ambiguous inflected noun/verb forms except lexical plurals, and marked sensitive glosses. Sort eligible headwords by actual general term-level Zipf descending; do not pad with candidates.",
                      "functionHomographExclusions": sorted(FUNCTION_HOMOGRAPHS)},
        "editorialChecks": {"senseOverrides": {term: {"sourceSenseId": value[0], "reason": value[1]} for term, value in SENSE_OVERRIDES.items()},
                            "qualityExclusions": QUALITY_EXCLUSIONS,
                            "chineseLemmaExclusions": {sid: sorted(values) for sid, values in CHINESE_LEMMA_EXCLUSIONS.items()},
                            "cmudictPosOverrides": {f"{term}:{pos}": key for (term, pos), key in CMU_POS_OVERRIDES.items()},
                            "review": "Automated import plus independent AI-assisted spot checks; not a claim of full professional review"},
        "routePolicy": {"daily": "Editorial general-frequency core for everyday learning; not a measured US-conversation list",
                        "exams": "Only exact inherited ECDICT ielts/toefl/cet6/gre tags, as community learning references. Not verified current official syllabuses, exam counts, ranks or guarantees.",
                        "examFrequency": None},
        "pronunciationPolicy": "Exact CMU North American ARPABET phoneme portions, inline comments excluded; only legal 39-phoneme sequences with primary-stress evidence included. Valid source variants retained. Explicit reviewed POS/sense selections correct known heteronyms; remaining first variants are not certified sense-specific. No dictionary IPA imported, no generated audio or pronunciation score, professional review pending.",
        "examplePolicy": "Only quoted examples actually present in the selected WordNet synset, if any. No invented translation, context card, mnemonic or collocation. Synonyms remain distinct from collocations.",
        "review": "source-data import and structural validation; independent professional linguistic review pending",
    }
    core = {"metadata": metadata_out, "entries": entries}
    core_bytes = json_bytes(core, compact=True)
    route_counts = {route: sum(route in entry["routes"] for entry in entries) for route in ["daily", "ielts", "toefl", "cet6", "gre"]}
    summary = {
        "schemaVersion": 1, "version": VERSION, "count": len(entries), "uniqueHeadwords": len({entry["term"] for entry in entries}),
        "learnableCount": len(entries), "candidateCount": len(candidates), "candidateReasonCounts": dict(sorted(counts.items())),
        "eligibleNotSelectedCount": len(scored) - len(entries), "sourceChineseSynsets": len(chinese),
        "routeCounts": route_counts, "withEnglishDefinition": len(entries), "withAlignedChinese": len(entries),
        "withCmuPronunciation": len(entries), "withActualGeneralFrequency": len(entries),
        "withSourceExamples": sum(bool(entry["examples"]) for entry in entries),
        "withoutSourceExamples": sum(not entry["examples"] for entry in entries),
        "withExamReferenceTags": sum(any(tag in EXAM_TAGS for tag in entry["sourceTags"]) for entry in entries),
        "coreSha256": digest(core_bytes), "coreBytes": len(core_bytes),
        "inputHashes": {name: expected for name, (_, expected) in INPUTS.items()},
        "wordfreqVersion": "3.1.1", "wordfreqWheelSha256": WHEEL_HASH, "cmudictSha256": CMU_HASH,
        "candidateExamples": candidates[:30], "sources": sources,
    }
    outputs = {
        CONTENT / "core-lexicon.json": core_bytes,
        PUBLIC / "data" / "core-lexicon.json": core_bytes,
        CONTENT / "core-lexicon-manifest.json": json_bytes(summary),
        PUBLIC / "data" / "core-lexicon-manifest.json": json_bytes(summary),
        PUBLIC / "licenses" / "WordNet-3.0-LICENSE.txt": wn_license,
        PUBLIC / "licenses" / "COW-LICENSE.txt": raw["COW-LICENSE.txt"],
        PUBLIC / "licenses" / "COW-citation.bib": raw["COW-citation.bib"],
        PUBLIC / "licenses" / "ECDICT-LICENSE.txt": raw["ECDICT-LICENSE.txt"],
    }
    return outputs, summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=6000)
    parser.add_argument("--as-of", default=AS_OF)
    parser.add_argument("--download", action="store_true", help="Allow downloading pinned raw data files only")
    parser.add_argument("--check", action="store_true", help="Read-only regeneration and exact-byte comparison")
    args = parser.parse_args()
    outputs, summary = import_data(args.limit, args.as_of, args.download)
    stale = []
    for path, data in outputs.items():
        if args.check:
            if not path.exists() or path.read_bytes() != data:
                stale.append(path.relative_to(ROOT).as_posix())
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    if stale:
        raise ValueError("Generated core data is stale: " + ", ".join(stale))
    print(json.dumps({"mode": "check" if args.check else "write", "learnable": summary["learnableCount"],
                      "candidate": summary["candidateCount"], "routeCounts": summary["routeCounts"],
                      "withExamples": summary["withSourceExamples"], "coreBytes": summary["coreBytes"],
                      "coreSha256": summary["coreSha256"]}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
