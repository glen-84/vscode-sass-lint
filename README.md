# vscode-sass-lint

VS Code extension to support [sass-lint](https://github.com/sasstools/sass-lint).

## Development setup
* run `npm install` inside the `sass-lint` and `sass-lint-server` folders
* run `typings install` inside the `sass-lint` and `sass-lint-server` folders
* open VS Code on `sass-lint` and `sass-lint-server`

## Developing the server
* open VS Code on `sass-lint-server`
* run `npm run compile` or `npm run watch` to build the server and copy it into the `sass-lint` folder
* to debug press F5 which attaches a debugger to the server

## Developing the extension/client
* open VS Code on `sass-lint`
* run F5 to build and debug the extension
