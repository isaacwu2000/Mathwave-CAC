"""Plot a saved journey analysis; no provider calls are made."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

source = Path(sys.argv[1])
report = json.loads(source.read_text())
scenarios = [('cold-equation', 'Cold connection'), ('warm-step', 'Warm follow-up'), ('reconnected-equation', 'After reconnect')]
fig, ax = plt.subplots(figsize=(8, 3.8))
for index, (key, label) in enumerate(scenarios):
    group = report['groups'][key]
    interval = group['successInterval80']
    if not interval:
        continue
    rate = group['passed'] / group['attempted']
    y = 2 - index
    ax.errorbar(rate * 100, y, xerr=[[(rate - interval['lower']) * 100], [(interval['upper'] - rate) * 100]],
                fmt='o', color='#225b78', capsize=6, markersize=7, linewidth=2)
    ax.text(103, y, f"{group['passed']}/{group['attempted']}", va='center', fontsize=12)
ax.set_yticks([2, 1, 0], [label for _, label in scenarios], fontsize=12)
ax.set_xticks([0, 25, 50, 75, 100], ['0%', '25%', '50%', '75%', '100%'])
ax.set_xlim(-2, 112)
ax.set_ylim(-0.5, 2.6)
ax.set_xlabel('Scenario success rate · two-sided 80% Wilson interval', fontsize=11, labelpad=12)
ax.set_title('Math Audio · recorded voice journey evaluation', loc='left', fontsize=14, pad=18)
ax.grid(axis='x', alpha=0.18)
ax.set_axisbelow(True)
for spine in ax.spines.values():
    spine.set_visible(False)
ax.tick_params(axis='both', length=0)
fig.text(0.02, 0.015, 'Repeated synthetic fixtures; intervals describe success, not latency or student usability.', fontsize=9, color='#555555')
fig.tight_layout(rect=(0, .055, 1, 1))
output = source.with_name(source.stem + '-wilson80.png')
fig.savefig(output, dpi=180, facecolor='white')
print(output)
