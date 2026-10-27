import fs from "node:fs";
const plan = fs.readFileSync(".rpiv/artifacts/plans/2026-10-26_09-46-32_model-judged-keywords.md", "utf8");
const lines = plan.split("\n");
const [, fenceNo, outPath] = process.argv;
const ranges = { "1": [73, 452], "5": [686, 1049], "6": [1057, 1111] };
const [start, end] = ranges[fenceNo];
const content = lines.slice(start - 1, end).join("\n") + "\n";
fs.writeFileSync(outPath, content, "utf8");
console.log("wrote", outPath, Buffer.byteLength(content), "bytes from plan lines", start, "-", end);
