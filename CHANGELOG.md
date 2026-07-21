# Changelog

## Unreleased

### Breaking changes

- Store updater callbacks are now synchronous. `update` and `updateFrom` no
  longer accept promise-returning updaters; callbacks must also be deterministic
  and side-effect-free because a CAS conflict may run them again.
