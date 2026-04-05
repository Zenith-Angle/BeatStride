from __future__ import annotations

import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "beatstride_analyzer.py"
SPEC = importlib.util.spec_from_file_location("beatstride_analyzer", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


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

    @unittest.skipIf(getattr(MODULE, "np", None) is None, "numpy unavailable")
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

    @unittest.skipIf(getattr(MODULE, "np", None) is None, "numpy unavailable")
    def test_detect_meter_profile_recognizes_six_eight(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
