#!/bin/bash

version=$(git describe)
tag_flag=""
[[ "$version" == *alpha* ]] && tag_flag="--tag alpha"

echo "\n\n=== Login as yieldstar ===\n\n"

npm logout
npm login

# Publish all @yieldstar packages
pnpm publish --filter '@yieldstar/*' $tag_flag

echo "\n\n=== Login as notation ===\n\n"

npm logout
npm login

# Publish unscoped yieldstar package (managed by @notation)
pnpm publish --filter 'yieldstar' $tag_flag