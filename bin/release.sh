#!/bin/bash

echo "\n\nLogin as yieldstar:\n\n"

npm logout
npm login

# Publish all @yieldstar packages
for pkg in packages/*; do
  if [[ "$pkg" != "packages/yieldstar" && -d "$pkg" ]]; then
    bun publish --cwd="$pkg"
  fi
done

echo "\n\nNow login as notation:\n\n"

npm logout
npm login

bun publish --cwd="packages/yieldstar"