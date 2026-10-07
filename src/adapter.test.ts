import algosdk from "algosdk";
import {
  createTestHarness,
  type State,
  type Store,
  type WalletState,
} from "@txnlab/use-wallet/testing";
import { ScopeType, type AdapterStoreAccessor } from "@txnlab/use-wallet/adapter";
import { PeraAdapter } from "./adapter";
import { pera, WALLET_ID } from "./index";

const mockPeraWallet = {
  connect: vi.fn(),
  reconnectSession: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(),
  signArc60Data: vi.fn(),
  on: vi.fn(),
};

const PeraWalletConnect = vi.fn(function () {
  return mockPeraWallet;
});

vi.mock("@perawallet/connect", () => ({ PeraWalletConnect }));

function peraError(message: string, type: string) {
  return Object.assign(new Error(message), { data: { type } });
}

function createWallet(
  store: AdapterStoreAccessor,
  getAlgodClient: () => unknown = () => ({}),
  options?: Record<string, unknown>,
): PeraAdapter {
  return new PeraAdapter({
    id: WALLET_ID,
    metadata: PeraAdapter.defaultMetadata,
    store,
    subscribe: vi.fn(),
    getAlgodClient: getAlgodClient as never,
    options,
  });
}

function emitWalletDisconnect() {
  const handler = mockPeraWallet.on.mock.calls.find(([event]) => event === "disconnect")?.[1];
  expect(handler).toBeDefined();
  handler();
}

describe("pera()", () => {
  it("returns an adapter config with the pera id, Pera metadata and supported networks", () => {
    const config = pera();

    expect(config.id).toBe("pera");
    expect(config.Adapter).toBe(PeraAdapter);
    expect(config.metadata.name).toBe("Pera");
    expect(config.metadata.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(config.options).toBeUndefined();
    expect(config.capabilities).toEqual({ supportedNetworks: ["mainnet", "testnet"] });
  });

  it("separates metadata overrides from the options passed to PeraWalletConnect", () => {
    const config = pera({ shouldShowSignTxnToast: false, metadata: { name: "Pera Wallet" } });

    expect(config.metadata.name).toBe("Pera Wallet");
    expect(config.options).toEqual({ shouldShowSignTxnToast: false });
  });
});

describe("PeraAdapter", () => {
  let wallet: PeraAdapter;
  let store: Store<State>;
  let accessor: AdapterStoreAccessor;

  const account1 = { name: "Pera Account 1", address: "mockAddress1" };
  const account2 = { name: "Pera Account 2", address: "mockAddress2" };

  function withState(state: Partial<State>) {
    const harness = createTestHarness(WALLET_ID, state);
    store = harness.store;
    accessor = harness.accessor;
    wallet = createWallet(accessor);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    withState({});
  });

  describe("client", () => {
    it("is created lazily, once, with the adapter options", async () => {
      wallet = createWallet(accessor, undefined, { chainId: 416_002 });
      expect(PeraWalletConnect).not.toHaveBeenCalled();

      mockPeraWallet.connect.mockResolvedValue([account1.address]);
      await wallet.connect();
      await wallet.connect();

      expect(PeraWalletConnect).toHaveBeenCalledTimes(1);
      expect(PeraWalletConnect).toHaveBeenCalledWith({ chainId: 416_002 });
    });

    it("retries creating the client after a failed attempt", async () => {
      PeraWalletConnect.mockImplementationOnce(function () {
        throw new Error("Failed to load");
      });
      mockPeraWallet.connect.mockResolvedValue([account1.address]);

      await expect(wallet.connect()).rejects.toThrow("Failed to load");
      await expect(wallet.connect()).resolves.toHaveLength(1);
    });

    it("shares one client between concurrent first calls", async () => {
      mockPeraWallet.connect.mockResolvedValue([account1.address]);

      await Promise.all([wallet.connect(), wallet.connect()]);

      expect(PeraWalletConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("connect", () => {
    it("returns accounts and adds the wallet to the store", async () => {
      mockPeraWallet.connect.mockResolvedValueOnce([account1.address, account2.address]);

      const accounts = await wallet.connect();

      expect(wallet.isConnected).toBe(true);
      expect(accounts).toEqual([account1, account2]);
      expect(store.state.wallets[WALLET_ID]).toEqual({
        accounts: [account1, account2],
        activeAccount: account1,
      });
    });

    it("rethrows a connect failure without touching the store", async () => {
      mockPeraWallet.connect.mockRejectedValueOnce(new Error("Auth error"));

      await expect(wallet.connect()).rejects.toThrow("Auth error");
      expect(store.state.wallets[WALLET_ID]).toBeUndefined();
    });

    it("throws when the wallet returns no accounts", async () => {
      mockPeraWallet.connect.mockResolvedValueOnce([]);

      await expect(wallet.connect()).rejects.toThrow("No accounts found!");
      expect(store.state.wallets[WALLET_ID]).toBeUndefined();
    });
  });

  describe("disconnect", () => {
    it("disconnects the client and removes the wallet from the store", async () => {
      mockPeraWallet.connect.mockResolvedValueOnce([account1.address]);
      await wallet.connect();

      await wallet.disconnect();

      expect(mockPeraWallet.disconnect).toHaveBeenCalled();
      expect(store.state.wallets[WALLET_ID]).toBeUndefined();
    });

    it("keeps the wallet in the store when client.disconnect fails", async () => {
      mockPeraWallet.connect.mockResolvedValueOnce([account1.address]);
      mockPeraWallet.disconnect.mockRejectedValueOnce(new Error("Disconnect error"));
      await wallet.connect();

      await expect(wallet.disconnect()).rejects.toThrow("Disconnect error");
      expect(wallet.isConnected).toBe(true);
    });
  });

  describe("wallet-side disconnect", () => {
    // The 1.6 adapter listened on `client.connector`, which is null for
    // extension sessions, so revoking the site in the extension went unnoticed.
    it("removes the wallet when PeraWalletConnect emits disconnect", async () => {
      mockPeraWallet.connect.mockResolvedValueOnce([account1.address]);
      await wallet.connect();

      emitWalletDisconnect();

      expect(store.state.wallets[WALLET_ID]).toBeUndefined();
    });
  });

  describe("sharing the WalletConnect v1 key with other wallets", () => {
    // Defly is the use-wallet adapter that still keeps its session in the shared key.
    const otherWallet = "defly";
    const otherSession = '{"bridge":"https://bridge.example.com","accounts":["OTHER"]}';

    it("stashes the active wallet's shared session when Pera connects", async () => {
      withState({
        activeWallet: otherWallet,
        wallets: { [otherWallet]: { accounts: [account2], activeAccount: account2 } },
      });
      localStorage.setItem("walletconnect", otherSession);
      mockPeraWallet.connect.mockResolvedValueOnce([account1.address]);

      await wallet.connect();

      expect(localStorage.getItem("walletconnect")).toBeNull();
      expect(localStorage.getItem(`walletconnect-${otherWallet}`)).toBe(otherSession);
    });

    it("leaves the other wallet's session in place when the Pera connect is cancelled", async () => {
      withState({
        activeWallet: otherWallet,
        wallets: { [otherWallet]: { accounts: [account2], activeAccount: account2 } },
      });
      localStorage.setItem("walletconnect", otherSession);
      mockPeraWallet.connect.mockRejectedValueOnce(new Error("Modal closed"));

      await expect(wallet.connect()).rejects.toThrow("Modal closed");

      expect(localStorage.getItem("walletconnect")).toBe(otherSession);
      expect(localStorage.getItem(`walletconnect-${otherWallet}`)).toBeNull();
    });

    it("stashes the other wallet's session when Pera becomes the active wallet", () => {
      withState({
        activeWallet: otherWallet,
        wallets: {
          [otherWallet]: { accounts: [account2], activeAccount: account2 },
          [WALLET_ID]: { accounts: [account1], activeAccount: account1 },
        },
      });
      localStorage.setItem("walletconnect", otherSession);

      wallet.setActive();

      expect(store.state.activeWallet).toBe(WALLET_ID);
      expect(localStorage.getItem("walletconnect")).toBeNull();
      expect(localStorage.getItem(`walletconnect-${otherWallet}`)).toBe(otherSession);
    });

    it("leaves the shared key alone when the active wallet doesn't use it", async () => {
      withState({
        activeWallet: "lute",
        wallets: { lute: { accounts: [account2], activeAccount: account2 } },
      });
      localStorage.setItem("walletconnect", otherSession);
      mockPeraWallet.connect.mockResolvedValueOnce([account1.address]);

      await wallet.connect();

      expect(localStorage.getItem("walletconnect")).toBe(otherSession);
      expect(localStorage.getItem(`walletconnect-${otherWallet}`)).toBeNull();
    });

    it("resumes its own session while another wallet is active", async () => {
      withState({
        activeWallet: otherWallet,
        wallets: {
          [otherWallet]: { accounts: [account2], activeAccount: account2 },
          [WALLET_ID]: { accounts: [account1], activeAccount: account1 },
        },
      });
      mockPeraWallet.reconnectSession.mockResolvedValueOnce([account1.address]);

      await wallet.resumeSession();

      expect(mockPeraWallet.reconnectSession).toHaveBeenCalled();
    });
  });

  describe("resumeSession", () => {
    const walletState: WalletState = { accounts: [account1], activeAccount: account1 };

    it("does nothing when there is no session", async () => {
      await wallet.resumeSession();

      expect(PeraWalletConnect).not.toHaveBeenCalled();
      expect(wallet.isConnected).toBe(false);
    });

    it("resumes a stored session", async () => {
      withState({ wallets: { [WALLET_ID]: walletState } });
      mockPeraWallet.reconnectSession.mockResolvedValueOnce([account1.address]);

      await wallet.resumeSession();

      expect(store.state.wallets[WALLET_ID]).toEqual(walletState);
    });

    it("updates the store when the wallet reports different accounts", async () => {
      withState({
        wallets: { [WALLET_ID]: { accounts: [account1, account2], activeAccount: account1 } },
      });
      mockPeraWallet.reconnectSession.mockResolvedValueOnce(["mockAddress2"]);

      await wallet.resumeSession();

      expect(store.state.wallets[WALLET_ID]).toEqual({
        accounts: [{ name: "Pera Account 1", address: "mockAddress2" }],
        activeAccount: { name: "Pera Account 1", address: "mockAddress2" },
      });
    });

    it("removes the wallet and rethrows when reconnectSession fails", async () => {
      withState({ wallets: { [WALLET_ID]: walletState } });
      mockPeraWallet.reconnectSession.mockRejectedValueOnce(new Error("Reconnect error"));

      await expect(wallet.resumeSession()).rejects.toThrow("Reconnect error");
      expect(store.state.wallets[WALLET_ID]).toBeUndefined();
    });

    it("removes the wallet and throws when the wallet returns no accounts", async () => {
      withState({ wallets: { [WALLET_ID]: walletState } });
      mockPeraWallet.reconnectSession.mockResolvedValueOnce([]);

      await expect(wallet.resumeSession()).rejects.toThrow("No accounts found!");
      expect(store.state.wallets[WALLET_ID]).toBeUndefined();
    });
  });

  describe("signing transactions", () => {
    const connectedAcct1 = "7ZUECA7HFLZTXENRV24SHLU4AVPUTMTTDUFUBNBD64C73F3UHRTHAIOF6Q";
    const connectedAcct2 = "GD64YIY3TWGDMCNPP553DZPPR6LDUSFQOIJVFDPPXWEG3FVOJCCDBBHU5A";
    const notConnectedAcct = "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4";

    const makePayTxn = ({ amount = 1000, sender = connectedAcct1, receiver = connectedAcct2 }) =>
      new algosdk.Transaction({
        type: algosdk.TransactionType.pay,
        sender,
        suggestedParams: {
          fee: 0,
          firstValid: 51,
          lastValid: 61,
          minFee: 1000,
          genesisID: "mainnet-v1.0",
        },
        paymentParams: { receiver, amount },
      });

    const txn1 = makePayTxn({ amount: 1000 });
    const txn2 = makePayTxn({ amount: 2000 });
    const txn3 = makePayTxn({ amount: 3000 });
    const txn4 = makePayTxn({ amount: 4000 });

    const sTxn = new Uint8Array([1, 2, 3, 4]);

    beforeEach(async () => {
      mockPeraWallet.connect.mockResolvedValueOnce([connectedAcct1, connectedAcct2]);
      await wallet.connect();
    });

    describe("signTransactions", () => {
      it("signs a single algosdk.Transaction", async () => {
        mockPeraWallet.signTransaction.mockResolvedValueOnce([sTxn]);

        await expect(wallet.signTransactions([txn1])).resolves.toEqual([sTxn]);
        expect(mockPeraWallet.signTransaction).toHaveBeenCalledWith([[{ txn: txn1 }]]);
      });

      it("flattens multiple groups into one request", async () => {
        const [g1txn1, g1txn2] = algosdk.assignGroupID([txn1, txn2]);
        const [g2txn1, g2txn2] = algosdk.assignGroupID([txn3, txn4]);
        mockPeraWallet.signTransaction.mockResolvedValueOnce([sTxn, sTxn, sTxn, sTxn]);

        await wallet.signTransactions([
          [g1txn1!, g1txn2!],
          [g2txn1!, g2txn2!],
        ]);

        expect(mockPeraWallet.signTransaction).toHaveBeenCalledWith([
          [{ txn: g1txn1 }, { txn: g1txn2 }, { txn: g2txn1 }, { txn: g2txn2 }],
        ]);
      });

      it("decodes encoded transactions and skips ones that are already signed", async () => {
        const signed = txn2.signTxn(algosdk.generateAccount().sk);
        mockPeraWallet.signTransaction.mockResolvedValueOnce([sTxn]);

        await expect(wallet.signTransactions([txn1.toByte(), signed])).resolves.toEqual([
          sTxn,
          null,
        ]);
        expect(mockPeraWallet.signTransaction).toHaveBeenCalledWith([
          [
            { txn: algosdk.decodeUnsignedTransaction(txn1.toByte()) },
            { txn: algosdk.decodeSignedTransaction(signed).txn, signers: [] },
          ],
        ]);
      });

      it("only asks for the slots in indexesToSign and returns null for the rest", async () => {
        const group = algosdk.assignGroupID([txn1, txn2, txn3, txn4]);
        mockPeraWallet.signTransaction.mockResolvedValueOnce([sTxn, sTxn, sTxn]);

        await expect(wallet.signTransactions(group, [0, 1, 3])).resolves.toEqual([
          sTxn,
          sTxn,
          null,
          sTxn,
        ]);
        expect(mockPeraWallet.signTransaction).toHaveBeenCalledWith([
          [{ txn: group[0] }, { txn: group[1] }, { txn: group[2], signers: [] }, { txn: group[3] }],
        ]);
      });

      it("only asks for transactions sent from connected accounts", async () => {
        const group = algosdk.assignGroupID([
          makePayTxn({ sender: connectedAcct1 }),
          makePayTxn({ sender: notConnectedAcct }),
          makePayTxn({ sender: connectedAcct2 }),
        ]);
        mockPeraWallet.signTransaction.mockResolvedValueOnce([sTxn, sTxn]);

        await expect(wallet.signTransactions(group)).resolves.toEqual([sTxn, null, sTxn]);
        expect(mockPeraWallet.signTransaction).toHaveBeenCalledWith([
          [{ txn: group[0] }, { txn: group[1], signers: [] }, { txn: group[2] }],
        ]);
      });

      it("throws rather than misalign the result when the wallet returns the wrong count", async () => {
        mockPeraWallet.signTransaction.mockResolvedValueOnce([sTxn]);

        await expect(wallet.signTransactions([txn1, txn2])).rejects.toMatchObject({
          name: "SignTxnsError",
          code: 4300,
        });
      });

      it("maps a cancelled request to SignTxnsError 4001", async () => {
        mockPeraWallet.signTransaction.mockRejectedValueOnce(
          peraError("Cancelled", "SIGN_TXN_CANCELLED"),
        );

        await expect(wallet.signTransactions([txn1])).rejects.toMatchObject({
          name: "SignTxnsError",
          message: "Cancelled",
          code: 4001,
          data: { type: "SIGN_TXN_CANCELLED" },
        });
      });

      // WalletConnect v1 drops the wallet's error code, so a rejection in the
      // mobile app reaches connect as a plain SIGN_TRANSACTIONS with this message.
      it("maps a rejection in Pera Mobile to SignTxnsError 4001", async () => {
        mockPeraWallet.signTransaction.mockRejectedValueOnce(
          peraError("User rejected", "SIGN_TRANSACTIONS"),
        );

        await expect(wallet.signTransactions([txn1])).rejects.toMatchObject({
          name: "SignTxnsError",
          message: "User rejected",
          code: 4001,
          data: { type: "SIGN_TRANSACTIONS" },
        });
      });

      it("keeps other Pera Mobile failures at SignTxnsError 4300", async () => {
        mockPeraWallet.signTransaction.mockRejectedValueOnce(
          peraError("Failed to sign transaction", "SIGN_TRANSACTIONS"),
        );

        await expect(wallet.signTransactions([txn1])).rejects.toMatchObject({
          name: "SignTxnsError",
          code: 4300,
        });
      });

      it("maps other Pera errors to SignTxnsError 4300", async () => {
        mockPeraWallet.signTransaction.mockRejectedValueOnce(
          peraError("Wrong network", "SIGN_TXN_NETWORK_MISMATCH"),
        );

        await expect(wallet.signTransactions([txn1])).rejects.toMatchObject({
          name: "SignTxnsError",
          code: 4300,
        });
      });

      it("rethrows unrecognised errors unchanged", async () => {
        const error = new Error("Network failure");
        mockPeraWallet.signTransaction.mockRejectedValueOnce(error);

        await expect(wallet.signTransactions([txn1])).rejects.toBe(error);
      });
    });

    describe("transactionSigner", () => {
      it("returns only the signed transactions", async () => {
        const group = algosdk.assignGroupID([txn1, txn2]);
        mockPeraWallet.signTransaction.mockResolvedValueOnce([sTxn]);

        await expect(wallet.transactionSigner(group, [1])).resolves.toEqual([sTxn]);
        expect(mockPeraWallet.signTransaction).toHaveBeenCalledWith([
          [{ txn: group[0], signers: [] }, { txn: group[1] }],
        ]);
      });
    });
  });

  describe("signData", () => {
    const connectedAcct1 = "7ZUECA7HFLZTXENRV24SHLU4AVPUTMTTDUFUBNBD64C73F3UHRTHAIOF6Q";
    const testDomain = "test.domain";
    const metadata = { scope: ScopeType.AUTH, encoding: "base64" };
    const mockAlgodClient = { accountInformation: vi.fn() };

    const sha256 = async (data: BufferSource) =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", data));

    beforeEach(async () => {
      vi.stubGlobal("location", { host: testDomain });
      mockAlgodClient.accountInformation.mockReturnValue({ do: vi.fn().mockResolvedValue({}) });

      wallet = createWallet(accessor, () => mockAlgodClient);
      mockPeraWallet.connect.mockResolvedValueOnce([connectedAcct1]);
      await wallet.connect();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("supports signData", () => {
      expect(wallet.canSignData).toBe(true);
    });

    it("builds the ARC-60 payload and passes it to signArc60Data", async () => {
      const expected = {
        data: "test-data",
        signer: algosdk.Address.fromString(connectedAcct1).publicKey,
        domain: testDomain,
        authenticatorData: await sha256(new TextEncoder().encode(testDomain)),
      };
      const response = { ...expected, signature: new Uint8Array([7, 8, 9]) };
      mockPeraWallet.signArc60Data.mockResolvedValueOnce(response);

      await expect(wallet.signData("test-data", metadata)).resolves.toEqual(response);
      expect(mockPeraWallet.signArc60Data).toHaveBeenCalledWith(expected, metadata);
    });

    it("signs with the auth address for rekeyed accounts", async () => {
      const authAddr = new algosdk.Address(new Uint8Array(32).fill(7));
      mockAlgodClient.accountInformation.mockReturnValue({
        do: vi.fn().mockResolvedValue({ authAddr }),
      });
      mockPeraWallet.signArc60Data.mockResolvedValueOnce({});

      await wallet.signData("test-data", metadata);

      expect(mockPeraWallet.signArc60Data).toHaveBeenCalledWith(
        expect.objectContaining({ signer: authAddr.publicKey }),
        metadata,
      );
    });

    it("maps a cancelled request to SignDataError 4001", async () => {
      mockPeraWallet.signArc60Data.mockRejectedValueOnce(
        peraError("Sign data cancelled", "SIGN_DATA_CANCELLED"),
      );

      await expect(wallet.signData("test-data", metadata)).rejects.toMatchObject({
        name: "SignDataError",
        message: "Sign data cancelled",
        code: 4001,
      });
    });

    it("maps a rejection in Pera Mobile to SignDataError 4001", async () => {
      mockPeraWallet.signArc60Data.mockRejectedValueOnce(peraError("User rejected", "SIGN_DATA"));

      await expect(wallet.signData("test-data", metadata)).rejects.toMatchObject({
        name: "SignDataError",
        message: "User rejected",
        code: 4001,
        data: { type: "SIGN_DATA" },
      });
    });

    it("keeps other Pera Mobile failures at SignDataError 4300", async () => {
      mockPeraWallet.signArc60Data.mockRejectedValueOnce(
        peraError("Failed to sign ARC-60 data", "SIGN_DATA"),
      );

      await expect(wallet.signData("test-data", metadata)).rejects.toMatchObject({
        name: "SignDataError",
        code: 4300,
      });
    });

    it("maps other Pera errors to SignDataError 4300", async () => {
      mockPeraWallet.signArc60Data.mockRejectedValueOnce(
        peraError("Domain mismatch", "SIGN_DATA_DOMAIN_MISMATCH"),
      );

      await expect(wallet.signData("test-data", metadata)).rejects.toMatchObject({
        name: "SignDataError",
        code: 4300,
      });
    });

    it("rethrows unrecognised errors unchanged", async () => {
      const error = new Error("Network failure");
      mockPeraWallet.signArc60Data.mockRejectedValueOnce(error);

      await expect(wallet.signData("test-data", metadata)).rejects.toBe(error);
    });
  });
});
