// Plain wagmi config: the app connects external wallets directly (no Privy).
// Connectors are browser-injected wallets (MetaMask / Rabby / Brave / Coinbase
// extension), the Coinbase Wallet SDK, and optionally WalletConnect for mobile.
// The Farcaster Mini App connector stays registered so that inside a Farcaster
// client the host wallet can auto-connect; in a normal browser it stays inert.
// Every existing contract call keeps using the same wagmi hooks (useAccount /
// useReadContract / useWriteContract / useSignMessage ...), unchanged.
import { http, fallback, createConfig } from "wagmi";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { robinhoodChain, ROBINHOOD_RPC_URL } from "./chain";

// Reads go through our profileapi RPC proxy, which forwards to a keyed endpoint
// (reliable, no key in the browser). Public RPCs choke on the marketplace's
// bursty multicalls and wide eth_getLogs, which left NFT grids and the chart
// empty. The public Robinhood Chain node stays as a fallback so anything the
// proxy blocks still resolves.
const PROFILE_API = (process.env.NEXT_PUBLIC_PROFILE_API || "").replace(/\/$/, "");
const RPC_PROXY = PROFILE_API ? `${PROFILE_API}/api/rpc` : "/api/rpc";

// WalletConnect is opt-in: only wired when a project id is provided. Passing an
// empty projectId to the connector throws, so we guard and simply skip it when
// unset (the app still works with browser-injected + Coinbase, zero config).
const WC_PROJECT_ID = (process.env.NEXT_PUBLIC_WC_PROJECT_ID || "").trim();

const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet({ appName: "Hoodsea" }),
  ...(WC_PROJECT_ID
    ? [walletConnect({ projectId: WC_PROJECT_ID, showQrModal: true })]
    : []),
  farcasterMiniApp(),
];

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors,
  ssr: false,
  transports: {
    // NOTE: transport-level batch.multicall was tried but free endpoints reject
    // large auto-batched multicalls at ~60+ concurrent reads, which would break
    // list pages. For many-read flows use viem's explicit
    // client.multicall({ contracts, allowFailure }) instead (chunks reliably).
    [robinhoodChain.id]: fallback([
      http(RPC_PROXY),
      http(ROBINHOOD_RPC_URL),
    ]),
  },
});
