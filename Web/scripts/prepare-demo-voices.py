"""Generate reproducible, synthetic acoustic fixtures using installed macOS voices."""
import argparse, hashlib, json, pathlib, subprocess, wave
root = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--suite', choices=['algebra', 'graph-geometry'], default='algebra')
parser.add_argument('--case', action='append', default=[])
args = parser.parse_args()
output = root / 'public' / 'demo-voices'
if args.suite == 'graph-geometry': output = output / args.suite
output.mkdir(parents=True, exist_ok=True)
commands = [
 ('equation', 'Write two x plus three equals eleven.', 'write 2*x + 3 = 11'),
 ('step', 'Subtract three from both sides.', 'subtract 3 from both sides'),
 ('median', 'Find the median of two, four, eight, ten.', 'median of 2, 4, 8, 10'),
 ('outliers', 'Find outliers.', 'find outliers'),
]
if args.suite == 'graph-geometry':
 cases = json.loads((root / '../Evals/inputs/recorded-graph-geometry/cases.json').read_text())
 commands = [(c['id'], c['transcript'], c['expectedCommand']) for c in cases]
if args.case: commands = [c for c in commands if c[0] in args.case]
manifest = output / 'manifest.json'
rows = json.loads(manifest.read_text()) if args.case and manifest.exists() else []
for voice in ['Daniel', 'Karen', 'Rishi']:
 for case, transcript, command in commands:
  filename = f'{voice.lower()}-{case}.wav'
  path = output / filename
  temporary = path.with_suffix('.tmp.wav')
  subprocess.run(['say', '-v', voice, '-r', '150', '-o', str(temporary), '--file-format=WAVE', '--data-format=LEI16@22050', transcript], check=True)
  with wave.open(str(temporary)) as audio:
   duration = audio.getnframes() / audio.getframerate()
   if duration < 0.5:
    raise RuntimeError(f'{filename} is empty or too short; regenerate with access to macOS speech services.')
  temporary.replace(path)
  rows = [r for r in rows if r['audio'] != '/demo-voices/' + ('graph-geometry/' if args.suite == 'graph-geometry' else '') + filename]
  rows.append({'voice':voice, 'case':case, 'transcript':transcript, 'expectedCommand':command,
   'audio':'/demo-voices/' + ('graph-geometry/' if args.suite == 'graph-geometry' else '') + filename, 'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
   'source':'macOS installed speech synthesis', 'durationSeconds':round(duration,3), 'recognitionStatus':'not-tested'})
(output / 'manifest.json').write_text(json.dumps(rows, indent=2) + '\n')
print(f'Generated {len(rows)} recorded synthetic clips. Microphone recognition remains untested.')
