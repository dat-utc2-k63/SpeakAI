"""Thread-safe model loading progress for the web UI."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

StepDef = Tuple[str, str, int]

STEPS: List[StepDef] = [
    ("config", "Đọc cấu hình", 3),
    ("pronunciation", "Chấm điểm: WavLM + Transformer", 55),
    ("pronunciation_ckpt", "Checkpoint pronunciation.pt", 18),
    ("whisper_proc", "Whisper: tokenizer + processor", 8),
    ("whisper_model", "Whisper: tải weights (small.en)", 16),
]


@dataclass
class LoadStep:
    id: str
    label: str
    status: str = "pending"
    detail: str = ""


class LoadProgress:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._steps: Dict[str, LoadStep] = {
            sid: LoadStep(sid, label) for sid, label, _ in STEPS
        }
        self._weights = {sid: w for sid, _, w in STEPS}
        self._current: Optional[str] = None
        self._error: Optional[str] = None
        self._done = False
        self._running_since: Optional[float] = None

    def reset(self) -> None:
        with self._lock:
            for sid, label, _ in STEPS:
                self._steps[sid] = LoadStep(sid, label)
            self._current = None
            self._error = None
            self._done = False
            self._running_since = None

    def start(self, step_id: str, detail: str = "") -> None:
        with self._lock:
            step = self._steps[step_id]
            step.status = "running"
            step.detail = detail
            self._current = step_id
            self._running_since = time.monotonic()
            label = step.label
        msg = f"{label}" + (f" — {detail}" if detail else "")
        print(f"[load] ▶ {msg}", flush=True)

    def finish(self, step_id: str, detail: str = "") -> None:
        with self._lock:
            step = self._steps[step_id]
            step.status = "done"
            if detail:
                step.detail = detail
            if self._current == step_id:
                self._current = None
                self._running_since = None
            label = step.label
        print(f"[load] ✓ {label}", flush=True)

    def fail_running(self, error: str) -> None:
        with self._lock:
            step_id = self._current
        if step_id:
            self.fail(step_id, error)

    def fail(self, step_id: str, error: str) -> None:
        with self._lock:
            self._steps[step_id].status = "error"
            self._steps[step_id].detail = error
            self._error = error
            label = self._steps[step_id].label
        print(f"[load] ✕ {label}: {error}", flush=True)

    def complete(self) -> None:
        with self._lock:
            self._done = True
            self._current = None
        print("[load] ✓ Tất cả model sẵn sàng", flush=True)

    def to_dict(self) -> dict:
        with self._lock:
            total = sum(self._weights.values())
            earned = 0.0
            steps_out = []
            all_done = True
            for sid, label, weight in STEPS:
                s = self._steps[sid]
                steps_out.append({
                    "id": sid,
                    "label": label,
                    "status": s.status,
                    "detail": s.detail,
                })
                if s.status != "done":
                    all_done = False
                if s.status == "done":
                    earned += weight
                elif s.status == "running":
                    earned += weight * 0.35

            if self._done or all_done:
                percent = 100
            else:
                percent = int(min(98, round(earned / total * 100)))

            current = self._steps[self._current] if self._current else None
            elapsed_sec = None
            if self._running_since is not None:
                elapsed_sec = int(time.monotonic() - self._running_since)

            return {
                "percent": percent,
                "current": self._current,
                "current_label": current.label if current else None,
                "current_detail": current.detail if current else None,
                "elapsed_sec": elapsed_sec,
                "steps": steps_out,
                "done": self._done,
                "error": self._error,
            }


progress = LoadProgress()
