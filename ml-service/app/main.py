from __future__ import annotations

import os
from typing import Any

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_NAME = os.getenv("MODEL_NAME", "distilgpt2")
MAX_SEQ_LEN = int(os.getenv("MAX_SEQ_LEN", "64"))
TOKENIZE_MAX_SEQ_LEN = int(os.getenv("TOKENIZE_MAX_SEQ_LEN", "512"))

app = FastAPI(title="EW370 ML Service", version="0.1.0")

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
try:
    model = AutoModelForCausalLM.from_pretrained(MODEL_NAME, attn_implementation="eager")
except TypeError:
    model = AutoModelForCausalLM.from_pretrained(MODEL_NAME)
model.eval()


class TextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=800)


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=800)
    max_new_tokens: int = Field(default=30, ge=1, le=80)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)


class NextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=800)
    k: int = Field(default=5, ge=2, le=50)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/tokenize")
def tokenize(req: TextRequest) -> dict[str, Any]:
    enc = tokenizer(
        req.text,
        return_offsets_mapping=True,
        add_special_tokens=False,
        truncation=True,
        max_length=TOKENIZE_MAX_SEQ_LEN,
    )
    token_ids = enc["input_ids"]
    offsets = enc["offset_mapping"]
    tokens = tokenizer.convert_ids_to_tokens(token_ids)

    details = []
    for i, (tid, tok, (start, end)) in enumerate(zip(token_ids, tokens, offsets)):
        display = req.text[start:end]
        details.append(
            {
                "index": i,
                "token_id": int(tid),
                "token": display,
                "raw_token": tok,
                "text": req.text[start:end],
                "start": int(start),
                "end": int(end),
            }
        )

    return {"tokens": details, "count": len(details)}


@app.post("/generate")
def generate(req: GenerateRequest) -> dict[str, Any]:
    inputs = tokenizer(req.prompt, return_tensors="pt", truncation=True, max_length=MAX_SEQ_LEN)
    sample_mode = req.temperature > 0
    generate_kwargs: dict[str, Any] = {
        **inputs,
        "max_new_tokens": req.max_new_tokens,
        "do_sample": sample_mode,
        "pad_token_id": tokenizer.eos_token_id,
    }
    if sample_mode:
        generate_kwargs["temperature"] = req.temperature
        generate_kwargs["top_p"] = 0.95

    with torch.no_grad():
        out = model.generate(**generate_kwargs)

    text = tokenizer.decode(out[0], skip_special_tokens=True)
    completion = text[len(req.prompt) :] if text.startswith(req.prompt) else text
    return {"prompt": req.prompt, "completion": completion, "full_text": text, "temperature": req.temperature}


@app.post("/next-candidates")
def next_candidates(req: NextRequest) -> dict[str, Any]:
    inputs = tokenizer(req.text, return_tensors="pt", truncation=True, max_length=MAX_SEQ_LEN)
    with torch.no_grad():
        logits = model(**inputs).logits[:, -1, :]
        probs = torch.softmax(logits, dim=-1)
        top_probs, top_ids = torch.topk(probs, k=req.k, dim=-1)

    ids = top_ids[0].tolist()
    prob_values = top_probs[0].tolist()

    candidates = []
    for idx, (tok_id, prob) in enumerate(zip(ids, prob_values)):
        token_text = tokenizer.decode([tok_id])
        candidates.append(
            {
                "rank": idx + 1,
                "token_id": int(tok_id),
                "token": token_text,
                "prob": float(prob),
            }
        )

    return {
        "input_text": req.text,
        "llm_choice": candidates[0]["token"],
        "candidates": candidates,
    }


@app.post("/attention")
def attention(req: TextRequest) -> dict[str, Any]:
    token_info = tokenizer(
        req.text,
        return_offsets_mapping=True,
        add_special_tokens=False,
        truncation=True,
        max_length=MAX_SEQ_LEN,
    )
    ids = token_info["input_ids"]
    offsets = token_info["offset_mapping"]
    tokens = [req.text[start:end] if end > start else "(space)" for (start, end) in offsets]
    inputs = {"input_ids": torch.tensor([ids], dtype=torch.long)}

    with torch.no_grad():
        outputs = model(**inputs, output_attentions=True)

    if not outputs.attentions:
        raise HTTPException(status_code=500, detail="Model did not return attentions")

    def normalize_layer_attention(layer_attention: Any) -> np.ndarray:
        if layer_attention is None:
            raise HTTPException(status_code=500, detail="Attention tensor missing")

        if isinstance(layer_attention, (tuple, list)):
            if not layer_attention:
                raise HTTPException(status_code=500, detail="Attention tensor missing")
            head_tensors = []
            for item in layer_attention:
                if item is None:
                    continue
                item_np = item.detach().cpu().numpy()
                if item_np.ndim == 3:
                    # [batch, query, key]
                    head_tensors.append(item_np[0])
                elif item_np.ndim == 2:
                    # [query, key]
                    head_tensors.append(item_np)
                else:
                    raise HTTPException(status_code=500, detail="Unexpected per-head attention shape")
            if not head_tensors:
                raise HTTPException(status_code=500, detail="Attention tensor missing")
            return np.stack(head_tensors, axis=0)

        layer_np = layer_attention.detach().cpu().numpy()
        if layer_np.ndim == 4:
            # [batch, heads, query, key]
            return layer_np[0]
        if layer_np.ndim == 3:
            # [heads, query, key]
            return layer_np
        raise HTTPException(status_code=500, detail="Unexpected attention tensor shape")

    # Correct aggregation: keep query x key structure, average only over heads/layers.
    per_layer = [normalize_layer_attention(layer) for layer in outputs.attentions if layer is not None]
    if not per_layer:
        raise HTTPException(status_code=500, detail="Attention tensor missing")

    layer_head_averages = [np.mean(layer, axis=0) for layer in per_layer]  # [query, key] per layer
    avg_qk = np.mean(np.stack(layer_head_averages, axis=0), axis=0)  # [query, key]
    matrix = avg_qk.tolist()

    strongest = []
    seq_len = len(tokens)
    for i in range(seq_len):
        for j in range(i + 1):
            strongest.append((float(avg_qk[i, j]), i, j))
    strongest.sort(reverse=True, key=lambda x: x[0])

    top_links = [
        {
            "from_index": i,
            "to_index": j,
            "from_token": tokens[i],
            "to_token": tokens[j],
            "weight": w,
        }
        for w, i, j in strongest[: min(20, len(strongest))]
    ]

    return {
        "tokens": [{"index": i, "token": t} for i, t in enumerate(tokens)],
        "matrix": matrix,
        "top_links": top_links,
        "meta": {"layers": len(per_layer), "aggregation": "mean_over_heads_then_mean_over_layers"},
    }
