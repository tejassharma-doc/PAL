"""OTP generation, hashing, and mock delivery."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def verify_otp_hash(code: str, stored_hash: str) -> bool:
    return hashlib.sha256(code.encode()).hexdigest() == stored_hash


def send_otp(channel: str, address: str, code: str) -> str:
    """Mock delivery — prints to console. Swap in Twilio/MSG91 behind env flag later."""
    print(f"\n[DEV OTP] channel={channel} to={address} code={code}\n", flush=True)
    return code  # returned as dev_otp in API response (stripped in production)


def otp_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=10)
