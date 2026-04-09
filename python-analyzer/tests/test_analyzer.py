from __future__ import annotations

import importlib.util
import pathlib
import tempfile
import unittest
import wave


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "beatstride_analyzer.py"
SPEC = importlib.util.spec_from_file_location("beatstride_analyzer", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def write_test_wave(file_path: pathlib.Path, audio, sample_rate: int) -> None:
    pcm = (audio.T * 32767.0).astype("<i2")
    with wave.open(str(file_path), "wb") as handle:
        handle.setnchannels(audio.shape[0])
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm.tobytes())


@unittest.skipIf(getattr(MODULE, "np", None) is None, "numpy unavailable")
class AnalyzerTests(unittest.TestCase):
    def test_suggest_alignment_prefers_comfort_target(self) -> None:
        result = MODULE.suggest_alignment(
            {
                "filePath": "C:/music/a.mp3",
                "bpm": 110,
                "downbeatOffsetMs": 220,
            },
            {
                "globalTargetBpm": 180,
                "mixTuning": {
                    "harmonicTolerance": 0.12,
                    "harmonicMappingEnabled": True,
                    "halfMapUpperBpm": 110,
                },
            },
        )

        self.assertEqual(result["recommendedTargetBpm"], 120.0)
        self.assertIn("comfort-target->120", result["harmonicMode"])

    def test_detect_meter_profile_recognizes_three_four(self) -> None:
        np = MODULE.np
        beat_frames = np.arange(18)
        onset_env = np.array(
            [1.8, 1.0, 1.0, 1.7, 1.0, 1.0, 1.9, 1.0, 1.0, 1.8, 1.0, 1.0, 1.85, 1.0, 1.0, 1.75, 1.0, 1.0],
            dtype=float,
        )

        signature, beats_per_bar, confidence, _, accent_pattern = MODULE.detect_meter_profile(
            beat_frames, onset_env
        )

        self.assertEqual(signature, "3/4")
        self.assertEqual(beats_per_bar, 3)
        self.assertGreater(confidence, 0)
        self.assertEqual(accent_pattern, [1.35, 1.0, 1.0])

    def test_detect_meter_profile_prefers_six_eight_when_secondary_pulse_is_present(self) -> None:
        np = MODULE.np
        beat_frames = np.arange(24)
        onset_env = np.array(
            [
                1.9,
                1.0,
                1.0,
                1.4,
                1.0,
                1.0,
                1.85,
                1.0,
                1.0,
                1.35,
                1.0,
                1.0,
                1.95,
                1.0,
                1.0,
                1.45,
                1.0,
                1.0,
                1.9,
                1.0,
                1.0,
                1.4,
                1.0,
                1.0,
            ],
            dtype=float,
        )

        signature, beats_per_bar, confidence, _, accent_pattern = MODULE.detect_meter_profile(
            beat_frames, onset_env
        )

        self.assertEqual(signature, "6/8")
        self.assertEqual(beats_per_bar, 6)
        self.assertGreater(confidence, 0)
        self.assertEqual(accent_pattern, [1.35, 1.0, 1.0, 1.15, 1.0, 1.0])

    def build_loop_sample(self, sample_rate: int = 48000):
        np = MODULE.np
        duration_sec = 1.0
        total_samples = int(sample_rate * duration_sec)
        audio = np.zeros((1, total_samples), dtype=np.float32)
        beat_positions_ms = [0, 250, 500, 750]
        for index, beat_ms in enumerate(beat_positions_ms):
            accent = index == 0
            clip = MODULE.build_synthetic_click(sample_rate, 1, accent, "sampled-click")
            gain = 1.0 if accent else 0.55
            start = MODULE.ms_to_samples(beat_ms, sample_rate)
            MODULE.mix_clip_into_buffer(audio, clip, start, gain)
        peak = float(np.max(np.abs(audio)))
        if peak > 0:
            audio /= peak
        return audio

    def read_wave_peak_window(self, file_path: pathlib.Path, start_ms: int, end_ms: int) -> float:
        np = MODULE.np
        with wave.open(str(file_path), "rb") as handle:
            frames = handle.readframes(handle.getnframes())
            sample_rate = handle.getframerate()
            channels = handle.getnchannels()
        data = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32767.0
        reshaped = data.reshape(-1, channels).T
        start = MODULE.ms_to_samples(start_ms, sample_rate)
        end = MODULE.ms_to_samples(end_ms, sample_rate)
        return float(np.max(np.abs(reshaped[:, start:end])))

    def test_render_metronome_track_extracts_sampled_accent(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = pathlib.Path(tmpdir)
            sample_path = tmp_path / "loop.wav"
            output_path = tmp_path / "rendered.wav"
            write_test_wave(sample_path, self.build_loop_sample(), 48000)

            result = MODULE.handle_render_metronome_track(
                {
                    "samplePath": str(sample_path),
                    "outputPath": str(output_path),
                    "durationMs": 1000,
                    "beatTimesMs": [0, 250, 500, 750],
                    "accentPattern": [1.35, 1.0, 1.0, 1.0],
                    "beatGainDb": 0,
                    "beatRenderMode": "sampled-click",
                    "beatOriginalBpm": 180,
                    "metronomeBpm": 180,
                    "sampleRate": 48000,
                    "channels": 1,
                }
            )

            self.assertTrue(output_path.exists())
            self.assertTrue(result["usedSample"])
            self.assertGreaterEqual(result["onsetCount"], 2)
            first_peak = self.read_wave_peak_window(output_path, 0, 80)
            second_peak = self.read_wave_peak_window(output_path, 250, 330)
            self.assertGreater(first_peak, second_peak)

    def test_render_metronome_track_stretched_file_changes_click_length(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = pathlib.Path(tmpdir)
            sample_path = tmp_path / "loop.wav"
            output_path = tmp_path / "rendered.wav"
            write_test_wave(sample_path, self.build_loop_sample(), 48000)

            sampled_audio, sampled_meta = MODULE.render_metronome_audio(
                {
                    "samplePath": str(sample_path),
                    "durationMs": 800,
                    "beatTimesMs": [0, 300, 600],
                    "accentPattern": [1.35, 1.0, 1.0],
                    "beatGainDb": 0,
                    "beatRenderMode": "sampled-click",
                    "beatOriginalBpm": 180,
                    "metronomeBpm": 120,
                    "sampleRate": 48000,
                    "channels": 1,
                }
            )
            stretched_audio, stretched_meta = MODULE.render_metronome_audio(
                {
                    "samplePath": str(sample_path),
                    "outputPath": str(output_path),
                    "durationMs": 800,
                    "beatTimesMs": [0, 300, 600],
                    "accentPattern": [1.35, 1.0, 1.0],
                    "beatGainDb": 0,
                    "beatRenderMode": "stretched-file",
                    "beatOriginalBpm": 180,
                    "metronomeBpm": 120,
                    "sampleRate": 48000,
                    "channels": 1,
                }
            )

            self.assertEqual(sampled_audio.shape[1], stretched_audio.shape[1])
            self.assertAlmostEqual(stretched_meta["playbackRate"], 120 / 180, places=4)
            self.assertGreater(stretched_meta["normalClickSamples"], sampled_meta["normalClickSamples"])

    def test_render_metronome_track_uses_synthetic_click_when_sample_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = pathlib.Path(tmpdir) / "rendered.wav"
            result = MODULE.handle_render_metronome_track(
                {
                    "samplePath": str(pathlib.Path(tmpdir) / "missing.wav"),
                    "outputPath": str(output_path),
                    "durationMs": 600,
                    "beatTimesMs": [0, 200, 400],
                    "accentPattern": [1.35, 1.0, 1.0],
                    "beatGainDb": -3,
                    "beatRenderMode": "sampled-click",
                    "beatOriginalBpm": 180,
                    "metronomeBpm": 180,
                    "sampleRate": 44100,
                    "channels": 1,
                }
            )

            self.assertTrue(output_path.exists())
            self.assertFalse(result["usedSample"])
            self.assertGreater(result["normalClickSamples"], 0)

    def test_render_metronome_track_handles_empty_beat_times(self) -> None:
        np = MODULE.np
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = pathlib.Path(tmpdir) / "rendered.wav"
            result = MODULE.handle_render_metronome_track(
                {
                    "samplePath": "",
                    "outputPath": str(output_path),
                    "durationMs": 500,
                    "beatTimesMs": [],
                    "accentPattern": [1.35, 1.0, 1.0, 1.0],
                    "beatGainDb": 0,
                    "beatRenderMode": "crisp-click",
                    "beatOriginalBpm": 180,
                    "metronomeBpm": 180,
                    "sampleRate": 48000,
                    "channels": 1,
                }
            )

            with wave.open(str(output_path), "rb") as handle:
                frames = handle.readframes(handle.getnframes())
            data = np.frombuffer(frames, dtype="<i2")
            self.assertTrue(output_path.exists())
            self.assertEqual(result["beatCount"], 0)
            self.assertEqual(int(np.max(np.abs(data))) if data.size > 0 else 0, 0)


if __name__ == "__main__":
    unittest.main()
