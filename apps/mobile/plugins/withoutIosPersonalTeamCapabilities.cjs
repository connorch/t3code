const { withEntitlementsPlist } = require("expo/config-plugins");

// Removes entitlements a free Personal Team cannot provision. Must be listed
// first in app.config.ts plugins so its mod runs after the plugins that add them.
module.exports = function withoutIosPersonalTeamCapabilities(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults["aps-environment"];
    delete modConfig.modResults["com.apple.developer.applesignin"];
    delete modConfig.modResults["com.apple.developer.associated-domains"];
    delete modConfig.modResults["com.apple.security.application-groups"];
    return modConfig;
  });
};
