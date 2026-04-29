// swapcard_scraper.ts — bun swapcard_scraper.ts

// ── CONFIG ────────────────────────────────────────────────────────────────────
const BEARER_TOKEN =
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJjb3JlQXBpVXNlcklkIjoiVlhObGNsOHlOek00T1RJek9BPT0iLCJwZXJtaXNzaW9ucyI6WyJhcHBsaWNhdGlvbjpRWEJ3YkdsallYUnBiMjVmTVRZMk5BPT0iLCJzY2hlbWE6dXNlciIsImFwcGxpY2F0aW9uOlFYQndiR2xqWVhScGIyNWZNVFkyTkE9PSIsInNjaGVtYTp1c2VyIl0sInNlc3Npb25JZCI6IjY5YTUzNmRkYjFhNjNiZDI2ZTcyMzE2NyIsInR5cGUiOiJhY2Nlc3MtdG9rZW4iLCJ1c2VySWQiOiI2OThjNjg4ZmVlMThlYmM3N2YyMDAzNjQiLCJlbWFpbFZlcmlmaWVkIjp0cnVlLCJpYXQiOjE3NzI2OTIzMjYsImV4cCI6MTc3Mjc3ODcyNiwiaXNzIjoiYXV0aC1hcGkifQ.o-YXSGsrodFYMUA5T6-DQA-AicQW7ju9l6gsOeDrHi6vnvhQsjpV88sXxN5v7wLqUOiHNTUy8Jufw-6dXJYA-qt_G_Y6PMuZ2rBNOGc47iI-LLW3LXK2I1djPbYytnKuOquSvWaCRzqaCXC8oPdKNp0Ej8uGdc0rYmUk0p9Jv7yI2-BtGCStvSei3Hw1Egfbxn_UbQmZ1ppR1utXihXk3gt91Lgm5DP3nAIm1HNjCAG9G2YLrEvM4V8F-vTtooOulfWT6iHmDXrbttWe6wGy7-mBYbJYWe-ccBNaZxL8n94VcOLQhybq996lVwasZyzr_SCNTp0_gH2JP4N3Wq_O6Qw_IYHTuKFJfJxKmxqCz7CARa2_mZNHw0d3Zhr4-9YGflYdnIzPvXk3ahiE2Xvw9HLrfN6lvz2MeVyS1mT-onqFpKHW0IcVbaSUg5Gy0w5t76C7bx6j4sJrweP4n7VxH7PmSeTAjHTnvS2uGGWECso4bvx62iDjFtf8MB7Ti3qpkvPAnB8jSN7fFsAHNRx160LZ5WL3TlNXlCPNFIjil9fgJDDyKX37VzHaedXbRXeKrrnRsR74bD3-5HVUoyVBbzc_2_kXyOVjL8StqvxGPrdv0ZrrQou2Fs3b17HOAYs_jSnx1j6hi0c4LNXHCxrw0V03iOrgcqQkAWuS-lvltR4";
const VIEW_ID = "RXZlbnRWaWV3XzEyMjY2Njc=";
const CURSOR_FILE = ".last_cursor";
const CSV_FILE_TRACKER = ".last_csv_file"; // tracks which CSV file the current run is writing to
const PAGE_SIZE = 25;
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = "https://connections.whxevents.com/api/graphql";
const QUERY_HASH = "82b38bc162a57690801498261a96426836500a13c1405d11759f95a28612c37c";

interface Node {
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  organization: string | null;
  photoUrl: string | null;
}

interface ApiResponse {
  data?: {
    view?: {
      people?: {
        nodes: Node[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        totalCount: number;
      };
    };
  };
  errors?: { message: string }[];
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function escapeCsv(val: string | null | undefined): string {
  if (!val) return "";
  if (val.includes(",") || val.includes('"') || val.includes("\n"))
    return `"${val.replace(/"/g, '""')}"`;
  return val;
}

function toCsvRow(n: Node): string {
  return [n.firstName, n.lastName, n.jobTitle, n.organization, n.photoUrl].map(escapeCsv).join(",");
}

// ── Cursor ────────────────────────────────────────────────────────────────────
async function saveCursor(cursor: string | null): Promise<void> {
  await Bun.write(CURSOR_FILE, cursor ?? "");
}

async function loadCursor(): Promise<string | null> {
  const f = Bun.file(CURSOR_FILE);
  if (!(await f.exists())) return null;
  const c = (await f.text()).trim();
  return c || null;
}

// ── CSV file tracking (so resume appends to the same file) ───────────────────
async function saveCsvFilename(filename: string): Promise<void> {
  await Bun.write(CSV_FILE_TRACKER, filename);
}

async function loadCsvFilename(): Promise<string | null> {
  const f = Bun.file(CSV_FILE_TRACKER);
  if (!(await f.exists())) return null;
  const name = (await f.text()).trim();
  return name || null;
}

function newCsvFilename(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15); // e.g. 20250305_143012
  return `swapcard_people_${ts}.csv`;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchPage(endCursor: string | null): Promise<ApiResponse> {
  const variables: Record<string, unknown> = {
    viewId: VIEW_ID,
    sort: { field: "FIRST_NAME" },
    first: PAGE_SIZE,
  };
  if (endCursor) variables.endCursor = endCursor;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BEARER_TOKEN}`,
    },
    body: JSON.stringify([
      {
        operationName: "EventPeopleListViewConnectionQuery",
        variables,
        extensions: { persistedQuery: { version: 1, sha256Hash: QUERY_HASH } },
      },
    ]),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const json = await res.json();
  return (Array.isArray(json) ? json[0] : json) as ApiResponse;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const cursor = await loadCursor();
  const isResume = cursor !== null;

  let outputCsv: string;

  if (isResume) {
    // Resume: use whatever CSV file the interrupted run was writing to
    const tracked = await loadCsvFilename();
    if (!tracked) {
      // Cursor exists but tracker is missing — shouldn't happen, but handle gracefully
      outputCsv = newCsvFilename();
      await saveCsvFilename(outputCsv);
    } else {
      outputCsv = tracked;
    }
    console.log(`Resuming from cursor: ${cursor}`);
    console.log(`Appending to: ${outputCsv}`);
  } else {
    // Fresh start: always create a new timestamped file
    outputCsv = newCsvFilename();
    await Bun.write(outputCsv, "firstName,lastName,jobTitle,organization,photoUrl\n");
    await saveCsvFilename(outputCsv);
    console.log(`Starting fresh → ${outputCsv}`);
  }

  const writer = Bun.file(outputCsv).writer({ highWaterMark: 1024 * 64 });

  let currentCursor = cursor;
  let page = 0;
  let fetched = 0;
  let total: number | null = null;

  while (true) {
    page++;
    process.stdout.write(`[page ${page}] `);

    let resp: ApiResponse;
    try {
      resp = await fetchPage(currentCursor);
    } catch (err) {
      await writer.flush();
      await writer.end();
      console.error("\nFetch failed:", err);
      process.exit(1);
    }

    if (resp.errors?.length) {
      await writer.flush();
      await writer.end();
      console.error("GraphQL errors:", JSON.stringify(resp.errors, null, 2));
      process.exit(1);
    }

    const people = resp.data?.view?.people;
    if (!people) {
      console.error("Unexpected shape:", JSON.stringify(resp, null, 2));
      process.exit(1);
    }

    if (total === null) total = people.totalCount;

    const rows = people.nodes.map(toCsvRow).join("\n") + "\n";

    writer.write(rows);
    await Promise.all([writer.flush(), saveCursor(people.pageInfo.endCursor ?? null)]);

    fetched += people.nodes.length;
    process.stdout.write(`${fetched} / ${total}\n`);

    if (!people.pageInfo.hasNextPage || !people.pageInfo.endCursor) {
      await writer.end();
      await saveCursor(null);
      await Bun.write(CSV_FILE_TRACKER, ""); // clear tracker on clean finish
      console.log(`\nDone. ${fetched} records → ${outputCsv}`);
      break;
    }

    currentCursor = people.pageInfo.endCursor;
  }
}

main().catch(async (err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
