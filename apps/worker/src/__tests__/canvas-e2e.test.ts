import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unstable_dev, type UnstableDevWorker } from "wrangler";
import { join } from "path";
import { execSync } from "child_process";

const TEST_SECRET = "test-secret-for-e2e";
const TEST_TOKEN = "test-session-token-abc123";
const SESSION_COOKIE_NAME = "free-canvas-dev.session_token";

// --- Cookie Signing (same as better-auth/better-call) ---

async function signCookie(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  const base64Sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(`${value}.${base64Sig}`);
}

// --- Test Setup ---

describe("Canvas E2E (cookie auth)", () => {
  let worker: UnstableDevWorker;
  let sessionCookie: string;

  beforeAll(async () => {
    const workerDir = join(__dirname, "../..");

    // Apply migrations locally (creates .wrangler/state/ D1)
    execSync("pnpm db:migrate:local", { cwd: workerDir, stdio: "pipe" });

    // Seed test user + session via wrangler d1 execute
    const seedSQL = `
      INSERT OR IGNORE INTO "user" (id, name, email, "emailVerified") VALUES ('e2e-user', 'E2E User', 'e2e@test.com', 1);
      INSERT OR IGNORE INTO "session" (id, "userId", token, "expiresAt") VALUES ('e2e-sess', 'e2e-user', '${TEST_TOKEN}', '2099-01-01T00:00:00.000Z');
    `.trim();

    execSync(
      `npx wrangler d1 execute free-canvas-db --local --command="${seedSQL.replace(/"/g, '\\"')}"`,
      { cwd: workerDir, stdio: "pipe" }
    );

    // Start worker
    worker = await unstable_dev(join(__dirname, "../index.ts"), {
      experimental: { disableExperimentalWarning: true },
      vars: {
        ENVIRONMENT: "development",
        BETTER_AUTH_SECRET: TEST_SECRET,
        GOOGLE_CLIENT_ID: "fake",
        GOOGLE_CLIENT_SECRET: "fake",
        FRONTEND_URL: "http://localhost:4321",
      },
      local: true,
      persist: true, // Use the same D1 we just seeded
    });

    // Build signed cookie
    sessionCookie = `${SESSION_COOKIE_NAME}=${await signCookie(TEST_TOKEN, TEST_SECRET)}`;
  }, 30000);

  afterAll(async () => {
    await worker?.stop();
  });

  it("returns 401 without cookie", async () => {
    const res = await worker.fetch("/api/canvas/projects", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects test header bypass in non-test env", async () => {
    const res = await worker.fetch("/api/canvas/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user-id": "hacker",
      },
      body: JSON.stringify({ name: "Should Fail" }),
    });
    expect(res.status).toBe(401);
  });

  it("authenticates with valid signed cookie", async () => {
    const res = await worker.fetch("/api/canvas/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ name: "Cookie Auth Works" }),
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string; name: string };
    expect(data.name).toBe("Cookie Auth Works");
  });

  it("rejects invalid signature", async () => {
    const badCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(`${TEST_TOKEN}.BADSIG`)}`;
    const res = await worker.fetch("/api/canvas/projects", {
      headers: {
        "Content-Type": "application/json",
        Cookie: badCookie,
      },
    });
    expect(res.status).toBe(401);
  });

  it("full CRUD via cookie auth", async () => {
    const headers = { "Content-Type": "application/json", Cookie: sessionCookie };

    // Create
    const createRes = await worker.fetch("/api/canvas/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "E2E CRUD" }),
    });
    expect(createRes.status).toBe(201);
    const { id: projectId } = (await createRes.json()) as { id: string };

    // Read project metadata
    const getRes = await worker.fetch(`/api/canvas/projects/${projectId}`, { headers });
    expect(getRes.status).toBe(200);
    const project = (await getRes.json()) as { name: string; flowData?: unknown };
    expect(project.name).toBe("E2E CRUD");
    expect(project.flowData).toBeUndefined();

    // Create canvas
    const flowData = { nodes: [{ id: "n1" }], edges: [], viewport: { x: 10, y: 20, zoom: 2 } };
    const createCanvasRes = await worker.fetch(`/api/canvas/projects/${projectId}/canvases`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Main Canvas", flowData }),
    });
    expect(createCanvasRes.status).toBe(201);
    const canvas = (await createCanvasRes.json()) as { id: string; flowData: unknown };
    expect(canvas.flowData).toEqual(flowData);

    // Update canvas
    const updatedFlowData = { nodes: [{ id: "n2" }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const updateCanvasRes = await worker.fetch(`/api/canvas/projects/${projectId}/canvases/${canvas.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ flowData: updatedFlowData }),
    });
    expect(updateCanvasRes.status).toBe(200);

    // Read canvas
    const getCanvasRes = await worker.fetch(`/api/canvas/projects/${projectId}/canvases/${canvas.id}`, { headers });
    expect(getCanvasRes.status).toBe(200);
    const updatedCanvas = (await getCanvasRes.json()) as { flowData: unknown };
    expect(updatedCanvas.flowData).toEqual(updatedFlowData);

    // Update project
    const updateProjectRes = await worker.fetch(`/api/canvas/projects/${projectId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(updateProjectRes.status).toBe(200);

    // Delete project
    const deleteRes = await worker.fetch(`/api/canvas/projects/${projectId}`, {
      method: "DELETE",
      headers,
    });
    expect(deleteRes.status).toBe(200);

    // Verify gone
    const goneRes = await worker.fetch(`/api/canvas/projects/${projectId}`, { headers });
    expect(goneRes.status).toBe(404);
  });
});
