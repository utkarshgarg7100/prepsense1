"""Work around a Stable-Baselines3 2.9 / torch 2.13 incompatibility when loading.

`SB3.load()` opens each tensor file *inside* the saved .zip and hands the resulting
`ZipExtFile` straight to `torch.load`. Torch 2.13's reader cannot read from that
object reliably and fails with:

    PytorchStreamReader failed reading file .data/serialization_id:
    file read failed. This is an internal miniz error. ... high likelihood that
    your checkpoint file is corrupted.

**The file is not corrupted.** The message is misleading and cost time to diagnose:
`zipfile.testzip()` reports the archive clean, and every member loads correctly once
read into memory first. The bug is purely in how the file object is passed.

So the fix is to buffer: intercept `torch.load`, and if it is given a zip member,
read the bytes into a `BytesIO` and load from that instead. Everything else is
untouched, so real corruption would still be reported.

The alternative was pinning torch back a version, which would have meant the trained
policy and the training environment disagreeing with `requirements.txt`. Buffering a
few hundred kilobytes is the smaller price.
"""

from __future__ import annotations

import io
import zipfile
from contextlib import contextmanager

import torch


@contextmanager
def patched_torch_load():
    """Temporarily make `torch.load` tolerate zip-member file objects."""
    original = torch.load

    def load(f, *args, **kwargs):
        if isinstance(f, zipfile.ZipExtFile):
            f = io.BytesIO(f.read())
        return original(f, *args, **kwargs)

    torch.load = load
    try:
        yield
    finally:
        torch.load = original


def load_model(algo, path: str, env=None):
    """`algo.load(path)`, with the workaround applied.

    Use this everywhere instead of calling `.load()` directly, so a future SB3/torch
    combination that fixes the bug needs no changes here - the patch is a no-op when
    the underlying call already works.

    `env` must be passed at load time when continuing training with a *different*
    number of parallel environments than the checkpoint was created with. Attaching it
    afterwards via `set_env` asserts that the counts already match, which they do not
    when a single-env behaviour-cloning checkpoint is fine-tuned across 8 envs.
    """
    with patched_torch_load():
        return algo.load(path, env=env) if env is not None else algo.load(path)
