import algosdk from "algosdk";
import {
  BaseWallet,
  compareAccounts,
  flattenTxnGroup,
  isSignedTxn,
  isTransactionArray,
  SignDataError,
  SignTxnsError,
  type AdapterConstructorParams,
  type SignerTransaction,
  type StdSignDataResponse,
  type StdSignMetadata,
  type WalletAccount,
  type WalletMetadata,
  type WalletState,
} from "@txnlab/use-wallet/adapter";
import type { PeraWalletConnect } from "@perawallet/connect";
import { icon } from "./icon";

/** Every `PeraWalletConnect` constructor option, passed through unchanged. */
export type PeraOptions = NonNullable<ConstructorParameters<typeof PeraWalletConnect>[0]>;

const ICON = `data:image/svg+xml;base64,${btoa(icon)}`;

// ARC-0027 / EIP-1193 style codes, matching the other use-wallet adapters.
const USER_REJECTED = 4001;
const INVALID_INPUT = 4300;

const SHARED_WALLETCONNECT_KEY = "walletconnect";

// Adapters that keep their session in the shared key. Only those sessions are
// stashed: when any other wallet is active, a session in the shared key isn't
// that wallet's, and stashing it under that wallet's id would orphan it.
const SHARED_WALLETCONNECT_WALLETS = new Set(["defly"]);

// Detected by shape rather than `instanceof` so it still matches when a dApp
// ends up with two copies of @perawallet/connect in its bundle.
function isPeraWalletConnectError(error: unknown): error is Error & { data: { type: string } } {
  return (
    error instanceof Error &&
    typeof (error as { data?: { type?: unknown } }).data?.type === "string"
  );
}

function errorCode(error: { data: { type: string } }) {
  return error.data.type.includes("CANCELLED") ? USER_REJECTED : INVALID_INPUT;
}

export class PeraAdapter extends BaseWallet<PeraOptions> {
  private client: Promise<PeraWalletConnect> | null = null;

  constructor(params: AdapterConstructorParams<PeraOptions>) {
    super(params);
  }

  static override defaultMetadata: WalletMetadata = {
    name: "Pera",
    icon: ICON,
  };

  private async initializeClient(): Promise<PeraWalletConnect> {
    this.logger.info("Initializing client...");
    // Lazy so the connect bundle (and its DOM side effects) only loads when used.
    const { PeraWalletConnect } = await import("@perawallet/connect");
    const client = new PeraWalletConnect(this.options);

    // Fires when the wallet ends the session: a site revoked in the extension
    // or a WalletConnect session killed from the mobile app.
    client.on("disconnect", this.onDisconnect);

    this.logger.info("Client initialized");
    return client;
  }

  // The promise is cached so concurrent first calls (resumeSession racing a
  // click on Connect) share one client instead of each subscribing to window.pera.
  private getClient(): Promise<PeraWalletConnect> {
    // A failed load (e.g. a chunk that didn't download) is not cached.
    this.client ??= this.initializeClient().catch((error: unknown) => {
      this.client = null;
      throw error;
    });
    return this.client;
  }

  /**
   * Compatibility shim for adapters that still keep their WalletConnect v1
   * session in the shared `walletconnect` key. From connect 1.7 Pera never
   * touches that key, so whatever is in it belongs to the active wallet.
   *
   * Those adapters were written for when Pera shared the key too. When one
   * takes over from Pera, it first moves whatever is in the shared key to
   * `walletconnect-pera`, assuming the session there is Pera's, then restores
   * its own from `walletconnect-<its id>`. If Pera left that wallet's session
   * in the shared key, it would be filed under Pera's name and lost. Moving it
   * to `walletconnect-<its id>` first means the round trip puts it back.
   *
   * Delete this once those adapters stop special-casing Pera.
   */
  private stashSharedWalletConnectSession(): void {
    const activeWallet = this.store.getActiveWallet();
    if (!activeWallet || !SHARED_WALLETCONNECT_WALLETS.has(activeWallet)) return;
    if (typeof localStorage === "undefined") return;

    const session = localStorage.getItem(SHARED_WALLETCONNECT_KEY);
    if (session) {
      localStorage.setItem(`${SHARED_WALLETCONNECT_KEY}-${activeWallet}`, session);
      localStorage.removeItem(SHARED_WALLETCONNECT_KEY);
      this.logger.debug(`Stashed ${activeWallet}'s WalletConnect session`);
    }
  }

  private toWalletAccounts(addresses: string[]): WalletAccount[] {
    return addresses.map((address, idx) => ({
      name: `${this.metadata.name} Account ${idx + 1}`,
      address,
    }));
  }

  public connect = async (): Promise<WalletAccount[]> => {
    this.logger.info("Connecting...");
    const client = await this.getClient();
    const accounts = await client.connect();

    if (accounts.length === 0) {
      this.logger.error("No accounts found!");
      throw new Error("No accounts found!");
    }

    // Only once Pera is taking over: a cancelled connect leaves the other wallet as it was.
    this.stashSharedWalletConnectSession();

    const walletAccounts = this.toWalletAccounts(accounts);
    const walletState: WalletState = {
      accounts: walletAccounts,
      activeAccount: walletAccounts[0]!,
    };

    this.store.addWallet(walletState);

    this.logger.info("Connected successfully", walletState);
    return walletAccounts;
  };

  public disconnect = async (): Promise<void> => {
    this.logger.info("Disconnecting...");
    const client = await this.getClient();
    await client.disconnect();
    this.onDisconnect();
    this.logger.info("Disconnected");
  };

  public override setActive = (): void => {
    this.logger.info(`Set active wallet: ${this.id}`);
    this.stashSharedWalletConnectSession();
    this.store.setActive();
  };

  public resumeSession = async (): Promise<void> => {
    try {
      const walletState = this.store.getWalletState();

      // Inside Pera's in-app (Discover) browser, connect without a click when
      // no other wallet holds the session. Same check as
      // `PeraWalletConnect.isPeraDiscoverBrowser`, done here so ordinary page
      // loads don't pay for loading the connect bundle.
      if (
        !walletState &&
        !this.store.getActiveWallet() &&
        typeof window !== "undefined" &&
        window.navigator?.userAgent.includes("pera")
      ) {
        this.logger.info("Pera Discover browser detected, attempting auto-connect...");
        try {
          await this.connect();
          this.logger.info("Auto-connect successful");
        } catch (error) {
          this.logger.warn("Auto-connect failed:", (error as Error).message);
        }
        return;
      }

      if (!walletState) {
        this.logger.info("No session to resume");
        return;
      }

      this.logger.info("Resuming session...");

      const client = await this.getClient();
      const accounts = await client.reconnectSession();

      if (accounts.length === 0) {
        this.logger.error("No accounts found!");
        throw new Error("No accounts found!");
      }

      const walletAccounts = this.toWalletAccounts(accounts);

      if (!compareAccounts(walletAccounts, walletState.accounts)) {
        this.logger.warn("Session accounts mismatch, updating accounts", {
          prev: walletState.accounts,
          current: walletAccounts,
        });
        this.store.setAccounts(walletAccounts);
      }
      this.logger.info("Session resumed successfully");
    } catch (error) {
      this.logger.error("Error resuming session:", (error as Error).message);
      this.onDisconnect();
      throw error;
    }
  };

  private processTxns(
    txnGroup: algosdk.Transaction[],
    indexesToSign?: number[],
  ): SignerTransaction[] {
    return txnGroup.map((txn, index) => {
      const isIndexMatch = !indexesToSign || indexesToSign.includes(index);
      const canSignTxn = this.addresses.includes(txn.sender.toString());

      return isIndexMatch && canSignTxn ? { txn } : { txn, signers: [] };
    });
  }

  private processEncodedTxns(
    txnGroup: Uint8Array[],
    indexesToSign?: number[],
  ): SignerTransaction[] {
    return txnGroup.map((txnBuffer, index) => {
      const isSigned = isSignedTxn(algosdk.msgpackRawDecode(txnBuffer));
      const txn = isSigned
        ? algosdk.decodeSignedTransaction(txnBuffer).txn
        : algosdk.decodeUnsignedTransaction(txnBuffer);

      const isIndexMatch = !indexesToSign || indexesToSign.includes(index);
      const canSignTxn = !isSigned && this.addresses.includes(txn.sender.toString());

      return isIndexMatch && canSignTxn ? { txn } : { txn, signers: [] };
    });
  }

  public signTransactions = async <T extends algosdk.Transaction[] | Uint8Array[]>(
    txnGroup: T | T[],
    indexesToSign?: number[],
  ): Promise<(Uint8Array | null)[]> => {
    try {
      this.logger.debug("Signing transactions...", { txnGroup, indexesToSign });

      const txnsToSign = isTransactionArray(txnGroup)
        ? this.processTxns(flattenTxnGroup(txnGroup), indexesToSign)
        : this.processEncodedTxns(flattenTxnGroup(txnGroup as Uint8Array[]), indexesToSign);

      const client = await this.getClient();
      const signedTxns = await client.signTransaction([txnsToSign]);
      const expected = txnsToSign.filter(txn => !txn.signers).length;

      // The wallet returns only the transactions it signed, in group order.
      // A short or long answer can't be mapped back onto the group safely.
      if (signedTxns.length !== expected) {
        throw new SignTxnsError(
          `Expected ${expected} signed transaction(s) from the wallet but received ${signedTxns.length}`,
          INVALID_INPUT,
        );
      }

      // ARC-0001: null in the slots the wallet was not asked to sign
      let next = 0;
      const result = txnsToSign.map(txn => (txn.signers ? null : signedTxns[next++]!));

      this.logger.debug("Transactions signed successfully", result);
      return result;
    } catch (error) {
      if (isPeraWalletConnectError(error)) {
        this.logger.error("Error signing transactions:", error.message, `(${error.data.type})`);
        throw new SignTxnsError(error.message, errorCode(error), error.data);
      }
      this.logger.error("Error signing transactions:", (error as Error).message);
      throw error;
    }
  };

  public override canSignData = true;

  public override signData = async (
    data: string,
    metadata: StdSignMetadata,
  ): Promise<StdSignDataResponse> => {
    try {
      this.logger.debug("Signing data...", { data, metadata });

      // Rekey-aware: use-wallet resolves the auth address on its own algod.
      const stdSignData = await this.createStdSignData(data);
      const client = await this.getClient();
      const result = await client.signArc60Data(stdSignData, metadata);

      this.logger.debug("Data signed successfully", result);
      return result;
    } catch (error) {
      if (isPeraWalletConnectError(error)) {
        this.logger.error("Error signing data:", error.message, `(${error.data.type})`);
        throw new SignDataError(error.message, errorCode(error), error.data);
      }
      this.logger.error("Unknown error signing data:", error);
      throw error;
    }
  };
}
