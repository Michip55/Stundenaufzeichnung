"""Sprechertext -> WAV-Dateien (Piper, Stimme de_DE-thorsten-high, läuft lokal).

Aufruf:  python3 video/lib/tts.py <stimme.onnx> <ausgabe-ordner>
Schreibt je Abschnitt aus video/sprechertext.json eine WAV-Datei und eine dauer.json (Sekunden je Abschnitt).
"""
import json
import sys
import wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

HERE = Path(__file__).resolve().parent.parent
model, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

voice = PiperVoice.load(str(model))
cfg = SynthesisConfig(length_scale=0.97, noise_scale=0.6, noise_w_scale=0.8, normalize_audio=True, volume=1.0)

segments = json.loads((HERE / "sprechertext.json").read_text(encoding="utf-8"))["segments"]
durations = {}
for seg in segments:
    path = out / f"{seg['id']}.wav"
    with wave.open(str(path), "wb") as wf:
        voice.synthesize_wav(seg["text"], wf, syn_config=cfg)
    with wave.open(str(path), "rb") as rf:
        durations[seg["id"]] = round(rf.getnframes() / rf.getframerate(), 2)
    print(f"{seg['id']:16s} {durations[seg['id']]:6.2f} s")

(out / "dauer.json").write_text(json.dumps(durations, indent=1), encoding="utf-8")
print("gesamt", round(sum(durations.values()), 1), "s")
