// Deploy AgentBeacon (and optionally MockAgentID) with ethers v6.
//
// Usage:
//   node scripts/deploy.js --network testnet --mock
//   node scripts/deploy.js --network testnet --registry 0xREGISTRY
//   node scripts/deploy.js --network mainnet --registry 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
//   node scripts/deploy.js --network local   --mock
//
// Options:
//   --network   testnet | mainnet | local        (default: testnet)
//   --registry  Agent ID registry address. With --mock a MockAgentID is
//               deployed first and used as the registry.
//   --key-file  JSON { address, privateKey }     (default: deployer.json)
//   --rpc       RPC URL override (or env RPC_URL)
//
// Writes build/deployment-<network>.json. The signer is always the project
// deployer from the key file — never a user wallet.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const root = path.join(__dirname, "..");

const NETWORKS = {
  testnet: { rpc: "https://data-seed-prebsc-1-s1.binance.org:8545/", chainId: 97 },
  mainnet: { rpc: "https://bsc-dataseed.binance.org", chainId: 56 },
  local: { rpc: "http://127.0.0.1:8545", chainId: null },
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  const network = arg("network", "testnet");
  const net = NETWORKS[network];
  if (!net) throw new Error(`unknown network: ${network}`);
  const rpc = arg("rpc", process.env.RPC_URL || net.rpc);

  const keyFile = path.resolve(root, arg("key-file", "deployer.json"));
  const { privateKey } = JSON.parse(fs.readFileSync(keyFile, "utf8"));

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const { chainId } = await provider.getNetwork();
  if (net.chainId && Number(chainId) !== net.chainId) {
    throw new Error(`chain mismatch: RPC is chain ${chainId}, expected ${net.chainId}`);
  }
  const deployerAddress = await wallet.getAddress();
  const balance = await provider.getBalance(deployerAddress);
  console.log(`network=${network} chainId=${chainId}`);
  console.log(`deployer=${deployerAddress} balance=${ethers.formatEther(balance)}`);

  const load = (name) => JSON.parse(fs.readFileSync(path.join(root, "build", `${name}.json`), "utf8"));
  const out = { network, chainId: Number(chainId), deployer: deployerAddress };

  // Explicit nonce management: some nodes report stale "pending" nonces to
  // back-to-back senders, which races consecutive deployments. Read the mined
  // count once and increment locally — deterministic on every network.
  let nonce = await provider.getTransactionCount(deployerAddress, "latest");

  let registry = arg("registry", null);
  if (has("mock")) {
    const mockArt = load("MockAgentID");
    const Mock = new ethers.ContractFactory(mockArt.abi, mockArt.bytecode, wallet);
    const mock = await Mock.deploy({ nonce: nonce++ });
    const mockRc = await mock.deploymentTransaction().wait();
    registry = mockRc.contractAddress; // receipt is authoritative (getAddress() can mispredict on some local chains)
    out.mockAgentID = registry;
    out.mockDeployTx = mock.deploymentTransaction().hash;
    console.log(`MockAgentID deployed: ${registry} (tx ${out.mockDeployTx})`);
  }
  if (!registry) throw new Error("pass --registry 0x... or --mock");

  const art = load("AgentBeacon");
  const Beacon = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  const beacon = await Beacon.deploy(registry, { nonce: nonce++ });
  const beaconRc = await beacon.deploymentTransaction().wait();
  out.registry = registry;
  out.beacon = beaconRc.contractAddress;
  out.beaconDeployTx = beacon.deploymentTransaction().hash;
  console.log(`AgentBeacon deployed: ${out.beacon} (tx ${out.beaconDeployTx})`);
  console.log(`registry (immutable): ${await beacon.agentIDRegistry()}`);

  const file = path.join(root, "build", `deployment-${network}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`saved ${file}`);
}

main().catch((e) => {
  console.error("deploy failed:", e.message);
  process.exit(1);
});
