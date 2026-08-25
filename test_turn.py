import sys
sys.path.append('d:/SpeakAI-Eval')
from infer.pipeline import SpeakingPipeline
import json

pipeline = SpeakingPipeline(device='cuda')
audio = r'd:\SpeakAI-Eval\sample_audio\conversation_split\teacher_sentences\teacher_turn_000.wav'
transcript = "WAKE UP IT'S TIME FOR SCHOOL"
scores = pipeline.pronunciation.predict(audio, transcript, feedback=True)
print(json.dumps(scores, indent=2, ensure_ascii=False))
