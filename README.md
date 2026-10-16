
# Stageforge

Actor routing, lifecycle and Worker-compatible transports.

## Externally owned actors and proxy routes

Use `postal.attachProxy(existingActorId, workerTransport, metadata?)` to import an actor that
is already running. It sends no INIT and waits for no LOADED. Incoming messages from the
Worker-shaped transport are wired back into normal Stageforge routing and callback handling.
The transport's `terminate()` must close only its local connection, never stop the remote actor
or its process. `postal.detachProxy(id)` removes that route without remote lifecycle commands.

For descriptor-based attachment, register a transport factory with
`postal.registerProxyTransport(kind, endpoint => workerTransport)`, then call
`postal.connectProxy(id, kind, endpoint)`. Actors can send System `ATTACHPROXY` messages with
`{ actorId, transport, endpoint }`, and `DETACHPROXY` with `{ actorId }`.
Discovery/connection readiness and identity validation remain the transport's responsibility.

Proxy entries have `ownership: "external"` in inspection metadata. Murder and graph reboot
only disconnect these entries; they do not send SHUTDOWN. Reload refuses external actors;
explicitly detach/reattach instead. Reattach preserves remote identity/state; a remote process
restart may supply a new actor ID that discovery must import. The existing Iroh ADDREMOTE
path uses the same ownership and response-routing implementation.

A locally owned actor routed through an Iroh debug proxy retains its local ownership and
original owner worker; normal shutdown/reload still reaches and releases that actor.
