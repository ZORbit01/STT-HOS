import numpy as np

from app.stt.pipeline_types import (
    COMMAND_ABS_OFF,
    COMMAND_ABS_ON,
    COMMAND_OFF_FACTOR,
    COMMAND_ON_FACTOR,
    VAD_FRAME_MS,
)


def compute_rms(frame: np.ndarray) -> float:
    return float(np.sqrt(np.mean(frame * frame)))


def is_voiced(rms: float, noise_floor: float, currently_recording: bool) -> bool:
    threshold = (
        max(COMMAND_ABS_OFF, noise_floor * COMMAND_OFF_FACTOR)
        if currently_recording
        else max(COMMAND_ABS_ON, noise_floor * COMMAND_ON_FACTOR)
    )
    return rms >= threshold


def update_noise_floor(current_floor: float, rms: float) -> float:
    """Exponential moving average that slowly tracks ambient noise."""
    return current_floor * 0.94 + min(rms, 0.03) * 0.06


def split_into_frames(audio: np.ndarray, sample_rate: int) -> list[np.ndarray]:
    frame_samples = max(1, int(sample_rate * VAD_FRAME_MS / 1000))
    frames = []
    for start in range(0, len(audio), frame_samples):
        frame = audio[start : start + frame_samples]
        if len(frame) == frame_samples:
            frames.append(frame)
    return frames
