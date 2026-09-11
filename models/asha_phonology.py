"""
ASHA Phonological Processes & Distinctive Articulatory Features Engine.

Based on standards from the American Speech-Language-Hearing Association (ASHA)
and International Phonetic Alphabet (IPA) articulatory dimensions:
  1. Place of Articulation (Vị trí cấu âm)
  2. Manner of Articulation (Phương thức cấu âm)
  3. Voicing / Phonation (Độ rung dây thanh quản)
  4. Vowel Features: Height, Backness, Tenseness, Rounding
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class ArticulatoryFeatures:
    phoneme: str          # ARPAbet (e.g. 'TH', 'DH', 'AA1')
    ipa: str              # Standard IPA symbol (e.g. 'θ', 'ð', 'ɑː')
    is_vowel: bool
    name_vi: str          # Descriptive Vietnamese name
    place: str            # bilabial, labiodental, dental, alveolar, postalveolar, palatal, velar, glottal
    manner: str           # stop, fricative, affricate, nasal, liquid, glide, vowel
    voicing: str          # voiced, voiceless
    vowel_height: Optional[str] = None      # high, mid-high, mid, low
    vowel_backness: Optional[str] = None    # front, central, back
    vowel_tense: Optional[bool] = None      # True=tense, False=lax
    vowel_rounded: Optional[bool] = None    # True=rounded, False=unrounded


# ── Comprehensive Articulatory Database for ARPAbet Phonemes ────────
PHONEME_FEATURES: Dict[str, ArticulatoryFeatures] = {
    # ── Consonants ──────────────────────────────────────────────
    "P": ArticulatoryFeatures("P", "p", False, "Âm bật môi - vô thanh", "bilabial", "stop", "voiceless"),
    "B": ArticulatoryFeatures("B", "b", False, "Âm bật môi - hữu thanh", "bilabial", "stop", "voiced"),
    "T": ArticulatoryFeatures("T", "t", False, "Âm bật nướu - vô thanh", "alveolar", "stop", "voiceless"),
    "D": ArticulatoryFeatures("D", "d", False, "Âm bật nướu - hữu thanh", "alveolar", "stop", "voiced"),
    "K": ArticulatoryFeatures("K", "k", False, "Âm bật ngạc mềm - vô thanh", "velar", "stop", "voiceless"),
    "G": ArticulatoryFeatures("G", "ɡ", False, "Âm bật ngạc mềm - hữu thanh", "velar", "stop", "voiced"),
    "F": ArticulatoryFeatures("F", "f", False, "Âm xát răng môi - vô thanh", "labiodental", "fricative", "voiceless"),
    "V": ArticulatoryFeatures("V", "v", False, "Âm xát răng môi - hữu thanh", "labiodental", "fricative", "voiced"),
    "TH": ArticulatoryFeatures("TH", "θ", False, "Âm xát liên răng - vô thanh", "dental", "fricative", "voiceless"),
    "DH": ArticulatoryFeatures("DH", "ð", False, "Âm xát liên răng - hữu thanh", "dental", "fricative", "voiced"),
    "S": ArticulatoryFeatures("S", "s", False, "Âm xát rãnh nướu - vô thanh", "alveolar", "fricative", "voiceless"),
    "Z": ArticulatoryFeatures("Z", "z", False, "Âm xát rãnh nướu - hữu thanh", "alveolar", "fricative", "voiced"),
    "SH": ArticulatoryFeatures("SH", "ʃ", False, "Âm xát sau nướu - vô thanh", "postalveolar", "fricative", "voiceless"),
    "ZH": ArticulatoryFeatures("ZH", "ʒ", False, "Âm xát sau nướu - hữu thanh", "postalveolar", "fricative", "voiced"),
    "CH": ArticulatoryFeatures("CH", "tʃ", False, "Âm tắc - xát vòm nướu vô thanh", "postalveolar", "affricate", "voiceless"),
    "JH": ArticulatoryFeatures("JH", "dʒ", False, "Âm tắc - xát vòm nướu hữu thanh", "postalveolar", "affricate", "voiced"),
    "M": ArticulatoryFeatures("M", "m", False, "Âm mũi hai môi - hữu thanh", "bilabial", "nasal", "voiced"),
    "N": ArticulatoryFeatures("N", "n", False, "Âm mũi chân răng - hữu thanh", "alveolar", "nasal", "voiced"),
    "NG": ArticulatoryFeatures("NG", "ŋ", False, "Âm mũi ngạc mềm - hữu thanh", "velar", "nasal", "voiced"),
    "L": ArticulatoryFeatures("L", "l", False, "Âm ngạc bên (liquid) - hữu thanh", "alveolar", "liquid", "voiced"),
    "R": ArticulatoryFeatures("R", "r", False, "Âm uốn lưỡi (liquid) - hữu thanh", "postalveolar", "liquid", "voiced"),
    "W": ArticulatoryFeatures("W", "w", False, "Âm lướt tròn môi ngạc mềm", "velar", "glide", "voiced"),
    "Y": ArticulatoryFeatures("Y", "j", False, "Âm lướt vòm cứng", "palatal", "glide", "voiced"),
    "HH": ArticulatoryFeatures("HH", "h", False, "Âm xát thanh môn - vô thanh", "glottal", "fricative", "voiceless"),

    # ── Vowels ──────────────────────────────────────────────────
    "IY": ArticulatoryFeatures("IY", "iː", True, "Nguyên âm trước - cao căng", "palatal", "vowel", "voiced", "high", "front", True, False),
    "IH": ArticulatoryFeatures("IH", "ɪ", True, "Nguyên âm trước - cao lỏng", "palatal", "vowel", "voiced", "high", "front", False, False),
    "EY": ArticulatoryFeatures("EY", "eɪ", True, "Nguyên âm đôi trước - đóng", "palatal", "vowel", "voiced", "mid-high", "front", True, False),
    "EH": ArticulatoryFeatures("EH", "e", True, "Nguyên âm trước - trung bình mở", "palatal", "vowel", "voiced", "mid", "front", False, False),
    "AE": ArticulatoryFeatures("AE", "æ", True, "Nguyên âm trước - thấp bẹt", "alveolar", "vowel", "voiced", "low", "front", False, False),
    "AA": ArticulatoryFeatures("AA", "ɑː", True, "Nguyên âm sau - thấp mở rộng", "velar", "vowel", "voiced", "low", "back", True, False),
    "AO": ArticulatoryFeatures("AO", "ɔː", True, "Nguyên âm sau - trung bình tròn môi", "velar", "vowel", "voiced", "mid", "back", True, True),
    "OW": ArticulatoryFeatures("OW", "oʊ", True, "Nguyên âm đôi sau - đóng tròn môi", "velar", "vowel", "voiced", "mid-high", "back", True, True),
    "UH": ArticulatoryFeatures("UH", "ʊ", True, "Nguyên âm sau - cao lỏng tròn môi", "velar", "vowel", "voiced", "high", "back", False, True),
    "UW": ArticulatoryFeatures("UW", "uː", True, "Nguyên âm sau - cao căng tròn môi", "velar", "vowel", "voiced", "high", "back", True, True),
    "AH": ArticulatoryFeatures("AH", "ʌ", True, "Nguyên âm giữa - thấp trung tính", "central", "vowel", "voiced", "mid-low", "central", False, False),
    "AX": ArticulatoryFeatures("AX", "ə", True, "Nguyên âm lướt Schwa trung tính", "central", "vowel", "voiced", "mid", "central", False, False),
    "ER": ArticulatoryFeatures("ER", "ɜːr", True, "Nguyên âm giữa uốn lưỡi", "postalveolar", "vowel", "voiced", "mid", "central", True, False),
    "AY": ArticulatoryFeatures("AY", "aɪ", True, "Nguyên âm đôi mở -> cao", "central", "vowel", "voiced", "low", "front", True, False),
    "AW": ArticulatoryFeatures("AW", "aʊ", True, "Nguyên âm đôi mở -> tròn môi", "central", "vowel", "voiced", "low", "back", True, True),
    "OY": ArticulatoryFeatures("OY", "ɔɪ", True, "Nguyên âm đôi sau -> trước", "velar", "vowel", "voiced", "mid", "front", True, True),
}


def get_features(phoneme: str) -> Optional[ArticulatoryFeatures]:
    """Retrieve features for any phoneme, stripping stress numbers."""
    if not phoneme:
        return None
    cleaned = phoneme.strip().upper()
    base = cleaned.rstrip("012")
    if base in PHONEME_FEATURES:
        return PHONEME_FEATURES[base]
    # Fallback to IPA lookup if given an IPA glyph directly
    for feat in PHONEME_FEATURES.values():
        if feat.ipa == phoneme or feat.phoneme == cleaned:
            return feat
    return None


@dataclass
class ASHADiagnosis:
    rule_id: str                      # Standard ASHA code e.g. 'stopping', 'devoicing'
    rule_name_vi: str                 # Tên quy tắc tiếng Việt
    rule_name_en: str                 # ASHA English Name
    severity: str                     # 'critical', 'warning', 'minor'
    target_ipa: str                   # e.g. '/θ/'
    actual_ipa: str                   # e.g. '/t/'
    feature_contrast: str             # So sánh đặc tính cấu âm đối lập
    articulatory_tip: str             # Hướng dẫn định vị cơ quan cấu âm chuẩn


class ASHAPhonologicalAnalyzer:
    """ASHA Clinical Phonological Diagnostic Engine."""

    @classmethod
    def diagnose(
        cls,
        target_phone: str,
        actual_phone: str,
        mdd_class: str = "substitution",
        is_word_final: bool = False,
        in_cluster: bool = False,
        word: str = "",
    ) -> ASHADiagnosis:
        """Diagnose a pronunciation error using ASHA rules and distinctive features."""
        target_feat = get_features(target_phone)
        target_ipa = f"/{target_feat.ipa}/" if target_feat else f"/{target_phone}/"

        # ── 1. Deletion Cases (ASHA Syllable Structure Processes) ──
        if mdd_class.lower() == "deletion" or actual_phone in ("[DELETION]", "[DEL]", "sil", ""):
            if is_word_final:
                return ASHADiagnosis(
                    rule_id="final_consonant_deletion",
                    rule_name_vi="Nuốt phụ âm cuối (Final Consonant Deletion)",
                    rule_name_en="Final Consonant Deletion (FCD)",
                    severity="critical",
                    target_ipa=target_ipa,
                    actual_ipa="[Bị nuốt / Bỏ qua]",
                    feature_contrast=f"Target: {target_feat.name_vi if target_feat else target_phone} -> Actual: Hoàn toàn bị lược bỏ âm đuôi",
                    articulatory_tip="Tiếng Anh bắt buộc phát âm dứt khoát âm cuối từ. Hãy hoàn thành cử động đóng cơ quan cấu âm (ngậm môi, chạm đầu lưỡi hoặc thổi xát hơi) trước khi chuyển sang từ tiếp theo.",
                )
            if in_cluster:
                return ASHADiagnosis(
                    rule_id="cluster_reduction",
                    rule_name_vi="Rút gọn tổ hợp phụ âm (Cluster Reduction)",
                    rule_name_en="Consonant Cluster Reduction",
                    severity="warning",
                    target_ipa=target_ipa,
                    actual_ipa="[Bị nuốt trong cụm]",
                    feature_contrast=f"Target: {target_feat.name_vi if target_feat else target_phone} bị bỏ qua trong chuỗi phụ âm liền kề",
                    articulatory_tip="Hãy tách chậm cụm phụ âm thành các âm đơn lẻ, tập chuyển đổi khẩu hình liên hoàn rồi mới tăng dần tốc độ để không bị rơi mất âm.",
                )
            return ASHADiagnosis(
                rule_id="omission",
                rule_name_vi="Nuốt âm / Bỏ sót âm vị (Omission)",
                rule_name_en="Sound Omission",
                severity="warning",
                target_ipa=target_ipa,
                actual_ipa="[Bỏ qua]",
                feature_contrast=f"Target: {target_feat.name_vi if target_feat else target_phone} không được cấu âm",
                articulatory_tip="Hãy chú ý phát âm đủ tất cả các âm tiết trong từ, tránh vội vã lướt qua các âm vị trọng tâm.",
            )

        # ── 2. Addition Cases ──────────────────────────────────────
        if mdd_class.lower() == "addition" or actual_phone in ("[ADDITION]", "[ADD]"):
            return ASHADiagnosis(
                rule_id="epenthesis",
                rule_name_vi="Chêm âm thừa (Epenthesis)",
                rule_name_en="Epenthesis / Vowel Addition",
                severity="minor",
                target_ipa=target_ipa,
                actual_ipa="[Âm chêm thừa]",
                feature_contrast="Xuất hiện thêm âm lướt / schwa không có trong cấu trúc từ chuẩn",
                articulatory_tip="Không thêm nguyên âm /ə/ (ơ) vào giữa các cụm phụ âm hoặc sau các âm đuôi. Dứt khoát dừng hơi ngay khi phụ âm kết thúc.",
            )

        # ── 3. Substitution Cases (Articulatory Contrast) ──────────
        actual_feat = get_features(actual_phone)
        actual_ipa = f"/{actual_feat.ipa}/" if actual_feat else f"/{actual_phone}/"

        if not target_feat or not actual_feat:
            return ASHADiagnosis(
                rule_id="substitution_generic",
                rule_name_vi="Thay thế âm vị (Sound Substitution)",
                rule_name_en="Phoneme Substitution",
                severity="warning",
                target_ipa=target_ipa,
                actual_ipa=actual_ipa,
                feature_contrast=f"Phát âm lệch từ {target_ipa} sang {actual_ipa}",
                articulatory_tip=f"Luyện tập phát âm đối chiếu giữa âm chuẩn {target_ipa} và âm nhầm lẫn {actual_ipa}.",
            )

        # Rule 3.1: Interdental Dentalization (θ, ð -> s, z, f, v, t, d)
        if target_feat.place == "dental" and actual_feat.place != "dental":
            if actual_feat.manner == "stop":
                return ASHADiagnosis(
                    rule_id="dental_stopping",
                    rule_name_vi="Thay âm liên răng bằng âm tắc (Dental Stopping)",
                    rule_name_en="Interdental Stopping",
                    severity="critical",
                    target_ipa=target_ipa,
                    actual_ipa=actual_ipa,
                    feature_contrast=f"Target: Âm xát liên răng ({target_feat.place}/{target_feat.manner}) -> Actual: Bị chặn thành âm tắc ({actual_feat.place}/{actual_feat.manner})",
                    articulatory_tip=f"Đặt nhẹ đầu lưỡi ở giữa hai rìa răng cửa trên và dưới. Thổi luồng hơi liên tục qua khe răng - lưỡi (không dùng đầu lưỡi chặn đứng dòng khí như âm {actual_ipa}).",
                )
            return ASHADiagnosis(
                rule_id="dentalization_substitution",
                rule_name_vi="Sai vị trí liên răng (Interdental Substitution)",
                rule_name_en="Interdental Substitution / Dentalization",
                severity="critical",
                target_ipa=target_ipa,
                actual_ipa=actual_ipa,
                feature_contrast=f"Target: Âm liên răng ({target_feat.place}) -> Actual: Đặt sai vị trí tại ({actual_feat.place})",
                articulatory_tip=f"Đầu lưỡi phải đưa ra ngoài giữa hai hàm răng. Tuyệt đối không thụt lưỡi vào chân răng tạo âm /s, z/ hoặc cắn môi dưới tạo âm /f, v/.",
            )

        # Rule 3.2: Stopping (Fricative/Affricate -> Stop)
        if target_feat.manner in ("fricative", "affricate") and actual_feat.manner == "stop":
            return ASHADiagnosis(
                rule_id="stopping",
                rule_name_vi="Thay âm xát bằng âm tắc (Stopping)",
                rule_name_en="Stopping of Fricatives/Affricates",
                severity="critical",
                target_ipa=target_ipa,
                actual_ipa=actual_ipa,
                feature_contrast=f"Target: Âm xát luồng hơi liên tục ({target_feat.manner}) -> Actual: Luồng khí bị chặn hoàn toàn ({actual_feat.manner})",
                articulatory_tip=f"Giữ khoảng hở hẹp giữa cơ quan cấu âm để luồng hơi thoát ra đều đặn tạo tiếng xì xát liên tục, không ngậm chặt môi/lưỡi chặn đứng hơi.",
            )

        # Rule 3.3: Devoicing (Final or Medial Consonant Devoicing)
        if target_feat.voicing == "voiced" and actual_feat.voicing == "voiceless":
            loc = "cuối từ" if is_word_final else ""
            return ASHADiagnosis(
                rule_id="devoicing",
                rule_name_vi=f"Mất âm hữu thanh {loc} (Devoicing)",
                rule_name_en="Consonant Devoicing",
                severity="warning",
                target_ipa=target_ipa,
                actual_ipa=actual_ipa,
                feature_contrast=f"Target: Dây thanh rung ({target_feat.voicing}) -> Actual: Mất rung ({actual_feat.voicing})",
                articulatory_tip="Đặt 2 ngón tay lên hõm cổ họng / thanh quản, chủ động duy trì độ rung của dây thanh quản cho đến khi dứt hẳn âm, tránh để âm bị xì hơi vô thanh.",
            )

        # Rule 3.4: Voicing (Voiceless -> Voiced)
        if target_feat.voicing == "voiceless" and actual_feat.voicing == "voiced":
            return ASHADiagnosis(
                rule_id="voicing",
                rule_name_vi="Hữu thanh hóa (Voicing)",
                rule_name_en="Pre-vocalic Voicing",
                severity="minor",
                target_ipa=target_ipa,
                actual_ipa=actual_ipa,
                feature_contrast=f"Target: Vô thanh bật hơi ({target_feat.voicing}) -> Actual: Rung thanh quản quá sớm ({actual_feat.voicing})",
                articulatory_tip="Dùng luồng hơi thuần túy từ phổi bật ra mà không rung dây thanh quản ở giai đoạn đầu của âm.",
            )

        # Rule 3.5: Velar / Palatal Fronting (Velar/Postalveolar -> Alveolar)
        if target_feat.place in ("velar", "postalveolar", "palatal") and actual_feat.place in ("alveolar", "dental", "bilabial"):
            return ASHADiagnosis(
                rule_id="fronting",
                rule_name_vi="Đưa âm ra trước vòm họng (Fronting)",
                rule_name_en="Velar / Palatal Fronting",
                severity="warning",
                target_ipa=target_ipa,
                actual_ipa=actual_ipa,
                feature_contrast=f"Target: Cấu âm tại ngạc sâu ({target_feat.place}) -> Actual: Bị đẩy ra phía trước răng ({actual_feat.place})",
                articulatory_tip="Hạ đầu lưỡi xuống sàn miệng, nâng phần cuống lưỡi / gốc lưỡi chạm vào ngạc mềm phía sau vòm họng để tạo âm vang sâu.",
            )

        # Rule 3.6: Gliding of Liquids (r, l -> w, j)
        if target_feat.manner == "liquid" and actual_feat.manner == "glide":
            return ASHADiagnosis(
                rule_id="gliding",
                rule_name_vi="Biến âm lỏng thành âm lướt (Gliding of Liquids)",
                rule_name_en="Gliding of Liquids",
                severity="warning",
                target_ipa=target_ipa,
                actual_ipa=actual_ipa,
                feature_contrast=f"Target: Âm uốn/bên ({target_feat.manner}) -> Actual: Chu môi thành âm lướt ({actual_feat.manner})",
                articulatory_tip=f"Không chu tròn môi như âm /w/. Giữ khóe miệng tự nhiên, uốn cong đầu lưỡi lên vòm họng (đối với /r/) hoặc chạm đầu lưỡi vào chân răng cửa trên (đối với /l/).",
            )

        # Rule 3.7: Deaffrication (tʃ, dʒ -> ʃ, s, t)
        if target_feat.manner == "affricate" and actual_feat.manner != "affricate":
            return ASHADiagnosis(
                rule_id="deaffrication",
                rule_name_vi="Mất tính chất tắc - xát (Deaffrication)",
                rule_name_en="Deaffrication",
                severity="warning",
                target_ipa=target_ipa,
                actual_ipa=actual_ipa,
                feature_contrast=f"Target: Âm kết hợp vừa chặn vừa xát ({target_feat.manner}) -> Actual: Chỉ còn âm đơn ({actual_feat.manner})",
                articulatory_tip="Cần thực hiện đủ 2 pha: (1) Ép đầu lưỡi chặn hơi tại nướu trên, (2) Bật hé lưỡi tạo luồng gió xát mạnh mẽ dứt khoát.",
            )

        # Rule 3.8: Vowel Tense vs Lax Confusion (i: vs ɪ, u: vs ʊ)
        if target_feat.is_vowel and actual_feat.is_vowel:
            if target_feat.vowel_tense != actual_feat.vowel_tense:
                tense_state = "Căng (Tense)" if target_feat.vowel_tense else "Lỏng/Ngắn (Lax)"
                actual_state = "Căng (Tense)" if actual_feat.vowel_tense else "Lỏng/Ngắn (Lax)"
                return ASHADiagnosis(
                    rule_id="vowel_tenseness",
                    rule_name_vi="Nhầm lẫn nguyên âm căng và lỏng (Vowel Tenseness)",
                    rule_name_en="Vowel Tenseness / Centralization",
                    severity="warning",
                    target_ipa=target_ipa,
                    actual_ipa=actual_ipa,
                    feature_contrast=f"Target: Nguyên âm {tense_state} -> Actual: Nguyên âm {actual_state}",
                    articulatory_tip="Điều chỉnh độ căng của cơ má và khóe miệng: Nguyên âm căng đòi hỏi căng cơ má và kéo dài âm; nguyên âm lỏng thả lỏng cơ miệng và phát âm dứt khoát ngắn hơn.",
                )

        # Default fallback contrast
        return ASHADiagnosis(
            rule_id="substitution_contrast",
            rule_name_vi="Lệch đặc tính cấu âm (Articulatory Deviation)",
            rule_name_en="Articulatory Feature Deviation",
            severity="warning",
            target_ipa=target_ipa,
            actual_ipa=actual_ipa,
            feature_contrast=f"Target: [{target_feat.place}, {target_feat.manner}, {target_feat.voicing}] -> Actual: [{actual_feat.place}, {actual_feat.manner}, {actual_feat.voicing}]",
            articulatory_tip=f"Chú ý căn chỉnh lại khẩu hình từ {actual_ipa} về âm chuẩn {target_ipa} ({target_feat.name_vi}).",
        )
