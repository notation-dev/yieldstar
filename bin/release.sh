#!/bin/bash

set -euo pipefail

dry_run=false
case "${1:-}" in
  --dry-run) dry_run=true ;;
  "") ;;
  *) echo "Usage: $0 [--dry-run]" >&2; exit 1 ;;
esac

version=$(node -p "require('./package.json').version")
publish_args=""
tag_args=""
if $dry_run; then
  publish_args="--dry-run --no-git-checks"
fi
[[ "$version" == *alpha* ]] && tag_args="--tag alpha"

print_header() {
  echo -e "\n\n===\n $1 \n===\n"
}

publish_scoped_packages() {
  print_header "Publishing @yieldstar packages"
  pnpm publish --filter '@yieldstar/*' --fail-if-no-match $publish_args $tag_args
}

publish_unscoped_package() {
  print_header "Publishing unscoped yieldstar package"
  pnpm publish --filter 'yieldstar' --fail-if-no-match $publish_args $tag_args
}

switch_user() {
  local target_user=$1
  print_header "Now switch npm account to $target_user and log in again"
  sleep 2
  npm logout
  npm login
}

if $dry_run; then
  print_header "Dry-running release for $version"
  publish_scoped_packages
  publish_unscoped_package
  print_header "Release dry run completed successfully!"
  exit 0
fi

current_user=$(npm whoami 2>/dev/null || echo "none")
print_header "Current npm user: $current_user"

if [ "$current_user" = "yieldstar" ]; then
  publish_scoped_packages
  switch_user "notation"
  publish_unscoped_package
  
elif [ "$current_user" = "notation" ]; then
  publish_unscoped_package
  switch_user "yieldstar"
  publish_scoped_packages
  
else
  print_header "Log into npm as either yieldstar or notation"
  sleep 2
  npm login
  
  # Re-run the script after login
  exec $0
fi

print_header "Release completed successfully!"
