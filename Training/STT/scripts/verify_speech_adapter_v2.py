"""Verify a saved LoRA adapter reloads independently and reproduces a recorded prediction."""
import argparse
import hashlib
import json
from pathlib import Path
import time

ROOT=Path(__file__).resolve().parents[3]


def main(directory):
    """Load the pinned original base plus saved adapter; compare a fixed validation clip."""
    started=time.perf_counter()
    import torch
    import soundfile as sf
    from transformers import WhisperProcessor, WhisperForConditionalGeneration
    from peft import PeftModel
    directory=Path(directory)
    report=json.loads((directory/'report.json').read_text())
    reference=json.loads((directory/'adapted-val.json').read_text())['results'][0]
    torch.set_num_threads(4)
    config=report['config']
    processor=WhisperProcessor.from_pretrained(config['model'],revision=config['revision'],local_files_only=True)
    base=WhisperForConditionalGeneration.from_pretrained(config['model'],revision=config['revision'],local_files_only=True,attn_implementation='eager')
    model=PeftModel.from_pretrained(base,directory/'adapter').to('mps').eval()
    path=ROOT/reference['audio']
    if hashlib.sha256(path.read_bytes()).hexdigest()!=reference['sha256']:
        raise ValueError('Validation recording changed.')
    audio,rate=sf.read(path,dtype='float32')
    features=processor(audio,sampling_rate=rate,return_tensors='pt').input_features.to('mps')
    with torch.inference_mode():
        prediction=model.generate(input_features=features,max_new_tokens=config['maxNewTokens'],do_sample=False,return_timestamps=False)
    actual=processor.batch_decode(prediction,skip_special_tokens=True)[0]
    result={'case':reference['case'],'turn':reference['turn'],'expectedSavedPrediction':reference['hypothesis'],'freshProcessPrediction':actual,'exactlyReproduced':actual==reference['hypothesis'],'elapsedSecondsIncludingImports':time.perf_counter()-started,'scope':'Saved-adapter reload on one fixed validation clip; not an additional test-set selection.'}
    (directory/'reload-smoke.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
    if not result['exactlyReproduced']:
        raise RuntimeError('Saved adapter prediction did not reproduce.')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('directory')
    main(parser.parse_args().directory)
