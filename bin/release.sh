#!/bin/bash

version=$(git describe)
tag_flag=""
[[ "$version" == *alpha* ]] && tag_flag="--tag alpha"

echo "\n\n=== Login as yieldstar ===\n\n"

npm logout
npm login

# Publish all @yieldstar packages
for pkg in packages/*; do
  if [[ "$pkg" != "packages/yieldstar" && -d "$pkg" ]]; then
    bun publish --cwd="$pkg" $tag_flag
  fi
done

echo "\n\n=== Login as notation ===\n\n"

npm logout
npm login

# Publish unscoped yieldstar package (managed by @notation)
bun publish --cwd="packages/yieldstar" $tag_flag