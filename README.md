# Pars Messenger Desktop

[![CI](https://github.com/parsdao/pars-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/parsdao/pars-desktop/actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)

> Private messaging for the Pars Network - Built on [pars.network](https://pars.network)

## Overview

Pars Messenger is a privacy-focused, end-to-end encrypted messaging application for the Pars Network. It features post-quantum cryptography, decentralized storage, and onion routing for maximum privacy.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Pars Messenger  │     │  Pars SessionVM  │     │  Pars Storage    │
│    (Desktop)     │────▶│   Go VM + API    │────▶│  C++ Backend     │
│  TypeScript/     │     │                  │     │  (GPU-accel)     │
│    Electron      │     │ Post-Quantum     │     │                  │
└──────────────────┘     │ Crypto (FIPS)    │     │  ML-KEM-768      │
                         └──────────────────┘     │  ML-DSA-65       │
                                                  └──────────────────┘
```

## Quick Start

### 1. Configure for Pars Network

Copy the example configuration:
```bash
cp .env.pars .env
```

Or set environment variables directly:
```bash
# Point to Pars seed node
export LOCAL_DEVNET_SEED_URL=http://localhost:22023/

# For Pars testnet
export LOCAL_DEVNET_SEED_URL=https://seed.pars.network:4443/
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Development Server

```bash
npm run dev
```

### 4. Build for Production

```bash
npm run build
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOCAL_DEVNET_SEED_URL` | Seed node URL for Pars network | (required for Pars) |
| `PARS_FILE_SERVER` | File server hostname | `files.pars.network` |
| `PARS_NETWORK_SERVER` | Network status server | `network.pars.network` |
| `NODE_APP_INSTANCE` | `testnet` for testnet mode | (production) |
| `SESSION_DEBUG` | Enable debug logging | (disabled) |

### Local Development

1. Start the Pars SessionVM node:
```bash
# Clone and run the SessionVM
git clone https://github.com/parsdao/session
cd session
go run ./cmd/node
```

2. Configure desktop to connect:
```bash
export LOCAL_DEVNET_SEED_URL=http://localhost:22023/
npm run dev
```

## Pars Ecosystem

| Repository | Description |
|------------|-------------|
| [parsdao/pars-desktop](https://github.com/parsdao/pars-desktop) | Desktop client (this repo) |
| [parsdao/pars-ios](https://github.com/parsdao/pars-ios) | iOS mobile client |
| [parsdao/pars-android](https://github.com/parsdao/pars-android) | Android mobile client |
| [parsdao/pars-libsession](https://github.com/parsdao/pars-libsession) | Native crypto library |
| [parsdao/node](https://github.com/parsdao/node) | Pars blockchain node |
| [parsdao/session](https://github.com/parsdao/session) | SessionVM implementation |

## Cryptography

Pars Messenger uses FIPS-compliant post-quantum cryptography:

| Algorithm | Standard | Purpose |
|-----------|----------|---------|
| ML-KEM-768 | FIPS 203 | Key encapsulation |
| ML-DSA-65 | FIPS 204 | Digital signatures |
| XChaCha20-Poly1305 | - | Symmetric encryption (AEAD) |
| Blake2b-256 | - | Session ID derivation |

**Session ID format:** `07` + hex(Blake2b-256(KEM_pk || DSA_pk)) = 66 characters

## Features

- **End-to-end encryption** - Messages encrypted with post-quantum algorithms
- **Decentralized** - No central servers, runs on Pars network nodes
- **Onion routing** - IP address obfuscation through multi-hop routing
- **Disappearing messages** - Automatic message expiration
- **Group chats** - Encrypted group messaging
- **Voice messages** - Encrypted audio messaging
- **File sharing** - Encrypted file transfers up to 10MB

## Development

### Project Structure

```
ts/
├── session/
│   ├── apis/
│   │   ├── seed_node_api/    # Seed node discovery
│   │   ├── snode_api/        # Storage node API
│   │   └── file_server_api/  # File uploads
│   ├── crypto/               # Cryptographic operations
│   └── onions/               # Onion routing
├── state/
│   └── ducks/types/          # Feature flags
└── preload.js                # Network configuration
```

### Debug Logging

```bash
export SESSION_DEBUG=1
export SESSION_DEBUG_SWARM_POLLING=1
export SESSION_DEBUG_SNODE_POOL=1
npm run dev
```

### Running Tests

```bash
npm test
```

## Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Resources

- **Website:** [pars.network](https://pars.network)
- **Documentation:** [docs.pars.network](https://docs.pars.network)
- **PIPs (Proposals):** [github.com/parsdao/pips](https://github.com/parsdao/pips)

## License

GPL-3.0 - See [LICENSE](LICENSE)

## Acknowledgments

- Fork of [Session Desktop](https://github.com/session-foundation/session-desktop)
- Built on [Lux Network](https://lux.network) technology
