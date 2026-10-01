import { WalletManager } from "@txnlab/use-wallet";
import { pera } from "./index";

const mockPeraWallet = { connect: vi.fn(), disconnect: vi.fn(), on: vi.fn() };

vi.mock("@perawallet/connect", () => ({
  PeraWalletConnect: vi.fn(function () {
    return mockPeraWallet;
  }),
}));

// Wires the adapter into a real WalletManager rather than the test harness.
it("registers with WalletManager and stores the session under the pera key", async () => {
  const manager = new WalletManager({ wallets: [pera()] });
  const wallet = manager.getWallet("pera")!;
  mockPeraWallet.connect.mockResolvedValueOnce(["ADDRESS"]);

  expect(manager.wallets.map(w => w.id)).toEqual(["pera"]);

  await wallet.connect();

  expect(manager.activeWallet?.id).toBe("pera");
  expect(manager.store.state.wallets.pera?.accounts).toEqual([
    { name: "Pera Account 1", address: "ADDRESS" },
  ]);
});
