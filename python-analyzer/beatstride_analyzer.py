#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
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
        results = handle_analyze_tracks(payload)
    elif subcommand == "suggest-track-alignments":
        results = handle_suggest_track_alignments(payload)
    else:
        raise RuntimeError(f"unknown analyzer subcommand: {subcommand}")

    sys.stdout.write(json.dumps({"results": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(str(exc))
        raise SystemExit(1)
