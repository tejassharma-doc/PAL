#!/bin/bash

# Get token from browser localStorage (you'll need to provide this)
echo "To test the profile endpoint, we need your auth token."
echo "Open browser console and run: localStorage.getItem('pal_token')"
echo ""
echo "Then run this command with your token:"
echo "curl -H 'Authorization: Bearer YOUR_TOKEN' http://localhost:8000/user/profile | jq"
