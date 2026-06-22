import { describe, expect, it } from "vitest";
import {
  launchdPlist,
  SERVICE_LABEL,
  SERVICE_NAME,
  supportedServicePlatform,
  systemdUnit,
  windowsCreateArgs,
  type ServiceContext,
} from "./service.js";

const ctx: ServiceContext = {
  nodePath: "/usr/bin/node",
  scriptPath: "/home/ariel/.pulpo/cli.js",
  workingDir: "/home/ariel/.pulpo",
  env: { PULPO_HOME: "/home/ariel/.pulpo" },
};

describe("supportedServicePlatform", () => {
  it("reconoce linux/darwin/win32", () => {
    expect(supportedServicePlatform("linux")).toBe("linux");
    expect(supportedServicePlatform("darwin")).toBe("darwin");
    expect(supportedServicePlatform("win32")).toBe("win32");
  });

  it("null en plataformas no soportadas", () => {
    expect(supportedServicePlatform("aix")).toBeNull();
    expect(supportedServicePlatform("freebsd")).toBeNull();
  });
});

describe("systemdUnit", () => {
  const unit = systemdUnit(ctx);

  it("arranca el runner con node + cli + run", () => {
    expect(unit).toContain("ExecStart=/usr/bin/node /home/ariel/.pulpo/cli.js run");
  });

  it("reintenta y arranca al iniciar sesión", () => {
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");
  });

  it("inyecta las variables de entorno", () => {
    expect(unit).toContain("Environment=PULPO_HOME=/home/ariel/.pulpo");
  });
});

describe("launchdPlist", () => {
  const plist = launchdPlist(ctx);

  it("usa la etiqueta y los argumentos del programa", () => {
    expect(plist).toContain(`<string>${SERVICE_LABEL}</string>`);
    expect(plist).toContain("<string>/usr/bin/node</string>");
    expect(plist).toContain("<string>run</string>");
  });

  it("queda 'siempre prendido' (RunAtLoad + KeepAlive)", () => {
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
  });

  it("incluye las variables de entorno", () => {
    expect(plist).toContain("<key>PULPO_HOME</key>");
  });

  it("sin env, no emite el bloque de variables", () => {
    expect(launchdPlist({ ...ctx, env: undefined })).not.toContain("EnvironmentVariables");
  });
});

describe("windowsCreateArgs", () => {
  const args = windowsCreateArgs(ctx);

  it("crea la tarea al iniciar sesión", () => {
    expect(args).toEqual(
      expect.arrayContaining(["/Create", "/TN", SERVICE_NAME, "/SC", "ONLOGON", "/F"]),
    );
  });

  it("el comando de la tarea lanza node + cli + run", () => {
    const tr = args[args.indexOf("/TR") + 1];
    expect(tr).toContain("/usr/bin/node");
    expect(tr).toContain("cli.js");
    expect(tr).toContain("run");
  });
});
