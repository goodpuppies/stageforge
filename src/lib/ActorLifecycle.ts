import { LogChannel } from "@mommysgoodpuppy/logchannel";
import type { ActorId, ActorW } from "./types.ts";

export type ActorInspectInfo = {
  actorId: ActorId;
  actorname?: string;
  base?: string | URL;
  workerUrl?: string;
  createdAt?: number;
  reloadedAt?: number;
  reloadCount: number;
};

export type RootActorConfig = {
  actorId: ActorId;
  actorname: string;
  base?: string | URL;
  startType: string;
  startPayload: unknown;
};

export type RebootPayload = {
  actorId?: ActorId;
  startType?: string;
  startPayload?: unknown;
};

type Post = (message: { target: string; type: string; payload: unknown }, cb?: boolean) => unknown;

const SHUTDOWN_TIMEOUT_MS = 5_000;
const SNAPSHOT_TIMEOUT_MS = 2_000;
const RESTORE_TIMEOUT_MS = 5_000;
const REBOOT_RELEASE_WAIT_MS = 4_000;

function timeout(message: string, ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

export function inspectActors(actors: Map<ActorId, ActorW>): ActorInspectInfo[] {
  return [...actors.entries()].map(([actorId, actor]) => ({
    actorId,
    actorname: actor.actorname,
    base: actor.base,
    workerUrl: actor.workerUrl,
    createdAt: actor.createdAt,
    reloadedAt: actor.reloadedAt,
    reloadCount: actor.reloadCount ?? 0,
  }));
}

export async function shutdownActor(
  post: Post,
  actorId: ActorId,
  reason: "reload" | "reboot" | "murder",
): Promise<void> {
  try {
    LogChannel.log("postalserviceCreate", `running shutdown hook for ${actorId} (${reason})`);
    await Promise.race([
      post({ target: actorId, type: "SHUTDOWN", payload: { reason } }, true),
      timeout(`SHUTDOWN timed out for ${actorId}`, SHUTDOWN_TIMEOUT_MS),
    ]);
  } catch (error) {
    LogChannel.log(
      "postalservice",
      `shutdown hook failed for ${actorId}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function snapshotActor(post: Post, actorId: ActorId): Promise<unknown> {
  try {
    return await Promise.race([
      post({ target: actorId, type: "SNAPSHOT", payload: null }, true),
      timeout(`SNAPSHOT timed out for ${actorId}`, SNAPSHOT_TIMEOUT_MS),
    ]);
  } catch (error) {
    LogChannel.log(
      "postalservice",
      `snapshot hook failed for ${actorId}: ${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}

export async function restoreActor(
  post: Post,
  actorId: ActorId,
  snapshot: unknown,
): Promise<void> {
  if (snapshot == null) return;
  try {
    await Promise.race([
      post({ target: actorId, type: "RESTORE", payload: snapshot }, true),
      timeout(`RESTORE timed out for ${actorId}`, RESTORE_TIMEOUT_MS),
    ]);
  } catch (error) {
    LogChannel.log(
      "postalservice",
      `restore hook failed for ${actorId}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function rebootActorGraph(options: {
  actors: Map<ActorId, ActorW>;
  rootActor: RootActorConfig | null;
  payload: RebootPayload | null;
  post: Post;
  add: (actorname: string, base?: string | URL) => Promise<ActorId>;
  clearTopics: () => void;
  clearCallbacks: () => void;
  setRootActor: (config: RootActorConfig) => void;
}): Promise<RootActorConfig> {
  const { actors, payload, rootActor } = options;
  const rootActorId = payload?.actorId ?? rootActor?.actorId;
  if (!rootActorId) throw new Error("Cannot reboot: no root actor is registered");

  const existing = actors.get(rootActorId);
  const rootConfig = existing?.actorname
    ? {
      actorId: rootActorId,
      actorname: existing.actorname,
      base: existing.base,
      startType: payload?.startType ?? rootActor?.startType ?? "MAIN",
      startPayload: "startPayload" in (payload ?? {})
        ? payload?.startPayload
        : rootActor?.startPayload ?? null,
    }
    : rootActor && rootActorId === rootActor.actorId
    ? {
      ...rootActor,
      startType: payload?.startType ?? rootActor.startType,
      startPayload: "startPayload" in (payload ?? {})
        ? payload?.startPayload
        : rootActor.startPayload,
    }
    : null;
  if (!rootConfig) throw new Error(`Cannot reboot: root actor metadata not found for ${rootActorId}`);

  const actorEntries = [...actors.entries()];
  await Promise.all(actorEntries.map(([actorId]) => shutdownActor(options.post, actorId, "reboot")));
  for (const [, actor] of actorEntries) actor.worker.terminate();
  actors.clear();
  options.clearTopics();
  options.clearCallbacks();
  await new Promise((resolve) => setTimeout(resolve, REBOOT_RELEASE_WAIT_MS));

  const newRoot = await options.add(rootConfig.actorname, rootConfig.base);
  const nextConfig = { ...rootConfig, actorId: newRoot };
  options.setRootActor(nextConfig);
  options.post({ target: newRoot, type: nextConfig.startType, payload: nextConfig.startPayload });
  return nextConfig;
}
