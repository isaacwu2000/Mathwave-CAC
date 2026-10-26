# Model training

Training experiments live here, separately from the models and resources shipped by the app.

- [Speech-to-text training](STT/): local Whisper LoRA experiments using PyTorch and Hugging Face.
- Conversation cases and recordings remain under [Evals/inputs](../Evals/inputs), where app evaluations can reuse them.
- The iPhone app remains under [Native](../Native). It does not automatically load weights from this folder.

- [Transcript-to-tools training](LLM/): local Qwen LoRA experiment using the shared web DSL and frozen conversation splits. See its run status before assuming training has finished.
