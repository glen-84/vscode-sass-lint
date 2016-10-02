# vscode-sass-lint

![Version](https://vsmarketplacebadge.apphb.com/version-short/glen-84.sass-lint.svg)
![Installs](https://vsmarketplacebadge.apphb.com/installs-short/glen-84.sass-lint.svg)
![Rating](https://vsmarketplacebadge.apphb.com/rating-short/glen-84.sass-lint.svg)

Integrates the [sass-lint](https://github.com/sasstools/sass-lint) linter into VS Code.

Please refer to the sass-lint [documentation](https://github.com/sasstools/sass-lint) for how to configure the linting
rules.

# Prerequisites

The extension requires that sass-lint is installed either locally or globally.

# Configuration options

* `sasslint.enable` - Enable or disable linting.
* `sasslint.configFile` - A `.sass-lint.yml` file to use/fallback to if no config file is found in the current project.
* `sasslint.resolvePathsRelativeToConfig` - This option allows you to choose to resolve file paths relative to your
config file rather than relative to the root of your currently open project.
* `sasslint.run` - Run the linter `onSave` or `onType`, default is `onType`.
