"""Online 2-speaker clustering with EMA centroid updates."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

DEFAULT_THRESHOLD = 0.25  # SpeechBrain cosine-distance verification default


@dataclass
class ClusterAssignment:
    speaker: str
    confidence: float
    calibrating: bool


class TwoSpeakerClusterer:
    """Assign embeddings to Speaker A / B with online centroid updates."""

    def __init__(
        self,
        num_speakers: int = 2,
        threshold: float = DEFAULT_THRESHOLD,
        ema_alpha: float = 0.15,
        min_separation: float = 0.15,
    ) -> None:
        if num_speakers != 2:
            raise ValueError("Only 2-speaker mode is supported")
        self.threshold = threshold
        self.ema_alpha = ema_alpha
        self.min_separation = min_separation
        self._centroids: list[np.ndarray | None] = [None, None]
        self._labels = ["Speaker A", "Speaker B"]
        self._pending: list[np.ndarray] = []
        self._calibrated = False

    @property
    def calibrating(self) -> bool:
        return not self._calibrated

    def assign(self, embedding: np.ndarray) -> ClusterAssignment:
        emb = self._normalize(embedding)

        if not self._calibrated:
            return self._calibrate(emb)

        sim_a = float(np.dot(emb, self._centroids[0]))
        sim_b = float(np.dot(emb, self._centroids[1]))
        dist_a = 1.0 - sim_a
        dist_b = 1.0 - sim_b

        if dist_a <= dist_b:
            idx, confidence = 0, 1.0 - dist_a
        else:
            idx, confidence = 1, 1.0 - dist_b

        self._update_centroid(idx, emb)
        return ClusterAssignment(
            speaker=self._labels[idx],
            confidence=float(np.clip(confidence, 0.0, 1.0)),
            calibrating=False,
        )

    def _calibrate(self, emb: np.ndarray) -> ClusterAssignment:
        self._pending.append(emb)

        if self._centroids[0] is None:
            self._centroids[0] = emb.copy()
            return ClusterAssignment(speaker="calibrating", confidence=0.0, calibrating=True)

        dist_to_a = 1.0 - float(np.dot(emb, self._centroids[0]))
        if dist_to_a > self.threshold and self._centroids[1] is None:
            self._centroids[1] = emb.copy()
            if self._centroid_distance() >= self.min_separation:
                self._calibrated = True
            return ClusterAssignment(speaker="calibrating", confidence=0.0, calibrating=True)

        idx = 0 if dist_to_a <= self.threshold else 1
        if self._centroids[idx] is None:
            self._centroids[idx] = emb.copy()
        else:
            self._update_centroid(idx, emb)

        if self._centroids[0] is not None and self._centroids[1] is not None:
            if self._centroid_distance() >= self.min_separation:
                self._calibrated = True
                sim_a = float(np.dot(emb, self._centroids[0]))
                sim_b = float(np.dot(emb, self._centroids[1]))
                if sim_a >= sim_b:
                    return ClusterAssignment(speaker=self._labels[0], confidence=sim_a, calibrating=False)
                return ClusterAssignment(speaker=self._labels[1], confidence=sim_b, calibrating=False)

        return ClusterAssignment(speaker="calibrating", confidence=0.0, calibrating=True)

    def _centroid_distance(self) -> float:
        if self._centroids[0] is None or self._centroids[1] is None:
            return 0.0
        return 1.0 - float(np.dot(self._centroids[0], self._centroids[1]))

    def _update_centroid(self, idx: int, emb: np.ndarray) -> None:
        current = self._centroids[idx]
        if current is None:
            self._centroids[idx] = emb.copy()
            return
        updated = (1.0 - self.ema_alpha) * current + self.ema_alpha * emb
        self._centroids[idx] = self._normalize(updated)

    @staticmethod
    def _normalize(vec: np.ndarray) -> np.ndarray:
        norm = np.linalg.norm(vec)
        if norm == 0:
            return vec.astype(np.float32)
        return (vec / norm).astype(np.float32)


def batch_cluster_two(embeddings: list[np.ndarray]) -> list[int]:
    """Assign N embeddings to cluster 0 or 1 (Speaker A / B)."""
    if not embeddings:
        return []
    if len(embeddings) == 1:
        return [0]

    embs = np.stack([TwoSpeakerClusterer._normalize(e) for e in embeddings])
    # Seed: first embedding + furthest from it
    sims = embs @ embs[0]
    seed_b = int(np.argmin(sims))
    centers = np.stack([embs[0], embs[seed_b]])

    for _ in range(5):
        labels = []
        for e in embs:
            labels.append(0 if float(centers[0] @ e) >= float(centers[1] @ e) else 1)
        labels_arr = np.array(labels)
        for k in (0, 1):
            members = embs[labels_arr == k]
            if len(members) > 0:
                c = members.mean(axis=0)
                norm = np.linalg.norm(c)
                if norm > 0:
                    centers[k] = c / norm

    return labels
