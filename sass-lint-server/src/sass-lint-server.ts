import {
    ConfigurationRequest,
    createConnection,
    Diagnostic,
    DiagnosticSeverity,
    ErrorMessageTracker,
    Files,
    InitializeParams,
    ProposedFeatures,
    RequestType,
    TextDocument,
    TextDocumentIdentifier,
    TextDocuments,
    WorkspaceFolder
} from "vscode-languageserver";
import {URI} from "vscode-uri";
import fs from "fs";
import globule from "globule";
import path from "path";
import sassLint from "sass-lint";

// Create a connection for the server. The connection uses Node's IPC as a transport.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager supports full document sync only.
const documents: TextDocuments = new TextDocuments();

// Make the text document manager listen on the connection for open, change, and close text document events.
documents.listen(connection);

// Settings as defined in VS Code.
interface Settings {
    enable: boolean;
    configFile: string;
    resolvePathsRelativeToConfig: boolean;
    run: "onSave" | "onType";
    packageManager: "npm" | "yarn";
    nodePath: string | undefined;
    trace: "off" | "messages" | "verbose";
    workspaceFolderPath: string | undefined;
}

class SettingsCache {
    private uri: string | undefined;
    private promise: Promise<Settings> | undefined;

    public constructor() {
        this.uri = undefined;
        this.promise = undefined;
    }

    public async get(uri: string): Promise<Settings> {
        if (uri === this.uri) {
            trace(`SettingsCache: cache hit for: ${this.uri}`);

            // tslint:disable-next-line:no-non-null-assertion
            return this.promise!;
        }

        if (hasConfigurationCapability) {
            this.uri = uri;

            return this.promise = new Promise<Settings>(async (resolve, _reject) => {
                trace(`SettingsCache: cache updating for: ${this.uri}`);

                const configRequestParam = {items: [{scopeUri: uri, section: "sasslint"}]};
                // tslint:disable-next-line:await-promise
                const settings = await connection.sendRequest(ConfigurationRequest.type, configRequestParam);

                resolve(settings[0]);
            });
        }

        this.promise = Promise.resolve(globalSettings);

        return this.promise;
    }

    public flush() {
        this.uri = undefined;
        this.promise = undefined;
    }
}

let workspaceFolders: WorkspaceFolder[];
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let globalSettings: Settings;
const settingsCache = new SettingsCache();
// Map stores undefined values to represent failed resolutions.
const globalPackageManagerPath: Map<string, string> = new Map();
const path2Library: Map<string, typeof sassLint> = new Map();
const document2Library: Map<string, Thenable<typeof sassLint>> = new Map();
let configPathCache: {[key: string]: string | null} = {};

interface NoSassLintLibraryParams {
    source: TextDocumentIdentifier;
}

// tslint:disable-next-line:no-namespace
namespace NoSassLintLibraryRequest {
    export const type = new RequestType<NoSassLintLibraryParams, {}, void, void>("sass-lint/noLibrary");
}

function trace(message: string, verbose?: string): void {
    connection.tracer.log(message, verbose);
}

connection.onInitialize((params: InitializeParams) => {
    trace("onInitialize");

    if (params.workspaceFolders) {
        workspaceFolders = params.workspaceFolders;

        // Sort folders.
        sortWorkspaceFolders();
    }

    const capabilities = params.capabilities;

    hasWorkspaceFolderCapability = Boolean(capabilities.workspace && capabilities.workspace.workspaceFolders);
    hasConfigurationCapability   = Boolean(capabilities.workspace && capabilities.workspace.configuration);

    return {
        capabilities: {
            textDocumentSync: documents.syncKind
        }
    };
});

connection.onInitialized(() => {
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders((event) => {
            trace("onDidChangeWorkspaceFolders");

            // Removed folders.
            for (const workspaceFolder of event.removed) {
                const index = workspaceFolders.findIndex((folder) => folder.uri === workspaceFolder.uri);

                if (index !== -1) {
                    workspaceFolders.splice(index, 1);
                }
            }

            // Added folders.
            for (const workspaceFolder of event.added) {
                workspaceFolders.push(workspaceFolder);
            }

            // Sort folders.
            sortWorkspaceFolders();
        });
    }
});

function sortWorkspaceFolders() {
    workspaceFolders.sort((folder1, folder2) => {
        let uri1 = folder1.uri.toString();
        let uri2 = folder2.uri.toString();

        if (!uri1.endsWith("/")) {
            uri1 += path.sep;
        }

        if (uri2.endsWith("/")) {
            uri2 += path.sep;
        }

        return (uri1.length - uri2.length);
    });
}

documents.onDidOpen(async (event) => {
    trace(`onDidOpen: ${event.document.uri}`);

    await validateTextDocument(event.document);
});

// The content of a text document has changed.
// This event is emitted when the text document is first opened or when its content has changed.
documents.onDidChangeContent(async (event) => {
    trace(`onDidChangeContent: ${event.document.uri}`);

    const settings = await settingsCache.get(event.document.uri);

    if (settings && settings.run === "onType") {
        await validateTextDocument(event.document);
    } else if (settings && settings.run === "onSave") {
        // Clear the diagnostics when validating on save and when the document is modified.
        connection.sendDiagnostics({uri: event.document.uri, diagnostics: []});
    }
});

documents.onDidSave(async (event) => {
    trace(`onDidSave: ${event.document.uri}`);

    const settings = await settingsCache.get(event.document.uri);

    if (settings && settings.run === "onSave") {
        await validateTextDocument(event.document);
    }
});

// A text document was closed.
documents.onDidClose((event) => {
    trace(`onDidClose: ${event.document.uri}`);

    connection.sendDiagnostics({uri: event.document.uri, diagnostics: []});
    document2Library.delete(event.document.uri);

    // tslint:disable-next-line:no-dynamic-delete -- TODO: Refactor to use a map.
    delete configPathCache[URI.parse(event.document.uri).fsPath];
});

async function loadLibrary(docUri: string) {
    trace(`loadLibrary for: ${docUri}`);

    const uri = URI.parse(docUri);
    let promise: Thenable<string>;
    const settings = await settingsCache.get(docUri);

    const getGlobalPath = () => getGlobalPackageManagerPath(settings.packageManager);

    if (uri.scheme === "file") {
        const file = uri.fsPath;
        const directory = path.dirname(file);

        let nodePath: string | undefined;
        if (settings && settings.nodePath) {
            // TODO: https://github.com/Microsoft/vscode-languageserver-node/issues/475
            const exists = fs.existsSync(settings.nodePath);

            if (exists) {
                nodePath = settings.nodePath;
            } else {
                connection.window.showErrorMessage(
                    `The setting 'sasslint.nodePath' refers to '${settings.nodePath}', but this path does not exist. ` +
                    "The setting will be ignored."
                );
            }
        }

        if (nodePath) {
            promise = Files.resolve("sass-lint", nodePath, nodePath, trace).then<string, string>(
                undefined,
                () => Files.resolve("sass-lint", getGlobalPath(), directory, trace)
            );
        } else {
            promise = Files.resolve("sass-lint", getGlobalPath(), directory, trace);
        }
    } else {
        promise = Files.resolve("sass-lint", getGlobalPath(), undefined, trace);
    }

    document2Library.set(docUri, promise.then(
        (libraryPath) => {
            let library;
            if (!path2Library.has(libraryPath)) {
                library = require(libraryPath);
                trace(`sass-lint library loaded from: ${libraryPath}`);
                path2Library.set(libraryPath, library);
            }

            return path2Library.get(libraryPath);
        },
        () => {
            connection.sendRequest(NoSassLintLibraryRequest.type, {source: {uri: docUri}});
        }
    ));
}

async function validateTextDocument(document: TextDocument): Promise<void> {
    const docUri = document.uri;

    trace(`validateTextDocument: ${docUri}`);

    // Sass Lint can only lint files on disk.
    if (URI.parse(docUri).scheme !== "file") {
        return;
    }

    const settings = await settingsCache.get(docUri);

    if (settings && !settings.enable) {
        return;
    }

    if (!document2Library.has(document.uri)) {
        await loadLibrary(document.uri);
    }

    if (!document2Library.has(document.uri)) {
        return;
    }

    // tslint:disable-next-line:await-promise
    const library = await document2Library.get(document.uri);

    if (library) {
        try {
            const diagnostics = await doValidate(library, document);

            connection.sendDiagnostics({uri: docUri, diagnostics});
        } catch (err) {
            connection.window.showErrorMessage(getErrorMessage(err, document));
        }
    }
}

async function validateAllTextDocuments(textDocuments: TextDocument[]): Promise<void> {
    const tracker = new ErrorMessageTracker();

    for (const document of textDocuments) {
        try {
            await validateTextDocument(document);
        } catch (err) {
            tracker.add(getErrorMessage(err, document));
        }
    }

    tracker.sendErrors(connection);
}

async function doValidate(library: typeof sassLint, document: TextDocument): Promise<Diagnostic[]> {
    trace(`doValidate: ${document.uri}`);

    const diagnostics: Diagnostic[] = [];

    const docUri = document.uri;
    const uri = URI.parse(docUri);

    if (URI.parse(docUri).scheme !== "file") {
        // Sass Lint can only lint files on disk.
        trace("No linting: file is not saved on disk");

        return diagnostics;
    }

    const settings = await settingsCache.get(docUri);
    if (!settings) {
        trace("No linting: settings could not be loaded");

        return diagnostics;
    }

    if (settings.workspaceFolderPath) {
        trace(`Changed directory to ${settings.workspaceFolderPath}`);
        process.chdir(settings.workspaceFolderPath);
    }

    const configFile = await getConfigFile(docUri);

    trace(`Config file: ${configFile}`);

    const compiledConfig = library.getConfig({}, configFile);

    const filePath = uri.fsPath;

    let relativePath;
    if (configFile && settings.resolvePathsRelativeToConfig) {
        relativePath = path.relative(path.dirname(configFile), filePath);
    } else {
        relativePath = getWorkspaceRelativePath(filePath);
    }

    trace(`Absolute path: ${filePath}`);
    trace(`Relative path: ${relativePath}`);

    if (globule.isMatch(compiledConfig.files.include, relativePath) &&
        !globule.isMatch(compiledConfig.files.ignore, relativePath)) {
        const result = library.lintText(
            {
                text: document.getText(),
                format: path.extname(filePath).slice(1),
                filename: filePath
            },
            {},
            configFile
        );

        for (const msg of result.messages) {
            diagnostics.push(makeDiagnostic(msg));
        }
    } else {
        trace(`No linting: file "${relativePath}" is excluded`);
    }

    return diagnostics;
}

async function getConfigFile(docUri: string): Promise<string | null> {
    const filePath = URI.parse(docUri).fsPath;

    let configFile = configPathCache[filePath];

    if (configFile) {
        trace(`Config path cache hit for: ${filePath}`);

        return configFile;
    } else {
        trace(`Config path cache miss for: ${filePath}`);

        const dirName = path.dirname(filePath);

        const configFileNames = [".sass-lint.yml", ".sasslintrc"];

        for (const configFileName of configFileNames) {
            configFile = locateFile(dirName, configFileName);

            if (configFile) {
                // Cache.
                configPathCache[filePath] = configFile;

                return configFile;
            }
        }
    }

    const settings = await settingsCache.get(docUri);

    if (settings && settings.configFile) {
        // Cache.
        configPathCache[filePath] = settings.configFile;

        return settings.configFile;
    }

    return null;
}

function locateFile(directory: string, fileName: string): string | null {
    let parent = directory;

    do {
        directory = parent;

        const location = path.join(directory, fileName);

        try {
            fs.accessSync(location, fs.constants.R_OK);

            return location;
        } catch (e) {
            // Do nothing.
        }

        parent = path.dirname(directory);
    } while (parent !== directory);

    return null;
}

function getWorkspaceRelativePath(filePath: string): string {
    if (workspaceFolders) {
        for (const workspaceFolder of workspaceFolders) {
            let folderPath = URI.parse(workspaceFolder.uri).fsPath;

            if (!folderPath.endsWith("/")) {
                folderPath += path.sep;
            }

            if (folderPath && filePath.startsWith(folderPath)) {
                return path.relative(folderPath, filePath);
            }
        }
    }

    return filePath;
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

    let line: number;
    if (msg.line) {
        line = msg.line - 1;
    } else {
        line = 0;
    }

    let column: number;
    if (msg.column) {
        column = msg.column - 1;
    } else {
        column = 0;
    }

    let message: string;
    if (msg.message) {
        message = msg.message;
    } else {
        message = "Unknown error.";
    }

    return {
        severity,
        range: {
            start: {line, character: column},
            end:   {line, character: column + 1}
        },
        message,
        source: "sass-lint",
        code: msg.ruleId
    };
}

function getErrorMessage(err, document: TextDocument): string {
    let errorMessage = "unknown error";

    if (typeof err.message === "string" || err.message instanceof String) {
        errorMessage = (err.message as string);
    }

    const fsPath = URI.parse(document.uri).fsPath;
    const message = `vscode-sass-lint: '${errorMessage}' while validating: ${fsPath} stacktrace: ${err.stack}`;

    return message;
}

function getGlobalPackageManagerPath(packageManager: string): string | undefined {
    trace(`Begin - resolve global package manager path for: ${packageManager}`);

    if (!globalPackageManagerPath.has(packageManager)) {
        let packageManagerPath: string | undefined;
        if (packageManager === "npm") {
            packageManagerPath = Files.resolveGlobalNodePath(trace);
        } else if (packageManager === "yarn") {
            packageManagerPath = Files.resolveGlobalYarnPath(trace);
        }

        // tslint:disable-next-line:no-non-null-assertion
        globalPackageManagerPath.set(packageManager, packageManagerPath!);
    }

    trace(`Done - resolve global package manager path for: ${packageManager}`);

    return globalPackageManagerPath.get(packageManager);
}

// The settings have changed. Sent on server activation as well.
connection.onDidChangeConfiguration(async (params) => {
    globalSettings = params.settings;

    // Clear cache.
    configPathCache = {};

    settingsCache.flush();

    // Revalidate any open text documents.
    await validateAllTextDocuments(documents.all());
});

connection.onDidChangeWatchedFiles(async () => {
    // Clear cache.
    configPathCache = {};

    await validateAllTextDocuments(documents.all());
});

// Listen on the connection.
connection.listen();
