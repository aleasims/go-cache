# Go Cache Action

A GitHub Action that implements smart caching for Go projects with
sensible defaults.

This project is an adaptation of [Swatinem/rust-cache](https://github.com/Swatinem/rust-cache) for Go.

## Example of usage

```yaml
- uses: aleasims/go-cache@v1
  with:
    # The prefix cache key, this can be changed to start a new cache manually.
    # default: "v0-go"
    prefix-key: ""

    # A cache key that is used instead of the automatic `job`-based key,
    # and is stable over multiple jobs.
    # default: empty
    shared-key: ""

    # An additional cache key that is added alongside the automatic `job`-based
    # cache key and can be used to further differentiate jobs.
    # default: empty
    key: ""

    # A whitespace separated list of env-var *prefixes* who's value contributes
    # to the environment cache key.
    # The env-vars are matched by *prefix*.
    # default: "CC CFLAGS CXX CMAKE"
    env-vars: ""

    # The modules paths.
    # A newline separated list of paths to directories with go.mod files.
    # default: "."
    modules: ""

    # Additional non workspace directories to be cached, separated by newlines.
    cache-directories: ""

    # Determines if the cache should be saved even when the workflow has failed.
    # default: "false"
    cache-on-failure: ""

    # Determines whether the cache should be saved.
    # If `false`, the cache is only restored.
    # default: "true"
    save-if: ""
    # To only cache runs from `master`:
    save-if: ${{ github.ref == 'refs/heads/master' }}

    # Determines whether the cache should be restored.
    # If `true` the cache key will be checked and the `cache-hit` output will be set
    # but the cache itself won't be restored
    # default: "false"
    lookup-only: ""

    # Specifies what to use as the backend providing cache
    # Can be set to "github", "buildjet", or "warpbuild"
    # default: "github"
    cache-provider: ""

    # Determines whether to cache the $GOBIN directory.
    # default: "true"
    cache-bin: ""
```

## Motivation

[actions/setup-go](https://github.com/actions/setup-go) is doing a good job in installing Go. However it has
a very poor caching support, missing some crucial features like manual cache key prefixes.

Some other actions are improving caching features, but they tend to cover Go installation as well with a limited
set of options there. This action is using a more like UNIX approach - one tool for one job.
It is designed to handle **only caching**.

## Contributing

Just open an issue or a pull request if you want to report a bug or suggest a feature.

## Roadmap

Some things are still missing:

- [ ] Parsing `go.mod` to be smarter about the dependencies
- [ ] Take Go-related env vars into account
