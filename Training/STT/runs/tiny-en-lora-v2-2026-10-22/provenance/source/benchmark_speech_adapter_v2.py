"""Compare warm base/adapter generation in interleaved order on fixed validation clips."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import time

ROOT=Path(__file__).resolve().parents[3]


def main(directory):
    """Measure local generation only, without changing weights or selecting checkpoints.

    Two fixed unique validation clips per category run in base/adapter then
    adapter/base order. Model load, features and warm-up are excluded. Output length
    is recorded because different transcripts require different decoder work.
    """
    import torch
    import soundfile as sf
    from transformers import WhisperProcessor, WhisperForConditionalGeneration
    from peft import PeftModel
    directory=Path(directory)
    report=json.loads((directory/'report.json').read_text())
    split=json.loads((ROOT/'Training/STT/splits/student-speech-v2.json').read_text())
    selected=[]
    counts={}
    seen=set()
    for row in split['clips']['val']:
        key=' '.join(__import__('speech_normalization').normalize_tokens(row['reference']))
        if key in seen or counts.get(row['category'],0)>=2:
            continue
        seen.add(key);counts[row['category']]=counts.get(row['category'],0)+1;selected.append(row)
    torch.set_num_threads(4)
    config=report['config']
    processor=WhisperProcessor.from_pretrained(config['model'],revision=config['revision'],local_files_only=True)
    base=WhisperForConditionalGeneration.from_pretrained(config['model'],revision=config['revision'],local_files_only=True,attn_implementation='eager')
    model=PeftModel.from_pretrained(base,directory/'adapter').to('mps').eval()
    features={}
    for row in selected:
        path=ROOT/row['audio']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('Validation waveform changed.')
        audio,rate=sf.read(path,dtype='float32')
        features[row['audio']]=processor(audio,sampling_rate=rate,return_tensors='pt').input_features.to('mps')
    def generate(row,condition):
        def inference():
            with torch.inference_mode():
                return model.generate(input_features=features[row['audio']],max_new_tokens=config['maxNewTokens'],do_sample=False,return_timestamps=False)
        torch.mps.synchronize();started=time.perf_counter()
        if condition=='base':
            with model.disable_adapter():predicted=inference()
        else:predicted=inference()
        torch.mps.synchronize()
        return {'condition':condition,'case':row['case'],'turn':row['turn'],'category':row['category'],'seconds':time.perf_counter()-started,'outputTokens':predicted.shape[-1],'transcript':processor.batch_decode(predicted,skip_special_tokens=True)[0]}
    for condition in ['base','adapter']:generate(selected[0],condition)
    results=[]
    for row in selected:
        for repeat,order in enumerate([['base','adapter'],['adapter','base']]):
            for condition in order:results.append(dict(generate(row,condition),repeat=repeat))
    summary={}
    for condition in ['base','adapter']:
        rows=[row for row in results if row['condition']==condition]
        summary[condition]={'generations':len(rows),'meanSeconds':statistics.mean(row['seconds'] for row in rows),'medianSeconds':statistics.median(row['seconds'] for row in rows),'meanOutputTokens':statistics.mean(row['outputTokens'] for row in rows)}
    result={'scope':'Diagnostic warm interleaved validation timing, base adapters disabled vs selected adapter in the same loaded model. Includes adapter-toggle overhead. No training, test selection or app/iPhone timing. One Mac session; thermal/system conditions not controlled.','summary':summary,'cases':len(selected),'results':results,'codeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (directory/'interleaved-validation-timing.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(summary,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory');main(parser.parse_args().directory)
