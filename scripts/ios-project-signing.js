// Apply signing only to App's own configurations. Command-line provisioning
// settings would also reach Swift package targets, which do not accept profiles.
export function configureAppSigning(
  project,
  { teamId, identity, profileUuid },
) {
  const targets = project.match(
    /\/\* Begin PBXNativeTarget section \*\/([\s\S]*?)\/\* End PBXNativeTarget section \*\//,
  )?.[1];
  if (!targets) throw new Error("Cannot locate iOS native targets.");
  const appTargets = [
    ...targets.matchAll(
      /([A-F0-9]{24}) \/\* [^*]+ \*\/ = \{([\s\S]*?)\n\t\t\};/g,
    ),
  ].filter((match) => /\bname\s*=\s*"?App"?;/.test(match[2]));
  if (appTargets.length !== 1)
    throw new Error("Expected exactly one iOS App target.");
  const listId = appTargets[0][2].match(
    /\bbuildConfigurationList\s*=\s*([A-F0-9]{24})/,
  )?.[1];
  const object = (id) =>
    new RegExp(
      `(\\t\\t${id} /\\* [^*]+ \\*/ = \\{)([\\s\\S]*?)(\\n\\t\\t\\};)`,
    );
  const list = listId && project.match(object(listId));
  const configurations = list?.[2].match(
    /\bbuildConfigurations\s*=\s*\(([\s\S]*?)\);/,
  )?.[1];
  const ids = [...(configurations || "").matchAll(/([A-F0-9]{24}) \/\*/g)].map(
    (match) => match[1],
  );
  if (!ids.length) throw new Error("Cannot locate App build configurations.");
  const values = {
    CODE_SIGN_STYLE: "Manual",
    DEVELOPMENT_TEAM: teamId,
    CODE_SIGN_IDENTITY: identity,
    PROVISIONING_PROFILE_SPECIFIER: profileUuid,
  };
  let updated = project;
  for (const id of ids) {
    const pattern = object(id),
      configuration = updated.match(pattern);
    if (
      !configuration ||
      !/\bisa = XCBuildConfiguration;/.test(configuration[2])
    )
      throw new Error("An App signing configuration is missing.");
    const blockPattern = /(\bbuildSettings\s*=\s*\{)([\s\S]*?)(\n\t\t\t\};)/;
    const block = configuration[2].match(blockPattern);
    if (!block || /[{}]/.test(block[2]))
      throw new Error(
        "Unsupported App build settings; refusing broad signing overrides.",
      );
    let settings = block[2];
    for (const [key, value] of Object.entries(values)) {
      const line = `\t\t\t\t${key} = ${JSON.stringify(value)};`;
      const setting = new RegExp(`^[\\t ]*${key}\\s*=\\s*[^;]+;`, "m");
      settings = setting.test(settings)
        ? settings.replace(setting, () => line)
        : `${settings}\n${line}`;
    }
    const body = configuration[2].replace(
      blockPattern,
      (_, open, old, close) => open + settings + close,
    );
    updated = updated.replace(
      pattern,
      (_, open, old, close) => open + body + close,
    );
  }
  return updated;
}
