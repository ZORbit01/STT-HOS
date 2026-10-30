"""
Vosk STT engine behind the STTEngine Protocol.

Uses Vosk's SetGrammar API to constrain recognition to exactly the vocabulary
we care about. The WFST decoder cannot output words outside the grammar, so
hallucinations are structurally impossible.

Latency: ~118ms per utterance on a typical local CPU.
"""

import json
import logging
import os

from app.stt.engine import AudioPacket, TranscriptResult
from app.stt.vosk.audio import clip_float_audio, float32_from_bytes, to_pcm16
from app.stt.vosk.audio import rms as audio_rms
from app.stt.vosk.grammar import build_grammar

logger = logging.getLogger(__name__)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "vosk-model-small-en-us-0.15")


class VoskSTTEngine:
    """
    Implements STTEngine Protocol using Vosk with grammar-constrained decoding.

    The grammar is rebuilt whenever refresh_grammar() is called (new cases added).
    Each transcription gets a fresh KaldiRecognizer so the grammar is always current.
    """

    def __init__(self, case_codes: list[str]) -> None:
        from vosk import Model, SetLogLevel

        SetLogLevel(-1)  # suppress Vosk's verbose kaldi logs

        model_path = os.path.abspath(MODEL_PATH)
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Vosk model not found at {model_path}. "
                'Run: python -c "import urllib.request, zipfile; '
                "urllib.request.urlretrieve('https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip', 'vosk-model.zip'); "
                "zipfile.ZipFile('vosk-model.zip').extractall('.');\""
            )

        logger.info("Loading Vosk model from %s", model_path)
        self._model = Model(model_path)
        self._grammar = build_grammar(case_codes)
        logger.info("Vosk engine ready — grammar has %d phrases", len(json.loads(self._grammar)) - 1)

    def refresh_grammar(self, case_codes: list[str]) -> None:
        """Call when new cases are added during the day."""
        self._grammar = build_grammar(case_codes)
        logger.info("Vosk grammar refreshed — %d phrases", len(json.loads(self._grammar)) - 1)

    # Keep the prompt-style method name so callers don't change
    def refresh_prompt(self, case_codes: list[str]) -> None:
        self.refresh_grammar(case_codes)

    async def transcribe(self, packet: AudioPacket, focused_grammar: str | None = None) -> TranscriptResult:
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._transcribe_sync, packet, focused_grammar)

    def _transcribe_sync(self, packet: AudioPacket, focused_grammar: str | None = None) -> TranscriptResult:
        from vosk import KaldiRecognizer

        audio = clip_float_audio(float32_from_bytes(packet.audio_bytes))

        # Silence gate — drop near-silent audio before hitting Vosk
        rms = audio_rms(audio)
        if rms < 0.005:
            logger.info("[VOSK] Silence gate — rms=%.4f, skipping", rms)
            return TranscriptResult(text="", confidence=0.0, language="en")

        pcm_bytes = to_pcm16(audio)
        print("Using grammar:", focused_grammar if focused_grammar is not None else self._grammar)

        # Use focused grammar when provided, else fall back to full grammar
        grammar = focused_grammar if focused_grammar is not None else self._grammar
        rec = KaldiRecognizer(self._model, packet.sample_rate, grammar)
        rec.SetWords(True)

        # Feed in chunks so Vosk can process it properly
        chunk_size = 4000
        for i in range(0, len(pcm_bytes), chunk_size):
            rec.AcceptWaveform(pcm_bytes[i : i + chunk_size])

        result = json.loads(rec.FinalResult())
        text = result.get("text", "").strip()

        # Vosk returns "[unk]" or empty for out-of-grammar speech
        if not text or text == "[unk]":
            logger.info("[VOSK] No match in grammar — rms=%.4f", rms)
            return TranscriptResult(text="", confidence=0.0, language="en")

        # Confidence from word-level results if available
        words = result.get("result", [])
        avg_conf = sum(w.get("conf", 1.0) for w in words) / len(words) if words else 0.9

        logger.info("[VOSK] text=%r confidence=%.3f rms=%.4f", text, avg_conf, rms)
        return TranscriptResult(text=text, confidence=avg_conf, language="en")

    def shutdown(self) -> None:
        pass  # Vosk has no explicit shutdown
