# Document recovery

See the [architecture index](../architecture/README.md) for current contracts
and the [decision index](../adr/README.md) for architecture decisions.

<!-- gen:begin docs-legacy-register -->

[The recovery register](../history.json) contains 64 document records.
To recover a document, use its recorded `recovery.commit` and `recovery.path`
with `git show <commit>:<path>`.

<!-- gen:end docs-legacy-register -->
