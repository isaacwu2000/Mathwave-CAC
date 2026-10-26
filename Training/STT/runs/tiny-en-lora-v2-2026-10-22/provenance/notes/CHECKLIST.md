# Speech LoRA v2 checklist

- [x] Expand to 500 conversation families, emphasizing multi-turn algebra/editing and arithmetic.
- [x] Independently review every new conversation and replay authored math answers.
- [x] Pre-generate and verify every new turn with varied local synthetic voices.
- [x] Freeze grouped, category-stratified random partitions and audit overlap.
- [x] Test numeric/operator normalization, retaining wrong values/signs.
- [x] Run original-model baseline, fresh two-epoch rank-8 LoRA, validation-only selection, and fixed-test retest.
- [x] Plot measured training/validation loss over updates and time; report held-out domains.
- [x] Verify saved adapter reload, source hashes, and unchanged base weights.
- [x] Show code and plots; commit and push only owned changes.

V1 remains frozen. V2 repartitions previously examined synthetic cases: this is not a new unseen benchmark. Complete conversations stay grouped; repeated STT turns can be excluded from lower-priority partitions to prevent transcript/waveform leakage. Human speech, iPhone integration, LLM tool accuracy and full-suite visual acceptance are outside this speech-only experiment.

- [x] Prepare Training/STT documentation and a separate ignored Python environment using cached packages.
- [x] Relocate training files and outputs after the run; retain exact original provenance and verify identical rerun memberships.

Publication is limited to owned Training/STT, v2 dataset/checker and .gitignore paths. Concurrent Web and Native work is preserved. Three recorded product-parser failures remain outside this speech-only task.
