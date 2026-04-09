#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import sys
import wave
from pathlib import Path
from typing import Any

try:
    import librosa
except ImportError:
    librosa = None

try:
    import numpy as np
except ImportError:
    np = None


SUPPORTED_METERS: dict[str, dict[str, Any]] = {
    "3/4": {"beats_per_bar": 3, "accent_pattern": [1.35, 1.0, 1.0]},
    "4/4": {"beats_per_bar": 4, "accent_pattern": [1.35, 1.0, 1.0, 1.0]},
    "6/8": {"beats_per_bar": 6, "accent_pattern": [1.35, 1.0, 1.0, 1.15, 1.0, 1.0]},
}
DEFAULT_TIME_SIGNATURE = "4/4"
DEFAULT_BEATS_PER_BAR = 4
INTERMEDIATE_TARGET_BPM = 120.0
DEFAULT_SAMPLE_RATE = 48000
DEFAULT_CHANNELS = 2
DEFAULT_CLICK_MS = 45.0
MAX_CLICK_MS = 140.0
CLICK_PRE_ROLL_MS = 4.0
MIN_CLICK_MS = 18.0
QUIET_TAIL_MS = 12.0
FADE_IN_MS = 2.0
FADE_OUT_MS = 8.0


def ensure_runtime() -> None:
    missing: list[str] = []
    if librosa is None:
        missing.append("librosa")
    if np is None:
        missing.append("numpy")
    if missing:
        raise RuntimeError("缺少依赖: " + ", ".join(missing))


def resolve_meter_metadata(
    signature: str | None = None, beats_per_bar: int | None = None
) -> dict[str, Any]:
    if signature in SUPPORTED_METERS:
        return {"timeSignature": signature, **SUPPORTED_METERS[signature]}
    if beats_per_bar == 3:
        return {"timeSignature": "3/4", **SUPPORTED_METERS["3/4"]}
    if beats_per_bar == 6:
        return {"timeSignature": "6/8", **SUPPORTED_METERS["6/8"]}
    return {"timeSignature": DEFAULT_TIME_SIGNATURE, **SUPPORTED_METERS[DEFAULT_TIME_SIGNATURE]}


def normalize_accent_pattern(
    accent_pattern: list[float] | None, beats_per_bar: int, signature: str | None = None
) -> list[float]:
    fallback = resolve_meter_metadata(signature, beats_per_bar)["accent_pattern"]
    if not accent_pattern:
        return list(fallback)
    normalized = [float(value) for value in accent_pattern if float(value) > 0]
    if len(normalized) != beats_per_bar:
        return list(fallback)
    return normalized


def resolve_aligned_target_bpm(
    source_bpm: float, explicit_target_bpm: float | None, global_target_bpm: float
) -> tuple[float, str]:
    if explicit_target_bpm and explicit_target_bpm > 0:
        return float(explicit_target_bpm), "manual-target"
    if global_target_bpm >= 160 and 100 <= source_bpm <= 125:
        return INTERMEDIATE_TARGET_BPM, "comfort-target->120"
    return float(global_target_bpm), "global-target"


def resolve_harmonic_multiplier(
    source_bpm: float,
    target_bpm: float,
    tolerance: float = 0.12,
    disable_mapping: bool = False,
    half_map_upper_bpm: float = 110.0,
) -> tuple[float, str]:
    if disable_mapping or source_bpm <= 0 or target_bpm <= 0:
        return 1.0, "direct"

    if half_map_upper_bpm > 0 and source_bpm < 100 and source_bpm <= half_map_upper_bpm:
        return 2.0, "half-time->target(range-rule)"

    half_target = target_bpm / 2.0
    double_target = target_bpm * 2.0

    if source_bpm < 100 and half_target > 0:
        half_diff = abs(source_bpm - half_target) / half_target
        if half_diff <= tolerance:
            return 2.0, "half-time->target"

    double_diff = abs(source_bpm - double_target) / max(double_target, 1e-6)
    if double_diff <= tolerance:
        return 0.5, "double-time->target"

    direct_rate = target_bpm / source_bpm
    mapped_rate_x2 = target_bpm / (source_bpm * 2.0)
    mapped_rate_x05 = target_bpm / (source_bpm * 0.5)

    if source_bpm < 100 and direct_rate >= 1.8 and 0.78 <= mapped_rate_x2 <= 1.35:
        return 2.0, "half-time->target(heuristic)"
    if direct_rate <= 0.6 and 0.78 <= mapped_rate_x05 <= 1.35:
        return 0.5, "double-time->target(heuristic)"

    return 1.0, "direct"


def suggest_alignment(track: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    source_bpm = float(track.get("bpm") or 0.0)
    global_target_bpm = float(payload.get("globalTargetBpm") or 0.0)
    mix_tuning = payload.get("mixTuning") or {}
    explicit_target_bpm = (
        float(track["targetBpm"]) if track.get("targetBpm") not in (None, "") else None
    )
    target_bpm, target_mode = resolve_aligned_target_bpm(
        source_bpm, explicit_target_bpm, global_target_bpm
    )
    multiplier, harmonic_mode = resolve_harmonic_multiplier(
        source_bpm=source_bpm,
        target_bpm=target_bpm,
        tolerance=float(mix_tuning.get("harmonicTolerance") or 0.12),
        disable_mapping=not bool(mix_tuning.get("harmonicMappingEnabled", True)),
        half_map_upper_bpm=float(mix_tuning.get("halfMapUpperBpm") or 110.0),
    )
    effective_source_bpm = source_bpm * multiplier if source_bpm > 0 else global_target_bpm
    speed_ratio = target_bpm / max(effective_source_bpm, 1e-6)
    downbeat_offset_ms = float(track.get("downbeatOffsetMs") or 0.0)
    downbeat_offset_ms_after_speed = downbeat_offset_ms / max(speed_ratio, 1e-6)
    combined_mode = harmonic_mode if target_mode == "global-target" else f"{target_mode} / {harmonic_mode}"
    return {
        "filePath": track["filePath"],
        "recommendedTargetBpm": round(target_bpm, 4),
        "effectiveSourceBpm": round(effective_source_bpm, 4),
        "speedRatio": round(speed_ratio, 8),
        "harmonicMode": combined_mode,
        "downbeatOffsetMsAfterSpeed": int(round(max(0.0, downbeat_offset_ms_after_speed))),
        "recommendedMetronomeStartMs": int(round(max(0.0, downbeat_offset_ms_after_speed))),
    }


def detect_meter_profile(beat_frames: Any, onset_env: Any) -> tuple[str, int, float, int, list[float]]:
    if beat_frames.size == 0 or onset_env.size == 0:
        fallback = resolve_meter_metadata()
        return (
            fallback["timeSignature"],
            fallback["beats_per_bar"],
            0.0,
            0,
            list(fallback["accent_pattern"]),
        )

    safe_indices = np.clip(beat_frames, 0, onset_env.size - 1)
    beat_strengths = onset_env[safe_indices]
    if beat_strengths.size == 0:
        fallback = resolve_meter_metadata()
        return (
            fallback["timeSignature"],
            fallback["beats_per_bar"],
            0.0,
            int(beat_frames[0]) if beat_frames.size > 0 else 0,
            list(fallback["accent_pattern"]),
        )

    scored: list[dict[str, Any]] = []
    for signature, config in SUPPORTED_METERS.items():
        beats_per_bar = int(config["beats_per_bar"])
        accent_pattern = list(config["accent_pattern"])
        if beat_strengths.size < beats_per_bar:
            scored.append(
                {
                    "score": 0.0,
                    "phase": 0,
                    "signature": signature,
                    "beats_per_bar": beats_per_bar,
                    "accent_pattern": accent_pattern,
                    "primary_alternation": 0.0,
                    "secondary_lift": 0.0,
                }
            )
            continue

        best_phase = 0
        best_score = -1.0
        weight_sum = sum(accent_pattern)
        for phase in range(beats_per_bar):
            weighted = 0.0
            total = 0.0
            for index, strength in enumerate(beat_strengths):
                relative = (index - phase) % beats_per_bar
                weight = accent_pattern[relative]
                weighted += float(strength) * float(weight)
                total += float(strength)
            normalized = weighted / max(total * max(weight_sum / beats_per_bar, 1.0), 1e-6)
            if normalized > best_score:
                best_score = normalized
                best_phase = phase
        lane_values = [[] for _ in range(beats_per_bar)]
        for index, strength in enumerate(beat_strengths):
            relative = (index - best_phase) % beats_per_bar
            lane_values[relative].append(float(strength))

        lane_means = [
            (sum(values) / len(values)) if values else 0.0
            for values in lane_values
        ]

        primary_values = lane_values[0]
        primary_alternation = 0.0
        if len(primary_values) >= 4:
            even_values = primary_values[::2]
            odd_values = primary_values[1::2]
            even_mean = sum(even_values) / max(len(even_values), 1)
            odd_mean = sum(odd_values) / max(len(odd_values), 1)
            overall_mean = sum(primary_values) / max(len(primary_values), 1)
            primary_alternation = (
                abs(even_mean - odd_mean) / overall_mean if overall_mean > 0 else 0.0
            )

        secondary_lift = 0.0
        if signature == "6/8":
            secondary_mean = lane_means[3] if len(lane_means) > 3 else 0.0
            weak_values = [
                value
                for index, value in enumerate(lane_means)
                if index not in (0, 3)
            ]
            weak_mean = sum(weak_values) / max(len(weak_values), 1)
            primary_mean = lane_means[0] if lane_means else 0.0
            secondary_lift = (
                max(0.0, (secondary_mean - weak_mean) / primary_mean)
                if primary_mean > 0
                else 0.0
            )

        scored.append(
            {
                "score": best_score,
                "phase": best_phase,
                "signature": signature,
                "beats_per_bar": beats_per_bar,
                "accent_pattern": accent_pattern,
                "primary_alternation": round(primary_alternation, 3),
                "secondary_lift": round(secondary_lift, 3),
            }
        )

    scored.sort(key=lambda item: float(item["score"]), reverse=True)
    best_index = 0
    best = scored[0]
    six_eight_index = next(
        (
            index
            for index, candidate in enumerate(scored)
            if candidate["signature"] == "6/8"
        ),
        -1,
    )
    if best["signature"] == "3/4" and six_eight_index >= 0:
        six_eight = scored[six_eight_index]
        score_gap = float(best["score"]) - float(six_eight["score"])
        if (
            score_gap <= 0.08
            and float(best["primary_alternation"]) >= 0.12
            and float(six_eight["secondary_lift"]) >= 0.12
        ):
            best_index = six_eight_index

    selected = scored[best_index]
    runner_up = next(
        (candidate for index, candidate in enumerate(scored) if index != best_index),
        None,
    )
    selected_score = float(selected["score"])
    runner_up_score = float(runner_up["score"]) if runner_up else 0.0
    confidence = max(
        0.0,
        min(1.0, selected_score / max(selected_score + runner_up_score, 1e-6)),
    )
    best_phase = int(selected["phase"])
    downbeat_frame = int(beat_frames[best_phase]) if beat_frames.size > best_phase else int(beat_frames[0])
    return (
        str(selected["signature"]),
        int(selected["beats_per_bar"]),
        round(confidence, 3),
        downbeat_frame,
        list(selected["accent_pattern"]),
    )


def analyze_track(file_path: str, analysis_seconds: float) -> dict[str, Any]:
    ensure_runtime()
    duration = None if analysis_seconds <= 0 else analysis_seconds
    y, sr = librosa.load(file_path, sr=22050, mono=True, duration=duration)
    if y.size == 0:
        meter = resolve_meter_metadata()
        return {
            "filePath": file_path,
            "bpm": 0.0,
            "firstBeatMs": 0,
            "downbeatOffsetMs": 0,
            "beatsPerBar": meter["beats_per_bar"],
            "timeSignature": meter["timeSignature"],
            "analysisConfidence": 0.0,
            "meterConfidence": 0.0,
            "accentPattern": list(meter["accent_pattern"]),
        }

    hop_length = 512
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    tempo, beat_frames = librosa.beat.beat_track(
        y=y,
        sr=sr,
        hop_length=hop_length,
        units="frames",
    )

    tempo_arr = np.asarray(tempo).reshape(-1)
    bpm = float(tempo_arr[0]) if tempo_arr.size > 0 else 0.0
    beat_frames_arr = np.asarray(beat_frames, dtype=int).reshape(-1)

    if beat_frames_arr.size == 0:
        meter = resolve_meter_metadata()
        return {
            "filePath": file_path,
            "bpm": round(bpm, 2),
            "firstBeatMs": 0,
            "downbeatOffsetMs": 0,
            "beatsPerBar": meter["beats_per_bar"],
            "timeSignature": meter["timeSignature"],
            "analysisConfidence": 0.0,
            "meterConfidence": 0.0,
            "accentPattern": list(meter["accent_pattern"]),
        }

    beat_times = librosa.frames_to_time(beat_frames_arr, sr=sr, hop_length=hop_length)
    first_beat_ms = int(round(float(beat_times[0]) * 1000.0)) if beat_times.size > 0 else 0
    (
        signature,
        beats_per_bar,
        meter_confidence,
        downbeat_frame,
        accent_pattern,
    ) = detect_meter_profile(beat_frames_arr, onset_env)
    downbeat_offset_ms = int(
        round(float(librosa.frames_to_time(downbeat_frame, sr=sr, hop_length=hop_length)) * 1000.0)
    )

    duration_sec = float(len(y)) / float(sr) if sr > 0 else 0.0
    expected_beats = max((duration_sec * bpm / 60.0), 1.0)
    beat_coverage = min(1.0, float(beat_frames_arr.size) / expected_beats)
    strength = float(np.mean(onset_env[np.clip(beat_frames_arr, 0, onset_env.size - 1)])) if onset_env.size > 0 else 0.0
    normalization = float(np.max(onset_env)) if onset_env.size > 0 else 1.0
    strength_ratio = strength / max(normalization, 1e-6)
    analysis_confidence = round(max(0.0, min(1.0, 0.55 * beat_coverage + 0.45 * strength_ratio)), 3)

    return {
        "filePath": file_path,
        "bpm": round(bpm, 2),
        "firstBeatMs": first_beat_ms,
        "downbeatOffsetMs": max(0, downbeat_offset_ms),
        "beatsPerBar": beats_per_bar,
        "timeSignature": signature,
        "analysisConfidence": analysis_confidence,
        "meterConfidence": meter_confidence,
        "accentPattern": normalize_accent_pattern(accent_pattern, beats_per_bar, signature),
    }


def db_to_linear(db_value: float) -> float:
    return 10 ** (float(db_value) / 20.0)


def ms_to_samples(duration_ms: float, sample_rate: int) -> int:
    return max(0, int(round(float(duration_ms) * sample_rate / 1000.0)))


def normalize_audio_shape(audio: Any) -> Any:
    array = np.asarray(audio, dtype=np.float32)
    if array.ndim == 1:
        return array.reshape(1, -1)
    if array.ndim != 2:
        raise RuntimeError(f"不支持的音频维度: {array.ndim}")
    return array


def align_channels(audio: Any, channels: int) -> Any:
    normalized = normalize_audio_shape(audio)
    if channels <= 1:
        return np.mean(normalized, axis=0, keepdims=True)
    if normalized.shape[0] == channels:
        return normalized
    if normalized.shape[0] == 1:
        return np.repeat(normalized, channels, axis=0)
    if normalized.shape[0] > channels:
        return normalized[:channels]
    extra = np.repeat(normalized[-1:], channels - normalized.shape[0], axis=0)
    return np.concatenate([normalized, extra], axis=0)


def apply_edge_fade(audio: Any, sample_rate: int) -> Any:
    array = np.asarray(audio, dtype=np.float32).copy()
    if array.size == 0:
        return array
    fade_in = min(array.shape[1], ms_to_samples(FADE_IN_MS, sample_rate))
    fade_out = min(array.shape[1], ms_to_samples(FADE_OUT_MS, sample_rate))
    if fade_in > 1:
        ramp = np.linspace(0.0, 1.0, fade_in, dtype=np.float32)
        array[:, :fade_in] *= ramp
    if fade_out > 1:
        ramp = np.linspace(1.0, 0.0, fade_out, dtype=np.float32)
        array[:, -fade_out:] *= ramp
    return array


def peak_normalize(audio: Any, target_peak: float = 0.95) -> Any:
    array = np.asarray(audio, dtype=np.float32)
    if array.size == 0:
        return array.copy()
    peak = float(np.max(np.abs(array)))
    if peak <= 1e-6:
        return array.copy()
    scaled = array * min(1.0, float(target_peak) / peak)
    return scaled.astype(np.float32)


def build_synthetic_click(
    sample_rate: int,
    channels: int,
    accent: bool,
    mode: str,
) -> Any:
    duration_ms = 32.0 if mode == "crisp-click" else DEFAULT_CLICK_MS
    total_samples = max(1, ms_to_samples(duration_ms, sample_rate))
    timeline = np.linspace(0.0, duration_ms / 1000.0, total_samples, endpoint=False, dtype=np.float32)
    if accent:
        frequency_a = 1880.0
        frequency_b = 2680.0
        amplitude = 0.94
    else:
        frequency_a = 1560.0
        frequency_b = 2320.0
        amplitude = 0.82
    envelope = np.exp(-timeline * (36.0 if mode == "crisp-click" else 24.0)).astype(np.float32)
    waveform = (
        0.78 * np.sin(2.0 * np.pi * frequency_a * timeline)
        + 0.22 * np.sin(2.0 * np.pi * frequency_b * timeline)
    ).astype(np.float32)
    click = (waveform * envelope * amplitude).reshape(1, -1)
    click = align_channels(click, channels)
    return apply_edge_fade(click, sample_rate)


def load_audio_for_render(sample_path: str, sample_rate: int, channels: int) -> Any:
    ensure_runtime()
    if not sample_path or not os.path.exists(sample_path):
        raise FileNotFoundError(sample_path)
    mono = channels <= 1
    loaded, _ = librosa.load(sample_path, sr=sample_rate, mono=mono)
    audio = align_channels(loaded, channels)
    if audio.size == 0:
        raise RuntimeError("节拍器样本为空")
    return audio.astype(np.float32)


def find_sample_onsets(audio: Any, sample_rate: int) -> tuple[Any, Any]:
    mono = np.mean(np.abs(audio), axis=0)
    if mono.size == 0:
        return np.asarray([], dtype=int), np.asarray([], dtype=float)
    hop_length = 256 if sample_rate >= 22050 else 128
    onset_env = librosa.onset.onset_strength(y=mono, sr=sample_rate, hop_length=hop_length)
    onset_frames = np.asarray(
        librosa.onset.onset_detect(
            onset_envelope=onset_env,
            sr=sample_rate,
            hop_length=hop_length,
            units="frames",
            backtrack=False,
            pre_max=3,
            post_max=3,
            pre_avg=3,
            post_avg=5,
            delta=0.05,
            wait=1,
        ),
        dtype=int,
    ).reshape(-1)
    onset_samples = librosa.frames_to_samples(onset_frames, hop_length=hop_length)
    onset_scores = (
        onset_env[np.clip(onset_frames, 0, max(0, onset_env.size - 1))]
        if onset_frames.size > 0
        else np.asarray([], dtype=float)
    )
    if onset_samples.size == 0:
        onset_samples = np.asarray([int(np.argmax(mono))], dtype=int)
        onset_scores = np.asarray([float(np.max(mono))], dtype=float)
    return onset_samples.astype(int), onset_scores.astype(float)


def extract_click_clip(
    audio: Any,
    onset_sample: int,
    next_onset_sample: int | None,
    sample_rate: int,
) -> Any:
    start = max(0, int(onset_sample) - ms_to_samples(CLICK_PRE_ROLL_MS, sample_rate))
    max_end = min(audio.shape[1], start + ms_to_samples(MAX_CLICK_MS, sample_rate))
    if next_onset_sample is not None:
        next_guard = max(start + ms_to_samples(MIN_CLICK_MS, sample_rate), int(next_onset_sample))
        max_end = min(max_end, next_guard)
    if max_end <= start:
        max_end = min(audio.shape[1], start + ms_to_samples(DEFAULT_CLICK_MS, sample_rate))
    segment = audio[:, start:max_end]
    if segment.size == 0:
        return np.zeros((audio.shape[0], 1), dtype=np.float32)

    mono = np.mean(np.abs(segment), axis=0)
    min_len = max(1, ms_to_samples(MIN_CLICK_MS, sample_rate))
    quiet_len = max(1, ms_to_samples(QUIET_TAIL_MS, sample_rate))
    smoothing_window = max(3, int(sample_rate * 0.002))
    kernel = np.ones(smoothing_window, dtype=np.float32) / float(smoothing_window)
    smoothed = np.convolve(mono, kernel, mode="same")
    peak = float(np.max(smoothed)) if smoothed.size > 0 else 0.0
    threshold = max(peak * 0.08, 2e-4)

    end_index = segment.shape[1]
    search_upper = max(min_len, smoothed.size - quiet_len)
    for index in range(min_len, search_upper):
        if np.all(smoothed[index : index + quiet_len] <= threshold):
            end_index = index + quiet_len
            break

    trimmed = segment[:, : max(min_len, end_index)]
    return apply_edge_fade(peak_normalize(trimmed), sample_rate)


def analyze_sample_clicks(
    sample_path: str,
    sample_rate: int,
    channels: int,
    mode: str,
) -> dict[str, Any]:
    if mode == "crisp-click" or not sample_path or not os.path.exists(sample_path):
        accent_clip = build_synthetic_click(sample_rate, channels, True, mode)
        normal_clip = build_synthetic_click(sample_rate, channels, False, mode)
        return {
            "usedSample": False,
            "samplePath": sample_path,
            "accentClip": accent_clip,
            "normalClip": normal_clip,
            "hasDistinctAccent": True,
            "onsetCount": 0,
            "accentSourceIndex": -1,
            "normalSourceIndex": -1,
        }

    try:
        audio = load_audio_for_render(sample_path, sample_rate, channels)
    except Exception:
        accent_clip = build_synthetic_click(sample_rate, channels, True, mode)
        normal_clip = build_synthetic_click(sample_rate, channels, False, mode)
        return {
            "usedSample": False,
            "samplePath": sample_path,
            "accentClip": accent_clip,
            "normalClip": normal_clip,
            "hasDistinctAccent": True,
            "onsetCount": 0,
            "accentSourceIndex": -1,
            "normalSourceIndex": -1,
        }

    onset_samples, onset_scores = find_sample_onsets(audio, sample_rate)
    onset_count = int(onset_samples.size)
    order = np.argsort(onset_scores)[::-1] if onset_scores.size > 0 else np.asarray([], dtype=int)
    accent_index = int(order[0]) if order.size > 0 else 0

    normal_index = accent_index
    if order.size > 1:
        strongest = float(onset_scores[accent_index])
        for candidate in order[1:]:
            if strongest <= 1e-6 or float(onset_scores[candidate]) <= strongest * 0.92:
                normal_index = int(candidate)
                break
        else:
            normal_index = int(order[1])

    onset_list = onset_samples.tolist()
    accent_next = onset_list[accent_index + 1] if accent_index + 1 < len(onset_list) else None
    normal_next = onset_list[normal_index + 1] if normal_index + 1 < len(onset_list) else None

    accent_clip = extract_click_clip(audio, onset_list[accent_index], accent_next, sample_rate)
    normal_clip = extract_click_clip(audio, onset_list[normal_index], normal_next, sample_rate)
    has_distinct_accent = bool(
        onset_count > 1
        and accent_index != normal_index
        and float(onset_scores[accent_index]) > float(onset_scores[normal_index]) * 1.05
    )
    if not has_distinct_accent:
        accent_clip = peak_normalize(accent_clip * 1.08)

    return {
        "usedSample": True,
        "samplePath": sample_path,
        "accentClip": accent_clip.astype(np.float32),
        "normalClip": normal_clip.astype(np.float32),
        "hasDistinctAccent": has_distinct_accent,
        "onsetCount": onset_count,
        "accentSourceIndex": accent_index,
        "normalSourceIndex": normal_index,
    }


def stretch_audio_clip(audio: Any, playback_rate: float) -> Any:
    array = np.asarray(audio, dtype=np.float32)
    rate = max(0.05, float(playback_rate))
    if array.size == 0 or abs(rate - 1.0) <= 1e-4:
        return array.copy()
    source_len = array.shape[1]
    if source_len <= 1:
        return array.copy()
    target_len = max(1, int(round(source_len / rate)))
    source_positions = np.arange(source_len, dtype=np.float32)
    target_positions = np.linspace(0.0, source_len - 1, target_len, dtype=np.float32)
    stretched = np.vstack(
        [
            np.interp(target_positions, source_positions, array[channel]).astype(np.float32)
            for channel in range(array.shape[0])
        ]
    )
    return stretched.astype(np.float32)


def mix_clip_into_buffer(buffer: Any, clip: Any, start_sample: int, gain: float) -> None:
    if clip.size == 0 or gain <= 0:
        return
    if start_sample >= buffer.shape[1]:
        return
    end_sample = min(buffer.shape[1], start_sample + clip.shape[1])
    clip_end = max(0, end_sample - start_sample)
    if clip_end <= 0:
        return
    buffer[:, start_sample:end_sample] += clip[:, :clip_end] * float(gain)


def write_wave_file(output_path: str, audio: Any, sample_rate: int) -> None:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    normalized = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    pcm = (normalized.T * 32767.0).astype("<i2")
    with wave.open(output_path, "wb") as handle:
        handle.setnchannels(int(normalized.shape[0]))
        handle.setsampwidth(2)
        handle.setframerate(int(sample_rate))
        handle.writeframes(pcm.tobytes())


def render_metronome_audio(payload: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    ensure_runtime()
    sample_rate = max(8000, int(payload.get("sampleRate") or DEFAULT_SAMPLE_RATE))
    channels = max(1, int(payload.get("channels") or DEFAULT_CHANNELS))
    duration_ms = max(0.0, float(payload.get("durationMs") or 0.0))
    beat_times_ms = [max(0.0, float(value)) for value in (payload.get("beatTimesMs") or [])]
    beat_render_mode = str(payload.get("beatRenderMode") or "sampled-click")
    accent_pattern_raw = payload.get("accentPattern") or [1.35, 1.0, 1.0, 1.0]
    accent_pattern = [max(0.05, float(value)) for value in accent_pattern_raw]
    beat_gain_db = float(payload.get("beatGainDb") or 0.0)
    beat_gain_linear = db_to_linear(beat_gain_db)
    beat_original_bpm = float(payload.get("beatOriginalBpm") or 0.0)
    metronome_bpm = float(payload.get("metronomeBpm") or 0.0)
    sample_path = str(payload.get("samplePath") or "")

    total_samples = max(1, ms_to_samples(duration_ms, sample_rate))
    output = np.zeros((channels, total_samples), dtype=np.float32)
    click_analysis = analyze_sample_clicks(sample_path, sample_rate, channels, beat_render_mode)

    playback_rate = (
        metronome_bpm / max(beat_original_bpm, 1e-6)
        if beat_render_mode == "stretched-file" and beat_original_bpm > 0 and metronome_bpm > 0
        else 1.0
    )

    accent_clip_base = np.asarray(click_analysis["accentClip"], dtype=np.float32)
    normal_clip_base = np.asarray(click_analysis["normalClip"], dtype=np.float32)
    accent_clip = (
        stretch_audio_clip(accent_clip_base, playback_rate)
        if beat_render_mode == "stretched-file"
        else accent_clip_base
    )
    normal_clip = (
        stretch_audio_clip(normal_clip_base, playback_rate)
        if beat_render_mode == "stretched-file"
        else normal_clip_base
    )

    for index, beat_time_ms in enumerate(beat_times_ms):
        accent_value = accent_pattern[index % len(accent_pattern)] if accent_pattern else 1.0
        use_accent_clip = bool(
            accent_value > 1.01
            and (
                click_analysis.get("hasDistinctAccent", False)
                or index % max(len(accent_pattern), 1) == 0
            )
        )
        clip = accent_clip if use_accent_clip else normal_clip
        start_sample = ms_to_samples(beat_time_ms, sample_rate)
        mix_clip_into_buffer(output, clip, start_sample, beat_gain_linear * accent_value)

    peak = float(np.max(np.abs(output))) if output.size > 0 else 0.0
    if peak > 0.999:
        output /= peak

    metadata = {
        "durationMs": int(round(duration_ms)),
        "sampleRate": sample_rate,
        "channels": channels,
        "usedSample": bool(click_analysis["usedSample"]),
        "samplePath": sample_path if click_analysis["usedSample"] else "",
        "beatCount": len(beat_times_ms),
        "beatRenderMode": beat_render_mode,
        "beatGainDb": round(beat_gain_db, 4),
        "playbackRate": round(playback_rate, 6),
        "onsetCount": int(click_analysis["onsetCount"]),
        "hasDistinctAccent": bool(click_analysis["hasDistinctAccent"]),
        "accentClickSamples": int(accent_clip.shape[1]),
        "normalClickSamples": int(normal_clip.shape[1]),
        "accentSourceIndex": int(click_analysis["accentSourceIndex"]),
        "normalSourceIndex": int(click_analysis["normalSourceIndex"]),
    }
    return output.astype(np.float32), metadata


def handle_render_metronome_track(payload: dict[str, Any]) -> dict[str, Any]:
    output_path = str(payload.get("outputPath") or "").strip()
    if not output_path:
        raise RuntimeError("missing outputPath for render-metronome-track")
    rendered_audio, metadata = render_metronome_audio(payload)
    write_wave_file(output_path, rendered_audio, int(metadata["sampleRate"]))
    return metadata


def handle_analyze_tracks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    tracks = payload.get("tracks") or []
    analysis_seconds = float(payload.get("analysisSeconds") or 0.0)
    return [analyze_track(track["filePath"], analysis_seconds) for track in tracks]


def handle_suggest_track_alignments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    tracks = payload.get("tracks") or []
    return [suggest_alignment(track, payload) for track in tracks]


def main() -> int:
    if len(sys.argv) < 2:
        raise RuntimeError("missing analyzer subcommand")

    payload = json.loads(sys.stdin.read() or "{}")
    subcommand = sys.argv[1]
    if subcommand == "analyze-tracks":
        sys.stdout.write(json.dumps({"results": handle_analyze_tracks(payload)}, ensure_ascii=False))
        return 0
    if subcommand == "suggest-track-alignments":
        sys.stdout.write(
            json.dumps({"results": handle_suggest_track_alignments(payload)}, ensure_ascii=False)
        )
        return 0
    if subcommand == "render-metronome-track":
        sys.stdout.write(
            json.dumps({"result": handle_render_metronome_track(payload)}, ensure_ascii=False)
        )
        return 0
    raise RuntimeError(f"unknown analyzer subcommand: {subcommand}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(str(exc))
        raise SystemExit(1)
