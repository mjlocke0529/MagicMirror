/* SmartHome dashboard config
 *
 * Do not edit the module list here - it is generated from config/smarthome.json,
 * which the on-screen settings panel (cog, top right) maintains.
 * See modules/MMM-SmartHome/lib/config-builder.js for the schema and defaults.
 *
 * Note: MagicMirror evaluates this file without a filename, so paths must be
 * absolute (root_path is set by MagicMirror; cwd is the fallback for tooling).
 */
const path = require("node:path");
const root = (typeof global !== "undefined" && global.root_path) ? global.root_path : process.cwd();
const { loadSmartHome, buildConfig } = require(path.join(root, "modules", "MMM-SmartHome", "lib", "config-builder.js"));

const config = buildConfig(loadSmartHome(path.join(root, "config", "smarthome.json")));

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
