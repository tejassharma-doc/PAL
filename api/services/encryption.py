"""Token encryption/decryption utilities"""
from cryptography.fernet import Fernet
from typing import Optional
import base64
import hashlib

from config import get_settings

settings = get_settings()


class TokenEncryption:
    """Encrypt and decrypt JWT tokens for database storage"""

    def __init__(self):
        # Derive a Fernet key from the SECRET_KEY
        key_bytes = settings.secret_key.encode()[:32].ljust(32, b'0')
        fernet_key = base64.urlsafe_b64encode(key_bytes)
        self.cipher = Fernet(fernet_key)

    def encrypt_token(self, token: str) -> str:
        """Encrypt a JWT token for storage"""
        token_bytes = token.encode('utf-8')
        encrypted_bytes = self.cipher.encrypt(token_bytes)
        return base64.b64encode(encrypted_bytes).decode('utf-8')

    def decrypt_token(self, encrypted_token: str) -> Optional[str]:
        """Decrypt a stored JWT token"""
        try:
            encrypted_bytes = base64.b64decode(encrypted_token.encode('utf-8'))
            token_bytes = self.cipher.decrypt(encrypted_bytes)
            return token_bytes.decode('utf-8')
        except Exception:
            return None

    def hash_token(self, token: str) -> str:
        """Create a hash of the token for lookups"""
        return hashlib.sha256(token.encode('utf-8')).hexdigest()


# Singleton instance
token_encryption = TokenEncryption()
