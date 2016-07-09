import {
    createConnection,
    Diagnostic,
    DiagnosticSeverity,
    ErrorMessageTracker,
    Files,
    IConnection,
    InitializeError,
    InitializeResult,
    IPCMessageReader,
    IPCMessageWriter,
    ResponseError,
    TextDocument,
    TextDocuments
} from "vscode-languageserver";
import * as chokidar from "chokidar";
import * as fs from "fs";
import * as globule from "globule";
import * as path from "path";

// Create a connection for the server. The connection uses Node's IPC as a transport.
const connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

// Create a simple text document manager. The text document manager supports full document sync only.
const documents: TextDocuments = new TextDocuments();

// Make the text document manager listen on the connection for open, change, and close text document events.
documents.listen(connection);

// Settings as defined in VS Code.
interface Settings {
    sasslint: {
        enable: boolean;
        configFile: string;
        resolvePathsRelativeToConfig: boolean;
    };
}

let sassLint;
let settings: Settings;
let configPathCache: {[key: string]: string} = {};
let settingsConfigFile;
let settingsConfigFileWatcher: fs.FSWatcher = null;
const CONFIG_FILE_NAME = ".sass-lint.yml";

// After the server has started the client sends an initialize request.
// The server receives in the passed params the rootPath of the workspace plus the client capabilities.
let workspaceRoot: string;
connection.onInitialize((params): Thenable<InitializeResult | ResponseError<InitializeError>> => {
    workspaceRoot = params.rootPath;

    // Watch ".sass-lint.yml" files.
    const watcher = chokidar.watch(`**/${CONFIG_FILE_NAME}`, {ignoreInitial: true, persistent: false});
    watcher.on("all", (event, filePath) => {
        // Clear cache.
        configPathCache = {};

        validateAllTextDocuments(documents.all());
    });

    return Files.resolveModule(workspaceRoot, "sass-lint").then(
        (value): InitializeResult | ResponseError<InitializeError> => {
            sassLint = value;

            let result: InitializeResult = {
                capabilities: {
                    textDocumentSync: documents.syncKind
                }
            };

            return result;
        },
        (error) => {
            return Promise.reject(
                new ResponseError<InitializeError>(
                    99,
                    `Failed to load sass-lint library. Please install sass-lint in your workspace folder using 'npm
                    install sass-lint' or globally using 'npm install sass-lint -g' and then press Retry.`,
                    {retry: true}
                )
            );
        }
    );
});

// The content of a text document has changed.
// This event is emitted when the text document is first opened or when its content has changed.
documents.onDidChangeContent((change) => {
    validateTextDocument(change.document);
});

// A text document was closed. Clear the diagnostics.
documents.onDidClose((event) => {
    connection.sendDiagnostics({uri: event.document.uri, diagnostics: []});
});

function validateTextDocument(textDocument: TextDocument): void {
    let filePath = Files.uriToFilePath(textDocument.uri);
    if (!filePath) {
        // Sass Lint can only lint files on disk.
        return;
    }

    const diagnostics: Diagnostic[] = [];

    const configFile = getConfigFile(filePath);

    const compiledConfig = sassLint.getConfig({}, configFile);

    const relativePath = getFilePath(filePath, configFile);

    if (globule.isMatch(compiledConfig.files.include, relativePath) &&
        !globule.isMatch(compiledConfig.files.ignore, relativePath)) {
        const result = sassLint.lintText(
            {
                text: textDocument.getText(),
                format: path.extname(filePath).slice(1),
                filename: filePath
            },
            {},
            configFile
        );

        for (const msg of result.messages) {
            diagnostics.push(makeDiagnostic(msg));
        }
    }

    // Send the computed diagnostics to VSCode.
    connection.sendDiagnostics({uri: textDocument.uri, diagnostics});
}

function validateAllTextDocuments(textDocuments: TextDocument[]): void {
    const tracker = new ErrorMessageTracker();

    for (const document of textDocuments) {
        try {
            validateTextDocument(document);
        } catch (err) {
            tracker.add(getErrorMessage(err, document));
        }
    }

    tracker.sendErrors(connection);
}

function getConfigFile(filePath: string): string {
    const dirName = path.dirname(filePath);

    let configFile = configPathCache[dirName];

    if (configFile) {
        return configFile;
    } else {
        configFile = locateFile(dirName, CONFIG_FILE_NAME);

        if (configFile) {
            // Cache.
            configPathCache[dirName] = configFile;

            return configFile;
        }
    }

    if (settingsConfigFile) {
        // Cache.
        configPathCache[dirName] = settingsConfigFile;

        return settingsConfigFile;
    }

    return null;
}

function locateFile(directory: string, fileName: string): string {
    let parent = directory;

    do {
        directory = parent;

        const location = path.join(directory, fileName);

        try {
            fs.accessSync(location, fs.R_OK);

            return location;
        } catch (e) {
            // Do nothing.
        }

        parent = path.dirname(directory);
    } while (parent !== directory);

    return null;
};

function getFilePath(absolutePath, configFilePath): string {
    if (settings.sasslint.resolvePathsRelativeToConfig) {
        return path.relative(path.dirname(configFilePath), absolutePath);
    } else {
        return path.relative(workspaceRoot, absolutePath);
    }
}

function makeDiagnostic(msg): Diagnostic {
    let severity;
    switch (msg.severity) {
        case 1:
            severity = DiagnosticSeverity.Warning;
            break;
        case 2:
            severity = DiagnosticSeverity.Error;
            break;
        default:
            severity = DiagnosticSeverity.Information;
            break;
    }

    let line;
    if (msg.line) {
        line = msg.line - 1;
    } else {
        line = 0;
    }

    let column;
    if (msg.column) {
        column = msg.column - 1;
    } else {
        column = 0;
    }

    let message;
    if (msg.message) {
        message = msg.message;
    } else {
        message = "Unknown error";
    }

    return {
        severity: severity,
        range: {
            start: {line: line, character: column},
            end:   {line: line, character: column + 1}
        },
        message: message,
        source: "sass-lint"
    };
}

function getErrorMessage(err, document: TextDocument): string {
    let errorMessage = "unknown error";

    if (typeof err.message === "string" || err.message instanceof String) {
        errorMessage = (err.message as string);
    }

    const fsPath = Files.uriToFilePath(document.uri);
    const message = `vscode-sass-lint: '${errorMessage}' while validating: ${fsPath} stacktrace: ${err.stack}`;

    return message;
}

// The settings have changed. Sent on server activation as well.
connection.onDidChangeConfiguration((params) => {
    settings = params.settings;

    let newConfigFile = null;

    // Watch configFile specified in VS Code settings.
    if (settings.sasslint && settings.sasslint.configFile) {
        newConfigFile = settings.sasslint.configFile;

        try {
            // Check if the file can be read.
            fs.accessSync(newConfigFile, fs.R_OK);
        } catch (e) {
            connection.window.showErrorMessage(
                `The file ${newConfigFile} referred to by 'sasslint.configFile' could not be read`
            );

            return;
        }
    }

    if (settingsConfigFile !== newConfigFile) {
        // Clear cache.
        configPathCache = {};

        // Stop watching the old config file.
        if (settingsConfigFileWatcher) {
            settingsConfigFileWatcher.close();
            settingsConfigFileWatcher = null;
        }

        // Start watching the new config file.
        if (newConfigFile) {
            settingsConfigFileWatcher = chokidar.watch(newConfigFile, {ignoreInitial: true, persistent: false});
            settingsConfigFileWatcher.on("all", (event, filePath) => {
                // Clear cache.
                configPathCache = {};

                validateAllTextDocuments(documents.all());
            });
        }

        settingsConfigFile = newConfigFile;
    }

    // Revalidate any open text documents.
    validateAllTextDocuments(documents.all());
});

// Listen on the connection.
connection.listen();
