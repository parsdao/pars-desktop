# Code Signing Setup for Pars Desktop

## Overview

Pars Desktop uses Electron Builder for cross-platform builds. This guide explains how to set up code signing for proper distribution without security warnings.

## Required GitHub Secrets

Add these secrets to `parsdao/pars-desktop` repository settings:
**Settings → Secrets and variables → Actions → New repository secret**

Or set them at the org level (`parsdao` org settings) to share across repos.

---

## macOS Signing (Required for no Gatekeeper warnings)

### 1. MAC_CERTIFICATE
**What:** Base64-encoded Developer ID Application certificate (.p12)

**Steps:**
```bash
# 1. Go to https://developer.apple.com → Certificates
# 2. Create "Developer ID Application" certificate
# 3. Download and import to Keychain Access
# 4. Export as .p12 (right-click → Export)
# 5. Convert to base64:
base64 -i ~/Desktop/certificate.p12 | pbcopy
# 6. Paste into GitHub secret
```

### 2. MAC_CERTIFICATE_PASSWORD
**What:** Password you set when exporting the .p12

### 3. SIGNING_APPLE_ID
**What:** Your Apple Developer account email
```
z@luxindustries.xyz
```

### 4. SIGNING_APP_PASSWORD
**What:** App-specific password (NOT your Apple ID password)

**Steps:**
1. Go to https://appleid.apple.com
2. Sign in → Security → App-Specific Passwords
3. Generate one labeled "Pars Desktop CI"
4. Copy the 16-character password

### 5. SIGNING_TEAM_ID
**What:** Your 10-character Apple Team ID

**Find it:**
```bash
# Option 1: From certificate
security find-identity -v -p codesigning | grep "Developer ID"
# Team ID is in parentheses at the end

# Option 2: Apple Developer portal
# https://developer.apple.com/account → Membership → Team ID
```

---

## Windows Signing (Optional but recommended)

For Windows, you need an EV (Extended Validation) code signing certificate to avoid SmartScreen warnings.

### Options:
1. **DigiCert, Sectigo, etc.** - ~$400/year for EV cert
2. **Azure SignTool** - Use Azure Key Vault
3. **Skip for now** - Users get SmartScreen warning but can click "More info → Run anyway"

If you have a Windows EV cert, add:
- `WIN_CSC_LINK` - Base64 encoded .pfx certificate
- `WIN_CSC_KEY_PASSWORD` - Certificate password

---

## Quick Setup Script

Run this on your Mac to get the values:

```bash
#!/bin/bash
echo "=== Apple Signing Setup ==="

# Find signing identity
echo -e "\n1. Your signing identities:"
security find-identity -v -p codesigning | grep "Developer ID"

# Get Team ID from cert
echo -e "\n2. Export your 'Developer ID Application' cert from Keychain as .p12"
echo "   Then run: base64 -i /path/to/cert.p12 | pbcopy"

echo -e "\n3. Get app-specific password from: https://appleid.apple.com"

echo -e "\n4. Required secrets for GitHub:"
echo "   MAC_CERTIFICATE          = <base64 of .p12>"
echo "   MAC_CERTIFICATE_PASSWORD = <.p12 export password>"
echo "   SIGNING_APPLE_ID         = z@luxindustries.xyz"
echo "   SIGNING_APP_PASSWORD     = <app-specific password>"
echo "   SIGNING_TEAM_ID          = <10-char Team ID>"
```

---

## Testing

Once secrets are configured:

```bash
# Trigger a build
gh workflow run build-binaries.yml --repo parsdao/pars-desktop -f target_branch=main

# Or push to main branch
git push origin main
```

Check Actions tab for build status. Signed releases will be uploaded to the draft release.

---

## Troubleshooting

| Error | Solution |
|-------|----------|
| "certificate not found" | MAC_CERTIFICATE not base64 encoded correctly |
| "notarization failed" | Check SIGNING_APPLE_ID and SIGNING_APP_PASSWORD |
| "codesign failed" | Certificate expired or wrong type (need "Developer ID Application") |
| "password incorrect" | MAC_CERTIFICATE_PASSWORD doesn't match |

---

## Distribution Without Signing

If you skip signing, the apps still work but show warnings:

**macOS:** "Cannot be opened because the developer cannot be verified"
- Fix: Right-click → Open, or `xattr -cr /Applications/Pars.app`

**Windows:** SmartScreen warning
- Fix: Click "More info" → "Run anyway"

**Linux:** No issues, works without signing
