// Metro para un monorepo pnpm: vigila la raíz del workspace, busca módulos en
// ambos node_modules y resuelve los "exports" de package.json (nuestros paquetes
// @pulpo/* exponen su build en dist).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enablePackageExports = true;

// supabase-js hace import() opcionales de paquetes solo-Node (telemetría, ws…)
// que Metro intenta resolver igualmente. Los mapeamos a módulo vacío.
const optionalNodeModules = new Set(["@opentelemetry/api", "ws"]);
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (optionalNodeModules.has(moduleName)) {
    return { type: "empty" };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
