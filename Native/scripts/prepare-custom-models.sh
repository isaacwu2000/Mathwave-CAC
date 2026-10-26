#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK_PLATFORM="${1:-macos}"
bash "$TASK_ROOT/Native/LocalModels/build-runtime.sh" "$TASK_PLATFORM"
TASK_EXPORTED="$TASK_ROOT/work/mathwave-local-runtime/models"
if [[ ! -f "$TASK_EXPORTED/manifest.json" ]]; then
    "$TASK_ROOT/Training/STT/.venv/bin/python" "$TASK_ROOT/Native/LocalModels/export-models.py" --output "$TASK_EXPORTED"
fi
# Verify exported weights before installing a complete model directory.
python3 - "$TASK_EXPORTED" <<'PY'
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]);manifest=json.loads((root/'manifest.json').read_text())
assert manifest.get('formatVersion')==1 and not manifest.get('failure'), 'Incomplete model export.'
for name in ('language','speech'):
    model=manifest[name]; path=root/model['file']
    assert path.parent==root and path.is_file(), 'Invalid model file.'
    with path.open('rb') as source: digest=hashlib.file_digest(source,'sha256').hexdigest()
    assert digest==model['sha256'], 'Model hash mismatch: '+name
    assert manifest['exports']['llm' if name=='language' else 'stt']['mergedAdapter'], 'Adapter was not merged.'
print('Verified trained speech and language model artifacts.')
PY
TASK_MODELS="$TASK_ROOT/Native/Models"
mkdir -p "$TASK_MODELS"
# APFS clones avoid allocating a second full copy of each weight file.
for TASK_FILE in language.gguf speech.bin manifest.json; do
    if [[ ! -f "$TASK_MODELS/$TASK_FILE" ]] || ! cmp -s "$TASK_EXPORTED/$TASK_FILE" "$TASK_MODELS/$TASK_FILE"; then
        cp -c "$TASK_EXPORTED/$TASK_FILE" "$TASK_MODELS/$TASK_FILE.tmp"
        mv "$TASK_MODELS/$TASK_FILE.tmp" "$TASK_MODELS/$TASK_FILE"
    fi
done

cp "$TASK_ROOT/Native/LocalModels/THIRD-PARTY-LICENSES.txt" "$TASK_MODELS/LICENSES.txt"

cp "$TASK_ROOT/Native/LocalModels/MODEL-LICENSES.txt" "$TASK_MODELS/MODEL-LICENSES.txt"
