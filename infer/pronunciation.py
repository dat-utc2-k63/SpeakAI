"""Pronunciation scoring inference (SpeechOcean762 model)."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

import torch
import yaml
from dotenv import load_dotenv

from data.audio_preprocess import PreprocessConfig, load_waveform, truncate_waveform
from data.cmudict import CMUDict
from models.checkpoint_utils import load_model_weights
from models.pronunciation_model import PronunciationAssessmentModel
from models.pronunciation_scorer import PronunciationScorer
from paths import PRONUNCIATION_CONFIG
from dotenv import load_dotenv

load_dotenv()


class Predictor:
    def __init__(
        self,
        config_path: str | Path | None = None,
        checkpoint: Optional[str] = None,
        device: Optional[str] = None,
        load_progress: Optional[Any] = None,
        model_step: str = "pronunciation",
        ckpt_step: str = "pronunciation_ckpt",
        wavlm_name: str = "microsoft/wavlm-large",
    ):
        config_path = Path(config_path or PRONUNCIATION_CONFIG)
        with open(config_path, encoding="utf-8") as f:
            self.config = yaml.safe_load(f)
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.preprocess = PreprocessConfig.from_dict(self.config.get("audio_preprocess"))
        if load_progress is not None:
            load_progress.start(model_step, wavlm_name)
        try:
            self.model = PronunciationAssessmentModel(self.config).to(self.device)
            if load_progress is not None:
                load_progress.finish(model_step)
                load_progress.start(ckpt_step, "pronunciation.pt")
            try:
                self._ckpt_path = load_model_weights(
                    self.model, self.config, model_kind="pronunciation", explicit=checkpoint, device=self.device
                )
            except FileNotFoundError as e:
                print(f"Warning: {e}")
                self._ckpt_path = None
            except Exception as exc:
                if load_progress is not None:
                    load_progress.fail(ckpt_step, str(exc))
                raise
            if load_progress is not None:
                load_progress.finish(ckpt_step, str(self._ckpt_path or "không có checkpoint"))
        except Exception as exc:
            if load_progress is not None:
                load_progress.fail(model_step, str(exc))
            raise
        self.model.eval()
        self.sr = self.preprocess.sample_rate
        inf = self.config.get("inference") or {}
        md = inf.get("max_duration_sec")
        if md is None and "max_duration_sec" not in inf:
            ds = self.config.get("train", {}).get("dataset", {})
            md = ds.get("max_duration_sec")
        self.max_duration_sec = None if md is None or md <= 0 else float(md)
        self.cmudict = CMUDict(self.config["paths"].get("cmudict_path"))
        mt = self.config["multitask"]
        self.scorer = PronunciationScorer(mt.get("score_scale", 2.0), self.config.get("scorer", {}).get("weights"))

    def _phones_from_text(self, text: str):
        groups = self.cmudict.words_to_phoneme_groups(text)
        tokens, words, ranges = [], [], []
        for g in groups:
            s = len(tokens)
            tokens.extend(g["phones"])
            words.append(g["word"])
            ranges.append((s, len(tokens)))
        return tokens, words, ranges

    @torch.no_grad()
    def predict(
        self,
        audio: str,
        transcript: str,
        feedback: bool = True,
        lang: Optional[str] = None,
        feedback_mode: str = "auto",
        truncate: bool = False,
        *,
        apply_preprocess: bool = True,
    ) -> Dict[str, Any]:
        wav = load_waveform(audio, self.preprocess, apply_preprocess=apply_preprocess)
        truncated = False
        if truncate and self.max_duration_sec:
            wav, truncated = truncate_waveform(wav, self.sr, self.max_duration_sec)
        tokens, words, ranges = self._phones_from_text(transcript)
        if not tokens:
            raise ValueError(
                f"Không tra được phoneme cho transcript (CMUdict): {transcript!r}"
            )
        out = self.model(
            wav.unsqueeze(0).to(self.device),
            torch.tensor([wav.shape[0]], device=self.device),
            [tokens],
            [ranges],
            return_alignments=True,
        )
        pred = out["predictions"][0]
        scores = self.scorer.aggregate_utterance(pred)
        scores["final"] = self.scorer.final_score(pred)
        alignments = [
            {
                "phoneme": a.phoneme,
                "start_frame": a.start_frame,
                "end_frame": a.end_frame,
                "confidence": a.confidence,
            }
            for a in (out.get("alignments") or [[]])[0]
        ]
        
        errors = self.scorer.find_errors(pred, tokens, words, ranges, alignments=alignments)
        result = {
            "transcript": transcript,
            "scores": scores,
            "errors": errors,
            "truncated": truncated,
            "max_duration_sec": self.max_duration_sec,
            "alignments": alignments,
            "feedback": None,
            "feedback_source": None,
        }
        if feedback:
            # Feedback is handled in the Colab notebook directly
            pass
        return result


def main():
    p = argparse.ArgumentParser(description="Pronunciation scoring only")
    p.add_argument("--audio", required=True)
    p.add_argument("--transcript", required=True)
    p.add_argument("--config", default=str(PRONUNCIATION_CONFIG))
    p.add_argument("--checkpoint", default=None)
    p.add_argument("--no-feedback", action="store_true")
    p.add_argument("--output", default=None)
    args = p.parse_args()
    r = Predictor(args.config, args.checkpoint).predict(args.audio, args.transcript, not args.no_feedback)
    text = json.dumps(r, ensure_ascii=False, indent=2)
    print(text)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
