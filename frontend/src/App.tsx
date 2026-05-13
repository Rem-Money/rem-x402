import { useEffect, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  usePublicClient,
  useWalletClient,
  useChainId,
} from "wagmi";
import { formatUnits, erc20Abi, maxUint256 } from "viem";
import { useX402 } from "./useX402";
import { SERVER_URL, PERMIT2_ADDRESS } from "./config";

interface ServerConfig {
  token: {
    address: `0x${string}`;
    name: string;
    symbol: string;
    decimals: number;
    eip3009Enabled: boolean;
  };
  price: string;
  payTo: string;
  network: string;
}

const STATUS_LABELS: Record<string, string> = {
  idle: "",
  fetching: "Requesting resource...",
  signing: "Sign the payment in your wallet...",
  sending: "Sending payment to server...",
  settling: "Settling on-chain...",
  done: "Done!",
  error: "Error",
};

export function App() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();

  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [permit2Approved, setPermit2Approved] = useState(true);
  const [approving, setApproving] = useState(false);
  const { status, resource, settlement, error, pay } = useX402();

  useEffect(() => {
    fetch(`${SERVER_URL}/config`)
      .then((r) => r.json())
      .then(setServerConfig)
      .catch((e) => console.error("Failed to fetch server config:", e));
  }, []);

  useEffect(() => {
    if (!address || !publicClient || !serverConfig) return;

    publicClient
      .readContract({
        address: serverConfig.token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })
      .then((bal) =>
        setBalance(formatUnits(bal, serverConfig.token.decimals))
      )
      .catch(() => setBalance("?"));

    if (!serverConfig.token.eip3009Enabled) {
      publicClient
        .readContract({
          address: serverConfig.token.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, PERMIT2_ADDRESS],
        })
        .then((allowance) => {
          setPermit2Approved(allowance >= BigInt(serverConfig.price));
        })
        .catch(() => setPermit2Approved(false));
    }
  }, [address, publicClient, serverConfig, chainId]);

  async function approvePermit2() {
    if (!walletClient || !serverConfig) return;
    setApproving(true);
    try {
      const hash = await walletClient.writeContract({
        address: serverConfig.token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2_ADDRESS, maxUint256],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      setPermit2Approved(true);
    } catch (e: any) {
      console.error("Approval failed:", e);
    } finally {
      setApproving(false);
    }
  }

  const explorerBase = "https://sepolia.basescan.org/tx/";

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>x402 Payment Demo</h1>

        {serverConfig ? (
          <div style={styles.info}>
            <div style={styles.row}>
              <span style={styles.label}>Token</span>
              <span>
                {serverConfig.token.symbol} (
                <code style={styles.code}>
                  {serverConfig.token.address.slice(0, 6)}...
                  {serverConfig.token.address.slice(-4)}
                </code>
                )
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Price</span>
              <span>
                {formatUnits(
                  BigInt(serverConfig.price),
                  serverConfig.token.decimals
                )}{" "}
                {serverConfig.token.symbol}
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Network</span>
              <span>Base Sepolia</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Method</span>
              <span>
                {serverConfig.token.eip3009Enabled ? "EIP-3009" : "Permit2"}
              </span>
            </div>
          </div>
        ) : (
          <p style={styles.muted}>Loading server config...</p>
        )}

        <div style={styles.connectWrapper}>
          <ConnectButton />
        </div>

        {isConnected && balance !== null && (
          <p style={styles.balance}>
            Balance: {balance} {serverConfig?.token.symbol}
          </p>
        )}

        {isConnected &&
          serverConfig &&
          !serverConfig.token.eip3009Enabled &&
          !permit2Approved && (
            <button
              style={{ ...styles.button, ...styles.approveButton }}
              onClick={approvePermit2}
              disabled={approving}
            >
              {approving
                ? "Approving..."
                : `Approve ${serverConfig.token.symbol} for Permit2`}
            </button>
          )}

        {isConnected && serverConfig && (permit2Approved || serverConfig.token.eip3009Enabled) && (
          <button
            style={styles.button}
            onClick={pay}
            disabled={status !== "idle" && status !== "done" && status !== "error"}
          >
            {status === "idle" || status === "done" || status === "error"
              ? `Pay ${formatUnits(
                  BigInt(serverConfig.price),
                  serverConfig.token.decimals
                )} ${serverConfig.token.symbol} & Get Resource`
              : STATUS_LABELS[status]}
          </button>
        )}

        {status !== "idle" && status !== "done" && status !== "error" && (
          <p style={styles.status}>{STATUS_LABELS[status]}</p>
        )}

        {error && <p style={styles.error}>{error}</p>}

        {resource && (
          <div style={styles.result}>
            <h3 style={styles.resultTitle}>Resource Received</h3>
            <pre style={styles.pre}>{JSON.stringify(resource, null, 2)}</pre>
          </div>
        )}

        {settlement?.transaction && (
          <div style={styles.txBox}>
            <span style={styles.label}>Transaction</span>
            <a
              href={`${explorerBase}${settlement.transaction}`}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.link}
            >
              {settlement.transaction.slice(0, 10)}...
              {settlement.transaction.slice(-8)}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0a0a0a",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
    color: "#e0e0e0",
    padding: 20,
  },
  card: {
    background: "#141414",
    border: "1px solid #2a2a2a",
    borderRadius: 12,
    padding: 32,
    maxWidth: 480,
    width: "100%",
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    margin: "0 0 24px 0",
    color: "#fff",
  },
  info: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 24,
    padding: 16,
    background: "#1a1a1a",
    borderRadius: 8,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 14,
  },
  label: {
    color: "#888",
    fontSize: 13,
  },
  code: {
    fontSize: 12,
    color: "#aaa",
  },
  muted: { color: "#666", fontSize: 14 },
  connectWrapper: { marginBottom: 16 },
  balance: {
    fontSize: 14,
    color: "#aaa",
    margin: "0 0 16px 0",
  },
  button: {
    width: "100%",
    padding: "12px 16px",
    fontSize: 15,
    fontWeight: 600,
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    background: "#2563eb",
    color: "#fff",
    marginBottom: 12,
  },
  approveButton: {
    background: "#7c3aed",
  },
  status: {
    fontSize: 13,
    color: "#60a5fa",
    margin: "0 0 8px 0",
  },
  error: {
    fontSize: 13,
    color: "#ef4444",
    margin: "0 0 8px 0",
  },
  result: {
    marginTop: 16,
    padding: 16,
    background: "#0d1f0d",
    border: "1px solid #1a3a1a",
    borderRadius: 8,
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#4ade80",
    margin: "0 0 8px 0",
  },
  pre: {
    fontSize: 12,
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    color: "#a3e635",
  },
  txBox: {
    marginTop: 12,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    background: "#1a1a1a",
    borderRadius: 8,
    fontSize: 13,
  },
  link: {
    color: "#60a5fa",
    textDecoration: "none",
  },
};
