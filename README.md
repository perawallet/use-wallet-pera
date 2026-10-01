# @perawallet/use-wallet-pera

[![npm version](https://img.shields.io/npm/v/@perawallet/use-wallet-pera)](https://www.npmjs.com/package/@perawallet/use-wallet-pera)
[![License](https://img.shields.io/github/license/perawallet/use-wallet-pera)](./LICENSE)

The [Pera Wallet](https://perawallet.app) adapter for [use-wallet](https://github.com/TxnLab/use-wallet), maintained by Pera.

It wraps [`@perawallet/connect`](https://github.com/perawallet/connect), so one adapter covers the Pera mobile app (WalletConnect), Pera Web, the Pera browser extension and Pera's in-app Discover browser.

## Installation

```bash
pnpm add @txnlab/use-wallet @perawallet/use-wallet-pera algosdk
```

If you use a framework adapter (`@txnlab/use-wallet-react`, `-vue`, `-solid` or `-svelte`), install it instead of `@txnlab/use-wallet`.

Requires `@txnlab/use-wallet` 5.x and `algosdk` 3.5.2 or later.

## Usage

```ts
import { WalletManager } from "@txnlab/use-wallet";
import { pera } from "@perawallet/use-wallet-pera";

const manager = new WalletManager({
  wallets: [pera()],
});
```

`pera()` accepts every [`PeraWalletConnect` option](https://github.com/perawallet/connect#options) and passes them through unchanged, plus use-wallet's shared `metadata` option to change the name or icon shown for the wallet:

```ts
pera({
  shouldShowSignTxnToast: false,
  compactMode: true,
  metadata: { name: "Pera Wallet" },
});
```

The adapter supports MainNet and TestNet, transaction signing (`signTransactions` and `transactionSigner`) and ARC-60 data signing (`signData`).

## Migrating from `@txnlab/use-wallet-pera`

Swap the package and the import. Nothing else changes:

```diff
- import { pera } from "@txnlab/use-wallet-pera";
+ import { pera } from "@perawallet/use-wallet-pera";
```

The wallet id is still `"pera"`, so sessions that use-wallet has already persisted are picked up as they are and users stay connected across the upgrade.

What's different from the TxnLab package:

- **Pera browser extension sessions.** Revoking a site from the extension's Connections screen now disconnects the wallet in your app. The old adapter only listened on the WalletConnect connector, which extension sessions don't have.
- **All connect options.** Options such as `singleAccount`, `shouldPreferExtension` and `algod` are passed through, not just `bridge`, `shouldShowSignTxnToast`, `chainId` and `compactMode`.
- **Typed signing errors.** A rejected or failed signing request throws use-wallet's `SignTxnsError` or `SignDataError`. The code is `4001` when the user cancelled and `4300` otherwise, and the original Pera error type is in `error.data.type`.
- **A strict response count.** If the wallet returns a different number of signed transactions than it was asked for, `signTransactions` throws instead of returning a misaligned array.
- **Pera and Defly in the same app.** From connect 1.7, Pera stores its WalletConnect session under its own key, so it no longer competes with Defly for the shared one. The Pera session also resumes on page load while Defly is the active wallet.

## Error handling

```ts
import { SignTxnsError } from "@txnlab/use-wallet";

try {
  await wallet.signTransactions(txns);
} catch (error) {
  if (error instanceof SignTxnsError && error.code === 4001) {
    // the user rejected the request in Pera
  }
}
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Report security issues through GitHub private vulnerability reporting on this repository, not in a public issue.

## License

[MIT](./LICENSE). This package began as a fork of TxnLab's `@txnlab/use-wallet-pera`.
