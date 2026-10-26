"""Train fresh speech adapters with frozen v2 partitions and validation learning curves."""
import argparse
import gc
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import random
import re
import time
from speech_normalization import normalize_tokens as tokens, word_errors as errors

def transcript_key(text):
    """Use the same canonical transcript identity as the frozen v2 split."""
    return " ".join(tokens(text))

ROOT = Path(__file__).resolve().parents[3]
CONFIG = {'model':'openai/whisper-tiny.en','revision':'87c7102498dcde7456f24cfd30239ca606ed9063','seed':20261022,'epochs':2,'learningRate':0.0005,'rank':8,'alpha':16,'dropout':0.05,'batchSize':2,'gradientAccumulation':4,'maxNewTokens':128,'selection':'lowest validation token-weighted cross entropy over fixed 25-update and epoch-end checkpoints; trained checkpoints only','precision':'float32','device':'mps','paidComputeUsd':0,'validationInterval':25}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def unique_rows(rows):
    """Choose a fixed first representative per transcript, independent of predictions."""
    seen, result = set(), []
    for row in rows:
        key = transcript_key(row['reference'])
        if key not in seen:
            result.append(row)
            seen.add(key)
    return result


def math_tokens(words):
    """Keep canonical operators, variables and numbers for a diagnostic token score."""
    operators={'+','-','*','/','^','=','<','>','<=','>=','!=','(',')'}
    math_words={'root','half','halves','third','thirds','quarter','quarters','pi','theta','not'}
    return [word for word in words if word in operators or word in math_words or re.fullmatch(r'[a-z]|\d+(?:\.\d+)?',word)]


def summarize(rows):
    """Score globally unique transcript representatives before grouping by category.

    The first representative is fixed by corpus order, never prediction success.
    Raw whitespace WER and restricted math tokens are secondary diagnostics.
    """
    if not rows:
        raise ValueError('Empty evaluation partition.')
    def aggregate(items):
        count=sum(item['referenceWords'] for item in items)
        raw_count=sum(item['rawReferenceWords'] for item in items)
        critical_count=sum(item['mathReferenceTokens'] for item in items)
        return {'clips':len(items),'referenceWords':count,'wordErrors':sum(item['wordErrors'] for item in items),'normalizedWER':sum(item['wordErrors'] for item in items)/count if count else None,'normalizedExact':sum(item['exact'] for item in items),'rawWER':sum(item['rawErrors'] for item in items)/raw_count if raw_count else None,'mathTokenErrorRate':sum(item['mathErrors'] for item in items)/critical_count if critical_count else None,'generationSeconds':sum(item['generationSeconds'] for item in items),'audioSeconds':sum(item['audioSeconds'] for item in items)}
    result={}
    for name,items in [('uniqueTranscript',unique_rows(rows)),('allClips',rows)]:
        result[name]=aggregate(items)
        categories=sorted({item.get('category','unspecified') for item in items})
        result[name]['byCategory']={category:aggregate([item for item in items if item.get('category','unspecified')==category]) for category in categories}
    return result


def main(split_path, output):
    """Baseline → two fixed LoRA epochs → validation selection → held-out retest.

    Baseline test predictions are written sealed and not used in any training choice.
    Only LoRA matrices may change. No provider, Runpod or training-data download is used.
    """
    import numpy as np
    import soundfile as sf
    import torch
    from transformers import WhisperProcessor, WhisperForConditionalGeneration
    from peft import LoraConfig, get_peft_model, get_peft_model_state_dict, set_peft_model_state_dict
    from safetensors.torch import load_file
    started = time.perf_counter()
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    split = json.loads(Path(split_path).read_text())
    report = {'config':CONFIG,'splitSha256':digest(split_path),'splitSummary':split['summary'],'platform':platform.platform(),'versions':{name:importlib.metadata.version(name) for name in ['torch','transformers','peft','numpy','soundfile']},'codeSha256':{name:digest(Path(__file__).with_name(name)) for name in ['train_student_speech_v2.py','student_speech_v2.py','speech_normalization.py']},'checklist':{'splitFrozen':True,'baseline':False,'trained':False,'validationSelection':False,'heldoutRetest':False,'baseWeightsUnchanged':False},'limits':['Synthetic macOS voices only; all voices recur across partitions.','Filtered STT clips, not multi-turn LLM training.','Fresh grouped, stratified split of a previously examined synthetic corpus; not a new unseen benchmark.','No actual-app result rendering, human-speech or iPhone acceptance is established by transcription scores.'],'visualReview':'Not an app-command evaluation: no mathematical output is rendered. App visual acceptance remains incomplete (2/400 conversations in prior evidence).'}
    def save():
        (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    save()
    if digest(Path(__file__).with_name('student_speech_v2.py')) != split['splitterSha256']:
        raise ValueError('Splitter changed after split freeze.')
    manifest_path = ROOT/split['audioManifest']
    if digest(Path(__file__).with_name('speech_normalization.py')) != split['normalizerSha256']:
        raise ValueError('Normalizer changed after split freeze.')
    if digest(manifest_path) != split['audioManifestSha256']:
        raise ValueError('Audio manifest changed after split freeze.')
    for name, sha in split['corpusSha256'].items():
        if digest(ROOT/name) != sha:
            raise ValueError('Corpus changed after split freeze.')
    # Reject any drift between the frozen representative list and this scorer.
    for partition, rows in split['clips'].items():
        actual=[(row['case'],row['turn'],row['sha256']) for row in unique_rows(rows)]
        expected=[(row['case'],row['turn'],row['sha256']) for row in split['primaryRepresentatives'][partition]]
        if actual != expected:
            raise ValueError('Primary representatives changed after split freeze.')
    if not torch.backends.mps.is_available():
        raise RuntimeError('Metal GPU unavailable; CPU fallback is disabled.')
    torch.set_num_threads(4)
    torch.manual_seed(CONFIG['seed'])
    np.random.seed(CONFIG['seed'])
    random.seed(CONFIG['seed'])
    if hasattr(torch.mps, 'manual_seed'):
        torch.mps.manual_seed(CONFIG['seed'])
    torch.use_deterministic_algorithms(True, warn_only=True)
    processor = WhisperProcessor.from_pretrained(CONFIG['model'], revision=CONFIG['revision'], local_files_only=True)
    base = WhisperForConditionalGeneration.from_pretrained(CONFIG['model'],revision=CONFIG['revision'],local_files_only=True,attn_implementation='eager').to('mps').eval()
    report['modelLoadSeconds'] = time.perf_counter()-started
    features = {}
    durations = {}
    def feature(row):
        sha = row['sha256']
        if sha not in features:
            path = ROOT/row['audio']
            if digest(path) != sha:
                raise ValueError(f"Changed waveform: {row['audio']}")
            audio, rate = sf.read(path,dtype='float32')
            if rate != 16000 or audio.ndim != 1:
                raise ValueError('Use the frozen mono 16kHz corpus.')
            features[sha] = processor(audio,sampling_rate=16000,return_tensors='pt').input_features[0]
            durations[sha] = len(audio)/16000
        return features[sha]
    def batch(rows):
        inputs = torch.stack([feature(row) for row in rows]).to('mps')
        encoded = processor.tokenizer([row['reference'] for row in rows],padding=True,return_tensors='pt')
        labels = encoded.input_ids.masked_fill(encoded.attention_mask.ne(1),-100)
        if torch.all(labels[:,0] == base.config.decoder_start_token_id):
            labels = labels[:,1:]
        return inputs, labels.to('mps')
    def evaluate(model, rows, name):
        model.eval()
        results=[]
        for index,row in enumerate(rows):
            preprocessing_started=time.perf_counter()
            inputs=feature(row).unsqueeze(0).to('mps')
            torch.mps.synchronize()
            generation_started=time.perf_counter()
            with torch.inference_mode():
                predicted=model.generate(input_features=inputs,max_new_tokens=CONFIG['maxNewTokens'],do_sample=False,return_timestamps=False)
            torch.mps.synchronize()
            elapsed=time.perf_counter()-generation_started
            text=processor.batch_decode(predicted,skip_special_tokens=True)[0]
            reference, hypothesis=tokens(row['reference']),tokens(text)
            raw_reference,raw_hypothesis=row['reference'].split(),text.split()
            cr,ch=math_tokens(reference),math_tokens(hypothesis)
            results.append({**row,'hypothesis':text,'wordErrors':errors(reference,hypothesis),'referenceWords':len(reference),'exact':reference==hypothesis,'rawErrors':errors(raw_reference,raw_hypothesis),'rawReferenceWords':len(raw_reference),'mathErrors':errors(cr,ch),'mathReferenceTokens':len(cr),'audioSeconds':durations[row['sha256']],'generationSeconds':elapsed,'processingAndGenerationSeconds':time.perf_counter()-preprocessing_started,'generatedTokens':predicted.shape[-1],'hitTokenLimit':predicted.shape[-1]>=CONFIG['maxNewTokens']})
            if (index+1)%25==0:
                print(json.dumps({'stage':name,'completed':index+1,'total':len(rows)}),flush=True)
        (output/(name+'.json')).write_text(json.dumps({'summary':summarize(results),'results':results},indent=2)+'\n')
        return summarize(results)
    def validation_loss(model):
        model.eval()
        total,count=0.,0
        rows=unique_rows(split['clips']['val'])
        with torch.inference_mode():
            for offset in range(0,len(rows),CONFIG['batchSize']):
                inputs,labels=batch(rows[offset:offset+CONFIG['batchSize']])
                loss=model(input_features=inputs,labels=labels).loss
                valid=int((labels!=-100).sum().item())
                total+=float(loss.item())*valid
                count+=valid
        return total/count
    # Warm the same eager decoder used for all measured predictions; do not update weights.
    with torch.inference_mode():
        base.generate(input_features=feature(split['clips']['val'][0]).unsqueeze(0).to('mps'),max_new_tokens=CONFIG['maxNewTokens'],do_sample=False,return_timestamps=False)
    print(json.dumps({'stage':'baseline-start','loadSeconds':report['modelLoadSeconds']}),flush=True)
    report['baselineValidation']=evaluate(base,split['clips']['val'],'baseline-val')
    evaluate(base,split['clips']['test'],'baseline-test-sealed')
    report['checklist']['baseline']=True
    save()
    adapted=get_peft_model(base,LoraConfig(r=CONFIG['rank'],lora_alpha=CONFIG['alpha'],target_modules=['q_proj','v_proj'],lora_dropout=CONFIG['dropout'],bias='none'))
    trainable=[(name,value) for name,value in adapted.named_parameters() if value.requires_grad]
    if not trainable or any('lora_' not in name for name,_ in trainable):
        raise RuntimeError('Only LoRA matrices may be trainable.')
    def weight_hash(only_adapters):
        hasher=hashlib.sha256()
        for name,value in sorted(adapted.named_parameters()):
            if ('lora_' in name) != only_adapters:
                continue
            hasher.update(name.encode())
            hasher.update(value.detach().cpu().contiguous().numpy().tobytes())
        return hasher.hexdigest()
    report['frozenBaseBeforeSha256']=weight_hash(False)
    adapter_before=weight_hash(True)
    report['trainableParameters']=sum(value.numel() for _,value in trainable)
    report['totalParameters']=sum(value.numel() for value in adapted.parameters())
    report['baselineValidationLoss']=validation_loss(adapted)
    report['trainingCurve']=[]
    report['validationCurve']=[{'optimizerStep':0,'epoch':0,'tokenLoss':report['baselineValidationLoss'],'elapsedSeconds':0}]
    train_rows=split['clips']['train']
    batches=math.ceil(len(train_rows)/CONFIG['batchSize'])
    updates_per_epoch=math.ceil(batches/CONFIG['gradientAccumulation'])
    total_updates=updates_per_epoch*CONFIG['epochs']
    optimizer=torch.optim.AdamW([value for _,value in trainable],lr=CONFIG['learningRate'],weight_decay=.01)
    best_loss=float('inf')
    updates=0
    report['epochs']=[]
    training_started=time.perf_counter()
    def checkpoint(epoch_fraction):
        # All checkpoint choices use validation only; test predictions stay sealed.
        nonlocal best_loss
        val_loss=validation_loss(adapted)
        point={'optimizerStep':updates,'epoch':epoch_fraction,'tokenLoss':val_loss,'elapsedSeconds':time.perf_counter()-training_started}
        report['validationCurve'].append(point)
        if val_loss<best_loss:
            best_loss=val_loss
            adapted.save_pretrained(output/'adapter',safe_serialization=True)
            report['selectedEpoch']=epoch_fraction
            report['selectedStep']=updates
            report['selectedValidationLoss']=val_loss
        print(json.dumps({'stage':'validation-checkpoint',**point}),flush=True)
        save()
        adapted.train()
        return val_loss
    for epoch in range(CONFIG['epochs']):
        order=list(range(len(train_rows)))
        random.Random(CONFIG['seed']+epoch).shuffle(order)
        adapted.train()
        optimizer.zero_grad(set_to_none=True)
        epoch_loss,epoch_tokens,update_loss,update_tokens=0.,0,0.,0
        for index in range(batches):
            rows=[train_rows[i] for i in order[index*CONFIG['batchSize']:(index+1)*CONFIG['batchSize']]]
            inputs,labels=batch(rows)
            loss=adapted(input_features=inputs,labels=labels).loss
            if not torch.isfinite(loss).item():
                raise RuntimeError('Nonfinite training loss; no further updates allowed.')
            group_start=index//CONFIG['gradientAccumulation']*CONFIG['gradientAccumulation']
            group_size=min(CONFIG['gradientAccumulation'],batches-group_start)
            (loss/group_size).backward()
            valid=int((labels!=-100).sum().item())
            weighted_loss=float(loss.item())*valid
            epoch_loss+=weighted_loss
            epoch_tokens+=valid
            update_loss+=weighted_loss
            update_tokens+=valid
            if (index+1)%CONFIG['gradientAccumulation']==0 or index==batches-1:
                torch.nn.utils.clip_grad_norm_([value for _,value in trainable],1.,error_if_nonfinite=True)
                warmup=min(1.,(updates+1)/10)
                decay=max(0.,(total_updates-updates)/max(1,total_updates-10))
                for group in optimizer.param_groups:
                    group['lr']=CONFIG['learningRate']*min(warmup,decay)
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                updates+=1
                report['trainingCurve'].append({'optimizerStep':updates,'epoch':epoch+(index+1)/batches,'tokenLoss':update_loss/update_tokens,'tokens':update_tokens,'learningRate':optimizer.param_groups[0]['lr'],'elapsedSeconds':time.perf_counter()-training_started})
                update_loss,update_tokens=0.,0
                if updates%CONFIG['validationInterval']==0 and index!=batches-1:
                    checkpoint(epoch+(index+1)/batches)
                if updates%10==0:
                    torch.mps.synchronize()
                    print(json.dumps({'stage':'training','epoch':epoch+1,'optimizerSteps':updates,'plannedSteps':total_updates,'lastLoss':float(loss.item()),'elapsedSeconds':time.perf_counter()-training_started}),flush=True)
        val_loss=checkpoint(epoch+1)
        epoch_result={'epoch':epoch+1,'trainTokenLoss':epoch_loss/epoch_tokens,'validationTokenLoss':val_loss,'optimizerSteps':updates}
        report['epochs'].append(epoch_result)
        print(json.dumps({'stage':'epoch-complete',**epoch_result}),flush=True)
        save()
    report['trainingSeconds']=time.perf_counter()-training_started
    report['optimizerSteps']=updates
    report['checklist']['trained']=True
    report['frozenBaseAfterSha256']=weight_hash(False)
    report['adapterChanged']=adapter_before!=weight_hash(True)
    report['checklist']['baseWeightsUnchanged']=report['frozenBaseAfterSha256']==report['frozenBaseBeforeSha256']
    if not report['checklist']['baseWeightsUnchanged'] or not report['adapterChanged']:
        raise RuntimeError('Base weights changed or adapter did not train.')
    set_peft_model_state_dict(adapted,load_file(str(output/'adapter/adapter_model.safetensors')),adapter_name='default')
    report['checklist']['validationSelection']=True
    report['selectionLockedBeforeTest']=True
    save()
    report['adaptedValidation']=evaluate(adapted,split['clips']['val'],'adapted-val')
    report['adaptedTest']=evaluate(adapted,split['clips']['test'],'adapted-test')
    report['baselineTest']=json.loads((output/'baseline-test-sealed.json').read_text())['summary']
    report['checklist']['heldoutRetest']=True
    report['elapsedSeconds']=time.perf_counter()-started
    report['memory']={'mpsAllocatedMiB':torch.mps.current_allocated_memory()/1024**2,'mpsDriverMiB':torch.mps.driver_allocated_memory()/1024**2}
    report['adapterFiles']={path.name:digest(path) for path in sorted((output/'adapter').iterdir()) if path.is_file()}
    report['metricNotes']='Primary unique-transcript score; full retained-clip score secondary. V2 normalization canonicalizes cardinals, decimals and explicit operators; preserves wrong values/signs and ordinary words. Raw WER uses unnormalized whitespace words. Math-token error rate is diagnostic, not equation accuracy. Training curves are token-weighted cross entropy over each optimizer update (training mode/dropout); validation curves use fixed unique validation clips (evaluation mode). Generation timing excludes imports/model load/preprocessing; per-clip processing+generation and full run times are also recorded. Both rounds use one warm eager MPS pass with the same deterministic decoder.'
    save()
    print(json.dumps({'stage':'complete','before':report['baselineTest'],'after':report['adaptedTest'],'selectedEpoch':report['selectedEpoch'],'steps':updates}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--split',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    main(args.split,args.output)
