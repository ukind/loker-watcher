const fs = require("fs");
const A = fs.readFileSync(".rpiv/artifacts/designs/2026-10-26_16-31-46_fast-workflow-runtime.md", "utf8");
const BT = String.fromCharCode(96);
const open = BT+BT+BT+"ts", close = BT+BT+BT;
function fenceAfter(heading) {
  const h = A.indexOf(heading);
  if (h < 0) return null;
  const o = A.indexOf("\n" + open + "\n", h);
  if (o < 0) return null;
  const start = o + 1 + open.length + 1;
  const c = A.indexOf("\n" + close + "\n", start);
  if (c < 0) return null;
  return A.slice(start, c + 1);
}
const src = fenceAfter("### src/state.ts \u2014 MODIFY");
const test = fenceAfter("### tests/state.test.ts \u2014 MODIFY");
const expSrc = fs.readFileSync(".rpiv/tmp/exp-src.txt", "utf8");
const expTest = fs.readFileSync(".rpiv/tmp/exp-test.txt", "utf8");
const s4 = A.indexOf("### Slice 4: State v2 core");
const s5 = A.indexOf("### Slice 5: State hardening");
const section = A.slice(s4, s5);
const expSection = fs.readFileSync(".rpiv/tmp/exp-section.txt", "utf8");
function firstDiff(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; }
const rd = (x) => JSON.stringify(x.slice(0, 60));
console.log("SRC_OK", src === expSrc, src === expSrc ? "" : "len " + src.length + " vs " + expSrc.length + " div@ " + firstDiff(src, expSrc) + " got=" + rd(src) + " exp=" + rd(expSrc));
console.log("TEST_OK", test === expTest, test === expTest ? "" : "len " + test.length + " vs " + expTest.length + " div@ " + firstDiff(test, expTest));
console.log("SECTION_OK", section === expSection, section === expSection ? "" : "len " + section.length + " vs " + expSection.length + " div@ " + firstDiff(section, expSection));
console.log("PENDING_GONE", !A.includes("Slice 4: State v2 core \u2014 pending"));
console.log("APPROVED_PRESENT", A.includes("Slice 4: State v2 core \u2014 approved as generated"));
console.log("FM_OK", A.includes("last_updated: 2026-10-26T20:32:46+0700"));
console.log("STATE_TEST_FENCE_EMPTY_LEFT", A.includes("### tests/state.test.ts \u2014 MODIFY\nGates rewritten for v2 shape; migrateState v1\u2192v2 direct tests; writeStateAtomic temp-name/error-path tests; prune boundary tests (pinned clock).\n\n" + open + "\n" + close));