"""Plot the recorded training curve without changing model selection."""
import argparse
import json
from pathlib import Path


def plot_run(directory):
    """Read immutable loss records and write standalone figures beside the run.

    - Training loss is the mean over each optimizer update's supervised tokens.
    - Validation loss uses the complete fixed validation split at epoch ends.
    - Plotting never reads test scores or edits checkpoints.
    """
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    path=Path(directory)
    rows=[json.loads(line) for line in (path/'learning-curve.jsonl').read_text().splitlines() if line]
    train=[r for r in rows if 'learningRate' in r]
    val=[r for r in rows if 'validationLoss' in r]
    fig, ax=plt.subplots(figsize=(8,4.5),layout='constrained')
    ax.plot([r['update'] for r in train],[r['trainingLoss'] for r in train],label='Training (per update)',alpha=.65)
    ax.plot([r['update'] for r in val],[r['validationLoss'] for r in val],marker='o',label='Validation (all held-out validation rows)')
    ax.set(xlabel='Optimizer update',ylabel='Assistant-token cross entropy',title='Mathwave Qwen3 0.6B LoRA')
    ax.legend();ax.grid(alpha=.2)
    for suffix in ('png','svg'):fig.savefig(path/f'learning-curves.{suffix}',dpi=160)
    plt.close(fig)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args();plot_run(args.run)
