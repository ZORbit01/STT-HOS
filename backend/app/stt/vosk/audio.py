import numpy as np


def float32_from_bytes(audio_bytes: bytes) -> np.ndarray:
    return np.frombuffer(audio_bytes, dtype=np.float32).copy()


def clip_float_audio(audio: np.ndarray) -> np.ndarray:
    return np.clip(audio, -1.0, 1.0)


def rms(audio: np.ndarray) -> float:
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(audio**2)))


def to_pcm16(audio: np.ndarray) -> bytes:
    return (audio * 32767).astype(np.int16).tobytes()
