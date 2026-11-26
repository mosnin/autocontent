"""Seal and open integration secrets (WordPress application passwords).

AES-256-GCM under ``MARKETER_INTEGRATION_SECRET_KEY`` (32 bytes, base64).
Each sealed value is bound to a purpose and a tenant through the associated
data, so a ciphertext copied onto another workspace's row, or into another
column, does not open.

Format: ``v1:<base64(nonce || ciphertext+tag)>``. The version prefix lets a
later key or algorithm live beside this one.

Rules:

- No key, no sealing: ``SecretsUnavailable`` (routes answer 503). A secret
  is never stored in the clear as a fallback.
- A sealed value is only ever opened server-side, right before the call that
  needs it. No route returns it; APIs expose ``has_password`` instead.
"""
from __future__ import annotations

import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..config import settings

_PREFIX = "v1:"
_NONCE = 12


class SecretsUnavailable(RuntimeError):
    """The sealing key is missing or malformed."""


class SecretUnreadable(ValueError):
    """A sealed value did not open (wrong key, tenant, purpose, or tampered)."""


def _key() -> bytes:
    raw = (settings.integration_secret_key or "").strip()
    if not raw:
        raise SecretsUnavailable("integration secrets are not configured on this server")
    try:
        key = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise SecretsUnavailable("integration secret key is not valid base64") from exc
    if len(key) != 32:
        raise SecretsUnavailable("integration secret key must be 32 bytes")
    return key


def available() -> bool:
    try:
        _key()
    except SecretsUnavailable:
        return False
    return True


def _aad(purpose: str, tenant_id: str) -> bytes:
    return f"marketer:{purpose}:{tenant_id}".encode()


def seal(plaintext: str, *, purpose: str, tenant_id: str) -> str:
    nonce = os.urandom(_NONCE)
    ct = AESGCM(_key()).encrypt(nonce, plaintext.encode(), _aad(purpose, tenant_id))
    return _PREFIX + base64.b64encode(nonce + ct).decode()


def open_sealed(sealed: str, *, purpose: str, tenant_id: str) -> str:
    if not sealed or not sealed.startswith(_PREFIX):
        raise SecretUnreadable("not a sealed value")
    try:
        blob = base64.b64decode(sealed[len(_PREFIX):], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise SecretUnreadable("sealed value is corrupt") from exc
    if len(blob) <= _NONCE:
        raise SecretUnreadable("sealed value is corrupt")
    try:
        pt = AESGCM(_key()).decrypt(blob[:_NONCE], blob[_NONCE:], _aad(purpose, tenant_id))
    except InvalidTag as exc:
        raise SecretUnreadable("sealed value does not open with this key") from exc
    return pt.decode()
