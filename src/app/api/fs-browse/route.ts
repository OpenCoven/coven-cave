import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  DRIVES_LOCATION,
  createSubdirInBrowsableDir,
  homeRoot,
  listPlaceGroups,
  listSystemRootEntries,
  listSystemRoots,
  resolveBrowsableDir,
  listSubdirs,
} from "@/lib/server/home-browse";
import { resolveAllowedProjectSubpath } from "@/lib/server/project-paths";

/**
 * Directory browser for the "New project" folder picker on the web build
 * (desktop uses the native OS dialog instead). Lists the immediate
 * subdirectories of a directory so the client can navigate the filesystem one
 * level at a time. Browsing opens at $HOME but may walk above it to any
 * volume root (`/` on POSIX, drive roots on Windows); the `::drives`
 * pseudo-location lists those roots so multi-drive machines can switch.
 *
 * `?hidden=1` reveals dot-prefixed folders, which the listing omits by
 * default. That is presentation, not permission: every path below still goes
 * through the same trusted walk, so a hidden folder reached by crumb, pin, or
 * direct request resolves whatever the flag says.
 *
 * `?places=1` returns the sidebar's jump-off locations instead of a listing:
 * Quick access ($HOME + known folders) and This PC (labeled volumes). The
 * client fetches it once per modal open and navigates to the paths it names
 * through the ordinary browse path, so it grants no reach the walk below
 * wouldn't already allow.
 *
 * Security: loopback-only (a phone on the tailnet must not browse the host's
 * filesystem), and every requested path is re-derived from its volume root by
 * resolveBrowsableDir's trusted directory walk — anything else returns 403.
 */
export async function GET(req: NextRequest) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;

  if (req.nextUrl.searchParams.get("places") === "1") {
    return NextResponse.json({ ok: true, home: homeRoot(), groups: listPlaceGroups() });
  }

  // Dot folders are noise for almost every project pick, so the listing hides
  // them unless the picker's "Show hidden folders" toggle asks otherwise.
  const includeHidden = req.nextUrl.searchParams.get("hidden") === "1";

  const requested = req.nextUrl.searchParams.get("dir");
  if ((requested ?? "").trim() === DRIVES_LOCATION) {
    const entries = listSystemRootEntries().map((entry) => ({ ...entry, workspace: false }));
    // A volume root is never dot-prefixed, so this listing has nothing to
    // reveal — but it still reports the pair so the client's toggle keeps a
    // stable shape across the drives location.
    return NextResponse.json({
      ok: true,
      home: homeRoot(),
      cwd: DRIVES_LOCATION,
      parent: null,
      entries,
      hiddenCount: 0,
      includeHidden,
    });
  }

  const dir = resolveBrowsableDir(requested);
  if (!dir) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  // `workspace` badges folders that already sit inside a configured Cave
  // workspace or registered project root, so the picker can spotlight the
  // places project chats normally live.
  const listing = listSubdirs(dir, { includeHidden });
  const entries = listing.entries.map((entry) => ({
    ...entry,
    workspace: resolveAllowedProjectSubpath(entry.path) !== null,
  }));
  // Above a volume root the only place left is the drives list — and only
  // when there is more than one volume to switch between.
  const volumeRoot = path.parse(dir).root;
  const parent =
    dir === volumeRoot
      ? listSystemRoots().length > 1
        ? DRIVES_LOCATION
        : null
      : path.dirname(dir);
  return NextResponse.json({
    ok: true,
    home: homeRoot(),
    cwd: dir,
    parent,
    entries,
    hiddenCount: listing.hiddenCount,
    includeHidden,
  });
}

export async function POST(req: NextRequest) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;

  let body: { dir?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const dir = typeof body?.dir === "string" ? body.dir : "";
  const name = typeof body?.name === "string" ? body.name : "";
  const result = createSubdirInBrowsableDir(dir, name);
  if (result.ok) {
    return NextResponse.json({ ok: true, path: result.path }, { status: 201 });
  }

  switch (result.reason) {
    case "invalid-parent":
      return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
    case "invalid-name":
      return NextResponse.json({ ok: false, error: "Enter a valid folder name" }, { status: 400 });
    case "exists":
      return NextResponse.json(
        { ok: false, error: "A folder with that name already exists" },
        { status: 409 },
      );
    case "create-failed":
      return NextResponse.json({ ok: false, error: "Could not create that folder" }, { status: 500 });
  }
}
