// Compile AgentBeacon + MockAgentID with solc-js (standard JSON input).
// Saves build/input.json (the exact input — reuse it for BscScan verification),
// build/AgentBeacon.json and build/MockAgentID.json ({ abi, bytecode }).
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const input = {
  language: "Solidity",
  sources: {
    "AgentBeacon.sol": { content: read("contracts/AgentBeacon.sol") },
    "MockAgentID.sol": { content: read("contracts/MockAgentID.sol") },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: false,
    // Target Paris: solc 0.8.38's default (Cancun+) emits MCOPY, which
    // pre-Cancun EVMs reject with "invalid opcode" on string-returning
    // calls. Paris bytecode runs everywhere, BSC included.
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

fs.mkdirSync(path.join(root, "build"), { recursive: true });
fs.writeFileSync(path.join(root, "build", "input.json"), JSON.stringify(input, null, 2));

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((e) => e.severity === "error");
const warnings = (output.errors || []).filter((e) => e.severity === "warning");
for (const w of warnings) console.log("warning:", w.formattedMessage.trim());
if (errors.length) {
  for (const e of errors) console.error("error:", e.formattedMessage);
  process.exit(1);
}

for (const name of ["AgentBeacon", "MockAgentID"]) {
  const c = output.contracts[`${name}.sol`][name];
  const artifact = { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
  fs.writeFileSync(path.join(root, "build", `${name}.json`), JSON.stringify(artifact, null, 2));
  console.log(`${name}: runtime-size proxy (creation bytecode) = ${(c.evm.bytecode.object.length / 2).toLocaleString()} bytes`);
}
console.log("solc version:", solc.version());
console.log("OK — artifacts in build/");
