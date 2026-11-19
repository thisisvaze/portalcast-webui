#!/bin/sh
# Live captions on a Mac's GPU: mlx-audio's server with NVIDIA's Nemotron streaming model (English),
# on ws://127.0.0.1:8881. While it runs, the web app's live captions come from here, a fraction of a
# second after the words are said; without it they run in the browser (Moonshine, 1.5 to 2 s behind).
# Needs uv (https://docs.astral.sh/uv). The first run downloads the model (2.5 GB).
#   sh scripts/mac-captions-helper.sh          DELAY_MS=160|560|1120: words sooner, or more accurate
set -e
MODEL=nvidia/nemotron-speech-streaming-en-0.6b
DIR="$HOME/.cache/live-captions/nemotron-asr-streaming-en-0.6b"
if [ ! -e "$DIR" ]; then
  mkdir -p "$(dirname "$DIR")"
  SNAPSHOT=$(uvx --from huggingface_hub hf download "$MODEL" model.safetensors config.json generation_config.json \
    processor_config.json tokenizer.json tokenizer_config.json | tail -n 1 | sed 's/^path=//')
  # mlx-audio 0.6.6 tells speech-to-text models by their folder name, and the repo's name does not say.
  ln -sfn "$SNAPSHOT" "$DIR"
fi
MLX_AUDIO_REALTIME_TRANSCRIPTION_DELAY_MS="${DELAY_MS:-560}" exec uvx --from 'mlx-audio[server]==0.6.6' \
  mlx_audio.server --host 127.0.0.1 --port 8881 --realtime-model "$DIR"
