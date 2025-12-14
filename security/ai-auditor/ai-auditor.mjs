import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const client = new Anthropic();

const CHECKLIST = `
ACCESS CONTROL:
- All external functions have appropriate modifiers
- Factory functions protected
- Role management correct

LOGIC:
- require() uses correct operators (== vs !=)
- No inverted boolean conditions
- Comparison operators correct

REENTRANCY:
- CEI pattern followed
- State updated before external calls
- ReentrancyGuard on vulnerable functions

MATH:
- No hardcoded decimals (1e10, 1e18)
- Decimal handling correct for 6/8/18 tokens
- Rounding favors protocol

TOKENS:
- Return values checked or SafeERC20 used
- Fee-on-transfer handled
- Approval race conditions handled

FLASH LOANS:
- Same-block manipulation prevented
- Callback origin validated
`;

function loadSolidityFiles(dir, files = []) {
  const items = readdirSync(dir);
  for (const item of items) {
    const path = join(dir, item);
    const stat = statSync(path);
    if (stat.isDirectory() && !item.includes("node_modules") && !item.includes("lib")) {
      loadSolidityFiles(path, files);
    } else if (extname(item) === ".sol") {
      files.push({ path, content: readFileSync(path, "utf-8") });
    }
  }
  return files;
}

async function auditContract(file) {
  const prompt = `You are a smart contract security auditor. Analyze this Solidity code for vulnerabilities.

CHECKLIST:
${CHECKLIST}

CONTRACT (${file.path}):
\`\`\`solidity
${file.content}
\`\`\`

Respond with JSON only:
{
  "findings": [
    {
      "severity": "HIGH|MEDIUM|LOW",
      "title": "string",
      "line": number,
      "code": "vulnerable code snippet",
      "issue": "what is wrong",
      "impact": "what can happen",
      "recommendation": "how to fix"
    }
  ],
  "summary": {
    "high": number,
    "medium": number,
    "low": number,
    "notes": "string"
  }
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");
  return JSON.parse(jsonMatch[0]);
}

async function main() {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error("Usage: node ai-auditor.mjs <contracts-dir>");
    process.exit(1);
  }

  console.log(`\n[AI AUDITOR] Scanning ${targetDir}\n`);

  const files = loadSolidityFiles(targetDir);
  console.log(`Found ${files.length} Solidity files\n`);

  const allFindings = [];

  for (const file of files) {
    console.log(`Auditing: ${file.path}`);
    try {
      const result = await auditContract(file);
      console.log(`  HIGH: ${result.summary.high} | MEDIUM: ${result.summary.medium} | LOW: ${result.summary.low}`);
      
      for (const finding of result.findings) {
        allFindings.push({ ...finding, file: file.path });
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("FINDINGS REPORT");
  console.log("=".repeat(60) + "\n");

  const high = allFindings.filter((f) => f.severity === "HIGH");
  const medium = allFindings.filter((f) => f.severity === "MEDIUM");
  const low = allFindings.filter((f) => f.severity === "LOW");

  const printFindings = (findings, label) => {
    if (findings.length === 0) return;
    console.log(`\n[${label}] ${findings.length} findings\n`);
    findings.forEach((f, i) => {
      console.log(`${i + 1}. ${f.title}`);
      console.log(`   File: ${f.file}:${f.line}`);
      console.log(`   Issue: ${f.issue}`);
      console.log(`   Impact: ${f.impact}`);
      console.log(`   Fix: ${f.recommendation}\n`);
    });
  };

  printFindings(high, "HIGH");
  printFindings(medium, "MEDIUM");
  printFindings(low, "LOW");

  console.log("\n" + "=".repeat(60));
  console.log(`TOTAL: ${high.length} HIGH | ${medium.length} MEDIUM | ${low.length} LOW`);
  console.log("=".repeat(60) + "\n");
}

main().catch(console.error);
