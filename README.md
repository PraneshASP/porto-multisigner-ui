# Porto Multisig UI

A clean, secure web interface for managing multisig transactions using Porto WebAuthn passkeys and IthacaAccount contracts.

## Features

- **WebAuthn Integration**: Create and manage passkeys using Porto
- **Multisig Setup**: Configure threshold signatures with multiple owners
- **Intent System**: Create transaction intents for collaborative signing
- **Secure Signing**: Validate signatures on-chain with replay protection
- **Clean UI**: Streamlined interface focused on essential functionality

## Quick Start

1. **Environment Setup**
   ```bash
   NEXT_PUBLIC_MULTISIG_SIGNER=
   NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=
   # To submit and relay transactions
   RELAYER_PRIVATE_KEY=
   ```

2. **Installation**
   ```bash
   pnpm install
   pnpm dev
   ```

3. **Usage Flow**
   - **Setup**: Connect wallet, create passkeys, configure multisig
   - **Create**: Generate transaction intents with computed digests
   - **Sign**: Collect signatures from authorized passkey owners
   - **Submit**: Execute transactions when threshold is met

## Architecture

### Components
- `src/app/page.tsx` - Main multisig interface with three tabs
- `src/app/intent/[id]/page.tsx` - Standalone intent signing page
- `src/app/intent/new/page.tsx` - Simple intent creation page

### API Routes
- `POST /api/intents` - Create new transaction intents
- `GET /api/intents/[id]` - Retrieve intent details
- `POST /api/intents/[id]/sign` - Submit and validate signatures
- `POST /api/intents/[id]/submit` - Execute ready transactions

### Key Libraries
- **Porto**: WebAuthn passkey management
- **Wagmi**: Ethereum wallet integration
- **Viem**: Contract interaction utilities


## Contract Integration

### IthacaAccount
- Manages owner authorization and permissions
- Validates signatures and executes transactions
- Handles nonce management for replay protection

### MultisigSigner
- Stores multisig configuration (threshold, owners)
- Validates external key authorization
- Provides configuration queries for intent creation

## Documentation

See `FLOW.md` for detailed flow documentation including:
- Complete setup process
- Intent creation and signing flows
- Security considerations
- Error handling patterns

## Disclaimer
The software is being provided as is. No guarantee, representation or warranty is being made, express or implied, as to the safety or correctness of the software. They have not been audited and as such there can be no assurance they will work as intended, and users may experience delays, failures, errors, omissions, loss of transmitted information or loss of funds. The creators are not liable for any of the foregoing. Users should proceed with caution and use at their own risk.