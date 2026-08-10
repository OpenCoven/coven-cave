import {
  DELETE as deleteInstall,
  GET as getInstall,
  POST as postInstall,
} from "./install-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return getInstall(req);
}

export async function DELETE(req: Request) {
  return deleteInstall(req);
}

export async function POST(req: Request) {
  return postInstall(req);
}
