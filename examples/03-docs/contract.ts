/** Browser-safe contract: codecs, public errors, and cache metadata; no handlers. */
import { rpc, wire } from "../../src/index.js";
import {
  SessionLayer,
  DocCodec,
  DocEventCodec,
  DocForbidden,
  DocLocked,
  DocNotFound,
  UserCodec,
  ViewerLayer,
  authErrors,
} from "./domain.js";
import type { RequestContext } from "./server.js";

export const app = rpc.context<RequestContext>();

export const whoamiContract = SessionLayer.contract(app);
export const meContract = ViewerLayer.contract(app);

export const setAvatarContract = app
  .procedure()
  .input(wire.object({ avatarUrl: wire.string }))
  .output(UserCodec)
  .errors(authErrors)
  .mutation();

export const docByIdContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(DocCodec)
  .errors({ ...authErrors, DocNotFound })
  .query();

export const renameDocContract = app
  .procedure()
  .input(wire.object({ id: wire.string, title: wire.string }))
  .output(DocCodec)
  .errors({ ...authErrors, DocNotFound, DocLocked, DocForbidden })
  .mutation();

export const docEventsContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(DocEventCodec)
  .errors({ ...authErrors, DocNotFound })
  .subscription();

export const docContract = app.contract({
  auth: {
    whoami: whoamiContract,
    me: meContract,
    setAvatar: setAvatarContract,
  },
  doc: {
    byId: docByIdContract,
    rename: renameDocContract,
    events: docEventsContract,
  },
});
