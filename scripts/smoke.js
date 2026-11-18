// Smoke-test a deployed AgentBeacon against build/deployment-<network>.json.
//
// Usage:
//   node scripts/smoke.js --network testnet           (single-day scenario)
//   node scripts/smoke.js --network local             (full multi-day scenario)
//
// On local chains (ganache) the script uses evm_increaseTime to walk through
// days: streak increments, streak reset after a gap, Spark badge claim at a
// 3-day streak, double-claim revert, soulbound transfer revert.
// On public testnet only same-day rules can be exercised; multi-day paths are
// reported as SKIPPED (they are covered by the local run).
//
// Users: user1 = project deployer (key file), user2 = a rehearsal wallet kept
// in build/smoke-user2.json (created on first run, funded by user1 when low),
// user3 = a fresh non-holder address that never receives a mock Agent ID.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const root = path.join(__dirname, "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

let passed = 0;
let failed = 0;
const ok = (label) => { passed++; console.log(`  PASS  ${label}`); };
const bad = (label, extra = "") => { failed++; console.log(`  FAIL  ${label} ${extra}`); };

async function expectOk(label, txPromise) {
  try {
    const tx = await txPromise;
    const rc = await tx.wait();
    if (rc.status !== 1) {
      bad(label, `— tx mined but reverted on-chain (tx ${rc.hash})`);
      return null;
    }
    ok(`${label} (tx ${rc.hash})`);
    return rc;
  } catch (e) {
    bad(label, `— unexpected error: ${e.shortMessage || e.message}`);
    return null;
  }
}

// Reason strings are read via a staticCall probe: some local nodes return no
// revert data on eth_estimateGas errors, but eth_call revert data decodes fine.
async function probeReason(staticPromise) {
  try {
    await staticPromise;
    return null; // did not revert
  } catch (e) {
    if (e.revert && e.revert.args && e.revert.args.length) return String(e.revert.args[0]);
    if (e.reason) return String(e.reason);
    return `${e.shortMessage || ""} ${e.message || ""}`;
  }
}

async function expectRevert(label, probeFn, needle) {
  // Probe-only: asserting a revert via eth_call (staticCall) is side-effect
  // free. Sending the real tx would burn a NonceManager nonce whenever the
  // send dies at gas estimation, gapping every later tx from that signer.
  const reason = await probeReason(probeFn());
  if (reason === null) {
    bad(label, "\u2014 staticCall succeeded but should have reverted");
    return;
  }
  if (needle && !reason.includes(needle)) {
    bad(label, `\u2014 reverted but reason was "${reason.slice(0, 120)}", expected "${needle}"`);
    return;
  }
  ok(`${label} (reverts as expected)`);
}

async function main() {
  const network = arg("network", "testnet");
  const dep = JSON.parse(fs.readFileSync(path.join(root, "build", `deployment-${network}.json`), "utf8"));
  const { privateKey } = JSON.parse(fs.readFileSync(path.join(root, "deployer.json"), "utf8"));

  const provider = new ethers.JsonRpcProvider(
    network === "local" ? "http://127.0.0.1:8545" : network === "mainnet"
      ? "https://bsc-dataseed.binance.org" : "https://data-seed-prebsc-1-s1.binance.org:8545/"
  );
  const user1 = new ethers.NonceManager(new ethers.Wallet(privateKey, provider));
  user1.address = user1.signer.address;

  // user2: persistent rehearsal wallet
  const u2file = path.join(root, "build", "smoke-user2.json");
  let user2raw;
  if (fs.existsSync(u2file)) {
    user2raw = new ethers.Wallet(JSON.parse(fs.readFileSync(u2file, "utf8")).privateKey, provider);
  } else {
    user2raw = ethers.Wallet.createRandom().connect(provider);
    fs.writeFileSync(u2file, JSON.stringify({ address: user2raw.address, privateKey: user2raw.privateKey }, null, 2), { mode: 0o600 });
  }
  const user2 = new ethers.NonceManager(user2raw);
  user2.address = user2raw.address;
  const user3raw = ethers.Wallet.createRandom().connect(provider); // never a holder
  const user3 = new ethers.NonceManager(user3raw);
  user3.address = user3raw.address;

  // fund user2 from user1 when low (testnet/local rehearsal only)
  const u2bal = await provider.getBalance(user2.address);
  if (network !== "mainnet" && u2bal < ethers.parseEther("0.02")) {
    const tx = await user1.sendTransaction({ to: user2.address, value: ethers.parseEther("0.05") });
    await tx.wait();
    console.log(`funded user2 with 0.05 (tx ${tx.hash})`);
  }

  const beaconArt = JSON.parse(fs.readFileSync(path.join(root, "build", "AgentBeacon.json"), "utf8"));
  const beacon1 = new ethers.Contract(dep.beacon, beaconArt.abi, user1);
  const beacon2 = new ethers.Contract(dep.beacon, beaconArt.abi, user2);
  const beacon3 = new ethers.Contract(dep.beacon, beaconArt.abi, user3);

  console.log(`network=${network} beacon=${dep.beacon} registry=${dep.registry}`);
  console.log(`user1=${user1.address}\nuser2=${user2.address}\nuser3=${user3.address} (non-holder)`);

  // If the registry is our mock, mint rehearsal IDs to user1 + user2.
  if (dep.mockAgentID) {
    const mockArt = JSON.parse(fs.readFileSync(path.join(root, "build", "MockAgentID.json"), "utf8"));
    const mock = new ethers.Contract(dep.mockAgentID, mockArt.abi, user1);
    for (const u of [user1, user2]) {
      if ((await mock.balanceOf(u.address)) === 0n) {
        await expectOk(`mock mint Agent ID -> ${u.address.slice(0, 10)}…`, mock.mint(u.address));
      } else {
        ok(`mock Agent ID already held by ${u.address.slice(0, 10)}…`);
      }
    }
  }

  console.log("— gate checks —");
  (await beacon1.holdsAgentID(user1.address)) ? ok("holdsAgentID(user1) = true") : bad("holdsAgentID(user1)");
  (await beacon1.holdsAgentID(user3.address)) ? bad("holdsAgentID(user3) should be false") : ok("holdsAgentID(user3) = false");
  await expectRevert("checkIn by non-holder", () => beacon3.checkIn.staticCall(), "Agent ID required");

  console.log("— day 1 —");
  await expectOk("user1 checkIn", beacon1.checkIn());
  await expectRevert("user1 checkIn twice same day", () => beacon1.checkIn.staticCall(), "already checked in today");
  await expectOk("user2 checkIn", beacon2.checkIn());
  let s1 = await beacon1.myStats(user1.address);
  Number(s1[0]) === 1 && Number(s1[2]) === 1 ? ok("user1 streak=1 total=1") : bad("user1 stats", JSON.stringify(s1.map(String)));

  console.log("— pings —");
  await expectOk("user1 ping user2", beacon1.ping(user2.address));
  await expectRevert("user1 ping user2 again same day", () => beacon1.ping.staticCall(user2.address), "already pinged");
  await expectRevert("user1 ping self", () => beacon1.ping.staticCall(user1.address), "cannot ping yourself");
  await expectRevert("user1 ping non-holder", () => beacon1.ping.staticCall(user3.address), "target has no Agent ID");
  await expectRevert("non-holder ping user1", () => beacon3.ping.staticCall(user1.address), "Agent ID required");
  s1 = await beacon1.myStats(user1.address);
  const s2 = await beacon1.myStats(user2.address);
  Number(s1[4]) === 1 && Number(s2[5]) === 1 ? ok("ping counters: sent=1 received=1") : bad("ping counters");

  console.log("— badges (same-day eligibility) —");
  await expectRevert("claim Spark at streak 1", () => beacon1.claimBadge.staticCall(0), "streak too short");

  if (network === "local") {
    console.log("— multi-day flow (evm time travel) —");
    const day = 86400;
    const jump = async (days) => {
      await provider.send("evm_increaseTime", [days * day]);
      await provider.send("evm_mine", []);
    };
    await jump(1);
    await expectOk("user1 checkIn day 2", beacon1.checkIn());
    await jump(1);
    await expectOk("user1 checkIn day 3", beacon1.checkIn());
    s1 = await beacon1.myStats(user1.address);
    Number(s1[0]) === 3 ? ok("streak = 3 after 3 consecutive days") : bad("streak after day 3", `got ${s1[0]}`);

    const rc = await expectOk("claim Spark badge at streak 3", beacon1.claimBadge(0));
    const ev = rc.logs.map((l) => { try { return beacon1.interface.parseLog(l); } catch { return null; } }).find((p) => p && p.name === "BadgeClaimed");
    const tokenId = ev ? ev.args.tokenId : 1n;
    (await beacon1.ownerOf(tokenId)) === user1.address ? ok(`badge ${tokenId} owned by user1`) : bad("badge owner");
    (await beacon1.hasBadge(user1.address, 0)) ? ok("hasBadge(Spark) = true") : bad("hasBadge(Spark)");
    const uri = await beacon1.tokenURI(tokenId);
    uri.startsWith("data:application/json;base64,") && Buffer.from(uri.slice(29), "base64").toString().includes("Spark")
      ? ok("tokenURI decodes and names the Spark tier") : bad("tokenURI content");
    await expectRevert("claim Spark twice", () => beacon1.claimBadge.staticCall(0), "already claimed");
    await expectRevert("claim Flame at streak 3", () => beacon1.claimBadge.staticCall(1), "streak too short");
    await expectRevert("badge transferFrom (soulbound)", () => beacon1.transferFrom.staticCall(user1.address, user2.address, tokenId), "soulbound");
    await expectRevert("badge approve (soulbound)", () => beacon1.approve.staticCall(user2.address, tokenId), "soulbound");

    await jump(2); // skip a full day -> streak lapses
    await expectOk("user1 checkIn after gap", beacon1.checkIn());
    s1 = await beacon1.myStats(user1.address);
    Number(s1[0]) === 1 && Number(s1[1]) === 3
      ? ok("streak reset to 1 after gap, bestStreak kept at 3")
      : bad("gap reset", `streak=${s1[0]} best=${s1[1]}`);
    Number(await beacon1.currentStreak(user1.address)) === 1 ? ok("currentStreak view = 1") : bad("currentStreak view");
  } else {
    console.log("SKIPPED multi-day flow (needs a local chain — covered by the local rehearsal)");
  }

  const totals = [await beacon1.totalAgents(), await beacon1.totalCheckInsAll(), await beacon1.totalPings()];
  console.log(`totals: agents=${totals[0]} checkIns=${totals[1]} pings=${totals[2]}`);
  console.log(`\nSMOKE RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("smoke failed:", e.message);
  process.exit(1);
});
