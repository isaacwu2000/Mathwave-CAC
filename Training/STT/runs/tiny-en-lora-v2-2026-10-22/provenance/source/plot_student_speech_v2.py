"""Plot measured training/validation losses and held-out speech errors by domain."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
from train_student_speech_v2 import summarize, unique_rows


def build_comparison(directory):
    """Aggregate fixed global test representatives, then stratify without rededuplication."""
    before = json.loads((directory/'baseline-test-sealed.json').read_text())['results']
    after = json.loads((directory/'adapted-test.json').read_text())['results']
    identities = lambda rows: [(row['case'], row['turn'], row['sha256']) for row in rows]
    if identities(before) != identities(after):
        raise ValueError('Before/after test memberships differ.')
    selected = {(row['case'], row['turn']) for row in unique_rows(before)}
    result = {'scope':'Same globally unique test transcripts, then stratified by conversation category. Synthetic voices; not human speech or command accuracy.', 'sourceSha256':{name:hashlib.sha256((directory/name).read_bytes()).hexdigest() for name in ['report.json','baseline-test-sealed.json','adapted-test.json']},'plotCodeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'plottingVersion':importlib.metadata.version('matplotlib'),'domains':{}}
    for category in sorted({row['category'] for row in before}):
        b = [row for row in before if row['category']==category and (row['case'],row['turn']) in selected]
        a = [row for row in after if row['category']==category and (row['case'],row['turn']) in selected]
        result['domains'][category] = {'conversations':len({row['case'] for row in b}), 'before':summarize(b)['allClips'] if b else None, 'after':summarize(a)['allClips'] if a else None}
    result['originalCategories']={}
    for category in sorted({row['originalCategory'] for row in before}):
        b=[row for row in before if row['originalCategory']==category and (row['case'],row['turn']) in selected]
        a=[row for row in after if row['originalCategory']==category and (row['case'],row['turn']) in selected]
        result['originalCategories'][category]={'conversations':len({row['case'] for row in b}),'before':summarize(b)['allClips'] if b else None,'after':summarize(a)['allClips'] if a else None}
    result['overall'] = {'before':summarize(before),'after':summarize(after)}
    (directory/'comparison-by-domain.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


def main(directory):
    """Write standalone PNG/SVG figures from saved observations; never interpolate validation."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    directory=Path(directory)
    report=json.loads((directory/'report.json').read_text())
    comparison=build_comparison(directory)
    plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False,'figure.dpi':160,'savefig.facecolor':'white'})
    fig, axes=plt.subplots(1,2,figsize=(12,4.7),layout='constrained')
    train,val=report['trainingCurve'],report['validationCurve']
    for ax, field, label in [(axes[0],'optimizerStep','Optimizer updates'),(axes[1],'elapsedSeconds','Training elapsed time (minutes)')]:
        scale=60 if field=='elapsedSeconds' else 1
        ax.plot([p[field]/scale for p in train],[p['tokenLoss'] for p in train],color='#2374ab',alpha=.30,linewidth=.8,label='Training: each update')
        window=10
        means=[sum(p['tokenLoss']*p['tokens'] for p in train[max(0,i-window+1):i+1])/sum(p['tokens'] for p in train[max(0,i-window+1):i+1]) for i in range(len(train))]
        ax.plot([p[field]/scale for p in train],means,color='#2374ab',linewidth=1.8,label='Training: 10-update token-weighted mean')
        ax.plot([p[field]/scale for p in val],[p['tokenLoss'] for p in val],'-o',color='#c34e22',markersize=4,label='Validation: fixed unique clips')
        chosen=next(p for p in val if p['optimizerStep']==report['selectedStep'])
        ax.scatter([chosen[field]/scale],[chosen['tokenLoss']],s=110,facecolors='none',edgecolors='#151515',zorder=5,label='Selected checkpoint')
        ax.set(xlabel=label,ylabel='Token cross entropy (lower is better)')
        ax.grid(alpha=.15)
    axes[0].legend(fontsize=8)
    fig.suptitle('Whisper tiny.en · fresh rank-8 LoRA · two epochs',fontsize=14)
    for ext in ['png','svg']: fig.savefig(directory/f'learning-curves.{ext}')
    plt.close(fig)
    categories=[c for c in ['algebra','graphs','geometry'] if comparison['domains'].get(c,{}).get('before')]
    fig,ax=plt.subplots(figsize=(8,4.6),layout='constrained')
    positions=list(range(len(categories)))
    for offset,round_name,color,label in [(-.18,'before','#74828b','Original model'),(.18,'after','#2374ab','LoRA adapter')]:
        values=[comparison['domains'][c][round_name]['normalizedWER']*100 for c in categories]
        bars=ax.bar([x+offset for x in positions],values,width=.34,label=label,color=color)
        ax.bar_label(bars,labels=[f'{v:.1f}%' for v in values],padding=3,fontsize=10)
    labels=[]
    for c in categories:
        row=comparison['domains'][c]['before']
        labels.append(f'{dict(algebra="Equations + arithmetic",graphs="Graphs",geometry="Geometry")[c]}\n{row["clips"]} unique clips · {row["referenceWords"]} words')
    ax.set_xticks(positions,labels)
    ax.set(ylabel='Normalized word error rate (%)',title='Same held-out recordings before and after training')
    ax.set_ylim(0,max(comparison['domains'][c][round_name]['normalizedWER']*100 for c in categories for round_name in ['before','after'])*1.25+1)
    ax.legend(); ax.grid(axis='y',alpha=.15); ax.set_axisbelow(True)
    for ext in ['png','svg']: fig.savefig(directory/f'heldout-domains.{ext}')
    plt.close(fig)
    print(json.dumps(comparison,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('directory')
    main(parser.parse_args().directory)
