# Changelog

## Unreleased

### Breaking changes

- Store updater callbacks must be synchronous and side-effect-free. `update`
  and `updateFrom` do not accept promise-returning callbacks because concurrent
  writes may cause an updater to run more than once.
