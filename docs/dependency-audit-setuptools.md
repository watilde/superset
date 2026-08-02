<!--
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->

# Audit: the `setuptools<81` ceiling and remaining `pkg_resources` importers

Audit date: 2026-08-02. Tracks issue #4. Scope: the `setuptools<81` pin in
`requirements/base.in`.

## Summary

`pkg_resources` is no longer shipped by setuptools as of **82.0.0** (81.0.0 still
ships it and only emits a `UserWarning`). Exactly one runtime dependency still
imports it unconditionally: **`sqlalchemy-redshift` 0.8.x**, which is the version
range Superset is pinned to. Its `pkg_resources`-free release (1.0.0) requires
SQLAlchemy >= 2.0, and Superset is pinned to `sqlalchemy>=1.4.43,<2`, so the
dependency cannot be moved yet.

**Recommendation: keep the ceiling.** It may safely be widened from `<81` to
`<82`, but it cannot be lifted until Superset supports SQLAlchemy 2.0. See
[Recommendation](#recommendation).

## Method / evidence

1. A Python 3.11 virtualenv was created and `requirements/base.txt`,
   `requirements/development.txt` and the pinned `redshift` extra
   (`sqlalchemy-redshift>=0.8.1,<0.9`) were installed into it.
2. `site-packages` was grepped for real import statements (not comments or
   docstrings):

   ```console
   $ grep -rIl --include="*.py" -E "(^|[^#\w])(import pkg_resources|from pkg_resources import)" .
   ```

3. Every distribution found was then read to determine whether the import is
   unconditional (module import time) or guarded/lazy, and each top-level module
   was imported under `python -W error::UserWarning` to see which ones actually
   trigger setuptools' deprecation warning.
4. All 99 direct requirements of the `[project.optional-dependencies]` extras in
   `pyproject.toml` (database drivers, dev tooling) were resolved to the newest
   version allowed by their specifier, downloaded, and their `.py` files scanned
   for the same import statements. 12 of them are sdist-only and were fetched
   from the PyPI JSON API and scanned the same way.
5. The `<81` / `<82` boundary was verified empirically (see
   [Where the boundary actually is](#where-the-boundary-actually-is)).

Not covered: transitive dependencies of the database-driver extras (only the
base/dev dependency trees are fully resolved in this repo), and any package
installed by a deployment on top of the published image.

## Distributions that still reference `pkg_resources`

| Distribution | Installed version | Where | Import type | Triggers warning on import? | `importlib.metadata`-based release |
| --- | --- | --- | --- | --- | --- |
| `sqlalchemy-redshift` (extra `redshift`) | 0.8.14 | `sqlalchemy_redshift/__init__.py:1`, `sqlalchemy_redshift/dialect.py` | **unconditional, at import time** | **yes** | **1.0.0** — but requires `SQLAlchemy>=2.0.0,<3` |
| `nodeenv` (dev, via `pre-commit`) | 1.8.0 | `nodeenv.py:48` | **unconditional, at import time** | **yes** | **1.9.0** (verified clean; 1.10.0 is latest) |
| `isort` (dev) | 6.0.1 | `isort/settings.py` (2 sites) | lazy — only when a plugin profile or a `formatter` is configured | no | **6.1.0** (verified clean) |
| `pytest` (dev) | 7.4.4 | `_pytest/monkeypatch.py` | guarded — only if `pkg_resources` is *already* in `sys.modules` | no | n/a — no-op without `pkg_resources` (still present in 9.x) |
| `babel` | 2.17.0 | `babel/messages/_compat.py` | fallback — tries `importlib.metadata` first, `pkg_resources` in a `try/except ImportError` | no | already migrated |
| `pytz` | 2025.2 | `pytz/__init__.py` | fallback in `try/except ImportError`, only if the zoneinfo file is missing | no | n/a |
| `werkzeug` | 3.1.6 | `werkzeug/testapp.py` | `try/except ImportError`, debug test app only | no | n/a |
| `wrapt` | 1.17.2 | `wrapt/importer.py` | `try/except ImportError` in `discover_post_import_hooks()` | no | n/a |
| `pip` | 25.1.1 | `pip/_internal/metadata/` | selects `importlib.metadata` by default on Python 3.11+; `pkg_resources` backend is opt-in and unusable on 3.14+ | no | already migrated |
| `click-plugins`, `lz4`, `wcwidth` | 1.1.1 / 4.4.5 / 0.2.13 | docstrings and commented-out code only | none | no | already migrated |

Superset's own source contains no `pkg_resources` import — only
`warnings.filterwarnings()` calls that suppress the `sqlalchemy-redshift`
warning (`superset/db_engine_specs/redshift.py`,
`superset/initialization/__init__.py`, `superset/mcp_service/`).

The pin's comment names "Preset's `clients` package" as affected; no such
distribution appears anywhere in `requirements/base.txt`,
`requirements/development.txt` or `pyproject.toml`, so it is not a factor for
this repository.

Scan of the 99 direct extras requirements at their newest allowed versions
produced hits for `sqlalchemy-redshift` and `pytest` only; every other driver
(including `pyhive`, `pydruid`, `kylinpy`, `mysqlclient`, `python-ldap`,
`shillelagh`, `snowflake-sqlalchemy`, `sqlalchemy-bigquery`, `trino`, ...) is
clean.

## Where the boundary actually is

`pkg_resources` is still shipped in setuptools 81.0.0 and removed in 82.0.0:

```console
$ # count of pkg_resources/* files in each wheel
setuptools-81.0.0-py3-none-any.whl 19
setuptools-82.0.0-py3-none-any.whl 0
setuptools-83.0.0-py3-none-any.whl 0
```

Confirmed against the actual failure mode, in a venv with
`sqlalchemy-redshift==0.8.14`:

```console
$ # setuptools 81.0.0
UserWarning: pkg_resources is deprecated as an API. ...
import OK, version 0.8.14

$ # setuptools 82.0.0
ModuleNotFoundError: No module named 'pkg_resources'
```

So under setuptools >= 82 the `redshift` extra fails at import of
`sqlalchemy_redshift`, which SQLAlchemy loads lazily when a `redshift://` engine
is created — i.e. it breaks connecting to Redshift, not startup. Under 81 it
only warns, and that warning is already filtered by Superset (the existing
filters match `UserWarning`, which is what 81 raises, so they keep working).

## Blocker for the one hard case

`sqlalchemy-redshift` 1.0.0 metadata:

```
Requires-Dist: SQLAlchemy<3,>=2.0.0
Requires-Dist: packaging
```

and its `__init__.py` uses `from importlib.metadata import PackageNotFoundError, version`.

Superset pins `sqlalchemy>=1.4.43, <2` (`pyproject.toml`), so 1.0.0 is not
installable. This is the same reason apache/superset#39750 was closed, as
recorded in the comment in `superset/db_engine_specs/redshift.py`. There is no
intermediate 0.8.x/0.9.x release that drops `pkg_resources`: 1.0.0 is the next
release after 0.8.14.

## Recommendation

**Keep the pin, but widen it to `setuptools<82`.** Do not lift it.

Reasoning:

- Lifting entirely would break the `redshift` extra on any fresh install, since
  setuptools >= 82 no longer ships `pkg_resources` at all and
  `sqlalchemy-redshift` 0.8.x imports it at module import time.
- The fix for the only hard blocker is gated on the SQLAlchemy 2.0 migration,
  not on a dependency bump we control. Until `sqlalchemy>=2` is supported, the
  ceiling has to stay.
- `<82` rather than `<81` is accurate and low risk: 81.0.0 still ships
  `pkg_resources` and only warns, and the warning is already suppressed. This is
  optional; it only buys one minor version, so it is equally defensible to leave
  the pin at `<81` and change it once as part of the SQLAlchemy 2.0 work.
- Vendoring `pkg_resources` or depending on a standalone shim to escape the pin
  is not recommended: no maintained standalone `pkg_resources` distribution
  exists.

Follow-ups that reduce the blast radius but are out of scope here (both are dev
dependencies, and `requirements/development.txt` is generated):

- bump `nodeenv` from 1.8.0 to `>=1.9.0` — the only other unconditional importer,
  it would break `pre-commit` under setuptools >= 82;
- bump `isort` from 6.0.1 to `>=6.1.0` — lazy import, only reachable through
  plugin profiles/formatters, so not currently a break.

Re-evaluate this audit when Superset lands SQLAlchemy 2.0 support; at that point
`sqlalchemy-redshift>=1.0.0` removes the last blocker and the ceiling can be
dropped.
