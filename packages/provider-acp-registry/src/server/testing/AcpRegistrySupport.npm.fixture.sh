#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_NPM_LOG"
prefix="${npm_config_prefix:-$FAKE_NPM_PREFIX}"
if [ "$1" = "root" ] && [ "$2" = "--global" ]; then
  printf '%s\n' "$prefix/lib/node_modules"
  exit 0
fi
if [ "$1" = "prefix" ] && [ "$2" = "--global" ]; then
  printf '%s\n' "$prefix"
  exit 0
fi
if [ "$1" = "install" ] && [ "$2" = "--global" ]; then
  if [ "$FAKE_NPM_REQUIRE_LIB" = "1" ] && [ ! -d "$prefix/lib" ]; then
    printf 'ENOENT: missing global prefix lib directory\n' >&2
    exit 254
  fi
  package_root="$prefix/lib/node_modules/@example/acp"
  executable="$prefix/bin/example-agent"
  mkdir -p "$package_root" "$prefix/bin"
  printf '%s' "$FAKE_NPM_MANIFEST" > "$package_root/package.json"
  printf '#!/bin/sh\n' > "$executable"
  chmod 755 "$executable"
  exit 0
fi
exit 64
