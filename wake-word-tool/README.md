# wake-word-tool

Command-line tool that adds and validates a wake word for the desktop app's keyword spotter.

There is no training. The spotter (`sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`) does open-vocabulary
keyword spotting, so a wake word is only a token sequence (ARPAbet phones for English, pinyin units for
Mandarin) plus an optional `boost` and `threshold`. The tool derives the tokens, synthesizes positive and
negative speech, sweeps boost/threshold with the same spotter settings the app uses
(`createKeywordSpotter` in `desktop/src/wake-word/sherpa-detector.mjs`), and writes the winner into the
registry `desktop/src/wake-word/wake-words.mjs`.

## Prerequisites

- Node >= 22 and the repo's installed dependencies (`sherpa-onnx`, `tar-stream`, `unbzip2-stream`; system `tar` is the fallback extractor).
- Network on first use: the model archive is downloaded, verified against the pinned sha256 and extracted to the cache directory (`${XDG_CACHE_HOME:-~/.cache}/qwen-audio-agent/wake-word-tool`, override with `--cache-dir`). Unlike the desktop install it keeps `en.phone`, the English lexicon.
- Speech synthesis, one of:
  - A Python environment with `faster_qwen3_tts` (and `soundfile`, `numpy`): pass `--python /path/to/venv/bin/python` or set `WAKE_WORD_TOOL_PYTHON`. Qwen3-TTS CustomVoice runs on CPU (`CUDA_VISIBLE_DEVICES=''`) unless `--gpu`; set `HF_HUB_CACHE` to reuse an existing Hugging Face cache. The model loads once per `synth` run (`lib/qwen3_say.py`).
  - `espeak-ng` as a fallback. The model does not detect espeak clips, so recall numbers are unrepresentative; use it only to check the plumbing.

## Usage

Run through the root script, `npm run wake-word -- <command> ...`, or `node wake-word-tool/wake-word-tool.mjs <command> ...`. Every command has `--help`.

| Command | Purpose |
|---|---|
| `tokens` | Print the keyword line(s) for a phrase |
| `synth` | Generate positive and negative clips and `manifest.json` |
| `evaluate` | Sweep boost/threshold over a clip directory and pick the best cell |
| `register` | Write one entry into the registry |
| `run` | `tokens` -> `synth` -> `evaluate` (-> `register`) |

```sh
# English: words come from en.phone
npm run wake-word -- tokens --phrase "Hey Jarvis"
# HH EY1 JH AA1 R V AH0 S

# Mandarin: numbered pinyin (v or ü for ü; tone 5 or none is neutral)
npm run wake-word -- tokens --phrase 你好千问 --pinyin "ni3 hao3 qian1 wen4"
# n ǐ h ǎo q iān w èn
```

Out-of-vocabulary words are listed with a hint to pass the pronunciation by hand. `--tokens "PH1 PH2 ..."`
replaces the derived pronunciation and may be repeated for variants (all variants share the id when
evaluating). Every token must exist in the model's `tokens.txt`.

```sh
npm run wake-word -- synth --phrase "Hey Jarvis" --out /tmp/jarvis-clips \
  --python ~/.venvs/qwen3-tts/bin/python --speakers Aiden,Ryan --takes 2 --negative "Hey Harvey"
```

Positives are the phrase alone and in carrier sentences, per speaker and take. Negatives are your
`--negative` phrases, a default near-miss/general list for the language, and the phrases of the other
registered wake words. English speakers: Aiden, Ryan. Chinese: Vivian, Serena, Uncle_Fu, Dylan, Eric.

```sh
npm run wake-word -- evaluate --id jarvis --phrase "Hey Jarvis" --clips /tmp/jarvis-clips \
  --boosts 1,1.5,2,2.5,3 --thresholds 0.25,0.2,0.15,0.1
```

A clip counts as a false trigger when the keyword fires anywhere in a negative clip. The chosen cell has
the highest recall with zero false triggers; ties go to the highest threshold, then the lowest boost.
The command exits non-zero when no cell is free of false triggers (unless `--allow-false-triggers`).
The spotter library prints resampler notices to stdout while evaluating; the summary comes last.

## Outputs

`evaluate` and `run` write `report.json` and `report.md` (grid table, chosen cell, per-clip hits) to the
run directory: `--out`, else `<cache-dir>/runs/<id>-<timestamp>`. `run` keeps its clips in `clips/` there.

## Registering

```sh
npm run wake-word -- register --from-report <run-dir>/report.json
npm run wake-word -- register --id jarvis --phrase "Hey Jarvis" --tokens "HH EY1 JH AA1 R V AH0 S" --boost 3 --threshold 0.2
npm run wake-word -- run --id jarvis --phrase "Hey Jarvis" --python ... --register
```

`register` adds or updates the entry with that id and rewrites only the JSON between the
`wake-word-tool:begin` / `wake-word-tool:end` markers; boost/threshold equal to the spotter defaults
(1 and 0.25) are omitted. The registry holds one tokens sequence per word, so register a single variant.
`run --register` writes only when the chosen cell detects at least one positive. Ids are lowercase
letters, digits, `-` and `_`; the phrase is required (it is the Settings dropdown label); boost must be
above 0 and threshold between 0 and 1. Restart the desktop app afterwards: the main process loads the
registry at startup, so the dropdown and the detector only see the new entry after a restart.

## Example: Hey Jarvis

The registry's `jarvis` entry comes from this run (Qwen3-TTS on CPU, about 5 minutes):

```sh
WAKE_WORD_TOOL_PYTHON=/path/to/venv/bin/python \
  npm run wake-word -- run --id jarvis --phrase "Hey Jarvis" \
  --speakers Aiden,Ryan,Vivian,Serena --takes 2 --register
```

- Tokens `HH EY1 JH AA1 R V AH0 S` (the `en.phone` pronunciation).
- Clips: 24 positives ("Hey Jarvis" alone and in two carrier sentences, 4 voices, 2 takes) and 88 negatives
  (10 default near-miss/general phrases plus 你好千问, 4 voices, 2 takes).
- Chosen cell: boost 3, threshold 0.2. Recall 21/24 (Aiden 6/6, Vivian 6/6, Serena 5/6, Ryan 4/6; the misses
  are all the bare phrase, every carrier sentence was detected) with 0/88 false triggers. The only other
  cells without false triggers had lower recall (19/24 at boost 1, 18/24 at boost 3 / threshold 0.25).

## Layout

- `wake-word-tool.mjs`: CLI entry.
- `lib/pinyin.mjs`, `lib/lexicon.mjs`, `lib/keywords.mjs`: tokenization and keyword lines.
- `lib/model.mjs`: model download, verification, extraction.
- `lib/synth.mjs`, `lib/qwen3_say.py`: clip planning and synthesis.
- `lib/evaluate.mjs`, `lib/wav.mjs`: grid evaluation, selection, reports.
- `lib/registry.mjs`: registry rewrite.
- Tests: `test/wake-word-tool.test.mjs` (no model or network needed).
