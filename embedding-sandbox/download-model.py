#!/usr/bin/env python3
"""
Download all-MiniLM-L6-v2 during Docker build.
This bakes the model into the image so the container
never needs network access at runtime.
"""

from sentence_transformers import SentenceTransformer
import os

print("=" * 60)
print("DOWNLOADING all-MiniLM-L6-v2 MODEL")
print("This model generates 384-dimensional embeddings")
print("It will be BAKED INTO the Docker image")
print("=" * 60)

# Download and cache the model
model = SentenceTransformer('all-MiniLM-L6-v2')

# Save to a known location
model_path = "/app/model"
model.save(model_path)

print(f"Model saved to {model_path}")
print(f"Model embedding dimension: {model.get_sentence_embedding_dimension()}")
print("=" * 60)
print("MODEL DOWNLOAD COMPLETE - Container will be air-gapped from now on")
print("=" * 60)
