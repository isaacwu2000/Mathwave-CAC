# Saved status before shutdown

The v2 speech experiment is complete:500 conversations,1,615 recordings; same frozen stratified split before/after; fresh two-epoch rank-8 Whisper tiny.en LoRA on the local M3 via PyTorch/MPS and Hugging Face.

Primary test WER14.53%→2.74%; selected update286. All artifacts, adapters, plots, provenance and rerun instructions are in runs/tiny-en-lora-v2-2026-10-22 and README.md. The adapter reload and reorganization audits pass. No training process remains running; no paid GPU/API was used.

Production app assets are unchanged. Three hyphenated-number parser regressions remain documented (497/500 authored math replays pass). Human/iPhone voice acceptance and transcription-to-tool-call LLM training are not established by this experiment. Concurrent Web/Native edits belong to other work and must be preserved.
