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

# Dependency audit: copyleft packages in the base install (`paramiko`, `pyxlsb`)

`pyproject.toml` allowlists two packages in `[tool.liccheck.authorized_packages]`
with the bare comment `# GPL` and a `TODO REMOVE THESE DEPS FROM CODEBASE`:

```toml
# TODO REMOVE THESE DEPS FROM CODEBASE
paramiko = "3"  # GPL
pyxlsb = "1"  # GPL
```

Both are installed by the default (non-optional) install: `paramiko==3.5.1` and
`pyxlsb==1.0.10` are pinned in `requirements/base.txt`. This document records
what license each distribution actually declares, how it enters the dependency
graph, whether anything in `superset/` needs it, and what to do about it. It
changes no dependency declaration, version pin, requirements file or liccheck
entry — the point is to make a later change defensible, not to make it here.

Evidence was gathered against the exact pinned versions, downloaded from PyPI
(`pip download --no-deps paramiko==3.5.1`, `pip download --no-deps --no-binary
:all: pyxlsb==1.0.10`) and read out of the distribution metadata and license
files, because the `# GPL` comments above are unsourced and imprecise.

## ASF policy context

The ASF third-party licensing policy
(<https://www.apache.org/legal/resolved.html>) classifies the GNU licenses —
GPL v1/v2/v3, LGPL v2.1, LGPL v3, AGPL — as **Category X**: works under those
licenses may not be included in an Apache product. The policy does allow an
Apache product to depend on a Category X work at arm's length when the
dependency is *optional* and not shipped in the release: "an Apache product may
include or depend on a Category X work if the dependency is optional and the
product remains fully functional without it". Shipping such a package in the
default install of the released artifact is what the policy prohibits, so the
distinction that matters below is **base install vs. optional extra**, not
"GPL vs. LGPL".

Both packages here are Category X (LGPL variants), and both are in the base
install today.

## `paramiko` — LGPL v2.1

### Declared license

The published wheel `paramiko-3.5.1-py3-none-any.whl` declares, in
`paramiko-3.5.1.dist-info/METADATA`:

```
Name: paramiko
Version: 3.5.1
License: LGPL
Classifier: License :: OSI Approved :: GNU Library or Lesser General Public License (LGPL)
License-File: LICENSE
```

The bundled `LICENSE` file is specific where the metadata is not — it is the
LGPL v2.1 text:

```
		  GNU LESSER GENERAL PUBLIC LICENSE
		       Version 2.1, February 1999
```

So the precise identifier is **LGPL-2.1** (Category X), not "GPL" as the
`pyproject.toml` comment says.

### How it enters the dependency graph

Two ways, both non-optional:

1. **Direct base dependency** in `pyproject.toml`:
   `"paramiko>=3.4.0, <4.0", # 4.0 removed DSSKey, still referenced by sshtunnel`
2. **Transitively via `sshtunnel`**, itself a direct base dependency
   (`"sshtunnel>=0.4.0, <0.5"`). `sshtunnel==0.4.0` (MIT) requires
   `paramiko>=2.7.2`.

`requirements/base.txt` records exactly this:

```
paramiko==3.5.1
    # via
    #   apache-superset (pyproject.toml)
    #   sshtunnel
```

Its own transitive deps in the base install are `bcrypt` and `pynacl`
(`# via paramiko`).

### Who needs it

`paramiko` is imported directly by the SSH tunnel implementation:

```
$ grep -rn -i paramiko superset/
superset/extensions/ssh.py:25:import paramiko
superset/extensions/ssh.py:28:from paramiko import (
superset/extensions/ssh.py:36:from paramiko.pkey import UnknownKeyType
...
```

That module is not lazily loaded: `superset/extensions/__init__.py` does
`from superset.extensions.ssh import SSHManagerFactory` at module scope and
instantiates `ssh_manager_factory`, which the app initialises unconditionally
(`superset/initialization/__init__.py` → `configure_ssh_manager()`), and
`superset/models/core.py` calls `ssh_manager_factory.instance.create_tunnel(...)`.
`SSHManager` uses paramiko for host key parsing and verification and for the
`Transport` used to pin the expected key. `sshtunnel` — a paramiko wrapper — is
the second consumer, reached through the same `SSHManager`.

So paramiko has a real consumer today, and removing it would remove the SSH
tunnel feature.

### Recommendation

**Move it behind an optional extra** (e.g. `superset[ssh-tunnel]` carrying
`paramiko` and `sshtunnel`), and keep the liccheck allowlist entry only for the
non-default install used to test that extra.

Reasoning: paramiko cannot simply be dropped — the SSH tunnel feature depends
on it — and replacing it is not realistic: it is the only mature pure-Python
SSH implementation in this ecosystem, and `sshtunnel` is built on it, so a
replacement would mean reimplementing both. That leaves the arm's-length option
the ASF policy explicitly permits: make it optional so the default release does
not ship a Category X work. This requires the eager import chain above to
become lazy (import `paramiko`/`sshtunnel` inside `SSHManager` methods, or make
`ssh_manager_factory` tolerate an absent driver) so that Superset stays fully
functional without the extra installed, which is exactly what the policy
requires. If the community would rather not make the feature optional, the
allowlist entry needs to record that decision and the legal reasoning behind
it, not a bare `# GPL` and a `TODO`.

## `pyxlsb` — LGPL v3 or later

### Declared license

The sdist `pyxlsb-1.0.10.tar.gz` declares, in `PKG-INFO`:

```
Name: pyxlsb
Version: 1.0.10
License: LGPLv3+
Classifier: License :: OSI Approved :: GNU Lesser General Public License v3 or later (LGPLv3+)
License-File: COPYING
License-File: COPYING.LESSER
```

`setup.py` carries the same `license='LGPLv3+'`, and the distribution ships the
GPL v3 (`COPYING`) and LGPL v3 (`COPYING.LESSER`) texts. The precise identifier
is therefore **LGPL-3.0-or-later** (Category X), again not plain "GPL".

### How it enters the dependency graph

Only transitively, via the `excel` extra of pandas in `pyproject.toml`:

```toml
"pandas[excel]>=2.3.3, <2.4",
```

`pandas 2.3.3`'s `excel` extra pulls in six packages:

```
odfpy>=1.4.1; extra == "excel"
openpyxl>=3.1.0; extra == "excel"
python-calamine>=0.1.7; extra == "excel"
pyxlsb>=1.0.10; extra == "excel"
xlrd>=2.0.1; extra == "excel"
xlsxwriter>=3.0.5; extra == "excel"
```

so `requirements/base.txt` pins all of them, including:

```
pyxlsb==1.0.10
    # via pandas
```

`pyxlsb` is pandas' engine for the binary `.xlsb` format only. Nothing else in
the graph requires it.

### Who needs it

**Nothing.** There is no consumer anywhere in the repository — not in
`superset/`, not in tests:

```
$ grep -rn -i 'pyxlsb\|xlsb' superset/
(no matches)

$ grep -rn -i 'pyxlsb\|xlsb' .   # excluding .git and node_modules
./requirements/base.txt:353:pyxlsb==1.0.10
./requirements/development.txt:864:pyxlsb==1.0.10
./pyproject.toml:492:pyxlsb = "1"  # GPL
```

(The remaining hits are base64 image blobs inside a frontend notebook, not
references to the package.) The three real hits are the pin, its development
echo, and the liccheck allowlist entry — i.e. the package is installed, license
allowlisted, and never used.

### Would narrowing `pandas[excel]` remove it?

**Yes.** `pyxlsb` is only reachable through the `excel` extra, so replacing
`pandas[excel]` with the individual readers/writers Superset actually uses drops
it entirely. Superset's Excel surface is:

- **Reading uploads** — `superset/commands/database/uploaders/excel_reader.py`
  calls `pd.read_excel(...)` / `pd.ExcelFile(...)`, and the accepted extensions
  are limited to `EXCEL_EXTENSIONS = {"xlsx", "xls"}` in `superset/config.py`.
  `.xlsb` is not an accepted upload extension, so the `pyxlsb` engine can never
  be selected. The engines needed are **`openpyxl`** (`.xlsx`) and **`xlrd`**
  (`.xls`); `python-calamine` also handles both and is already pinned.
- **Writing exports** — `superset/utils/excel.py` uses
  `pd.ExcelWriter(output, engine="xlsxwriter")`, so **`xlsxwriter`** is
  required.

That is `openpyxl`, `xlrd`, `xlsxwriter` (plus `python-calamine` if the faster
reader is wanted). `odfpy` (`.ods`) is likewise unused by the accepted
extensions, though it is not a Category X package and so is out of scope here.

### Recommendation

**Drop it**, by narrowing the extra rather than by allowlisting it. Concretely,
replace `"pandas[excel]>=2.3.3, <2.4"` with plain `"pandas>=2.3.3, <2.4"` plus
explicit `openpyxl`, `xlrd` and `xlsxwriter` requirements (adding
`python-calamine` if the current reader behaviour should be preserved
byte-for-byte), then recompile `requirements/base.txt` and delete the
`pyxlsb = "1"` liccheck entry.

Reasoning: this is a Category X package in the base install with zero consumers,
so there is nothing to preserve and no justification available for the allowlist
entry — the only reason it is present is that `pandas[excel]` is broader than
Superset's needs. Narrowing the extra is also strictly clearer about which
Excel engines the product actually supports. **This change is deliberately not
made in this PR**; the audit exists so it can be proposed on its own with the
license evidence attached.

## Summary

| Package | Declared license | Category | Enters via | Consumer in `superset/` | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `paramiko` 3.5.1 | LGPL-2.1 (metadata `License: LGPL`, bundled LGPL v2.1 text) | X | direct base dep + transitively via `sshtunnel` | yes — `superset/extensions/ssh.py` (`SSHManager`) | move behind an optional `ssh-tunnel` extra; keep the allowlist entry only with recorded justification |
| `pyxlsb` 1.0.10 | LGPL-3.0-or-later (`License: LGPLv3+`, `COPYING.LESSER`) | X | `pandas[excel]` extra only | none | drop: narrow `pandas[excel]` to `openpyxl`/`xlrd`/`xlsxwriter` and remove the allowlist entry |
