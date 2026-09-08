import { APIError } from "better-auth";
import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

function createHandlers() {
  return toNextJsHandler({ handler: async (request: Request) => {
    try {
      return await getAuth().handler(request);
    } catch (error) {
      // A queued session-creation after-hook can reject after Better Auth's
      // router has returned. Keep that rejection an explicit, uncached denial.
      if (error instanceof APIError && (error.status === "FORBIDDEN" || error.status === "SERVICE_UNAVAILABLE")) {
        return Response.json({ message: "Owner access is unavailable. Contact your administrator if this persists." }, {
          status: error.status === "FORBIDDEN" ? 403 : 503,
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      throw error;
    }
  } });
}

export async function GET(request: Request) {
  return createHandlers().GET(request);
}

export async function POST(request: Request) {
  return createHandlers().POST(request);
}

export async function PATCH(request: Request) {
  return createHandlers().PATCH(request);
}

export async function PUT(request: Request) {
  return createHandlers().PUT(request);
}

export async function DELETE(request: Request) {
  return createHandlers().DELETE(request);
}
