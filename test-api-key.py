#!/usr/bin/env python3
"""
Test script to verify Anthropic API key and model name
"""
import os
import sys
from anthropic import Anthropic

# Color codes for terminal output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def print_success(msg):
    print(f"{GREEN}✓ {msg}{RESET}")

def print_error(msg):
    print(f"{RED}✗ {msg}{RESET}")

def print_info(msg):
    print(f"{BLUE}ℹ {msg}{RESET}")

def print_warning(msg):
    print(f"{YELLOW}⚠ {msg}{RESET}")

def test_api_key():
    """Test if API key is valid and working"""
    print("\n" + "="*60)
    print("Testing Anthropic API Key and Model")
    print("="*60 + "\n")

    # Get API key from environment
    api_key = os.getenv("ANTHROPIC_API_KEY")

    if not api_key:
        print_error("ANTHROPIC_API_KEY not found in environment variables!")
        print_info("Please set it in your .env file")
        return False

    # Mask API key for display
    masked_key = api_key[:8] + "..." + api_key[-4:] if len(api_key) > 12 else "***"
    print_info(f"API Key found: {masked_key}")
    print()

    # Get model name
    model = os.getenv("OPERATOR_ANTHROPIC_MODEL", "claude-sonnet-4-5@20250929")
    print_info(f"Model to test: {model}")
    print()

    # Test API call
    try:
        print_info("Making test API call...")
        client = Anthropic(api_key=api_key)

        message = client.messages.create(
            model=model,
            max_tokens=100,
            messages=[
                {
                    "role": "user",
                    "content": "Say 'API test successful!' and nothing else."
                }
            ]
        )

        response_text = message.content[0].text

        print_success("API call successful!")
        print()
        print_info("Response from Claude:")
        print(f"  {response_text}")
        print()

        # Print usage info
        print_info("Token usage:")
        print(f"  Input tokens:  {message.usage.input_tokens}")
        print(f"  Output tokens: {message.usage.output_tokens}")
        print()

        print_success(f"API Key is valid!")
        print_success(f"Model '{model}' is working correctly!")
        print()

        return True

    except Exception as e:
        print_error("API call failed!")
        print()
        print_error(f"Error: {str(e)}")
        print()

        # Common error messages and solutions
        error_str = str(e).lower()

        if "invalid api key" in error_str or "authentication" in error_str:
            print_warning("Solution: Check your API key")
            print_info("  1. Go to: https://console.anthropic.com/settings/keys")
            print_info("  2. Generate a new API key")
            print_info("  3. Update ANTHROPIC_API_KEY in .env file")

        elif "model" in error_str:
            print_warning("Solution: Invalid model name")
            print_info("  Valid models:")
            print_info("    - claude-sonnet-4-5@20250929 (Sonnet 4.5)")
            print_info("    - claude-opus-4@20250514 (Opus 4)")
            print_info("    - claude-haiku-4-5@20251001 (Haiku 4.5)")
            print_info("  Update model name in .env file")

        elif "rate limit" in error_str:
            print_warning("Solution: Rate limit exceeded")
            print_info("  Wait a moment and try again")

        elif "quota" in error_str or "credits" in error_str:
            print_warning("Solution: Insufficient credits")
            print_info("  Check your Anthropic account balance")
            print_info("  Add credits at: https://console.anthropic.com/settings/billing")

        print()
        return False

def test_env_file():
    """Check if .env file has the necessary variables"""
    print("\n" + "="*60)
    print("Checking Environment Configuration")
    print("="*60 + "\n")

    required_vars = {
        "ANTHROPIC_API_KEY": "Your Anthropic API key",
        "OPERATOR_ANTHROPIC_MODEL": "Claude model name (optional, has default)"
    }

    all_found = True

    for var, description in required_vars.items():
        value = os.getenv(var)
        if value:
            if "KEY" in var:
                masked = value[:8] + "..." + value[-4:] if len(value) > 12 else "***"
                print_success(f"{var}: {masked}")
            else:
                print_success(f"{var}: {value}")
        else:
            if var == "OPERATOR_ANTHROPIC_MODEL":
                print_warning(f"{var}: Not set (will use default)")
            else:
                print_error(f"{var}: Not found!")
                all_found = False

    print()
    return all_found

def main():
    """Main test function"""
    # Load .env file if python-dotenv is available
    try:
        from dotenv import load_dotenv
        load_dotenv()
        print_success("Loaded .env file")
    except ImportError:
        print_warning("python-dotenv not installed, using system environment variables")
        print_info("Install with: pip install python-dotenv")

    # Test environment variables
    env_ok = test_env_file()

    if not env_ok:
        print_error("Environment configuration incomplete!")
        print_info("Please update your .env file with required variables")
        sys.exit(1)

    # Test API key and model
    api_ok = test_api_key()

    if api_ok:
        print("="*60)
        print_success("ALL TESTS PASSED! ✓")
        print("="*60)
        print()
        print_info("Your API key and model are configured correctly!")
        print_info("The PAL application should work fine.")
        print()
        sys.exit(0)
    else:
        print("="*60)
        print_error("TESTS FAILED! ✗")
        print("="*60)
        print()
        print_info("Please fix the issues above and try again.")
        print()
        sys.exit(1)

if __name__ == "__main__":
    main()
