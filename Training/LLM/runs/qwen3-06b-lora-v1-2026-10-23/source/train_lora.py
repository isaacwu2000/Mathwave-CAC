"""Run a frozen-split Qwen LoRA experiment on the local Apple GPU."""
import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import random
import shutil
import subprocess
import time

MODEL = 'Qwen/Qwen3-0.6B'
REVISION = 'c1899de289a04d12100db370d81485cdf75e47ca'
CONFIG = dict(model=MODEL, revision=REVISION, seed=20261023, epochs=2,
              rank=8, alpha=16, dropout=0.05, learningRate=0.0002,
              batchSize=1, gradientAccumulation=8, maxContext=16384,
              maxNewTokens=512, warmupUpdates=10, precision='float16 base, float32 adapters',
              device='mps', selection='lowest full validation assistant-token cross entropy at epoch ends',
              paidComputeUsd=0, enableThinking=False, decoding='greedy; stop at complete JSON',
              gradientCheckpointing=True, targets=['q_proj', 'v_proj'])


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def training_tokens(row, tokenizer, max_context):
    """Return complete context with labels only for the final assistant response.

    - All previous dialogue and engine observations remain unsupervised inputs.
    - Refuse overlong examples rather than silently removing instructions or answers.
    - Keep the same non-thinking generation prefix before and after training.
    """
    messages = row['messages']
    if not messages or messages[-1]['role'] != 'assistant':
        raise ValueError(f"Missing final assistant response: {row.get('id')}")
    prefix = tokenizer.apply_chat_template(messages[:-1], tokenize=False,
                                          add_generation_prompt=True, enable_thinking=False)
    complete = tokenizer.apply_chat_template(messages, tokenize=False,
                                            add_generation_prompt=False, enable_thinking=False)
    if not complete.startswith(prefix):
        raise ValueError('Chat template changed the assistant prefix.')
    prompt = tokenizer(prefix, add_special_tokens=False)['input_ids']
    ids = tokenizer(complete, add_special_tokens=False)['input_ids']
    if ids[:len(prompt)] != prompt:
        raise ValueError('Token boundary differs between prompt and target.')
    if len(ids) > max_context:
        raise ValueError(f"{row.get('id')} exceeds {max_context} tokens: {len(ids)}")
    labels = [-100] * len(prompt) + ids[len(prompt):]
    if not any(x != -100 for x in labels):
        raise ValueError('Empty assistant target.')
    return dict(input_ids=ids, labels=labels, promptLength=len(prompt),
                targetTokens=len(ids)-len(prompt))


def partition_rows(partitions):
    """Validate rows before returning the unchanged partitions.

    - Each row ID is unique; all turns of a case stay in one partition.
    - Raises on overlaps and never edits the supplied examples.
    """
    owners, ids = {}, set()
    for split, rows in partitions.items():
        for row in rows:
            if row['id'] in ids:
                raise ValueError(f"Duplicate row: {row['id']}")
            ids.add(row['id'])
            owner = owners.setdefault(row['caseId'], split)
            if owner != split:
                raise ValueError(f"Conversation crosses partitions: {row['caseId']}")
    return partitions


def aggregate_losses(values):
    """Weight each mean cross entropy by the number of supervised answer tokens."""
    count = sum(n for _, n in values)
    if not count:
        raise ValueError('No supervised tokens.')
    return sum(loss*n for loss, n in values)/count


def main(data_path, output_path, smoke=False):
    """Baseline, fixed two-epoch LoRA, validation selection, reload and held-out retest.

    - Uses the same test prompts and decoder on both sides; no API or paid GPU.
    - Test predictions never select a checkpoint or alter training settings.
    - Saves adapters only and checks every frozen parameter remains unchanged.
    """
    import numpy as np
    import torch
    from torch.nn import functional as F
    from transformers import AutoTokenizer, AutoModelForCausalLM, StoppingCriteria, StoppingCriteriaList
    from peft import LoraConfig, get_peft_model, PeftModel
    started = time.perf_counter()
    data, output = Path(data_path), Path(output_path)
    output.mkdir(parents=True, exist_ok=False)
    if shutil.disk_usage(output).free < 4*1024**3:
        raise RuntimeError('Keep at least 4 GiB free for the experiment.')
    if not torch.backends.mps.is_available():
        raise RuntimeError('Apple GPU unavailable; no silent CPU fallback.')
    torch.set_num_threads(4)
    random.seed(CONFIG['seed']); np.random.seed(CONFIG['seed']); torch.manual_seed(CONFIG['seed'])
    torch.mps.manual_seed(CONFIG['seed'])
    partitions = partition_rows({name:[json.loads(line) for line in (data/f'{name}.jsonl').read_text().splitlines() if line] for name in ('train','val','test')})
    if any(not rows for rows in partitions.values()):
        raise ValueError('All three partitions must be nonempty.')
    config = {**CONFIG, 'smokeOnly':smoke}
    report = dict(config=config, startedUnix=time.time(), platform=platform.platform(),
                  dataHashes={p.name:digest(p) for p in data.iterdir() if p.is_file()},
                  sourceHashes={p.name:digest(p) for p in Path(__file__).parent.iterdir() if p.suffix in ('.py','.ts')},
                  versions={x:importlib.metadata.version(x) for x in ('torch','transformers','peft','safetensors','numpy')},
                  counts={k:len(v) for k,v in partitions.items()}, progress={'stage':'loading'},
                  checklist={'splitChecked':True,'baseline':False,'trained':False,'reloaded':False,'retest':False,'frozenBaseUnchanged':False},
                  limits=['Previously examined synthetic corpus; not an unseen external benchmark.',
                          'Conditional per-turn evaluation uses authored prior state; not autonomous conversation rollout.',
                          'No microphone, STT, iPhone integration, quantization or speed acceptance.',
                          'Assistant predictions are graded separately by the shared engine; exact text match is diagnostic only.'],
                  visualReview='Pending actual-app rendering and inspection of graded predictions.')
    def save():
        (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    def progress(stage, **details):
        report['progress']={'stage':stage,**details,'elapsedSeconds':time.perf_counter()-started}
        save(); print(json.dumps(report['progress']),flush=True)
    save()
    provenance=output/'source'; provenance.mkdir()
    for source in Path(__file__).parent.iterdir():
        if source.suffix in ('.py','.ts'):
            shutil.copyfile(source,provenance/source.name)
    tokenizer=AutoTokenizer.from_pretrained(MODEL,revision=REVISION,local_files_only=True)
    tokenizer.pad_token=tokenizer.eos_token
    encoded={name:[training_tokens(row,tokenizer,CONFIG['maxContext']) for row in rows] for name,rows in partitions.items()}
    report['tokenCounts']={name:dict(total=sum(len(x['input_ids']) for x in rows),supervised=sum(x['targetTokens'] for x in rows),maximum=max(len(x['input_ids']) for x in rows)) for name,rows in encoded.items()}
    base=AutoModelForCausalLM.from_pretrained(MODEL,revision=REVISION,local_files_only=True,dtype=torch.float16,attn_implementation='sdpa').to('mps')
    base.config.use_cache=False
    # Keep one parameter-name normalization for wrapped and original base models.
    def base_hash(model):
        if hasattr(model,'get_base_model'): model=model.get_base_model()
        sha=hashlib.sha256()
        for name,param in model.named_parameters():
            if 'lora_' in name: continue
            sha.update(name.replace('.base_layer.','.').encode())
            sha.update(param.detach().cpu().contiguous().numpy().tobytes())
        return sha.hexdigest()
    initial_hash=base_hash(base)
    def loss_for(model,item):
        """Return answer-token loss for one complete example on the Apple GPU.

        - Gradients include the full prompt; only final answer positions are scored.
        - Projection omits unused vocabulary logits, preserving causal target alignment.
        """
        ids=torch.tensor([item['input_ids']],device='mps')
        labels=torch.tensor(item['labels'],device='mps')
        positions=torch.nonzero(labels!=-100,as_tuple=False).flatten()
        if int(positions.min().item()) < 1: raise ValueError('Answer needs a preceding prompt.')
        # Project only positions predicting answer tokens. The full context still
        # participates in attention and gradients; this avoids huge unused logits.
        logits=model(input_ids=ids,logits_to_keep=positions-1,use_cache=False).logits[0]
        return F.cross_entropy(logits.float(),labels[positions]),len(positions)
    def val_loss(model):
        """Measure every frozen validation example without gradients or weight updates.

        - Returns token-weighted answer loss and leaves the model in evaluation mode.
        - Validation alone selects a trained checkpoint.
        """
        model.eval(); values=[]
        with torch.inference_mode():
            for item in encoded['val']:
                loss,count=loss_for(model,item);values.append((float(loss.item()),count))
        return aggregate_losses(values)
    class CompleteJSON(StoppingCriteria):
        def __init__(self,prompt_length):self.prompt_length=prompt_length
        def __call__(self,input_ids,scores,**kwargs):
            """Stop once the generated continuation parses as complete JSON."""
            text=tokenizer.decode(input_ids[0,self.prompt_length:],skip_special_tokens=True).strip()
            if text.startswith('```'):text=text.split('\n',1)[-1].removesuffix('```').strip()
            if not text.endswith(('}',']')):return False
            try:json.loads(text);return True
            except json.JSONDecodeError:return False
    def predict(model,name,rows,items):
        """Generate each held-out answer with an unchanged decoder and gold prior state.

        - Refuses an existing prediction file and flushes every completed row.
        - Records failures at the experiment boundary; never supplies the target to generation.
        """
        model.eval(); path=output/f'{name}-predictions.jsonl'; summaries=[]
        with path.open('x') as handle,torch.inference_mode():
            for index,(row,item) in enumerate(zip(rows,items)):
                prompt=item['input_ids'][:item['promptLength']]
                ids=torch.tensor([prompt],device='mps')
                torch.mps.synchronize();clock=time.perf_counter()
                result=model.generate(input_ids=ids,attention_mask=torch.ones_like(ids),max_new_tokens=CONFIG['maxNewTokens'],do_sample=False,use_cache=True,pad_token_id=tokenizer.pad_token_id,stopping_criteria=StoppingCriteriaList([CompleteJSON(len(prompt))]))
                torch.mps.synchronize();elapsed=time.perf_counter()-clock
                tail=result[0,len(prompt):].tolist();prediction=tokenizer.decode(tail,skip_special_tokens=True).strip()
                result_row=dict(id=row['id'],prediction=prediction,elapsedSeconds=elapsed,inputTokens=len(prompt),outputTokens=len(tail),hitTokenLimit=len(tail)>=CONFIG['maxNewTokens'])
                handle.write(json.dumps(result_row)+'\n');handle.flush()
                summaries.append(result_row)
                progress(name,completed=index+1,total=len(rows),lastSeconds=elapsed)
        return dict(rows=len(rows),generatedTokens=sum(x['outputTokens'] for x in summaries),generationSeconds=sum(x['elapsedSeconds'] for x in summaries),hitTokenLimit=sum(x['hitTokenLimit'] for x in summaries))
    model=get_peft_model(base,LoraConfig(r=CONFIG['rank'],lora_alpha=CONFIG['alpha'],lora_dropout=CONFIG['dropout'],target_modules=CONFIG['targets'],task_type='CAUSAL_LM',bias='none'))
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
    report['parameters']={'trainable':sum(p.numel() for p in model.parameters() if p.requires_grad),'total':sum(p.numel() for p in model.parameters())}
    if any('lora_' not in n for n,p in model.named_parameters() if p.requires_grad):
        raise RuntimeError('A base parameter was unfrozen.')
    # A fixed training example benchmarks memory/time without inspecting held-out results.
    model.train(); clock=time.perf_counter();loss,count=loss_for(model,encoded['train'][0]);loss.backward();torch.mps.synchronize()
    report['firstBackward']={'seconds':time.perf_counter()-clock,'loss':float(loss.item()),'tokens':len(encoded['train'][0]['input_ids']),'supervisedTokens':count,'allocatedGiB':torch.mps.current_allocated_memory()/1024**3,'driverGiB':torch.mps.driver_allocated_memory()/1024**3}
    model.zero_grad(set_to_none=True)
    progress('first-backward-complete',**report['firstBackward'])
    if smoke:
        report['warmBackwardSeconds']=[]
        for _ in range(2):
            clock=time.perf_counter(); loss,_count=loss_for(model,encoded['train'][0]); loss.backward(); torch.mps.synchronize()
            report['warmBackwardSeconds'].append(time.perf_counter()-clock); model.zero_grad(set_to_none=True)
        progress('smoke-complete',warmBackwardSeconds=report['warmBackwardSeconds']);return
    with model.disable_adapter():
        report['baseline']=predict(model,'baseline-test',partitions['test'],encoded['test'])
        progress('baseline-validation-loss')
        report['baselineValidationLoss']=val_loss(model)
    subprocess.run(['bun',str(Path(__file__).with_name('grade_predictions.ts')),str(data/'test.jsonl'),str(output/'baseline-test-predictions.jsonl'),str(output/'baseline-grades.json')],check=True)
    report['baselineGrades']=json.loads((output/'baseline-grades.json').read_text())['summary']
    report['checklist']['baseline']=True;save()
    optimizer=torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],lr=CONFIG['learningRate'],weight_decay=0.01)
    updates_per_epoch=math.ceil(len(encoded['train'])/CONFIG['gradientAccumulation']);total_updates=updates_per_epoch*CONFIG['epochs']
    update=0;best=math.inf;curves=[]
    for epoch in range(1,CONFIG['epochs']+1):
        model.train(); order=list(range(len(encoded['train'])));random.Random(CONFIG['seed']+epoch).shuffle(order)
        epoch_values=[];window_values=[];optimizer.zero_grad(set_to_none=True)
        epoch_clock=time.perf_counter()
        for offset,index in enumerate(order):
            example_clock=time.perf_counter()
            loss,count=loss_for(model,encoded['train'][index]);value=float(loss.item())
            if not math.isfinite(value):raise RuntimeError('Non-finite training loss.')
            group_start=(offset//CONFIG['gradientAccumulation'])*CONFIG['gradientAccumulation']
            group_size=min(CONFIG['gradientAccumulation'],len(order)-group_start)
            (loss/group_size).backward();epoch_values.append((value,count));window_values.append((value,count))
            progress('training-example',epoch=epoch,update=update,totalUpdates=total_updates,completedExamples=offset+1,totalEpochExamples=len(order),lastExampleSeconds=time.perf_counter()-example_clock,loss=value)
            if (offset+1)%CONFIG['gradientAccumulation']==0 or offset+1==len(order):
                update+=1
                scale=min(update/CONFIG['warmupUpdates'],max(0,(total_updates-update+1)/max(1,total_updates-CONFIG['warmupUpdates'])))
                for group in optimizer.param_groups:group['lr']=CONFIG['learningRate']*scale
                torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad],1.)
                optimizer.step();optimizer.zero_grad(set_to_none=True)
                entry=dict(update=update,epoch=epoch,trainingLoss=aggregate_losses(window_values),learningRate=optimizer.param_groups[0]['lr'],elapsedSeconds=time.perf_counter()-started)
                curves.append(entry);window_values=[]
                with (output/'learning-curve.jsonl').open('a') as f:f.write(json.dumps(entry)+'\n')
                if update%5==0 or offset+1==len(order):
                    model.save_pretrained(output/'recovery-adapter',safe_serialization=True)
                    torch.save({'optimizer':optimizer.state_dict(),'epoch':epoch,'nextOffset':offset+1,'update':update,'pythonRng':random.getstate(),'torchRng':torch.get_rng_state(),'mpsRng':torch.mps.get_rng_state(),'note':'Recovery artifact only; never selected by test scores.'},output/'recovery-state.pt')
                    progress('training',epoch=epoch,update=update,totalUpdates=total_updates,examples=offset+1,epochSeconds=time.perf_counter()-epoch_clock,loss=entry['trainingLoss'])
        validation=val_loss(model)
        epoch_report=dict(epoch=epoch,update=update,trainingLoss=aggregate_losses(epoch_values),validationLoss=validation,epochSeconds=time.perf_counter()-epoch_clock)
        report.setdefault('epochs',[]).append(epoch_report)
        with (output/'learning-curve.jsonl').open('a') as f:f.write(json.dumps(epoch_report)+'\n')
        if validation<best:
            best=validation;model.save_pretrained(output/'adapter',safe_serialization=True);report['selectedCheckpoint']=epoch_report
        progress('epoch-complete',**epoch_report)
    report['checklist']['trained']=True
    report['frozenBaseSha256Before']=initial_hash;report['frozenBaseSha256After']=base_hash(model)
    report['checklist']['frozenBaseUnchanged']=initial_hash==report['frozenBaseSha256After']
    if not report['checklist']['frozenBaseUnchanged']:raise RuntimeError('Frozen base weights changed.')
    # Remove trained adapters, reload the chosen adapter from disk, then retest.
    base=model.unload(); del model,optimizer
    torch.mps.empty_cache()
    model=PeftModel.from_pretrained(base,output/'adapter',is_trainable=False).eval()
    report['reloadedValidationLoss']=val_loss(model)
    if not math.isclose(report['reloadedValidationLoss'],best,rel_tol=0.002,abs_tol=0.002):
        raise RuntimeError('Reloaded validation loss differs from selected checkpoint.')
    report['checklist']['reloaded']=True;save()
    report['adapted']=predict(model,'adapted-test',partitions['test'],encoded['test'])
    subprocess.run(['bun',str(Path(__file__).with_name('grade_predictions.ts')),str(data/'test.jsonl'),str(output/'adapted-test-predictions.jsonl'),str(output/'adapted-grades.json')],check=True)
    report['adaptedGrades']=json.loads((output/'adapted-grades.json').read_text())['summary']
    report['checklist']['retest']=True;report['totalSeconds']=time.perf_counter()-started
    progress('complete')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data',required=True);parser.add_argument('--output',required=True);parser.add_argument('--smoke',action='store_true');args=parser.parse_args()
    if Path(args.output).exists():
        parser.error('Use a new output directory; historical runs are never overwritten.')
    try:
        main(args.data,args.output,args.smoke)
    except Exception as error:
        report_path=Path(args.output)/'report.json'
        if report_path.exists():
            failed=json.loads(report_path.read_text())
            failed['failure']={'error':str(error),'type':type(error).__name__,'atUnix':time.time(),'lastProgress':failed.get('progress')}
            failed['progress']={'stage':'failed'}
            report_path.write_text(json.dumps(failed,indent=2)+'\n')
        raise
