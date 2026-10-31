"""Synthesizes a JSON job list with Qwen3-TTS CustomVoice; the model loads once.

usage: python qwen3_say.py JOBS.json
JOBS.json: [{"text": ..., "speaker": ..., "language": "english"|"chinese", "out": "clip.wav"}, ...]
Honours HF_HUB_CACHE and CUDA_VISIBLE_DEVICES from the environment.
"""

import json
import sys

import numpy as np
import soundfile as sf
from faster_qwen3_tts import FasterQwen3TTS

with open(sys.argv[1], encoding="utf-8") as handle:
    jobs = json.load(handle)

model = FasterQwen3TTS.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", device="cuda", backend="ggml", quant="BF16"
)
for job in jobs:
    result = model.generate_custom_voice(
        text=job["text"], speaker=job["speaker"], language=job["language"]
    )
    audio, rate = result if isinstance(result, tuple) else (result, 24000)
    if isinstance(audio, list):
        audio = np.concatenate([np.asarray(part, dtype=np.float32).reshape(-1) for part in audio])
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    sf.write(job["out"], audio, int(rate), subtype="PCM_16")
    print(f"{job['out']}: {len(audio) / rate:.2f} s @ {rate} Hz", flush=True)
