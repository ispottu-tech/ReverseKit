import frida from "frida";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger";

interface SessionInfo {
  id: string;
  target: string;
  targetType: "pid" | "name" | "identifier";
  pid: number;
  processName: string;
  status: "active" | "detached";
  createdAt: string;
  fridaSession: frida.Session;
  activeScript: frida.Script | null;
  hooks: HookInfo[];
  scriptOutput: string[];
}

interface HookInfo {
  id: string;
  className: string;
  methodName: string;
  methodType: "instance" | "class";
  logArgs: boolean;
  logReturn: boolean;
  callCount: number;
  createdAt: string;
}

interface FridaState {
  device: frida.Device | null;
  host: string | null;
  port: number | null;
  deviceType: string | null;
  deviceName: string | null;
}

const state: FridaState = {
  device: null,
  host: null,
  port: null,
  deviceType: null,
  deviceName: null,
};

const sessions = new Map<string, SessionInfo>();

export async function connectToDevice(host: string, port: number): Promise<void> {
  if (state.device) {
    try {
      await disconnectFromDevice();
    } catch {}
  }

  const deviceManager = frida.getDeviceManager();
  const device = await deviceManager.addRemoteDevice(`${host}:${port}`);

  state.device = device;
  state.host = host;
  state.port = port;
  state.deviceType = device.type;
  state.deviceName = device.name;

  logger.info({ host, port, deviceName: device.name }, "Connected to Frida device");
}

export async function disconnectFromDevice(): Promise<void> {
  for (const [id, session] of sessions.entries()) {
    try {
      await session.fridaSession.detach();
    } catch {}
    session.status = "detached";
    sessions.delete(id);
  }

  if (state.device) {
    try {
      const deviceManager = frida.getDeviceManager();
      await deviceManager.removeRemoteDevice(`${state.host}:${state.port}`);
    } catch {}
  }

  state.device = null;
  state.host = null;
  state.port = null;
  state.deviceType = null;
  state.deviceName = null;

  logger.info("Disconnected from Frida device");
}

export function getConnectionStatus() {
  return {
    connected: state.device !== null,
    host: state.host,
    port: state.port,
    deviceType: state.deviceType,
    deviceName: state.deviceName,
  };
}

export async function listProcesses(): Promise<frida.Process[]> {
  if (!state.device) {
    throw new Error("Not connected to a Frida device");
  }
  return state.device.enumerateProcesses();
}

export async function listApplications(): Promise<frida.Application[]> {
  if (!state.device) {
    throw new Error("Not connected to a Frida device");
  }
  return state.device.enumerateApplications();
}

export async function createSession(
  target: string,
  targetType: "pid" | "name" | "identifier"
): Promise<SessionInfo> {
  if (!state.device) {
    throw new Error("Not connected to a Frida device");
  }

  let attachTarget: number | string;
  if (targetType === "pid") {
    attachTarget = parseInt(target, 10);
  } else {
    attachTarget = target;
  }

  const fridaSession = await state.device.attach(attachTarget);

  const processes = await state.device.enumerateProcesses();
  const proc = processes.find((p) => p.pid === fridaSession.pid);

  const sessionInfo: SessionInfo = {
    id: uuidv4(),
    target,
    targetType,
    pid: fridaSession.pid,
    processName: proc?.name ?? target,
    status: "active",
    createdAt: new Date().toISOString(),
    fridaSession,
    activeScript: null,
    hooks: [],
    scriptOutput: [],
  };

  fridaSession.detached.connect((reason) => {
    logger.info({ sessionId: sessionInfo.id, reason }, "Session detached");
    sessionInfo.status = "detached";
  });

  sessions.set(sessionInfo.id, sessionInfo);
  logger.info({ sessionId: sessionInfo.id, target, pid: fridaSession.pid }, "Session created");

  return sessionInfo;
}

export function getSession(sessionId: string): SessionInfo | undefined {
  return sessions.get(sessionId);
}

export function listSessions(): SessionInfo[] {
  return Array.from(sessions.values());
}

export async function deleteSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  try {
    if (session.activeScript) {
      await session.activeScript.unload();
    }
    await session.fridaSession.detach();
  } catch (err) {
    logger.warn({ sessionId, err }, "Error while detaching session");
  }

  sessions.delete(sessionId);
  logger.info({ sessionId }, "Session deleted");
}

async function runScriptAndCollect(
  fridaSession: frida.Session,
  code: string,
  timeoutMs: number = 10000
): Promise<string[]> {
  const output: string[] = [];

  const script = await fridaSession.createScript(code);

  script.message.connect((message) => {
    if (message.type === "send") {
      const payload = message.payload;
      if (Array.isArray(payload)) {
        output.push(...payload.map((v) => String(v)));
      } else if (typeof payload === "object" && payload !== null) {
        output.push(JSON.stringify(payload));
      } else {
        output.push(String(payload));
      }
    } else if (message.type === "error") {
      output.push(`[ERROR] ${message.description}`);
    }
  });

  await script.load();

  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(timeoutMs, 5000)));

  try {
    await script.unload();
  } catch {}

  return output;
}

export async function listClasses(
  sessionId: string,
  filter?: string
): Promise<{ classes: string[]; total: number; filtered: number }> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const code = `
    var classes = Object.keys(ObjC.classes).sort();
    send(classes);
  `;

  const output = await runScriptAndCollect(session.fridaSession, code, 15000);

  let allClasses: string[] = [];
  for (const line of output) {
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) {
        allClasses = parsed;
        break;
      }
    } catch {
      allClasses.push(line);
    }
  }

  const total = allClasses.length;
  let filtered = allClasses;
  if (filter && filter.trim()) {
    const lowerFilter = filter.toLowerCase();
    filtered = allClasses.filter((c) => c.toLowerCase().includes(lowerFilter));
  }

  return {
    classes: filtered.slice(0, 500),
    total,
    filtered: filtered.length,
  };
}

export async function listMethods(
  sessionId: string,
  className: string
): Promise<{ className: string; instanceMethods: string[]; classMethods: string[] }> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const escapedName = className.replace(/'/g, "\\'");
  const code = `
    try {
      var cls = ObjC.classes['${escapedName}'];
      if (!cls) {
        send({ error: 'Class not found: ${escapedName}' });
      } else {
        var methods = cls.$ownMethods;
        var instanceMethods = methods.filter(function(m) { return m.startsWith('-'); });
        var classMethods = methods.filter(function(m) { return m.startsWith('+'); });
        send({ instanceMethods: instanceMethods, classMethods: classMethods });
      }
    } catch(e) {
      send({ error: e.message });
    }
  `;

  const output = await runScriptAndCollect(session.fridaSession, code, 10000);

  let instanceMethods: string[] = [];
  let classMethods: string[] = [];

  for (const line of output) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.instanceMethods !== undefined) {
        instanceMethods = parsed.instanceMethods;
        classMethods = parsed.classMethods;
        break;
      }
    } catch {}
  }

  return { className, instanceMethods, classMethods };
}

export async function executeScript(
  sessionId: string,
  code: string,
  timeoutMs: number = 10000
): Promise<{ output: string[]; error: string | null; duration: number }> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const start = Date.now();
  const output: string[] = [];
  let scriptError: string | null = null;

  const script = await session.fridaSession.createScript(code);

  script.message.connect((message) => {
    if (message.type === "send") {
      const payload = message.payload;
      if (typeof payload === "string") {
        output.push(payload);
      } else {
        output.push(JSON.stringify(payload));
      }
    } else if (message.type === "error") {
      scriptError = message.description;
      output.push(`[ERROR] ${message.description}`);
      if (message.stack) {
        output.push(message.stack);
      }
    }
  });

  try {
    await script.load();
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(timeoutMs, 30000)));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    scriptError = message;
    output.push(`[LOAD ERROR] ${message}`);
  } finally {
    try {
      await script.unload();
    } catch {}
  }

  const duration = Date.now() - start;
  return { output, error: scriptError, duration };
}

export async function createHook(
  sessionId: string,
  className: string,
  methodName: string,
  methodType: "instance" | "class",
  logArgs: boolean,
  logReturn: boolean
): Promise<HookInfo> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const hookId = uuidv4();
  const prefix = methodType === "instance" ? "-" : "+";
  const fullMethod = `${prefix}[${className} ${methodName}]`;

  const argsCode = logArgs
    ? `
      var args = [];
      for (var i = 0; i < arguments.length; i++) {
        try { args.push(String(arguments[i])); } catch(e) { args.push('<unreadable>'); }
      }
      send('[HOOK:${hookId}] ${fullMethod} called with args: ' + JSON.stringify(args));
    `
    : `send('[HOOK:${hookId}] ${fullMethod} called');`;

  const retCode = logReturn
    ? `
      var ret = this.${methodType === "instance" ? methodName : "class." + methodName}.apply(this, arguments);
      send('[HOOK:${hookId}] ${fullMethod} returned: ' + String(ret));
      return ret;
    `
    : "";

  const escapedClass = className.replace(/'/g, "\\'");
  const escapedMethod = methodName.replace(/'/g, "\\'");

  const hookCode = `
    var hookTarget = ObjC.classes['${escapedClass}'];
    if (!hookTarget) {
      send('[HOOK:${hookId}] ERROR: Class ${escapedClass} not found');
    } else {
      var method = hookTarget['${prefix}${escapedMethod}'];
      if (!method) {
        send('[HOOK:${hookId}] ERROR: Method ${prefix}${escapedMethod} not found on ${escapedClass}');
      } else {
        Interceptor.attach(method.implementation, {
          onEnter: function(args) {
            ${argsCode}
          }
          ${retCode ? `, onLeave: function(retval) {
            send('[HOOK:${hookId}] ${fullMethod} returned: ' + retval.toString());
          }` : ""}
        });
        send('[HOOK:${hookId}] Successfully hooked ${fullMethod}');
      }
    }
  `;

  const script = await session.fridaSession.createScript(hookCode);

  script.message.connect((message) => {
    if (message.type === "send") {
      const hookInfo = session.hooks.find((h) => h.id === hookId);
      if (hookInfo) {
        hookInfo.callCount++;
      }
      session.scriptOutput.push(String(message.payload));
    }
  });

  await script.load();

  const hookInfo: HookInfo = {
    id: hookId,
    className,
    methodName,
    methodType,
    logArgs,
    logReturn,
    callCount: 0,
    createdAt: new Date().toISOString(),
  };

  session.hooks.push(hookInfo);
  logger.info({ sessionId, hookId, className, methodName }, "Hook created");

  return hookInfo;
}

export function listHooks(sessionId: string): HookInfo[] {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  return session.hooks;
}

export function deleteHook(sessionId: string, hookId: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const index = session.hooks.findIndex((h) => h.id === hookId);
  if (index === -1) {
    throw new Error("Hook not found");
  }

  session.hooks.splice(index, 1);
  logger.info({ sessionId, hookId }, "Hook removed");
}

export function serializeSession(s: SessionInfo) {
  return {
    id: s.id,
    target: s.target,
    targetType: s.targetType,
    pid: s.pid,
    processName: s.processName,
    status: s.status,
    createdAt: s.createdAt,
  };
}
