"""Pronunciation scoring inference (SpeechOcean762 model + L2-MDD model)."""

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
from models.checkpoint_utils import load_model_weights, resolve_checkpoint
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
            ckpt_candidate = checkpoint
            if ckpt_candidate is None:
                try:
                    ckpt_candidate = resolve_checkpoint(self.config, model="pronunciation")
                except Exception:
                    ckpt_candidate = None

            if ckpt_candidate and os.path.isfile(ckpt_candidate):
                from models.checkpoint_utils import load_state_dict as _load_sd
                sd_sample = _load_sd(ckpt_candidate, "cpu")
                if any("lora" in k.lower() for k in sd_sample.keys()):
                    if "wavlm" not in self.config:
                        self.config["wavlm"] = {}
                    self.config["wavlm"]["use_lora"] = True
                    self.config["wavlm"].setdefault("lora_r", 8)
                    self.config["wavlm"].setdefault("lora_alpha", 16)
                    self.config["wavlm"].setdefault("lora_target_modules", ["q_proj", "v_proj"])

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
        scorer_cfg = self.config.get("scorer") or {}
        self.scorer = PronunciationScorer(
            score_scale=mt.get("score_scale", 5.0),
            weights=scorer_cfg.get("weights"),
            phoneme_low_threshold=scorer_cfg.get("phoneme_low_threshold", 1.4),
            calibration=scorer_cfg.get("calibration"),
        )

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
        duration_sec = float(wav.shape[0]) / float(self.sr) if self.sr else None
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
        scores = self.scorer.aggregate_utterance(pred, duration_sec=duration_sec)
        scores["final"] = self.scorer.final_score(pred, duration_sec=duration_sec)
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
        words_detail = self.scorer.build_words_detail(pred, tokens, words, ranges)
        result = {
            "transcript": transcript,
            "scores": scores,
            "errors": errors,
            "words_detail": words_detail,
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


class L2MDDPredictor:
    """Predictor using the L2-MDD checkpoint for full-phoneme scanning and ASHA clinical diagnosis."""

    def __init__(
        self,
        config_path: str | Path | None = None,
        checkpoint: Optional[str] = None,
        device: Optional[str] = None,
        load_progress: Optional[Any] = None,
        model_step: str = "l2_mdd",
        ckpt_step: str = "l2_mdd_ckpt",
    ):
        config_path = Path(config_path or PRONUNCIATION_CONFIG)
        with open(config_path, encoding="utf-8") as f:
            self.config = yaml.safe_load(f)
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.preprocess = PreprocessConfig.from_dict(self.config.get("audio_preprocess"))

        if load_progress is not None:
            load_progress.start(model_step, "L2-MDD Model")
        try:
            # Load WavLM model name with graceful fallback if path doesn't exist
            wavlm_cfg = self.config.get("wavlm", {})
            wavlm_name = wavlm_cfg.get("model_name", "microsoft/wavlm-large")
            if wavlm_name and not os.path.exists(wavlm_name):
                wavlm_name = "microsoft/wavlm-large"

            from models.l2_mdd_model import L2MDDModel
            from models.checkpoint_utils import load_state_dict as _load_sd

            ckpt_path = None
            sd = None
            use_lora = False
            try:
                ckpt_path = resolve_checkpoint(self.config, model="l2_mdd", explicit=checkpoint)
                if ckpt_path and os.path.isfile(ckpt_path):
                    sd = _load_sd(ckpt_path, self.device)
                    use_lora = any("lora" in k.lower() for k in sd.keys())
            except FileNotFoundError as e:
                print(f"Warning (L2-MDD): {e}")

            self.model = L2MDDModel(wavlm_name=wavlm_name, ff_dim=2048, use_lora=use_lora).to(self.device)

            if load_progress is not None:
                load_progress.finish(model_step)
                load_progress.start(ckpt_step, "l2_mdd_best.pt")

            if sd is not None:
                self.model.load_state_dict(sd, strict=False)
                self._ckpt_path = ckpt_path
            else:
                self._ckpt_path = None

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
        self.max_duration_sec = None if md is None or md <= 0 else float(md)
        self.cmudict = CMUDict(self.config["paths"].get("cmudict_path"))

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
    def scan_phonemes(
        self,
        audio: str,
        transcript: str,
        sensitivity: float = 0.25,
        apply_preprocess: bool = True,
    ) -> Dict[str, Any]:
        """Scan all phonemes in the utterance using L2-MDD and generate ASHA diagnoses."""
        wav = load_waveform(audio, self.preprocess, apply_preprocess=apply_preprocess)
        tokens, words, ranges = self._phones_from_text(transcript)
        if not tokens:
            return {
                "suspicious_phonemes": [],
                "all_phonemes": [],
                "num_suspicious": 0,
                "words": [],
                "word_ipas": [],
                "word_phone_ranges": [],
            }

        from models.pronunciation_scorer import phones_to_word_ipa
        word_ipas = [phones_to_word_ipa(tokens[s:e]) for s, e in ranges]

        res = self.model.scan_phonemes(
            waveform=wav.to(self.device),
            wav_length=torch.tensor([wav.shape[0]], device=self.device),
            phoneme_tokens=tokens,
            words=words,
            word_phone_ranges=ranges,
            word_ipas=word_ipas,
            sensitivity_threshold=sensitivity,
        )
        res["words"] = words
        res["word_ipas"] = word_ipas
        res["word_phone_ranges"] = ranges
        return res

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
        """Scan phonemes and package into standard evaluation result."""
        scan_res = self.scan_phonemes(audio, transcript, apply_preprocess=apply_preprocess)
        suspicious = scan_res.get("suspicious_phonemes", [])
        all_phones = scan_res.get("all_phonemes", [])
        words = scan_res.get("words", [])
        word_ipas = scan_res.get("word_ipas", [])
        ranges = scan_res.get("word_phone_ranges", [])

        # Build words_detail directly and exclusively from L2-MDD phoneme scan (SpeechOcean never sets word status)
        words_detail = []
        for w_idx, (ws, we) in enumerate(ranges):
            w_text = words[w_idx] if w_idx < len(words) else ""
            w_ipa = word_ipas[w_idx] if w_idx < len(word_ipas) else ""
            w_phones = all_phones[ws:we] if ws < we and we <= len(all_phones) else []

            phones_list = []
            w_has_err = False
            w_has_crit = False
            for ph in w_phones:
                is_susp = ph.get("is_suspicious", False)
                is_crit = is_susp and ph.get("severity") in ("critical", "bad")
                p_status = "bad" if is_crit else ("warning" if is_susp else "good")
                if is_susp:
                    w_has_err = True
                if is_crit:
                    w_has_crit = True
                phones_list.append({
                    "phoneme": ph.get("target_phone", ""),
                    "ipa": ph.get("target_ipa", ""),
                    "actual_ipa": ph.get("actual_ipa", ""),
                    "status": p_status,
                    "tip": ph.get("articulatory_tip", ""),
                    "rule_name_vi": ph.get("rule_name_vi", ""),
                })

            w_status = "bad" if w_has_crit else ("warning" if w_has_err else "good")
            words_detail.append({
                "word": w_text,
                "word_ipa": w_ipa,
                "status": w_status,
                "phonemes": phones_list,
            })

        # Build errors dict formatted for downstream use
        errors = {
            "phonemes": suspicious,
            "words": [],
        }

        # Collect unique suspicious words with their diagnostic notes
        seen_words = set()
        for p in suspicious:
            w_text = p.get("word")
            if w_text and w_text not in seen_words:
                seen_words.add(w_text)
                errors["words"].append({
                    "word": w_text,
                    "word_ipa": p.get("word_ipa", ""),
                    "severity": p.get("severity", "warning"),
                    "rule_name_vi": p.get("rule_name_vi", ""),
                    "articulatory_tip": p.get("articulatory_tip", ""),
                })

        return {
            "transcript": transcript,
            "errors": errors,
            "words_detail": words_detail,
            "scan_result": scan_res,
            "num_suspicious": scan_res.get("num_suspicious", 0),
            "feedback": None,
            "feedback_source": "l2_mdd_asha",
        }


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
