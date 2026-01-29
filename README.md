# Lux Messenger Desktop

> Private messaging on the Lux Network - A fork of [Session Desktop](https://github.com/session-foundation/session-desktop)

## Summary

Lux Messenger is a privacy-focused messaging application built on the Lux Network, leveraging post-quantum cryptography and decentralized storage nodes. This fork connects to the Lux SessionVM instead of the Oxen network.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Lux Messenger   │     │   luxfi/session  │     │ luxcpp/session   │
│    (Desktop)     │────>│   Go VM + API    │────>│  C++ Storage     │
│  TypeScript/     │     │                  │     │  (GPU-accel)     │
│    Electron      │     │ Post-Quantum     │     │                  │
└──────────────────┘     │ Crypto (FIPS)    │     │  ML-KEM-768      │
                         └──────────────────┘     │  ML-DSA-65       │
                                                  └──────────────────┘
```

## Quick Start

### 1. Configure for Lux Network

Copy the example configuration:
```bash
cp .env.lux .env
```

Or set environment variables directly:
```bash
# Point to your Lux seed node
export LOCAL_DEVNET_SEED_URL=http://localhost:22023/

# Optional: custom file server
export LUX_FILE_SERVER=files.lux.network
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
| `LOCAL_DEVNET_SEED_URL` | Seed node URL for custom network | (none - uses Session mainnet) |
| `LUX_FILE_SERVER` | File server hostname | `filev2.getsession.org` |
| `LUX_NETWORK_SERVER` | Network status server | `networkv1.getsession.org` |
| `NODE_APP_INSTANCE` | `testnet` for testnet mode | (production) |
| `SESSION_DEBUG` | Enable debug logging | (disabled) |

### Running Against Local SessionVM

1. Start the Lux SessionVM node:
```bash
cd ~/work/lux/session
go run ./cmd/node
```

2. Configure desktop to connect:
```bash
export LOCAL_DEVNET_SEED_URL=http://localhost:22023/
npm run dev
```

## Related Repositories

| Repository | Description |
|------------|-------------|
| [luxfi/session](https://github.com/luxfi/session) | Go implementation - VM + API layer |
| [luxcpp/session](https://github.com/luxcpp/session) | C++ storage server (GPU-accelerated) |
| [luxfi/crypto](https://github.com/luxfi/crypto) | Post-quantum cryptography (ML-KEM, ML-DSA) |
| [lux-tel/session-ios](https://github.com/lux-tel/session-ios) | iOS mobile client |
| [lux-tel/session-android](https://github.com/lux-tel/session-android) | Android mobile client |
| [lux-tel/libsession-util](https://github.com/lux-tel/libsession-util) | Shared native library |

## Cryptography

Lux Messenger uses FIPS-compliant post-quantum cryptography:

- **ML-KEM-768** (FIPS 203) - Key encapsulation mechanism
- **ML-DSA-65** (FIPS 204) - Digital signatures
- **XChaCha20-Poly1305** - Symmetric encryption (AEAD)
- **Blake2b-256** - Session ID derivation

Session ID format: `07` + hex(Blake2b-256(KEM_pk || DSA_pk)) = 66 characters

## Key Differences from Session

| Feature | Session | Lux Messenger |
|---------|---------|---------------|
| Network | Oxen Service Nodes | Lux SessionVM |
| Cryptography | X25519/Ed25519 | ML-KEM-768/ML-DSA-65 (post-quantum) |
| Storage | Oxen snodes | Lux storage nodes (GPU-accelerated) |
| Configuration | Hardcoded | Environment-configurable |

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

Enable verbose logging for troubleshooting:
```bash
export SESSION_DEBUG=1
export SESSION_DEBUG_SWARM_POLLING=1
export SESSION_DEBUG_SNODE_POOL=1
npm run dev
```

## Contributing

1. Fork this repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

GPL-3.0 - Same as upstream Session Desktop

## Upstream

This project is a fork of [Session Desktop](https://github.com/session-foundation/session-desktop) by the Session Technology Foundation.
