"""Offline acoustic evaluation; never sends recorded audio to an API."""
import argparse, hashlib, json, pathlib, time
import torch
import whisper
parser = argparse.ArgumentParser()
parser.add_argument('--manifest', default='public/demo-voices/graph-geometry/manifest.json')
parser.add_argument('--output', default='../Evals/inputs/recorded-graph-geometry/transcripts.json')
parser.add_argument('--model', default='base.en')
parser.add_argument('--model-cache', default='/tmp/math-audio-whisper-models')
parser.add_argument('--resume', action='store_true')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
torch.set_num_threads(4)
model = whisper.load_model(args.model, download_root=args.model_cache, device='cpu')
manifest = json.loads((root / args.manifest).read_text())
previous = {}
if args.resume and (root / args.output).exists():
    report = json.loads((root / args.output).read_text())
    if report['recognizer'] != 'OpenAI Whisper local '+args.model: raise ValueError('Resume requires the same recognition model')
    previous = {r['sha256']:r for r in report['clips']}
rows = []
for clip in manifest:
    path = root / 'public' / clip['audio'].lstrip('/')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != clip['sha256']: raise ValueError('Recording checksum changed: ' + clip['audio'])
    if digest in previous:
        rows.append({**previous[digest], 'voice':clip['voice'], 'case':clip['case'], 'audio':clip['audio']})
        continue
    start = time.monotonic()
    # No reference text or expected command is given to the recognizer.
    result = model.transcribe(str(path), language='en', temperature=0, fp16=False, condition_on_previous_text=False)
    rows.append({'voice':clip['voice'], 'case':clip['case'], 'audio':clip['audio'], 'sha256':digest,
                 'transcript':result['text'].strip(), 'durationSeconds':clip['durationSeconds'],
                 'latencySeconds':round(time.monotonic()-start,3)})
    print(f"{clip['voice']} {clip['case']}: {result['text'].strip()}", flush=True)
    report = {'recognizer':'OpenAI Whisper local '+args.model, 'whisperVersion':whisper.__version__,
              'device':'cpu', 'language':'en', 'temperature':0, 'prompt':None,
              'scope':'Synthetic recordings through local ASR, not browser microphone or GPT Live.', 'clips':rows}
    (root / args.output).write_text(json.dumps(report,indent=2)+'\n')
