"""Import actual wordfreq outputs and pinned CMUdict phonemes for literal Seed data.

This script is WriEng code. It calls an installed, pinned official PyPI package;
it does not execute seed modules, downloaded GitHub scripts, or package build hooks.
Derived frequency-table.json is CC-BY-SA-4.0, separate from original seed texts.
"""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
from importlib import metadata
import json
import math
from pathlib import Path
import re
import sys
import urllib.request
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
VERSION = "3.1.1"
WHEEL_NAME = f"wordfreq-{VERSION}-py3-none-any.whl"
WHEEL_SHA256 = "4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473"
CMU_COMMIT = "74790861f652b15e4ac49015a90074ad62a27690"
CMU_SHA256 = "81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22"
CMU_URL = f"https://raw.githubusercontent.com/cmusphinx/cmudict/{CMU_COMMIT}/cmudict.dict"
CONTENT_DIR = ROOT / "src" / "content"
LICENSE_DIR = ROOT / "public" / "licenses"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encode_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def discover_seeds() -> tuple[list[str], dict[str, str], dict[str, int]]:
    """Read literal term/stress fields, with no execution of TypeScript code.

    Seed modules must export a literal array ending in Seeds. Dynamic expressions
    are deliberately outside this importer's scope and are rejected by parity tests.
    """
    sources: dict[str, str] = {}
    stresses: dict[str, int] = {}
    for file in sorted(CONTENT_DIR.glob("*.ts")):
        text = file.read_text(encoding="utf-8-sig")
        if not re.search(r"export\s+const\s+\w*Seeds\s*:\s*Seed\[\]", text):
            continue
        records = list(re.finditer(r"\bterm\s*:\s*(['\"])([a-z][a-z-]*)\1", text))
        if not records:
            raise ValueError(f"No literal Seed terms in {file.name}")
        for index, match in enumerate(records):
            term = match.group(2)
            if term in sources:
                raise ValueError(f"Repeated headword {term}; use sense-aware importer before adding homographs")
            record_end = records[index + 1].start() if index + 1 < len(records) else len(text)
            record_text = text[match.start():record_end]
            stress = re.search(r"stressedSyllable\s*:\s*(\d+)", record_text)
            if not stress:
                raise ValueError(f"Missing literal stressedSyllable for {term}")
            sources[term] = file.relative_to(ROOT).as_posix()
            stresses[term] = int(stress.group(1))
    if not sources:
        raise ValueError("No Seed modules found")
    return sorted(sources), sources, stresses


def build_outputs(wheel_path: Path, cmu_path: Path, as_of: str) -> tuple[dict[Path, bytes], dict[str, object]]:
    if metadata.version("wordfreq") != VERSION:
        raise ValueError(f"Expected wordfreq {VERSION}; recreate .venv using the hashed requirements")
    if sha(wheel_path.read_bytes()) != WHEEL_SHA256:
        raise ValueError(f"Wheel hash mismatch: {wheel_path}")
    cmu_bytes = cmu_path.read_bytes()
    if sha(cmu_bytes) != CMU_SHA256:
        raise ValueError(f"CMUdict hash mismatch: {cmu_path}")
    terms, seed_sources, stresses = discover_seeds()
    from wordfreq import available_languages, zipf_frequency
    import wordfreq

    installed_data = Path(available_languages("best")["en"])
    outputs: dict[Path, bytes] = {}
    with ZipFile(wheel_path) as archive:
        data_name = "wordfreq/data/large_en.msgpack.gz"
        data_bytes = archive.read(data_name)
        if sha(installed_data.read_bytes()) != sha(data_bytes):
            raise ValueError("Installed English data does not match the verified official wheel")
        installed_code = Path(wordfreq.__file__).read_bytes()
        if sha(installed_code) != sha(archive.read("wordfreq/__init__.py")):
            raise ValueError("Installed wordfreq lookup implementation differs from the verified wheel")
        wheel_metadata = archive.read(f"wordfreq-{VERSION}.dist-info/METADATA").decode("utf-8")
        upstream_notice = wheel_metadata[wheel_metadata.index("## License"):].strip() + "\n"
        outputs[LICENSE_DIR / f"wordfreq-{VERSION}-UPSTREAM-NOTICE.txt"] = upstream_notice.encode("utf-8")
        outputs[LICENSE_DIR / f"wordfreq-{VERSION}-CODE-LICENSE.txt"] = archive.read(f"wordfreq-{VERSION}.dist-info/LICENSE.txt")

    raw_values = {term: zipf_frequency(term, "en", wordlist="best") for term in terms}
    if any(not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 9 for value in raw_values.values()):
        raise ValueError("Unexpected Zipf output outside supported finite range")
    frequency_metadata = {
        "schemaVersion": 1,
        "source": "wordfreq",
        "author": "Robyn Speer; underlying corpus authors credited in UPSTREAM-NOTICE",
        "sourceVersion": VERSION,
        "sourceReleaseDate": "2023-11-21",
        "sourceUrl": f"https://pypi.org/project/wordfreq/{VERSION}/",
        "wheelFilename": WHEEL_NAME,
        "wheelSha256": WHEEL_SHA256,
        "englishDataFilename": data_name,
        "englishDataSha256": sha(data_bytes),
        "upstreamMetadataSha256": sha(wheel_metadata.encode("utf-8")),
        "language": "en",
        "wordlist": "best",
        "effectiveWordlist": "large",
        "scope": "general-english-mixed-corpus",
        "unit": "log10 occurrences per billion words (Zipf scale)",
        "method": "wordfreq.zipf_frequency(term, 'en', wordlist='best')",
        "rawUnknownSentinel": 0,
        "importedOn": as_of,
        "dataLicense": "CC-BY-SA-4.0",
        "codeLicense": "Apache-2.0",
        "adaptation": "Extract only current WriEng headwords. Raw numeric API outputs unchanged; zero is exposed as unknown in the application. No sense, exam or US-spoken frequencies inferred.",
        "termCount": len(terms),
    }
    table = {"metadata": frequency_metadata, "terms": raw_values}
    table_bytes = encode_json(table)
    outputs[CONTENT_DIR / "frequency-table.json"] = table_bytes
    outputs[ROOT / "public" / "data" / "frequency-table.json"] = table_bytes

    cmu_all: dict[str, str] = {}
    for line in cmu_bytes.decode("utf-8").splitlines():
        if line and not line.startswith(";;;"):
            name, phones = line.split(" ", 1)
            cmu_all[name] = phones
    selections = json.loads((CONTENT_DIR / "frequency-cmu-selection.json").read_text(encoding="utf-8"))
    stress_exceptions = json.loads((CONTENT_DIR / "frequency-cmu-stress-exceptions.json").read_text(encoding="utf-8"))
    pronunciation_table: dict[str, str | None] = {}
    missing: list[str] = []
    stress_mismatches: list[str] = []
    selected_entries: dict[str, str | None] = {}
    for term in terms:
        selected = selections.get(term, term)
        if selected is None:
            # Explicit editorial availability record, not fabricated source data.
            if any(key == term or key.startswith(term + "(") for key in cmu_all):
                raise ValueError(f"{term} is marked unavailable but has a CMUdict entry; review the selection")
            pronunciation_table[term] = None
            selected_entries[term] = None
            continue
        if selected not in cmu_all:
            missing.append(term)
            continue
        phones = cmu_all[selected]
        selected_entries[term] = selected
        pronunciation_table[term] = phones
        vowel_phones = [phone for phone in phones.split() if re.search(r"[012]$", phone)]
        primary_indices = [i for i, phone in enumerate(vowel_phones) if phone.endswith("1")]
        if stresses[term] not in primary_indices:
            exception = stress_exceptions.get(term)
            if exception and exception["teachingStressIndex"] == stresses[term] and vowel_phones[stresses[term]].endswith("2"):
                continue
            alternatives = {key: value for key, value in cmu_all.items() if key == term or key.startswith(term + "(")}
            stress_mismatches.append(f"{term}: seed={stresses[term]}, selected={phones}, alternatives={alternatives}")
    if missing or stress_mismatches:
        raise ValueError("Pronunciation selection needs editorial review:\n" + "\n".join([f"Missing CMUdict: {term}" for term in missing] + stress_mismatches))
    outputs[CONTENT_DIR / "cmudict-subset.json"] = encode_json(pronunciation_table)
    manifest = {
        "importerVersion": "wrieng-frequency-v1",
        "pythonVersion": f"{sys.version_info.major}.{sys.version_info.minor}",
        "frequencyTableSha256": sha(table_bytes),
        "cmudictRevision": CMU_COMMIT,
        "cmudictSourceSha256": CMU_SHA256,
        "cmudictSubsetSha256": sha(outputs[CONTENT_DIR / "cmudict-subset.json"]),
        "cmudictSelections": selected_entries,
        "documentedTeachingStressVariants": stress_exceptions,
        "seedSources": seed_sources,
        "terms": terms,
        "installedDependencies": {name: metadata.version(name) for name in ["wordfreq", "ftfy", "langcodes", "locate", "msgpack", "regex", "wcwidth"]},
    }
    outputs[CONTENT_DIR / "frequency-import-manifest.json"] = encode_json(manifest)
    return outputs, {"terms": len(terms), "withFrequency": sum(value > 0 for value in raw_values.values()), "unknown": [term for term, value in raw_values.items() if value == 0], "cmuEntries": sum(value is not None for value in pronunciation_table.values()), "cmuUnavailable": [term for term, value in pronunciation_table.items() if value is None], "tableSha256": sha(table_bytes)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel", type=Path, default=ROOT / ".tools" / "wordfreq-wheels" / WHEEL_NAME)
    parser.add_argument("--cmudict", type=Path, default=ROOT / ".tools" / f"cmudict-{CMU_COMMIT}.dict")
    parser.add_argument("--download-cmudict", action="store_true", help="Download only pinned raw CMUdict text and verify its SHA256")
    parser.add_argument("--as-of", default=date.today().isoformat(), help="Metadata date; preserve it when reproducing an existing file")
    parser.add_argument("--check", action="store_true", help="Verify outputs without modifying any file")
    args = parser.parse_args()
    date.fromisoformat(args.as_of)
    if not args.cmudict.exists():
        if not args.download_cmudict:
            raise ValueError(f"Missing pinned CMUdict at {args.cmudict}; pass --download-cmudict or --cmudict PATH")
        data = urllib.request.urlopen(CMU_URL, timeout=45).read()
        if sha(data) != CMU_SHA256:
            raise ValueError("Downloaded CMUdict hash mismatch")
        args.cmudict.parent.mkdir(parents=True, exist_ok=True)
        args.cmudict.write_bytes(data)
    outputs, report = build_outputs(args.wheel, args.cmudict, args.as_of)
    stale = []
    for path, data in outputs.items():
        if args.check:
            if not path.exists() or path.read_bytes() != data:
                stale.append(path.relative_to(ROOT).as_posix())
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    if stale:
        raise ValueError("Generated content is stale: " + ", ".join(stale))
    print(json.dumps({"mode": "check" if args.check else "write", **report}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
