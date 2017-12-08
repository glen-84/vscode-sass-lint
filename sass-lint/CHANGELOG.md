# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to
[Semantic Versioning](http://semver.org/).

## [1.0.1] - 2017-12-08

### Changed

* Deep clone settings
* More deferral of resolving global package manager path
* Improve messages for the sasslint.packageManager setting
* Update to tasks 2.0
* Update dependencies

### Fixed

* Ensure that `workspaceFolders` is defined before iterating (potential fix for [#21](https://github.com/glen-84/vscode-sass-lint/issues/21))

## [1.0.0] - 2017-11-12

### Added

* Added support for multi-root workspaces ([#19](https://github.com/glen-84/vscode-sass-lint/issues/19))
* Added `packageManager` setting with support for Yarn ([#13](https://github.com/glen-84/vscode-sass-lint/issues/13))
* Added `nodePath` setting (A path added to NODE_PATH when resolving the sass-lint module)
* Added `trace.server` setting (Traces the communication between VSCode and the sass-lint linter service)
* Rule ID added to message (thanks to [@thierrymichel](https://github.com/thierrymichel)) ([#18](https://github.com/glen-84/vscode-sass-lint/pull/18))

### Changed

* Loads the sass-lint library that is nearest to the linted file ([#16](https://github.com/glen-84/vscode-sass-lint/issues/16))
* When the `run` setting is set to `onSave`, clear warnings when the user makes changes
* Updated dependencies

### Removed

* External sass-lint config files are no longer watched – you will need to reload VS Code after making changes

## [0.0.4] - 2017-04-09

### Changed

* Update dependencies

### Fixed

* Use VS Code file system watcher (see [#2](https://github.com/glen-84/vscode-sass-lint/issues/2))

## [0.0.3] - 2016-11-05

### Changed

* Update dependencies

### Removed

* Remove outdated "sass-indented" language from activationEvents

## [0.0.2] - 2016-10-02

### Added

* Add badges to README
* Add a setting to lint on save only
* Add CHANGELOG

### Changed

* Update dependencies

## 0.0.1 - 2016-07-09

Initial release.

[1.0.1]: https://github.com/glen-84/vscode-sass-lint/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/glen-84/vscode-sass-lint/compare/v0.0.4...v1.0.0
[0.0.4]: https://github.com/glen-84/vscode-sass-lint/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/glen-84/vscode-sass-lint/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/glen-84/vscode-sass-lint/compare/v0.0.1...v0.0.2
