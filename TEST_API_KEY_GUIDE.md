# Testing Anthropic API Key and Model - Complete Guide

## 🎯 Quick Test (Easiest Way)

### Step 1: Run the Test Script

**Option A: Double-click the batch file**
```
c:\PAL\test-api-key.bat
```

**Option B: Run from command line**
```bash
cd c:\PAL
python test-api-key.py
```

### Step 2: Check the Results

**✅ Success Output:**
```
========================================
Testing Anthropic API Key and Model
========================================

ℹ API Key found: sk-ant-a...xyz
ℹ Model to test: claude-sonnet-4-5@20250929

ℹ Making test API call...
✓ API call successful!

ℹ Response from Claude:
  API test successful!

ℹ Token usage:
  Input tokens:  15
  Output tokens: 5

✓ API Key is valid!
✓ Model 'claude-sonnet-4-5@20250929' is working correctly!

========================================
✓ ALL TESTS PASSED! ✓
========================================
```

**❌ Failure Output:**
```
✗ API call failed!
✗ Error: authentication_error: invalid x-api-key

⚠ Solution: Check your API key
ℹ 1. Go to: https://console.anthropic.com/settings/keys
ℹ 2. Generate a new API key
ℹ 3. Update ANTHROPIC_API_KEY in .env file
```

---

## 📋 What Gets Tested

The script tests:
1. ✅ `.env` file exists and loads correctly
2. ✅ `ANTHROPIC_API_KEY` is present
3. ✅ API key is valid (makes real API call)
4. ✅ Model name is correct
5. ✅ Claude responds successfully
6. ✅ Token usage is tracked

---

## 🔑 Where to Find Your API Key

### Step 1: Go to Anthropic Console
Open: https://console.anthropic.com/settings/keys

### Step 2: Generate API Key
- Click **"Create Key"**
- Give it a name (e.g., "PAL Health Platform")
- Copy the key (starts with `sk-ant-api03-...`)

### Step 3: Add to .env File
```bash
# Open c:\PAL\.env and add:
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-key-here
```

**⚠️ Important:** Never share your API key publicly!

---

## 🤖 Valid Model Names

Update in `.env` file:

### Current Models (2025):

**Sonnet 4.5** (Recommended - Best balance):
```env
OPERATOR_ANTHROPIC_MODEL=claude-sonnet-4-5@20250929
```

**Opus 4** (Most powerful):
```env
OPERATOR_ANTHROPIC_MODEL=claude-opus-4@20250514
```

**Haiku 4.5** (Fastest/Cheapest):
```env
OPERATOR_ANTHROPIC_MODEL=claude-haiku-4-5@20251001
```

### Legacy Models (Still supported):

**Sonnet 3.5**:
```env
OPERATOR_ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

**Opus 3**:
```env
OPERATOR_ANTHROPIC_MODEL=claude-3-opus-20240229
```

---

## 🔧 Configuration in .env

Your `.env` file should have:

```env
# Anthropic API Configuration
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

# Model Selection (optional - defaults to Sonnet 4.5)
OPERATOR_ANTHROPIC_MODEL=claude-sonnet-4-5@20250929

# For operator mode (institutional deployments)
OPERATOR_AI_PROVIDER=anthropic
OPERATOR_ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

---

## 🚨 Common Errors and Solutions

### Error 1: "Invalid API Key"
```
✗ authentication_error: invalid x-api-key
```

**Solution:**
1. Check API key in `.env` file
2. Make sure it starts with `sk-ant-api03-`
3. No extra spaces before/after the key
4. Generate new key if needed

**Check your key:**
```bash
# Open .env file
notepad c:\PAL\.env

# Verify format:
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### Error 2: "Model Not Found"
```
✗ model_error: unknown model 'claude-sonnet-4-5'
```

**Solution:**
Use the correct model name with version:
```env
# Wrong:
OPERATOR_ANTHROPIC_MODEL=claude-sonnet-4-5

# Correct:
OPERATOR_ANTHROPIC_MODEL=claude-sonnet-4-5@20250929
```

**Valid format:** `model-name@YYYYMMDD`

---

### Error 3: "Rate Limit Exceeded"
```
✗ rate_limit_error: Number of requests per minute exceeded
```

**Solution:**
- Wait 60 seconds
- Try again
- Check if you're on free tier (has limits)

**Upgrade if needed:**
https://console.anthropic.com/settings/billing

---

### Error 4: "Insufficient Credits"
```
✗ quota_error: Your account has insufficient credits
```

**Solution:**
1. Go to: https://console.anthropic.com/settings/billing
2. Add credits to your account
3. Minimum $5 to start

**Check balance:**
https://console.anthropic.com/settings/billing

---

### Error 5: "ANTHROPIC_API_KEY Not Found"
```
✗ ANTHROPIC_API_KEY not found in environment variables!
```

**Solution:**
```bash
# 1. Check if .env file exists
dir c:\PAL\.env

# 2. Open and add key
notepad c:\PAL\.env

# 3. Add this line:
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

# 4. Restart services
docker-compose restart api
```

---

## 🧪 Manual Testing (Alternative)

### Test 1: Using curl
```bash
curl https://api.anthropic.com/v1/messages ^
  -H "x-api-key: YOUR_API_KEY" ^
  -H "anthropic-version: 2023-06-01" ^
  -H "content-type: application/json" ^
  -d "{\"model\":\"claude-sonnet-4-5@20250929\",\"max_tokens\":100,\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
```

**Expected:** JSON response with Claude's message

---

### Test 2: Python Interactive
```python
from anthropic import Anthropic

client = Anthropic(api_key="YOUR_API_KEY")

message = client.messages.create(
    model="claude-sonnet-4-5@20250929",
    max_tokens=100,
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(message.content[0].text)
```

**Expected:** "Hello! How can I help you today?"

---

### Test 3: Check in Docker Container
```bash
# Enter API container
docker exec -it pal-api-1 bash

# Test API key
python -c "import os; print('Key:', os.getenv('ANTHROPIC_API_KEY')[:10] + '...')"

# Test API call
python -c "from anthropic import Anthropic; c=Anthropic(); print(c.messages.create(model='claude-sonnet-4-5@20250929', max_tokens=10, messages=[{'role':'user','content':'Hi'}]).content[0].text)"
```

---

## ✅ Verification Checklist

After running the test, verify:

- [ ] `.env` file exists at `c:\PAL\.env`
- [ ] `ANTHROPIC_API_KEY` is set in `.env`
- [ ] API key starts with `sk-ant-api03-`
- [ ] Test script runs without errors
- [ ] Claude responds with "API test successful!"
- [ ] Token usage is displayed
- [ ] Model name is correct format

**If all checked: Your API is configured correctly! ✅**

---

## 💰 Pricing Information

### Current Pricing (2025):

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| **Sonnet 4.5** | $3.00 | $15.00 |
| **Opus 4** | $15.00 | $75.00 |
| **Haiku 4.5** | $0.25 | $1.25 |

**Typical PAL usage:**
- Single patient consultation: ~5,000 tokens ($0.015 - $0.45)
- Daily usage (10 patients): ~50,000 tokens ($0.15 - $4.50)

**Check your usage:**
https://console.anthropic.com/settings/usage

---

## 🔄 After Updating .env

Always restart services after changing `.env`:

```bash
# Restart API service
docker-compose restart api

# Or restart everything
docker-compose restart

# Or rebuild
docker-compose up -d --build
```

---

## 📊 Test Results Interpretation

### Successful Test:
```
✓ API Key is valid!
✓ Model 'claude-sonnet-4-5@20250929' is working correctly!
Token usage: Input 15, Output 5
```
**Meaning:** Everything is configured correctly! ✅

### Failed Test:
```
✗ API call failed!
Error: authentication_error
```
**Meaning:** Check your API key in `.env` file ❌

### Partial Success:
```
⚠ OPERATOR_ANTHROPIC_MODEL: Not set (will use default)
✓ API Key is valid!
```
**Meaning:** Working but using default model ⚠️

---

## 🎯 Quick Troubleshooting Flow

```
API Test Failed?
    │
    ├─ "Invalid API Key"
    │   └─> Check .env file, regenerate key
    │
    ├─ "Model Not Found"
    │   └─> Check model name format (model@date)
    │
    ├─ "Rate Limit"
    │   └─> Wait 60 seconds, try again
    │
    ├─ "Insufficient Credits"
    │   └─> Add credits to Anthropic account
    │
    └─ Other error
        └─> Check error message, contact support
```

---

## 📞 Support Resources

### Anthropic Documentation:
- API Keys: https://docs.anthropic.com/en/api/getting-started
- Models: https://docs.anthropic.com/en/docs/models-overview
- Pricing: https://www.anthropic.com/pricing

### Anthropic Console:
- API Keys: https://console.anthropic.com/settings/keys
- Billing: https://console.anthropic.com/settings/billing
- Usage: https://console.anthropic.com/settings/usage

### PAL Documentation:
- Main README: [README_INTEGRATED.md](README_INTEGRATED.md)
- Setup Guide: [INTEGRATED_SETUP.md](INTEGRATED_SETUP.md)

---

## 🚀 Next Steps After Successful Test

1. **Start the PAL Platform:**
   ```bash
   docker-compose up -d
   ```

2. **Access the Web App:**
   ```
   http://localhost:3000
   ```

3. **Test AI Features:**
   - Use the "Ask" tab in the web app
   - AI should respond using your configured model

4. **Monitor Usage:**
   - Check token usage at Anthropic Console
   - Monitor costs if needed

---

## 📝 Summary

**To test your API key and model:**

```bash
# Quick test
cd c:\PAL
test-api-key.bat

# Or manually
python test-api-key.py
```

**Expected result:**
```
✓ API Key is valid!
✓ Model working correctly!
✓ ALL TESTS PASSED!
```

**If tests pass:** Your PAL application is ready to use AI features! 🎉

**If tests fail:** Follow the error messages and solutions above.

---

**Need help? Run the test and check the error messages for specific solutions!** 💡
