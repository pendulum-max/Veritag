#!/usr/bin/env tsx
/**
 * generate-contributor-leaderboard.ts
 *
 * Fetches closed drips-wave issues from GitHub, computes per-contributor reward
 * totals, and rewrites the "## Current Wave Leaderboard" section of
 * docs/contributors.md with a fresh markdown table.
 *
 * Run with:  tsx scripts/generate-contributor-leaderboard.ts
 *
 * Environment variables:
 *   GITHUB_TOKEN  – optional, raises the API rate limit from 60 to 5 000 req/h
 *   GITHUB_REPO   – owner/repo slug (default: pendulum-max/Veritag)
 *   DRIPS_LABEL   – issue label to filter on (default: drips-wave)
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const GITHUB_REPO = process.env.GITHUB_REPO ?? "pendulum-max/Veritag";
const DRIPS_LABEL = process.env.DRIPS_LABEL ?? "drips-wave";
const CONTRIBUTORS_MD = join(
  new URL("../docs/contributors.md", import.meta.url).pathname
);

// ---------------------------------------------------------------------------
// Reward calculation
// ---------------------------------------------------------------------------

const CATEGORY_REWARDS: Record<string, number> = {
  feature: 200,
  devops: 150,
  bug: 125,
  scripts: 100,
  docs: 75,
};

function rewardForLabels(labelNames: string[]): number {
  for (const [key, amount] of Object.entries(CATEGORY_REWARDS)) {
    if (labelNames.some((l) => l.toLowerCase().includes(key))) {
      return amount;
    }
  }
  return 50; // default
}

// ---------------------------------------------------------------------------
// GitHub API types (minimal)
// ---------------------------------------------------------------------------

interface GitHubLabel {
  name: string;
}

interface GitHubUser {
  login: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  labels: GitHubLabel[];
  closed_by: GitHubUser | null;
  assignee: GitHubUser | null;
  pull_request?: unknown; // present if the issue is itself a PR
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "veritag-leaderboard-script/1.0",
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }
  return headers;
}

/** Extract the URL for rel="next" from a GitHub Link header, or null. */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // Link: <https://...?page=2>; rel="next", <https://...?page=5>; rel="last"
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function fetchPage(url: string): Promise<{ data: GitHubIssue[]; next: string | null }> {
  const response = await fetch(url, { headers: buildHeaders() });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as GitHubIssue[];
  const next = parseNextLink(response.headers.get("Link"));
  return { data, next };
}

async function fetchAllIssues(): Promise<GitHubIssue[]> {
  const [owner, repo] = GITHUB_REPO.split("/");
  const baseUrl =
    `https://api.github.com/repos/${owner}/${repo}/issues` +
    `?state=closed&labels=${encodeURIComponent(DRIPS_LABEL)}&per_page=100`;

  const all: GitHubIssue[] = [];
  let url: string | null = baseUrl;

  while (url) {
    const { data, next } = await fetchPage(url);
    // The issues endpoint returns both issues and PRs; keep only issues.
    all.push(...data.filter((item) => !item.pull_request));
    url = next;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Leaderboard builder
// ---------------------------------------------------------------------------

interface ContributorEntry {
  prs: number;
  tasks: string[];
  reward: number;
}

function buildLeaderboard(issues: GitHubIssue[]): Map<string, ContributorEntry> {
  const board = new Map<string, ContributorEntry>();

  for (const issue of issues) {
    const user = issue.closed_by?.login ?? issue.assignee?.login;
    if (!user) continue;

    const labelNames = issue.labels.map((l) => l.name);
    const reward = rewardForLabels(labelNames);

    const entry = board.get(user) ?? { prs: 0, tasks: [], reward: 0 };
    entry.prs += 1;
    entry.tasks.push(`#${issue.number}`);
    entry.reward += reward;
    board.set(user, entry);
  }

  return board;
}

function sortedLeaderboard(
  board: Map<string, ContributorEntry>
): Array<[string, ContributorEntry]> {
  return [...board.entries()].sort(([, a], [, b]) => {
    if (b.reward !== a.reward) return b.reward - a.reward;
    return b.prs - a.prs;
  });
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

function renderTable(sorted: Array<[string, ContributorEntry]>): string {
  const lines: string[] = [
    "> Updated automatically every Monday by GitHub Actions.",
    "",
    "| Rank | GitHub Username | PRs Merged | Tasks Completed | Estimated Reward |",
    "|---|---|---|---|---|",
  ];

  if (sorted.length === 0) {
    lines.push("| — | *No contributions yet* | — | — | — |");
  } else {
    sorted.forEach(([username, entry], idx) => {
      const rank = idx + 1;
      const tasks = entry.tasks.join(", ");
      lines.push(
        `| ${rank} | [@${username}](https://github.com/${username}) | ${entry.prs} | ${tasks} | ${entry.reward} USDC |`
      );
    });
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// File patch
// ---------------------------------------------------------------------------

/**
 * Replaces everything between the `## Current Wave Leaderboard` heading and
 * the next `##` heading (exclusive) with the new table content.
 */
function patchContributorsMd(newTableMarkdown: string): void {
  const original = readFileSync(CONTRIBUTORS_MD, "utf8");

  // Match from the heading line up to (but not including) the next ## heading.
  const sectionRegex =
    /(## Current Wave Leaderboard\n)([\s\S]*?)(\n---|\n## )/;

  const match = original.match(sectionRegex);
  if (!match) {
    throw new Error(
      'Could not find "## Current Wave Leaderboard" section in docs/contributors.md'
    );
  }

  const updated = original.replace(
    sectionRegex,
    `$1\n${newTableMarkdown}\n$3`
  );

  writeFileSync(CONTRIBUTORS_MD, updated, "utf8");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Fetching closed issues with label "${DRIPS_LABEL}" from ${GITHUB_REPO}…`);

  let issues: GitHubIssue[];
  try {
    issues = await fetchAllIssues();
  } catch (err) {
    console.warn(`Warning: failed to fetch issues from GitHub API — ${err}`);
    console.warn("Leaderboard not updated.");
    process.exit(0);
  }

  console.log(`  Found ${issues.length} qualifying closed issue(s).`);

  const board = buildLeaderboard(issues);
  const sorted = sortedLeaderboard(board);

  console.log(`  ${sorted.length} unique contributor(s) on the leaderboard.`);

  const tableMarkdown = renderTable(sorted);

  try {
    patchContributorsMd(tableMarkdown);
  } catch (err) {
    console.warn(`Warning: failed to update docs/contributors.md — ${err}`);
    process.exit(0);
  }

  console.log("docs/contributors.md updated successfully.");

  if (sorted.length > 0) {
    console.log("\nLeaderboard summary:");
    sorted.forEach(([username, entry], idx) => {
      console.log(
        `  ${idx + 1}. @${username} — ${entry.prs} PR(s), ${entry.reward} USDC (tasks: ${entry.tasks.join(", ")})`
      );
    });
  }
}

main().catch((err) => {
  console.warn(`Unexpected error: ${err}`);
  process.exit(0);
});
