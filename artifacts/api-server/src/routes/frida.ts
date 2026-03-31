import { Router, type IRouter } from "express";
import {
  ConnectFridaBody,
  ConnectFridaResponse,
  GetFridaStatusResponse,
  ListProcessesResponse,
  ListApplicationsResponse,
  ListSessionsResponse,
  ListSessionsResponseItem,
  CreateSessionBody,
  DeleteSessionParams,
  ListClassesParams,
  ListClassesQueryParams,
  ListClassesResponse,
  ListMethodsParams,
  ListMethodsResponse,
  ExecuteScriptBody,
  ExecuteScriptParams,
  ExecuteScriptResponse,
  ListHooksParams,
  ListHooksResponse,
  ListHooksResponseItem,
  CreateHookBody,
  CreateHookParams,
  DeleteHookParams,
} from "@workspace/api-zod";
import * as fridaManager from "../lib/frida-manager";

const router: IRouter = Router();

router.post("/frida/connect", async (req, res): Promise<void> => {
  const parsed = ConnectFridaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    await fridaManager.connectToDevice(parsed.data.host, parsed.data.port);
    const status = fridaManager.getConnectionStatus();
    res.json(ConnectFridaResponse.parse(status));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to connect to Frida device");
    res.status(500).json({ error: `Connection failed: ${message}` });
  }
});

router.get("/frida/status", (_req, res): void => {
  const status = fridaManager.getConnectionStatus();
  res.json(GetFridaStatusResponse.parse(status));
});

router.post("/frida/disconnect", async (_req, res): Promise<void> => {
  try {
    await fridaManager.disconnectFromDevice();
    res.json({ message: "Disconnected successfully" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({ message: `Disconnected (with errors: ${message})` });
  }
});

router.get("/frida/processes", async (req, res): Promise<void> => {
  try {
    const processes = await fridaManager.listProcesses();
    const data = processes.map((p) => ({
      pid: p.pid,
      name: p.name,
      identifier: p.parameters?.path ?? null,
      smallIcon: null,
      largeIcon: null,
    }));
    res.json(ListProcessesResponse.parse(data));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

router.get("/frida/applications", async (req, res): Promise<void> => {
  try {
    const apps = await fridaManager.listApplications();
    const data = apps.map((a) => ({
      identifier: a.identifier,
      name: a.name,
      pid: a.pid ?? null,
      smallIcon: null,
      largeIcon: null,
    }));
    res.json(ListApplicationsResponse.parse(data));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

router.get("/frida/sessions", (_req, res): void => {
  const sessions = fridaManager.listSessions();
  res.json(ListSessionsResponse.parse(sessions.map(fridaManager.serializeSession)));
});

router.post("/frida/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const session = await fridaManager.createSession(
      parsed.data.target,
      parsed.data.targetType as "pid" | "name" | "identifier"
    );
    res.status(201).json(ListSessionsResponseItem.parse(fridaManager.serializeSession(session)));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to create session");
    res.status(500).json({ error: `Failed to attach: ${message}` });
  }
});

router.delete("/frida/sessions/:sessionId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.sessionId)
    ? req.params.sessionId[0]
    : req.params.sessionId;
  const params = DeleteSessionParams.safeParse({ sessionId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    await fridaManager.deleteSession(params.data.sessionId);
    res.json({ message: "Session detached and deleted" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

router.get("/frida/sessions/:sessionId/classes", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.sessionId)
    ? req.params.sessionId[0]
    : req.params.sessionId;
  const params = ListClassesParams.safeParse({ sessionId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = ListClassesQueryParams.safeParse(req.query);
  const filter = query.success ? (query.data.filter ?? undefined) : undefined;

  try {
    const result = await fridaManager.listClasses(params.data.sessionId, filter);
    res.json(ListClassesResponse.parse(result));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

router.get(
  "/frida/sessions/:sessionId/classes/:className/methods",
  async (req, res): Promise<void> => {
    const rawSessionId = Array.isArray(req.params.sessionId)
      ? req.params.sessionId[0]
      : req.params.sessionId;
    const rawClassName = Array.isArray(req.params.className)
      ? req.params.className[0]
      : req.params.className;

    const params = ListMethodsParams.safeParse({
      sessionId: rawSessionId,
      className: rawClassName,
    });
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      const result = await fridaManager.listMethods(
        params.data.sessionId,
        params.data.className
      );
      res.json(ListMethodsResponse.parse(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  }
);

router.post("/frida/sessions/:sessionId/script", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.sessionId)
    ? req.params.sessionId[0]
    : req.params.sessionId;
  const params = ExecuteScriptParams.safeParse({ sessionId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = ExecuteScriptBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const result = await fridaManager.executeScript(
      params.data.sessionId,
      body.data.code,
      body.data.timeout ?? 10000
    );
    res.json(ExecuteScriptResponse.parse(result));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

router.get("/frida/sessions/:sessionId/hooks", (req, res): void => {
  const rawId = Array.isArray(req.params.sessionId)
    ? req.params.sessionId[0]
    : req.params.sessionId;
  const params = ListHooksParams.safeParse({ sessionId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const hooks = fridaManager.listHooks(params.data.sessionId);
    res.json(ListHooksResponse.parse(hooks));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

router.post("/frida/sessions/:sessionId/hooks", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.sessionId)
    ? req.params.sessionId[0]
    : req.params.sessionId;
  const params = CreateHookParams.safeParse({ sessionId: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CreateHookBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const hook = await fridaManager.createHook(
      params.data.sessionId,
      body.data.className,
      body.data.methodName,
      body.data.methodType as "instance" | "class",
      body.data.logArgs ?? false,
      body.data.logReturn ?? false
    );
    res.status(201).json(ListHooksResponseItem.parse(hook));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

router.delete("/frida/sessions/:sessionId/hooks/:hookId", (req, res): void => {
  const rawSessionId = Array.isArray(req.params.sessionId)
    ? req.params.sessionId[0]
    : req.params.sessionId;
  const rawHookId = Array.isArray(req.params.hookId)
    ? req.params.hookId[0]
    : req.params.hookId;

  const params = DeleteHookParams.safeParse({
    sessionId: rawSessionId,
    hookId: rawHookId,
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    fridaManager.deleteHook(params.data.sessionId, params.data.hookId);
    res.json({ message: "Hook removed" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

export default router;
